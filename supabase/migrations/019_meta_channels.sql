-- Migration: 019_meta_channels.sql
-- Description: Facebook Messenger and Instagram accounts a merchant has connected.
--   One row per connected Page (Messenger) or Instagram professional account. Meta sends every merchant's
--   messages to one webhook URL, and the payload names only the Page/IG id, so this table is what turns an
--   incoming message into a tenant.
--   The row holds a Page access token, which can send messages as the merchant's Page. RLS on, no policies
--   and no grants: service role only, like tenant_ai_persona in 018. Shop members can read their own tenants
--   row, so a token kept there would be readable through the API by any merchant or staff member.

CREATE TABLE IF NOT EXISTS channel_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel VARCHAR(50) NOT NULL CHECK (channel IN ('messenger', 'instagram')),
  -- Page id for Messenger, Instagram professional account id for Instagram: whatever Meta puts in entry.id.
  external_id VARCHAR(255) NOT NULL,
  page_token TEXT NOT NULL,
  -- Shown in the dashboard so the merchant recognises which Page is connected.
  name TEXT,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Globally unique, not per tenant: one Page belongs to one shop. Stops a second merchant from claiming a
  -- Page someone already connected, which would send another shop's customers to the wrong catalogue.
  CONSTRAINT unique_channel_account UNIQUE (channel, external_id)
);

ALTER TABLE channel_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON channel_accounts FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_channel_accounts_tenant ON channel_accounts (tenant_id);
