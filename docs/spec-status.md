# Spec status (auto-maintained)

The **Quiz Maintainer** routine REWRITES this file each run to mirror every spec
in the Google Drive specs folder and what it's done with each. Don't hand-edit —
steer scope and priority via `_roadmap.md` in Drive; this is the read-out.

Legend: ⬜ queued · 🔨 in progress · ✅ implemented · ⤵️ out of scope (per `_roadmap.md`) · ❓ needs decision

| Spec (Drive) | Status | Last action | Ref |
| --- | --- | --- | --- |
| recommendation-buckets-spec.md | ✅ implemented | shipped earlier; re-verified live | `e95ad69` |
| question-builder-spec.md | 🔨 in progress | partial ship: char limits (150/60), required toggle, 4-8 count nudge, duplicate question, autosave error+retry UI, AI regen + 10s undo. Deferred: add above/below, Flow View, bucket coverage pills, skip-logic rule builder, question bank drawer | 2026-06-24 |
| recommendation-page-spec.md | 🔨 in progress | partial ship: product display toggles (variants, descriptions, star-ratings placeholder), full sort-order set (8 options), results-summary + retake-link toggles, 4 new schema fields. Deferred: per-section sub-filter, urgency stock signal (needs runtime), recommendation copy, discount config (Guardrail #3), Notify Me (Guardrail #4), share-results (Guardrail #5) | 2026-06-24 |
| shape-your-quiz-spec.md | ❓ needs decision | BLOCKED — Guardrail #2: replacing the live AI funnel with the four-card layout requires explicit human go-ahead per `_roadmap.md`. No code touched. | — |

_Files whose name starts with `_` (e.g. `_roadmap.md`) are control/meta docs, not specs._

## Deferred items (queued for next run or human decision)

### question-builder-spec.md
- **Add question above/below** — row actions in FlowRail; needs insert-at-index mutation
- **Flow View toggle** — read-only DAG in left panel; needs a lightweight SVG/dagre layout
- **Bucket Coverage Indicator** — green/yellow/red pills in right panel; client-side coverage calc
- **Structured Skip-Logic rule builder** — "Add rule" inline builder replacing bare edge routing
- **Question Bank drawer** — pre-seeded question templates; static seed data needed first

### recommendation-page-spec.md
- **Per-section Sub-Filter** — tag/collection narrow within bucket pool; data model + UI
- **Urgency "Only X left in stock"** — requires per-variant inventory baked at publish (today: boolean only)
- **Recommendation Copy system** — AI-generated per-bucket + per-product blurbs with variable tokens; large
- **Discount config** — Guardrail #3 (money-affecting Shopify discount API)
- **"Notify Me" OOS** — Guardrail #4 (new PII/email-capture surface)
- **Share-results URL** — Guardrail #5 (IDOR/tamper risk; security review required)
- **Section count + per-section config** — multi-section structure with labels; medium-sized

### shape-your-quiz-spec.md
- Everything — BLOCKED on Guardrail #2 (human must confirm spec supersedes live AI funnel)
