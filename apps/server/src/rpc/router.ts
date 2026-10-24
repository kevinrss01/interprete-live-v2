import type { RouterClient } from "@orpc/server";
import { me } from "./account.me";
import { updateName } from "./account.update-name";
import { get } from "./preferences.get";
import { update } from "./preferences.update";

export const router = {
  account: { me, updateName },
  preferences: { get, update },
};
export type ApiClient = RouterClient<typeof router>;
