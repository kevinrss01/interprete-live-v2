import assert from "node:assert/strict";
import test from "node:test";
import { DiscussionLog, type Discussion, type DiscussionChange } from "../src/lib/discussion";
import { discussionSaves, startDiscussionSync } from "../src/lib/discussion-sync";

const discussion = (source: string, id = "m"): Discussion => ({
  id: "d",
  kind: "conversation",
  title: "Hello",
  startedAt: 1_700_000_000_000,
  updatedAt: 1_700_000_060_000,
  closedAt: null,
  closed: false,
  callId: null,
  messages: [{
    id,
    at: 1_700_000_000_000,
    updatedAt: 1_700_000_002_000,
    role: "you",
    name: "You",
    source,
    translation: "Hello",
    sourceLanguage: "fr",
    targetLanguage: "en",
    status: "done",
  }],
});

test("a discussion save keeps the spoken time and splits before the request limit", () => {
  const [only] = discussionSaves(discussion("Bonjour"));
  assert.equal(only.messages.length, 1);
  assert.equal(only.messages[0].spokenAt, 1_700_000_000_000);
  assert.equal(only.messages[0].updatedAt, 1_700_000_002_000);
  assert.equal(only.closedAt, null);
  const long = discussion("x".repeat(8_000));
  long.messages[0].translation = "z".repeat(8_000);
  long.messages.push({ ...long.messages[0], id: "n", source: "y".repeat(8_000) });
  const batches = discussionSaves(long);
  assert.equal(batches.length, 2);
  assert.ok(batches.every((batch) => JSON.stringify(batch).length < 25_000));
  const header = discussionSaves(discussion("Bonjour"), new Set());
  assert.deepEqual(header[0].messages, []);
});

test("one forbidden discussion is not retried and cannot block another discussion", async (t) => {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const previousLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
  let token = "first-account";
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => token } });
  Object.defineProperty(globalThis, "location", { configurable: true, value: { origin: "http://local.test" } });
  const rejected = { ...discussion("Synthetic", "old-message"), id: "old-account" };
  const owned = { ...discussion("Synthetic", "new-message"), id: "current-account" };
  const saved: string[] = [];
  let change!: (event: DiscussionChange) => void;
  const log = {
    getSnapshot: () => ({ discussions: [rejected, owned] }),
    ingest: () => {},
    watch: (listener: typeof change) => { change = listener; return () => {}; },
  } as unknown as DiscussionLog;
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    const request = input as Request;
    if (request.url.endsWith("/list")) return Response.json({ json: [] });
    const { json } = await request.json();
    saved.push(json.id);
    return json.id === rejected.id
      ? Response.json({ json: { defined: false, code: "FORBIDDEN", status: 403, message: "Forbidden" } }, { status: 403 })
      : Response.json({ json: { id: json.id } });
  });
  const wait = () => new Promise(resolve => setTimeout(resolve, 750));
  const stop = startDiscussionSync(log);
  try {
    await wait();
    assert.deepEqual(saved, [rejected.id, owned.id]);
    change({ type: "save", id: rejected.id });
    await wait();
    assert.deepEqual(saved, [rejected.id, owned.id]);
    token = "another-account";
    change({ type: "save", id: rejected.id });
    await wait();
    assert.deepEqual(saved, [rejected.id, owned.id, rejected.id]);
  } finally {
    stop();
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
    if (previousLocation) Object.defineProperty(globalThis, "location", previousLocation);
    else Reflect.deleteProperty(globalThis, "location");
  }
});
