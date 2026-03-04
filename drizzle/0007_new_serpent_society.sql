DROP INDEX "idx_subscriptions_user";--> statement-breakpoint
CREATE UNIQUE INDEX "idx_subscriptions_user" ON "subscriptions" USING btree ("user_id");