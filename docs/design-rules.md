**Quizzy**

**Master Design System**

One system, two surface modes. The single source of truth for how everything looks, moves, and fits together — from side rails and toggles to color, type, motion, and mobile previews.

*Style: “Soft Pastel”  ·  Version 0.6  ·  Status: living document*

> **Revision note (v0.6).** Merges the Phase-3 edits (1–9 from
> `design-rules-phase3.md`) — the color-usage rule into §2.5, the guardrails +
> analytics-module + Home-order specs into §15, and the Groups & Personas page
> into §16. Phase 2 stays frozen as-built. A/B testing, Strategy Ideas, and AI
> Agent are v1 **placeholders** ("Soon"), not features.
>
> **Revision note (v0.5).** Merges the Phase-2 consolidated edits (1–13 from
> `design-rules-phase2.md`) into the relevant sections as locked decisions — see
> the §13.2 summary — and marks the four overlay components locked (§14.6). The
> Phase-2 "Open decisions" (dark mode, logo, illustrations, microcopy, brand-kit,
> logic-views) stay open in §14.
>
> **v0.4.** Recorded the first implementation pass (admin repaint + runtime
> §10/§12) and turned the §14 open items into **⟶ Proposed** resolutions
> (pending owner sign-off; not yet locked).

**Contents**

# **0. How this system is organized**

Quizzy runs on one design system with two surface modes. Everything behaves the same everywhere; what changes between screens is how much color the chrome uses.

1. **Global layer.** The constant across every screen: color tokens (including the full pastel set), type, spacing, radius, motion, iconography, component shapes, and interaction/toggle behavior. Nothing here changes between pages.

2. **Expressive mode.** The dashboard and app pages (Home, Quizzes, Analytics, Products, Brand kit, Integrations). Color-forward: pastel fills, violet highlights, colored stat cards. These pages are ours, so Quizzy’s color leads.

3. **Focused mode.** The builder / editor canvas. Color-restrained: neutral chrome, gray stage, violet only on app actions. The one real color is the merchant’s brand, and it lives inside the quiz — because the purpose of that screen is to see the quiz being customized.

**There is no pictorial brand mark.** Identity comes from the type, the pastel-plus-one-accent color system, and the motion. (The earlier diamond glyph has been removed.) The interim mark is a **typographic “Q” monogram** — a rounded violet-wash tile with the initial in Quicksand (shipped: `Wordmark`/`.qz-wordmark-mono`). A final logo lockup is still open (§14.1).

**Companion reference:** the Device Preview & Module Templates spec covers the full frame spec, module templates, and edge cases in depth. This document is the global source of truth and holds the essentials.

# **1. Global — Principles**

These principles resolve anything the specs don’t cover. When unsure, choose the option that best honors them, in order.

1. **Soft, not flat.** Soft surfaces, gentle depth, warmth first.

2. **One bold moment per view.** Restraint makes a single accent land — a primary CTA or a featured stat, never everything at once.

3. **One motion language.** Every interactive element moves on the same spring. Consistent motion is most of the recognizability.

4. **Content over chrome.** On the builder, the merchant’s brand is the star; our chrome steps back to neutral so it never competes.

5. **Intuitive over dense.** When in doubt, remove. Generous spacing, few words, an obvious next action.

**Surfaces:** admin is desktop-only (≥1024px); the shopper quiz is fully mobile-responsive.

# **2. Global — Color**

## **2.1 Core neutrals**

| Swatch | Hex | Role |
| :---- | :---- | :---- |
|   | #FFFFFF | Surface — cards, panels, editor chrome |
|   | #F4F4F7 | Stage — neutral canvas backdrop (builder) |
|   | #F2F1F5 | Neutral wash — search, segments, hovers (a warm grey) |
|   | #2E2740 | Ink — primary text & structure |
|   | #5A5470 | Ink-2 — strong secondary text |
|   | #7C7791 | Muted — labels, secondary text |
|   | #B6B0C8 | Faint — meta, disabled |
|   | #E9E7EF | Line — hairline dividers & borders |

## **2.2 Accent & editing**

| Swatch | Hex | Role |
| :---- | :---- | :---- |
|   | #6D5AE6 | Violet — the one accent (links, active, primary actions). *Prototype `--brand`; supersedes the earlier #8B6EF5.* |
|   | #6B4FD8 | Violet-deep — gradients, hover |
|   | #3C3489 | Violet-ink — accent text on light / on-wash (prototype `--brand-ink`, ≈9:1). *Supersedes #5A3FC0.* |
|   | #EDEBFC | Violet-wash — active-nav wash, selected tints (prototype `--brand-bg`). *Supersedes #E6DDFE.* |
|   | #6D5AE6 | Editing selection ring — solid violet ring + `0 0 0 4px rgba(109,90,230,.18)` wash glow on the selected canvas element (prototype `.cel.sel`); hover = soft `#C7BEF6` ring. Builder/preview only (`inspectFn`-gated). *Supersedes the graphite #4A4560 dashed outline.* |
|   | #D4537E | **Coral "priority" accent** (`--qz-priority`, wash `--qz-priority-wash` #FBEAF2) — the ONE act-now / money item per surface: soft tint gradient + coral border/CTA (e.g. the "Recommended → didn't buy" segment + its Win-back CTA on Customer Engagement). Same one-per-surface restraint as violet; never more than one coral element per screen. (§A4) |

