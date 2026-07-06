# Public HTTP API (storefront-facing)

The endpoints a published quiz's runtime — and anything embedding it — talks
to. **None of these require auth, by design**: they serve or accept only
published-quiz content, every write resolves `shopId` server-side from the
quiz row (the client is never trusted for tenancy), and `session_id` acts as
an unguessable bearer capability token where continuity is needed.

Base URL: the app origin (production: `https://quizocalypse-studio.fly.dev`).

**Rate limiting** is per-IP per-route (client IP from `Fly-Client-IP`, else
the first `X-Forwarded-For` hop), in-memory on the single always-on machine.
Blocked requests get `429` with a `Retry-After` header (seconds).

| Route | Limit (per IP / min) |
|---|---|
| `POST /captures` | 15 |
| `POST /sessions` | 30 |
| `POST /events` | 300 (requests; each carries ≤50 events) |
| `POST /q/:id/inventory` | 60 |
| `POST /q/:id/notify` | 15 |
| `POST /q/:id/rec-copy` | 5 |
| `POST /q/:id/ai-chat` | 10 |
| `GET /q/:id/results` | 30 |

The `/captures`, `/sessions`, `/events`, `/q/:id/inventory`, `/q/:id/notify`
endpoints are CORS-open (`access-control-allow-origin: *`) and answer
`OPTIONS` preflights with `204`. `/q/:id/rec-copy` and `/q/:id/ai-chat` are
same-origin only (no CORS headers — the runtime calls them from the app
domain).

---

## GET /q/:id — the quiz page

SSR'd shopper runtime for a published quiz. Embeddable in storefront iframes
(no `frame-ancestors` restriction on public routes — the launcher and Theme
App Extension depend on this).

- `?locale=<tag>` — explicit only (cache-safe). Resolved against the published
  doc's translation locales; unknown or absent → the quiz's base strings.
  Translation maps are applied server-side and **stripped** from the document
  sent to the client.

## GET /q/:id.json — the published document

The published quiz JSON, CORS-open and cacheable
(`cache-control: public, max-age=60, stale-while-revalidate=300`).
`404` when the quiz doesn't exist or isn't published.

Two strip layers guarantee what never appears here:

- **Stripped at publish** (never enters `publishedJson`): `build_session`
  (funnel scratch), `review_enrichment_sources` (merchant's pasted review/FAQ
  source text), `why_copy_meta` (AI-copy provenance), `path_report_ai`
  (advisory AI review rows).
- **Stripped at serve** (`stripPublicJsonPayload`): `review_enrichment_sources`
  (defense in depth) and `translations` (the full multi-locale string maps —
  HTML routes localize server-side instead).

Added at publish, on top of the editable doc: `product_index` (the baked
product rows recommendations resolve against), `published_at`, `version`,
`shop_domain`, optionally `platform`, `answer_weights`, and — decider docs
only — `target_product_ids_map` + `target_index`.

This payload is **byte-stable per publish**: it only ever changes when the
merchant republishes.

## POST /captures — email capture

```json
{ "quiz_id": "…", "session_id": "…", "email": "a@b.co", "first_name": "?", "phone": "?" }
```

