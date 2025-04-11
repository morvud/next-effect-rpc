import * as RpcSerialization from "@effect/rpc/RpcSerialization";
import * as RpcClient from "@effect/rpc/RpcClient";
import { Effect } from "effect";
import { FromClientEncoded } from "@effect/rpc/RpcMessage";
import { handler } from "./actions";
import { constVoid } from "effect/Function";
import { HttpBody } from "@effect/platform";

const transformBigInt = (request: FromClientEncoded) => {
  if (request._tag === "Request") {
    (request as any).id = request.id.toString();
  } else if ("requestId" in request) {
    (request as any).requestId = request.requestId.toString();
  }
};

export const makeServerActionProtocol = RpcClient.Protocol.make(
  Effect.fnUntraced(function* (writeResponse) {
    const serialization = yield* RpcSerialization.RpcSerialization;

    const send = (request: FromClientEncoded): Effect.Effect<void> => {
      if (request._tag !== "Request") {
        return Effect.void;
      }

      const parser = serialization.unsafeMake();
      if (!serialization.supportsBigInt) transformBigInt(request);

      const encoded = parser.encode(request);
      const { body } =
        typeof encoded === "string"
          ? HttpBody.text(encoded, serialization.contentType)
          : HttpBody.uint8Array(encoded, serialization.contentType);

      return Effect.promise(() => handler(body)).pipe(
        Effect.flatMap((u) => {
          if (!Array.isArray(u)) {
            return Effect.dieMessage(
              `Expected an array of responses, but got: ${u}`
            );
          }
          let i = 0;
          return Effect.whileLoop({
            while: () => i < u.length,
            body: () => writeResponse(u[i++]),
            step: constVoid,
          });
        })
      );
    };

    return {
      send,
      supportsAck: false,
      supportsTransferables: false,
    };
  })
);
