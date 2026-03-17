CREATE TABLE "room_config" (
	"org_id" text PRIMARY KEY NOT NULL,
	"rag_enabled" boolean DEFAULT false NOT NULL,
	"rag_model" text DEFAULT '@cf/meta/llama-3.1-8b-instruct' NOT NULL,
	"rag_temperature" real DEFAULT 0.3 NOT NULL,
	"rag_max_tokens" integer DEFAULT 2048 NOT NULL,
	"rag_trigger" text DEFAULT 'explicit' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "chk_rag_trigger" CHECK (rag_trigger IN ('explicit', 'always'))
);
--> statement-breakpoint
ALTER TABLE "room_config" ADD CONSTRAINT "room_config_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_config" ADD CONSTRAINT "room_config_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;