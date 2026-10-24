import { and, desc, eq, inArray } from "drizzle-orm";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { NodePgTransaction } from "drizzle-orm/node-postgres";
import { ORPCError } from "@orpc/server";
import { MAX_DISCUSSIONS, MAX_DISCUSSION_MESSAGES } from "@interprete/shared/discussions";
import { z } from "zod";
import type * as schema from "../db/schema";
import { discussion, discussionMessage } from "../db/schema";
import { protectedProcedure } from "./base";
import { discussionSaveSchema } from "./discussions.schema";

type Tx = NodePgTransaction<typeof schema, ExtractTablesWithRelations<typeof schema>>;
type DiscussionSaveInput = z.infer<typeof discussionSaveSchema>;
type DiscussionMessageInput = DiscussionSaveInput["messages"][number];

const latestMessages = (messages: DiscussionMessageInput[]) => {
  const unique = new Map<string, DiscussionMessageInput>();
  for (const message of messages) {
    const previous = unique.get(message.id);
    if (!previous || message.updatedAt >= previous.updatedAt) unique.set(message.id, message);
  }
  return [...unique.values()];
};

const messageFields = (message: DiscussionMessageInput) => ({
  role: message.role,
  name: message.name,
  source: message.source,
  translation: message.translation,
  sourceLanguage: message.sourceLanguage,
  targetLanguage: message.targetLanguage,
  status: message.status,
  error: message.error,
  demo: message.demo,
  updatedAt: new Date(message.updatedAt),
});

const messageRow = (discussionId: string, message: DiscussionMessageInput) => ({
  id: message.id,
  discussionId,
  ...messageFields(message),
  spokenAt: new Date(message.spokenAt),
});

// Inserts the discussion, or refreshes its header when this write is at least as new.
async function upsertHeader(tx: Tx, userId: string, input: DiscussionSaveInput) {
  const [existing] = await tx
    .select({ userId: discussion.userId, updatedAt: discussion.updatedAt })
    .from(discussion)
    .where(eq(discussion.id, input.id));
  if (existing && existing.userId !== userId) throw new ORPCError("FORBIDDEN");
  const header = {
    title: input.title,
    callId: input.callId,
    updatedAt: new Date(input.updatedAt),
    closedAt: input.closedAt === null ? null : new Date(input.closedAt),
  };
  if (!existing) {
    await tx.insert(discussion).values({
      id: input.id,
      userId,
      kind: input.kind,
      startedAt: new Date(input.startedAt),
      ...header,
    });
    return;
  }
  if (input.updatedAt < existing.updatedAt.getTime()) return;
  await tx.update(discussion).set(header).where(and(
    eq(discussion.id, input.id),
    eq(discussion.userId, userId),
  ));
}

// Inserts unknown messages and updates those whose text is at least as new.
async function upsertMessages(tx: Tx, discussionId: string, incoming: DiscussionMessageInput[]) {
  const messages = latestMessages(incoming);
  if (!messages.length) return;
  const rows = await tx
    .select({
      id: discussionMessage.id,
      discussionId: discussionMessage.discussionId,
      updatedAt: discussionMessage.updatedAt,
    })
    .from(discussionMessage)
    .where(inArray(discussionMessage.id, messages.map((message) => message.id)));
  if (rows.some((row) => row.discussionId !== discussionId)) throw new ORPCError("FORBIDDEN");
  const known = new Map(rows.map((row) => [row.id, row.updatedAt.getTime()]));
  const fresh = messages.filter((message) => !known.has(message.id));
  const newer = messages.filter((message) => {
    const updatedAt = known.get(message.id);
    return updatedAt !== undefined && message.updatedAt >= updatedAt;
  });
  if (fresh.length)
    await tx.insert(discussionMessage).values(fresh.map((message) => messageRow(discussionId, message)));
  for (const message of newer)
    await tx.update(discussionMessage).set(messageFields(message)).where(and(
      eq(discussionMessage.id, message.id),
      eq(discussionMessage.discussionId, discussionId),
    ));
}

// Keeps the most recently spoken messages for one discussion.
async function trimMessages(tx: Tx, discussionId: string) {
  const overflow = await tx
    .select({ id: discussionMessage.id })
    .from(discussionMessage)
    .where(eq(discussionMessage.discussionId, discussionId))
    .orderBy(desc(discussionMessage.spokenAt))
    .offset(MAX_DISCUSSION_MESSAGES);
  if (!overflow.length) return;
  await tx.delete(discussionMessage).where(inArray(discussionMessage.id, overflow.map((row) => row.id)));
}

// Keeps every open discussion, then the newest closed ones, up to the shared cap.
async function trimDiscussions(tx: Tx, userId: string) {
  const owned = await tx
    .select({ id: discussion.id, closedAt: discussion.closedAt })
    .from(discussion)
    .where(eq(discussion.userId, userId))
    .orderBy(desc(discussion.updatedAt));
  const open = owned.filter((row) => row.closedAt === null);
  const room = Math.max(0, MAX_DISCUSSIONS - open.length);
  const drop = owned.filter((row) => row.closedAt !== null).slice(room);
  if (!drop.length) return;
  await tx.delete(discussion).where(and(
    eq(discussion.userId, userId),
    inArray(discussion.id, drop.map((row) => row.id)),
  ));
}

export const save = protectedProcedure
  .input(discussionSaveSchema)
  .output(z.strictObject({ id: z.string() }))
  .handler(async ({ context, input }) => {
    await context.db.transaction(async (tx) => {
      await upsertHeader(tx, context.user.id, input);
      if (input.messages.length) {
        await upsertMessages(tx, input.id, input.messages);
        await trimMessages(tx, input.id);
      }
      await trimDiscussions(tx, context.user.id);
    });
    return { id: input.id };
  });
