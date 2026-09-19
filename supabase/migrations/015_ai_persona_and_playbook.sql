-- Migration: 015_ai_persona_and_playbook.sql
-- Description: Two ways to shape a shop's AI beyond its catalog and policies.
--   1. tenants.ai_persona — set by the platform admin: the assistant's name, its tone, and instructions the
--      merchant cannot see or override.
--   2. tenants.ai_playbook — set by the merchant: "when the customer ... -> do/say ..." pairs, covering both
--      ready answers to common questions and procedures like "check their past orders before a discount".
-- JSONB on tenants, like policies (011): merchants cannot write tenants directly, so both are written by
-- whitelisted server actions with the service role, and a new field needs no migration.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS ai_persona JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS ai_playbook JSONB NOT NULL DEFAULT '[]'::jsonb;
