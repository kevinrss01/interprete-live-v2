import { MAX_DISCUSSIONS } from "@interprete/shared/discussions";
import { count, desc, eq } from "drizzle-orm";
import { discussion, discussionMessage } from "../db/schema";
import { protectedProcedure } from "./base";
import { discussionHeaderSchema } from "./discussions.schema";

export const list = protectedProcedure
  .output(discussionHeaderSchema.array())
  .handler(async ({ context }) => {
    const rows = await context.db
      .select({
        id: discussion.id,
        kind: discussion.kind,
        title: discussion.title,
        callId: discussion.callId,
        startedAt: discussion.startedAt,
        updatedAt: discussion.updatedAt,
        closedAt: discussion.closedAt,
        messageCount: count(discussionMessage.id),
      })
      .from(discussion)
      .leftJoin(discussionMessage, eq(discussionMessage.discussionId, discussion.id))
      .where(eq(discussion.userId, context.user.id))
      .groupBy(discussion.id)
      .orderBy(desc(discussion.updatedAt))
      .limit(MAX_DISCUSSIONS);
    return rows.flatMap((row) => {
      if (row.kind !== "conversation" && row.kind !== "call") return [];
      return [{
        id: row.id,
        kind: row.kind,
        title: row.title,
        callId: row.callId,
        startedAt: row.startedAt.getTime(),
        updatedAt: row.updatedAt.getTime(),
        closedAt: row.closedAt?.getTime() ?? null,
        messageCount: Number(row.messageCount),
      }];
    });
  });
