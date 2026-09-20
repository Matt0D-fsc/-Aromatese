# Why a reply takes 20 seconds

Measured 2026-09-20 against production and against the Gemini API directly, using the app's own system prompt
and tool declarations. Numbers are medians of three runs, not estimates.

## The short version

A reply was taking 12–27 seconds. Three things were stacked on top of each other, and only one of them is a
code problem:

1. **The free-tier key runs out of quota, and every failure costs a full round trip.** This is most of it.
2. **`GEMINI_MODEL` had drifted to `gemini-3.5-flash`**, which is about twice as slow per call as `3.6-flash`.
3. **One customer message costs three model calls** — search, show, answer — and they run one after another.

Fixed so far: the model. The quota is not something code can fix.

## Where the time goes

The app itself is not slow. Measured from Dhaka against production:

| Request | Time |
|---|---|
| A static page | 0.44–0.73s |
| The chat page (reads the database) | 0.71–0.85s |
| `GET /api/chat` (several database queries, no AI) | 0.73–1.21s |
| `POST /api/chat` (the same, plus the agent) | **12–21s** |

So the database and the framework cost about a third of a second. Everything else is the model.

## Per call, by model

The real first turn of a reply — full system prompt, all six tools — asking each model to choose a tool:

| Model | Thinking default | Thinking off | Thinking tokens |
|---|---|---|---|
| `gemini-3.5-flash` | **5.67s** | 7.09s | 167 |
| `gemini-3.6-flash` | **2.84s** | 2.01s | 85 |
| `gemini-3.1-flash-lite` | 1.73s | 2.59s | 0 |
| `gemini-3.8-flash` | mostly unavailable | 5.77s | 0 |

`3.5-flash` was costing roughly three seconds per call more than `3.6-flash` for the same answer, on every one
of the three calls. Production had drifted onto it; `.env.example` already said `3.6`.

## The whole three-turn workflow, on a healthy key

`gemini-3.6-flash`, the tool results shaped like the real ones:

| Turn | What it does | Time | Prompt | Thinking | Visible |
|---|---|---|---|---|---|
| 1 | choose `search_products` | 2.19s | 1,987 | 83 | 19 |
| 2 | choose `show_products` | 2.16s | 2,360 | 100 | 52 |
| 3 | write the reply | 2.85s | 2,524 | 86 | 70 |
| | **total** | **7.21s** | | | |

**7.2 seconds is the floor** with this design and this model. Production was seeing 12–21s, so roughly 5–14
seconds on top of that is waste.

## The waste: a fallback storm

From the production logs:

```
[gemini] gemini-3.6-flash: key 1/1 out of quota, trying the next key
[gemini] gemini-3.6-flash unavailable (429), falling back to gemini-3.7-flash
[gemini] gemini-3.7-flash unavailable (503), falling back to gemini-3.8-flash
```

`lib/gemini.ts` tries the chosen model, then each model in `GEMINI_FALLBACK_MODELS`, on a 429, 500 or 503.
That is correct behaviour for a billed key, where those statuses are rare. On a free key, 429 is the *normal*
answer, so every agent step can pay for two or three full round trips instead of one. Three steps, three
attempts each, is up to nine API calls for one customer message.

Two details make it worse:

- The one-minute cooldown that is supposed to stop a known-bad model being retried lives in a module-level
  `Map`. On Vercel each invocation may be a fresh instance, so the cooldown usually starts empty and the dead
  model is tried again.
- `GEMINI_API_KEYS` is empty, so there is only one key to rotate to — itself.

## Why Mavs felt faster

Mavs was measured on a machine running Mavs locally, against a backend that was not rate-limiting it, on
`gemini-3.8-flash`, with no fallback chain firing. The 1.7–4s figure is also per model call rather than per
customer message; three of those is 5–12 seconds, which is the same order as the 7.2s measured here on a
healthy key. There is no missing magic in Mavs — it simply was not being throttled.

## What to do, in order of effect

1. **Put the Gemini key on a billed plan, or give Mavs Gateway a public URL.** This removes the 429s and with
   them the fallback storm. Everything else is secondary. Expect roughly 7 seconds after this.
2. **Keep `GEMINI_MODEL=gemini-3.6-flash`.** Done. Worth about 9 seconds a reply versus `3.5-flash`.
3. **Cut three model calls to two**, if 7s is still too slow. `show_products` and the final reply could be one
   turn if the agent accepted text alongside a tool call on the last step. Worth about 2.5s. It changes the
   agent loop, so it needs its own tests.

## A note on the original Mavs proposal

The plan was to send `thinkingBudget: 0` on the turn after `search_products`, on the grounds that the
transition is deterministic. Measured on `gemini-3.6-flash`, that turn spends **100 thinking tokens** and the
whole workflow spends 269. Turning thinking off there saves a fraction of a second, and in one measurement the
call with thinking off was *slower*.

That optimisation was worth doing when the model was `gemini-3.5-flash`, which spends 167 tokens on the first
turn alone and is slow generally. On `3.6-flash` it is not where the time is. The quota is.
