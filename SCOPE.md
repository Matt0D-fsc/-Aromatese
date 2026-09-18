# ChatNab — Build Scope

What is left to build before ChatNab is a product a paying merchant depends on, in the order it should be
built. Written 2026-09-19 from an audit of every dashboard, admin and auth file.

Companion documents: `to-dolist.md` (running task list), `omnichannel_addendum_operational_plan_v1.md`
(the original operational plan), `DECISIONS.md` (why things are the way they are).

Status markers: `[ ]` not started · `[~]` in progress · `[x]` done and verified.

---

## The shape of the problem

The database was designed for a bigger product than the UI currently exposes. Several tables and columns
exist, are correct, and have no interface at all: `audit_logs` has never been written to, `tenants.ai_enabled`
is read by the chat route but set by nothing, `tenants.logo_url` and the `variants` table have no form.
Most of this scope is connecting what already exists, not designing something new.

Three things are genuinely absent rather than half-wired: merchant analytics, data retention, and any
record of who did what.

---

## Tier 1 — before a real merchant logs in

Each of these either causes a visible failure with no recovery, or carries a legal or operational risk.

- [x] **T1.1 Error and loading boundaries.** There is no `error.tsx`, `loading.tsx`, `not-found.tsx` or
  `global-error.tsx` anywhere in the app, while ten server actions throw. A failed "Confirm order" shows a
  blank crash page with no way back. One boundary per segment catches every failure, including the ones not
  yet imagined — cheaper and more complete than converting ten actions to return error state.
- [x] **T1.2 Data deletion and retention.** Nothing is ever deleted: messages, media, customers and orders
  accumulate forever. Needed three times over — the privacy policy owed to customers, Meta's mandatory
  data-deletion callback at app review, and `chat-media` storage cost. Deleting a customer must also remove
  their objects from the bucket, which SQL alone cannot do.
- [x] **T1.3 Audit trail.** `audit_logs` exists since migration 001 and has never been written to. No record
  of who suspended a shop, changed the AI engine, read a customer's chat, or cancelled an order. This is what
  a dispute with a merchant is settled with.
- [x] **T1.4 Per-shop AI switch.** `tenants.ai_enabled` is read in three places in the chat route and set
  nowhere in any UI. Today, pausing one shop's AI means suspending the whole shop or editing the database.
- [x] **T1.5 Orders that stay usable.** Hard `limit(100)`, no status filter, no date filter, no lookup by
  order number or phone. A shop doing twenty orders a day loses the ability to find one within a week.
- [x] **T1.6 Error visibility.** Every failure is `console.error` on a server nobody is watching. Failures
  belong somewhere the platform owner sees them.

## Tier 2 — what makes it usable, and sellable

Build this while Meta app review sits in its queue.

- [x] **T2.1 Merchant analytics.** There is no analytics page at all. Chats-to-orders conversion, top products,
  what customers asked for that the shop does not stock, AI versus staff handling, revenue over time. This is
  the screen that makes a merchant renew.
- [x] **T2.2 Log unmatched searches.** When `search_products` returns nothing, that fact is currently thrown
  away. It is the most commercially valuable signal in the product — demand the merchant cannot fill — and it
  is also the evaluation data for photo matching.
- [x] **T2.3 Shop policies.** The agent is correctly forbidden from guessing delivery charge, delivery time,
  returns and payment options, so it deflects with "the shop will confirm" on the questions Bangladeshi
  customers ask first. A policies form, injected into the system prompt, fixes the agent's most visible weakness.
- [x] **T2.4 Mobile.** Merchants run this on a phone. The nav wraps with no menu, the chats inbox is a
  two-pane `70vh` grid that stacks into two tall scrollers, the admin table scrolls sideways.
- [x] **T2.5 Bangla interface.** The AI speaks Bangla and Banglish to customers while the shop owner gets an
  English-only dashboard.
- [x] **T2.6 Customer records.** The AI collects names and phone numbers into `customers`; the merchant can
  only see them buried inside individual orders. No list, no history, no repeat-buyer view.
