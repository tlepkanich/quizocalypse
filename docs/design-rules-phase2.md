# Phase 2 — Consolidated Design Edits

> **Living doc.** Collects design decisions and edits made *after* the Phase 1
> base rollout. Do NOT implement mid-Phase-1. When Phase 1 is shipped + committed,
> merge these into the master `design-rules.md` and implement them in one pass.
> Each entry is a locked decision unless marked "open".

---

## Edit 1 — Funnel step tracker → Segmented bar

**Replaces** the current pill-and-connector tracker at the top of the 5-step
creation funnel (Recommendations → Shape → Questions → Results page → Design).

**Style: "segmented bar."** Five connected, equal-width rounded segments in a row,
reading as one control.

- **Completed step:** light-violet fill (`--bg-accent` / violet-50 tone), a small
  green check + the step label in dark violet.
- **Active step:** solid violet fill (accent), white label (optionally a faint step
  number before it).
- **Upcoming step:** neutral surface fill (`--surface-1`), muted label + muted number.
- **Shape:** ~8px radius per segment, ~6px gap between segments, comfortable
  vertical padding (~10–12px), labels centered.
- **Behavior:** keep the existing done/active/upcoming logic exactly — this is a
  restyle only, no navigation-logic change.
- **Build as:** one reusable, token-wired `FunnelStepper` component (part of the
  component library), consumed by all 5 funnel steps. No per-page markup.
- **Responsive:** on narrow widths, labels may truncate or drop to numbers-only;
  the active segment always keeps its label.

_Status: locked._

---

## Edit 2 — Studio login page repaint

The `/studio/login` page still renders un-branded (blue button, no violet, no
Quicksand, dark). It doesn't load the admin style sheet (`adminLinks`). Repaint it
to the Soft Pastel brand so the very first screen users see carries the identity.
_Status: locked (do in Phase 2)._

---

## Edit 3 — Net-new components: modal, drawer, toast, menu (§14.6)

Build these as reusable, token-wired components in the library (they don't exist
yet): modal/dialog, side drawer, toast/notification, dropdown menu. Match the Soft
Pastel system (rounded, soft shadow, violet accent, Spring motion).
_Status: locked (do in Phase 2)._

---

## Open decisions — need Chase's input before locking

These §14 items are genuine product/brand calls, not implementation:

- **Dark mode** — do we ship a dark theme, and is it in scope?
- **Final logo lockup** — the "Q" mark + wordmark treatment.
- **Illustration set** — commission/define the flat pastel illustration family.
- **Microcopy / voice** — app-wide tone pass on labels and helper text.
- **Brand-kit lock** — finalize the Brand Identity/Brand Kit page contents.
- **Logic-views design** — styling for the funnel's Logic (λ) view.

_Status: open — add decisions here as Chase makes them._

---

## Edit 4 — Enforce consistent content padding globally

Screens currently sit at different distances from the left sidebar (Home, Quizzes,
funnel, etc. all differ). This must be ONE global setting: every studio page's
content area uses the same left/right/top padding (~32px desktop) from the shell,
never per-page. Audit all routes and route their padding through the shared shell
container so nothing is bespoke. _Status: locked._

---

## Edit 5 — Active sidebar item bolds its label

When a nav item is selected, its label goes bold (weight 500) in addition to the
violet pill background — so the active item reads clearly, not just by color.
_Status: locked._

---

## Edit 6 — Home page → dashboard (reference: target mockup)

Replace the current sparse Home ("Hello 👋" + single Create-with-AI card) with the
full dashboard from the reference: "Welcome back, [name]" header, a stat-card row
(Quiz starts, Completion rate, Emails captured, Click-through — pastel tints, one
saturated), the illustrated hero/"launch your next quiz" banner, Recent quizzes
list (thumbnail + status pill + "View all →"), and a "Quiz starts this week" chart
panel. Section headers use the standardized `SectionHeader` component (top-line
setting, not per-page styling) — stop hand-styling section titles. _Status: locked._

---

## Edit 7 — Template preview graphics on-theme

The Shape-step template cards and the "See it live" preview must match the brand:
friendly, colorful illustrations in the pastel/violet family (reference dashboard
illustration style), and noticeably **larger**. Bug: the "See it live" phone still
shows the OLD runtime styling — it must render the new slim, repainted runtime.
Overall goal: these previews should look beautiful, not utilitarian. _Status: locked._

---

## Edit 8 — Inter-step loading animation

Between funnel steps, replace the static checklist with: a centered, gently
animated graphic, then sequential status messages ("Building X", "Doing Y") that
fade in and out one at a time as each completes. Calm, polished, branded motion.
_Status: locked._

---

## Edit 9 — Questions step: center preview + resizable builder panel

On the Questions step (and builder surfaces): (a) the phone preview is off-center —
center it in its column. (b) The left builder panel (Content/Logic list) should be
**resizable** — draggable width with a sensible minimum, collapsible to a narrow
rail. _Status: locked._

---

## Edit 10 — Card spacing: never overlap

Cards/widgets must never touch or overlap (e.g. the saturated "Attributed revenue"
stat card currently bleeds into the white table beneath it on /studio/analytics).
Enforce a consistent minimum gap between all cards/panels globally; a colored card
and a white card must have clear separation. _Status: locked._

---

## Edit 11 — Global card elevation + hover motion

Two global rules for all cards/widgets:
- Give them a touch more "pop" — slightly stronger (still soft) elevation so they
  lift off the canvas.
- On mouse hover, the card gently lifts/moves (subtle translate + shadow increase)
  using the system motion token. This is a global interaction rule, applied
  everywhere, not per-card. _Status: locked._

---

## Edit 12 — Home page quick-action widgets

Add entry-point widgets/tiles to Home for visual richness and clearer starts,
as distinct cards:
- **Create quiz (AI-assisted)** — the AI build flow.
- **Create quiz manually** — separate, non-AI start.
- **A/B testing** — jump into experiments.
- **Strategy ideas** — a separate inspiration/ideas widget.
Style them as on-brand dashboard cards (with the Edit 11 hover behavior).
_Status: locked._

---

## Edit 13 — Builder left panel collapsible (all builder surfaces)

Generalizes Edit 9: every builder left panel (Add / Layers / Background, and
Content / Logic) must be collapsible to a narrow rail and resizable with a sensible
minimum width. Applies across all builder surfaces, not just the Questions step.
_Status: locked._

---

## Edit 14 — MOVED to Phase 3

Analytics per-quiz modules (Version B) now lives in `design-rules-phase3.md`.
Phase 2 is frozen as-built; new design edits go to Phase 3.

---

## Edits pending (add below as compiled)

<!-- New decisions get appended here as their own "## Edit N — …" sections. -->
