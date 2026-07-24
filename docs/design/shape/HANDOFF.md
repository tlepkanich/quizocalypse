# Step 2 — Shape: design handoff

Redesign of the standalone builder's **Step 2 (Shape)** — the "pick your quiz's
direction" step. The clickable spec is [`shape-decider-page.html`](./shape-decider-page.html)
(open in a browser for exact styling, states, and the auto-playing preview).
Hosted copy for quick/mobile review: the Artifact titled **"Shape step — decider (mock)"**.

This maps each piece to the code it lands in. **Do not port verbatim** — the mock
hardcodes hex values and stand-in SVG imagery for portability; swap for the real
tokens/images noted below. A developer does the React port.

**Design language is inherited from Step 1** — same tokens, two-row chrome,
progress-line stepper + ignite, standard component patterns. Read
[`../step1-recommendations/HANDOFF.md`](../step1-recommendations/HANDOFF.md) first;
everything there applies and is not repeated.

---

## 0. Scope & the one-design decision

- **One design serves both draft models.** `ShapeStage.tsx` today branches:
  `DeciderShapeStage` (`logic_model === "decider"`) vs the legacy four-card
  `ShapeStage` (`logic_model` absent). This redesign **replaces both** with the
  single design here. The legacy four-card page and its Direct/Weighted scoring
  picker are **removed** (owner: scoring is not merchant-facing — 2026-07).
- **Scoring becomes a server-side default, not a UI choice.** Legacy points-model
  builds previously *required* a Direct/Weighted pick with no default. Since the
  UI no longer asks, the legacy build path must **default the scoring model**
  (use `"direct"`) instead of blocking. Decider docs are already direct-only, so
  they're unaffected. This is the only behavioral change beyond presentation.
- Files touched: `app/components/onboarding/stages/ShapeStage.tsx` (the whole
  stage), `stagesShared.tsx` (unchanged types; `FunnelData` already carries
  everything the design needs), `app/components/chrome/TopBar.tsx` +
  `StepNav.tsx` (shared chrome, see §1), `app/styles/quizocalypse.css` (new
  classes), and the funnel action (the `shape-continue` / `manual-build` /
  `shape-goal-build` / `use-saved-template` / `shape-regenerate` /
  `back-to-grouping` intents — all still used).

---

## 1. Chrome — inherit Step 1, with two Shape-specific changes

Shared with Step 1; port those first. On the Shape surface specifically:

- **Remove the `✦ Brand identity` action from the top bar.** Only `← Homepage`
  remains on the right. (Owner: not relevant here. If the shared `TopBar`
  renders Brand-identity globally, gate it off for this stage rather than
  removing it for Step 1.)
- **Rename `← All quizzes` → `← Homepage`.**
- **Leaving is confirmed.** Clicking `← Homepage` opens a **"Leave setup?"**
  modal ("Your quiz is saved as a draft…") with **Stay here** / **Go to
  homepage**. Only navigate on confirm. (Autosave already persists the draft —
  `useQuizDraft.ts` — so copy leans on "saved as a draft".)
- Stepper: current step = `02 Shape`; `01 Recommendations` = done. Label
  `Results page → Results` (Step-1 change) so all five fit. Ignite the current
  dot ~3s on arrival, `prefers-reduced-motion` safe.

---

## 2. Page header — title only

**`ShapeStage.tsx`** header block.

- **Title only:** `Choose the optimal quiz type`. No eyebrow, **no subhead/
  description**, no `Brand ✦` badge. (The old header card, provenance subhead,
  and the `✨ Generated from your catalog` banner are all removed — the two
  branded previews make the task self-evident.)

---

## 3. The two type cards (`quiz_types.slice(0,2)`)

Two side-by-side cards (`.dgrid`, 2-col). The AI's top pick (`quiz_types[0]`)
carries the violet **`✦ Recommended`** ribbon. **No separate AI-tip component on
this page** — the recommendation + reasoning live on the card. Each card:

1. **Brand-themed preview** (the hero — see §4).
2. **Name** (`QuizType.name`) + **type badge** (`XTYPE_LABEL[experience_type]`,
   mono uppercase, e.g. `PRODUCT MATCH`).
