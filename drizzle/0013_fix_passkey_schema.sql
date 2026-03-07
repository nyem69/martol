-- Fix passkey table schema to match Better Auth passkey plugin v1.5.x
-- Renames webauthnUserID → credentialID and adds aaguid column.
-- Idempotent: safe to run if already applied.

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'passkey' AND column_name = 'webauthnUserID'
  ) THEN
    ALTER TABLE "passkey" RENAME COLUMN "webauthnUserID" TO "credentialID";
  END IF;
END $$;

ALTER TABLE "passkey" ADD COLUMN IF NOT EXISTS "aaguid" text;
