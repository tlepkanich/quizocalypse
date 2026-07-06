# e2e/ — CI specs + the living probe library

Two kinds of files live here. **Playwright specs** (`*.spec.ts`) run via
`npm run e2e` — CI executes exactly that post-deploy against the live Fly app
and auto-rolls back on red. **Verification probes** (`*-verify.mjs`,
`node <file>`) are the one-shot, seed/restore harnesses each program shipped
with; they are kept because they are the fastest way to re-verify a surface
and they document the working HTTP/prisma recipes (autosave PUT, publish
intent, funnel intents, fixture seeding).

## Running the smoke locally

```sh
set -a; source .env; set +a          # STUDIO_ACCESS_TOKEN etc. (never print it)
npm run e2e                          # against the live deploy (default base)
SMOKE_BASE=http://localhost:3000 npm run e2e   # against a local prod build
```

A local prod server needs inline placeholder Shopify env (the `.env` values
are deliberately empty): `SHOPIFY_API_KEY=x SHOPIFY_API_SECRET=x
SHOPIFY_APP_URL=http://localhost:3000 npm run start`. The local `.env`
`DATABASE_URL` is **not** the deploy DB — local fixtures and deploy fixtures
never cross.

### Env contract

| Var | Effect |
|---|---|
| `SMOKE_BASE` | Base URL (default `https://quizocalypse-studio.fly.dev`). |
| `STUDIO_ACCESS_TOKEN` | Studio `?key=` break-glass. Unset → the analytics + builder round-trip tests **skip** (GitHub CI has no studio secret today, so they skip there and run under `scripts/ship.sh`, which sources `.env`). Never echo it. |
| `SMOKE_QUIZZES` | Override the two published walk fixtures (`label:id,label:id`). |
| `SMOKE_PP_QUIZ` | Product-analytics leaderboard quiz (default `cmqwbjef4001gqvl1gpr2hrzx`). |
| `SMOKE_RT_QUIZ` | Round-trip fixture (default `cmr9gir030026oml1e0v5rwij`, live deploy). |
| `SMOKE_SHOTS=1` | Turn ON screenshot regression asserts in `runtime-smoke.spec.ts`. |
| `RT_LOCAL=1` | Opt into the full create→delete lifecycle test (local prod build + local DB only). |
| `RT_BOOTSTRAP=1` | One-time round-trip fixture bootstrap (manual; see below). |

## CI specs

### runtime-smoke.spec.ts
Walks the two published fixtures (`a:cmq566eof…`, `b:cmq5bugkn…`) intro→result
at mobile+desktop with hydration-error, progress-trail, overflow and
column-layout asserts; locale contract (`?locale=fr`/unknown-falls-back);
product-analytics leaderboard aggregation (needs the studio token). Screenshots
always land in `e2e/shots/` (gitignored, debugging aid).

**Screenshot regression** (`SMOKE_SHOTS=1`): every step × viewport is also
compared to a committed baseline in `e2e/runtime-smoke.spec.ts-snapshots/`
(`maxDiffPixelRatio 0.02`, animations disabled, reduced-motion emulated).
Baselines are **platform-suffixed** (`…-darwin.png` committed). CI is linux and
has **no linux baselines yet, so CI must not set `SMOKE_SHOTS`** — a naive
always-on compare would fail on font rendering alone and trigger a false
rollback.

- **Re-bless (darwin, after an intentional /q visual change):**
  `set -a; source .env; set +a; npm run e2e:bless-shots` — then eyeball the
  diff of the changed PNGs before committing.
- **Turning it on in CI (the follow-up):** run once on a linux runner with
  `SMOKE_SHOTS=1` + `--update-snapshots` (a manual `workflow_dispatch` job that
  uploads `e2e/runtime-smoke.spec.ts-snapshots/*-linux.png` as artifacts),
  commit those, then add `SMOKE_SHOTS: "1"` to the post-deploy smoke step's
  env. Until both halves are done, CI runs the walk without image compares.

### builder-roundtrip.spec.ts
The create→edit→publish→serve regression lock (BIC-2 D1).

- **Default test (runs wherever the studio token is set):** on the dedicated
  live fixture `e2e-roundtrip-fixture` (`cmr9gir030026oml1e0v5rwij`) — autosave
  PUT a nonce'd base doc → real publish intent → `/q` + `/q/:id.json` serve it
  → ONE real-UI edit (BLD-2b inline canvas edit: dblclick → type → Enter →
  autosave) → draft-vs-published isolation assert → publish → the edit serves
  → draft snapshot restored in `finally`, gallery count asserted unchanged.
  A **name-prefix write-guard** runs before the first write, so a mispointed
  `SMOKE_RT_QUIZ` can never touch a real quiz.
- **Why a fixed fixture, not create+delete per run:** the standalone studio
  deliberately exposes **no quiz-create-without-AI and no quiz-delete over
  HTTP** (`/studio/new` is redirect-gated behind `SHOW_OTHER_BUILD_PATHS =
  false`; `prisma.quiz.delete` exists only on the embedded Shopify-auth
  surface). Reusing one named fixture gives zero gallery growth by
  construction.
- **AI-cost discipline:** publish bakes why-bullets/tooltips via Claude for
  nodes missing them — every doc this spec writes carries them pre-filled, so
  its publishes are AI-free.
- **`RT_LOCAL=1` test:** the full create→edit→publish→serve→**delete**
  lifecycle against a local prod build, creating the row with prisma exactly
  as the flag-gated template intent would (also the only publish/serve lock
  the `quizTemplates` library has). Pre-run sweep deletes `e2e-roundtrip-run-*`
  leftovers.