- [x] **T2.7 Admin per-shop view.** One table row per merchant with nothing behind it. When a merchant reports
  that the AI said something wrong, the platform owner cannot look.

## Tier 3 — growth

- [x] **T3.1 Billing and plans.** `monthly_message_limit` is the only lever. No plans, no price, no AI cost per
  shop in taka.
- [x] **T3.2 Staff accounts.** `tenant_members.role` exists; only the owner can ever sign in.
- [x] **T3.3 Export and offboarding.** A merchant cannot get their products, orders or customers out.
  Addendum-3 of the operational plan specifies this lifecycle; none of it is built.
- [x] **T3.4 Product variants.** The `variants` table has existed since migration 001 with no form and no
  agent awareness. Size and colour are the two things apparel customers ask about first.
- [x] **T3.5 Shop branding.** `tenants.logo_url` has existed since migration 003, unused. The public chat
  header — the one screen customers actually see — is plain text.

---

## Already built

Multi-tenant Supabase backend with row-level security · admin panel (invite, suspend, message limits, live
usage) · merchant dashboard (onboarding, products with photos and AI fill, chat inbox, orders with stock
deduction) · AI sales agent on a public per-shop chat link, Bangla/Banglish/English, product search, cash-on-
delivery orders · human takeover with automatic hand-back · live dashboard updates over Supabase Realtime ·
AI engine switch between Gemini and an in-house OpenAI- or Anthropic-format endpoint · **customer voice notes
and photos stored, transcribed and replayable in the merchant inbox** (P0, migration 009).

## Deliberately not building

- **pgvector image embeddings.** `products.image_embedding` has been unused since migration 002. Catalogs are
  small and items are unique, so the problem is precision, not recall; a second vision pass over real candidate
  photos beats an approximation of them. Revisit only if a merchant's catalog reaches the thousands.
- **A Sentry dependency, for now.** Errors go to the audit trail and the admin panel instead. Move to Sentry
  when error volume outgrows a table.
- **Converting every throwing server action to return error state.** The segment error boundary catches all of
  them, including the failures not yet written.

## Sequenced after this scope

Deploy with HTTPS and a domain · privacy policy and Meta's data-deletion callback · submit for Meta app review
(a queue, not a task — start it early) · photo matching ladder, exact → similar → honest no (P1) · Facebook
Messenger, then Instagram and WhatsApp.

---

## How this was verified

Every tier: `npm run build`, `tsc --noEmit` and `eslint src` clean, plus six vitest cases in
`tests/web_lib.test.ts` covering the pure helpers that are easy to get quietly wrong — media paths, media notes,
search-input sanitising and CSV formula escaping.

**Tier 1.** The deletion functions were run against real rows on the live project: `delete_customer_data`
removed the chats and media references, cleared the name and number, scrambled `channel_user_id` and left the
order with its total; `purge_old_chats(180)` removed a 400-day-old conversation and left a fresh one untouched.
Both returned the orphaned storage paths for the caller to delete. The audit insert shape was checked against
the table with the same service-role client `lib/audit.ts` uses. The 404 boundary was confirmed in a browser on
a dead shop link. Error visibility proved itself unprompted: a Gemini 503 during testing was captured as
`error.chat.agent` with its status and message.

**Tier 2.** Policies were set on the demo shop and the live agent was asked a delivery and returns question in
Banglish; it answered "Dhaka-r baire delivery charge 120 taka" and quoted the exchange window, where before it
would have deflected. Asking for a gaming laptop produced a zero-result row in `product_searches` and the phrase
appeared in `tenant_unmatched_searches_30d`. All three analytics views returned real rows.

**Tier 3.** Variants were added to a product and the live agent was asked which sizes exist; it answered that
Medium was out of stock and quoted Small at 2400 and Large at 2600 — per-variant prices straight from the
database. `search_products` returns an empty list for products without variants, so nothing else changed.

**Not verified by running it:** every screen behind a login — the merchant dashboard and the admin panel. They
compile, lint and build, and their queries were exercised directly against the database, but nobody signed in
as a merchant or as the platform owner. Worth clicking through: confirming an order, the language toggle, the
logo upload, inviting a staff member, saving a plan, and the retention button.
