// Follows the reading from what the transcription actually heard, never from a timer.
export type OnboardingSegment = { text: string; word: boolean };

export function onboardingSegments(text: string, language: string) {
  // Intl.Segmenter also splits languages written without spaces (ja, zh).
  return [...new Intl.Segmenter(language, { granularity: "word" }).segment(text)]
    .map((s): OnboardingSegment => ({ text: s.segment, word: Boolean(s.isWordLike) }));
}

const normalize = (word: string) =>
  word
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[’‘]/g, "'")
    .toLocaleLowerCase();

export const onboardingWords = (text: string, language: string) =>
  onboardingSegments(text, language)
    .filter((s) => s.word)
    .map((s) => normalize(s.text));

// Number of script words read, in order. A heard word may skip up to `lookahead`
// script words (omission, misheard word); heard words matching nothing are ignored.
// ponytail: greedy, no backtracking; enough for one short text read once.
export function onboardingReadCount(script: string[], heard: string[], lookahead = 3) {
  let read = 0;
  for (const word of heard)
    for (let skip = 0; skip <= lookahead && read + skip < script.length; skip++)
      if (script[read + skip] === word) {
        read += skip + 1;
        break;
      }
  return read;
}
