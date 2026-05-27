# Quizocalypse

Shopify-native AI quiz app. Merchant installs → describes a quiz goal in plain English → Claude generates a draft quiz from the merchant's real catalog → merchant edits visually → publishes to storefront.

This repo is the **bare proof-of-concept**: M1 (Shopify Connect) + M2 (AI Quiz Generator) end-to-end, plus static UI mocks of M3–M7 to demo the full MVP visual fidelity.

See [`docs/spec`](https://drive.google.com/drive/folders/1jgjBsfKXBgGXwlre_8ZrtOtIHgjUcRcP) (Google Drive `konnichiwa` folder) for the full Technical Specification and Engineer Handoff.

---

## What works today

- **M1 — Shopify Connect**: OAuth install, GraphQL bulk catalog sync, real-time webhook deltas (products / collections / inventory / app uninstall). Catalog normalized into Postgres.
- **M2 — AI Quiz Generator**: `POST /api/quizzes/new/generate` validates input with Zod, builds a scoped product index, calls Claude Sonnet with forced tool-use, validates output against the same Zod schema, retries ≤2x on schema failure.
- **Admin UI**: post-install dashboard with catalog stats + resync button, and a New Quiz screen (collection scope, goal prompt, question count) that pipes Claude output into a `<pre>` block for inspection.
- **Static mocks** (`/mocks/*`): Flow builder canvas (React Flow), Design editor, Recommendation mapping, Storefront runtime. None are connected to data — purely visual previews of the modules not yet implemented.

## What's deferred to later phases

- Visual flow builder (M4), Design editor (M5), Recommendation engine (M6), Theme App Extension storefront runtime (M7), Analytics + email capture (M8)
- OAuth token encryption at rest (crypto module written + tested, wrapper class implemented in `app/lib/encryptedSessionStorage.ts` but not wired due to a transitive shopify-api version conflict — see comment in `app/shopify.server.ts`)
- BullMQ job queue for async catalog sync (currently synchronous in the install callback)
- Real KMS for the encryption key (currently a local 32-byte env var)
- Version history / per-question regeneration
- App Store submission

---

## Local setup (one-time)

1. **Install Postgres**
   ```sh
   brew install postgresql@16
   brew services start postgresql@16
   createdb quizocalypse_dev
   ```

2. **Get a Shopify Partner account + dev store**
   - https://partners.shopify.com (free)
   - Create a development store inside the dashboard, seed it with 50+ test products

3. **Get an Anthropic API key**
   - https://console.anthropic.com → API Keys → Create
   - PoC budget: ~$5 covers hundreds of quiz generations on Sonnet

4. **Install the Shopify CLI**
   ```sh
   npm install -g @shopify/cli @shopify/app
   shopify auth login
   ```

5. **Link this repo to your Partner app**
   ```sh
   npm run config:link
   ```
   This populates `client_id` in `shopify.app.toml` and creates `.env` entries.

6. **Set up `.env`**
   ```sh
   cp .env.example .env
   ```
   Fill in:
   - `DATABASE_URL` — defaults to `postgresql://localhost:5432/quizocalypse_dev?schema=public`
   - `ANTHROPIC_API_KEY` — from step 3
   - `TOKEN_ENCRYPTION_KEY` — `openssl rand -hex 32`
   - Shopify keys are filled by `shopify app dev` on first run

7. **Apply the schema**
   ```sh
   npm run prisma -- migrate dev --name init
   ```

8. **Run the app**
   ```sh
   npm run dev
   ```
   The Shopify CLI starts a Cloudflare tunnel, prints an install URL. Install on your dev store. Catalog syncs synchronously in the post-install callback (≤60s for ~50 SKUs).

---

## Verification (end-to-end smoke test)

| Step | Expectation |
|---|---|
| `npm run typecheck` | No errors |
| `npm run lint` | No errors |
| `npm test` | 9 tests pass (crypto roundtrip + Quiz schema validation) |
| `npm run dev` → install on dev store | Dashboard shows catalog stats within ≤60s |
| Edit a product in Shopify admin | DB updates within 30s via webhook |
| **New AI quiz** → goal prompt → Generate | Returns valid quiz JSON in <15s |
| Visit `/mocks/flow-builder`, `/mocks/design-editor`, `/mocks/rec-mapping`, `/mocks/storefront` | All four render the hardcoded sample quiz |

---

## Layout

```
app/
├── routes/
│   ├── app._index.tsx              # post-install dashboard (real)
│   ├── app.quizzes.new.tsx         # AI generator UI (real)
│   ├── api.quizzes.new.generate.tsx  # Claude endpoint (real)
│   ├── webhooks.products.tsx       # (real)
│   ├── webhooks.collections.tsx    # (real)
│   ├── webhooks.inventory_levels.tsx
│   ├── webhooks.app.uninstalled.tsx
│   ├── webhooks.app.scopes_update.tsx
│   ├── mocks.tsx                   # /mocks/* layout
│   ├── mocks._index.tsx            # mocks index
│   ├── mocks.flow-builder.tsx      # M4 preview
│   ├── mocks.design-editor.tsx     # M5 preview
│   ├── mocks.rec-mapping.tsx       # M6 preview
│   └── mocks.storefront.tsx        # M7 preview (no Polaris)
├── lib/
│   ├── crypto.ts                   # AES-256-GCM (roundtrip-tested)
│   ├── quizSchema.ts               # Zod single source of truth + Claude tool JSON schema
│   ├── claude.ts                   # Anthropic SDK wrapper with retry
│   ├── catalogIndex.ts             # scoped product index for AI prompt
│   └── encryptedSessionStorage.ts  # OAuth token wrapper (deferred)
├── jobs/
│   └── catalogSync.ts              # Shopify bulk op runner
└── shopify.server.ts               # auth + afterAuth hook triggers sync
prisma/schema.prisma                # Shop, Product, Collection, Quiz, QuizVersion, Session
shopify.app.toml                    # scopes + webhook subs
```

---

## Stack

- **Backend**: Remix 2.16 + Node 20
- **Admin UI**: React 18 + Shopify Polaris 12 + React Flow (xyflow) for mocks
- **Database**: Postgres + Prisma 6 (JSONB for quiz / design tokens)
- **AI**: Claude Sonnet (`claude-sonnet-4-6`) via `@anthropic-ai/sdk` with forced tool-use for structured JSON
- **Validation**: Zod at every boundary

---

## Commands

```sh
npm run dev          # Start Shopify CLI dev tunnel + Remix dev server
npm run build        # Production build
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint
npm test             # Vitest run
npm run setup        # prisma generate && prisma migrate deploy
```
