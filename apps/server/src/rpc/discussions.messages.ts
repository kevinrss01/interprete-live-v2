import { MAX_DISCUSSION_MESSAGES } from "@interprete/shared/discussions";
import { asc, eq, and } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { discussion, discussionMessage } from "../db/schema";
import { protectedProcedure } from "./base";
import { discussionIdSchema, discussionMessageSchema } from "./discussions.schema";

export const messages = protectedProcedure
  .input(discussionIdSchema)
  .output(discussionMessageSchema.array())
  .handler(async ({ context, input }) => {
    const [owned] = await context.db
      .select({ id: discussion.id })
      .from(discussion)
      .where(and(eq(discussion.id, input.id), eq(discussion.userId, context.user.id)));
    if (!owned) throw new ORPCError("NOT_FOUND");
    const rows = await context.db
      .select()
      .from(discussionMessage)
      .where(eq(discussionMessage.discussionId, input.id))
      .orderBy(asc(discussionMessage.spokenAt), asc(discussionMessage.id))
      .limit(MAX_DISCUSSION_MESSAGES);
    return rows.flatMap((row) => {
      if (row.role !== "you" && row.role !== "them") return [];
      if (row.status !== "draft" && row.status !== "working" && row.status !== "done" && row.status !== "error")
        return [];
      return [{
        id: row.id,
        role: row.role,
        name: row.name,
        source: row.source,
        translation: row.translation,
        sourceLanguage: row.sourceLanguage,
        targetLanguage: row.targetLanguage,
        status: row.status,
        error: row.error,
        demo: row.demo,
        spokenAt: row.spokenAt.getTime(),
        updatedAt: row.updatedAt.getTime(),
      }];
    });
  });
