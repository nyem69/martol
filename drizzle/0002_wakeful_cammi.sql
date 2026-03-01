ALTER TABLE "user" ADD COLUMN "username" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "displayName" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ageVerifiedAt" timestamp;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_user_username" ON "user" USING btree ("username");--> statement-breakpoint
CREATE TABLE "username_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"old_username" text NOT NULL,
	"new_username" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "idx_username_history_user" ON "username_history" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_username_history_old" ON "username_history" USING btree ("old_username");--> statement-breakpoint
CREATE TABLE "terms_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"type" text NOT NULL,
	"summary" text NOT NULL,
	"url" text NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "terms_versions_version_unique" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE "terms_acceptances" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"terms_version_id" integer NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_terms_acceptances_user" ON "terms_acceptances" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_terms_acceptances_version" ON "terms_acceptances" USING btree ("terms_version_id");--> statement-breakpoint
CREATE TABLE "account_audit" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"action" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_account_audit_user" ON "account_audit" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_account_audit_action" ON "account_audit" USING btree ("action","created_at");--> statement-breakpoint
CREATE TABLE "content_reports" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"message_id" bigint,
	"reporter_id" text NOT NULL,
	"reason" text NOT NULL,
	"details" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"action_taken" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_content_reports_org" ON "content_reports" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "idx_content_reports_message" ON "content_reports" USING btree ("message_id");--> statement-breakpoint
CREATE TABLE "user_sanctions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"sanction_type" text NOT NULL,
	"reason" text NOT NULL,
	"report_id" bigint,
	"issued_by" text NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_user_sanctions_user" ON "user_sanctions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_user_sanctions_active" ON "user_sanctions" USING btree ("user_id","sanction_type");--> statement-breakpoint
CREATE TABLE "twoFactor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backupCodes" text NOT NULL,
	"userId" text NOT NULL,
	"createdAt" timestamp,
	"updatedAt" timestamp
);
--> statement-breakpoint
ALTER TABLE "twoFactor" ADD CONSTRAINT "twoFactor_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "passkey" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"publicKey" text NOT NULL,
	"userId" text NOT NULL,
	"webauthnUserID" text NOT NULL,
	"counter" integer NOT NULL,
	"deviceType" text NOT NULL,
	"backedUp" boolean NOT NULL,
	"transports" text,
	"createdAt" timestamp
);
--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;