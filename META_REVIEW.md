# Meta app review — submission pack

Everything needed to submit ChatNab for Facebook Login for Business, Messenger and Instagram messaging.
Copy the wording below straight into the forms. Written 2026-09-20 against the code on `pre-launch-scope`.

Production URL: `https://web-mattos-projects-30af3bbd.vercel.app`

> Meta moves these forms around and renames fields. Where this file and the dashboard disagree, believe the
> dashboard — but the substance of what they ask for does not change.

---

## 1. Before you submit — the blockers

| | Who | Status |
|---|---|---|
| Turn **Deployment Protection off** in Vercel | You | **Not done — blocks everything** |
| Create the Meta app (Business type) | You | Not done |
| Add `META_APP_ID` and `META_APP_SECRET` in Vercel and `.env.local` | You | Not done |
| Business verification (company documents) | You | Not done — start first, it is the slow one |
| Record the screencast | You | Not done |
| Privacy policy, terms, data deletion callback | Built | Done |
| App icon 1024×1024 | Built | `web/public/app-icon-1024.png` |
| Reviewer test account on a working shop | Built | See section 4 |

**Deployment Protection first.** Until it is off, every URL below answers `302` to a Vercel login page. Meta
will fail the webhook when you save it, and the reviewer will see a wall.

> Vercel → project **web** → Settings → Deployment Protection → Vercel Authentication: **Disabled** → Save

---

## 2. App settings

Products to add: **Messenger**, **Instagram**, **Facebook Login for Business**.

| Field | Value |
|---|---|
| App name | ChatNab |
| App icon | `web/public/app-icon-1024.png` |
| Category | Business and pages |
| App domain | `web-mattos-projects-30af3bbd.vercel.app` |
| Privacy Policy URL | `https://web-mattos-projects-30af3bbd.vercel.app/privacy` |
| Terms of Service URL | `https://web-mattos-projects-30af3bbd.vercel.app/terms` |
| Data Deletion Callback URL | `https://web-mattos-projects-30af3bbd.vercel.app/api/meta/data-deletion` |
| Valid OAuth Redirect URI | `https://web-mattos-projects-30af3bbd.vercel.app/api/meta/callback` |
| Webhook callback URL | `https://web-mattos-projects-30af3bbd.vercel.app/api/webhooks/meta` |
| Webhook verify token | the value of `META_VERIFY_TOKEN` in `web/.env.local` |
| Webhook fields | `messages`, `messaging_postbacks` |

Set the app to **Live**, not Development, before submitting.

---

## 3. Why we need each permission

Paste these into the "How will you use this permission?" box. Each one says what we do, why the permission is
needed, and what the shop owner gets — which is what the reviewer is checking for.

**`pages_show_list`**

> ChatNab is an AI assistant for small shops in Bangladesh that sell through chat. After a shop owner signs in
> with Facebook, we show them the list of Pages they manage so they can choose which Page ChatNab should answer
> messages for. Without this we cannot show them their own Pages and they would have to find and paste a Page
> ID by hand. We read the list only during that connection step.

**`pages_messaging`**

> This is the core of the product. When a customer messages the shop's Facebook Page, ChatNab reads the message
> and replies on the Page's behalf with answers drawn from that shop's own product catalogue — price, stock,
> sizes, delivery charge — and can take a cash-on-delivery order. Shop owners in Bangladesh answer the same
> questions all day and lose sales overnight; ChatNab answers in seconds, in Bangla, Banglish or English. The
> shop's staff can take over any conversation from our dashboard and reply themselves, which also uses this
> permission. We only ever message people who messaged the Page first.

**`pages_manage_metadata`**

> Used once per shop, to subscribe the Page they chose to our webhook so we receive its messages, and to
> unsubscribe it if they disconnect. We do not change any other Page settings, content or roles.

**`instagram_basic`**

> When a shop's Instagram professional account is linked to the Page they connect, we read that account's id
> and username so we can show the shop which Instagram account will be answered, and so we can tell incoming
> Instagram messages apart from Messenger ones.

**`instagram_manage_messages`**

> Shops in Bangladesh sell on Instagram as much as on Facebook, and expect one inbox for both. This lets
> ChatNab read and reply to Instagram direct messages sent to the connected account, with the same catalogue
> answers and the same handover to a human. We only reply to people who messaged the account first.

