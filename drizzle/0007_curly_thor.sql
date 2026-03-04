CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"stripe_subscription_id" text,
	"plan" text DEFAULT 'free' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"founding_member" integer DEFAULT 0 NOT NULL,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_subscriptions_org" ON "subscriptions" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_subscriptions_stripe_customer" ON "subscriptions" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE INDEX "idx_subscriptions_stripe_sub" ON "subscriptions" USING btree ("stripe_subscription_id");