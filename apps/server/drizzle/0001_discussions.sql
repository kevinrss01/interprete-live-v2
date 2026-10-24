CREATE TABLE "discussion" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"call_id" text,
	"started_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "discussion_kind" CHECK ("discussion"."kind" in ('conversation', 'call'))
);
--> statement-breakpoint
CREATE TABLE "discussion_message" (
	"id" text PRIMARY KEY NOT NULL,
	"discussion_id" text NOT NULL,
	"role" text NOT NULL,
	"name" text NOT NULL,
	"source" text NOT NULL,
	"translation" text NOT NULL,
	"source_language" text NOT NULL,
	"target_language" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"demo" boolean DEFAULT false NOT NULL,
	"spoken_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "discussion_message_role" CHECK ("discussion_message"."role" in ('you', 'them')),
	CONSTRAINT "discussion_message_status" CHECK ("discussion_message"."status" in ('draft', 'working', 'done', 'error'))
);
--> statement-breakpoint
ALTER TABLE "discussion" ADD CONSTRAINT "discussion_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discussion_message" ADD CONSTRAINT "discussion_message_discussion_id_discussion_id_fk" FOREIGN KEY ("discussion_id") REFERENCES "public"."discussion"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discussion_user_updated_idx" ON "discussion" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "discussion_message_discussion_spoken_idx" ON "discussion_message" USING btree ("discussion_id","spoken_at");