ALTER TABLE "room_config" ADD COLUMN "rag_provider" text DEFAULT 'workers_ai' NOT NULL;--> statement-breakpoint
ALTER TABLE "room_config" ADD COLUMN "rag_base_url" text;--> statement-breakpoint
ALTER TABLE "room_config" ADD COLUMN "rag_api_key_id" text;--> statement-breakpoint
ALTER TABLE "room_config" ADD CONSTRAINT "chk_rag_provider" CHECK (rag_provider IN ('workers_ai', 'openai'));