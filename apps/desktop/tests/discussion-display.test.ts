import assert from "node:assert/strict";
import test from "node:test";
import type { Discussion, DiscussionMessage } from "../src/lib/discussion";
import {
  discussionCountLabel,
  discussionLanguagePair,
  discussionPreview,
  discussionsByUpdate,
  formatDiscussionListTime,
  recentDiscussions,
} from "../src/lib/discussion-display";

const at = (year: number, month: number, day: number, hour = 0, minute = 0) =>
  new Date(year, month - 1, day, hour, minute).getTime();

function message(patch: Partial<DiscussionMessage> = {}): DiscussionMessage {
  return {
    id: "m",
    at: 0,
    updatedAt: 0,
    role: "you",
    name: "You",
    source: "Bonjour",
    translation: "Hello",
    sourceLanguage: "fr",
    targetLanguage: "en",
    status: "done",
    ...patch,
  };
}

function discussion(messages: DiscussionMessage[], patch: Partial<Discussion> = {}): Discussion {
  return {
    id: "d",
    kind: "conversation",
    title: "Conversation",
    startedAt: 0,
    updatedAt: 0,
    closedAt: null,
    closed: true,
    callId: null,
    messages,
    ...patch,
  };
}

test("history list time is today, yesterday, or the date", () => {
  const now = at(2026, 10, 25, 15, 0);
  assert.equal(formatDiscussionListTime(at(2026, 10, 25, 9, 5), now), "9:05 AM");
  assert.equal(formatDiscussionListTime(at(2026, 10, 24, 18, 30), now), "Yesterday, 6:30 PM");
  assert.equal(formatDiscussionListTime(at(2026, 10, 1, 8, 0), now), "Oct 1");
});

test("discussion labels keep a single pair, a swap, or every language", () => {
  assert.equal(discussionCountLabel(1), "1 message");
  assert.equal(discussionCountLabel(2), "2 messages");
  assert.equal(discussionLanguagePair(discussion([])), "");
  assert.equal(
    discussionLanguagePair(discussion([message()])),
    "French → English",
  );
  assert.equal(
    discussionLanguagePair(
      discussion([
        message(),
        message({ id: "b", role: "them", sourceLanguage: "en", targetLanguage: "fr" }),
      ]),
    ),
    "French ↔ English",
  );
  assert.equal(
    discussionLanguagePair(
      discussion([
        message(),
        message({ id: "c", sourceLanguage: "es", targetLanguage: "en", source: "Hola", translation: "Hello" }),
      ]),
    ),
    "French · English · Spanish",
  );
});

test("preview uses the latest line that is not the title", () => {
  const titled = discussion(
    [
      message({ translation: "First meeting" }),
      message({ id: "b", translation: "   ", source: "First meeting" }),
    ],
    { title: "First meeting" },
  );
  assert.equal(discussionPreview(titled), "");
  assert.equal(
    discussionPreview(discussion([message({ translation: "See you tomorrow" })], { title: "Hello" })),
    "See you tomorrow",
  );
});

test("recent discussions follow the latest update and stay capped", () => {
  const rows = [1, 2, 3, 4, 5, 6].map((index) =>
    discussion([message()], { id: String(index), updatedAt: index, title: String(index) }),
  );
  assert.deepEqual(
    recentDiscussions(rows).map((row) => row.id),
    ["6", "5", "4", "3", "2"],
  );
  const original = rows.map((row) => row.id);
  discussionsByUpdate(rows);
  assert.deepEqual(rows.map((row) => row.id), original);
});