## **2.3 Pastel set (global tokens)**

The full pastel palette is global. Expressive surfaces use these as fills (stat cards, category surfaces); every pastel has a light fill and a matching darker tone for its number/label.

| Swatch | Hex | Role |
| :---- | :---- | :---- |
|   | #E6DDFE | Violet pastel — fill (darker tone 5B4A8F) |
|   | #FDE4EF | Rose pastel — fill (darker tone 8F4A70) |
|   | #D7F2EC | Mint pastel — fill (darker tone 3A7D6D) |
|   | #FDEED7 | Amber pastel — fill (darker tone 8F6A3A) |
|   | #A8C9FB | Sky pastel — fill, secondary use |

## **2.4 Status**

| State | Fill | Text / dot | Use |
| :---- | :---- | :---- | :---- |
| Draft | #F0EDF5 | #5A5470 label · #8B85A0 dot | Not yet live (label uses Ink-2 for AA — see §14.5) |
| Live | #E0F5EE | #3FAE86 | Published / running |
| Positive Δ | — | #3FAE86 | Upward trend |
| Flat Δ | — | #8B85A0 | No change |

## **2.5 Color-usage rule (P3 Edit 6 — the governing rule)**

Stops the “four different apps” feel — the one rule for where color is allowed:

* **Pastel tints** — ONLY for KPI/metric tiles and per-quiz identity (analytics modules, §15.7). Never for general cards.
* **Source-accents** — ONLY for taxonomy (group membership chips/icons, §16): Tags = violet · Collections = teal · Metafields = amber · Manual = pink.
* **Everything else** — neutral surfaces + the single violet accent (active states, primary buttons, links, focus).
* Real product/persona **imagery** carries visual interest on management surfaces, not decorative color.

**Source-accent tokens** (mapped onto the existing palette, each with a wash): `--qz-src-tag` = violet (`--qz-accent`) · `--qz-src-col` = teal (`--qz-pal-teal`) · `--qz-src-meta` = amber (`--qz-pal-amber`) · `--qz-src-man` = pink (`--qz-pal-pink`).

# **3. Global — Typography**

Admin typeface: **Quicksand** (400–700), a rounded geometric sans carrying the soft personality. *(Shipped: self-hosted OFL variable woff2 in `public/fonts/Quicksand.woff2`, leading `--qz-font-*`; Mona Sans is the metrics-close fallback during the swap window.)* The shopper quiz canvas uses its own theme font (default Inter), which merchants can change.

| Token | Size / weight | Use |
| :---- | :---- | :---- |
| H1 (page) | 24px / 700 | Page greeting |
| H2 (panel) | 16–17px / 700 | Panel headers (baked into modules) |
| Body | 14px / 500 | Default text |
| Meta | 11.5–12.5px / 500 | Timestamps, sublabels |
| Label | 10–11px / 700 | Uppercase eyebrows, +0.06em |
| Stat number | 28–30px / 700 | Featured metrics |

**Rule:** titles live inside their module. No floating page-level section-label bands.

# **4. Global — Spacing, Shape & Elevation**

* **Spacing:** 8px rhythm — 4 · 8 · 12 · 16 · 20 · 24 · 32. **Cards/panels never touch or overlap** (P2 Edit 10): a consistent minimum gap (≥16px, `--qz-pad-gap`) separates every card from its neighbours — a saturated card and a white one must read as clearly separate.

* **Radius:** cards/panels 18–24 · buttons/chips/inputs 12–16 · pills 100 · icon tiles 12–14.

* **Elevation:** soft, low-contrast, with a touch more pop so cards lift off the canvas (P2 Edit 11). Resting `--qz-lift-1` (0 4px 14px rgba(120,110,150,.10)); raised/hover `--qz-lift-2` (0 12px 30px rgba(120,110,150,.16)). **Every card hover-lifts** — a subtle translate + shadow increase on the Spring — as a global interaction rule (§5.2), applied everywhere, never per-card.

# **5. Global — Motion & Interaction**

This section defines how every control feels — how buttons pop, how things move, how toggles animate. It is identical on every page; that is what makes new screens feel continuous.

## **5.1 Curves**

