# Design Rules — Phase 3 (post-Phase-2 design edits)

> Design edits logged **after** Phase 2 was locked and sent to build. Phase 2 stays
> frozen as-built. Same flow when ready: move this into the project, merge into
> `design-rules.md`, implement, review in the browser, commit. Do not push/deploy.

---

## Edit 1 — Analytics page → per-quiz modules (Version B)

Replace the account-wide pastel KPI grid with **one module per quiz**:
- Each quiz is its own card; accent color **rotates per quiz** (violet, pink, mint, amber, … cycling).
- **Tinted header band** (the quiz's accent) with the hero KPI (attributed revenue + trend delta, e.g. "▲ 12%") and a small animated mini-trend chart (bars grow in on load).
- **Clean neutral body** with secondary KPIs (Started, Completion, Contacts) — no color, plain values.
- **Click affordance (layered, not hover-only):** persistent "View full analytics →" footer; on hover the card lifts (Phase 2 Edit 11), footer becomes a solid accent button, arrow nudges.
- **Empty/no-data quizzes:** module still renders with a calm "no data yet" state (revenue often "—" until orders + `read_orders` consent flow — see functionality §G).
- **Navigation:** clicking a module opens that quiz's **full analytics as a page inside its builder**.

_Status: locked (Version B)._

---

## Edit 2 — Groups & Personas page (REVISED, v3)

**Identity (resolved):** nav label **"Groups"**; page title **"Groups & Personas"**. (No "Products" eyebrow.)

**Two views on the page:**
- **Groups (primary/default).**
- **All products (secondary, light):** a simple product list — connect Shopify, import CSV, **add manually**, edit/delete. This is the source pool and the *only* way non-Shopify/standalone merchants get products in (restores the path the earlier catalog-cut removed). Reached via a secondary tab or the "manage source" link. Kept minimal — not a co-equal heavy surface.

**Visual tone:** neutral base (off-white canvas, white cards) + **~20% color** via source-coded accents, real product/persona images, light animation. No rainbow, no heavy fills. (Governed by the color-usage rule, Edit 6.)

**Groups management (list + detail):**
- Left: group list; each row = **light accent tile** (persona image when set, else initial), name, product count.
- Right: detail fades in on select — banner (image/initial + name + type/persona pills), **ⓘ info** toggle ("how this group is built"), **source-coded membership chips**, a **"Products in this group (N)"** mosaic of real product images (pop-in, hover scale), and a **read-only** "Used as an outcome in N quizzes" (or "Not yet used in a quiz" — no action; mapping happens only inside a quiz).

**Guided create flow** (on "New group" → overlay; Cancel + X with discard confirm) — **3 steps**:
1. **Define — membership, mix any of four sources (no mode toggle):** Tags · Collections · Metafields (all dynamic, from Shopify) · Manual (hand-picked). Each "+ Add" opens a picker pulling that Shopify data; selections show as source-coded removable chips. Live **"products in this group (N)"** preview updates as criteria change.
2. **Name & note.**
3. **Persona (optional)** — toggle → persona name / description / image. *No "use as outcome" step* — mapping happens when building the quiz.
- Reuses the Phase 2 modal component (Phase 2 Edit 3).

**Source accent colors:** Tags = violet · Collections = teal · Metafields = amber · Manual = pink (on section icons + chips only).

_Status: locked._

---

## Edit 3 — Content-layout guardrail (REVISED — left-align + fill; center only where it helps)

Supersedes the earlier "center everything" rule, which stranded content in a narrow band = wasted space. Matches pro admin apps (Claude Console, Shopify admin, Linear): **content is left-aligned and fills the width; only specific page types are contained/centered.** Standard pages only (builder exempt, Edit 7).

**Three layout modes — each page declares one:**
- **`fill` — default, for data / list / management pages** (Quizzes, Analytics, Groups, Customers, Integrations…): content is **left-aligned** (consistent left padding after the sidebar) and **fills the width** up to a generous cap (~1440px), filling that width with **multi-column grids/tables** (Edit 4). No centered narrow column. On ultrawide it caps at the max, left-aligned; sidebar collapse just gives content more width.
- **`contained` — Home dashboard only**: the composed hero + card treatment; may center/cap for a polished landing feel.
- **`reading` — ~680px, left-aligned**: forms, wizards, single-column.

**Why:** a lone centered column looks empty on a wide screen; left-aligned fill + multi-column uses the space and reads professional. This is the fix for the reported wasted space + weird spacing.

_Status: revised — fill/left-align is the default; center reserved for Home + forms._

---

## Edit 4 — Global card-grid guardrail (fill, no orphans, compact)

Applies to standard pages (not the builder — Edit 7).
- **Grids fill the centered container** — equal `1fr` columns, 16px gap. No fixed-px cards leaving voids.
- **No orphan cards** — stat tiles **4-up → 2×2 → 1**; action cards **3-up → 1**; content panels **2-up → 1**. Responsive, not one-off.
- **Compact, consistent card heights** — metric tiles short + uniform; content cards size to content.
- **Balanced whitespace** — centered container (Edit 3) makes leftover space symmetric margins, never a one-sided void.

_Status: locked._

---

## Edit 5 — Home dashboard layout order

Home = `wide` container, grids per Edit 4:
1. **Hero — "Launch your next quiz"** on top, full width; CTA "Create with AI." Small, subtle graphic on the right.
2. **3 action cards** (3-up): **Create manually** (active) · **A/B testing** · **Strategy ideas** — the last two are v1 **placeholders** shown with a subtle "Soon" tag (kept for layout + roadmap visibility; not clickable yet).
3. **4 KPI tiles** (4-up → 2×2), compact, pastel-tinted.
4. **Recent quizzes + chart** (2-up).

_Status: locked._ (Note: standardize the label **"A/B testing"** everywhere — nav item and card — not "AB Testing.")

**Nav placeholders:** AI Agent and A/B testing have no v1 feature — show them with a "Soon" tag or hide from the v1 nav (owner's call). No dead nav links.

---

## Edit 6 — Global color-usage rule (the governing rule)

Stops the "four different apps" feel. One rule for where color is allowed:
- **Pastel tints** — only for **KPI/metric tiles** and **per-quiz identity** (analytics modules). Never for general cards.
- **Source-accents** (tags=violet, collections=teal, metafields=amber, manual=pink) — only for **taxonomy** (group membership chips/icons).
- **Everything else** — neutral surfaces + a **single violet accent** (active states, primary buttons, links, focus).
- Real product/persona **imagery** carries visual interest on management surfaces, not decorative color.

_Status: locked._

---

## Edit 7 — Full-bleed / workspace exception

Edits 3 & 4 (centered max-width + card grids) do **NOT** apply to builder/workspace surfaces. The quiz builder (Part A: left / center-canvas / right zones) and any full-bleed editor **fill the viewport** with their own panel layout and collapsible panels (Phase 2 Edit 13). Standard content pages get the centered container; workspaces get full-bleed. State the boundary so the two rules don't fight.

_Status: locked._

---

## Edit 8 — Accessibility guardrail

Applies to all new components/motion:
- Respect **`prefers-reduced-motion`** — hover lifts, fades, pop-ins, growing bars, and the inter-step loader reduce to instant/opacity-only when set.
- **Visible keyboard focus rings** on every interactive element (nav, cards, chips, pickers, wizard).
- **Color is never the sole signal** — source accents, statuses, and states always pair with a label or icon (colorblind-safe).
- Custom option/persona colors get a **contrast check** (extends §G11).

_Status: locked._

---

## Edit 9 — Empty / first-run states everywhere

Every surface needs an intentional empty state (reuse the standard empty-state component — calm, one line + one action):
- **Groups** with 0 groups → "Create your first group."
- **All products** with 0 products → "Connect Shopify or add a product."
- **Home** with 0 data → KPIs show "—"/0 gracefully; hero + actions still guide.
- **Analytics** with 0 quizzes → invite to create one.
No raw 0s, blank panels, or console errors (matches functionality §B11).

_Status: locked._

---

## Edit 10 — List/dashboard layout polish (fixes wasted space + spacing)

Applies the revised Edit 3 (`fill`) + Edit 4 to the built pages:
- **Quizzes**: 2–3-column card grid (fills width), compact cards.
- **Analytics**: 2–3-up per-quiz modules; **compact tinted headers** (not tall empty boxes); no-data modules show a **subtle dashed placeholder trend line** instead of empty space.
- **Groups empty state**: an anchored, centered **card** ("Create your first group" + icon + CTA), not floating in a huge void.
- **General**: tighten oversized internal paddings; consistent vertical rhythm; content left-aligned + filling per Edit 3.

_Status: locked._

---

## Edits pending (add below as compiled)

<!-- New Phase 3 decisions get appended here as their own "## Edit N — …" sections. -->
