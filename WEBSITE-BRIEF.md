# ChatNab — website brief

Context for building and writing chatnab's marketing site. Not a feature list: the argument the site has to
make, the vision behind it, and the words to make it in. Written 2026-09-22.

Companion documents: `PRODUCT.md` (what exists, precisely), `META_REVIEW.md` (the Meta submission),
`LATENCY.md` (performance). Where this brief and PRODUCT.md disagree on what is built, PRODUCT.md is right.

---

## 1. The one idea the site must land

**In Bangladesh, the shop is the chat.**

There is no storefront. No cart, no checkout, no product page. A customer sees a saree in a Facebook post,
sends "eta ache?", asks the price, asks the delivery charge, gives their address, and the sale is done — all
inside one conversation, usually on a phone, usually at night.

Every e-commerce tool ever built assumes the opposite. It assumes a website with a cart, and bolts a chat
widget onto the corner. Shopify, WooCommerce, every storefront builder — they are answers to a question
Bangladeshi shops are not asking.

ChatNab inverts it. **The conversation is the store.** The AI is not a helper beside the shop; it is the
shopkeeper. It knows the stock, quotes the price, shows the item, takes the order, and calls a human when a
human is needed.

That inversion is the vision. Everything else on the site is evidence for it.

---

## 2. Who this is for

Picture one person, because the whole site should be written to her.

She runs a saree page on Facebook. Four hundred products, most of them photographed on her own phone. She has
a day job, or children, or both. Her phone buzzes from 8am to 1am. She answers the same four questions —
*price koto? delivery charge? original to? ache ekhono?* — perhaps a hundred times a day. Orders live in a
notebook. Stock lives in her head. She loses sales at night, during Friday prayers, and whenever she sleeps.
She cannot take a day off, and she cannot hire, because a night-shift replier costs more than the margin.

She is not "an SMB". She is not doing "digital transformation". She is trying to not lose the next sale.

**Secondary audience:** her one or two staff, who need to step in without losing what the AI already said.

**Not the audience:** enterprises, marketplaces, anyone who wants a website store. Saying no to them on the
site makes the yes stronger.

---

## 3. The enemy

Name the enemy, not the competition. The site is fighting:

- **The 11pm message that got answered at 9am.** By then she bought it somewhere else.
- **The same question, fifty times a day.**
- **The notebook.** Orders on paper, stock in her head, no idea what sold last month.
- **The fake COD order.** A parcel goes out, comes back, and she pays the courier both ways.
- **Never being off.** The business stops the moment she does.

Competitors are a footnote. If the site argues with Manychat, it has already lost the plot.

---

## 4. The vision: where this goes

The site should make clear that answering messages is the *beginning*, not the product. Sell the destination.

**Today it wins the sale.** It answers instantly, in her customer's language, from her real stock, and takes
the order.

**Next it protects the sale.** It books the courier and prints the label. It checks a phone number's delivery
history before a parcel goes out, so fake orders stop eating her margin. It takes a small bKash advance to
filter the time-wasters. It tells the customer where the parcel is, so she stops answering "kothay ache?".

**Then it grows the sale.** It follows up on the chat that went quiet. It reminds the customer who bought
three months ago. It tells her what customers asked for that she does not stock — demand she never knew she
was turning away.

**Eventually it runs the shop.** One place that knows every customer, every conversation, every order, every
taka. The thing that turns a Facebook page into a business that can survive its owner taking a day off.

The line to hold in the reader's head: **she started with a phone and a notebook; she ends with a business.**

---

## 5. Why ChatNab and not the alternatives

| Instead of | What goes wrong | ChatNab |
|---|---|---|
| A keyword bot | Breaks on "shaari ache?", cannot read a photo, sounds like a robot | Understands Banglish, photos and voice notes |
| A Western AI chatbot | No Bangla, no Banglish, no cash on delivery, no Pathao or Steadfast, no ৳ | Built for how Bangladesh actually sells |
| An order-management tool | Manages the order after she has already won it by hand | Wins the sale, then manages it |
| Hiring a night-shift replier | Salary every month, sleeps, quits, needs training | Costs a fraction, never sleeps |
| Doing it herself | Works until it doesn't | Gives her the evening back |

---

## 6. The four pillars

Every page should ladder up to one of these. In order.

**1. It answers in seconds, at any hour.**
The sale is won or lost in the first few minutes. Lead with this.

**2. It never makes things up.**
This is the deepest one, and most sites would bury it. An AI that invents a price or promises stock that
does not exist destroys a shop's reputation in one message. ChatNab can only say what is in her own product
list. If she has not said it, the AI says the shop will confirm. Sell this as *trust*, not as a technical
detail — it is the reason she can leave it alone overnight.

**3. It speaks like her customers.**
Bangla script, Banglish, English — matched to whoever is typing. Understands a voice note recorded on a bus
and a photo screenshotted from someone else's page.

**4. She is always in charge.**
She writes the rules. Any team member takes over a chat in one tap. The AI steps back in if they go quiet. It
tells the customer it is an AI from the first message, so nobody is deceived.

