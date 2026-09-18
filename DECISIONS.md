# Decisions

Why things are the way they are, so a future change is an informed one rather than a rediscovery. Each entry
says what was chosen, what it costs, and what would justify changing it.

---

### Voice notes and photos go to the model whole, not through a transcription service

Gemini hears audio and sees images natively, so there is no speech-to-text step to run, host or pay for. A
transcript is made anyway and saved on the message — not to feed the model this turn, but so the next turn
remembers what was said and so staff can read it.

**Change it when** a cheaper engine without native audio becomes the default. The fallback already exists.

### No pgvector for photo matching

`products.image_embedding` has been unused since migration 002. Merchant catalogs are small and items are often
one of a kind, so the hard part is deciding whether a photo is *this* item or merely a similar one — precision,
not recall. A second vision pass over real candidate photos answers that better than a 768-dimension
approximation of them.

**Change it when** a merchant's catalog reaches the thousands and keyword search stops surfacing the right
candidates at all.

### One error boundary per segment, not ten server actions returning error state

Ten actions threw and nothing caught them, so any failure was a blank page. Converting each to return
`{ error }` means touching every caller and every form; a segment `error.tsx` catches all of them, including
failures nobody has written yet, and gives the merchant a way back.

**Cost:** the error is a generic message rather than a specific one. The specific one is in the audit trail.

### Errors go to a table, not to Sentry

`auditError` writes failures into `audit_logs`, and the admin panel shows them. No new dependency, no vendor,
no DSN to configure, and the platform owner sees failures in the place they already look.

**Change it when** error volume outgrows a page of rows, or when a stack trace matters more than a message.

### Retention is a button, not a schedule

`purge_old_chats` exists and the admin panel calls it. pg_cron is not enabled on this project, and a scheduler
that silently deletes customer data is worth setting up deliberately rather than by default.

**Change it when** deletion needs to happen without anyone remembering: enable pg_cron and call the same
function.

### Plans are four names and a price, not a plans table

A handful of hand-set plans do not need their own table, foreign key and admin CRUD. `tenants.plan` plus
`plan_price_bdt`, and one platform-wide taka-per-million-tokens rate, is enough to see what each shop pays
against what it costs.

**Change it when** plans start carrying their own limits and features rather than being labels.

### Bangla covers the shell, not every string

The navigation, page headings and the buttons a merchant presses every day are translated. Deep form hints and
admin screens are not. A missing key falls back to English rather than showing a blank or a key name, so
translating more is one line per string in `lib/i18n.ts` with nothing else to wire.

### Forgetting a customer keeps their orders

`delete_customer_data` deletes the chats and the media and clears the name and number, but leaves orders with
their items and totals. A shop needs its sales record; the person does not need to stay identifiable in it.
`channel_user_id` is scrambled so the same browser starts fresh instead of walking back into a deleted history.

### Variants are replaced wholesale on save

A product has a handful of sizes. Diffing them against what is stored is more code than writing the list the
merchant just saw. Delete, then insert.

**Change it when** variants carry their own history, like per-variant sales figures that a delete would lose.

### The public chat polls; the dashboards subscribe

Visitors are anonymous, so they cannot subscribe to the database through row-level security. The chat page
polls every four seconds. Merchant and admin dashboards are signed in, so they use Supabase Realtime.

**Change it when** open chats reach the thousands: move the public side to a Realtime broadcast channel.
