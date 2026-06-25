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
| question-builder-spec.md (Step 4) | 🔨 partial | Editor mechanics present: inline question editor (12+ types), answer list w/ icons/images, multi-select min/max, per-answer routing (skip-logic stand-in), add/delete, undo/redo, autosave chip. Queued in `_roadmap.md`: char counters/limits (150/60/40), Required/Optional toggle in studio, 4–8 count nudge, Duplicate/Add-above-below, read-only Flow View toggle, Bucket Coverage pills, structured Skip-Logic rule builder (w/ End-quiz), studio-side AI Regenerate. Gated (human): the Direct-vs-Weighted scoring-model concept, open-text customer-metafield creation on publish. | triage 2026-06-24 |
| design-settings-spec.md (Design step) | ❓ needs decision | NOT yet covered by `_roadmap.md` — this spec was added to Drive 2026-06-24, AFTER the roadmap's last edit, so its scope/priority is unset; the roadmap still says "the 4 specs in this folder." Since the roadmap wins and doesn't slot this work, an owner must add it before the routine builds any gap (same posture as Step 3). Foundation already shipped (`app/routes/app.design.tsx`, `app/lib/designTokens.ts`, `themePresets.ts`): global brand tokens on `Shop.brandTokens` (primary/secondary/accent/background/text/muted w/ picker+hex, heading/body font, radius, button style, spacing, shadow), 6 named presets (Linen/Minimal/Editorial/Bold/Pastel/Dark) w/ apply + thumbnail gallery, live preview panel, per-quiz `design_tokens` + per-node `design_overrides` + per-breakpoint overrides, shared/custom result-layout mode, WCAG-AA contrast warnings, CSS-var mapping, partial Shopify pull (brand colors via Brand API on install + `settings_data.json` read for AI brand build). Gaps if greenlit: logo upload + size/position (absent); curated ~20 Google-Fonts dropdown (today free-text); "Re-sync from Shopify" + "Reset to system default" confirm flow; style bar as 3 sliders incl. an Image-density axis (today dropdowns, no image-density); per-quiz formatting toggles (progress-bar style/position, answer-layout grid/list/auto, question-image position none/top/side, button-style override); the spec's Quiz-UI-vs-Rec-Page two-config linking model (`quiz_design`/`rec_page_design` + de-link/re-link) — current model is single tokens + result-node overrides, materially different. | triage 2026-06-25 |

_Files whose name starts with `_` (e.g. `_roadmap.md`) are control/meta docs, not specs._

> Note (2026-06-24): brought current manually. Bug-fix / chip sessions and the
> in-session audit loop ship fixes but don't run the routine's LOG step, so this
> read-out had lagged. The Step 2–4 statuses above are from a spec-vs-codebase
> triage, not a routine run — the routine will overwrite this on its next run.
>
> Note (2026-06-25): triaged the 5th spec, `design-settings-spec.md`, and added
> its row above. The Drive folder now holds 5 specs, but `_roadmap.md` (last
> edited 2026-06-24 03:20) predates this spec (added 2026-06-24 21:32) and still
> references "the 4 specs," so it neither scopes nor de-scopes the design work.
> Because the roadmap is the scope authority and is silent here, the design spec
> is parked at "needs decision" pending an owner adding it to `_roadmap.md`'s
> Now / Not-now lists — the routine should not auto-build its gaps until then.
> Manual triage, not a routine run.
