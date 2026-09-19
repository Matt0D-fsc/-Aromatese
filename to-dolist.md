# ChatNab To-Do List

Status as of 2026-09-19. The pre-launch build scope lives in SCOPE.md; all three tiers are done. Ordered by priority: work top to bottom.

## Done so far
- Multi-tenant Supabase backend (auth, row-level security per shop, migrations 001–008)
- Admin panel: invite merchants, suspend, message limits, live usage per shop (messages, chats, orders, AI tokens)
- Merchant dashboard: onboarding, products with photos and AI fill, Chats inbox, Orders (confirm deducts stock)
- AI sales agent on a public chat link per shop (`/chat/<slug>`): Bangla/Banglish first, English fallback, product search, product cards, cash-on-delivery orders, photo understanding
- Human takeover v1: AI asks for help, staff take over and reply, AI resumes after 5 min wait or 30 min staff idle
- Live dashboard updates (Supabase Realtime)
- Customer voice notes and photos are kept: stored in a private per-shop bucket, played back in the merchant inbox, and transcribed/described so the AI remembers them on later turns
- AI engine switch in the admin panel: Gemini (.env) or in-house AI (OpenAI or Anthropic API format), with a connection and tool-calling test
- Gemini key rotation and model fallback for testing; Mavs Gateway connected

## Done 2026-09-20 (workflow audit fixes)
- [x] Platform AI persona moved to an admin-only table (it was readable by shop members)
- [x] Indexes on the hot paths; security headers (dashboards cannot be framed)
- [x] Confirming refuses to oversell; confirmed orders can be cancelled and their stock comes back
- [x] Staff added without email (password or one-time link), same as merchants
- [x] AI answers "where is my order" (order_status tool; another device needs order number + phone)
- [x] Chat says it is an AI assistant; Call-the-shop button
- [x] Product photo gallery in chat; link previews (description, logo); QR code + share card on the dashboard home
- [x] Sound + browser notifications for new orders and "needs you" chats while the dashboard is open
- [x] Products: search, filters (low / out / hidden), paging, quick stock edit
- [x] Monthly limit counts AI replies only; usage meter, warnings, near-limit list in admin

## 1. Loose ends (this week)
- [x] Commit recent work (migrations 007–008, AI engine switch, model fallback, Anthropic format, phone fix, AI fill fixes)
- [ ] Hands-on test: merchant dashboard buttons (Take over, reply, Hand back, confirm/cancel order, product edit/delete)
- [ ] Hands-on test: voice notes (webm/opus from a real phone; Gemini accepted the container in a synthetic test)
- [ ] Hands-on test: merchant invite email
- [ ] Hands-on test: ChatNab through Mavs Gateway (full order conversation, AI fill JSON output, forced fallback to Opus)
- [ ] Clean up test data (Demo Shop BD, test orders, test conversations)

## 2. Must-have before the first real merchant
- [ ] Deploy: hosting (e.g. Vercel) + domain + HTTPS (also enables the microphone on phones)
- [ ] Email delivery (SMTP) for merchant invites and password resets
- [x] Shop policies for the AI: delivery charges, delivery time, returns, payment, hours (shop profile)
- [x] Abuse protection on the public chat: per visitor (8/min, 150/day) and per connection (40/min, 400/day, generous for carrier NAT), on top of the admin-set monthly limit per shop. Bot challenge (e.g. Turnstile) only if abuse shows up
- [x] Phone photos shrunk in the browser before upload (chat and product photos), so 5 MB+ camera photos no longer fail
- [x] Error monitoring (failures land in the audit trail and the admin panel; see DECISIONS.md)
- [ ] Move the in-house AI API key into Supabase Vault
- [x] Delete a customer's data (chat inbox) and purge old chats (admin panel)
- [ ] Privacy policy page
- [x] Gateway decided: Mavs Gateway is the primary AI engine, Gemini provider only as fallback

## 3. What makes ChatNab sell in Bangladesh
- [ ] Facebook Messenger integration (first), then Instagram and WhatsApp
  - [ ] Meta app review
  - [ ] Merchants connect their own Page / WhatsApp number
  - [ ] Webhooks in, replies out through the same agent
  - [ ] Respect Meta's 24-hour reply window
  - [ ] Download customer voice notes and photos
- [ ] Merchant notifications for new orders and "Needs you" chats (email / push / WhatsApp)
- [ ] Order fulfilment
  - [x] Delivery charge by area (inside/outside Dhaka): read from the shop's delivery policies, added to AI and staff orders
  - [x] Staff create orders from a chat (agreed prices) and edit new orders; the customer gets the summary in chat
  - [ ] Courier integration (Pathao, Steadfast, RedX)
  - [ ] Order status updates to the customer
  - [ ] Stock reservation so two customers can't buy the last item
- [x] Product variants (size, colour): editable per product, and the AI quotes per-variant price and stock
- [ ] Embeddable chat widget for merchant websites + QR code for the chat link

## 4. Growth features (later)
- [ ] Payments: bKash and Nagad
- [ ] Bulk product import (CSV in; CSV export is done) — needed before launch, design in progress
- [ ] Assigning chats to a particular staff member (staff accounts themselves are done)
- [x] Merchant analytics: conversion, top products, unmatched searches, AI vs staff
- [ ] Smarter search: by meaning and photo similarity for large catalogs
- [x] Platform owner: plans and price per shop, AI cost in taka, audit log

## 5. Code health
- [x] Delete the old Express demo server and its 9 stale tests
- [ ] Add real tests for the AI agent and the chat API route
- [ ] Mavs Gateway phase 2: streaming tool calls (for other company agents)
