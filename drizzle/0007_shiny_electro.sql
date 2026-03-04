DROP INDEX "idx_attachments_message_id";--> statement-breakpoint
DROP INDEX "idx_attachments_org_message";--> statement-breakpoint
ALTER TABLE "attachments" DROP COLUMN "message_id";