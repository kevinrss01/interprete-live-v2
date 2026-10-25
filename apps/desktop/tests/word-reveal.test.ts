import assert from "node:assert/strict";
import test from "node:test";
import { emptyWordReveal, nextWordReveal, revealWords } from "../src/lib/word-reveal";

test("word segmentation preserves punctuation, whitespace and unspaced languages", () => {
  for (const [text, language] of [["  Hello,  world!\nAgain…", "en"], ["你好世界。今天很好！", "zh"], ["สวัสดีครับทุกคน", "th"], ["…", "fr"]]) {
    assert.equal(revealWords(text, language).join(""), text);
  }
  assert.ok(revealWords("你好世界。今天很好！", "zh").length > 1);
  assert.deepEqual(revealWords("Hello, world!", "en"), ["Hello, ", "world!"]);
});

test("batches reveal in order at 35 ms and catch up within 240 ms", () => {
  const short = nextWordReveal(emptyWordReveal, "one two three four five", "en", 100);
  assert.deepEqual(short.words.map((w) => w.delay), [0, 35, 70, 105, 140]);
  const long = nextWordReveal(short, short.text + " word".repeat(100), "en", 110);
  assert.ok(long.words.every((w, i) => i === 0 || w.at >= long.words[i - 1].at));
  assert.ok(long.words.at(-1)!.at <= 350);
  assert.equal(nextWordReveal(long, long.text, "en", 500), long);
  assert.equal(long.words[0].key, short.words[0].key);
  assert.equal(long.words[0].delay, short.words[0].delay);
});

test("revisions drop pending suffixes and never reuse their animation keys", () => {
  const first = nextWordReveal(emptyWordReveal, "I like red apples", "en", 0);
  const revised = nextWordReveal(first, "I like green pears", "en", 10);
  assert.equal(revised.words.map((w) => w.text).join(""), "I like green pears");
  assert.deepEqual(revised.words.slice(0, 2), first.words.slice(0, 2));
  assert.ok(revised.words.slice(2).every((w) => w.key >= first.nextKey));
  const cleared = nextWordReveal(revised, "", "en", 15);
  assert.deepEqual(cleared.words, []);
  const replacement = nextWordReveal(cleared, "New turn", "en", 20);
  assert.equal(replacement.words[0].delay, 0);
  assert.ok(replacement.words[0].key >= revised.nextKey);
});
