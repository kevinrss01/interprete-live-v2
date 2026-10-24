import assert from "node:assert/strict";
import test from "node:test";
import type { Discussion } from "../src/lib/discussion";
import { discussionSaves } from "../src/lib/discussion-sync";

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
