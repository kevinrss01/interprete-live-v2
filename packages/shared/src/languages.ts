export const LANGUAGES = [
  { code: "fr", name: "Français", native: "Français" },
  { code: "en", name: "Anglais", native: "English" },
  { code: "es", name: "Espagnol", native: "Español" },
  { code: "de", name: "Allemand", native: "Deutsch" },
  { code: "it", name: "Italien", native: "Italiano" },
  { code: "pt", name: "Portugais", native: "Português" },
  { code: "nl", name: "Néerlandais", native: "Nederlands" },
  { code: "ja", name: "Japonais", native: "日本語" },
  { code: "ko", name: "Coréen", native: "한국어" },
  { code: "zh", name: "Chinois", native: "中文" },
  { code: "ar", name: "Arabe", native: "العربية" },
  { code: "hi", name: "Hindi", native: "हिन्दी" },
  { code: "pl", name: "Polonais", native: "Polski" },
  { code: "ru", name: "Russe", native: "Русский" },
  { code: "sv", name: "Suédois", native: "Svenska" },
  { code: "tr", name: "Turc", native: "Türkçe" },
  { code: "uk", name: "Ukrainien", native: "Українська" },
  { code: "vi", name: "Vietnamien", native: "Tiếng Việt" },
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
    description: "Claire et douce",
    id: "EXAVITQu4vr4xnSDxMaL",
  },
  {
    key: "george",
    name: "George",
    description: "Chaleureuse et grave",
    id: "JBFqnCBsd6RMkjVDRZzb",
  },
  {
    key: "river",
    name: "River",
    description: "Souple et naturelle",
    id: "SAz9YHcvj6GT2YYXdXww",
  },
] as const;
