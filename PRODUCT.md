# ChatNab — product description

Written 2026-09-20, for anyone building ChatNab's web presence: the marketing site, the pitch, app-store and
Meta review copy, onboarding emails, sales decks. One source of truth for what ChatNab is, what it does today,
what it will do, and the standards it holds itself to.

Two rules for using this document:

1. **Never claim what has not shipped.** Every section below is marked **Live**, **Next**, or **Later**. Only
   Live may be written in the present tense on a public page. See "Claims we can and cannot make".
2. **Plain words.** ChatNab's customers are shop owners, not engineers. If a sentence would confuse a saree
   seller in Mirpur, rewrite it.

---

## 1. In one line

**ChatNab is an AI salesperson for Bangladeshi online shops — it chats with customers, understands photos and
voice notes, and takes orders while the shop owner sleeps.**

Longer, for an About page:

> Most shops in Bangladesh sell through chat. A customer sends a photo and asks "eta ache?", asks the price,
> asks the delivery charge, and decides in the same conversation. When nobody replies for an hour, the sale is
> gone. ChatNab answers in seconds, in Bangla, Banglish or English, from the shop's real product list — with
> real prices, real stock, and the shop's own delivery and return policies. It shows the products, takes the
> order with name, number and address, and hands the chat to a person the moment one is needed.

## 2. Who it is for

**Primary: the F-commerce shop owner.** Sells on a Facebook page, sometimes Instagram or WhatsApp. Between
10 and 500 products. Runs the shop from a phone, often alongside another job. Answers the same questions
fifty times a day: price, delivery charge, "ache ki?". Loses sales at night and during Friday prayers.
Categories: clothing (sarees, kurtis, panjabi), perfume and cosmetics, watches and accessories, gadgets,
home items, food.

**Secondary: their staff.** One or two people answering chats, who need to step in without losing what the
AI already said.

**Also: the platform operator (us).** Invites merchants, sets their plan and limits, watches cost and usage.

**Not for, today:** large retailers with warehouse systems, marketplaces, or shops that need an English-only
website store.

## 3. The problem, in the customer's words

- "Ekta meye 11 tay message dilo, ami sokale reply dilam, tokhon o onno jaygay kine felse." — replies come
  too late.
- "Same question, 50 bar" — price, delivery charge, "eta original?", all day.
- "Customer chobi pathay, ami khuje pai na" — a customer sends a photo of something they saw elsewhere.
- "Order neya hoy chat-e, khata-y likhi" — orders live in a notebook, stock is guesswork.
- "Fake order" — cash-on-delivery parcels that come back.

## 4. How it works (three steps, for the home page)

1. **Add your products.** Photos, price, stock. The AI reads the photos and writes the Bangla, Banglish and
   English names and search words for you.
2. **Share your chat link.** Put it in your Facebook page bio, your posts, your ads, or print the QR code.
3. **The AI sells.** It answers in seconds, shows products with photos and prices, and takes cash-on-delivery
   orders. You confirm each order, and stock updates itself.

## 5. What makes ChatNab different

These are the claims worth leading with, in order:

1. **It understands photos and voice notes.** A customer can send a picture of a dress or record a voice note
   in Bangla, and the AI answers from the shop's own catalog. Most local chat tools are keyword bots.
2. **It never makes things up.** Every price, size, stock number and policy comes from the shop's own data.
   If the shop has not said it, the AI says the shop will confirm — it does not guess.
3. **It speaks the way customers type.** Bangla script, Banglish or English, matched to the customer, mixed
   scripts never mixed in one sentence.
