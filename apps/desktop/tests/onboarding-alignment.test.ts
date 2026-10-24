import assert from "node:assert/strict";
import test from "node:test";
import {
  onboardingReadCount,
  onboardingWords,
} from "../src/onboarding/onboarding-alignment";

const script = onboardingWords("Hello! I love discovering new places.", "en");

test("ignores case, punctuation and accents", () => {
  assert.equal(onboardingReadCount(script, onboardingWords("hello i LOVE", "en")), 3);
  const fr = onboardingWords("Bonjour ! J’aime découvrir.", "fr");
  assert.equal(onboardingReadCount(fr, onboardingWords("bonjour j'aime decouvrir", "fr")), 3);
});

test("tolerates omitted and misheard words", () => {
  assert.equal(onboardingReadCount(script, onboardingWords("hello love discovering", "en")), 4);
  assert.equal(onboardingReadCount(script, onboardingWords("hello I glove discovering new", "en")), 5);
});

test("does not jump beyond the lookahead", () => {
  assert.equal(onboardingReadCount(script, onboardingWords("places", "en")), 0);
  assert.equal(onboardingReadCount(script, onboardingWords("hello places", "en")), 1);
});

test("segments languages written without spaces", () => {
  const zh = onboardingWords("你好！我喜欢探索新的地方。", "zh");
  assert.ok(zh.length > 3);
  assert.equal(onboardingReadCount(zh, onboardingWords("你好我喜欢", "zh")) >= 2, true);
});
