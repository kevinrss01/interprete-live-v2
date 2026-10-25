export type RevealWord = { key: number; text: string; receivedAt: number };
export type WordReveal = {
  text: string;
  words: RevealWord[];
  nextKey: number;
  visible: number;
  nextAt: number;
  interval: number;
};
export const emptyWordReveal: WordReveal = {
  text: "", words: [], nextKey: 0, visible: 0, nextAt: 0, interval: 145,
};

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

export function nextWordReveal(current: WordReveal, text: string, language: string, now: number, immediate = false): WordReveal {
  if (text === current.text)
    return immediate && current.visible < current.words.length ? { ...current, visible: current.words.length } : current;
  const parts = revealWords(text, language);
  let shared = 0;
  while (shared < parts.length && shared < current.words.length &&
    (parts[shared] === current.words[shared].text ||
      (shared === current.words.length - 1 && parts[shared].startsWith(current.words[shared].text)))) shared++;
  const words = current.words.slice(0, shared).map((word, index) => word.text === parts[index] ? word : { ...word, text: parts[index] });
  let nextKey = current.nextKey;
  for (let index = shared; index < parts.length; index++)
    words.push({ key: nextKey++, text: parts[index], receivedAt: now });
  return {
    text, words, nextKey,
    visible: immediate ? words.length : Math.min(current.visible, shared),
    // New tokens must not keep postponing a word already waiting in the queue.
    nextAt: current.visible < shared ? current.nextAt : Math.max(current.nextAt, now + 180),
    interval: text ? current.interval : 145,
  };
}

export function advanceWordReveal(current: WordReveal, now: number): WordReveal {
  const pending = current.words.length - current.visible;
  if (!pending || now < current.nextAt) return current;
  const age = now - current.words[current.visible].receivedAt;
  const desired = Math.max(48, 160 / (1 + (pending - 1) * 0.18) * (age > 650 ? 0.7 : 1));
  const interval = current.interval + (desired - current.interval) * 0.4;
  // Release one word per tick, even after a delayed timer or a backgrounded window.
  return { ...current, visible: current.visible + 1, interval, nextAt: now + interval };
}
