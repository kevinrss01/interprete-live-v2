export const LANGUAGES = [
  { code: "fr", name: "French", native: "Français" },
  { code: "en", name: "English", native: "English" },
  { code: "es", name: "Spanish", native: "Español" },
  { code: "de", name: "German", native: "Deutsch" },
  { code: "it", name: "Italian", native: "Italiano" },
  { code: "pt", name: "Portuguese", native: "Português" },
  { code: "nl", name: "Dutch", native: "Nederlands" },
  { code: "ja", name: "Japanese", native: "日本語" },
  { code: "ko", name: "Korean", native: "한국어" },
  { code: "zh", name: "Chinese", native: "中文" },
  { code: "ar", name: "Arabic", native: "العربية" },
  { code: "hi", name: "Hindi", native: "हिन्दी" },
  { code: "pl", name: "Polish", native: "Polski" },
  { code: "ru", name: "Russian", native: "Русский" },
  { code: "sv", name: "Swedish", native: "Svenska" },
  { code: "tr", name: "Turkish", native: "Türkçe" },
  { code: "uk", name: "Ukrainian", native: "Українська" },
  { code: "vi", name: "Vietnamese", native: "Tiếng Việt" },
] as const;
export type Language = (typeof LANGUAGES)[number]["code"];
export const languageName = (code: string) =>
  LANGUAGES.find((l) => l.code === code)?.name ?? code;
export const languageNative = (code: string) =>
  LANGUAGES.find((l) => l.code === code)?.native ?? code;
