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
ALTER TABLE "apikey" RENAME COLUMN "userId" TO "referenceId";--> statement-breakpoint
ALTER TABLE "apikey" DROP CONSTRAINT "apikey_userId_user_id_fk";
--> statement-breakpoint
ALTER TABLE "apikey" ADD COLUMN "configId" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apikey" ADD CONSTRAINT "apikey_referenceId_user_id_fk" FOREIGN KEY ("referenceId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;