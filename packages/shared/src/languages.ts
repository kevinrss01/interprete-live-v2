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
// Premade voices a call participant can be matched to. A match only borrows the
// participant's measured pitch and timbre; nothing about their voice is cloned or stored.
export const MATCH_VOICES = [
  { key: "jessica", name: "Jessica", id: "cgSgspJ2msm6clMCkdW9", pitchHz: [215, 260], description: "Female, young, bright and playful" },
  { key: "laura", name: "Laura", id: "FGY2WhTYpPnrIDTdsKH5", pitchHz: [205, 245], description: "Female, young, upbeat and enthusiastic" },
  { key: "sarah", name: "Sarah", id: "EXAVITQu4vr4xnSDxMaL", pitchHz: [190, 220], description: "Female, young adult, warm and confident" },
  { key: "matilda", name: "Matilda", id: "XrExE9yKIg1WjnnlVkGX", pitchHz: [172, 198], description: "Female, middle-aged, professional alto" },
  { key: "lily", name: "Lily", id: "pFZP5JQG7iQjIQuC4Bku", pitchHz: [165, 190], description: "Female, middle-aged, velvety and calm" },
  { key: "river", name: "River", id: "SAz9YHcvj6GT2YYXdXww", pitchHz: [148, 172], description: "Gender-neutral, relaxed and calm" },
  { key: "liam", name: "Liam", id: "TX3LPaxmHKxFdv7VOQHJ", pitchHz: [130, 155], description: "Male, young, energetic" },
  { key: "eric", name: "Eric", id: "cjVigY5qzO86Huf0OWal", pitchHz: [120, 145], description: "Male, in his 40s, smooth tenor" },
  { key: "chris", name: "Chris", id: "iP95p4xoKVk53GoZ742B", pitchHz: [110, 135], description: "Male, middle-aged, casual and natural" },
  { key: "george", name: "George", id: "JBFqnCBsd6RMkjVDRZzb", pitchHz: [100, 125], description: "Male, middle-aged, warm and mature" },
  { key: "bill", name: "Bill", id: "pqHfZKP75CvOlQylNhV4", pitchHz: [95, 120], description: "Male, older, mature and balanced" },
  { key: "brian", name: "Brian", id: "nPczCjzI2devNBz1zQrb", pitchHz: [85, 110], description: "Male, middle-aged, deep and resonant" },
] as const;
export type MatchVoiceKey = (typeof MATCH_VOICES)[number]["key"];
// Deterministic fallback when Jev is unavailable: the closest pitch band wins.
export function nearestMatchVoice(medianPitchHz: number) {
  let best: (typeof MATCH_VOICES)[number] = MATCH_VOICES[5];
  let distance = Infinity;
  for (const voice of MATCH_VOICES) {
    const [low, high] = voice.pitchHz;
    const gap = Math.abs(medianPitchHz - (low + high) / 2);
    if (gap < distance) {
      best = voice;
      distance = gap;
    }
  }
  return best;
}