- **`RT_BOOTSTRAP=1` test (manual):** re-creates the live fixture if it is
  ever deleted/renamed: claims a **pristine** funnel front-door draft (refuses
  an in-flight one), bakes the skincare template, renames, graduates,
  publishes a baseline, prints the id to pin. Update `RT_QUIZ` in the spec (or
  set `SMOKE_RT_QUIZ`).

## Probe library (`node e2e/<file>`, after sourcing .env)

**Fixture map:** local-DB-only fixture `cmr7khgd50001vkhscvox8dgt` (decider
draft parked at grouping — seed/restore via prisma). Deploy-only fixtures:
`cmqwd15f0001aqvl19onkpwm6` (decider smoke, published), `cmr3ku9kb0014qvl1ub8n5092`
(funnel-built published decider), `cmr0tattc001lqvl075wc1lnh` (legacy w/ 3
result pages), `cmqqcb0ao004mqvkwjug7t0ya` (the **byte-pinned** published
legacy quiz — `sha256 /q/….json` first 16 = `c02ccaec98a0fe9e`; read-only
pin, never republish), plus the "O3 Probe Terrain Finder" SavedTemplate.

| Probe | Covers | Fixture / base | Contract |
|---|---|---|---|
| `builderv3-verify.mjs` | V3 standalone builder chrome (top bar, health pill, tri-state Publish, rail, ⋯ menu, inspector, inline-edit cancel, blocks palette, Logic view, dark, axe) | LOCAL build + `cmr7khgd5…` | read-only (Escape-cancelled edits; net-zero block add/reset) |
| `fast-verify.mjs` | FAST funnel latency program: research prefetch/cache, gen_progress checkpoints, full funnel walk | LOCAL build + `cmr7khgd5…` | prisma seed/restore |
| `fast-sidebyside.mjs` | Sonnet-vs-Haiku quality gate for the two middle funnel AI passes (direct server-fn calls) | local, real AI spend | one-shot report; no doc writes |
| `a3-budget-verify.mjs` | BIC-2 A3 per-shop AI budget ceilings (record + refusal matrix) | LOCAL build + `cmpuov6yc…`, `cmr7khgd5…` | prisma seed/restore |
| `step3v3-p1…p5-verify.mjs` | Step-3 v3 shell/content/logic/health/flip (P5 also proves legacy DOM-identical vs live) | LOCAL build + `cmr7khgd5…` (P5 also touches live `cmqwd15f…`, restores byte-identically) | prisma seed/restore; P5 mirrors via HTTP |
| `o3-verify.mjs` | Decider-native saved templates (front-door draft, save/use-saved-template, retry-gen backstop) | LIVE; self-seeds; `cmqqcb0ao…` byte pin | graduates its drafts; real AI |
| `o2-verify.mjs` | Image-density renderer (density 15/decorative hides, explicit intent wins) | LIVE `cmqqcb0ao…` draft-only | doc backup/restore; byte pin proves /q untouched |
| `sr-verify.mjs` | Start-routing spec (intercept modal, three routes) | LIVE, `cmqqcb0ao…` pin | restore |
| `rs-verify.mjs` | Step-1 Recommendations spec (copy, rail, no "bucket" leakage) | LIVE, `cmqqcb0ao…` pin | restore |
| `shape-scope-verify.mjs` | Funnel AI grounds in CHOSEN buckets at both gen layers (65c55a5) | LIVE; real AI | restore |
| `l2-8-verify.mjs` | Step-4 v2 rec-page builder (targets, overrides, validate-discount) | LIVE `cmqwd15f…` | doc backup/restore |
| `l2-9-verify.mjs` | Runtime cutover: publishes the decider smoke fixture; legacy byte pin | LIVE `cmqwd15f…` + `cmqqcb0ao…` | converted the fixture (historical) |
| `l2-10a-verify.mjs` | Preview bake + default-target affordance + one-edge-per-handle | LIVE `cmqwd15f…` | publish + restore-publish |
| `l2-10d-verify.mjs` | THE FUNNEL FLIP end-to-end (front door → buckets → tier-1 → build → publish) | LIVE; real AI (slow, ~minutes) | graduates its draft |
| `l2-10f-verify.mjs` | Legacy→decider upgrade wizard | LIVE `cmr0tattc…` | draft backup/restore |
| `l2-11-verify.mjs` | Config-time grounded AI why-copy panel (sparse persist, lock, stale hash) | LIVE `cmr3ku9kb…`; real AI | restore |
| `l212b-verify.mjs` | Runtime per-shopper rec-copy endpoint + client race | LIVE `cmr3ku9kb…`; real AI | publish/restore |
| `l212c-verify.mjs` | Tier-2 AI path-quality review endpoint | LIVE `cmr3ku9kb…`; real AI | restore |
| `l212d-verify.mjs` | Rec-copy kill-switch toggle (Shop.aiRecCopyEnabled) + FALSE-path | LIVE `cmr3ku9kb…` | toggles back ON |
| `l2-5-verify.mjs` | **STALE — delete candidate** (task chip exists): drives the v2.x decider Step-3 UI retired by QL3-P5 | LIVE `cmqwd15f…` | — |
| `l2-6-verify.mjs` | **STALE — delete candidate** (same): v2.x Rules surfaces retired by QL3-P5 | LIVE `cmqwd15f…` | — |

(`l2-7-verify.mjs` was already deleted in QL3-P5; its coverage lives in
`step3v3-p4/p5`.)

## Cleanup discipline (the live deploy is production)

Probes/specs that write to the deploy must snapshot-and-restore in a
`finally`, scope writes to the named fixtures above, keep the byte pin
(`c02ccaec98a0fe9e`) green, and never leave new quizzes in the gallery
(the round-trip spec asserts its own gallery-count invariant). The old
`e2e/shots-baseline/` directory (untracked, unused since June) was removed
when the Playwright-managed `*-snapshots/` baselines landed.
