# Quizocalypse — repo guide for agents

AI-first Shopify quiz app, developed almost entirely by Claude agents. This file
complements the global `~/CLAUDE.md` (stack rules: Zod at boundaries, no `any`,
pino, strict TS, etc. — those apply here and are not repeated). Read this whole
file before your first edit; every rule below has shipped-code or incident
history behind it.

## Architecture map (one screen)

**The doc model is the product.** A quiz is ONE JSON document validated by
`app/lib/quizSchema.ts` (`Quiz`): nodes (`intro | question | email_gate |
result | message | end | branch | ask_ai | integration | product_cards`),
edges, design tokens, rec-page settings. 13 question types
(`QuestionType` enum, quizSchema.ts:7).

- **Edit**: pure functions in `app/lib/quizMutations.ts` transform the doc —
  no I/O, unit-tested. UIs call mutations, never hand-edit JSON.
- **Autosave**: `app/components/studio/useQuizDraft.ts` — 700 ms debounced,
  whole-doc JSON `PUT` to the route action. All studio shells share it.
- **Publish**: `app/lib/quizPublish.ts` — validation gate (`PublishError`
  blocks), bakes `product_index`, `published_at`, `version`, `shop_domain`
  (+ `target_product_ids_map`/`target_index` on decider docs), and strips
  draft-only state (`build_session`, `review_enrichment_sources`,
  `why_copy_meta`, `path_report_ai`) into `Quiz.publishedJson`.
- **Serve**: `/q/:id` reads `publishedJson`, applies `?locale=` server-side,
  then strips `translations` from the client doc. `/q/:id.json` serves
  `stripPublicJsonPayload(publishedJson)` (drops `review_enrichment_sources` +
  `translations`), CORS-open, 60 s cacheable. `QuizRuntime`
  (`app/components/runtime/QuizRuntime.tsx`) is server-free after load; theming
  is inline `--qz-color-*` CSS variables. `/q` loads ONLY
  `app/styles/quiz-runtime.css` — never the admin sheet (BIC-2 B1).

**THE DUAL-MODEL SPLIT (the most important invariant).**
`Quiz.logic_model: z.enum(["decider"]).optional()` (quizSchema.ts:1331).
Absent = legacy points/ladder doc; `"decider"` = the v2 one-decider engine.
**Every new behavior must be decider-gated; legacy docs stay byte-identical.**
New schema fields are `.optional()` — never `.default()` (a default rewrites
every legacy doc on the next parse-save round-trip).

**The funnel stage machine.** Standalone creation is a 5-step funnel driven by
`Quiz.build_session.stage` (`app/lib/funnelStages.ts`): `grouping` →
`shape` (transient AI stages `typing`/`types`/`templating` map onto it) →
`question_builder` → `rec_page` → `design`. AI generation runs as detached
server jobs; the client polls and renders `gen_progress` checkpoints. Stall
backstop exists: `genStalled` (`step1Funnel.server.ts`, ~200 s `updatedAt`
threshold) + the `retry-gen` intent.

**Two admin surfaces, one server seam.** Standalone `/studio` (magic-link auth
via `studioMagicLink.server.ts`, allowlist `STUDIO_ALLOWED_EMAILS`; legacy
`?key=` break-glass; 7-day cookie; `/studio/logout`) and embedded `/app`
(Shopify OAuth). Both call the shared `*ForShop` server functions — fix logic
there, not per-surface.

## Working agreements (proven over ~40 consecutive deploys)

- **Gate chain — strict, UNPIPED `&&`, run before every commit:**
  `npm run typecheck && npm test -- --run && npm run build && npm run lint && node scripts/check-tokens.mjs`
  A `;` chain once shipped type errors that 500'd production SSR.
- **Commit to main, no PR** (deliberate pre-production posture; see
  `scripts/ship.sh`). CI (`.github/workflows/ci.yml`) re-runs the gates, deploys
  to Fly (`quizocalypse-studio`), waits for health, runs the post-deploy e2e
  smoke (`npm run e2e || npm run e2e`), and **auto-rolls back** to the previous
  image if the smoke fails. Watch runs UNPIPED: `gh run watch <id>
  --exit-status` — piping to `tail` masks the exit code (a failed deploy once
  read as success).
- **The byte pin.** After EVERY deploy:
  `curl -sS https://quizocalypse-studio.fly.dev/q/cmqqcb0ao004mqvkwjug7t0ya.json | shasum -a 256`
  — first 16 chars MUST be `c02ccaec98a0fe9e`. That quiz is a published legacy
  doc that must never change unless deliberately republished (never republish
  it). This is the dual-model invariant made checkable.
- **2-lens adversarial self-review** (written, in your report) for anything
  touching runtime, persistence, or auth. Nearly every reviewed phase caught a
  real major this way.
- **`app/components/runtime/**` is the highest-risk edit class.** Decompose,
  don't rewrite; prove DOM-identical (render the same doc on the local build
  and the pre-change deploy, diff normalized outerHTML). `/q` HTML changes need
  the full e2e + screenshot review.

## Landmines (each has bitten before)

- `set -a; source .env; set +a` in EVERY Bash block — env does not persist
  between tool calls; missing it looks like a 401/app bug.
