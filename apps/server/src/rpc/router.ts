import type { RouterClient } from "@orpc/server";
import { me } from "./account.me";
import { get } from "./preferences.get";
import { update } from "./preferences.update";

export const router = {
  account: { me },
  preferences: { get, update },
};
export type ApiClient = RouterClient<typeof router>;