4. **The shop stays in charge.** The shop writes its own rules ("if they ask for a discount, check their past
   orders first"), and any person on the team can take over a chat in one tap.
5. **It is honest with customers.** The chat says it is an AI assistant. When the shop is out of something,
   it says so and offers what is in stock.

## 6. What exists today — **Live**

Everything in this section is built and can be shown on the site.

### For the customer (the public chat page, one per shop)
- Chat in Bangla script, Banglish or English; the AI matches the language.
- Send a **photo** ("ache ki?") or a **voice note**; both are understood and kept with the conversation.
- Product cards: photo gallery, price, sale price, stock ("only 2 left"), and an order button.
- Sizes and colours, each with its own price and stock.
- Delivery charge and total shown before ordering, from the shop's own policy.
- Cash-on-delivery orders: name, mobile number, full address, with the number and address checked.
- "Where is my order?" answered by the AI, from the order record.
- The shop's delivery, returns, payment and opening-hours answers, shown at the top of the chat.
- A person can take over at any moment; a Call button reaches the shop directly.
- Labelled as an AI assistant from the first message.

### For the shop owner and their staff (the dashboard)
- **Home:** who is waiting, today's new orders, the chat link with QR code, and this month's usage.
- **Chats:** every conversation, filters for "needs you" and "staff handling", take over, reply, hand back to
  the AI. The AI steps back in if staff go quiet, so no customer is left waiting.
- **Orders:** search by number or phone, filter by status, confirm (stock comes out) or cancel (stock goes
  back), and edit a new order — prices, items, address, delivery.
- **Create an order from a chat** at the price staff agreed, with the summary sent to the customer.
- **Products:** photos with AI fill (it writes the titles, description and search words from the photos),
  price, sale price, stock, sizes and colours, search, low-stock and out-of-stock filters, quick stock edit.
- **Customers:** everyone who has chatted, with their order counts, searchable.
- **Analytics:** chats, orders and revenue by day, top products, and **what customers asked for that the shop
  does not sell** — demand the shop is missing.
- **Team:** staff accounts with their own logins, added without needing email.
- **Alerts:** a sound and a notification for new orders and chats that need a person, while the dashboard is
  open.
- **Bangla or English** interface, light or dark, built for a phone.
- **Export** products, orders and customers as CSV, any time.
- **Shop profile:** logo, contact details, and the delivery, payment, returns and hours the AI is allowed to
  state.
- **AI instructions:** the shop's own rules, as "when the customer… → the AI should…", including rules that
  depend on a customer's order history.

### For the platform operator
- Invite or create merchants (with a password or a one-time link; no email needed), suspend, reactivate.
- Per-shop AI reply limit with warnings, and a list of shops near or at their limit.
- Plans and price per shop, the AI cost in taka against what they pay.
- Per-shop view: chats (read-only), orders, activity, and a private AI persona and instructions per shop.
- Choice of AI engine (the in-house gateway, with a fallback provider) with a connection test.
- Audit trail of every change and every failure; delete a customer's data; purge old chats.

## 7. What ships next — **Next** (write in future tense only)

In the order it will be built. Use "coming soon" language, never the present tense.

1. **Bulk product import.** A spreadsheet, a zip of photos matched by file name, or the phone gallery, with a
   review screen and duplicate handling. Designed in full (see IMPORT.md).
2. **Facebook Messenger**, then Instagram and WhatsApp. The same AI, the same inbox, inside the apps
   merchants already sell in. (Subject to Meta's app review.)
3. **Courier booking** — Steadfast first, then Pathao and RedX: book a parcel, print the label and invoice,
   and follow the delivery status.
4. **Fake-order protection** — check a phone number's delivery history before shipping, and block bad numbers.
5. **Order statuses beyond confirmed** — processing, shipped, delivered, returned, with updates sent to the
   customer.
6. **Alerts when the dashboard is closed** — Telegram, email, or push.
7. **Photo matching, properly** — exact match, then similar items, then an honest "we don't have it".
8. **Website chat widget** — the same AI on the shop's own site.

## 8. Later — **Later** (roadmap page only, no dates)

- bKash and Nagad payments, including a small advance to filter out fake cash-on-delivery orders.
- Follow-ups: unfinished orders, reorder reminders, win-back messages.
- Facebook Ads results tied to real conversations and orders.
- Assigning chats to a particular staff member, and more detailed staff permissions.
- Stock held while an order is being confirmed.
- Search by meaning for large catalogs.
- More languages beyond Bangla and English.

## 9. The standards ChatNab holds itself to

These are promises, not features. They belong on the site, and they are also the rules the product is built
by. Every one of them is already true of the code today.

**Honesty about facts.** The AI states only what the shop's own records say. Prices, stock, sizes, delivery
charges and policies come from the database, never from the model's imagination. Anything the shop has not
answered, the AI says the shop will confirm. An out-of-stock item is called out of stock.

**Honesty about being an AI.** The chat says it is an AI assistant at the start of every conversation. It
never pretends to be a person, and it hands over to one whenever the customer asks or the situation needs it.

**The shop's word is final.** The shop's own instructions and policies outrank the AI's judgement. Anything a
team member says in a chat is never contradicted by the AI.

**Customer data belongs to the customer.** Voice notes and photos are kept in private storage that only the
shop can open. A customer can be forgotten: their chats, photos, voice notes, name and number are deleted,
while the shop keeps its sales record. Old conversations can be purged on a schedule the operator sets.
We are building towards Bangladesh's Personal Data Protection Ordinance 2025, which requires clear,
specific consent and gives people the right to have their data deleted.

**A shop's data is its own.** Every shop is sealed off from every other at the database level, not by
application code. One shop can never read another's products, chats, customers or orders.

**No lock-in.** Products, orders and customers export to CSV at any time, in a format Excel and every
Bangladeshi courier can read.

**Written for a phone on a slow connection.** Every screen works one-handed on a phone. Photos are shrunk in
the browser before they are uploaded, so a 10 MB camera photo costs the customer a fraction of the data.

**Bangla first, not Bangla translated.** Bangla, Banglish and English are all first-class in the chat, and
the dashboard speaks Bangla too.

**Every change is on the record.** Who suspended a shop, who cancelled an order, who read a chat, and every
failure — all recorded, and not editable by the person who did it.

**Accessible.** Real buttons and labels, keyboard and screen-reader friendly, controls big enough for a thumb,
and readable in both light and dark.

**Honest about money.** Each shop sees what its plan costs and what it has used. The operator sees what each
shop costs to serve. No surprise bills.

## 10. Pricing — not yet decided

Do not publish prices until the operator sets them. For context when the time comes:

- ChatNab charges a monthly price per shop, with a monthly allowance of AI replies. Messages from customers
  and replies typed by the shop's own team are free; only the AI's replies count against the allowance.
- Plan names in the product today: trial, starter, business, custom.
- The local market: the closest all-in competitor charges roughly ৳2,900–27,000 a month; simpler
  order-management tools charge from about ৳390 a month. ChatNab should be easy to start and clearly cheaper
  than hiring a night-shift replier.
- A free trial is the expected way in.

## 11. Voice and tone

**How ChatNab sounds:** like a capable shopkeeper, not a software company. Short sentences. Concrete numbers.
No hype, no "revolutionary", no "cutting-edge AI". Banglish is welcome in customer-facing copy where it is how
people actually talk ("Chobi pathan, khuje dibo").

**Say:** "It answers in seconds." · "It reads photos and voice notes." · "It never guesses a price."
**Don't say:** "Powered by advanced LLM technology." · "10x your sales." · "Fully automated store."

**Words we use:** shop, shop owner, customer, chat, order, delivery charge, stock, team.
**Words we avoid:** merchant (in customer-facing copy), tenant, conversation, SKU, agent, bot.

**The name:** ChatNab. Always one word, capital C and N. It is the chat that takes the order.

## 12. Proof points for the site

Use only these, and only where they are true:

- Replies in seconds, at any hour, in Bangla, Banglish or English.
- Understands a photo of a product and a voice note, not just typed text.
- Takes a full cash-on-delivery order: items, sizes, name, number, address, delivery charge, total.
- Prices, stock and policies come from the shop's own records — never invented.
- Any team member can take over a chat in one tap, and the AI steps back in if they go quiet.
- Shows the shop what customers asked for that it does not stock.
- Works on a phone, in Bangla, in light or dark.

**Screens worth showing:** the customer chat with a photo and product cards; the chats inbox with "needs you";
an order with its delivery charge; the analytics page with unmatched searches.

## 13. Claims we can and cannot make

| Can say today | Cannot say until it ships |
|---|---|
| "Answers on your own chat link" | "Answers in your Facebook Messenger inbox" |
| "Understands photos and voice notes" | "Finds the exact product from any photo" |
| "Takes cash-on-delivery orders" | "Takes bKash and Nagad payments" |
| "Shows delivery charge and total" | "Books your courier and prints the label" |
| "Keeps your stock updated when you confirm" | "Blocks fake orders" |
| "Alerts you while the dashboard is open" | "Alerts you on your phone when the app is closed" |
| "Add products with photos and AI fill" | "Import your whole catalog from a spreadsheet" |

## 14. Questions the site should answer

- **Do I need a website?** No. Your chat link is all you need, and it works from your Facebook page.
- **Does it work in Bangla?** Yes — Bangla, Banglish and English, whichever your customer uses.
- **Will it say the wrong price?** No. It can only say what is in your product list.
- **What if the AI cannot answer?** It calls you. The chat is marked "needs you", and you reply yourself.
- **Can my staff use it?** Yes, each with their own login.
- **Who sees my customers' data?** Only you and your team. You can delete a customer's data whenever
  they ask.
- **What happens if I leave?** Export your products, orders and customers as a spreadsheet, any time.
- **Does the customer know it is an AI?** Yes, it says so at the start of every chat.

## 15. Facts and figures, for reference

- Languages in chat: Bangla script, Banglish (Roman Bangla), English.
- Input the AI understands: text, photos, voice notes.
- Payment today: cash on delivery.
- Delivery: charge by inside/outside Dhaka, from the shop's own policy.
- Per shop: unlimited products in principle (built and tested for hundreds), up to 10 photos per product, up
  to 50 sizes or colours per product, up to 30 shop AI instructions.
- Built on Next.js and Supabase (Postgres with per-shop row-level security, private file storage). The AI runs
  through an in-house gateway with a fallback provider. None of this belongs in customer-facing copy.

---

**Keep this file current.** When something moves from Next to Live, move it in this document first, then
update the website. The website should never be ahead of this file.
