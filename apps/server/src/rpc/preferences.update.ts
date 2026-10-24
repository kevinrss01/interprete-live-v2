import { userPreferences } from "../db/schema";
import { protectedProcedure } from "./base";
import { preferencesSchema } from "./preferences.schema";

export const update = protectedProcedure
  .input(preferencesSchema)
  .output(preferencesSchema)
  .handler(async ({ context, input }) => {
    const [value] = await context.db.insert(userPreferences)
      .values({ userId: context.user.id, ...input })
      .onConflictDoUpdate({ target: userPreferences.userId, set: input })
      .returning({
        sourceLanguage: userPreferences.sourceLanguage,
        targetLanguage: userPreferences.targetLanguage,
      });
    return value;
  });
