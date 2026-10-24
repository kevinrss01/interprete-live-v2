import { z } from "zod";
import { LANGUAGES } from "@interprete/shared/languages";
import { AppError } from "./errors";
export const languageSchema = z
  .string()
  .refine((x) => LANGUAGES.some((l) => l.code === x), "Langue non disponible");
export const interpretSchema = z
  .object({
    text: z.string().trim().min(1).max(4000),
    sourceLanguage: languageSchema,
    targetLanguage: languageSchema,
    speaker: z.enum(["a", "b"]),
    voice: z.string().min(1).max(1000),
    isFinal: z.boolean(),
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
    "Les deux langues doivent être différentes.",
  );
export async function bodyJson(request: { text(): Promise<string> }) {
  const text = await request.text();
  if (text.length > 25000)
    throw new AppError("PAYLOAD", "Cette phrase est trop longue.", 413);
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("PAYLOAD", "La demande est illisible.");
  }
}
export function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success)
    throw new AppError(
      "VALIDATION",
      result.error.issues[0]?.message || "Vérifie les informations saisies.",
    );
  return result.data;
}