export const VOICE_PRESETS = [
  {
    key: "sarah",
    name: "Sarah",
    description: "Clear and soft",
    id: "EXAVITQu4vr4xnSDxMaL",
  },
  {
    key: "george",
    name: "George",
    description: "Warm and deep",
    id: "JBFqnCBsd6RMkjVDRZzb",
  },
  {
    key: "river",
    name: "River",
    description: "Smooth and natural",
    id: "SAz9YHcvj6GT2YYXdXww",
  },
] as const;
type Gender = "female" | "male" | "neutral";
type Voice = {
  key: string;
  name: string;
  id: string;
  language: Language;
  gender: Gender;
  pitchHz: readonly [number, number];
  description: string;
};
// Premade voices a call participant can be matched to. A match only borrows the
// participant's measured pitch and timbre; nothing about their voice is cloned or stored.
export const MATCH_VOICES = [
  { key: "jessica", name: "Jessica", id: "cgSgspJ2msm6clMCkdW9", language: "en", gender: "female", pitchHz: [215, 260], description: "Female, young, bright and playful" },
  { key: "laura", name: "Laura", id: "FGY2WhTYpPnrIDTdsKH5", language: "en", gender: "female", pitchHz: [205, 245], description: "Female, young, upbeat and enthusiastic" },
  { key: "sarah", name: "Sarah", id: "EXAVITQu4vr4xnSDxMaL", language: "en", gender: "female", pitchHz: [190, 220], description: "Female, young adult, warm and confident" },
  { key: "matilda", name: "Matilda", id: "XrExE9yKIg1WjnnlVkGX", language: "en", gender: "female", pitchHz: [172, 198], description: "Female, middle-aged, professional alto" },
  { key: "lily", name: "Lily", id: "pFZP5JQG7iQjIQuC4Bku", language: "en", gender: "female", pitchHz: [165, 190], description: "Female, middle-aged, velvety and calm" },
  { key: "river", name: "River", id: "SAz9YHcvj6GT2YYXdXww", language: "en", gender: "neutral", pitchHz: [148, 172], description: "Gender-neutral, relaxed and calm" },
  { key: "liam", name: "Liam", id: "TX3LPaxmHKxFdv7VOQHJ", language: "en", gender: "male", pitchHz: [130, 155], description: "Male, young, energetic" },
  { key: "eric", name: "Eric", id: "cjVigY5qzO86Huf0OWal", language: "en", gender: "male", pitchHz: [120, 145], description: "Male, in his 40s, smooth tenor" },
  { key: "chris", name: "Chris", id: "iP95p4xoKVk53GoZ742B", language: "en", gender: "male", pitchHz: [110, 135], description: "Male, middle-aged, casual and natural" },
  { key: "george", name: "George", id: "JBFqnCBsd6RMkjVDRZzb", language: "en", gender: "male", pitchHz: [100, 125], description: "Male, middle-aged, warm and mature" },
  { key: "bill", name: "Bill", id: "pqHfZKP75CvOlQylNhV4", language: "en", gender: "male", pitchHz: [95, 120], description: "Male, older, mature and balanced" },
  { key: "brian", name: "Brian", id: "nPczCjzI2devNBz1zQrb", language: "en", gender: "male", pitchHz: [85, 110], description: "Male, middle-aged, deep and resonant" },
] as const satisfies readonly Voice[];
// Premade voices are English and keep an English accent in other languages. These ElevenLabs
// library voices are recorded by native speakers; their pitch bands span what VoiceProfiler
// measured on each voice's preview and on a Flash v2.5 sample.
export const NATIVE_VOICES = [
  { key: "fr-audia", name: "Audia", id: "lvQdCgwZfBuOzxyV5pxu", language: "fr", gender: "female", pitchHz: [225, 258], description: "Female, young, friendly and clear" },
  { key: "fr-lucie", name: "Lucie", id: "YxrwjAKoUKULGd0g8K9Y", language: "fr", gender: "female", pitchHz: [199, 219], description: "Female, adult, warm and natural" },
  { key: "fr-emilie", name: "Emilie", id: "d3AXX0BlgJHYFCuH9X88", language: "fr", gender: "female", pitchHz: [165, 212], description: "Female, adult, lively and expressive" },
  { key: "fr-ingrid", name: "Ingrid", id: "FFXYdAYPzn8Tw8KiHZqg", language: "fr", gender: "female", pitchHz: [165, 183], description: "Female, middle-aged, warm and calm" },
  { key: "fr-maxime", name: "Maxime", id: "ZLI7yULK3cOkcZl6GABN", language: "fr", gender: "male", pitchHz: [141, 169], description: "Male, young, clear and calm" },
  { key: "fr-marcel", name: "Marcel", id: "kENkNtk0xyzG09WW40xE", language: "fr", gender: "male", pitchHz: [134, 149], description: "Male, middle-aged, warm and conversational" },
  { key: "fr-hugo", name: "Hugo", id: "IbbR6Av0dWuQJS0b8JVT", language: "fr", gender: "male", pitchHz: [108, 119], description: "Male, young, warm and grounded" },
  { key: "fr-martin", name: "Martin", id: "b0Ev8lcOOXx2o9ZcF46H", language: "fr", gender: "male", pitchHz: [82, 95], description: "Male, mature, deep and calm" },
] as const satisfies readonly Voice[];
export type MatchVoice = (typeof MATCH_VOICES)[number] | (typeof NATIVE_VOICES)[number];
const ALL_VOICES: readonly MatchVoice[] = [...MATCH_VOICES, ...NATIVE_VOICES];
const center = (voice: MatchVoice) => (voice.pitchHz[0] + voice.pitchHz[1]) / 2;
function nearest(voices: readonly MatchVoice[], pitchHz: number) {
  let best = voices[0];
  for (const voice of voices)
    if (Math.abs(pitchHz - center(voice)) < Math.abs(pitchHz - center(best))) best = voice;
  return best;
}
// The voices that read `language` natively, or the English premade voices when none do.
export function matchVoices(language: string): readonly MatchVoice[] {
  const native = NATIVE_VOICES.filter((voice) => voice.language === language);
  return native.length ? native : MATCH_VOICES;
}
// Deterministic fallback when Jev is unavailable: the closest pitch band wins.
export function nearestMatchVoice(medianPitchHz: number, language = "en") {
  return nearest(matchVoices(language), medianPitchHz);
}
// The voice that reads `language` for a premade or native voice key. A voice meant for another
// language becomes the native one of the same gender and closest pitch.
export function speakingVoice(key: string, language: string) {
  const voice = ALL_VOICES.find((candidate) => candidate.key === key);
  if (!voice) return undefined;
  const voices = matchVoices(language);
  if (voices.includes(voice)) return voice;
  const alike = voices.filter((candidate) => voice.gender === "neutral" || candidate.gender === voice.gender);
  return nearest(alike.length ? alike : voices, center(voice));
}
