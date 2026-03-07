ALTER TABLE "attachments" ALTER COLUMN "message_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ALTER COLUMN "content_type" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ALTER COLUMN "size_bytes" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "uploaded_by" text NOT NULL;--> statement-breakpoint
ALTER TABLE "pending_actions" ADD COLUMN "simulation_type" text;--> statement-breakpoint
ALTER TABLE "pending_actions" ADD COLUMN "simulation_payload" jsonb;--> statement-breakpoint
ALTER TABLE "pending_actions" ADD COLUMN "risk_factors" jsonb;--> statement-breakpoint
ALTER TABLE "pending_actions" ADD COLUMN "estimated_impact" jsonb;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "twoFactorEnabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_attachments_r2_key" ON "attachments" USING btree ("r2_key");--> statement-breakpoint
CREATE INDEX "idx_attachments_org_uploaded_by" ON "attachments" USING btree ("org_id","uploaded_by");