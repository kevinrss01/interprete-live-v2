import { z } from "zod";
import { LANGUAGES } from "@interprete/shared/languages";
import { AppError } from "./errors";
export const languageSchema = z
  .string()
  .refine((x) => LANGUAGES.some((l) => l.code === x), "Language not available");
export const interpretSchema = z
  .object({
    text: z.string().trim().min(1).max(4000),
    sourceLanguage: languageSchema,
    targetLanguage: languageSchema,
    speaker: z.enum(["a", "b"]),
    voice: z.string().min(1).max(1000),
    isFinal: z.boolean(),
    // Captions only need the translated text (false); skipping synthesis saves time and voice credits.
    speak: z.boolean().optional(),
    followingText: z.string().max(512).default(""),
    context: z
      .array(
        z.object({
          source: z.string().max(1500),
          translation: z.string().max(1500),
          sourceLanguage: z.string().max(5),
          targetLanguage: z.string().max(5),
          continuation: z.boolean().optional(),
        }),
      )
      .max(6)
      .default([]),
  })
  .refine(
    (x) => x.sourceLanguage !== x.targetLanguage,
    "The two languages must be different.",
  );
export const voiceMatchSchema = z.object({
  language: languageSchema,
  features: z.object({
    medianPitchHz: z.number().min(50).max(500),
    pitchRangeSemitones: z.number().min(0).max(36),
    brightness: z.number().min(0).max(1),
    voicedSeconds: z.number().min(0.2).max(120),
  }),
});
export async function bodyJson(request: { text(): Promise<string> }) {
  const text = await request.text();
  if (text.length > 25000)
    throw new AppError("PAYLOAD", "This sentence is too long.", 413);
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("PAYLOAD", "The request could not be read.");
  }
}
export function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success)
    throw new AppError(
      "VALIDATION",
      result.error.issues[0]?.message || "Check the information you entered.",
    );
  return result.data;
}