---

## 4. Test account for the reviewer

Meta must be able to use the product themselves. ChatNab is invite-only, so they cannot sign up — give them
this account. It is a shop owner on a demo shop with real products, orders and chats. It is **not** a platform
admin and can see nothing outside its own shop.

| | |
|---|---|
| Sign-in page | `https://web-mattos-projects-30af3bbd.vercel.app/login` |
| Email | `reviewer@chatnab.app` |
| Password | *(set when the account was created — keep it with your Meta submission)* |
| Shop | Demo Shop BD |
| Public chat link | `https://web-mattos-projects-30af3bbd.vercel.app/chat/demo-shop` |

**Do not delete Demo Shop BD.** The clean-up item on the to-do list must wait until review has passed — this
account is the review.

### Step-by-step instructions (paste into the submission)

> ChatNab is invite-only, so please use the test account below rather than signing up.
>
> 1. Open `https://web-mattos-projects-30af3bbd.vercel.app/login` and sign in with the email and password
>    provided. You will land on the shop's dashboard, showing its orders and chats.
> 2. To see what the AI does, open the shop's public chat link in a new tab:
>    `https://web-mattos-projects-30af3bbd.vercel.app/chat/demo-shop`. Type "saree ache?" or "show me dresses"
>    and send it. The assistant replies within a few seconds with real products, prices and stock from this
>    shop's catalogue. You can also send a photo of a dress or a watch and it will answer about it.
> 3. Back in the dashboard, open **Chats** in the top menu. The conversation you just had appears there. Click
>    it, type a reply and press Send — this is how a shop's staff takes over from the AI.
> 4. Open **Channels** in the top menu. This is the screen that uses the permissions we are requesting. Click
>    **Connect Facebook Page**. You will be asked to grant access to your Pages, then shown a list of the Pages
>    you manage, with a note of the Instagram account linked to each.
> 5. Choose a Page. ChatNab subscribes that Page to our webhook and shows it as connected.
> 6. Send a message to that Page from another Facebook account. The AI replies inside Messenger, using the same
>    catalogue as in step 2. The conversation also appears in the dashboard's Chats inbox, where staff can take
>    over and reply — that reply is delivered back into Messenger.
> 7. If the Page has a linked Instagram professional account, sending it a direct message behaves the same way.

---

## 5. Screencast shot list

One recording, two to three minutes, no cuts if you can manage it. Reviewers reject vague videos, so show the
permission being granted and the result of it.

1. The sign-in page, signing in with the test account.
2. The dashboard, briefly — orders and chats, so it is clearly a real product.
3. **Channels → Connect Facebook Page.** Show the Facebook permission dialog in full, including the list of
   permissions being granted. This is the shot they most need.
4. The Page list appearing, choosing a Page, and it showing as connected.
5. Switch to Messenger on a phone or another account. Send the Page a message like "saree ache?".
6. The AI's reply arriving in Messenger, with products and prices.
7. Back in the ChatNab inbox: the same conversation, staff typing a reply, and that reply appearing in
   Messenger.
8. If Instagram is linked, repeat 5–7 briefly in Instagram DMs.

Narrate or caption what you are doing. Record in English.

---

## 6. Where submissions usually fail

- **The reviewer could not sign in.** Test the account in a private window the day you submit.
- **The site was behind a login wall or was down.** Deployment Protection, again.
- **The screencast did not show the permission dialog.** Step 3 above.
- **A permission was requested but never used in the video.** Every permission in section 3 appears in the
  flow: `pages_show_list` at the Page list, `pages_manage_metadata` at connect, `pages_messaging` at the reply,
  the Instagram pair in the last shot. If you are not showing Instagram, remove those two from the submission
  and add them later.
- **Data deletion callback missing or broken.** Ours is live at the URL in section 2 and rejects anything it
  cannot verify. You can check it answers at all with:
  `curl -X POST -d "signed_request=x.y" <that URL>` → `{"error":"Invalid signed request"}`.
- **App still in Development mode.**

---

## 7. What works before review passes

You do not have to wait. On a Page **you** administer, the whole flow works as soon as the app exists and
Deployment Protection is off. Use that to record the screencast and to test with a real shop.

Advanced Access — other people's Pages — is the only thing review unlocks. That is what lets merchants who are
not you connect their own Pages.
