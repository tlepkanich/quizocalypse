# Quizzy v1 — architecture & build plan (QZY program)

Staff-architect gap analysis + phase plan for the three 2026-07-06/07 Drive
specs — **quiz-build-tab-dev-handoff v1.0**, **quiz-logic-dev-handoff v1.2**,
**quiz-results-step4-dev-handoff v1.0** — plus the owner's supplement list.
This doc is the program's durable backbone: read it before touching any QZY
phase. Specs win over this doc; this doc wins over guesses.

## 0. The three surfaces (don't conflate them)

| Surface | Spec | Today's code |
|---|---|---|
| **Funnel step 3 · Questions/Logic** (Content⇄Logic toggle) | quiz-logic v1.2 | `questionsLogicV3/` (Step3Shell, PhoneCanvas, LogicScroll) |
| **Funnel step 4 · Results reveal (LIGHT)** | quiz-results-step4 v1.0 | `RecommendationStage.tsx` (heavy — becomes the *dashboard advanced editor*, not step 4) |
| **Main builder** (shell + Build tab) | quiz-build-tab v1.0 | `UnifiedWorkspace` + BLD-1…7 chrome |

A fourth companion ("Logic View (Main Builder) Handoff v1.0" — dashboard
Map/Paths/Table) is referenced but **not in Drive**. Decision: the builder's
Logic section reuses the step-3 Logic map components until that spec lands.

## 1. Vocabulary (binding, logic spec §14)

UI copy: **Filters results / Picks the result ◆ / Info only** (never
"question type" for roles) · **Rule; show / hide / prioritize** (never boost/
branch/condition tree) · **No preference** (never empty/0) · **Fallback**
(never default bucket) · **Recommendation** (never results bucket). Merchants
never see: conditional, attribute match, points-based, bucket, decider.
Sentence case; no exclamation points.

## 2. Engine/model mapping (what exists vs what's new)