3. **`GOAL`** line — a short shopper-outcome phrase. Source: `QuizType.achieves`,
   **authored as a terse phrase** (not a sentence). Label is a quiet mono
   uppercase tag — **not bold, not accented**.
4. **`WHY`** line — a short brand-fit phrase. Source: `QuizType.rationale`
   ("why it fits THIS brand"), also terse. Same quiet label styling as GOAL.
   *(`best_practice_note` / `web_research_excerpt` are available if a third line
   is ever wanted; not shown here.)*
5. **Meta:** `{min}–{max} questions` (mono). **No time-to-complete estimate**
   (owner: the read isn't reliable).
6. **Commit-on-card** (no floating button). The card's own button is the action:
   unselected = quiet outline **`Use this`**; the picked card gets accent
   border + tint and its button becomes the primary **`Continue → build your
   questions`** (fires `shape-continue` `{ typeId, scoring: "direct" }`,
   button → `Building…`). Radio semantics — picking one deselects the other. No
   separate action row and no grey hint text (both removed — they read as
   unanchored). There is **no pop-out/enlarge preview** either (removed 2026-07).
   *(Alternatives considered: a bottom footer action bar, or an appears-on-select
   centered button. Commit-on-card was chosen for anchoring the action to the
   choice.)*

Cards only (no rows variant). Copy the terse GOAL/WHY as `achieves`/`rationale`
generation targets — keep them phrase-length at gen time so no runtime truncation
is needed and there's **no added page-load cost** (both fields already exist).

---

## 4. The preview — an auto-playing "template film" (the centerpiece)

A fixed, centered **phone screen** per card that auto-plays the quiz in the
**merchant's brand**, on the merchant's **real recommendations + products**.
Model it on the existing `.qz-rb-phone-screen` (frameless: radius 26,
`box-shadow: 0 18px 44px -18px rgba(60,50,90,.5), 0 0 0 1px rgba(0,0,0,.06)`,
`padding 16`, `background: var(--qz-color-bg)`, `font-family: var(--qz-font-body)`).

**Two screens, cross-fading (~3.2s), looping:**

- **Question** — progress bar + question + **image answer tiles** (2×2 grid).
  Each tile = a square image + a 1-line label (ellipsis). Selected tile gets a
  brand ring + `✓`. Images = the recommendation/collection thumbnails
  (`FunnelData.buckets[].thumbnailUrl`, or a collection/product image);
  `object-fit: cover`; `#00000010` block fallback when absent. This is the
  visual upgrade over flat text options — it must look merchandised.
- **Recommendations page** — a **list of product rows** built exactly like the
  real `ProductCard`: 50×50 `object-fit:cover` thumbnail (`product.image_url`,
  `#00000010` fallback), name **`-webkit-line-clamp: 2`** (never overflow), muted
  price, the top match ringed + a `Top` pill, and an `Add all to cart` button.
  **The header is calculated by `experience_type`:**
  - **Product-match** → headline `Your matches` + subline "Picked from your
    catalog…", then ~3 product rows.
  - **Personality** → lead with a **PERSONA block** above the picks: a mono
    eyebrow (`Your rider type`), the persona name (`You're the Powder Purist`),
    a one-line read, and a small avatar (a persona/scene image; `#00000010`
    fallback) — then a `Your gear picks` header + ~2 product rows. Personality
    quizzes resolve to a persona *first*; product-match never shows one. Source
    the persona from the personality result copy (`persona_name` + result blurb);
    for the preview, use the type's representative/first persona. This is the
    "calculated differently" case — gate it on `experience_type === "personality"`.

**Reduced motion:** no auto-advance; rest on the Recommendations screen (the
payoff). No logo/wordmark inside the frame — brand reads through color + type
only.

### Preview guardrails (why it can't look "stretched / run off")
1. Chrome caps at **1080** (`.wrap`); the working column caps at **900**
   (`.col`, centered) so cards never sprawl on wide/ultrawide screens.
2. The phone has a **fixed aspect (3/4) + max-height (392px)** and a capped width
   (`min(272px, 100%)`, centered) — it holds its shape at any viewport.
3. Product/answer **names clamp** (2-line for products, 1-line ellipsis for answer
   tiles). Prices sit on their own line. Fixed image aspect ratios (square) per
   ecommerce best practice — no jagged rows.
4. When cards stack (≤720px) each card caps at **420px** and centers.

---

## 5. Secondary actions — one quiet zone

A collapsed **"Other ways to start"** disclosure holds the escapes (was scattered
across cards + links):

- **Write your own goal** → inline textarea → `shape-goal-build` (`{ goal }`).
- **Build manually** → `manual-build`.
- **Reuse a saved template** → the saved-template pills (`use-saved-template`,
  `{ templateId }`).

Below, a quiet under-row: **↻ Regenerate suggestions** (`shape-regenerate`) ·
**← Back to recommendations** (`back-to-grouping`). All intents already exist in
the funnel action — this is a re-grouping, not new behavior.

---

## 6. Design settings the preview depends on (must be noted)

The preview themes entirely from the draft's design tokens
(`resolveDesignTokens(data.designTokens)` → `tokensToCssVars`), scoped to each
phone frame. The frame reads:

| Token | Used for |
|---|---|
| `--qz-color-primary` | progress bar, selected-tile ring/✓, hero-row ring, `Top` pill, `Next` + `Add all to cart` buttons |
| `--qz-color-bg` | the phone screen surface |
| `--qz-color-text` | question + product names |
| `--qz-color-muted` | price, subcopy |
| `--qz-font-heading` | question + `Your matches` headline |
| `--qz-font-body` | everything else in the frame |
| `--qz-radius` | frame + card radii (optional to honor) |

The Design step (§05) can later change these; the Shape preview should read the
**current** tokens so it always previews in-brand. This is why the preview must
mount the resolved tokens per-card (as `DeciderShapeStage` already does via
`tokensToCssVars`).

---

## 7. Brand read → fallback threshold (define + owner-confirm)

**Confirmed:** the preview pulls the merchant's brand (colors + fonts) into the
theming. **When the brand read is weak, fall back to Quizocalypse defaults** —
field by field (a shop can have strong colors but weak fonts).

Source of the read = `brandDerivedTokens` (the shop's brand-derived pack from the
site/download). `null` → weak → default. Even when present, apply per-field
checks. **Proposed thresholds (tune with owner):**

- **Primary color is "strong"** when the extracted primary is a real brand hue,
  not a neutral: HSL **saturation ≥ ~25%** AND **12% ≤ lightness ≤ 92%** (i.e.
  not near-white, near-black, or gray). Otherwise use the default accent
  (`--qz-color-primary` default `#5563DE` / builder accent `#6D5AE6`).
- **Fonts are "strong"** when a **specific, resolvable family** was identified
  (a named brand/web font that we can load) — not a generic system stack or an
  unresolved fallback. Otherwise use the default (`Inter`).
- **Field-by-field:** apply the color check and the font check independently;
  don't all-or-nothing.
- Everything else (radius, pad, bg/text) uses `DEFAULT_TOKENS` when unset — the
  existing token resolution already handles that.

Surface nothing to the merchant about which path was taken; the Design step is
where they can override. **Owner to confirm the saturation/lightness cutoffs and
the "resolvable font" definition before build.**

---

## 8. Guardrails (from repo CLAUDE.md)

- Decider-gate any new behavior; keep legacy points/ladder docs byte-identical
  **except** the deliberate scoring-default (§0) — verify the byte-pin
  (`cmqqcb0ao…` first 16 chars `c02ccaec98a0fe9e`) is unchanged after deploy.
- New schema fields `.optional()`, never `.default()`. (No new fields are needed
  — GOAL/WHY reuse `achieves`/`rationale`.)
- Don't touch the byte-pinned runtime (`/q`); this is admin chrome only.
- Full gate chain before commit:
  `npm run typecheck && npm test -- --run && npm run build && npm run lint && node scripts/check-tokens.mjs`.
- 2-lens adversarial self-review — this stage touches persistence (the
  scoring-default) and the shared chrome (TopBar/StepNav).
- Interactive states (the auto-play film, the leave-confirm modal, selection)
  need screenshots, not just a 200 + DOM markers.