| Curve | Value | Use |
| :---- | :---- | :---- |
| Ease | cubic-bezier(.3,.7,.3,1) | Color, shadow, fades, reveals |
| Spring | cubic-bezier(.34,1.4,.6,1) | Movement — lift, press, sliding pills/knobs |

## **5.2 Button & card states**

| State | Behavior |
| :---- | :---- |
| Rest | Neutral; resting shadow. |
| Hover (“pop”) | Lifts 2–5px on the Spring + raised shadow. Cards may glow softly in their own hue (Expressive). |
| Press | Dips and shrinks: translateY(0) scale(.97) on the Spring — a physical squish. |
| Focus | 3px neutral ring + violet border (keyboard accessibility). |
| Disabled | 60% opacity, no pointer, no motion. |

## **5.3 Toggles — how they move**

Every “pick-one” or on/off control animates its indicator into place; it never snaps. Three forms, one feel:

* **Segmented control (pick-one):** a white pill slides to the chosen option on the Spring (~420ms). Track = neutral wash; active label fades muted → ink. Used for Edit/Interact, Required/Optional, device, question type.

* **On/off switch (binary):** the knob slides on the Spring (~380ms); the track fills violet to mean “on,” neutral grey for “off.” Switches live in panels, never on the canvas.

* **Tabs:** an underline slides to the active tab on the Spring (~420ms); active label picks up violet. Used for Add/Layers/Background and inspector tabs.

## **5.4 Reveal-on-hover (Expressive, strategic)**

Select modules expand on hover to reveal deeper info (easing max-height + opacity), borrowing the “results reveal” delight from the quiz. Use sparingly — recent-quiz cards and a “top result” widget. Never on plain stat tiles.

## **5.5 Inter-step loading (funnel generation)**

Between funnel steps, generation shows a **centered, gently animated graphic**, then **sequential status messages** (“Building X”, “Doing Y…”) that fade in and out one at a time as each completes — calm, polished, branded motion. Replaces the old static checklist. Build as a reusable, token-wired `StepLoader` (P2 Edit 8).

# **6. Global — Iconography**

* **Style:** line icons, ~1.75px stroke, rounded caps/joins, single weight — matching Quicksand’s warmth.

* **Size:** nav/inline 16–18px; icon tiles 20px inside a 40–46px rounded chip.

* **Color:** muted at rest, violet when active (Expressive) or ink (Focused).

* **Emoji:** expressive, zero-asset per-option and per-quiz marks in a soft chip.

* **Library:** ⟶ **Proposed** (§14.2): lock **Lucide** as the single rounded set — it already ships in the codebase (`lucide-react`), matches the ~1.75px rounded-cap style, and covers the inventory. Pending sign-off.

# **7. Global — Components**

Component shape and behavior are global; only their color intensity changes by mode (Parts 2–3).

* **Navigation / tool rail:** flat icon+label list, no category words; active = fill + accent **+ bold label** (weight 500) so the active item reads by weight, not just color (P2 Edit 5). (Expressive violet wash / Focused neutral + violet text.)

* **Content padding (shell-level, global):** every studio page's content area uses the SAME left/right/top padding (~32px desktop) provided by the shared shell container — never per-page (P2 Edit 4). No screen sits at a different distance from the sidebar.

* **Buttons:** Primary = violet gradient; Secondary = neutral wash + violet-ink; Ghost = violet text. All use the state rules in §5.2.

* **Cards / panels:** self-contained, titled modules; soft elevation; 5px hover lift.

* **Stat card:** label inside, big number, trend below; one saturated “hero,” the rest soft (Expressive).

* **Segmented control · switch · tabs:** per §5.3.

* **Inputs / search:** search = round wash pill w/ leading icon; inputs bordered (Line) with violet focus ring, radius 12–14.

* **Status pill:** fully round, uppercase 9–10px label + dot; Draft grey, Live green.

* **Progress dots:** completed = violet, upcoming = faint, current = enlarged accent dot. A quiz-native motif reused across multi-step flows.

* **Section header** (P2 Edit 6): the ONE standardized way to title a section/panel — reusable `SectionHeader` component (title, optional action/link on the right). Stop hand-styling section titles per page; this is a top-line setting.

* **Funnel stepper — segmented bar** (P2 Edit 1): five connected, equal-width rounded segments reading as one control (~8px radius, ~6px gap, ~10–12px vertical padding, centered labels). Completed = light-violet fill + green check + dark-violet label; active = solid violet fill + white label; upcoming = neutral surface + muted label/number. Restyle only — done/active/upcoming logic unchanged. Reusable `FunnelStepper`, consumed by all 5 funnel steps. Narrow widths: labels truncate → numbers-only, but the active segment keeps its label.

