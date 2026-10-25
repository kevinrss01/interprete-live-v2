import { sql } from "drizzle-orm";
import { boolean, check, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  token: text("token").notNull().unique(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [index("session_user_id_idx").on(table.userId)]);

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [index("account_user_id_idx").on(table.userId)]);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [index("verification_identifier_idx").on(table.identifier)]);

export const userPreferences = pgTable("user_preferences", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  sourceLanguage: text("source_language").notNull(),
  targetLanguage: text("target_language").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  check("different_languages", sql`${table.sourceLanguage} <> ${table.targetLanguage}`),
]);

// A discussion belongs to one account. Text only: playback audio is never stored.
export const discussion = pgTable("discussion", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  callId: text("call_id"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
}, (table) => [
  index("discussion_user_updated_idx").on(table.userId, table.updatedAt),
  check("discussion_kind", sql`${table.kind} in ('conversation', 'call')`),
]);

export const discussionMessage = pgTable("discussion_message", {
  id: text("id").primaryKey(),
  discussionId: text("discussion_id").notNull().references(() => discussion.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  name: text("name").notNull(),
  source: text("source").notNull(),
  translation: text("translation").notNull(),
  sourceLanguage: text("source_language").notNull(),
  targetLanguage: text("target_language").notNull(),
  status: text("status").notNull(),
  error: text("error"),
  demo: boolean("demo").notNull().default(false),
  spokenAt: timestamp("spoken_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => [
  index("discussion_message_discussion_spoken_idx").on(table.discussionId, table.spokenAt),
  check("discussion_message_role", sql`${table.role} in ('you', 'them')`),
  check("discussion_message_status", sql`${table.status} in ('draft', 'working', 'done', 'error')`),
]);

// The account's cloned voice (speaker A): only the ElevenLabs id, never the recording.
// The desktop gets a grant bound to its current device session through voice.get.
export const userVoice = pgTable("user_voice", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  voiceId: text("voice_id").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
