# ChatNab To-Do List

Status as of 2026-09-17. Ordered by priority: work top to bottom.

## Done so far
- Multi-tenant Supabase backend (auth, row-level security per shop, migrations 001–008)
- Admin panel: invite merchants, suspend, message limits, live usage per shop (messages, chats, orders, AI tokens)
- Merchant dashboard: onboarding, products with photos and AI fill, Chats inbox, Orders (confirm deducts stock)
- AI sales agent on a public chat link per shop (`/chat/<slug>`): Bangla/Banglish first, English fallback, product search, product cards, cash-on-delivery orders, photo understanding
- Human takeover v1: AI asks for help, staff take over and reply, AI resumes after 5 min wait or 30 min staff idle
- Live dashboard updates (Supabase Realtime)
- AI engine switch in the admin panel: Gemini (.env) or in-house AI (OpenAI or Anthropic API format), with a connection and tool-calling test
- Gemini key rotation and model fallback for testing; Mavs Gateway connected

## 1. Loose ends (this week)
- [x] Commit recent work (migrations 007–008, AI engine switch, model fallback, Anthropic format, phone fix, AI fill fixes)
- [ ] Hands-on test: merchant dashboard buttons (Take over, reply, Hand back, confirm/cancel order, product edit/delete)
- [ ] Hands-on test: voice notes
- [ ] Hands-on test: merchant invite email
- [ ] Hands-on test: ChatNab through Mavs Gateway (full order conversation, AI fill JSON output, forced fallback to Opus)
- [ ] Clean up test data (Demo Shop BD, test orders, test conversations)

## 2. Must-have before the first real merchant
- [ ] Deploy: hosting (e.g. Vercel) + domain + HTTPS (also enables the microphone on phones)
- [ ] Email delivery (SMTP) for merchant invites and password resets
- [ ] Shop policies for the AI: delivery charges/areas, delivery time, returns, payment options, business hours, FAQs (so the AI stops saying "the shop will confirm")
- [ ] Abuse protection on the public chat: per-IP rate limits and basic bot protection (current limit is per browser cookie)
- [ ] Error monitoring (e.g. Sentry)
- [ ] Move the in-house AI API key into Supabase Vault
- [ ] Privacy policy + a way to delete a customer's data
- [ ] Resolve the gateway upstream question (official Gemini/Anthropic APIs vs IDE access) before real customer data flows through it

## 3. What makes ChatNab sell in Bangladesh
- [ ] Facebook Messenger integration (first), then Instagram and WhatsApp
  - [ ] Meta app review
  - [ ] Merchants connect their own Page / WhatsApp number
  - [ ] Webhooks in, replies out through the same agent
  - [ ] Respect Meta's 24-hour reply window
  - [ ] Download customer voice notes and photos
- [ ] Merchant notifications for new orders and "Needs you" chats (email / push / WhatsApp)
- [ ] Order fulfilment
  - [ ] Delivery charge by area (inside/outside Dhaka)
  - [ ] Courier integration (Pathao, Steadfast, RedX)
  - [ ] Order status updates to the customer
  - [ ] Stock reservation so two customers can't buy the last item
- [ ] Product variants (size, colour) — table exists, not used yet
- [ ] Embeddable chat widget for merchant websites + QR code for the chat link

## 4. Growth features (later)
- [ ] Payments: bKash and Nagad
- [ ] Bulk product import (CSV or from a Facebook shop)
- [ ] Staff accounts and assigning chats to staff
- [ ] Merchant analytics: chats → orders conversion, most-asked products, AI vs staff handling
- [ ] Save customer photos and voice notes in the merchant's chat history
- [ ] Smarter search: by meaning and photo similarity for large catalogs
- [ ] Platform owner: merchant billing and plans, AI cost per shop in taka, audit log

## 5. Code health
- [ ] Delete the old Express demo server and its 9 stale tests
- [ ] Add real tests for the AI agent and the chat API route
- [ ] Mavs Gateway phase 2: streaming tool calls (for other company agents)
