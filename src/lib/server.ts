import { Rpc, RpcGroup, RpcSerialization, RpcServer } from "@effect/rpc";
import {
  constEof,
  FromClientEncoded,
  FromServerEncoded,
  RequestId,
  ResponseDefectEncoded,
} from "@effect/rpc/RpcMessage";
import { Protocol } from "@effect/rpc/RpcServer";
import { Array, Effect, Layer, Mailbox, ManagedRuntime } from "effect";

const transformBigInt = (response: FromServerEncoded) => {
  if ("requestId" in response) {
    (response as any).requestId = response.requestId.toString();
  }
};

const makeProtocol = Effect.gen(function* () {
  const serialization = yield* RpcSerialization.RpcSerialization;

  const disconnects = yield* Mailbox.make<number>();
  let writeRequest!: (
    clientId: number,
    message: FromClientEncoded
  ) => Effect.Effect<void>;

  let clientId = 0;

  const clients = new Map<
    number,
    {
      readonly write: (bytes: FromServerEncoded) => Effect.Effect<void>;
      readonly end: Effect.Effect<void>;
    }
  >();

  const app = Effect.fnUntraced(function* (data: Uint8Array) {
    const id = clientId++;
    const mailbox = yield* Mailbox.make<Uint8Array | FromServerEncoded>();
    const parser = serialization.unsafeMake();
    const encoder = new TextEncoder();

    const offer = (data: Uint8Array | string) =>
      typeof data === "string"
        ? mailbox.offer(encoder.encode(data))
        : mailbox.offer(data);

    clients.set(id, {
      write: (response) => {
        try {
          if (!serialization.supportsBigInt) {
            transformBigInt(response);
          }
          return mailbox.offer(response);
        } catch (cause) {
          return mailbox.offer(ResponseDefectEncoded(cause));
        }
      },
      end: mailbox.end,
    });

    const requestIds: Array<RequestId> = [];

    try {
      const decoded = parser.decode(data) as ReadonlyArray<FromClientEncoded>;
      for (const message of decoded) {
        if (message._tag === "Request") {
          requestIds.push(RequestId(message.id));
        }
        yield* writeRequest(id, message);
      }
    } catch (cause) {
      yield* offer(parser.encode(ResponseDefectEncoded(cause)));
    }

    yield* writeRequest(id, constEof);

    let done = false;
    yield* Effect.addFinalizer(() => {
      clients.delete(id);
      disconnects.unsafeOffer(id);
      if (done) return Effect.void;
      return Effect.forEach(
        requestIds,
        (requestId) => writeRequest(id, { _tag: "Interrupt", requestId }),
        { discard: true }
      );
    });
    const responses = Array.empty<FromServerEncoded>();
    while (true) {
      const [items, done] = yield* mailbox.takeAll;
      responses.push(...(items as any));
      if (done) break;
    }
    done = true;
    return responses;
  });

  const protocol = yield* Protocol.make((writeRequest_) => {
    writeRequest = writeRequest_;
    return Effect.succeed({
      disconnects,
      send: (clientId, response) => {
        const client = clients.get(clientId);
        if (!client) return Effect.void;
        return client.write(response);
      },
      end(clientId) {
        const client = clients.get(clientId);
        if (!client) return Effect.void;
        return client.end;
      },
      initialMessage: Effect.succeedNone,
      supportsAck: false,
      supportsTransferables: false,
      supportsSpanPropagation: false,
    });
  });

  return { protocol, app } as const;
});

export const toServerActionHandler = <Rpcs extends Rpc.Any, LE>(
  group: RpcGroup.RpcGroup<Rpcs>,
  options: {
    readonly layer: Layer.Layer<
      | Rpc.ToHandler<Rpcs>
      | Rpc.Middleware<Rpcs>
      | RpcSerialization.RpcSerialization,
      LE
    >;
  }
) => {
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(options.layer, Layer.scope)
  );
  let handlerCached:
    | ((request: Uint8Array) => Promise<FromServerEncoded[]>)
    | undefined;

  const handlerPromise = Effect.gen(function* () {
    const { protocol, app } = yield* makeProtocol;
    yield* RpcServer.make(group).pipe(
      Effect.provideService(Protocol, protocol),
      Effect.interruptible,
      Effect.forkScoped
    );
    const handler = async (data: Uint8Array) =>
      app(data).pipe(Effect.scoped, runtime.runPromise);
    handlerCached = handler;
    return handler;
  }).pipe(runtime.runPromise);
  function handler(request: Uint8Array) {
    if (handlerCached !== undefined) {
      return handlerCached(request);
    }
    return handlerPromise.then((handler) => handler(request));
  }
  return handler;
};
