import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Recorded Gemini calls, replayed. The phase 2 and 3 exit-criteria tests drive the real agent end to end,
// which used to mean a live API call on every run: billed, slower than any timeout you pick, and failing
// whenever Google was having a day.
//
//   npm test                          replays from tests/fixtures/gemini/
//   GEMINI_RECORD=1 npm test          calls the real API and writes what comes back
//
// A call with no recording fails loudly instead of quietly reaching the network, so a changed prompt shows up
// as "re-record me" rather than as a surprise bill. Re-record whenever the prompts or the model change — the
// recordings are the claim that this agent produced these replies, and a stale one stops being evidence.

const DIR = fileURLToPath(new URL('./fixtures/gemini/', import.meta.url));
const RECORDING = process.env.GEMINI_RECORD === '1';
const GEMINI_HOST = 'generativelanguage.googleapis.com';

type Tape = { url: string; status: number; body: unknown };

// The API key travels in the URL or a header depending on the SDK version. It is stripped before the request
// is hashed, so a key rotation does not invalidate every recording, and before anything is written to disk.
function scrub(url: string) {
  const parsed = new URL(url);
  parsed.searchParams.delete('key');
  return parsed.toString();
}

const tapePath = (key: string) => `${DIR}${key}.json`;

function tapeKey(url: string, init?: RequestInit) {
  const body = typeof init?.body === 'string' ? init.body : '';
  return createHash('sha256').update(`${init?.method ?? 'GET'} ${scrub(url)}\n${body}`).digest('hex').slice(0, 24);
}

const realFetch = globalThis.fetch;

globalThis.fetch = async function tapedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  if (!url.includes(GEMINI_HOST)) return realFetch(input as RequestInfo, init);

  const key = tapeKey(url, init);
  const path = tapePath(key);

  if (!RECORDING) {
    if (!existsSync(path)) {
      throw new Error(
        `No recorded Gemini response for this request (${key}).\n` +
          `The prompt or the model changed. Re-record with:  GEMINI_RECORD=1 npx vitest run\n${scrub(url)}`,
      );
    }
    const tape = JSON.parse(readFileSync(path, 'utf8')) as Tape;
    return new Response(JSON.stringify(tape.body), { status: tape.status, headers: { 'content-type': 'application/json' } });
  }

  const response = await realFetch(input as RequestInfo, init);
  // The response body can only be read once, so the copy that goes to disk is taken from a clone.
  const body = await response.clone().json().catch(() => null);
  if (body !== null) {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(path, `${JSON.stringify({ url: scrub(url), status: response.status, body } satisfies Tape, null, 2)}\n`);
  }
  return response;
} as typeof fetch;
