CREATE TABLE "user_voice" (
	"user_id" text PRIMARY KEY NOT NULL,
	"voice_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_voice" ADD CONSTRAINT "user_voice_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;