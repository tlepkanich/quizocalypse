# App Shell, Layout & Data Display

> **Addendum to the Soft Pastel design system.** These are *global, structural*
> rules for the studio (admin) surface. They live at the app-shell / layout level
> and must cascade to **every** page automatically — no page should re-implement
> its own shell, padding, or data-table styling. If a page looks wrong here,
> fix the shell, not the page.

## 0. Guiding principle

The studio should feel **calm, spacious, and consistent**. Density is *balanced* —
comfortable breathing room without wasting space. Every screen shares one shell:
a persistent left sidebar, a padded content area, and a consistent page header.
Nothing hugs the sidebar; nothing stretches edge-to-edge without padding.

## 1. App shell layout

- Two-zone shell: **sidebar** (left, fixed) + **content area** (right, scrolls).
- Implement once in the root studio layout so all routes inherit it.
- Full viewport height; only the content area scrolls, the sidebar stays put.
- Background: app canvas uses the system's softest neutral (`surface/base`);
  content sits on it with cards/panels in `surface/raised`.

## 2. Sidebar

**Default state: expanded, with a collapse toggle.**

- **Expanded width:** ~248px. Shows icon + label for each nav item.
- **Collapsed width:** ~64px. Icons only; labels hidden; show label on hover as a
  tooltip. A toggle control (chevron or hamburger, top of sidebar) switches states.
- **Persist the choice** (localStorage) so it survives reloads.
- **Active item:** filled pill in the accent tint (violet-50 bg, violet-600
  text/icon), matching the current Home highlight — keep this, apply consistently.
- **Hover (inactive):** subtle neutral tint, no harsh borders.
- **Grouping:** primary nav (Home, Quizzes, Analytics, Products…) grouped; a thin
  divider separates the brand/logo block at top. Logo block collapses to the
  "Q" mark when the rail is collapsed.
- **Spacing:** 4px between items, 12px section padding, icons 20px, comfortable
  44px min touch target per row.
- **Motion:** width transition on collapse/expand uses the system's Spring/ease
  token, ~200ms. Labels fade, don't pop.

## 3. Content area

- **Padding:** consistent `32px` (desktop) / `20px` (narrow) on all sides. This is
  the fix for "everything's too close to the sidebar" — content never touches the
  rail.
- **Width:** flexible — content fills the available space (good for tables and
  dashboards). No hard max-width cap, but see the page-header note below.
- **Page header pattern (every page):**
  - Page title (H1, Quicksand/Mona Sans, ~28px) at top-left.
  - Optional one-line subtitle in muted ink beneath it.
  - Optional primary action (violet-gradient button) top-right, aligned to the title baseline.
  - ~24px gap between header and page body.
- **Vertical rhythm:** 24px between major sections, 16px within a section.

## 4. Data display (lists, tables, dashboards)

Density: **balanced.**

- **Tables/lists:** row height ~52px, 12–16px cell padding, 1px hairline row
  dividers in the softest neutral (no heavy borders/zebra unless data-dense).
  Column headers in small-caps muted ink.
- **Cards/tiles** (e.g. Recent quizzes, product cards): rounded (system radius),
  soft violet-tinted shadow, 20–24px internal padding, 16–20px gap in the grid.
- **Numbers/metrics:** large value + small muted label; group related metrics in a
  single panel rather than scattering cards.
- **Status pills** (Draft, Published, etc.): pastel-tinted, small, rounded-full.
- **Empty states:** centered, calm — one line of copy + one action. Not a big
  illustration. (Current "Nothing added yet…" style is right; standardize it.)
- **Loading:** skeleton rows/blocks in the neutral tint, never a bare spinner on a
  blank page.
- **Keep it minimal:** show what matters, hide advanced options behind a "…" or a
  secondary panel. Prefer one clear number over five competing ones.

## 5. Spacing scale (use these, don't freehand)

`4 · 8 · 12 · 16 · 24 · 32 · 48`. All gaps/padding snap to this scale. Wire to the
existing spacing tokens; do not introduce arbitrary px values.

## 6. Responsive

- Below ~1024px, the sidebar auto-collapses to the icon rail.
- Below ~768px, the sidebar becomes an overlay drawer (hamburger opens it).
- Content padding drops to 20px; grids reflow to fewer columns.

## 7. Copy tone (applies app-wide)

- Clear and plain over clever. Short titles, one-line helper text.
- Calm, not pushy — informational cards state the fact and offer an action; they
  don't hard-sell ("Start with 6 hand-picked products" → "We can suggest 6 to start —
  or pick your own.").

## 8. Implementation notes (for the agent)

- Build all of this in the **shared studio layout + shell components** so every
  route inherits it. Do **not** patch individual pages.
- Wire everything to **existing design tokens** (color, spacing, radius, shadow,
  motion). If a needed token is missing, add it to the token layer, not inline.
- Sidebar collapse state, page-header component, table/list styles, and empty-state
  component should each be **one reusable component** used everywhere.
- After implementing: reload Home, Quizzes, Products, Analytics — all four should
  look consistent with no per-page tweaks.
