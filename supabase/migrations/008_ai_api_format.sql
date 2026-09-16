-- Migration: 008_ai_api_format.sql
-- Description: Which request format the in-house AI endpoint speaks: OpenAI Chat Completions (/chat/completions)
-- or Anthropic Messages (/v1/messages, e.g. a Claude-compatible gateway).
ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS custom_api_format VARCHAR(20) NOT NULL DEFAULT 'openai'
    CHECK (custom_api_format IN ('openai', 'anthropic'));