* **Overlays — modal · drawer · toast · menu** (P2 Edit 3): reusable, token-wired, Soft-Pastel (rounded, soft shadow, violet accent, Spring motion). **Modal:** centered card, radius-lg, lift-3 + `--qz-scrim`, spring scale-in; ghost close top-right; violet-gradient primary. **Drawer:** side sheet, lift-2, spring slide-in, same scrim. **Toast:** bottom-center card, radius-toast, lift-2, status color on the left rule, spring rise-in, auto-dismiss. **Menu:** paper card, radius 14, lift-2, 40px rows, violet-wash active, z per the ladder.

# **8. Expressive Mode — Dashboards & App Pages**

**Applies to:** Home, Quizzes, Analytics, Products, Brand kit, Integrations. These are Quizzy’s pages, so color leads.

## **8.1 Color rules**

* Pastel palette used as fills — stat cards in violet / rose / mint / amber, category surfaces tinted.

* Exactly one saturated hero element per view (the primary CTA or a featured stat in violet).

* Active navigation = violet wash fill + violet text/icon.

* Soft white / light backgrounds; soft violet-tinted elevation.

## **8.2 Layout**

* Left sidebar (~224px) + content area with a greeting row, then modular rows of self-contained panels.

* **Home is a full dashboard** (P2 Edit 6): a “Welcome back, [name]” header; a **stat-card row** (Quiz starts · Completion rate · Emails captured · Click-through — pastel tints, one saturated hero); an **illustrated hero / “launch your next quiz” banner**; a **Recent quizzes** list (thumbnail + status pill + “View all →”); and a **“Quiz starts this week” chart panel**. Section titles use the standardized `SectionHeader` (§7), never hand-styled.

* **Quick-action widgets** (P2 Edit 12): distinct on-brand entry-point tiles — **Create quiz (AI-assisted)**, **Create quiz manually** (non-AI), **A/B testing**, **Strategy ideas** — each a dashboard card with the global hover-lift (§5.2 / Edit 11).

* Titles baked into modules via `SectionHeader`; no floating section labels.

# **9. Focused Mode — The Builder / Canvas**

**Applies to:** the builder / editor. Purpose: see the quiz being customized in the merchant’s brand. Color is pulled out of the chrome so the content is the star.

## **9.1 Color rules**

* Chrome is neutral warm-grey (the pastels appear only as quiet greys, not saturated fills).

* Violet appears only on app actions that are spatially separate from the canvas — Publish and Assist / AI.

* The editing selection is a graphite ring (no accent color), so it never matches or fights the merchant’s brand.

* The stage behind the quiz is neutral grey; the quiz widget is white.

* The only real color is the merchant’s brand — applied inside the quiz.

## **9.2 Brand-kit theming (inside the canvas)**

* The quiz is WYSIWYG: it renders the shopper-facing quiz as it will publish.

* Base theme = “Clean” (near-white, neutral, Inter). The merchant’s saved Brand-kit color is applied on top — progress bar, primary/Next button, and option selection take the brand color.

* Merchants further customize in the Design tab.

## **9.3 Two selection languages (kept distinct)**

| Selection | Treatment | Meaning |
| :---- | :---- | :---- |
| Editing (admin) | Graphite ring on the element | What you’ve clicked to edit — Quizzy chrome |
| Answer (shopper) | Brand-color ring + check | The chosen answer — the quiz theme |

## **9.4 Builder layout**

* Slim tool rail (Build · Products · Logic · Design · Settings) — icon + label, neutral active.

* Left panel: Add / Layers / Background tabs (and Content / Logic on the Questions step); Add lists grouped elements (Questions / Media / Content). **Collapsible to a narrow rail and resizable** — draggable width with a sensible minimum — across ALL builder surfaces (P2 Edits 9, 13).

* Center: neutral stage + the WYSIWYG quiz widget, **centered in its column** (P2 Edit 9).

* Right inspector: progressive disclosure — essentials shown, advanced tucked under “More options.”

* Bottom: step filmstrip of neutral thumbnails; active step = graphite ring.

## **9.5 Spacing (compact)**

**The builder stays dense.** Sections, groups, and panels sit close together with tight gaps — element groups in the Add panel, stacked canvas sections (quiz · recommendations note · floating launcher), and the panels themselves are packed, not spread out. This is a deliberate contrast with the airier Expressive dashboards: the builder is a working surface where everything should stay within reach. Keep to the lower end of the 8px scale (4–12) between related items; reserve larger gaps for true separations.

# **10. Quiz Widgets (Shopper-Facing)**

The live quiz is mobile-responsive. Answer options support five image systems; all ship, exposed as a per-question layout choice. Default is the zero-asset emoji chip.

| System | Assets | Best for |
| :---- | :---- | :---- |
| Emoji / icon chip (default) | None | Abstract choices (skill, budget, vibe) |
| Photo thumbnail | Optional (emoji fallback) | Concrete products / styles |
| Image-top card | One photo per option | Visual products |
| Full-bleed overlay | Strong photo per option | Mood / lifestyle brands |
| Tile grid | Photo per option | Personality / pick-your-vibe |

