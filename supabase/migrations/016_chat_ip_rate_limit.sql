-- Migration: 016_chat_ip_rate_limit.sql
-- Description: The public chat's only per-visitor limit was per browser cookie, and clearing cookies starts a
-- fresh visitor. One person could spend a shop's whole monthly message allowance in minutes and leave its AI
-- silent until next month. Customer messages now carry a salted hash of the sender's IP (never the IP itself),
-- so the chat route can also limit per connection.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS client_ip_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_messages_ip_recent ON messages (tenant_id, client_ip_hash, created_at DESC)
  WHERE sender_type = 'customer' AND client_ip_hash IS NOT NULL;
