import { GoogleGenAI } from '@google/genai';

type Params = Parameters<GoogleGenAI['models']['generateContent']>[0];
type Result = Awaited<ReturnType<GoogleGenAI['models']['generateContent']>>;

// GEMINI_API_KEYS may list several keys, comma separated. When one key's daily free quota is spent,
// the next key takes over instead of the test stopping.
// ponytail: rotation is a testing crutch — production runs on one billed key (free tier trains on customer data).
const KEYS = (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '')
  .split(',')
  .map((k) => k.trim())
  .filter(Boolean);
let next = 0;

export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

export async function generateContent(params: Params): Promise<Result> {
  if (!KEYS.length) throw new Error('Set GEMINI_API_KEY (or GEMINI_API_KEYS) in .env.local');

  const start = next;
  let lastError: unknown;
  for (let i = 0; i < KEYS.length; i++) {
    // start is fixed for this call: advancing `next` inside the loop would re-pick the same key.
    const index = (start + i) % KEYS.length;
    try {
      const result = await new GoogleGenAI({ apiKey: KEYS[index] }).models.generateContent(params);
      next = index; // stay on this key until it runs out too
      return result;
    } catch (err) {
      if ((err as { status?: number })?.status !== 429) throw err;
      lastError = err;
      next = (index + 1) % KEYS.length;
      console.warn(`[gemini] key ${index + 1}/${KEYS.length} out of quota, trying the next key`);
    }
  }
  throw lastError;
}
