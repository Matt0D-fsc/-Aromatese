-- Migration: 007_platform_ai_settings.sql
-- Description: One-row platform settings: which AI engine powers every shop (Gemini from .env, or an in-house
-- OpenAI-compatible endpoint) and that endpoint's details.
-- No RLS policies and no grants for anon/authenticated: only server code using the service role reads or writes it,
-- after checking the caller is the platform admin, so the in-house API key never reaches a browser.

CREATE TABLE IF NOT EXISTS platform_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  ai_provider VARCHAR(20) NOT NULL DEFAULT 'gemini' CHECK (ai_provider IN ('gemini', 'custom')),
  custom_base_url TEXT,
  custom_model TEXT,
  -- ponytail: stored as plain text for testing; move to Supabase Vault before real merchants use an in-house key.
  custom_api_key TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES profiles(id) ON DELETE SET NULL
);
INSERT INTO platform_settings (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;
ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON platform_settings FROM PUBLIC, anon, authenticated;
