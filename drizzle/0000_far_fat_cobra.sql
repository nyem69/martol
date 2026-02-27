CREATE TABLE "agent_cursors" (
	"org_id" text NOT NULL,
	"agent_user_id" text NOT NULL,
	"last_read_id" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_room_bindings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"agent_user_id" text NOT NULL,
	"label" text NOT NULL,
	"model" text NOT NULL,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"message_id" bigint NOT NULL,
	"org_id" text NOT NULL,
	"filename" text NOT NULL,
	"r2_key" text NOT NULL,
	"content_type" text,
	"size_bytes" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"sender_id" text NOT NULL,
	"sender_role" text NOT NULL,
	"type" text DEFAULT 'chat' NOT NULL,
	"body" text NOT NULL,
	"reply_to" bigint,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_actions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"trigger_message_id" bigint NOT NULL,
	"requested_by" text NOT NULL,
	"requested_role" text NOT NULL,
	"agent_user_id" text NOT NULL,
	"action_type" text NOT NULL,
	"risk_level" text NOT NULL,
	"description" text NOT NULL,
	"payload_json" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"executed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "read_cursors" (
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"last_read_message_id" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_audit" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"changed_by" text NOT NULL,
	"target_user" text NOT NULL,
	"old_role" text,
	"new_role" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "todos" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"message_id" bigint NOT NULL,
	"org_id" text NOT NULL,
	"status" text DEFAULT 'todo' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_cursors_pkey" ON "agent_cursors" USING btree ("org_id","agent_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_agent_room_bindings_org_label" ON "agent_room_bindings" USING btree ("org_id","label");--> statement-breakpoint
CREATE INDEX "idx_messages_org_id" ON "messages" USING btree ("org_id","id");--> statement-breakpoint
CREATE INDEX "idx_messages_org_sender" ON "messages" USING btree ("org_id","sender_id","id");--> statement-breakpoint
CREATE INDEX "idx_pending_actions_org_status" ON "pending_actions" USING btree ("org_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "read_cursors_pkey" ON "read_cursors" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_role_audit_org" ON "role_audit" USING btree ("org_id","created_at");