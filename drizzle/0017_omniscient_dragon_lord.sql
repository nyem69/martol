CREATE TABLE "ingestion_jobs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"attachment_id" bigint NOT NULL,
	"org_id" text NOT NULL,
	"job_type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "parser_name" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "parser_version" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "extracted_text_bytes" bigint;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "extraction_error_code" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "extracted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "indexed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "content_sha256" text;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "page_start" integer;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "page_end" integer;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "char_start" integer;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "char_end" integer;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "chunk_hash" text;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "embedding_dim" integer;--> statement-breakpoint
ALTER TABLE "ingestion_jobs" ADD CONSTRAINT "ingestion_jobs_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_jobs" ADD CONSTRAINT "ingestion_jobs_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ingestion_jobs_attachment" ON "ingestion_jobs" USING btree ("attachment_id");--> statement-breakpoint
CREATE INDEX "idx_ingestion_jobs_status" ON "ingestion_jobs" USING btree ("status","created_at");