# Step 1 — Recommendations: design handoff

Redesign of the standalone builder's **Step 1 (Recommendation Buckets)** and the
shared funnel chrome. The HTML files in this folder are a clickable spec —
open them in a browser to see exact styling, states, and interactions. This
doc maps each piece to the code it lands in.

**Primary reference:** [`step1-final-page.html`](./step1-final-page.html) — the full assembled page.
**Detail reference:** [`ai-tip-collapse.html`](./ai-tip-collapse.html) — the AI-tip collapse behavior in isolation.
**Exploration (context only):** `step1-redesign-options.html` (header/stepper/AI-tip directions A/B/C — we chose **B**), `step1-picker-options.html` (picker models 1/2/3 — we chose **1, Expand-in-place**, later upgraded to a modal).

All colors use existing qz tokens (`--qz-accent` `#6D5AE6`, `--qz-accent-ink`,
`--qz-accent-wash`, `--qz-accent-tint`, `--qz-ink*`, `--qz-rule`, `--qz-cream-2`,
`--qz-radius*`, `--qz-font-mono`). The mock hardcodes the hex values for
portability — swap them for the tokens when porting.

---

## 1. Header + step flow — moved below the wordmark

**Files:** `app/components/chrome/TopBar.tsx`, `app/components/chrome/StepNav.tsx`,
`app/components/onboarding/Step1Funnel.tsx` (`FunnelStepNav`), `app/styles/quizocalypse.css`.

- The top bar becomes **two rows**: row 1 = wordmark (left) + `✦ Brand identity` / `← All quizzes` (right); row 2 = the step nav spanning full width **below** the logo. Today the nav sits in the center zone of a single row — move it to its own row beneath.
- Step nav style = **progress line**: numbered dots (`01`–`05`) + labels, connectors between them. `done` = accent-wash fill; `current` = solid accent dot; `upcoming` = muted. This replaces the segmented-pill look.
- Label change: **"Results page" → "Results"** so all five fit.
- `StepNav` is shared with the Step-3 bar (`TopBar3`) — verify both surfaces.

### Current-step "ignite" animation (global step behavior)
On arrival at any step, the current dot plays for **~3 seconds then fades to a
calm dot**: a breathing halo (the loading-spinner motif), a rotating sparkle
sweep on the ring, and ~5 twinkling sparkles. Implement as an `igniting` class
added on mount / step change and removed after 3000ms; CSS animations only run
while the class is present, then transition out. Honor `prefers-reduced-motion`
(no animation; static current dot). See `.node.cur.igniting` rules + the
`ignite()` JS in `step1-final-page.html`.

---

## 2. Page header — simplified

**File:** `RecommendationBucketsStage.tsx` (`qz-rb-head`).

- **Remove** the `Step 1 of 5 · Recommendations` eyebrow — the stepper already shows position.
- Keep only the **title** (`What can your quiz recommend?`). The old instructional subhead is dropped from the always-visible header (the picker tabs + AI tip make the task self-evident).

---

## 3. AI tip — compact, collapsible, standard "AI" component

**File:** `RecommendationBucketsStage.tsx` (`RbBanner` → new compact component), `quizocalypse.css` (`qz-rb-banner*`).

Replaces the current banner. Reusable pattern for any AI tip in the app.

- **Expanded:** soft-violet card — icon tile (pulsing `✦`), mono `AI TIP` label, bold headline, one-line reason, a greyed **"Based on"** followed by catalog chips (`125 products` · `4 collections` · `32 tags`), and actions `Use this` + `Hide`.
- **Collapsed (after Hide):** shrinks to a small rounded **`✦ AI TIP` pill** (icon + label only) to keep the page quiet.
- **Toggle rule:** clicking the module while collapsed expands it; while expanded, only **Hide** collapses it (so `Use this` never collapses). Icon keeps pulsing in both states.
- **Animation:** only the `✦` icon pulses (gentle scale + rotate). No moving shimmer/sweep, no badge ("Worth a look" removed), no "Not now."
- **First visit:** render expanded once; collapsed thereafter.
- Keep the existing **Applied / Undo** flow: `Use this` applies the recommended set and swaps to the green Applied bar; the existing session-dismiss logic still applies.

---

## 4. Picker rows — fully clickable, image/placeholder icon, count → modal

**File:** `RecommendationBucketsStage.tsx` (the `qz-rb-grid` / row markup), `quizocalypse.css`.

- **No checkbox.** The **whole row** toggles select/deselect. Selected = accent border + tint + a small `✓` badge.
- **Row layout:** `[icon] Title …… [right]`.
  - **Icon:** the product/collection image; when there's **no image, default to an animated placeholder** (subtle violet shimmer with a faint glyph). See `.thumb.ph`.
  - **Right side — Collections/Tags:** a `N products →` **button** that opens a **centered modal** listing the products in that bucket to scroll through (replaces the old inline expand / "Preview"). The row still selects on click; the count button uses `stopPropagation` so it only opens the modal.
  - **Right side — Products (leaf):** just the **price**, no count button/modal (a product isn't a bucket).
- Modal = header (bucket icon + name + count) · scrollable product list · `Done`. See `.scrim`/`.modal` + `openModal()`.

---

## 5. Recommendations rail

**File:** `RecommendationBucketsStage.tsx` (`qz-rb-rail`).

- Slightly wider column (main:rail ≈ **1.9 : 1**), soft violet border + light shadow.
- Rows show the type glyph + name + meta (price for products, `N products` for tags/collections). Keep the **single-recommendation warning** and the `Preview results page` / `Continue →` footer with the same disabled/empty states.

---

## Guardrails (from repo CLAUDE.md)

- Decider-gate new behavior; keep legacy points/ladder docs byte-identical. New schema fields `.optional()`, never `.default()`.
- Don't touch the byte-pinned runtime (`/q`); this is admin chrome only.
- Run the full gate chain before commit: `npm run typecheck && npm test -- --run && npm run build && npm run lint && node scripts/check-tokens.mjs`.
- 2-lens adversarial self-review for anything touching runtime/persistence/auth.
