# Spec status (auto-maintained)

The **Quiz Maintainer** routine REWRITES this file each run to mirror every spec
in the Google Drive specs folder and what it's done with each. Don't hand-edit —
steer scope and priority via `_roadmap.md` in Drive; this is the read-out.

Legend: ⬜ queued · 🔨 in progress · ✅ implemented · ⤵️ out of scope (per `_roadmap.md`) · ❓ needs decision

| Spec (Drive) | Status | Last action | Ref |
| --- | --- | --- | --- |
| recommendation-buckets-spec.md (Step 1) | ✅ implemented | shipped + live-verified (RB program) | `e95ad69` |
| recommendation-page-spec.md (Step 2) | ✅ implemented (branch) | **Full spec shipped on `claude/recommendation-page-spec-or43yx` (owner greenlit the whole cluster + all deferred items).** Now-cluster: full per-section Sort-Order set + per-section Sub-Filter (engine+builder+tests); product-display toggles (Show-Variants, Descriptions, Star-Ratings placeholder, Urgency "Only X left" via a live `/q/:id/inventory` fetch + description publish bake); page-structure toggles (results-summary bar, Retake). Deferred items (all done): §3 "Why we recommend" copy — Mode A page intro + Mode B per-product blurbs with `{{token}}` resolution; §4 discount depth — free-shipping kind, applies-to, usage cap, expiry, minimum + Shopify free-shipping/basic create; §5 Notify-Me/back-in-stock (new `BackInStockRequest` table + `/q/:id/notify` + optional webhook); §6 share-results button; §7 quiz-level global no-match fallback. Full gate green locally (typecheck, 665 tests, build, lint). Pending: merge the branch. | branch 2026-06-25 |
| shape-your-quiz-spec.md (Step 3) | ❓ needs decision | The AI direction/battle-card funnel exists but as a LINEAR multi-stage flow, not the spec's single four-card page — a materially different product. Blocked on an owner call (four-card page vs the shipped funnel) AND the scoring-model decision (Direct vs Weighted) before any refactor. | triage 2026-06-24 |
| question-builder-spec.md (Step 4) | 🔨 partial | Editor mechanics present: inline question editor (12+ types), answer list w/ icons/images, multi-select min/max, per-answer routing (skip-logic stand-in), add/delete, undo/redo, autosave chip. Queued in `_roadmap.md`: char counters/limits (150/60/40), Required/Optional toggle in studio, 4–8 count nudge, Duplicate/Add-above-below, read-only Flow View toggle, Bucket Coverage pills, structured Skip-Logic rule builder (w/ End-quiz), studio-side AI Regenerate. Gated (human): the Direct-vs-Weighted scoring-model concept, open-text customer-metafield creation on publish. | triage 2026-06-24 |

_Files whose name starts with `_` (e.g. `_roadmap.md`) are control/meta docs, not specs._

> Note (2026-06-24): brought current manually. Bug-fix / chip sessions and the
> in-session audit loop ship fixes but don't run the routine's LOG step, so this
> read-out had lagged. The Step 2–4 statuses above are from a spec-vs-codebase
> triage, not a routine run — the routine will overwrite this on its next run.
