import type { RouterClient } from "@orpc/server";
import { me } from "./account.me";
import { updateName } from "./account.update-name";
import { list as listDiscussions } from "./discussions.list";
import { messages as discussionMessages } from "./discussions.messages";
import { remove as removeDiscussion } from "./discussions.remove";
import { save as saveDiscussion } from "./discussions.save";
import { get } from "./preferences.get";
import { update } from "./preferences.update";
import * as voice from "./voice";

export const router = {
  account: { me, updateName },
  preferences: { get, update },
  voice: { get: voice.get, save: voice.save, remove: voice.remove },
  discussions: {
    list: listDiscussions,
    messages: discussionMessages,
    save: saveDiscussion,
    remove: removeDiscussion,
  },
};
export type ApiClient = RouterClient<typeof router>;
