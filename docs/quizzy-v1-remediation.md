# Quizzy v1 — remediation program (QZY-R)

Successor to `docs/quizzy-v1-architecture.md`. The QZY program (`39c96ff…877093f`,
deployed 2026-07-08) built correct code against **stale requirements**: it froze
scope on 2026-07-06 against **build-tab v1.0** and, per its own §0, punted the
**Logic-View** spec ("referenced but not in Drive"). On 2026-07-07 the owner (a)
rewrote build-tab to **v2.0** — masthead note *"v1.0 was misbuilt"* — and (b)
landed **quiz-logic-view-dev-handoff v1.0** (Map/Paths/Table). This program
closes both gaps.

**Specs win over this doc; this doc wins over guesses. Read it before any QZY-R phase.**

Drive folder `1SGz6sN_Xw9OU-_MLbrdBaWG6Oy2WIZZP`:
- **quiz-build-tab-dev-handoff v2.0** (`1kmOdQ4w…`, 2026-07-07) — SUPERSEDES v1.0
- **quiz-logic-view-dev-handoff v1.0** (`1xMs17jR…`, 2026-07-07) — the missed companion
- quiz-logic-dev-handoff v1.2 (`1glHhoCD…`) — step-3 body already built (QZY-2/3); its §13 change-log points at the Logic-View companion above.

## 0. Owner decisions on record (2026-07-08)

1. **Sequence:** R1 (path engine) + R2 (inspector correction) first — R2 fixes the
   "misbuilt" inspector that is **live in production** — then the full program
   R3→R10 in dependency order.
2. **Media:** real file **upload is in scope** — R4 builds full image + video
   upload per §8 (media pipeline assumed available/provisioned), not URL-only.

## 1. The audit ledger (113 acceptance checks: 25 BUILT · 33 PARTIAL · 55 MISSING)

Grounded per-`file:line` against current code (workflow `wf_c92cf77f-d85`). The miss
is **bounded** — QZY-4/5/11/12 (AI mix, step-4 light reveal, per-screen
backgrounds, slider bands) and most block inventory hold up. It concentrates in
three clusters:

| Cluster | Slices | Headline |
|---|---|---|
| **Inspector model is wrong** | BT1 | Right panel still has a Content/Design/Routing **tab bar** + full **logic UI** (role dropdown, Maps-to, points grids, skip-routing) + a screen-bg control. v2.0 §1 forbids all of it. |
| **Design systems unbuilt** | BT2/3/5/6/8 | Interaction states (hover/motion/reveal/effects), master/override + Custom badge, unified background control set (incl. partial-image + option video), shared media picker w/ upload+icon library. |
| **Logic-View dashboard absent** | LV1/2/3/4 | No path-enumeration engine; no Map/Paths/Table tabs; no flow lanes; no Table audit + override-writes-a-rule. LV5 (branching model) is mostly BUILT. |

## 2. Engine/model mapping for the new work

**Reuse the production resolve chain — never reimplement it.** The runtime resolves
a shopper at `QuizRuntime.tsx:464` via:

| Primitive | Where | Role in R1 |
|---|---|---|
| `resolveTarget(answerIds, doc)` | `recommendDecider.ts:139` | rules → decider mapping for a given answer set (path-aware: pass only answered ids). |
| `narrowIdsByFilters(...)` | `filterMatching.ts:102` | filter narrowing; a filter not on the path contributes nothing (already path-derived). |
| `targetProducts(input)` | `recommendDecider.ts:282` | materialize target → product set for the "+N more" / representative product. |
| `tracePath(doc, selections)` | `routeTrace.ts:88` | single trace from explicit selections — R1's per-path building block, wrapped in a forking walk. |
| `buildTier1Report(doc, buckets, productIndex?)` | `pathReport.ts:74` | existing **aggregate** dead-end/coverage report (V1–V12). NOT per-path enumeration — R1 adds that alongside it. |
| `straightThroughRun(doc)` | `questionMutations.ts:260` | linear spine (anchor for add-at-end). |

