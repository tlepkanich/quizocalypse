# Phone preview — shared primitive spec

Every builder step shows the merchant a phone. Today there are **four separate
implementations** that agree on nothing. This makes one primitive, so every
screen (Step 1 recs, Step 3 questions, Step 4 results, Shape, Design) inherits
identical behavior.

> ### Precedence — newest wins (now and forever)
> `SPEC.md` + `DESKTOP-SPEC.md` in this folder are the **canonical global settings**
> for the phone / desktop preview. If another screen, doc, or chat defines
> **conflicting** global settings for the preview, the **most-recently-dated
> definition takes precedence — always.** Precedence is by change date: the commit
> date of these files, or the explicit **Last updated** line below. Newest date wins.
> This rule is permanent.
>
> **Last updated: 2026-07-14** — fit-the-pane sizing, Mobile/Desktop toggle, Expand
> overlay, and the full desktop layout + guardrails (see `DESKTOP-SPEC.md`).

---

## 1. What exists today (the problem)

| Where | File / class | Width | Bezel | Overflow |
|---|---|---|---|---|
| Step 1 rec preview | `.qz-rb-phone-screen` | 300px | frameless, r26 | **`hidden` — clips** |
| Step 3 questions | `.qz-s3-phone` | 322px | dark ink, r44 | **`hidden` — clips** |
| Step 4 results | `.qz-s4-phone` | 360px | hairline + notch | `auto` |
| Builder preview | `DeviceFrame.tsx` | drag-resizable | faux browser bar | separate |

### Issues, by category

**Sizing**
- Four widths: 300 / 322 / 360 / resizable. No shared token.
- Heights are viewport math — `min(500px, 100vh - 260px)`, `min(700px, 100vh - 240px)`, `min(66vh, 640px)`. On a short laptop the phone silently shrinks.
- **The preview is narrower than a real phone.** A real iPhone viewport is ~390 CSS px; we preview at 300–360. So layout that wraps in the preview may not wrap in reality, and vice versa. **The preview lies.**

**Scrolling**
- Two of four **clip** (`overflow: hidden`). Content past the fold is invisible, not scrollable, with no indication it exists.
- No scroll affordance anywhere (no fade, no shadow, no "more below").
- Long content must never lengthen the phone — the frame is fixed, the screen scrolls.

**Images**
- No shared rule. `object-fit: cover` appears once (Step 1 hero only).
- No aspect-ratio standard → product images of different ratios jitter the grid.
- No missing-image state. Step 1 falls back to an emoji (📦); the runtime just renders a fixed 132px box.
- No broken-image (onError) handling. No skeleton while loading.

**Fonts**
- Brand fonts load async from Google Fonts (`googleFontsUrl`, `display=swap`) → **FOUT inside the preview**: text reflows a beat after render, which reads as a bug.
- Body `base_size: 16` is a token, but each frame scales content differently, so 16px doesn't mean the same thing in two previews.
- Heading (often serif) vs body (often sans) — no minimum legible size, no fallback metric matching, so swap causes layout shift.

**Icons**
- Emoji are used as icons throughout (📦 🏷️ 🗂️ ✦ ▷ ↻ ✕). They render differently per OS, can't be themed or recolored, and are announced badly by screen readers.

**Text overflow**
- **No clamps anywhere.** A long product title wraps to four lines and pushes the layout. A long headline overflows.

**CSS isolation / fidelity**
- `/q` deliberately loads **only** `quiz-runtime.css` (BIC-2 B1). But the preview renders inside the **admin** page, where the full admin sheet is present — so admin styles can bleed in and the preview can show something the shopper will never see.

---

## 2. The primitive

One component: `<PhonePreview>`. One CSS block. Everything below is non-optional.

### Frame
- **Fixed frame.** One width, one height. No viewport math. The frame never grows with content.
- **Logical viewport is a real device: 390 × 844** (iPhone-class). Layout is computed at true device width so it matches what shoppers get.
- **Visual size is achieved by `transform: scale()`**, not by shrinking the layout. This is the key fix: *scale the pixels, never the layout.*
- Minimal bezel: no notch, no hardware chrome. Rounded corners + soft shadow only.
- `overflow: hidden` on the **frame** (to clip the rounded corners), `overflow-y: auto` on the **screen**.

