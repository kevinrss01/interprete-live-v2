import { z } from "zod";
import { MAX_DISCUSSION_TEXT } from "@interprete/shared/discussions";
import { languageSchema } from "../lib/validation";

const idSchema = z.string().trim().min(1).max(80);
const instantSchema = z.number().int().nonnegative().max(8_640_000_000_000_000);

export const discussionMessageSchema = z.strictObject({
  id: idSchema,
  role: z.enum(["you", "them"]),
  name: z.string().trim().min(1).max(80),
  source: z.string().max(MAX_DISCUSSION_TEXT),
  translation: z.string().max(MAX_DISCUSSION_TEXT),
  sourceLanguage: languageSchema,
  targetLanguage: languageSchema,
  status: z.enum(["draft", "working", "done", "error"]),
  error: z.string().max(500).nullable(),
  demo: z.boolean(),
  spokenAt: instantSchema,
  updatedAt: instantSchema,
});

export const discussionSaveSchema = z.strictObject({
  id: idSchema,
  kind: z.enum(["conversation", "call"]),
  title: z.string().trim().min(1).max(80),
  callId: z.string().trim().min(1).max(200).nullable(),
  startedAt: instantSchema,
  updatedAt: instantSchema,
  closedAt: instantSchema.nullable(),
  messages: z.array(discussionMessageSchema).max(20),
});

export const discussionHeaderSchema = z.strictObject({
  id: idSchema,
  kind: z.enum(["conversation", "call"]),
  title: z.string(),
  callId: z.string().nullable(),
  startedAt: instantSchema,
  updatedAt: instantSchema,
  closedAt: instantSchema.nullable(),
  messageCount: z.number().int().nonnegative(),
});

export const discussionIdSchema = z.strictObject({ id: idSchema });
