import { GoogleGenAI } from '@google/genai';
import { getAiSettings } from '@/lib/ai-settings';
import { anthropicGenerateContent } from '@/lib/anthropic-compatible';
import { customGenerateContent } from '@/lib/openai-compatible';

type Params = Parameters<GoogleGenAI['models']['generateContent']>[0];
type Result = Awaited<ReturnType<GoogleGenAI['models']['generateContent']>>;

// Every AI call in the app goes through generateContent. The platform admin picks the engine:
// Gemini (keys from .env) or an in-house model speaking the OpenAI or Anthropic API format (saved in the admin panel).

// GEMINI_API_KEYS (or GEMINI_API_KEY) may list several keys, comma separated. When one key's daily free quota
// is spent, the next key takes over.
// ponytail: key rotation is a testing crutch — production runs on one billed key (free tier trains on customer data).
const KEYS = (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '')
  .split(',')
  .map((k) => k.trim())
  .filter(Boolean);

export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

// Tried in order when the main model is overloaded (503/500) or out of quota on every key (429).
// Each model has its own capacity and its own daily limits.
const FALLBACK_MODELS = (process.env.GEMINI_FALLBACK_MODELS || 'gemini-3.6-flash,gemini-3.7-flash,gemini-3.8-flash')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);
const MODEL_FALLBACK_STATUSES = new Set([429, 500, 503]);

let nextKey = 0;
// A model that just failed is skipped for a minute, so every agent step doesn't wait on it again.
const COOLDOWN_MS = 60_000;
const coolingUntil = new Map<string, number>();
const statusOf = (err: unknown) => (err as { status?: number })?.status;

async function withAnyKey(params: Params): Promise<Result> {
  if (!KEYS.length) throw new Error('Set GEMINI_API_KEY (or GEMINI_API_KEYS) in .env.local');

  const start = nextKey;
  let lastError: unknown;
  for (let i = 0; i < KEYS.length; i++) {
    // start is fixed for this call: advancing nextKey inside the loop would re-pick the same key.
    const index = (start + i) % KEYS.length;
    try {
      const result = await new GoogleGenAI({ apiKey: KEYS[index] }).models.generateContent(params);
      nextKey = index; // stay on this key until it runs out too
      return result;
    } catch (err) {
      if (statusOf(err) !== 429) throw err;
      lastError = err;
      nextKey = (index + 1) % KEYS.length;
      console.warn(`[gemini] ${params.model}: key ${index + 1}/${KEYS.length} out of quota, trying the next key`);
    }
  }
  throw lastError;
}

async function geminiGenerateContent(params: Params): Promise<Result> {
  const all = [params.model, ...FALLBACK_MODELS.filter((m) => m !== params.model)];
  const ready = all.filter((m) => (coolingUntil.get(m) ?? 0) < Date.now());
  const models = ready.length ? ready : all;
  let lastError: unknown;
  for (const [i, model] of models.entries()) {
    try {
      return await withAnyKey({ ...params, model });
    } catch (err) {
      lastError = err;
      if (!MODEL_FALLBACK_STATUSES.has(statusOf(err) ?? 0) || i === models.length - 1) break;
      coolingUntil.set(model, Date.now() + COOLDOWN_MS);
      console.warn(`[gemini] ${model} unavailable (${statusOf(err)}), falling back to ${models[i + 1]}`);
    }
  }
  throw lastError;
}

export async function generateContent(params: Params): Promise<Result> {
  const settings = await getAiSettings();
  if (settings.provider === 'gemini') return geminiGenerateContent(params);

  // In-house engine selected: no silent fallback to Gemini, so test results really reflect the in-house model.
  if (!settings.baseUrl || !settings.model) throw new Error('In-house AI is selected but its base URL or model is missing.');
  const endpoint = { baseUrl: settings.baseUrl, model: settings.model, apiKey: settings.apiKey };
  return settings.apiFormat === 'anthropic' ? anthropicGenerateContent(params, endpoint) : customGenerateContent(params, endpoint);
}