**Selection:** the whole card indicates selection (brand-color ring + check). Fallback for image layouts with no photo yet = the emoji chip.

# **11. Preview & Device Frames**

One preview approach across the product, so a merchant sees the same quiz everywhere it appears. The full frame spec, module templates, and edge cases live in the companion spec; the essentials:

## **11.1 Edit vs Interact**

* **Edit = frameless.** While editing, the quiz renders as a bare rounded surface on the neutral grey stage — no device bezel — for maximum room; elements carry the graphite editing ring.

* **Interact / Preview = framed.** Switching to Interact (or opening Preview) wraps the quiz in a device frame; it then behaves like the live shopper experience — tap-through, no editing chrome.

## **11.2 The frame**

* **Mobile = frameless phone.** A rounded screen with a soft shadow — no bezel, no notch, clean top — with squarer corners (~24px) so it reads true to a real phone. Portrait only. Canonical viewport 390 × 844.

* **Desktop = browser frame.** A neutral rounded card with a slim top bar and three dots (no URL chrome). In scope for v1.

* **One frame everywhere.** Drawer, builder, and Design-step previews use the same frame; card and filmstrip thumbnails are cropped versions of it, never a different device.

* **Neutral furniture.** The frame is never tinted with the brand color; the screen inside carries the quiz theme (Clean + Brand kit).

## **11.3 Progress in preview & live**

Progress is segmented — one segment per question in the current path; completed segments fill with the brand color, the current one is highlighted. Branching quizzes update the segment count to the current path (never a false percentage); linear quizzes use the same style for consistency.

## **11.4 Template & preview graphics — on-theme (P2 Edit 7)**

The Shape-step template cards and the “See it live” preview must match the brand: friendly, colorful illustrations in the pastel/violet family (reference dashboard illustration style), and noticeably **larger** — beautiful, not utilitarian. **Bug fixed:** the “See it live” phone renders the **new slim, repainted runtime**, not the old runtime styling.

# **12. Responsive & Deployment**

How the live quiz survives a real Shopify storefront — embedded in themes of every width. Split into reflow rules (also simulated in the builder preview, so WYSIWYG holds) and runtime concerns (built at deploy; not shown in the builder).

## **12.1 Reflow rules — builder preview AND live**

* **Reflow by container, not viewport.** A quiz in a narrow sidebar on a wide screen still uses the mobile layout.

* **Min width 320px.** Below it, the quiz clamps to its 320 layout rather than breaking.

| Breakpoint | Width | Behavior |
| :---- | :---- | :---- |
| Mobile | 320–559 | Options stacked full-width; primary button full-width; padding tightened; heading scales down. |
| Comfortable | 560–719 | Roomier padding; heading full size; primary button auto-width, right-aligned. |
| Desktop | 720+ | Content caps at ~640px and centers; side gutters grow — never stretches edge-to-edge. |

* **Floors:** font never below 14px; tap targets never below 44px; long text truncates to 2 lines; images cover-crop with a max height.

* **Option columns:** tile grid 1 → 2 → 3 columns by width; image-top cards go single-column when narrow.

* **Segmented progress:** enforce a minimum segment width; collapse to a compact indicator when there are too many questions in a path.

## **12.2 Runtime — live storefront only (engineering at deploy)**

* **CSS isolation.** Shadow DOM / scoped reset so the merchant’s theme CSS can’t leak in and break layout — the top storefront failure mode.

* **Container-responsive.** Reflow driven by the embed’s own width (container queries), per §12.1.

* **Overflow by surface.** Inline embed grows with content (the page scrolls); the floating-launcher popup is a capped modal that scrolls inside itself.

* **Font loading.** Load the quiz’s theme font with a fallback so it never inherits a random storefront font.

* **Two embed surfaces:** inline embed and floating launcher, each with its own size rules.

# **13. Locked Decisions**

* One system, two modes: Global · Expressive · Focused.

* Style: Soft Pastel. Typeface: Quicksand (admin); quiz canvas default Inter.

* Full pastel palette is global; used as fills in Expressive, as quiet greys in Focused.

* One accent (violet); one saturated hero element per Expressive view.

* No pictorial brand mark — the diamond glyph has been removed; interim typographic “Q” monogram shipped. Final lockup TBD (§14.1).

* One spring motion language; toggles animate (sliding pill / knob / underline).

* Button states: hover lift 2–5px, press scale .97, violet focus ring, disabled 60%.

* Builder chrome neutral; violet only on Publish & Assist; editing selection = graphite ring.

* Builder stage neutral grey; quiz widget white; brand color applied inside the quiz (Clean base + Brand kit).

