-- Migration: 020_platform_message_dedup.sql
-- Description: Makes a retried Meta delivery a duplicate instead of a second message.
--   Meta retries any webhook it does not get a quick 2xx for, and can have two retries of the same delivery
--   in flight at once — so checking for the message id before inserting would let both through and answer the
--   customer twice. The unique index is the check: the second insert fails, and lib/inbound reads that as a
--   duplicate and stops.
--   Partial, because web chat messages have no platform id and there are many of them.

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_platform_message
  ON messages (tenant_id, platform_message_id)
  WHERE platform_message_id IS NOT NULL;
