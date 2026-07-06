# Quizocalypse

AI-first product-recommendation quiz app for Shopify (and standalone) stores.
A merchant describes their brand and goal; the app researches the brand, walks
them through a 5-step funnel (Recommendations → Shape → Question Builder →
Results page → Design), generates a complete quiz grounded in their real
catalog, and publishes it to a storefront-ready runtime with recommendations
driven by a deterministic decider engine.

**Shipped and live** (`quizocalypse-studio.fly.dev`): the full funnel with
detached AI generation jobs, a visual builder (canvas, inline editing,
inspector, logic view), the decider recommendation engine with AND-rules and
target-based result pages, a legacy points/ladder engine kept byte-compatible,
13 question types, i18n (`?locale=` on published quizzes), A/B branch splits,
analytics dashboards (funnel, products, revenue attribution), email capture,
Klaviyo + generic-webhook integrations (HMAC-signed), per-shop AI budget
ceilings, magic-link auth for the standalone studio, and a Shopify-embedded
admin twin. Runtime pages are SSR'd, hydration-clean, and themable via design
tokens.

Two admin surfaces share one server seam: **`/studio`** (standalone,
magic-link auth) and **`/app`** (embedded, Shopify OAuth).

## Quickstart

```sh
brew install postgresql@16 && brew services start postgresql@16
createdb quizocalypse_dev
npm install
cp .env.example .env      # fill DATABASE_URL, ANTHROPIC_API_KEY, TOKEN_ENCRYPTION_KEY, studio auth vars
npm run setup             # prisma generate && prisma migrate deploy
```

Then either:

- **Embedded Shopify dev**: `npm run dev` (Shopify CLI tunnel; needs a Partner
  app linked via `npm run config:link` — this fills the `SHOPIFY_*` vars).
- **Standalone studio against a local prod build** (the `SHOPIFY_*` vars in
  `.env` are empty on purpose; pass placeholders inline):
  ```sh
  npm run build
  SHOPIFY_API_KEY=x SHOPIFY_API_SECRET=x SHOPIFY_APP_URL=http://localhost:3000 npm run start
  ```
  Visit `/studio` (magic-link login, `STUDIO_ALLOWED_EMAILS`).

## Verification

Gate chain (strict, unpiped `&&` — run before every commit):

```sh
npm run typecheck && npm test -- --run && npm run build && npm run lint && node scripts/check-tokens.mjs
```

- `npm test` — 1,000+ vitest unit/integration tests.
- `npm run e2e` — Playwright specs against the live deploy by default
  (`SMOKE_BASE=http://localhost:3000` for a local prod build).
- `e2e/*-verify.mjs` — the living probe library (one-shot live-surface
  verifications with seed/restore contracts). See **`e2e/README.md`**.
- Byte pin: after every deploy, `/q/cmqqcb0ao004mqvkwjug7t0ya.json` must hash
  to `c02ccaec98a0fe9e` (first 16 of sha256) — proves legacy published quizzes
  are untouched.

## Deploy

Push to `main` → GitHub Actions (`.github/workflows/ci.yml`) re-runs the gates,
deploys to Fly (`quizocalypse-studio`, health-gated via `GET /health`), runs
the post-deploy e2e smoke against the live app, and **auto-rolls back** to the
previous image if the smoke fails. Releases are intentionally PR-less
pre-production; flipping to PR-gated is documented and owner-gated.

## Status

| Area | State |
|---|---|
| Funnel, builder, decider engine, runtime, i18n, A/B, analytics, integrations | Shipped, live-verified |
| Observability (pino JSON logs, `/health`, Sentry code) | Shipped; Sentry dormant until `SENTRY_DSN` is set (owner input) |
| Per-shop AI spend ceilings | Shipped (`AI_BUDGET_*_DAILY_USD`) |
| Billing / plans | Not built — owner decision (biggest standalone-SaaS gap) |
| Theme App Extension storefront placement | Code-complete; activation needs an attended `shopify app deploy` |
| Conversion webhook (revenue attribution) | Code-complete (`webhooks/orders/create`); needs `read_orders` consent + a real order |
| `?key=` break-glass studio auth | Legacy, kept while magic-link auth is confirmed for all users; removal owner-gated |

## Docs

- `CLAUDE.md` — agent workflow: architecture map, working agreements,
  landmines, what is deliberately legacy vs dead. **Read first if you are an
  agent working in this repo.**
- `docs/public-api.md` — the public/storefront HTTP surface (payload shapes,
  rate limits, webhook signature verification).
- `e2e/README.md` — CI specs + probe library, fixtures, seed/restore contracts.
- `CHANGELOG.md`, `docs/spec-status.md` — shipped-program history.

## Stack

Remix 2 (Vite) + Node 20 · React 18 · Postgres + Prisma 6 (quiz docs as JSONB)
· Zod at every boundary · Claude (`claude-sonnet-4-6`; Haiku for the funnel's
fast middle passes) via `@anthropic-ai/sdk` · pino · Playwright + Vitest ·
Fly.io (single always-on machine).