* Two selection languages: graphite (editing) vs brand-color (answer).

* Focused mode is compact — sections/panels sit close together; Expressive dashboards are airier.

* Titles baked into modules; sidebar flat, no category words.

* Quiz option image systems: all five ship; default emoji chip.

* Admin desktop-only; shopper quiz mobile-responsive.

* Edit is frameless; Interact/Preview is framed — frameless phone on Mobile (squarer ~24px corners, no bezel/notch), browser frame on Desktop (in v1 scope).

* Progress is segmented — one segment per question in the current path.

* Quiz reflows by container width; min 320px; desktop content caps ~640px, centered; button full-width (narrow) → auto-width right-aligned (wide).

* Live floors: font ≥ 14px; tap targets ≥ 44px.

* Live-only (deploy): CSS isolation, container queries, overflow-by-surface, font loading, inline + popup embed surfaces.

## **13.1 Implemented (first pass)**

What is now in code (admin repaint + runtime pass), so the locked decisions above are no longer paper-only:

* **Token layer** (`app/styles/quizocalypse.css` `:root`): the §2 neutrals + violet accent + global pastel set + status, §3 type scale, §4 radius/elevation, §5.1 Ease + **Spring** curves — all live as `--qz-*` values.
* **Typeface:** Quicksand self-hosted + preloaded (§3).
* **Mark:** diamond removed; typographic “Q” monogram shipped (§0/§13).
* **Components:** buttons (violet-gradient primary / wash + violet-ink secondary / ghost), Spring pop + press-squish, status badges, segmented-control Spring, stat-card pastel classes.
* **Runtime (`/q`, brand-themed):** §10 whole-card selection = brand ring + check; §12.1 font-≥14 and tap-≥44 floors; keyboard focus ring picks up the brand color.

Since then: Expressive stat-card hue-wiring shipped on `/studio/analytics` (revenue = hero).

## **13.2 Phase 2 — locked (merged; implementation in progress)**

The Phase-2 consolidated edits are folded into the sections above and locked:

* **Funnel stepper → segmented bar** (§7) — reusable `FunnelStepper`, restyle only.
* **Login page repaint** — `/studio/login` loads the admin sheet, carries Soft Pastel (violet + Quicksand).
* **Overlays** — modal · drawer · toast · menu (§7 / §14.6), reusable + token-wired.
* **Consistent content padding** (§7) — one shell-level setting, never per-page.
* **Active-nav bold** (§7 / §5).
* **Home = full dashboard** + quick-action widgets (§8.2); standardized `SectionHeader` (§7).
* **On-theme, larger template/preview graphics; slim-runtime “See it live” phone** (§11.4).
* **Inter-step loading animation** (§5.5) — `StepLoader`.
* **Builder left panel collapsible + resizable; centered preview** (§9.4).
* **Cards never overlap** (§4) + **global card elevation & hover-lift** (§4 / §5.2).

Deliberately NOT decided (remain open, §14): dark mode, final logo lockup, illustration set, microcopy/voice, brand-kit lock, logic-views design. On-brand inline-SVG/CSS defaults stand in for illustrations until the set is chosen.

# **14. Open Items**

Each item below carries a ⟶ **Proposed** resolution grounded in the shipped system. Proposals are **pending owner sign-off** — not yet locked.

**14.1 Final logo lockup / wordmark.** ⟶ **Proposed:** keep it purely typographic (consistent with "no pictorial mark"): the shipped “Q” monogram tile as the standalone/favicon mark; wordmark = "quizzy" in Quicksand 600, −0.02em, ink. Open sub-decision: does the tile persist beside the wordmark, or stand alone? Needs a designer optical-spacing pass before locking.

**14.2 Icon library.** ⟶ **Proposed:** lock **Lucide** (`lucide-react`, already a dependency; rounded caps/joins, single weight per §6). Inventory to export: nav (home, quizzes, analytics, products, brand, integrations, settings) · builder tools (build, products, logic, design) · actions (publish, assist/AI ✦, add, layers, background) · state (check, chevron, info, close). Freeze that subset.

**14.3 Illustration set.** ⟶ **Proposed direction** (asset production, not a spec call): soft-pastel, rounded, flat-with-gentle-depth spot art using the pastel palette + one violet accent each; three contexts — hero (home greeting), empty states (no quizzes / no products / no results), celebration (publish + quiz-complete). Remains open pending a design resource.

