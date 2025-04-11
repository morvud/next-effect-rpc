import { Rpc, RpcGroup } from "@effect/rpc";
import { Schema } from "effect";

// Define a user with an ID and name
export class User extends Schema.Class<User>("User")({
  id: Schema.String, // User's ID as a string
  name: Schema.String, // User's name as a string
}) {}

export class UserNotFound extends Schema.TaggedError<UserNotFound>()(
  "UserNotFound",
  {
    message: Schema.String,
  }
) {}

// Define a group of RPCs for user management.
// You can use the `RpcGroup.make` function to create a group of RPCs.
export class UserRpcs extends RpcGroup.make(
  // Request to retrieve a list of users
  Rpc.make("UserList", {
    success: User, // Succeed with a stream of users
    stream: true,
  }),
  Rpc.make("UserById", {
    success: User,
    error: UserNotFound,
    payload: {
      id: Schema.String,
    },
  }),
  Rpc.make("UserCreate", {
    success: User,
    payload: {
      name: Schema.String,
    },
  })
) {}
