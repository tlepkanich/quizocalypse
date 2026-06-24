# Changelog

Autonomous ship log. The **Quiz Maintainer** routine prepends one entry per run
(newest first) recording what it shipped from the Google Drive specs. Hand-written
notes are welcome above the auto entries.

<!-- routine: insert each run's entry directly below this line, newest first -->

## 2026-06-24 — question-builder + recommendation-page partial ship (autonomous)

### Shipped
- **Question Builder (question-builder-spec.md)**
  - Char counters on question text (150 char limit) and answer options (60 char limit), color-coded at 80%/95% fill (`ContentTab.tsx`)
  - Required / Optional segmented toggle reads and writes `node.data.required` (`ContentTab.tsx`)
  - AI Regenerate button surfaces the existing `intent=regenerate-node` action with a ~10s undo buffer (`ContentTab.tsx`)
  - Soft "4–8 questions" count nudge in FlowRail left panel — shown when count < 4 or > 8 (`FlowRail.tsx`)
  - Duplicate question row action (⧉ button); `duplicateQuestion` re-stitches the default outbound edge (`FlowRail.tsx`, `quizMutations.ts`)
  - Autosave error state + Retry: `useQuizDraft` now surfaces `saveError` and `retry`; header shows "Unable to save — Retry" chip (`useQuizDraft.ts`, `UnifiedWorkspace.tsx`)
  - Autosave "Saved HH:MM" timestamp in the header (`UnifiedWorkspace.tsx`)
- **Recommendation Page (recommendation-page-spec.md)**
  - Product display toggles: Show Variants, Show Product Descriptions, Star Ratings placeholder (`ResultSettingsPanel.tsx`, `quizSchema.ts`)
  - Expanded sort order set: price_asc, price_desc, title_asc, title_desc, manually_curated added (`ResultSettingsPanel.tsx`, `quizSchema.ts`)
  - Page structure toggles: Results Summary Bar, Retake Quiz Link (`ResultSettingsPanel.tsx`, `quizSchema.ts`)
  - 4 new `ResultData` schema fields with backward-compatible defaults: `show_variants`, `show_product_descriptions`, `show_results_summary`, `show_retake_link`

### Deferred (next run)
- question-builder: add-above/below, Flow View toggle, Bucket Coverage Indicator, skip-logic rule builder, Question Bank drawer
- recommendation-page: per-section sub-filter, urgency stock signal, recommendation copy, per-section config
- recommendation-page items blocked on guardrails: discount (#3), Notify Me (#4), share-results (#5)

### Blocked — needs human decision
- **shape-your-quiz-spec.md** — entirely blocked on Guardrail #2 (four-card layout vs. live AI funnel). No code touched.

### Gate chain note
- `npm run typecheck` passes with zero code errors (two pre-existing env warnings: missing `@types/node`, deprecated `baseUrl`).
- `npm test` and `npm run build` could not run — `node_modules` absent and `registry.npmjs.org` unreachable from this ephemeral container. Recommend running gates on push via CI.

## 2026-06-23 — pipeline + control docs set up (manual)
- Autonomous CI/CD live: push to `main` → gates → Fly deploy → post-deploy e2e
  smoke → auto-rollback. (`ce72873`, `011fbe8`)
- Lockfile regenerated so `npm ci` passes on Linux. (`a7e294b`)
- Scope control added: `_roadmap.md` (Drive), `docs/spec-status.md`, this changelog.

_No autonomous spec runs yet — the first scheduled run records the first auto entry._