**14.4 Dark mode — in or out for v1?** ⟶ **Proposed: IN, admin-only** (as shipped): the token layer already carries violet-adapted dark counterparts + a FOUC-safe toggle. The shopper quiz stays brand-themed (dark is the merchant's choice, not ours). Caveat: dark needs the same AA pass as §14.5 before it's called done.

**14.5 Accessibility — AA contrast + focus-visible.** ⟶ **Proposed, concrete:**
* Focus-visible (lock): admin = 3px violet ring; quiz = 3px ring in brand color with neutral fallback. Both shipped.
* Contrast: Violet-ink secondary text (#5A3FC0 ≈6.3:1) ✓; pastel stat numbers on their -ink tones (≈5.9:1) ✓; Live pill label = #158A5A on mint (≈4.7:1) ✓. **One fix (applied):** the **Draft** pill label (#8B85A0 on #F0EDF5 ≈2.4:1) failed — now retinted to Ink-2 **#5A5470** (≈6.6:1) in `.qz-badge.qz-draft`, keeping the wash + #8B85A0 dot. Keep Muted #7C7791 to ≥18px / non-essential text only.
* Action: automated axe pass on both modes; the Draft pill is the only current fail.

**14.6 Components.** ⟶ **Modal · drawer · toast · menu are now LOCKED** (P2 Edit 3 — full specs in §7, built this pass). Tooltip / tables / skeleton / sliders remain ⟶ **Proposed** (reusing shipped tokens/shapes):
* **Modal:** centered card, radius-lg (24), lift-3 + `--qz-scrim`, max-width ~480–560, Spring scale-in from .96; ghost close top-right; violet-gradient primary.
* **Drawer:** side sheet, lift-2, Spring slide-in, same scrim.
* **Toast:** bottom-center card, radius-toast (12), lift-2, status color on the left rule, Spring rise-in, auto-dismiss.
* **Tooltip:** small ink chip, radius-sm, 12.5px, Ease fade (the runtime `TooltipChip` is the quiz analogue).
* **Menu:** paper card, radius 14, lift-2, 40px rows, violet-wash active, z per the ladder.
* **Tables/grids:** lock the shipped `.qz-table` (48px rows, mono uppercase headers, hairline dividers).
* **Empty / loading:** `.qz-skeleton` pulse + §14.3 empty-state art; **never spinners for content**.
* **Sliders/scrubbers:** neutral wash track, violet fill + thumb, radius per §4, Spring feel (the runtime scale-slider is the reference).

**14.7 Toggle timing + switch "on" color.** ⟶ **Proposed:** standardize timing on the token **`--qz-dur-slow` (300ms) + Spring** (what shipped; within the spec's ~400ms tolerance, and one value beats two). Switch "on" = **violet** (`--qz-accent`), per §5.3 "track fills violet"; reserve green for Live status only. Resolves violet-vs-green → violet.

**14.8 Microcopy / voice.** ⟶ **Proposed direction** (needs a writer pass): warm, plain, concise; "you/your"; verbs on buttons ("Publish", "Add question" — never "OK/Submit"); sentence case except uppercase eyebrow labels; empty states = one line of *what* + one action. Tone decision + glossary remain open.

**14.9 Brand-kit scope.** ⟶ **Proposed (lock to the shipped surface):** on the quiz only, a merchant may set **primary** (CTA/Next, selection ring + check, progress fill), **background**, **text**, plus **theme font**, **radius**, **spacing**. They may **not** recolor admin chrome (violet is ours), status colors, or the graphite editing ring.

**14.10 Minor defaults.** ⟶ **Proposed (confirm):** desktop content cap **640px**, min width **320px**; a wider ~700px cap stays an opt-in per-quiz setting for image-heavy quizzes, not the default.

**14.11 Logic views (Map / Paths / Table).** **Still open — needs full design.** ⟶ **Direction only:** Focused-mode neutrals + graphite selection; Map = node graph on the grey stage; Paths = branch list using the segmented-progress motif; Table = the `.qz-table` spec. The remaining major screen to design.

# **15. Phase 3 — locked (post-Phase-2)**

Merged from `design-rules-phase3.md`; Phase 2 stays frozen as-built. The
color-usage rule (Edit 6) lives in §2.5; the Groups & Personas page (Edit 2) in §16.

## **15.1 Content-layout guardrail — centered max-width (P3 Edit 3)**

Every **standard** studio page (workspace exception §15.4):
* Content in a **centered max-width container** (`margin: 0 auto`); collapsing the sidebar **auto-recenters** it.
* **Fluid below the cap, centered above it** — never sprawls on ultrawide.
* Per-page width token: **`narrow`** ~680px (forms/wizards/reading) · **`comfortable`** ~960px (mixed) · **`wide`** ~1280px (data-dense: Home, Analytics, Groups).
* Side padding (P2 Edit 4) still applies inside the container.

## **15.2 Card-grid guardrail — fill, no orphans, compact (P3 Edit 4)**

Standard pages, not the builder:
* Grids **fill the container** — equal `1fr` columns, 16px gap; no fixed-px cards leaving voids.
* **No orphans** — stat tiles 4-up → 2×2 → 1; action cards 3-up → 1; content panels 2-up → 1.
* **Compact, uniform** metric-tile heights; content cards size to content. Leftover space = symmetric margins.

## **15.3 Home layout order (P3 Edit 5)** — `wide` container

1. **Hero** “Launch your next quiz” (full width, CTA “Create with AI”, small graphic right).
2. **3 action cards** (3-up): Create manually (active) · A/B testing · Strategy ideas — the last two are v1 **placeholders** with a subtle **“Soon”** tag (not clickable).
3. **4 KPI tiles** (4-up → 2×2), compact, pastel-tinted.
4. **Recent quizzes + chart** (2-up).

Standardize **“A/B testing”** everywhere (nav + card). Nav placeholders (AI Agent, A/B testing, Strategy) show “Soon” — **no dead links**.

## **15.4 Full-bleed workspace exception (P3 Edit 7)**

§15.1/§15.2 do **NOT** apply to builder/workspace surfaces. The quiz builder (left rail · center canvas · right inspector) and any full-bleed editor **fill the viewport** with their own panel layout + collapsible/resizable panels (P2 Edits 9/13). Standard pages = centered container; workspaces = full-bleed.

## **15.5 Accessibility guardrail (P3 Edit 8)**

All new components/motion:
* Respect **`prefers-reduced-motion`** — hover lifts, fades, pop-ins, growing bars, and the inter-step loader reduce to instant/opacity-only.
* **Visible keyboard focus rings** on every interactive element (nav, cards, chips, pickers, wizard).
* **Color is never the sole signal** — source accents, statuses, states always pair with a label/icon (colorblind-safe).
* Custom option/persona colors get a **contrast check**.

## **15.6 Empty / first-run states (P3 Edit 9)**

Every surface has an intentional empty state — reusable **`QzEmpty`** (calm, one line + one action): Groups → “Create your first group”; All products → “Connect Shopify or add a product”; Home → KPIs show “—”/0 gracefully; Analytics → invite to create one. No raw 0s, blank panels, or console errors.

## **15.7 Analytics — per-quiz modules (P3 Edit 1, Version B)**

Replace the account-wide KPI grid with **one module per quiz**:
* Accent **rotates per quiz** (violet, pink, mint, amber…). **Tinted header band** (the quiz accent) with the hero KPI (attributed revenue + trend Δ) + a small **animated mini-trend** (bars grow in on load).
* **Clean neutral body**: secondary KPIs (Started, Completion, Contacts), no color.
* **Layered click affordance**: persistent “View full analytics →” footer; on hover the card lifts (P2 Edit 11), footer becomes a solid accent button, arrow nudges.
* **No-data** quizzes still render with a calm “no data yet” state (revenue “—” until orders + `read_orders`).
* Clicking a module opens that quiz’s **full analytics** (page inside its builder).

# **16. Groups & Personas (P3 Edit 2)**

**Identity:** nav label **“Groups”**; page title **“Groups & Personas”** (no “Products” eyebrow). Look/flow reference: `docs/prototypes/quizocalypse-products-groups-prototype.html`.

**Two views on the page:**
* **Groups** (primary/default).
* **All products** (secondary, light): a simple product list — connect Shopify, import CSV, add manually, edit/delete. The source pool + the only way standalone merchants get products in. Reached via a secondary tab / “manage source” link. Minimal, not co-equal.

**Tone:** neutral base (off-white canvas, white cards) + **~20% color** via source-coded accents, real product/persona imagery, light animation. Governed by §2.5.

**Groups list + detail:**
* Left: group list; each row = **light accent tile** (persona image or initial), name, product count.
* Right: detail fades in on select — banner (image/initial + name + type/persona pills), **ⓘ info** toggle (“how this group is built”), **source-coded membership chips**, a **“Products in this group (N)”** mosaic of real product images (pop-in, hover scale), and a **read-only** “Used as an outcome in N quizzes” / “Not yet used in a quiz” (no action — mapping happens only inside a quiz).

**Guided create** (New group → modal [P2 Edit 3]; Cancel + X with discard confirm) — **3 steps:**
1. **Define** — membership, mix any of four sources (no mode toggle): **Tags · Collections · Metafields** (dynamic, from Shopify) · **Manual** (hand-picked). Each “+ Add” opens a picker pulling that data; selections = source-coded removable chips. Live **“products in this group (N)”** preview updates as criteria change.
2. **Name & note.**
3. **Persona (optional)** — toggle → persona name / description / image. No “use as outcome” step.

**Source accents (§2.5):** Tags = violet · Collections = teal · Metafields = amber · Manual = pink (on section icons + chips only).

**Reuse:** `QzModal` (wizard + picker), the `Category` model + `categoryGrouping`/`categoryAssign` for membership resolution, `studio.products` for the All-products view. New library pieces: a source picker + group list/detail.

*Quizzy Master Design System · v0.6 · living document*