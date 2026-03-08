CREATE TABLE "ai_usage" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"operation" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"period_start" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_chunks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"attachment_id" bigint NOT NULL,
	"org_id" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"vector_id" text NOT NULL,
	"token_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "processing_status" text DEFAULT 'skipped' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "storage_bytes_used" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "ai_overage_cap_cents" integer DEFAULT 5000 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_ai_usage_org_op_period" ON "ai_usage" USING btree ("org_id","operation","period_start");--> statement-breakpoint
CREATE INDEX "idx_doc_chunks_attachment" ON "document_chunks" USING btree ("attachment_id");--> statement-breakpoint
CREATE INDEX "idx_doc_chunks_org" ON "document_chunks" USING btree ("org_id");