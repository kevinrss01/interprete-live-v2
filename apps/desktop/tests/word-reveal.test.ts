import assert from "node:assert/strict";
import test from "node:test";
import { advanceWordReveal, emptyWordReveal, nextWordReveal, revealWords } from "../src/lib/word-reveal";

test("word segmentation preserves punctuation, whitespace and unspaced languages", () => {
  for (const [text, language] of [["  Hello,  world!\nAgain…", "en"], ["你好世界。今天很好！", "zh"], ["สวัสดีครับทุกคน", "th"], ["…", "fr"]]) {
    assert.equal(revealWords(text, language).join(""), text);
  }
  assert.ok(revealWords("你好世界。今天很好！", "zh").length > 1);
  assert.deepEqual(revealWords("Hello, world!", "en"), ["Hello, ", "world!"]);
});

test("a five-word burst builds a short reserve then reveals one word at a time", () => {
  let state = nextWordReveal(emptyWordReveal, "one two three four five", "en", 100);
  assert.equal(state.visible, 0);
  assert.equal(advanceWordReveal(state, 279), state);
  const times: number[] = [];
  for (let visible = 1; visible <= 5; visible++) {
    times.push(state.nextAt);
    state = advanceWordReveal(state, state.nextAt);
    assert.equal(state.visible, visible);
    assert.ok(state.interval >= 48 && state.interval <= 160);
  }
  assert.equal(times[0], 280);
  assert.ok(times[4] - 100 < 1000);
  assert.equal(state.words.map(word => word.text).join(""), state.text);
  assert.equal(advanceWordReveal(state, 2000), state);
  assert.equal(nextWordReveal(state, state.text, "en", 2000), state);
});

test("more queued words accelerate the cadence progressively without a bulk reveal", () => {
  const first = advanceWordReveal(nextWordReveal(emptyWordReveal, "one two", "en", 0), 180);
  const queued = nextWordReveal(first, first.text + " word".repeat(8), "en", 200);
  const next = advanceWordReveal(queued, queued.nextAt);
  assert.ok(next.interval < first.interval);
  assert.ok(next.interval > 48);
  const late = advanceWordReveal(next, 5000);
  assert.equal(late.visible, next.visible + 1);
  assert.ok(late.interval < next.interval);
  assert.ok(late.nextAt > 5000);
});

test("token updates never postpone the word already waiting to appear", () => {
  let state = nextWordReveal(emptyWordReveal, "o", "en", 0);
  for (const [time, text] of [[40, "on"], [80, "one"], [120, "one two"], [160, "one two three"]] as const) {
    state = nextWordReveal(state, text, "en", time);
    assert.equal(state.nextAt, 180);
  }
  state = advanceWordReveal(state, 180);
  assert.equal(state.visible, 1);
  assert.equal(state.words[0].text, "one ");
});

test("revisions drop pending suffixes and never reuse their animation keys", () => {
  let first = nextWordReveal(emptyWordReveal, "I like red apples", "en", 0);
  first = advanceWordReveal(first, first.nextAt);
  first = advanceWordReveal(first, first.nextAt);
  const revised = nextWordReveal(first, "I like green pears", "en", 350);
  assert.equal(revised.words.map((w) => w.text).join(""), "I like green pears");
  assert.deepEqual(revised.words.slice(0, 2), first.words.slice(0, 2));
  assert.equal(revised.visible, 2);
  assert.ok(revised.words.slice(2).every((w) => w.key >= first.nextKey));
  const cleared = nextWordReveal(revised, "", "en", 400);
  assert.deepEqual(cleared.words, []);
  assert.equal(cleared.visible, 0);
  const replacement = nextWordReveal(cleared, "New turn", "en", 500);
  assert.equal(replacement.nextAt, 680);
  assert.ok(replacement.words[0].key >= revised.nextKey);
});

test("reduced motion displays existing and incoming words immediately", () => {
  const pending = nextWordReveal(emptyWordReveal, "one two three", "en", 0);
  const immediate = nextWordReveal(pending, pending.text, "en", 10, true);
  assert.equal(immediate.visible, 3);
  const appended = nextWordReveal(immediate, "one two three four five", "en", 20, true);
  assert.equal(appended.visible, 5);
  assert.equal(advanceWordReveal(appended, 1000), appended);
});
