import { createAdminClient } from '@/lib/supabase/admin';

export type AiApiFormat = 'openai' | 'anthropic';

export type AiSettings = {
  provider: 'gemini' | 'custom';
  apiFormat: AiApiFormat;
  baseUrl: string | null;
  model: string | null;
  apiKey: string | null;
};

// Read before every AI call; cached briefly so one chat reply (several model calls) costs one query.
// Admin changes apply within TTL_MS, or immediately after saving (the cache is cleared).
const TTL_MS = 10_000;
let cached: { at: number; value: AiSettings } | null = null;

// Server-only: returns the in-house API key. Never pass the result to a client component.
export async function getAiSettings(): Promise<AiSettings> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  const { data, error } = await createAdminClient()
    .from('platform_settings')
    .select('ai_provider, custom_api_format, custom_base_url, custom_model, custom_api_key')
    .eq('id', true)
    .maybeSingle();
  if (error) throw error;
  const value: AiSettings = {
    provider: data?.ai_provider === 'custom' ? 'custom' : 'gemini',
    apiFormat: data?.custom_api_format === 'anthropic' ? 'anthropic' : 'openai',
    baseUrl: data?.custom_base_url ?? null,
    model: data?.custom_model ?? null,
    apiKey: data?.custom_api_key ?? null,
  };
  cached = { at: Date.now(), value };
  return value;
}

export function clearAiSettingsCache() {
  cached = null;
}
