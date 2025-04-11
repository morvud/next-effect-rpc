"use client";

import styles from "./page.module.css";
import { Array, Effect, Exit, Layer, Stream } from "effect";
import { RpcClient, RpcSerialization } from "@effect/rpc";
import { User, UserNotFound, UserRpcs } from "@/lib/request";
import { makeServerActionProtocol } from "@/lib/client";
import { useState, useTransition } from "react";

export const ProtocolLive = Layer.effect(
  RpcClient.Protocol,
  makeServerActionProtocol
).pipe(Layer.provide([RpcSerialization.layerJson]));

function UserList() {
  const [isPending, startTransition] = useTransition();
  const [users, setUsers] = useState<User[]>([]);

  return (
    <>
      <button
        onClick={() => {
          startTransition(async () => {
            const users = await Effect.gen(function* () {
              const client = yield* RpcClient.make(UserRpcs);
              return yield* Stream.runCollect(client.UserList());
            }).pipe(
              Effect.map(Array.fromIterable),
              Effect.scoped,
              Effect.provide(ProtocolLive),
              Effect.runPromise
            );
            setUsers(users);
          });
        }}
      >
        User List
      </button>
      {isPending ? "Loading..." : <pre>{JSON.stringify(users, null, 2)}</pre>}
    </>
  );
}

function UserById() {
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<Exit.Exit<User, UserNotFound> | null>(
    null
  );

  return (
    <>
      <form
        action={(formData) => {
          startTransition(async () => {
            const id = formData.get("id") as string;
            const exit = await Effect.gen(function* () {
              const client = yield* RpcClient.make(UserRpcs);
              return yield* client.UserById({ id });
            }).pipe(
              Effect.scoped,
              Effect.provide(ProtocolLive),
              Effect.runPromiseExit
            );
            setState(exit);
          });
        }}
      >
        <input type="text" name="id" placeholder="User ID" />
        <button type="submit">User By ID</button>
      </form>
      {isPending ? "Loading..." : <pre>{JSON.stringify(state, null, 2)}</pre>}
    </>
  );
}

export default function Home() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <UserList />
        <UserById />
      </main>
    </div>
  );
}
