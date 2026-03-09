CREATE TABLE "project_brief" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"content" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_pb_status" CHECK (status IN ('active', 'archived'))
);
--> statement-breakpoint
ALTER TABLE "project_brief" ADD CONSTRAINT "project_brief_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_brief" ADD CONSTRAINT "project_brief_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_project_brief_org_active" ON "project_brief" USING btree ("org_id") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "idx_project_brief_org_version" ON "project_brief" USING btree ("org_id","version");