# Spec status (auto-maintained)

The **Quiz Maintainer** routine REWRITES this file each run to mirror every spec
in the Google Drive specs folder and what it's done with each. Don't hand-edit —
steer scope and priority via `_roadmap.md` in Drive; this is the read-out.

Legend: ⬜ queued · 🔨 in progress · ✅ implemented · ⤵️ out of scope (per `_roadmap.md`) · ❓ needs decision

| Spec (Drive) | Status | Last action | Ref |
| --- | --- | --- | --- |
| recommendation-buckets-spec.md (Step 1) | ✅ implemented | shipped + live-verified (RB program) | `e95ad69` |
| recommendation-page-spec.md (Step 2) | 🔨 partial | Foundation built: per-bucket result pages, match-ladder source model, ranking + 1–12 counts, multi-stage sections, hide/show-badge OOS + fallback swap, real Shopify %/amount discount, headline/subtext, autosave. Queued in `_roadmap.md`: product-display toggles (Show-Variants / Descriptions / Star-Ratings placeholder / Urgency "Only X left"), full per-section Sort-Order set + Sub-Filter, results-summary bar + Retake. Gated (human): editable "Why we recommend" copy + per-product AI blurbs, discount depth, Notify-Me/back-in-stock, share-results URLs, making the global `fallback_collection_id` render. | triage 2026-06-24 |
| shape-your-quiz-spec.md (Step 3) | ❓ needs decision | The AI direction/battle-card funnel exists but as a LINEAR multi-stage flow, not the spec's single four-card page — a materially different product. Blocked on an owner call (four-card page vs the shipped funnel) AND the scoring-model decision (Direct vs Weighted) before any refactor. | triage 2026-06-24 |
| question-builder-spec.md (Step 4) | ✅ implemented (branch) | **`_roadmap.md` "Now" cluster shipped on `claude/question-builder-spec`:** char counters/limits (question 150 / answer 60) + Required/Optional toggle + soft 4–8 nudge; question row actions (Duplicate, Add above/below, number badge) via new spine-splice mutations; Bucket Coverage Indicator (green/yellow/red pills, hover counts); structured Skip-Logic rules (End-quiz target + conflict warnings) + read-only Flow View; studio-side per-question AI Regenerate with ~10s undo. Each pure helper unit-tested; full gate green locally. Gated (human, untouched): Direct-vs-Weighted scoring-model concept, open-text customer-metafield creation on publish. Pending: merge the branch. | branch 2026-06-25 |

_Files whose name starts with `_` (e.g. `_roadmap.md`) are control/meta docs, not specs._

> Note (2026-06-24): brought current manually. Bug-fix / chip sessions and the
> in-session audit loop ship fixes but don't run the routine's LOG step, so this
> read-out had lagged. The Step 2–4 statuses above are from a spec-vs-codebase
> triage, not a routine run — the routine will overwrite this on its next run.
