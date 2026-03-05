-- Append-only guard for messages table
-- Allows: INSERT (always), UPDATE only on deleted_at column (soft delete), DELETE never
-- This backs up the "append-only audit log" claim with DB-level enforcement.

CREATE OR REPLACE FUNCTION prevent_message_mutation()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Messages cannot be deleted — use soft delete (deleted_at) instead';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        -- Allow soft-delete: only deleted_at may change
        IF OLD.id != NEW.id
            OR OLD.org_id != NEW.org_id
            OR OLD.sender_id != NEW.sender_id
            OR OLD.sender_role != NEW.sender_role
            OR OLD.type != NEW.type
            OR OLD.body != NEW.body
            OR OLD.reply_to IS DISTINCT FROM NEW.reply_to
            OR OLD.created_at != NEW.created_at
        THEN
            RAISE EXCEPTION 'Messages are append-only — only deleted_at can be updated';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_messages_append_only ON messages;

CREATE TRIGGER trg_messages_append_only
    BEFORE UPDATE OR DELETE ON messages
    FOR EACH ROW
    EXECUTE FUNCTION prevent_message_mutation();
