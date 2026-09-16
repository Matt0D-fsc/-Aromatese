-- Migration: 006_human_takeover.sql
-- Description: Human takeover of AI chats: handoff flags on conversations, which staff member sent a message,
-- and a composite foreign key so a message can never point at another shop's conversation.

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS needs_human BOOLEAN NOT NULL DEFAULT FALSE,   -- AI asked for a person
  ADD COLUMN IF NOT EXISTS handoff_reason TEXT,
  ADD COLUMN IF NOT EXISTS handoff_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS taken_over_at TIMESTAMPTZ,                     -- ai_muted stays the single "AI off" switch
  ADD COLUMN IF NOT EXISTS last_staff_reply_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_conversations_needs_human ON conversations(tenant_id) WHERE needs_human;

ALTER TABLE messages ADD COLUMN IF NOT EXISTS sent_by UUID REFERENCES profiles(id) ON DELETE SET NULL;

-- RLS checks tenant_id on a message, not that its conversation belongs to the same shop. This does.
ALTER TABLE conversations ADD CONSTRAINT conversations_id_tenant_key UNIQUE (id, tenant_id);
ALTER TABLE messages ADD CONSTRAINT messages_conversation_same_tenant
  FOREIGN KEY (conversation_id, tenant_id) REFERENCES conversations(id, tenant_id) ON DELETE CASCADE;
