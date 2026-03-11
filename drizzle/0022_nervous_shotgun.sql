CREATE TABLE "test_account_credentials" (
	"user_id" text PRIMARY KEY NOT NULL,
	"password_hash" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "test_account_credentials" ADD CONSTRAINT "test_account_credentials_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;