### Sizing & controls — canonical (decided)

Model this on the **Shopify theme editor**: a preview that fits its pane, plus an
Expand control to inspect it large. The scale changes; the layout never does.

- **Fit the pane (default).** Compute `--s` to fill the available preview area —
  `--s = min(paneW / vw, paneH / vh, 1)` — measured off the preview stage, not the
  whole column. **Never upscale past `1` (true 1:1)** inline. There is no fixed
  scale token; the phone is as large as the pane allows and re-fits on resize / when
  the split divider moves. (Replaces the old "e.g. 0.82" fixed guidance.)
- **Device toggle.** A `Mobile / Desktop` segmented control in the preview's top
  bar. Mobile = `390 × 844`. Desktop = a wide frame (`~1180 × 740`) with the runtime
  content in a centered max-width column. Same content, same tokens — only the
  viewport differs. (Desktop needs a real desktop runtime layout to be meaningful;
  until then it centers the mobile content.)
- **Expand.** A control that opens the *same* screen in a dimmed overlay, scaled to
  fill the viewport height (`min(1.4, 0.9·vh / frameVh)`), **floored at `1` for
  mobile** so Expand is always visibly bigger than the inline preview. Esc /
  click-outside / × closes it. Only the scale differs from inline — it still can't
  lie about wrapping.
- The old per-surface height math (`min(500px, 100vh − 260px)`, etc.) and fixed
  widths (300 / 322 / 360) are **removed**; every screen uses fit-the-pane.

### Scrolling
- The screen always scrolls. Never the page, never the frame.
- Scroll affordance: a subtle bottom fade that disappears at the end of the scroll.
- Scroll position resets when the previewed step changes, not on every keystroke.

### Images
- One slot with a **fixed aspect ratio** (recommend **1:1** for product grids, **4:5** for hero).
- `object-fit: cover`, centered.
- **Missing image** → branded placeholder (neutral tint + subtle mark), never an emoji, never a broken-image glyph.
- **Loading** → shimmer skeleton at the exact final size, so nothing shifts.
- `onError` → fall back to the placeholder.
- `loading="lazy"` below the fold.

### Fonts
- Preload the brand fonts and render the preview only once they're ready (or use `size-adjust` fallback metrics) — **no FOUT, no layout shift.**
- Type scale comes from the merchant's `typography.base_size` (default 16) and is applied at true device scale.
- Enforce a **minimum body size of 14px** at device scale; smaller is unreadable and merchants will do it.

### Text
- Clamp everything:
  - Product title: **2 lines**, ellipsis
  - Product description: **2 lines** (grid) / 3 (list), ellipsis
  - Headline: **3 lines**
  - Price, badges: never wrap
- Long unbroken strings (SKUs, URLs) get `overflow-wrap: anywhere`.

### Icons
- Replace all emoji with a single **SVG icon set**, inheriting `currentColor` so it themes with the merchant's brand.
- Every icon is `aria-hidden` when decorative; icon-only buttons get a label.

### Theming + isolation
- The screen gets **only** the merchant's tokens (`--qz-color-*`, `--qz-font-*`, radius) and **only** `quiz-runtime.css`.
- **Admin CSS must not reach inside.** Options: render the screen in an iframe (true isolation, exact `/q` parity) or a shadow root. See open question 1.

### States every preview must handle
- Empty (no products / no answers yet)
- One item vs. many (grid must not collapse)
- Missing image, missing price, missing description
- Very long title, very long headline
- Loading (skeleton)
- Content taller than the screen (scrolls, with affordance)

---

## 3. Best practices this encodes

1. **The preview must not lie.** True device viewport, real runtime CSS, real tokens. If it renders here, it renders there.
2. **The frame is fixed; the content scrolls.** A preview that grows is not a preview.
3. **Nothing shifts after paint.** Fonts preloaded, images reserved at final size.
4. **Degrade visibly, never silently.** Missing image → placeholder, not a hole.
5. **Clamp, don't wrap.** Merchant content is unpredictable; the layout must be unbreakable.
6. **One primitive, every screen.** No per-step phone CSS ever again.
