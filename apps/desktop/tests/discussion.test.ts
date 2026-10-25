import assert from "node:assert/strict";
import test from "node:test";
import type { Turn } from "@interprete/shared/contracts";
import { MAX_DISCUSSION_MESSAGES, MAX_DISCUSSIONS } from "@interprete/shared/discussions";
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

test("the title grows with the first reply instead of keeping the first draft", () => {
  const log = new DiscussionLog(memory());
  log.record("conversation", [input("a", { source: "bon", status: "draft" })]);
  assert.equal(openDiscussion(log.getSnapshot(), "conversation")?.title, "bon");
  log.record("conversation", [
    input("a", { source: "Bonjour, je voudrais réserver", status: "done" }),
  ]);
  assert.equal(
    openDiscussion(log.getSnapshot(), "conversation")?.title,
    "Bonjour, je voudrais réserver",
  );
});

test("a saved partial title is replaced by the first reply", () => {
  const store = memory();
  const log = new DiscussionLog(store);
  log.record("conversation", [input("a", { source: "Bonjour, je voudrais réserver", status: "done" })]);
  log.close("conversation");
  const saved = JSON.parse(store.getItem("interprete-discussions-v1") ?? "{}") as {
    discussions: Array<{ title: string }>;
  };
  saved.discussions[0].title = "bon";
  store.setItem("interprete-discussions-v1", JSON.stringify(saved));
  const restored = new DiscussionLog(store);
  assert.equal(restored.getSnapshot().discussions[0]?.title, "Bonjour, je voudrais réserver");
});

test("a named call keeps its title when the first line starts with that name", () => {
  const store = memory();
  const log = new DiscussionLog(store);
  const line = (source: string, status: DiscussionInput["status"]) =>
    input("a", { source, role: "them", name: "Other person", status });
  log.record("call", [line("Zoom", "draft")], { title: "Zoom", callId: "call-1" });
  log.record("call", [line("Zoom, can you hear me?", "done")], { title: "Zoom", callId: "call-1" });
  log.record("call", [line("Zoom, can you hear me now?", "done")], { callId: "call-1" });
  assert.equal(openDiscussion(log.getSnapshot(), "call")?.title, "Zoom");
  const restored = new DiscussionLog(store);
  assert.equal(restored.getSnapshot().discussions[0]?.title, "Zoom");
});

test("an untitled call title still grows with the first line", () => {
  const log = new DiscussionLog(memory());
  const line = (source: string, status: DiscussionInput["status"]) =>
    input("a", { source, role: "them", name: "Other person", status });
  log.record("call", [line("bon", "draft")], { callId: "call-1" });
  log.record("call", [line("Bonjour tout le monde", "done")], { callId: "call-1" });
  assert.equal(openDiscussion(log.getSnapshot(), "call")?.title, "Bonjour tout le monde");
});

test("a trimmed discussion keeps the opening title", () => {
  const store = memory();
  const log = new DiscussionLog(store);
  log.record(
    "conversation",
    Array.from({ length: MAX_DISCUSSION_MESSAGES + 1 }, (_, index) =>
      input(`m${index}`, { source: `Line ${index}`, status: "done" }),
    ),
  );
  const open = openDiscussion(log.getSnapshot(), "conversation");
  assert.equal(open?.title, "Line 0");
  assert.equal(open?.messages[0].source, "Line 1");
  log.record("conversation", [input("m1", { source: "Line 1, continued", status: "done" })]);
  assert.equal(openDiscussion(log.getSnapshot(), "conversation")?.title, "Line 0");
  const restored = new DiscussionLog(store);
  assert.equal(restored.getSnapshot().discussions[0]?.title, "Line 0");
  assert.equal(restored.getSnapshot().discussions[0]?.messages[0].source, "Line 1, continued");
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

test("a newer remote copy repairs a conversation draft and keeps a call name", () => {
  const log = new DiscussionLog(memory());
  log.record("conversation", [input("a", { source: "Bonjour, je voudrais réserver", status: "done" })]);
  log.close("conversation");
  log.record(
    "call",
    [input("b", { source: "Zoom, can you hear me?", role: "them", name: "Other person", status: "done" })],
    { title: "Zoom", callId: "call-1" },
  );
  const snapshot = log.getSnapshot();
  const conversation = snapshot.discussions.find((item) => item.kind === "conversation");
  const call = snapshot.discussions.find((item) => item.kind === "call");
  assert.ok(conversation && call);
  const newer = (discussion: Discussion) => ({
    ...discussion,
    updatedAt: discussion.updatedAt + 1,
    messages: discussion.messages.map((message) => ({ ...message, updatedAt: message.updatedAt + 1 })),
  });
  log.ingest([
    { ...newer(conversation), title: "bon" },
    newer(call),
  ]);
  const next = log.getSnapshot();
  assert.equal(
    next.discussions.find((item) => item.kind === "conversation")?.title,
    "Bonjour, je voudrais réserver",
  );
  assert.equal(next.discussions.find((item) => item.kind === "call")?.title, "Zoom");
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
