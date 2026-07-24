# Build tab — design handoff

**Last updated: 2026-07-16.** Global-settings precedence is **newest wins** (see
`docs/design/phone-preview/SPEC.md`). Where this doc conflicts with the phone-preview
`SPEC.md` / `DESKTOP-SPEC.md` (both 2026-07-14) on the **desktop preview**, this doc is
newer and supersedes — specifically: desktop preview anchoring is **top-anchored,
width-fit, never upscale** (replaces both-axes fit-the-pane *for desktop*; mobile keeps
fit-the-pane), desktop frame dims follow placement (pop-up ≈ modal + margin; inline ≈
content + 200 × 720; full 1200 × 760 — replaces the fixed 1180 × 740), the desktop
content column caps at ~700px (replaces the 600/720/960/1080 mode table as the default),
and image tiles are 4:3 max-height 200px. Everything else in those SPECs still stands.

The post-funnel **Build tab**: the persistent workspace where a merchant composes and
styles a quiz as a linear block-stack, with a true-to-Shopify device preview. This is a
**layout / format / design** surface only — answer behavior, offers, and logic live on
the Products / Logic / Settings surfaces.

**Primary reference:** [`build-tab.html`](./build-tab.html) — the full interactive
prototype (self-contained HTML/CSS/JS; open it in a browser). Every control drives the
live preview; nothing is a mock-only stub.
**Context reference:** [`functional-breakdown.html`](./functional-breakdown.html) — the
functionality map behind the builder.
**Also published as a hosted Artifact** (private): `claude.ai/code/artifact/225261ad-f9b8-406d-8baa-a6ffbc41dd34`.

> The prototype is a **specification of behavior + exact values**, not code to port
> verbatim. Reimplement in the real runtime/admin components below, decider-gated, with
> the runtime staying byte-identical for legacy docs.

Prototype layout: far-left nav rail (Build / Products / Logic / Theme / Settings) · left
component library (Add / Layers / Background, collapsible) · center device preview
(Mobile / Desktop) · right inspector (Design / Content) · bottom screen filmstrip.

---

## 1. The inspector is layout/format only — Design first, Content second

**Real files:** the studio builder inspector — `BuilderDesignPanel.tsx`, `ContextPanel`
Design/Content tabs, `DesignStage.tsx`.

- Per-block inspector has exactly **two tabs: Design (default/first) and Content**. No
  per-block "Settings" tab — selection mode, required, email-gate rules, result offers,
  and fallback all live on **Products / Logic / Settings**. The inspector shows a labeled
  **deep-link** to the owning surface (e.g. Choice → "Answer rules & required — Logic").
- Design-first is deliberate (blocks arrive pre-populated with AI content, so styling is
  the dominant remaining task). Keep that rationale in a comment; optionally remember the
  last-used tab per block type.
- The rating **Scale**'s point-count is **format** → it lives in Design, not Settings.
- Panel header shows the block name only — **no redundant `<TYPE> BLOCK` eyebrow**.

## 2. Granular per-block design controls (all live-wired)

**Real files:** `quizSchema.ts` (new `.optional()` fields), `quizMutations.ts` (pure
mutations), runtime render in `QuizRuntime.tsx` + `quiz-runtime.css`.

Reusable controls: **slider + exact-numeric + unit**, **color swatch + hex**,
segmented, toggle. Per block:
- **Image** — width %, aspect (1:1 / 4:5 / 4:3 / 16:9), fit (cover/contain) + focal-point
  dot on cover, corner radius.
- **Button** — type (filled / outline / soft / ghost), width, align, size, corners,
  color. Height is **padding-derived with a non-editable `min-height:44px` floor** (WCAG
  2.5.5 / Apple 44 / Material 48) — no slider value can make it un-tappable.
- **Progress** — style (bar / dots / steps), bar line (solid / dashed), thickness,
  corners (hidden for dots), fill + track color, show "Question X of Y".
- **Choice / answers** — layout variant (list / cards / image-tiles / pills) + columns;
  option corners / gap / padding (hidden for pills) / border; fill / border / label
  colors; selected-state indicator (ring / fill / check) + accent.
- **Heading / Text** — size, letter-spacing, align, color, max-width.
- **Spacer** height; **Divider** thickness + color; per-block **Spacing** (above/below).
- Per-block **colors override the brand default** (unset = inherit Theme). Brand color /
  font defaults still come from the Theme surface.

## 3. Responsive / per-device sizing model

**Real files:** `quizSchema.ts`, `quiz-runtime.css` (media-query overrides), `QuizRuntime.tsx`.

