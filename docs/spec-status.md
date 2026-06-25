# Spec status (auto-maintained)

The **Quiz Maintainer** routine REWRITES this file each run to mirror every spec
in the Google Drive specs folder and what it's done with each. Don't hand-edit —
steer scope and priority via `_roadmap.md` in Drive; this is the read-out.

Legend: ⬜ queued · 🔨 in progress · ✅ implemented · ⤵️ out of scope (per `_roadmap.md`) · ❓ needs decision

| Spec (Drive) | Status | Last action | Ref |
| --- | --- | --- | --- |
| recommendation-buckets-spec.md (Step 1) | ✅ implemented | shipped + live-verified (RB program) | `e95ad69` |
| recommendation-page-spec.md (Step 2) | 🔨 partial | Foundation built: per-bucket result pages, match-ladder source model, ranking + 1–12 counts, multi-stage sections, hide/show-badge OOS + fallback swap, real Shopify %/amount discount, headline/subtext, autosave. **2026-06-25 (`claude/recommendation-page-spec-or43yx`):** full per-section Sort-Order set + per-section Sub-Filter shipped LIVE (engine + builder + tests); product-display toggles (Show-Variants / Descriptions / Star-Ratings placeholder / Urgency "Only X left") + page-structure toggles (results-summary bar + Retake) added to schema + builder — runtime rendering, the description publish bake, and the live inventory fetch for urgency still pending. Gated (human, owner picks à la carte): editable "Why we recommend" copy + per-product AI blurbs, discount depth, Notify-Me/back-in-stock, share-results URLs, making the global `fallback_collection_id` render. | branch 2026-06-25 |
| shape-your-quiz-spec.md (Step 3) | ❓ needs decision | The AI direction/battle-card funnel exists but as a LINEAR multi-stage flow, not the spec's single four-card page — a materially different product. Blocked on an owner call (four-card page vs the shipped funnel) AND the scoring-model decision (Direct vs Weighted) before any refactor. | triage 2026-06-24 |
| question-builder-spec.md (Step 4) | 🔨 partial | Editor mechanics present: inline question editor (12+ types), answer list w/ icons/images, multi-select min/max, per-answer routing (skip-logic stand-in), add/delete, undo/redo, autosave chip. Queued in `_roadmap.md`: char counters/limits (150/60/40), Required/Optional toggle in studio, 4–8 count nudge, Duplicate/Add-above-below, read-only Flow View toggle, Bucket Coverage pills, structured Skip-Logic rule builder (w/ End-quiz), studio-side AI Regenerate. Gated (human): the Direct-vs-Weighted scoring-model concept, open-text customer-metafield creation on publish. | triage 2026-06-24 |

_Files whose name starts with `_` (e.g. `_roadmap.md`) are control/meta docs, not specs._

> Note (2026-06-24): brought current manually. Bug-fix / chip sessions and the
> in-session audit loop ship fixes but don't run the routine's LOG step, so this
> read-out had lagged. The Step 2–4 statuses above are from a spec-vs-codebase
> triage, not a routine run — the routine will overwrite this on its next run.
