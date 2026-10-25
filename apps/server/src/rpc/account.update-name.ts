import { eq } from "drizzle-orm";
import { z } from "zod";
import { user } from "../db/schema";
import { protectedProcedure } from "./base";

// Only the name can change; strictObject rejects any other field, such as email.
export const updateName = protectedProcedure
  .input(z.strictObject({ name: z.string().trim().min(1).max(64) }))
  .output(z.object({ name: z.string() }))
  .handler(async ({ context, input }) => {
    const [value] = await context.db.update(user)
      .set({ name: input.name })
      .where(eq(user.id, context.user.id))
      .returning({ name: user.name });
    return value;
  });