- **Fluid by default; opt-in mobile override on a curated set only.** Two tiers:
  **mobile ≤ 749px / desktop ≥ 750px** (matches Dawn's `min-width:750px` so the quiz
  shares its host theme's breakpoint).
- Per-device controls (a subtle **"＋ Different on mobile"** reveal, off by default,
  with reset): **button width**, **answer columns**, **result columns**, **heading
  size**. Everything else (color, radius, fonts, gaps) is single-value identity so the
  two views can't silently drift.
- Storage: `X` = desktop/base, `X_m` = mobile override (absent = inherit). Runtime reads
  `dev(base, mob)` = mobile override when rendering mobile, else base.
- **Buttons:** desktop `fit-content` + min-width; mobile `width:100%` capped to the
  content column (never the raw viewport).
- Schema: add e.g. `design.responsive?: { headingSize?, columns?, buttonWidth?, ... }`
  each shaped `{ desktop: T; mobile?: T }`. Runtime emits the desktop token set + **one**
  `@media (max-width:749px){ … }` block containing only the overridden tokens.

## 4. Desktop preview — anchoring + content sizing (the two reported bugs)

**Real files:** the studio preview host (`DeviceFrame.tsx` / phone-preview primitive) +
`quiz-runtime.css`.

- **Anchoring (fixes "preview lost to the bottom" on format switch):** the preview stage
  is **top-anchored** (`align-items:flex-start`) and **width-fit, never upscaled** on
  desktop (`scale = min(1, (stageW − pad) / frameW)`, width only). Mobile fits both axes
  so the whole phone shows. Content stays at a stable top offset across Pop-up / Inline /
  Full page; internal scroll lives inside the frame; reset frame scroll on format switch.
- **Content column cap (fixes "giant images"):** on desktop the quiz content column caps
  at **~700px** (research: text ~640 / grid ~768; single aligned 700), centered.
- **Image tiles:** `aspect-ratio:4/3; max-height:200px; object-fit:cover` (were 1:1
  stretched to ~349px). In-content images cap ~700px; product-card images `aspect 1:1;
  max-height:300px`, 3–4 col desktop / ≤2 mobile.
- **Pop-up:** the modal fills its frame (frame ≈ modal width + margin) so it isn't a tiny
  toast in a huge dark page. Modal envelope: `min(92vw,900px)`, cap 1200, `min(90vh,760)`,
  radius 16, backdrop `rgba(0,0,0,.55)`. **Inline** = contained card; **Full page** =
  full-bleed background with the capped centered column.
- **Side padding** control (range 16–64; the prototype ships at 52) applies to **all**
  desktop formats (drives the content column's horizontal padding), not inline-only.

## 5. Content blocks

**Real files:** block registry / `quizSchema.ts` node types, `QuizRuntime.tsx` renderers.

Existing: heading, text, image, video, logo, divider, spacer, choice, scale, email,
consent, product-results, button, progress. **Added (P0 gap-closers):**
- **Testimonial** (quote + author + role, avatar, star row, card / plain / big-quote).
- **Review stars** (rating 0–5, star size + color, count text, alignment).
- **Trust badges** (repeatable icon + label, columns, icon size + color).
- **Short-text input** (label, placeholder, single/multi-line, width).
- **Coupon reveal** (code + headline + sub, ticket / solid / soft frame, copy button).

New library group **"Social proof."** Inputs (short-text) capture only — mapping stays in
the decider.

## 6. Background — Add / Layers / **Background** left tab, with split & quadrant

**Real files:** `quizSchema.ts` (`node_backgrounds`, ~1672–1706), `QuizRuntime.tsx`,
`quiz-runtime.css`.

- Per-screen background moved to a **3rd left-panel tab** (acts on the selected screen;
  the step inspector keeps a deep-link). Types: **Brand (inherit) / Solid / Gradient /
  Split / Quadrant.**
- **Split:** direction (horiz / vert / diag), region A + B fill, split position 0–100,
  softness 0–40. CSS: hard = `linear-gradient(<dir>, A pos%, B pos%)`; soft spreads the
  stops by `±softness/2`.
- **Quadrant:** four corner fills + split-X / split-Y. CSS = a **four-layer background**
  (each corner a sized `no-repeat` layer), so corners can be gradient/image and the split
  can be off-center.
- Background is a **paint layer** — it does NOT reflow blocks. True Typeform-style
  split-screen (media half + content half) is a separate, larger content-renderer feature
  (out of scope here).

## 7. Navigation / IA

**Real files:** studio chrome (`TopBar`, nav rail, `UnifiedWorkspace`), library panel.

- Top bar **hides the Mobile/Desktop + Edit/Preview toggles when off the Build canvas**
  (they do nothing on the config surfaces).
- Rail: **Design → Theme** rename (so "Design" means one thing — the block Design tab),
  with a "Set up" divider grouping Build vs the Products / Logic / Theme / Settings config
  set. Resolve the two "Preview" controls (in-canvas Edit/Preview vs a standalone
  **"Preview live ↗"**). A **Saved** indicator near Publish.
- **Placement** has one source of truth (Settings); the desktop stage-bar "Show as"
  mirrors its labels (Pop-up / Inline / Full page).
- **Left panel is hideable** (collapse chevron or `[`); collapsing widens the stage and
  re-fits the preview; a re-open handle appears on the stage.
- **Native inline add:** between-block hover "+" inserters (existing) **plus** a
  persistent **"＋ Add block"** button at the end of the canvas stack.

## Guardrails (from repo CLAUDE.md)

- **Decider-gated, `.optional()` never `.default()`.** A default rewrites every legacy doc
  on the next parse-save round-trip and breaks the byte-pin. Legacy (points/ladder) docs
  must render **byte-identical** — verify the pinned quiz
  `cmqqcb0ao004mqvkwjug7t0ya.json` still hashes `c02ccaec98a0fe9e…` after any runtime change.
- All doc edits go through **pure mutations** in `quizMutations.ts`; UIs call mutations,
  never hand-edit JSON. New fields validated in `quizSchema.ts`.
- **`app/components/runtime/**` is highest-risk** — decompose, don't rewrite; prove
  DOM-identical before/after on a legacy doc; `/q` HTML changes need the e2e + screenshot
  review. `/q` loads **only** `quiz-runtime.css` — no admin CSS may reach the preview
  (iframe or shadow root for true parity).
- Fidelity: render the **same `QuizRuntime`** at a **real device width** (iframe), never a
  scaled-down desktop render; await `document.fonts.ready` before trusting layout. Extend
  the DOM-identical harness to snapshot the preview at 390 / 1280 vs live `/q` and fail the
  gate on mismatch.
