# Spec status (auto-maintained)

The **Quiz Maintainer** routine REWRITES this file each run to mirror every spec
in the Google Drive specs folder and what it's done with each. Don't hand-edit —
steer scope and priority via `_roadmap.md` in Drive; this is the read-out.

Legend: ⬜ queued · 🔨 in progress · ✅ implemented · ⤵️ out of scope (per `_roadmap.md`) · ❓ needs decision

| Spec (Drive) | Status | Last action | Ref |
| --- | --- | --- | --- |
| recommendation-buckets-spec.md (Step 1) | ✅ implemented | shipped + live-verified (RB program) | `e95ad69` |
| recommendation-page-spec.md (Step 2) | 🔨 partial | **Shipped 2026-06-25**: product-display toggles (show_variants, show_descriptions, urgency signal + threshold, star-ratings "coming soon" placeholder), results-summary bar toggle, retake-quiz link toggle, ranking extended (price/title asc/desc, manually_curated), sub_filter field in schema. Still queued: full per-section Sort-Order UI, editable "Why we recommend" copy, per-product AI blurbs, discount depth, Notify-Me/back-in-stock, share-results URLs, rendering global `fallback_collection_id`. Gated (human): "Why we recommend" copy + per-product AI blurbs, discount depth. | `73fbfe1` |
| shape-your-quiz-spec.md (Step 3) | ❓ needs decision | The AI direction/battle-card funnel exists but as a LINEAR multi-stage flow, not the spec's single four-card page — a materially different product. Blocked on an owner call (four-card page vs the shipped funnel) AND the scoring-model decision (Direct vs Weighted) before any refactor. | triage 2026-06-24 |
| question-builder-spec.md (Step 4) | 🔨 partial | **Shipped 2026-06-25**: char counters/limits (question 150, answer 60), Required/Optional toggle, 4–8 count nudge in workspace header, Duplicate (⎘) + Add-above (↑+) actions, save-error chip with Retry. Still queued: read-only Flow View toggle (needs DAG renderer), Bucket Coverage pills, structured Skip-Logic rule builder (w/ End-quiz), studio-side per-question AI Regenerate. Gated (human): Direct-vs-Weighted scoring model, open-text customer-metafield creation on publish. | `73fbfe1` |

_Files whose name starts with `_` (e.g. `_roadmap.md`) are control/meta docs, not specs._
