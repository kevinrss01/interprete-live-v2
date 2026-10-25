type Word = { start: number; end: number };

function words(text: string, language: string): Word[] {
  return Array.from(
    new Intl.Segmenter(language, { granularity: "word" }).segment(text),
  )
    .filter((part) => part.isWordLike)
    .map((part) => ({
      start: part.index,
      end: part.index + part.segment.length,
    }));
}

export type LiveSegment = {
  text: string;
  followingText: string;
  endUnits: number;
  // Offset in the transcript where the segment ends.
  end: number;
};

const weakEndings: Record<string, Set<string>> = Object.fromEntries(
  Object.entries({
    fr: "de du des à au aux pour avec sans un une le la les ce cette ces que si et ou mais",
    en: "a an the to for from with without of at in on by and or but if that",
    es: "un una el la los las de del a para por con sin y o si que",
    de: "der die das ein eine einen einem des dem den zu zum zur mit ohne von für und oder wenn dass",
    it: "un una il lo la i gli le di del a per con senza e o se che",
    pt: "o a os as um uma de do da para por com sem e ou se que",
    nl: "de het een van voor met zonder naar en of als dat",
  }).map(([language, words]) => [language, new Set(words.split(" "))]),
);
// A number word followed by another one ("two" + "hundred", "cent" + "vingt", "hundred" +
// "and fifty") is still an incomplete amount.
const numberWords =
  "\\d[\\d.,]*|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|vingt|trente|quarante|cinquante|soixante|cents?|mille|millions?|milliards?";
const numberTail = new RegExp(`^(${numberWords})$`, "iu");
const numberNext = new RegExp(`^((and|et)\\s+|-)?(${numberWords})(?![\\p{L}\\p{N}])`, "iu");
const negations: Record<string, RegExp> = {
  fr: /^(pas|plus|jamais|rien|aucun|ni)\b/iu,
  en: /^(not|never|no|n't)\b/iu,
  es: /^(no|nunca|jamás)\b/iu,
  de: /^(nicht|kein\w*|nie)\b/iu,
  pt: /^(não|nunca|jamais)\b/iu,
  it: /^(non|mai)\b/iu,
  nl: /^(niet|geen|nooit)\b/iu,
};
export function usablePrefix(
  text: string,
  following: string,
  language: string,
) {
  const units = words(text, language);
  const last = units.at(-1);
  if (!last) return false;
  const tail = text.slice(last.start, last.end).toLocaleLowerCase();
  if (weakEndings[language]?.has(tail)) return false;
  // A hyphenated compound ("soixante-dix", "Est-ce") is one unit of meaning.
  if (!/[.!?。！？]$/u.test(text) && /^-\p{L}/u.test(following)) return false;
  if (
    !/[.!?。！？]$/u.test(text) &&
    negations[language]?.test(following.trim())
  )
    return false;
  if (
    !/[.!?。！？]$/u.test(text) &&
    numberTail.test(tail) &&
    numberNext.test(following.trim())
  )
    return false;
  return true;
}

// Where `prefix` ends in a later version of the transcript, if its words and closing
// punctuation are unchanged (case and spacing may differ); null once the ASR revised them
// or extended its last word.
export function prefixEnd(prefix: string, text: string, language: string) {
  const token = (value: string, unit: Word) =>
    value.slice(unit.start, unit.end).normalize("NFKC").toLocaleLowerCase().replace(/’/g, "'");
  const before = words(prefix, language),
    after = words(text, language);
  if (!before.length || after.length < before.length) return null;
  for (let i = 0; i < before.length; i++)
    if (token(prefix, before[i]) !== token(text, after[i])) return null;
  let end = after[before.length - 1].end;
  const closing = prefix.slice(before.at(-1)!.end).trim();
  if (closing) {
    const at = text.slice(end).search(/\S/);
    if (at < 0 || !text.startsWith(closing, end + at)) return null;
    end += at + closing.length;
  }
  return end;
}

// Count lexical units, not characters: final ASR punctuation/spacing can change.
// lastWordSettled: the transcript has been quiet long enough that its last word is complete.
export function nextSegment(
  text: string,
  consumed: number,
  final: boolean,
  language: string,
  rejectedThrough = consumed,
  lastWordSettled = false,
): LiveSegment | null {
  const units = words(text, language);
  if (consumed >= units.length) return null;
  const start = units[consumed].start;
  // Keep provider requests and queued synthesized speech bounded even when
  // somebody dictates a long passage without punctuation.
  const maxChars = final ? 400 : Math.min(1800, Math.max(400,
    (units[rejectedThrough - 1]?.end ?? start) - start + 200));
  const limit = Math.max(consumed + 1,
    units.filter((unit) => unit.end <= start + maxChars).length);
  if (final) {
    const end = limit < units.length ? units[limit - 1].end : text.length;
    return {
      text: text.slice(start, end).trim(),
      followingText: text.slice(end).trim().slice(0, 512),
      endUnits: limit,
      end,
    };
  }

  for (const match of text
    .slice(start)
    .matchAll(/[。！？；，：،؛؟]|[.!?…,;:](?=\s|$)/gu)) {
    const end = start + match.index! + match[0].length;
    const endUnits = units.filter((unit) => unit.end <= end).length;
    if (endUnits > limit) break;
    if (endUnits > rejectedThrough) {
      return {
        text: text.slice(start, end).trim(),
        followingText: text.slice(end).trim().slice(0, 512),
        endUnits,
        end,
      };
    }
  }
  // The last word may still be arriving. Don't speak a partial lexical token.
  const endUnits = Math.min(limit, units.length - (lastWordSettled || /\s$/u.test(text) ? 0 : 1));
  if (endUnits <= rejectedThrough || endUnits - consumed < 2) return null;
  const end = units[endUnits - 1].end;
  return {
    text: text.slice(start, end).trim(),
    followingText: text.slice(end).trim().slice(0, 512),
    endUnits,
    end,
  };
}

// Match the already spoken source to a revised final ASR prefix. Punctuation,
// inserted articles and word contractions must not cause a whole-turn replay.
export function reconcileConsumed(
  spoken: string,
  finalText: string,
  language: string,
) {
  const tokens = (text: string) =>
    words(text, language).map((w) =>
      text.slice(w.start, w.end).normalize("NFKC").toLocaleLowerCase(),
    );
  const before = tokens(spoken),
    after = tokens(finalText);
  if (!before.length) return 0;
  const limit = Math.min(after.length, before.length + 12);
  let previous = Array.from({ length: limit + 1 }, (_, i) => i);
  for (let i = 1; i <= before.length; i++) {
    const row = [i];
    for (let j = 1; j <= limit; j++)
      row[j] = Math.min(
        row[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (before[i - 1] === after[j - 1] ? 0 : 1),
      );
    previous = row;
  }
  let end = Math.min(before.length, limit);
  for (let j = 0; j <= limit; j++)
    if (
      previous[j] < previous[end] ||
      (previous[j] === previous[end] &&
        Math.abs(j - before.length) < Math.abs(end - before.length))
    )
      end = j;
  return previous[end] <= Math.max(2, Math.floor(before.length * 0.35))
    ? end
    : Math.min(before.length, after.length);
}

export function appendTranslation(
  previous: string,
  next: string,
  language: string,
) {
  if (!previous) return next.trimStart();
  if (!next) return previous;
  const separator =
    ["zh", "ja"].includes(language) || /^[,.!?;:，。！？；：]/u.test(next)
      ? ""
      : " ";
  return previous.trimEnd() + separator + next.trimStart();
}
