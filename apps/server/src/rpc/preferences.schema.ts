import { z } from "zod";
import { languageSchema } from "../lib/validation";

export const preferencesSchema = z.strictObject({
  sourceLanguage: languageSchema,
  targetLanguage: languageSchema,
}).refine((value) => value.sourceLanguage !== value.targetLanguage, {
  message: "The two languages must be different.",
});
