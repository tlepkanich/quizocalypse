# Structure & Components (App Shell + Component Library)

> **Addendum to the Soft Pastel design system.** These are the *global,
> structural* rules for the studio (admin) surface — the app shell/layout and the
> reusable component library. They live at the shell/component level and cascade to
> **every** page automatically. A new or edited page inherits the design because
> it's *assembled* from these blocks, never styled from scratch. Merge this into
> the master `design-rules.md`. Single source of truth for UI: change a component
> here → it updates everywhere it's used.

---

# Part A — App Shell & Layout

## A0. Guiding principle
The studio should feel **calm, spacious, consistent**. Density is *balanced* —
comfortable breathing room without wasting space. Every screen shares one shell:
a persistent left sidebar, a padded content area, a consistent page header.
Nothing hugs the sidebar; nothing stretches edge-to-edge without padding.

## A1. App shell layout
- Two-zone shell: **sidebar** (left, fixed) + **content area** (right, scrolls).
- Implement once in the root studio layout so all routes inherit it.
- Full viewport height; only the content area scrolls, the sidebar stays put.
- App canvas uses the softest neutral (`surface/base`); content sits on it with
  cards/panels in `surface/raised`.

## A2. Sidebar — **default: expanded, with a collapse toggle**
- **Expanded width:** ~248px (icon + label per item).
- **Collapsed width:** ~64px (icons only; label as hover tooltip). A toggle
  (chevron/hamburger at top) switches states. **Persist the choice** (localStorage).
- **Active item:** filled pill in accent tint (violet-50 bg, violet-600 text/icon).
- **Hover (inactive):** subtle neutral tint, no harsh borders.
- **Grouping:** primary nav grouped; thin divider under the brand/logo block. Logo
  collapses to the "Q" mark on the rail.
- **Spacing:** 4px between items, 12px section padding, 20px icons, 44px min row.
- **Motion:** width transition ~200ms on the system Spring/ease token; labels fade.

## A3. Content area
- **Padding:** `32px` desktop / `20px` narrow, all sides — content never touches the
  rail. (This fixes "everything's too close to the sidebar.")
- **Width:** flexible — fills available space (good for tables/dashboards); no hard cap.
- **Page header (every page):** H1 title (~28px), optional muted one-line subtitle,
  optional right-aligned primary action (violet-gradient), ~24px gap to body.
- **Vertical rhythm:** 24px between sections, 16px within a section.

## A4. Data display — density **balanced**
- **Tables/lists:** ~52px rows, 12–16px cell padding, hairline dividers, small-caps
  muted headers. No heavy borders/zebra unless data-dense.
- **Cards/tiles:** system radius, soft violet-tinted shadow, 20–24px padding,
  16–20px grid gap.
- **Metrics:** large value + small muted label; group related metrics in one panel.
- **Status pills:** pastel-tinted, small, rounded-full.
- **Empty states:** centered, calm — one line + one action. No big illustration.
- **Loading:** skeleton blocks in neutral tint, never a bare spinner.
- **Minimal:** show what matters; hide advanced options; prefer one clear number.

## A5. Spacing scale (snap to these)
`4 · 8 · 12 · 16 · 24 · 32 · 48`. Wire to spacing tokens; no arbitrary px.

## A6. Responsive
- <1024px: sidebar auto-collapses to the icon rail.
- <768px: sidebar becomes an overlay drawer (hamburger).
- Content padding → 20px; grids reflow to fewer columns.

## A7. Copy tone (app-wide)
- Clear and plain over clever. Short titles, one-line helper text.
- Calm, not pushy ("Start with 6 hand-picked products" → "We can suggest 6 to
  start — or pick your own.").

---

# Part B — Component Library & Page Recipe

## B0. The rule that makes it self-propagating
**No page renders raw, unstyled markup.** Every screen is composed from the shell +
the components below, all wired to tokens. New pages don't "get designed" — they
get *assembled*. Enforced by `check-tokens.mjs` (no hardcoded colors) + code review
(no bespoke layout when a library component exists).

## B1. Page recipe (build ANY new page like this)
```
<AppShell>                              // sidebar + padded content (global)
  <PageHeader title subtitle action/>   // consistent top of every page
  <page body>
    <StatCardRow/> | <Card/> | <DataTable/> | <ListCard/> | <ChartPanel/> …
  </page body>
</AppShell>
```
Need something not in the library? **Add it to the library** (token-wired), then
use it — never hand-style inline on the page.

## B2. Component inventory (each = one reusable, token-styled component)

**Layout**
- **AppShell** — sidebar + scrolling content (Part A).
- **PageHeader** — title + optional subtitle + optional right action.
- **SectionHeader** — section title + optional right link ("View all →").

**Data & metrics**
- **StatCard** — pastel card: label, large value, trend delta ("▲ 12% this week"
  green-up / red-down / "— flat" muted). Tint prop (`violet|pink|green|amber`).
- **StatCardRow** — responsive grid of StatCards (2×2 desktop, stacks mobile).
- **ChartPanel** — titled card wrapping a bar/line chart + small legend (colored
  dots + labels); muted axes, accent series.
- **DataTable** — balanced-density table with built-in empty + loading states.

**Content**
- **Card** — base rounded, soft-shadow container (20–24px padding).
- **HeroBanner** — eyebrow label, H2 title, one-line body, primary action, optional
  illustration slot; gradient/pastel background.
- **ListCard** — a Card titled by SectionHeader, containing ListRows.
- **ListRow** — thumbnail + title + meta ("Edited 2 hours ago") + right StatusPill.
- **StatusPill** — small rounded-full pastel pill: Draft (neutral), Live (green),
  Published (violet), etc.
- **EmptyState** — centered, calm: one line + one action.
- **PrimaryButton / SecondaryButton** — violet-gradient primary; quiet secondary.

**Feedback / motion**
- **Skeleton** — token-tinted loading blocks (never a bare spinner).
- Motion: cards/rows fade+rise subtly on mount; hovers use the Spring token.

## B3. Illustration & imagery
- Flat pastel + accent-violet illustration style; one style only; SVGs in `public/`.
- Thumbnails: rounded, consistent aspect ratio, soft shadow.

## B4. Dashboard (Home) target composition
Home = `AppShell` → `PageHeader("Home", "Your quizzes are converting nicely…")` →
`HeroBanner` (left) + `StatCardRow` (4 tinted StatCards, right) → below:
`ListCard("Recent quizzes", View all →)` + `ChartPanel("Quiz starts this week",
Analytics →)`. All from the library; no bespoke markup.

## B5. Nice-to-have: component gallery
Hidden `/studio/_components` route rendering every component in all states — how you
and your dev see the whole library at once and confirm token changes rippled.

## B6. Implementation notes (for the agent)
- Build real reusable components in the studio component folder; refactor existing
  pages (Home first) to consume them.
- Wire every style to **tokens**; add missing tokens to the token layer, not inline.
- Prove it: scaffold one throwaway page from the recipe and confirm it looks
  on-brand with zero custom CSS. Then reload Home, Quizzes, Products, Analytics —
  all consistent, no per-page tweaks.