Zod-validated (`email` ≤254 chars, `first_name` ≤100, `phone` ≤40). Returns
**`202 {"ok":true}`** — the write is accepted for the merchant's dashboard;
callers are fire-and-forget. `400` invalid payload (first 3 Zod issues
echoed), `404` unknown quiz, `429` limited, `500` controlled JSON on DB
failure (never an un-CORS'd framework error).

## POST /sessions — save a completed session

```json
{ "quiz_id": "…", "session_id": "…", "outcome_id": "?", "answer_ids": ["…"], "matched_product_ids": ["…"] }
```

Upserts one row per `(quiz_id, session_id)`; arrays capped at 200 entries.
New writes require `session_id` length ≥16 (guessing resistance — the runtime
mints `crypto.randomUUID()`). Returns `202`.

**GET /sessions?quiz_id=…&session_id=…** — the cross-device "My Results"
read: `200 {"ok":true,"session":{outcomeId,answerIds,matchedProductIds,converted,completedAt}}`
(non-PII fields only), `404` unknown. Without params: `204` (preflight no-op).

## POST /events — analytics batch

```json
{ "events": [ { "quiz_id": "…", "session_id": "…", "event_type": "quiz_started", "payload": {}, "ts": 1720000000000 } ] }
```

1–50 events per request. `event_type` ∈ `quiz_started`, `question_answered`,
`quiz_abandoned`, `quiz_completed`, `recommendation_viewed`,
`recommendation_clicked`, `add_to_cart`, `email_captured`, `tooltip_viewed`,
`quiz_engaged`, `buddy_invited`, `buddy_completed`. (`order_attributed` is in
the shared enum but **dropped at this boundary** — it is written server-side
by the Shopify orders webhook only, so revenue can't be spoofed.) Events for
unknown quiz ids are silently skipped. Returns `202`.

## POST /q/:id/inventory — live stock for urgency badges

```json
{ "product_ids": ["gid://shopify/Product/…"] }
```

≤100 ids; response `{"quantities": {"<product_id>": 7}}`. Only products in
THIS quiz's published `product_index` are answered (no catalog enumeration);
products without inventory tracking are omitted. Read live from the DB (kept
current by Shopify's `inventory_levels` webhook), never cached.

## POST /q/:id/notify — back-in-stock capture

```json
{ "email": "a@b.co", "product_id": "?", "session_id": "?" }
```

`product_id`, when present, must exist in the quiz's `product_index` (`400`
otherwise). Stores a `BackInStockRequest`; if the published doc configures
`back_in_stock_webhook_url`, the request is forwarded best-effort
(SSRF-guarded: public HTTPS hosts only, 5 s timeout) as
`{quiz_id, email, product_id, requested_at}`. Returns `200 {"ok":true}`.

## POST /q/:id/rec-copy — per-shopper AI recommendation copy

Same-origin. Decider-model quizzes only. The client sends **only**
identifiers — all prompt text is derived server-side from the published doc
(prompt-injection boundary):

```json
{ "sessionId": "8-64 chars [A-Za-z0-9_-]", "answerIds": ["…"] }
```

Success: `200 {"ok":true, "copy": "<string>", "cached": false}`.

Refusals are deliberately cheap and the runtime falls back to the merchant's
baked copy:

| Code | Status | Meaning |
|---|---|---|
| `bad_input` | 400 | malformed body |
| `not_found` | 404 | quiz missing/unpublished/invalid |
| `method` | 405 | non-POST |
| `rate_limited` | 429 | per-IP limit (5/min) |
| `server_error` | 500 | DB lookup failure |
| `disabled` | 200 | per-shop kill switch (`Shop.aiRecCopyEnabled=false`) |
| `budget` | 200 | shop over its daily AI ceiling (`AI_BUDGET_RUNTIME_DAILY_USD`, default $2/day) |
| `not_decider` | 200 | legacy points-model quiz |
| `why_off` | 200 | merchant turned "why" copy off for this target |
| `locked` | 200 | merchant pinned their approved copy |
| `no_target` | 200 | answers resolve to no target |
| `ai_credits` | 402 | Anthropic account credits depleted |
| `ai_error` | 502 | generation failed |

## POST /q/:id/ai-chat — the Ask-AI node

Same-origin. `{nodeId, path, history, userMessage (≤1200 chars), locale?}` →
the assistant's reply. 10/min/IP (each request is a real model call).

## GET /q/:id/results?session_id=… — saved "My Results" page

SSR'd persistent results page (email/share links land here). `session_id` is
the bearer capability; lookups are throttled (30/min/IP) so it can't be
enumerated. Unknown session → **soft redirect to `/q/:id`** (retake) rather
than an error, because integration emails can fire before the session row is
written. `400` missing `session_id`, `404` unpublished quiz.

## GET /q/:id.launcher.js — the embed snippet

A self-contained script that injects a floating launcher button and opens the
quiz in a full-screen modal iframe. Only served when the published doc's
`launcher_config.enabled` is true (otherwise a `200` JS comment). Cached 60 s.

```html
<script async src="https://<app-origin>/q/<quiz-id>.launcher.js"></script>
```

Note the **dot** before `launcher.js` — the URL is a single path segment
(`/q/:id.launcher.js`), same pattern as `/q/:id.json`. An inline embed is a
plain iframe: `<iframe src="https://<app-origin>/q/<quiz-id>" …></iframe>`.

---

## Outbound integration webhook (we call you)

When a shopper reaches an integration node, the server POSTs each configured
webhook URL (merchant-set, SSRF-screened, 5 s timeout,
`User-Agent: Quizocalypse/1.0`):

```json
{
  "quiz_id": "…",
  "quiz_name": "…",
  "node_id": "…",
  "timestamp": "2026-07-07T00:00:00.000Z",
  "email": "a@b.co | null",
  "name": "… | null",
  "phone": "… | null",
  "results_url": "https://<app-origin>/q/<id>/results?session_id=… | null",
  "answers": [
    {
      "question_id": "…",
      "question_text": "…",
      "answer_ids": ["…"],
      "answer_texts": ["…"],
      "tags": ["…"]
    }
  ],
  "accumulated_tags": ["…"],
  "recommended_product_ids": ["…"],
  "recommended_product_titles": ["…"]
}
```

When the action has a shared secret configured, **two** auth headers are sent:

- `X-Quizocalypse-Secret` — the shared secret verbatim (legacy; kept).
- `X-Quizocalypse-Signature` — `sha256=<hex HMAC-SHA256(raw_body, secret)>`,
  computed over the exact raw body bytes sent.

Receiver verification (Node):

```js
const crypto = require("node:crypto");

function verify(rawBodyBuffer, signatureHeader, secret) {
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", secret).update(rawBodyBuffer).digest("hex");
  return (
    signatureHeader.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected))
  );
}
```

Hash the bytes **as received** (before any JSON parse/re-serialize), and use a
constant-time compare.