**Dual-model invariant still binding.** Every new field `.optional()`, never
`.default()`. Legacy points docs stay byte-identical. Byte pin
`/q/cmqqcb0ao….json` = `c02ccaec98a0fe9e` after every deploy. All QZY-R behavior
is **decider-gated** (`logic_model === "decider"`); legacy docs never see it.

**Vocabulary (unchanged, binding — logic v1.2 §14):** Filters results / Picks the
result ◆ / Info only · Rule; show/hide/prioritize · No preference · Fallback ·
Recommendation. Never: conditional, boost, branch (in copy), bucket, decider,
points-based. Sentence case; no exclamation points.

## 3. Phase plan (dependency-ordered)

Three foundations gate the rest: **R1** (engine → R8/R9), **R3** (override infra →
R5/R6), **R4** (media → R5/R6). Do not build a view before its engine.

### R1 · Path-enumeration engine  *(LV2 · pure lib + tests · no UI dep)*
New pure module (e.g. `app/lib/pathEnumeration.ts`). Enumerate every distinct
branched path: DFS from the first question, fork on each answer, follow per-answer
THEN GO TO edges, **stop at result/end**, cycle-guard (reuse `wouldCreateRevisit`
semantics), depth cap. Each path = ordered steps (`{questionId, answerId}`) +
answer id set + **effective result** (call `resolveTarget` then
`narrowIdsByFilters`/`targetProducts` for the narrowed set → representative product
+ "+N more") + dead-end status. Scale layer: group by effective result, ~50-row
render cap ("showing 50 of N"), **exhaustive dead-ends-only pass** that stays
complete past 500 paths (capped/lazy enumeration + a separate full dead-end sweep).
- **Acceptance:** a filter the path skips never narrows (LV2 already BUILT — assert it); enumeration terminates on cycles/depth; per-path result == `resolveTarget` for the same answer set; dead-ends-only surfaces every blocking path at 500+.

### R2 · Inspector correction  *(BT1 + LV5 conflict · mostly deletion · decider-gated)*
Make the Build inspector **purely selection-driven, tab-less, logic-free** (v2.0
§1/§2/§10). In `ContextPanel.tsx`: remove the Content/Design/Routing tab bar;
delete `InlineLogicSection` (role dropdown + Maps-to + "Open full map"),
`AnswerScopePanel`'s Maps-to, and the entire `RoutingBody` (points grids +
skip-logic) **for decider docs** → replace with a single one-line
"Edit logic in the Logic view →" pointer. Remove the screen-bg color control from
the right (`StyleTab` background) — bg lives only in the left Background tab. Keep
the deselect→hint. **Legacy points authoring must stay reachable** (those editors
serve legacy docs) → gate the removal on `logic_model === "decider"`. Auto-resolves
LV5's inspector branch/cycle-guard divergences (that surface is deleted).
- **Acceptance:** right panel has NO tab bar and NO logic controls in any decider selection state; no page-bg on the right; deselect → hint. Legacy doc inspector unchanged (byte-safe). 2-lens review (inspector is builder chrome, but the deletion touches the logic seam — prove the Logic view still drives `moveDecider`/`setQuestionRole`/`setAnswerRoute`).

### R3 · Master/override + Custom badge + toast infra  *(BT5 · foundation for R5/R6)*
Scope control "Changes apply to: All screens / This screen"; commit-on-switch to
This-screen writes a per-screen override + Custom badge (carousel + tab) + warning
toast; switch-back warns the screen rejoins master. All-screens edits with existing
overrides warn "N screen(s) with custom styles won't change." Apply-all **respects
overrides**: keep customized screens by default, show the skipped count, offer
explicit "Include customized". Build the missing **toast primitive** (none exists in
`app/components/studio`). No revert in v1.
- **Acceptance:** every scope change + apply-all surfaces the affected count; nothing overwrites a customized screen without Include-customized.

### R4 · Shared media picker + upload/icons  *(BT8 · foundation for R5/R6 media)*
ONE picker component: **Emoji · Icon library · Upload**, used everywhere media is
chosen (per-option icons, option/screen image+video backgrounds, reveal images).
Real file **upload for image AND video** (+ poster) per owner decision — wire the
media pipeline (storage/transcode/poster). Add an icon-library source (Lucide is
already a dep — a curated set is acceptable). Retire the ad-hoc URL inputs and the
second (logo) uploader.
- **Acceptance:** the same picker serves option media and all background/reveal choices; no second uploader; upload handles image + video.