---

## 7. What you may claim, and what you may not

The site will be read by Meta's reviewers as well as by merchants. Claiming a capability that does not exist
is both a broken promise to a shop owner and a risk to the app review.

**Rule: present tense for what ships today. Future tense for everything else, with no dates.**

| Say today | Not until it ships |
|---|---|
| "Answers on your own chat link" | "Answers in your Messenger inbox" — pending Meta review |
| "Understands photos and voice notes" | "Finds the exact product from any photo" |
| "Takes cash-on-delivery orders" | "Takes bKash and Nagad payments" |
| "Shows the delivery charge and total" | "Books your courier and prints the label" |
| "Keeps stock right when you confirm" | "Blocks fake orders" |
| "Alerts you while the dashboard is open" | "Alerts you on your phone" |
| "Add products with photos and AI fill" | "Import your whole catalogue from a spreadsheet" |

A "Coming soon" or roadmap section is not a weakness. For this audience it is proof the thing is alive and
being built for them. Use it.

**Never invent numbers.** No "300% more sales", no made-up merchant counts, no fake testimonials or logo
walls. Get real quotes from real pilot shops before publishing any. An empty testimonial section is better
than a fabricated one, and this market is small enough that a lie gets found.

---

## 8. Objections the site must answer

Put these in plain words, ideally as an FAQ near the bottom.

- **Do I need a website?** No. Your chat link is enough, and it works from your Facebook page.
- **Does it really work in Bangla?** Bangla, Banglish and English — whichever your customer uses.
- **Will it say the wrong price?** It can only say what is in your product list.
- **What if it cannot answer?** It calls you, marks the chat, and tells the customer you are coming.
- **Will my customers know it is a robot?** Yes — it says so at the start. Hiding it would backfire.
- **Can my staff use it?** Yes, each with their own login.
- **Who sees my customers' data?** Only you and your team. You can delete a customer's data whenever they ask.
- **What if I want to leave?** Export products, orders and customers as a spreadsheet, any time.
- **How much is it?** Decide before launch. A free trial is the expected way in here.

---

## 9. Voice

**Sound like a capable shopkeeper, not a software company.** Short sentences. Concrete numbers. Bangla and
Banglish are welcome where that is how people actually speak — "Chobi pathan, khuje dibo" belongs on the page.

**Say:** answers in seconds · never guesses a price · reads photos and voice notes · you take over any time
**Don't say:** powered by advanced LLM technology · 10x your sales · fully automated store · revolutionary

**Words to use:** shop, shop owner, customer, chat, order, delivery charge, stock, team
**Words to avoid:** merchant (in customer-facing copy), tenant, conversation, SKU, agent, bot

**The name:** ChatNab. One word, capital C and N.

---

## 10. Look

The product already has a design system; the site should look like the product, not like a different company.

- **Mark and wordmark:** `web/public/logo-mark.png`, with "ChatNab" set beside it in Instrument Sans.
- **Green:** the mark's lime for the brand, and a darker green (`oklch(0.53 0.16 138)`, about `#348008`) for
  anything carrying white text — the lime itself fails contrast badly. See `web/src/app/globals.css`.
- **Greys are warm, deliberately.** Warm greys beside the green read as a shop; cool greys read as a
  dashboard. Keep that.
- **Fonts:** Instrument Sans for Latin, Anek Bangla for Bengali. Real Bangla, properly set, is itself a
  signal — most tools here render it in whatever the device happens to have.
- **Rounded and soft:** radii from 0.625rem to 1.25rem, two shadow depths only, nothing heavier.
- **Phone first, genuinely.** She will read this site on a phone, one-handed, on mobile data, possibly
  outdoors in sunlight. Test it that way before anything else.
- **Show the product.** Real screenshots beat illustrations: the customer chat with a photo and product cards,
  the inbox with "needs you", the analytics page showing what customers asked for that she does not stock.

---

## 11. Suggested shape

1. **Hero.** The one idea, her language, one action. "An AI salesperson for your shop, on every chat you sell in."
2. **The problem, in her words.** The 11pm message. The fiftieth "price koto?".
3. **How it works, three steps.** Add your products · share your chat link · the AI sells.
4. **The four pillars**, one section each, each with a real screenshot.
5. **A real conversation.** Let a visitor read an actual chat — Banglish question, product card, order taken.
   This convinces more than any paragraph.
6. **She is in charge.** Takeover, her own rules, the AI announcing itself.
7. **What's coming.** The vision section, honestly future-tense.
8. **Pricing**, once decided. Free trial prominent.
9. **FAQ.** Section 8.
10. **Footer.** Privacy, terms, login.

**One call to action throughout.** Until self-serve signup exists, that is a demo or a waitlist, not "Sign up".

---

## 12. The sentence to keep on the wall

> Most shops in Bangladesh sell through chat. ChatNab is the shopkeeper who never sleeps, never forgets the
> price, and never makes anything up.
