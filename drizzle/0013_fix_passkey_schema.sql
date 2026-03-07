-- Fix passkey table schema to match Better Auth passkey plugin v1.5.x
-- Renames webauthnUserID → credentialID and adds aaguid column.
-- No data loss: no passkeys have been successfully registered yet.

ALTER TABLE "passkey" RENAME COLUMN "webauthnUserID" TO "credentialID";
ALTER TABLE "passkey" ADD COLUMN "aaguid" text;