### R5 · Answer display + interaction states  *(BT2 + BT6 · rides R3 + R4)*
BT2: remove "Icon" as a **layout mode** → independent "show icon/image" toggle
across all layouts (keep legacy `mode:"icon"` parseable — dual-model); unify radius
to ONE scrubber that the Pill/Rounded/Square chips **snap** (retire the separate
`shape` field's authority); content align L/C/R; separate **image-size** scrubber
(distinct from label size); per-option **inline canvas** media (click the icon/image
→ picker scoped to that option) + "Apply this option's look to all options".
BT6: interaction states — Default/Hover/Selected sub-tabs; configurable
selected fill/border/text/indicator; **hover** (bg/border shift + shadow; touch →
selected); **Motion** preset (None/pop/lift/fade); **reveal image** on hover/select
(beside/above); **Effects (playful)** drawer (flash/rainbow/pulse — collapsed,
never default, conversion-hurt note). Per-option override rides R3.
- **Acceptance (runtime):** tap → Selected; desktop hover → Hover; motion animates; loud effects only via drawer. Mode switches lossless. Prove `/q` DOM-identical for docs without the new fields.

### R6 · Background system unification  *(BT3 · rides R4)*
ONE background control set at BOTH option and screen level. Add **Partial image**
type (band left/top/right at coverage % + fill color) — schema + builder + runtime.
Option-level image/video/partial backgrounds. Radial gradient + 3rd stop; size/zoom;
**auto-applied readability overlay** + low-contrast nudge (today it's advisory text
only). Video always muted + mobile poster (already BUILT at screen level).
- **Acceptance:** every bg type renders live at both levels; video muted + poster on mobile; new fields `.optional()` and byte-safe.

### R7 · Element-granular inspector + block polish  *(BT1 §2 + BT4 + BT7)*
Element-granular selection→controls map: distinct control sets for question-text /
Next button / progress bar / each added block (drive off `inspectTarget.part`).
Layers **drag-to-reorder** + per-block click-select. Progress bar: expose fill vs
track color, radius, thickness, show-count toggle (bar AND "2 of 7"), per-screen
show/hide. Next button: real recolor (button element, not wrapper), size, radius
scrubber. Image block **upload** (via R4 picker). Video **captions** track. Divider
color/width.
- **Acceptance:** selecting each element type shows only its controls; Layers drag reorders the canvas; progress fill/track independently colorable by a merchant.

### R8 · Logic 3-tab shell + Paths tab  *(LV1 + LV3 · rides R1)*
Builder Logic section becomes **Map · Paths · Table** tabs over one dataset (live
projections; Map owns add/remove structure). Shared **global rules stack at the top
of all three**. Paths tab: one horizontal **lane per distinct path** grouped by
result (from R1); step chips (Q#+answer, gold decider, ⋔ branch, amber dead-end);
skipped questions **absent**; lane terminates in its result chip (product+"+N more"
black / rule-overridden indigo "· ruled" / ⚠0→fallback amber); step-chip popover
(jump-to-Map + inline reroute redraws lanes); result-chip popover (override → rule);
collapse groups to 3 + "show N more".
- **Acceptance:** a reroute in Paths reflects in Map + Table without refresh; a lane never renders a skipped question.

### R9 · Table tab + override-writes-a-rule  *(LV4 · rides R1 + multi-condition draftRule)*
Table tab: collapsed = one row per result (decider answer · result+N · path count ·
✓/⚠N status); expanded = every path (# · Q1 · Q2 · Q3 · RESULT · STATUS; skipped =
"–"). Answer cells navigate (jump to Map). Result cells **override → writes a
path-signature rule** ("If Q1 is X and Q3 is Y → show P") — generalize `draftRule.ts`
to multi-condition AND, append via `addDecisionRule`; toast "✓ Created R2 — rules
are checked before mappings"; badge the cell ("rule"); fixes ⚠ dead-ends the same
way; deleting the rule reverts. Never silent.
- **Acceptance:** every override is a deletable rule in the stack on all tabs; deleting reverts the cells; rule text vocabulary-compliant.

### R10 · Migration, probes, vocabulary sweep
e2e probes per new acceptance lines (extend `builderv3-verify.mjs` / add
`qzy-r-*.mjs`); byte-pin held; legacy round-trip byte-identical; `/q` DOM diff for
runtime phases; vocabulary sweep; update this doc's §5 status table +
`docs/quizzy-v1-architecture.md` cross-link.

## 4. Standing verification contract (per phase)

Strict UNPIPED gate before every commit:
`npm run typecheck && npm test -- --run && npm run build && npm run lint && node scripts/check-tokens.mjs`
· live-verify on fixture `cmr7khgd5…` (funnel) / a local published quiz (runtime)
· runtime-touching phases (R5/R6): local runtime smoke with LOCAL ids
(`SMOKE_QUIZZES=a:cmpwqf6zw…`) + `/q` DOM-identical proof for legacy docs · 2-lens
adversarial self-review for R2/R5/R6/R8/R9 (runtime/persistence/logic-seam) · byte
pin `c02ccaec98a0fe9e` after deploys · commit per phase to main (no PR).
`app/components/runtime/**` is the highest-risk edit class — decompose, prove
DOM-identical, never rewrite.

## 5. Status

| Phase | Commit | Status |
|---|---|---|
| R1 · Path-enumeration engine | (uncommitted) | ✅ code-complete, gate-green — `app/lib/pathEnumeration.ts` (`enumeratePaths` forks the runtime router + resolves each path with `resolveTarget`; `groupPathsByResult`) + `pathEnumeration.test.ts` (12 tests: faithfulness, skipped-question omission, branch flags, both dead-end reasons, grouping, maxPaths/cycle backstops). Full strict gate: 1372 tests, build, lint, tokens all pass. Product "+N more" enrichment deferred to R8/R9 (§7 dependency). |
| R2 · Inspector correction | (uncommitted) | ✅ code-complete, gate-green, **live-verified**. Decider-gated: `ContextPanel.tsx` deletes `InlineLogicSection` + strips `AnswerScopePanel`/`RoutingBody` logic + adds tab-less `DeciderInspectorBody` (content+style+layout+CSS + one "Open Logic →" pointer); `StyleTab` `hideBackground`; `ContentTab` model-aware copy. Legacy = verbatim `!isDecider` branch. Live probe `e2e/qzy-r2-verify.mjs` 13/13 PASS on the real server (no tabs, no logic, pointer, bg suppressed, 0 errors) + screenshot. `builderv3-verify.mjs` R2 sections updated (full run needs the local fixture's Q1 restored to a choice question — see below). Full strict gate green. |
| R3 · Master/override + toast | (uncommitted) | ✅ code-complete, gate-green, **live-verified**. Reuses the existing `qz-toast` primitive (wired into the standalone builder route via `QzToastProvider`; embedded route left unwrapped — toasts no-op there safely, one-line follow-up). Pure `screenBackground.ts` helpers (`screensWithBackgroundOverride`/`hasBackgroundOverride`/`applyBackgroundToAll`) + 5 tests. `BuilderBackgroundTab` gains the "This screen / All screens" scope control (§5.3) and an override-respecting apply-all with inline confirm (kept-count + "Include customized" escape hatch, §9); `ScreenCarousel` gains the Custom badge. Live probe `e2e/qzy-r3-verify.mjs` 7/7 PASS (net-zero) + screenshot; R2 probe re-run 13/13 (regression-clean). Full strict gate green (1377 tests). R5 adopts this master/override primitive for answer-display/interaction-states. |
| R4 · Shared media picker + upload | (uncommitted) | ✅ code-complete, gate-green, **live-verified**. One `MediaPicker` (Emoji · Icons · Upload · URL · Products) via `onGlyph`/`onImage` callbacks; **Upload = base64 data-URL** (owner's call) reusing `logoUpload` validators (type + 2 MB cap + safe-scheme + doc-bloat note). Wired into per-option media (`AnswerScopePanel`) and the screen **image** background (`BuilderBackgroundTab`). Live probe `e2e/qzy-r4-verify.mjs` 8/8 PASS (net-zero) + screenshot; R3 re-run 7/7. Full strict gate green (1377 tests). **Scope notes / follow-ups:** icon library is curated symbols (vector-Lucide needs a runtime SVG render path — deferred); **video stays URL** per owner; picker not yet swept into ContentTab inline media / block images / the logo uploader (those keep their existing pickers). |
| R5 · Answer display + interaction states | R5a `e94f708` · R5b `uncommitted` | 🚧 decomposed into increments. **R5a ✅ `e94f708`** (builder-only): radius unification (§3.1) + apply-look-to-all (§3.2). **R5b ✅** (first RUNTIME touch, byte-safe): retired "Icon" as a layout MODE → independent `show_media` toggle (works across layouts; legacy `mode:"icon"` still renders); content-align L/C/R; separate `image_size` (§3.3); icon-position `right`. All new schema fields `.optional()`, runtime gated on presence (undefined → literal prior node) → answer-display docs byte-identical, legacy never mounts `AnswerOptions`. Verified: gate green (1382 tests), schema round-trip test, `e2e/qzy-r5b-verify.mjs` 7/7 (net-zero) + screenshot, builderv3 **76/76**, runtime smoke at the pre-existing baseline (no new failures). **R5c (in progress — BT6 interaction states, decomposed):** **R5c-1 ✅** selected-state config (§6.1 — indicator check/dot/filled/none + fill/text/border colors + width; granular fields layer over legacy `selected_style`, absent → byte-identical; gate 1383 + schema test). **R5c-2 ✅** hover + motion presets — the runtime adds `.qz-answer-opt` + `data-qz-motion`/`data-qz-hover` + `--qz-opt-hover-*` vars ONLY when configured (unset → byte-identical); `:hover`/transition rules live in `quiz-runtime.css` (for `/q`) mirrored into `quizocalypse.css` (builder preview). Live probe `e2e/qzy-r5c-verify.mjs` 8/8 incl. a real hover-transform check; builderv3 76/76. Also renamed the option-bg label → "Option background" (disambiguates §1) and fixed the r5b/r5c probes' net-zero to wait past the 700ms autosave debounce. **R5c-3 ✅** Effects (playful) drawer — flash/rainbow/pulse behind a collapsed drawer, never default, `prefers-reduced-motion`-guarded; opt-in `data-qz-effect` (absent → byte-identical). Probe 10/10. **R5c-4 ✅** reveal-image on hover/select — per-option (`answer.reveal_image`/`reveal_position` via R4 `MediaPicker`); the runtime wraps the option in `.qz-opt-wrap` + renders a hidden `.qz-reveal` shown on hover/select by CSS (opt-in; absent → byte-identical). Probe 6/6 (hover `none → block`). **R5 COMPLETE** (a→c). Note: reveal renders inside `AnswerOptions` (styled modes cards/tiles/pills); the default text-list uses the legacy renderer — extending reveal there is a small follow-up. |
| R6 · Background system unification | — | not started |
| R7 · Element-granular inspector + block polish | — | not started |
| R8 · Logic 3-tab shell + Paths tab | — | not started |
| R9 · Table tab + override-writes-a-rule | — | not started |
| R10 · Migration, probes, sweep | — | not started |

**Local fixture (RESTORED `432f61c`):** `cmr7khgd5…` had decayed to a near-empty
grouping-stage draft (intro + one placeholder slider). Rebuilt in the local DB to a
clean decider flow — intro → single_select DECIDER Q1 (3 answers → real category
rows) → qualifier Q2 → result. `builderv3-verify.mjs` now runs **76/76 green** and
its assertions are synced to the R2/R4/R5a UI (corner-radius preset, scoped
MediaPicker, image-via-picker, intro-based inline-heading edit). The clean state
lives in the local DB (not git); a future `git`-clean checkout would need it
re-seeded.

**Spec-sanctioned deferrals (still NOT in v1):** AI Assist full design · pattern
backgrounds · custom-icon slider thumb · bulk multi-select rule apply (Table §5 is
single-cell baseline) · kits/personality-points · Klaviyo. Revert is v1.1 (§9).
