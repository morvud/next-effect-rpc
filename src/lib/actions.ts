"use server";

import { Layer } from "effect";
import { UserRpcs } from "./request";
import { toServerActionHandler } from "./server";
import { UsersLive } from "./handlers";
import { RpcSerialization } from "@effect/rpc";

export const handler = toServerActionHandler(UserRpcs, {
  layer: Layer.mergeAll(UsersLive, RpcSerialization.layerJson),
});
