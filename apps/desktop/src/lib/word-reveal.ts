export type RevealWord = { key: number; text: string; at: number; delay: number };
export type WordReveal = { text: string; words: RevealWord[]; nextKey: number };
export const emptyWordReveal: WordReveal = { text: "", words: [], nextKey: 0 };

// Keep original separators and punctuation; Segmenter also handles unspaced languages.
export function revealWords(text: string, language: string): string[] {
  const words: string[] = [];
  let prefix = "";
  for (const part of new Intl.Segmenter(language, { granularity: "word" }).segment(text)) {
    if (part.isWordLike) {
      words.push(prefix + part.segment);
      prefix = "";
    } else if (words.length) {
      words[words.length - 1] += part.segment;
    } else {
      prefix += part.segment;
    }
  }
  return words.length ? words : prefix ? [prefix] : [];
}

export function nextWordReveal(current: WordReveal, text: string, language: string, now: number): WordReveal {
  if (text === current.text) return current;
  const parts = revealWords(text, language);
  let shared = 0;
  while (shared < parts.length && shared < current.words.length &&
    (parts[shared] === current.words[shared].text ||
      (shared === current.words.length - 1 && parts[shared].startsWith(current.words[shared].text)))) shared++;
  const words = current.words.slice(0, shared).map((word, index) => ({ ...word, text: parts[index] }));
  const count = parts.length - shared;
  const start = Math.max(now, (words.at(-1)?.at ?? now - 35) + 35);
  // Every incoming batch finishes starting within 240 ms, even while more text arrives.
  const step = Math.min(35, Math.max(0, now + 240 - start) / Math.max(1, count - 1));
  let nextKey = current.nextKey;
  for (let index = shared; index < parts.length; index++) {
    const at = Math.min(now + 240, start + (index - shared) * step);
    words.push({ key: nextKey++, text: parts[index], at, delay: at - now });
  }
  return { text, words, nextKey };
}
