export const MODELS = {
  transcription: "gpt-live-transcribe",
  translation: "gpt-5.4-nano",
  decision: "typesafe-ai/jev-1.14.0",
  speech: "eleven_flash_v2_5",
} as const;
export function credential(name: "openai" | "eleven" | "gateway" | "session") {
  const value =
    name === "openai"
      ? process.env.INTERPRETER_OPENAI_API_KEY || process.env.OPENAI_API_KEY
      : name === "eleven"
        ? process.env.ELEVENLABS_API_KEY
        : name === "gateway"
          ? process.env.AI_GATEWAY_API_KEY
          : process.env.SESSION_SECRET;
  if (!value) throw new Error("SERVICE_NOT_CONFIGURED");
  return value;
}
export function configurationStatus() {
  return {
    transcription: Boolean(
      process.env.INTERPRETER_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
    ),
    voice: Boolean(process.env.ELEVENLABS_API_KEY),
    decision: Boolean(process.env.AI_GATEWAY_API_KEY),
  };
}
