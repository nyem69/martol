DROP INDEX "idx_terms_acceptances_version";--> statement-breakpoint
CREATE UNIQUE INDEX "idx_terms_acceptances_user_version" ON "terms_acceptances" USING btree ("user_id","terms_version_id");