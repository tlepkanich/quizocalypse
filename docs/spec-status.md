# Spec status (auto-maintained)

The **Quiz Maintainer** routine REWRITES this file each run to mirror every spec
in the Google Drive specs folder and what it's done with each. Don't hand-edit —
steer scope and priority via `_roadmap.md` in Drive; this is the read-out.

Legend: ⬜ queued · 🔨 in progress · ✅ implemented · ⤵️ out of scope (per `_roadmap.md`) · ❓ needs decision

| Spec (Drive) | Status | Last action | Ref |
| --- | --- | --- | --- |
| recommendation-buckets-spec.md (Step 1) | ✅ implemented | shipped + live-verified (RB program) | `e95ad69` |
| recommendation-page-spec.md (Step 2) | ✅ implemented (branch) | **Full spec shipped on `claude/recommendation-page-spec-or43yx` (owner greenlit the whole cluster + all deferred items).** Now-cluster: full per-section Sort-Order set + per-section Sub-Filter (engine+builder+tests); product-display toggles (Show-Variants, Descriptions, Star-Ratings placeholder, Urgency "Only X left" via a live `/q/:id/inventory` fetch + description publish bake); page-structure toggles (results-summary bar, Retake). Deferred items (all done): §3 "Why we recommend" copy — Mode A page intro + Mode B per-product blurbs with `{{token}}` resolution; §4 discount depth — free-shipping kind, applies-to, usage cap, expiry, minimum + Shopify free-shipping/basic create; §5 Notify-Me/back-in-stock (new `BackInStockRequest` table + `/q/:id/notify` + optional webhook); §6 share-results button; §7 quiz-level global no-match fallback. Full gate green locally (typecheck, 665 tests, build, lint). Pending: merge the branch. | branch 2026-06-25 |
| shape-your-quiz-spec.md (Step 3) | 🔨 core shipped (branch) | **Owner resolved Guardrails #2: four-card page + weighted scoring.** On `claude/shape-your-quiz-spec`: new optional `scoring_model` ("direct"/"weighted"; absent = legacy, so in-flight drafts unchanged) + direct/weighted mapping helpers onto the existing per-answer `points` engine (`setAnswerBucketDirect`/`setAnswerBucketWeight`, tested). The linear Types→Templates→BattleCard selection is replaced by the spec's single four-card page (2 AI quiz-type cards with inline expand + REQUIRED Direct/Weighted scoring choice → `shape-continue`; Write-Your-Goal card; Manual-Create card → builder; ↻ Regenerate). Typecheck + 680 tests + build green. Remaining for full fidelity: AI gen tuning to force two intentionally-different types; the Question-Builder Mapping tab (direct dropdown vs weighted grid) using the new helpers; the manual-create scoring prompt in the builder. | branch 2026-06-25 |
| question-builder-spec.md (Step 4) | ✅ implemented (branch) | **`_roadmap.md` "Now" cluster shipped on `claude/question-builder-spec`:** char counters/limits (question 150 / answer 60) + Required/Optional toggle + soft 4–8 nudge; question row actions (Duplicate, Add above/below, number badge) via new spine-splice mutations; Bucket Coverage Indicator (green/yellow/red pills, hover counts); structured Skip-Logic rules (End-quiz target + conflict warnings) + read-only Flow View; studio-side per-question AI Regenerate with ~10s undo. Each pure helper unit-tested; full gate green locally. Gated (human, untouched): Direct-vs-Weighted scoring-model concept, open-text customer-metafield creation on publish. | merged 2026-06-25 |
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