- `.env`'s `SHOPIFY_API_KEY`/`SHOPIFY_API_SECRET`/`SHOPIFY_APP_URL` are EMPTY
  **on purpose**. A local prod server needs inline placeholders:
  `SHOPIFY_API_KEY=x SHOPIFY_API_SECRET=x SHOPIFY_APP_URL=http://localhost:3000 npm run start`
- Local `.env` `DATABASE_URL` ≠ the Fly deploy DB. Fixtures never cross. Local
  fixture: `cmr7khgd50001vkhscvox8dgt`. Deploy fixtures: `cmqwd15f…`,
  `cmr3ku9kb…`, `cmr0tattc…`, `cmr9gir03…` (round-trip), and the byte-pinned
  `cmqqcb0ao…`. Mirror cross-env state via HTTP intents, not prisma.
- Lockfile: regenerate with `npx npm@10 install --package-lock-only` (CI is
  node 20.19 / npm 10; a newer local npm writes an incompatible lock).
- After `git add`, assert `git status --short` shows nothing unexpected
  staged/unstaged BEFORE committing — a fatal pathspec aborts the whole add
  while subagent `git rm` deletions stay staged (a deletions-only broken
  commit once shipped).
- NEVER print `STUDIO_ACCESS_TOKEN` (probe auth: `?key=` → cookie). Never
  force-push main.
- Interactive-state bugs (drawers, pickers, hover) need screenshots — a 200 +
  DOM markers is not proof; a pointer-trapped overlay renders fine and is
  unclickable.
- Prisma migrations are HAND-AUTHORED (`prisma/migrations/…`). Never run
  `prisma migrate dev` against any shared DB; write the SQL, ship via
  `migrate deploy` (runs at boot).

## Deliberately legacy vs actually dead

Do NOT delete these — they look dead and are not:

- `app/components/questionsLogic/` serves **legacy points-model docs** by
  design (QL3-P5 removed only the decider branch). `Tier1CheckList` and
  `usePathQuality` in that folder are live dependencies of
  `questionsLogicV3/HealthPopover`. Relocation fine; deletion no.
- The `pick` intent 400s on decider docs **on purpose** (closed trapdoor).
- Legacy schema fields stay parsed forever: `collect_email_on_result` is read
  by the legacy runtime path; `hero_logic: "match"` stays parsed + rendered
  for legacy published docs. Deprecate in docs/UI only; never delete the parse.
- Legacy engine code (`walkLadder`, `pickPointsWinner`, `ensureQuizDiscount`)
  is never removed — decider docs just never write it.

Safe to delete: the stale probes `e2e/l2-5-verify.mjs` / `l2-6-verify.mjs`
(target a retired UI; task chip exists) and genuinely zero-importer exports —
verify with ts-prune + grep first.

## Key env knobs

| Var | Meaning |
|---|---|
| `SENTRY_DSN` | Error tracking. Code is live but dormant until set (owner input). |
| `LOG_LEVEL` | pino level, default `info` (`app/lib/log.server.ts`). |
| `AI_BUDGET_RUNTIME_DAILY_USD` | Per-shop daily ceiling on the PUBLIC rec-copy surface. Default `2`; `0` = enforcement off (`app/lib/aiBudget.server.ts`). |
| `AI_BUDGET_MERCHANT_DAILY_USD` | Per-shop daily ceiling on merchant-invoked AI (funnel gen, why-copy, path-quality). Default `10`; `0` = off. |
| `STUDIO_ALLOWED_EMAILS` | Magic-link allowlist for `/studio` login. |
| `STUDIO_SESSION_SECRET` | Signs studio session cookies (falls back to `STUDIO_ACCESS_TOKEN`). |
| `STUDIO_ACCESS_TOKEN` | LEGACY `?key=` break-glass — kept while magic-link auth is being confirmed for all users; removal is owner-gated (A5). |
| `RESEND_API_KEY` / `GMAIL_SMTP_*` / `STUDIO_EMAIL_FROM` | Magic-link email delivery (Resend preferred; Gmail SMTP fallback). |
| `DEV_SHOP_DOMAIN` / `STUDIO_MODE` | Which shop the standalone surface manages; `STUDIO_MODE=standalone` = non-Shopify workspace. |

**Model choices are code constants, not env** (`app/lib/ai/client.ts`; the
AI surfaces re-export through the `app/lib/claude.ts` barrel):
`MODEL = claude-sonnet-4-6` for question builds/edits/research;
`MODEL_SPEED = claude-haiku-4-5` for the funnel's type/template middle passes.
The Haiku middle passes are **owner-approved via side-by-side comparison** —
do not "fix" them back to Sonnet as a quality hunch.

## Verification toolbox

- Probe library + fixture map + seed/restore contracts: **`e2e/README.md`**.
  Read it before writing any live verification — the recipes (autosave PUT,
  publish intent, funnel intents, fixture seeding) are all documented there.
- Public HTTP surface (shapes, rate limits, webhook signature):
  `docs/public-api.md`.
- "Create with AI" producing nothing usually = Anthropic credits depleted —
  check Fly logs for `400 credit balance too low`, not the app code.
