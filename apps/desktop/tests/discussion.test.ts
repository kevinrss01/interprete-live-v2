import assert from "node:assert/strict";
import test from "node:test";
import type { Turn } from "@interprete/shared/contracts";
import { MAX_DISCUSSIONS } from "@interprete/shared/discussions";
import {
  DiscussionLog,
  discussionInput,
  mergeMessages,
  messageIds,
  openDiscussion,
  type Discussion,
  type DiscussionInput,
} from "../src/lib/discussion";

const memory = () => {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    key: (index: number) => [...values.keys()][index] ?? null,
  } satisfies Storage;
};

const input = (id: string, patch: Partial<DiscussionInput> = {}): DiscussionInput => ({
  id,
  role: "you",
  name: "You",
  source: `Hello ${id}`,
  translation: "",
  sourceLanguage: "fr",
  targetLanguage: "en",
  status: "draft",
  ...patch,
});

const turn = (id: string, speaker: "a" | "b", source: string): Turn => ({
  id,
  speaker,
  sourceLanguage: "fr",
  targetLanguage: "en",
  source,
  translation: source,
  status: "done",
  metrics: {},
});

test("messages append, and a later update keeps its place", () => {
  const log = new DiscussionLog(memory());
  log.record("conversation", [input("a")]);
  log.record("conversation", [input("a", { translation: "Bonjour", status: "done" }), input("b")]);
  const discussion = openDiscussion(log.getSnapshot(), "conversation");
  assert.deepEqual(
    discussion?.messages.map((message) => [message.id, message.translation]),
    [
      ["a", "Bonjour"],
      ["b", ""],
    ],
  );
  assert.equal(log.getSnapshot().discussions.length, 1);
});

test("blank speech is ignored and an unchanged record does not notify", () => {
  const log = new DiscussionLog(memory());
  let notices = 0;
  log.subscribe(() => notices++);
  log.record("conversation", [input("blank", { source: "   ", translation: "  " })]);
  assert.equal(log.getSnapshot().discussions.length, 0);
  log.record("conversation", [input("a")]);
  log.record("conversation", [input("a")]);
  assert.equal(notices, 1);
});

test("closing keeps the text and the next message starts a new discussion", () => {
  const log = new DiscussionLog(memory());
  log.record("conversation", [input("a", { source: "First meeting" })]);
  log.close("conversation");
  log.record("conversation", [input("b", { source: "Second meeting" })]);
  const { discussions, open } = log.getSnapshot();
  assert.equal(discussions.length, 2);
  assert.equal(discussions[0].closed, true);
  assert.equal(discussions[0].messages[0].source, "First meeting");
  assert.equal(open.conversation, discussions[1].id);
  assert.equal(discussions[1].title, "Second meeting");
});

test("a different call starts its own discussion without copying earlier messages", () => {
  const log = new DiscussionLog(memory());
  log.record("call", [input("one", { role: "them", name: "Other person" })], {
    title: "Chrome / Meet",
    callId: "call-1",
  });
  log.record(
    "call",
    [input("one", { role: "them", name: "Other person" }), input("two")],
    { title: "Chrome / Meet", callId: "call-2" },
  );
  const { discussions, open } = log.getSnapshot();
  assert.equal(discussions.length, 2);
  assert.equal(discussions[0].messages.map((message) => message.id).join(), "one");
  assert.equal(discussions[1].messages.map((message) => message.id).join(), "two");
  assert.equal(open.call, discussions[1].id);
});

test("reloading continues the open discussion and drops audio", () => {
  const store = memory();
  const first = new DiscussionLog(store);
  const spoken = {
    ...input("a", { translation: "Hello" }),
    audioUrl: "blob:secret",
  } as DiscussionInput;
  first.record("conversation", [spoken]);
  assert.equal(JSON.stringify(store).includes("blob:"), false);
  const second = new DiscussionLog(store);
  second.record("conversation", [input("b")]);
  const discussion = openDiscussion(second.getSnapshot(), "conversation");
  assert.deepEqual(
    discussion?.messages.map((message) => message.id),
    ["a", "b"],
  );
});

