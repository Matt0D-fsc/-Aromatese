-- Migration: 010_audit_and_retention.sql
-- Description: Tier 1 of SCOPE.md. Two things that have been missing since the beginning:
--   1. A record of who did what. audit_logs was built in 001 to hold LLM grounding proof and has never been
--      written to; an actor and a detail blob let the same table also carry dashboard and admin actions.
--   2. A way to forget. Nothing has ever been deleted. Both functions return the storage paths they orphaned,
--      because SQL cannot remove objects from a Supabase bucket — the caller finishes the job over the API.

-- 1. AUDIT TRAIL
ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS detail JSONB;
-- Platform-level events (engine switched, merchant suspended) belong to no single shop.
ALTER TABLE audit_logs ALTER COLUMN tenant_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_logs_recent ON audit_logs (created_at DESC);

-- audit_logs_read from 003 is `is_tenant_member(tenant_id) OR is_platform_admin()`, and is_tenant_member(NULL)
-- is false, so platform-level rows are admin-only. Writes go through the service role, which bypasses RLS:
-- an actor must never be able to edit or delete their own trail.

-- 2. FORGET ONE CUSTOMER: their chats and media go, their identity is cleared, their orders stay.
-- A shop still needs its sales record, so orders keep their items and totals but lose the personal details.
-- SECURITY INVOKER: RLS decides whose customer this is, so a merchant can only erase their own.
CREATE OR REPLACE FUNCTION delete_customer_data(cid UUID) RETURNS SETOF TEXT
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE paths TEXT[];
BEGIN
  SELECT coalesce(array_agg(m.media_url), '{}') INTO paths
  FROM messages m JOIN conversations c ON c.id = m.conversation_id
  WHERE c.customer_id = cid AND m.media_url IS NOT NULL;

  DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE customer_id = cid);
  DELETE FROM conversations WHERE customer_id = cid;
  UPDATE orders SET shipping_address = jsonb_build_object('erased', TRUE) WHERE customer_id = cid;
  -- channel_user_id is part of a unique key and is how a returning visitor is recognised: scrambling it means
  -- the same browser starts a fresh, empty customer instead of walking back into the deleted one.
  UPDATE customers SET name = NULL, phone = NULL, channel_user_id = 'erased-' || id::TEXT WHERE id = cid;

  RETURN QUERY SELECT unnest(paths);
END $$;
REVOKE EXECUTE ON FUNCTION delete_customer_data(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION delete_customer_data(UUID) TO authenticated;

-- 3. RETENTION: drop chats nobody has touched in a long time. Orders and customers are untouched.
-- Platform-wide housekeeping, so service role only.
CREATE OR REPLACE FUNCTION purge_old_chats(days INT DEFAULT 180) RETURNS SETOF TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE paths TEXT[]; cutoff TIMESTAMPTZ := NOW() - make_interval(days => greatest(days, 1));
BEGIN
  SELECT coalesce(array_agg(m.media_url), '{}') INTO paths
  FROM messages m JOIN conversations c ON c.id = m.conversation_id
  WHERE c.last_message_at < cutoff AND m.media_url IS NOT NULL;

  DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE last_message_at < cutoff);
  DELETE FROM conversations WHERE last_message_at < cutoff;

  RETURN QUERY SELECT unnest(paths);
END $$;
REVOKE EXECUTE ON FUNCTION purge_old_chats(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION purge_old_chats(INT) TO service_role;
