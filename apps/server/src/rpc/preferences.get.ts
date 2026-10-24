import { eq } from "drizzle-orm";
import { userPreferences } from "../db/schema";
import { protectedProcedure } from "./base";
import { preferencesSchema } from "./preferences.schema";

export const get = protectedProcedure
  .output(preferencesSchema.nullable())
  .handler(async ({ context }) => {
    const [value] = await context.db.select({
      sourceLanguage: userPreferences.sourceLanguage,
      targetLanguage: userPreferences.targetLanguage,
    }).from(userPreferences).where(eq(userPreferences.userId, context.user.id));
    return value ?? null;
  });
