import { and, eq } from "drizzle-orm";
import { discussion } from "../db/schema";
import { protectedProcedure } from "./base";
import { discussionIdSchema } from "./discussions.schema";
import { z } from "zod";

export const remove = protectedProcedure
  .input(discussionIdSchema)
  .output(z.strictObject({ id: z.string() }))
  .handler(async ({ context, input }) => {
    await context.db
      .delete(discussion)
      .where(and(eq(discussion.id, input.id), eq(discussion.userId, context.user.id)));
    return { id: input.id };
  });