| Spec concept | Existing | Action |
|---|---|---|
| Picks the result ◆ (decider) | `QuestionData.role: "decides"` + `Answer.target_id` | Keep. UI label change only. Single-decider auto-revert exists — verify transaction semantics. |
| Filters results (MATCHES + counts) | `Answer.tags[]` + `collection_filter` narrow the pool (recommendationEngine, case-insensitive) | Formalize as role `"filter"`; live product counts per answer; three cell states. |
| Info only | `role: "qualifier"` | Rename semantics → UI "Info only". Schema keeps `qualifier` (parse-forever rule) + accept `"info"` as alias? NO — keep the stored enum, map label in UI. |
| No preference (first-class) | implicit (answer w/ no tags) | Explicit `Answer.no_preference?: boolean` (optional, decider-gated) so intent ≠ accident. |
| THEN GO TO (branching, v1.2) | per-answer edges (ONE per source_handle — invariant!) already route | UI select per answer row: Next (default) / →Q# / →Result. Cycle-guard = disable targets that create a revisit on any path. |
| Path-aware pipeline | engine narrows by all answered steps (path IS what shopper answered) | Verify: filters only apply from path steps (they do — path-derived). Add per-path dead-end analysis to `pathReport`. |
| Rules show/hide/**prioritize** | `decision_rules` exist | Confirm action vocab; rename any "boost" to prioritize; first-match-wins precedence check. |
| Fallback (empty-case chooser) | `fallback_collection_id` on results; generic fallback REMOVED in L-program ("no-fit → empty") | NEW `Quiz.fallback: { mode: "best_sellers"\|"collection"\|"featured", collection_id?, product_ids? }` (optional ⇒ legacy byte-safe). Engine: zero-match ⇒ resolve fallback. Step-4 toggle `show_fallback` reads it. |
| Slider range bands | `slider` type = freeform 0-100 on seed answer | NEW `Answer.range?: {min,max}` bands (QZY-12); gap = blocking dead end. |
| OOS handling | `OosBehavior` per result node | Spec: global Settings default, auto-hide. Add quiz/global default; keep per-node parse (legacy). |
| One question per screen | funnel: true by construction; builder blocks: `answers` smart block | Enforce in builder: palette question insert = new screen or type switch, never 2nd question block. |

**Dual-model invariant still binding:** every new field `.optional()`, never
`.default()`; legacy docs byte-identical; `/q/cmqqcb0ao….json` pin
`c02ccaec98a0fe9e` after every deploy.

## 3. Supplement items → where they land

| Supplement | Phase |
|---|---|
| AI templates: 1-2 product-match + 1 personality, "quite different" | QZY-4 (step2Build type gen) |
| Remove "what is your budget" questions from AI | QZY-4 (prompt bans in onboardingBuild + regenerate) |
| Content tab: type switch KEEPS answers | QZY-3 |
| Logic tab: no "Edit content" — inline edit question text + type on the map | QZY-2 |
| Type picker offers: content page · single select · multi select · five-point · rating | QZY-3 (curated picker; "content page"=message screen, "five-point"=rating 1-5 preset; full enum stays parsed) |
| Email capture = full step in BOTH sub-views; heading/description editable | QZY-3 |
| Capture screen: SMS collection + terms checkbox | QZY-3 (schema: `email_gate.data.collect_phone?`, `terms?: {enabled, text}` — runtime EmailGateView already collects phone) |
| Logic map pre-populates capture as last step: "Email Capture / End Quiz" | QZY-2 |
| Phone canvas: tap answer → delete it; add question under final answer | QZY-3 |

## 4. Phase plan (dependency order)

- **QZY-1 · Engine foundations** — fallback chooser (schema+engine+publish bake), role `"filter"` + no_preference, per-answer live match counts helper, path-aware dead-end analysis in pathReport (per-path routes named), rule action vocab. Pure lib + tests first.
- **QZY-2 · Step-3 Logic sub-view v1.2** — map cards (role dropdown, coverage badge, in-N-rules badge, drag handle), THEN GO TO per answer (cycle-guarded), rules widget sticky/open + per-question λ shortcut landing global, explainer strip, **diagnose modal** (Diagnostics + Test-a-path honoring routing), fallback section, filter cell states + Manage Matches (reuse existing criteria editor), inline question text/type editing on cards, capture terminus → "Email Capture / End Quiz" module row. Single Fix-N-issues indicator (evolve HealthPill; no second chip).
- **QZY-3 · Step-3 Content supplement** — type-switch preserves answers; curated 5-type picker; tap-to-delete answer on phone; + add question under final answer; email capture full editable step (heading/desc/SMS/terms) in both views.
- **QZY-4 · Shape/AI templates** — two archetypes surfaced (product-match ×1-2 + personality ×1, distinct); budget-question ban in every AI question prompt. (Owner note: preview/what-shows update deferred — "come back here".)
- **QZY-5 · Step-4 light rebuild** — per results spec §1-6: settings left (no collapse) + phone preview right; 4 archetypes; content (headline, why toggle + ✦AI); products 0-6 scrub + price/desc/ATC/add-all toggles; single fallback toggle w/ inline "If nothing matches" preview block (inherits QZY-1 fallback); More options (fit/aspect/radius); persistent dashboard explainer. Current heavy RecommendationStage becomes dashboard-only (builder Results screens).
- **QZY-6 · Builder shell realignment** — rail → Build · Products · Logic · Design · Settings (Theme→Design rename; Code/placement/integrations/embed → Settings; AI rail item → top-bar "Assist" button opening the existing chat panel — full Assist design DEFERRED per spec; Results view folds into Build screens). Intent pill next to quiz name; "Logic valid" pill naming.
- **QZY-7 · Build tab core** — left panel tabs Add/Layers/Background; **screen carousel** (bottom of CENTER column only, live mini-previews + labels, + adds screen); one-question-per-screen enforcement (palette question type on question screen = SWITCH type; elsewhere = new screen); empty states.
- **QZY-8 · Inspector v2** — scrub+exact numeric primitive (one shared component); progressive disclosure ("More options"); selection scoping incl. single-option scope + "style all options"; footer move/delete; **inline gold Logic section** (role dropdown + per-answer mapping summary + "Open full map in Logic →").
- **QZY-9 · Answer display modes** — Text list / Icon+text / Image cards / Large tiles / Compact pills; lossless mode switching; per-option media picker (emoji·library·upload — icon library is a flagged DEPENDENCY, emoji+upload first); shape presets + custom radius; option background (solid/gradient/partial-image/full) + selected-state style.
- **QZY-10 · Block inventory v1** — Video (in-content), Progress bar, Logo, Email/input field (+consent), Content block (rich text), Button on-click actions, Divider/Spacer settings, Product card options. All inline-editable, scrub+exact, Layers+inspector move/delete.
- **QZY-11 · Backgrounds** — per-screen (Background tab): solid/gradient/image/video; fit + focal point; overlay scrub; video always-muted + poster + mobile poster-fallback default; apply-to-all w/ confirm; readability hint (non-blocking).
- **QZY-12 · Slider/scale question v1** — continuous + stepped modes, end/step labels above/below, track/thumb/marker styling, **range-band logic** (bands cover full range; gaps = blocking dead ends in the same diagnostics).
- **QZY-13 · Migration, probes, sweep** — legacy converter acceptance (representative quiz, identical outcomes), e2e probes per spec Acceptance lines, vocabulary sweep, docs/spec-status update.

**Spec-sanctioned deferrals (do NOT build in v1):** AI Assist full design ·
drag-from-palette + canvas drag-reorder (click-to-add + Layers reorder are
the baseline — note: BLD-7 already shipped drag-from-palette; keep it) ·
pattern backgrounds · custom-icon slider thumb (unless SVG upload trivial) ·
per-option partial-image band (confirm crop UX first) · kits/personality-
points (v2) · Klaviyo sync (open Q4).

## 5. Standing verification contract

Every phase: strict `&&` gate (typecheck → vitest → build → lint UNPIPED or
pipefail → check-tokens) · live-verify on fixture `cmr7khgd5…` (funnel) or a
local published quiz (runtime) · runtime-touching phases run the local
runtime smoke with LOCAL quiz ids (`SMOKE_QUIZZES=a:cmpwqf6zw…`) · extend
`e2e/builderv3-verify.mjs` or add `e2e/qzy-*.mjs` probes per Acceptance
lines · byte pin `c02ccaec98a0fe9e` after deploys · commit per phase.
