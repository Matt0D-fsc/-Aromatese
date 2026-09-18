# ChatNab — web app

Multi-tenant AI sales agent for Bangladeshi online shops. One Next.js app serves three audiences: customers
chatting with a shop's AI, merchants running their shop, and the platform owner running the platform.

## Running it

```bash
npm run dev --prefix web
```

Then `http://localhost:3000`. Use `localhost`, not a LAN IP: the microphone for voice notes needs a secure
context, and `localhost` counts as one while `http://192.168.x.x` does not.

`web/.env.local` needs:

| Variable | What it is |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Publishable key, safe in the browser |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only. Bypasses row-level security — never import it into a client component |
| `GEMINI_API_KEY` or `GEMINI_API_KEYS` | One key, or several comma separated to rotate when a free-tier daily quota runs out |
| `GEMINI_MODEL` | Defaults to `gemini-3.6-flash` |
| `GEMINI_FALLBACK_MODELS` | Tried in order when the main model is overloaded |
| `NEXT_PUBLIC_SITE_URL` | Used in invite emails, so they point at the deployed app |

## The three surfaces

**`/chat/<slug>`** — public, no login. A customer types, sends a voice note or sends a photo; the agent
answers in Bangla, Banglish or English, shows product cards and takes cash-on-delivery orders.

**`/dashboard`** — a merchant. Products, chat inbox with human takeover, orders, customers, analytics, team,
shop profile. English or Bangla, switched in the header.

**`/admin`** — the platform owner. Invite and suspend merchants, pause one shop's AI, set message limits and
plans, choose the AI engine, read the activity trail, purge old chats. `/admin/tenants/<id>` opens one shop.

## How a message is handled

1. `POST /api/chat/[slug]` ([route.ts](src/app/api/chat/%5Bslug%5D/route.ts)) — rate limit, save the customer's
   message, then run two things at once: the agent, and storing the media.
2. [`lib/agent.ts`](src/lib/agent.ts) — builds the prompt from the shop's own row (name, category, policies) and
   loops over tool calls: `search_products`, `show_products`, `place_order`, `request_human`. Every product fact
   the model states comes from a tool reading that shop's rows; prices for an order are re-read from the
   database, never taken from the model.
3. [`lib/media.ts`](src/lib/media.ts) — uploads the voice note or photo to the private `chat-media` bucket and
   saves a transcript or description on the message, so the model remembers it next turn and staff can read it.
4. The reply is saved and returned. The customer's page polls `GET` for staff replies.

## AI engines

Every AI call goes through [`lib/gemini.ts`](src/lib/gemini.ts). The platform admin chooses Gemini (keys from
`.env.local`) or an in-house endpoint speaking the OpenAI or Anthropic format, saved in the admin panel.
Requests and responses are converted to and from Gemini's shape, so the agent runs unchanged on either.

Voice notes are the exception: they go to whichever engine can carry audio. The OpenAI format has an
`input_audio` part, the Anthropic Messages format has no audio block at all, so a voice note falls back to
Gemini there whatever model sits behind the gateway.

## Database

Migrations are in [`../supabase/migrations`](../supabase/migrations), applied in order:

| | |
| --- | --- |
| 001–002 | Tenants, products, conversations, messages, orders, audit logs, pgvector columns |
| 003 | Auth, tenancy, onboarding, product-images bucket |
| 004 | Web chat agent, `search_products`, `confirm_order`, monthly usage view |
| 005–006 | Realtime, human takeover |
| 007–008 | Platform AI settings, API format |
| 009 | `chat-media` bucket: voice notes and photos kept |
| 010 | Audit trail and the two deletion functions |
| 011 | Shop policies, search logging, analytics views |
| 012 | Plans, per-variant search results |

Row-level security is the boundary, not application code: a merchant's client can only ever read and write
their own shop's rows. Server code that must cross that line uses the service role deliberately and says why.

## Things worth knowing before changing them

- **Deleting data is real.** `delete_customer_data` and `purge_old_chats` return the storage paths they
  orphaned because SQL cannot empty a bucket; the caller must remove those files over the API.
- **The audit trail is written with the service role**, never the caller's client, so nobody can edit their own
  trail. `lib/audit.ts` never throws: an action must not fail because its audit line did.
- **Days are Dhaka days.** The analytics views bucket by `Asia/Dhaka`, so a shop's day ends at midnight in
  Dhaka. `tenant_usage_month` still uses UTC calendar months.
- **Search input is sanitised before PostgREST `or()`** (`searchTerm` in `lib/chat.ts`); commas and parentheses
  are that filter's syntax.
- **CSV exports quote-prefix `=`, `+`, `-` and `@`** (`lib/csv.ts`) so a product title cannot execute as a
  formula when a merchant opens the file in Excel.

## Checks

```bash
npm run build --prefix web
npx eslint src
npm test
```

`npm test` runs the pure helpers in [`../tests/web_lib.test.ts`](../tests/web_lib.test.ts) with vitest from the
repository root. The nine `phase*_exit_criteria` tests belong to the retired Express prototype in `../src`.