test("discussionInput keeps speech text and leaves playback behind", () => {
  const saved = discussionInput(
    { ...turn("a", "a", "Bonjour"), audioUrl: "blob:secret", metrics: { firstAudioMs: 10 } },
    "you",
    "You",
  );
  assert.equal(saved.source, "Bonjour");
  assert.equal("audioUrl" in saved, false);
  assert.equal("metrics" in saved, false);
});

test("archived messages stay out of the open discussion while a new turn is shown", () => {
  const log = new DiscussionLog(memory());
  log.record("call", [input("old", { role: "them", name: "Other person" })], { callId: "call-1" });
  log.close("call");
  const saved = openDiscussion(log.getSnapshot(), "call")?.messages ?? [];
  const shown = mergeMessages(
    saved,
    [turn("old", "b", "Old line"), turn("new", "a", "New line")],
    { you: "You", them: "Other person" },
    messageIds(log.getSnapshot()),
  );
  assert.deepEqual(shown.map((message) => message.id), ["new"]);
});

test("only the newest discussions and messages are kept", () => {
  const log = new DiscussionLog(memory());
  for (let i = 0; i < MAX_DISCUSSIONS + 1; i++) {
    log.record("conversation", [input(`m${i}`, { source: `Meeting ${i}` })]);
    log.close("conversation");
  }
  assert.equal(log.getSnapshot().discussions.length, MAX_DISCUSSIONS);
  assert.equal(log.getSnapshot().discussions[0].messages[0].source, "Meeting 1");
  log.record(
    "call",
    Array.from({ length: 205 }, (_, index) => input(`c${index}`, { source: `Line ${index}` })),
    { callId: "long" },
  );
  const call = openDiscussion(log.getSnapshot(), "call");
  assert.equal(call?.messages.length, 200);
  assert.equal(call?.messages[0].source, "Line 5");
});

test("retention keeps the most recently updated closed discussions", () => {
  const log = new DiscussionLog(memory());
  const closed = (id: string, updatedAt: number): Discussion => ({
    id,
    kind: "conversation",
    title: id,
    startedAt: updatedAt,
    updatedAt,
    closedAt: updatedAt,
    closed: true,
    callId: null,
    messages: [{
      id: `msg-${id}`,
      at: updatedAt,
      updatedAt,
      role: "you",
      name: "You",
      source: id,
      translation: "",
      sourceLanguage: "fr",
      targetLanguage: "en",
      status: "done",
    }],
  });
  const remote = Array.from({ length: MAX_DISCUSSIONS + 1 }, (_, index) =>
    closed(`d${String(index).padStart(2, "0")}`, 1_000 + index),
  );
  remote[0].updatedAt = 1_000 + MAX_DISCUSSIONS + 5;
  remote[0].messages[0].updatedAt = remote[0].updatedAt;
  log.ingest(remote);
  const kept = log.getSnapshot().discussions.map((discussion) => discussion.id);
  assert.equal(kept.length, MAX_DISCUSSIONS);
  assert.equal(kept.includes("d00"), true);
  assert.equal(kept.includes("d01"), false);
});

test("corrupt storage and a full disk still leave a usable discussion", () => {
  const broken = memory();
  broken.setItem("interprete-discussions-v1", "{");
  const restored = new DiscussionLog(broken);
  assert.equal(restored.getSnapshot().discussions.length, 0);
  let failed = false;
  const full = memory();
  full.setItem = () => {
    failed = true;
    throw new Error("quota");
  };
  const log = new DiscussionLog(full);
  log.record("conversation", [input("a")]);
  assert.equal(failed, true);
  assert.equal(log.getSnapshot().discussions[0].messages[0].source, "Hello a");
});
