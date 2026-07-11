# Component Library & Page Recipe

> **Addendum to the Soft Pastel design system.** This defines the reusable
> building blocks every studio page is assembled from, and the recipe for
> composing a new page. The goal: **a new or edited page inherits the design
> automatically because it's built from these components — never from raw markup.**
> This is the single source of truth for UI. Change a component here → it updates
> everywhere it's used.

## 0. The rule that makes it self-propagating

**No page renders raw, unstyled markup.** Every screen is composed from the shell
+ the components below, all wired to design tokens. New pages don't "get designed" —
they get *assembled*. This is enforced by `check-tokens.mjs` (no hardcoded colors)
and by code review (no bespoke layout when a library component exists).

## 1. Page recipe (how to build ANY new page)

```
<AppShell>                         // sidebar + padded content area (global)
  <PageHeader title subtitle action/>   // consistent top of every page
  <page body>
    // assemble from library components only:
    <StatCardRow/> or <Card/> or <DataTable/> or <ListCard/> or <ChartPanel/> …
  </page body>
</AppShell>
```

If a page needs something not in the library, **add it to the library** (with a
token-wired style), then use it — don't hand-style it inline on the page.

## 2. Component inventory

Each is one reusable component, token-styled, used everywhere.

### Layout
- **AppShell** — sidebar + scrolling content. (See App Shell & Layout section.)
- **PageHeader** — title (H1) + optional subtitle + optional right-aligned primary
  action. ~24px gap to body. Every page uses this.
- **SectionHeader** — a section title with an optional right-aligned link
  ("View all →", "Analytics →"). Used above lists/panels.

### Data & metrics
- **StatCard** — pastel-tinted card: small label, large value, trend delta line
  ("▲ 12% this week" green-up / red-down / "— flat" muted). Prop for tint
  (`violet | pink | green | amber`) so a row of them alternates cleanly.
- **StatCardRow** — responsive grid of StatCards (2×2 on desktop, stacks on mobile).
- **ChartPanel** — titled card wrapping a chart (bar/line) with a small legend
  (colored dots + labels). Muted axis labels, accent-colored series.
- **DataTable** — balanced-density table: ~52px rows, hairline dividers,
  small-caps muted headers, built-in empty + loading states.

### Content
- **Card** — the base rounded, soft-shadow container (20–24px padding). Everything
  panel-like builds on this.
- **HeroBanner** — the "get set up / launch your next quiz" banner: eyebrow label,
  H2 title, one-line body, primary action, optional illustration slot on the right.
  Gradient/pastel background.
- **ListCard** — a Card titled by a SectionHeader containing **ListRow**s.
- **ListRow** — thumbnail + title + meta line ("Edited 2 hours ago") + right-aligned
  **StatusPill**. Used for recent quizzes, product lists, etc.
- **StatusPill** — small rounded-full pastel pill: `Draft` (neutral), `Live`
  (green), `Published` (violet), etc.
- **EmptyState** — centered, calm: one line + one action. Standard across the app.
- **PrimaryButton / SecondaryButton** — violet-gradient primary; quiet secondary.

### Feedback / motion
- **Skeleton** — token-tinted loading blocks for cards/rows (never a bare spinner).
- Motion: cards/rows fade+rise subtly on mount; hovers use the system Spring token.

## 3. Illustration & imagery

- Illustrations (like the hero mountains) use the pastel palette + accent violet,
  flat style. Keep one illustration style; store as reusable SVGs in `public/`.
- Product/quiz thumbnails: rounded, consistent aspect ratio, soft shadow.

## 4. Building the dashboard (Home) to match the target

Home = `AppShell` → `PageHeader("Home", "Your quizzes are converting nicely…")` →
`HeroBanner` (left) + `StatCardRow` (right, 4 tinted StatCards) → below:
`ListCard("Recent quizzes", View all →)` + `ChartPanel("Quiz starts this week",
Analytics →)`. All from the library; no bespoke markup.

## 5. Nice-to-have: a component gallery

Add a hidden `/studio/_components` route that renders every component in all its
states. This is how you (and your developer) *see* the whole library at once, and
how you confirm a token change rippled correctly. Optional but high-value.

## 6. Implementation notes (for the agent)

- Build these as **real, reusable components** in the studio component folder;
  refactor existing pages (Home first) to consume them.
- Wire every style to **tokens**; add missing tokens to the token layer, not inline.
- After building: creating a new page should require only composing existing
  components — demonstrate by scaffolding one throwaway page from the recipe and
  confirming it looks on-brand with zero custom CSS.
