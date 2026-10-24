export const normalizeSpeech = (text: string) =>
  text
    .toLocaleLowerCase()
    .normalize("NFKC")
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
export function canPrepare(text: string, previous: string) {
  const current = normalizeSpeech(text);
  return (
    current.split(" ").length >= 4 &&
    current !== normalizeSpeech(previous) &&
    current.length >= 16
  );
}
