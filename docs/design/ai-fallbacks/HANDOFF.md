# AI generation — master fallback spec

Every surface in the app that calls Claude must route its failures through the
same ladder. Today they don't: some strand the user silently, some leak raw
Anthropic error text ("your credit balance is too low") straight to shoppers,
and several spend with no ceiling at all.

This doc defines the standard, maps every AI surface to it, and lists the gaps
to close. UI for every state is mocked in
[`ai-fallback-states.html`](./ai-fallback-states.html); the full-page job states
are in [`../step1-recommendations/generating-states.html`](../step1-recommendations/generating-states.html).

---

## 1. The fallback ladder (applies to EVERY AI call)

In order. A surface may skip a rung only if it's physically impossible, never
because it wasn't thought about.

1. **Retry transient errors automatically.** 429 / 500 / `overloaded` → bounded
   backoff retry. *Today no surface does this* — `MAX_ATTEMPTS` in
   `ai/client.ts:83` only re-prompts on Zod/tool-use failure; an API throw on
   attempt 1 escapes immediately.
2. **Time out.** Every call gets a server-side deadline. *Today the Anthropic
   client is built with no timeout (`ai/client.ts:29`)* — a hung call blocks
   until the SDK's 10-minute default.
3. **Degrade to a non-AI result** if one exists (deterministic assignment,
   merchant's own template copy, cached prior result, empty-but-valid).
4. **Tell the user, in our words.** Never render `err.message`. Map to one of
   four merchant-facing classes: `unavailable` · `busy` · `limit_reached` ·
   `failed`.
5. **Always offer a way forward.** Retry, or an explicit non-AI path
   ("Start from a template", "Write it yourself"). Never a dead end.
6. **Never strand.** No spinner without a stall backstop. No "success" state
   that is secretly empty.
7. **Record the spend.** Every call goes through `createMessage` so it lands in
   the budget ledger.

### Copy rules

| Cause | Merchant sees | Shopper sees |
|---|---|---|
| API error / overloaded | "AI is busy right now — try again." | nothing (silent fallback) |
| Credits depleted | "AI is temporarily unavailable." + non-AI path | nothing (silent fallback) |
| Daily budget ceiling | "You've hit today's AI limit. Resets tomorrow." + non-AI path | nothing (silent fallback) |
| Invalid output (Zod) | "That didn't come back usable — try again." | nothing (silent fallback) |
| Stalled | "This is taking longer than it should." + Retry + template escape | n/a |

**Never** expose: billing state, model names, provider names, raw exception text,
stack traces, token counts.

**Shopper-facing surfaces never show an AI error.** They degrade to the
merchant's authored content, silently. `rec-copy` already does this correctly
(`QuizRuntime.tsx:481-528`) — it's the reference implementation.

---

## 2. Surface map

| # | Surface | File | Facing | Mode | State today |
|---|---|---|---|---|---|
| 1 | Quiz **type cards** + web research | `step2Build.server.ts:311` | Merchant | Detached job | ✅ Good — budget check, `gen_error`, retry, 200s stall backstop |
| 2 | **Battle-card templates** | `step2Build.server.ts:378` | Merchant | Detached job | ✅ Best in repo — adds `failMode: blank_questions` |
| 3 | **Question flow + logic** | `step2Build.server.ts:687` → `onboardingBuild.server.ts:132` | Merchant | Detached job | 🔴 **SILENT STRAND — see Gap 1** |
| 4 | Runtime **rec-copy** | `q.$id.rec-copy.tsx` | Shopper | Inline | ✅ Reference impl — 5s abort, silent fallback to template copy |
| 5 | Runtime **ask_ai chat** | `q.$id.ai-chat.tsx` | Shopper | Inline | 🔴 No budget ceiling; **leaks raw errors to shoppers** |
| 6 | **Why-copy** generate | `api.generate-why-copy.tsx` | Merchant | Inline | ✅ Budget + credits + generic error triage |
| 7 | **Path-quality** review | `api.path-quality.tsx` | Merchant | Inline | ✅ Advisory only, never gates publish |
| 8 | **Editor AI intents** (regenerate-node, generate-questions, ai-edit, enrich-reviews, translate) | `quizEditorIO.server.ts:373,527,620,696,785` | Merchant | Inline | 🔴 No budget, **raw errors surfaced**, no retry, no fallback |
| 9 | Publish **benefit bullets + tooltips** | `quizPublish.ts:548,561` | Merchant | Inline | ⚠️ Degrades fully silently — merchant never told |
| 10 | **Brand identity** build | `brandIdentityBuild.server.ts:316` | Merchant | Detached job | ⚠️ Visible banner + re-run, but **raw error leak** and **no stall backstop** (polls forever) |
| 11 | **Tag enrichment** | `enrichTags.ts:115` | Merchant | Inline | ⚠️ Marks failed products as enriched → never retried |
| 12 | **Bucket discovery / product assignment** | `categoryDiscover.ts:106,235` | Merchant | Inline | ✅ Has a real deterministic fallback (`assignProducts`) |
| 13 | **Brand guidelines from PDF** | `brandExtract.ts:180` | Merchant | Inline | ⚠️ Raw `err.message` to merchant |

---

## 3. Gaps to close (ranked)

### 🔴 Gap 1 — Question-flow failure looks like SUCCESS (highest priority)
`onboardingBuild.server.ts:363-370` catches its own AI failure and **resolves**
with `{ quizId, degraded: "..." }`. **Nothing in the codebase reads `degraded`.**
The funnel's `.then()` (`step2Build.server.ts:746`) therefore treats it as a win:
stage → `question_builder`, `built: true`, `gen_error: undefined`.

**Result:** when Claude fails on the most expensive pass, the merchant is dropped
into the Question Builder with an **empty, question-less quiz** — no banner, no
retry, no explanation. Same in `step1Build.server.ts:193-223`.

**Fix:** read `degraded`. If set → write `gen_error`, keep the user on the
generating screen, show the **Failed** state with Retry + template escape.

### 🔴 Gap 2 — Raw Anthropic errors reach users
Three places render `err.message` verbatim:
- **Shoppers:** `q.$id.ai-chat.tsx:144` → `AskAIView.tsx:212`. On credit
  exhaustion a shopper literally reads *"your credit balance is too low."*
- **Merchants:** every editor intent (`quizEditorIO.server.ts:375,539,630,704,793`).
- **Merchants:** `buildState` / `brandIdentityState` `"error:${raw}"` payloads
  (`onboardingBuild.server.ts:499`, `brandIdentityBuild.server.ts:392`) rendered
  by `studio_.$id.tsx:175` and `BrandIdentityReview.tsx:110`.

**Fix:** map every catch to the four copy classes in §1. Log the detail; never
render it.

### 🔴 Gap 3 — `ask_ai` has no spend ceiling
`q.$id.ai-chat.tsx` calls `withAiSpendRecording` but **never `checkAiBudget`**.
It is shopper-facing and unbounded per shop per day; `AI_BUDGET_RUNTIME_DAILY_USD`
does not cover it. A single quiz could burn the account.

**Fix:** apply the runtime ceiling. On exceed → the chat degrades to a static
"chat is unavailable right now" and the quiz continues.

### 🟠 Gap 4 — No editor-intent budget enforcement
`quizEditorIO.server.ts:209` says so explicitly. regenerate-node,
generate-questions, ai-edit, enrich-reviews, translate can spend past
`AI_BUDGET_MERCHANT_DAILY_USD` indefinitely.

### 🟠 Gap 5 — No server-side timeout, no transient retry
`ai/client.ts:29` builds the client with no `timeout` and no `maxRetries`. A hung
call holds an inline request (or a detached job) for up to 10 minutes. And
because `MAX_ATTEMPTS` only re-prompts on Zod failure, a transient 429/500 fails
the whole generation on the first try.

**Fix:** set a timeout on the client, and wrap API throws in a bounded backoff
retry before giving up.

### 🟠 Gap 6 — Stall backstops don't cover every job
`funnelLoader.server.ts:212` only covers stages `typing` / `templating`.
Uncovered:
- `buildState: "building"` — studio shows a "Taking too long?" link but never an
  error state.
- `brandIdentityState: "building"` — **polls forever**, re-run button disabled.

**Fix:** one shared stall rule for every detached job. Recommend **45–60s**, not
the current 200s — with research cached, a healthy run is seconds, so a minute of
silence already means something broke.

### 🟡 Gap 7 — Silent quality degradation with no trace
Publish-time tooltips/benefits (`quizPublish.ts:552,565`), web research
(`generation.ts:681`), and tag enrichment all fail to empty with no merchant
signal. Tag enrichment additionally **marks failed products as enriched**
(`api.products.enrich.tsx:159`), so they're permanently skipped.

**Fix:** these should still degrade (don't block publish), but leave a quiet,
dismissible trace — "Published without AI tooltips. Regenerate →" — and stop
marking failed enrichment as done.

### 🟡 Gap 8 — Budget ledger blind spots
`enrichTags.ts`, `categoryDiscover.ts`, `brandExtract.ts`, and
`brandIdentityBuild.server.ts:245` construct their own Anthropic clients and
bypass `createMessage`, so their spend is **never recorded** and counts against
no ceiling.

**Fix:** route every AI call through `createMessage`.

### 🟡 Gap 9 — `checkAiBudget` fails open
`aiBudget.server.ts:131-138` — a Postgres hiccup on the `AiUsage` table disables
**all** spend ceilings, including the shopper-facing one. Fail closed on the
runtime surface, or at least alarm.

---

## 4. States the UI must have

Mocked in `ai-fallback-states.html`.

**Full-page job** (types, templates, questions, brand identity) — see
`generating-states.html`:
- Working (fast) · Working (slow, research running) · Stalled · Failed

**Inline AI action** (why-copy, editor intents, regenerate):
- Working (button spinner, existing content untouched)
- Failed → inline message + Retry, existing content preserved
- Limit reached → "Today's AI limit is reached. Resets tomorrow." + the manual path
- Unavailable → "AI is temporarily unavailable." + the manual path

**Shopper-facing** (rec-copy, ask_ai):
- Never an error. rec-copy → merchant's template copy. ask_ai → a static
  "chat isn't available right now" bubble; the quiz always continues.

**Silent degrade notice** (publish without tooltips, research skipped):
- Quiet dismissible strip on the affected surface, with a regenerate action.
