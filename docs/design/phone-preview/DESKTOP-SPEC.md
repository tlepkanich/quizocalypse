# Desktop preview — layout + guardrails spec

**Last updated: 2026-07-14.** Canonical global settings — see the *Precedence —
newest wins* rule in `SPEC.md` (newest-dated definition always wins).

Companion to `SPEC.md`. Defines how the quiz runtime lays out on **desktop** (the
`Desktop` toggle in the preview) so the preview stops being a placeholder. Grounded
in Shopify quiz-app patterns (RevenueHunt, Odicci, Visual Quiz Builder), Typeform's
layout system, and ecommerce grid research — see **Sources** at the end.

The governing rule is unchanged from `SPEC.md`: **one document, one runtime, scale
the pixels not the layout.** Desktop is a *responsive branch of the same runtime*,
not a second design. Every value below is a token so mobile and desktop stay in
lockstep.

---

## 0. Desktop header (decided)

A wide desktop frame with a narrow centered column reads as "missing a header," so
desktop gets a real one — and desktop's device frame **is a browser window** (the
mobile equivalent of the phone bezel):

- **Faux browser chrome** at the top: three traffic-light dots + a **blurred
  placeholder URL bar** (suggests the storefront page without committing to a real
  URL). No store logo/wordmark.
- **Full-width progress bar** directly beneath the chrome, **6px, brand color** —
  clearly readable above the question title (it's the quiz page's own progress).
- The **in-content progress bar is hidden on desktop** (it lives in the header) —
  mobile keeps its in-content bar. Same data, one place per mode.
- When running as a **pop-up modal**, the close (×) sits at the top-right of this
  header (see §6).

## 1. Canvas

- **Preview viewport:** 1180 × 740 (matches the toggle's desktop frame).
- The quiz is a **centered column on the brand background**, never edge-to-edge.
  This is what every quiz app does (Typeform, RevenueHunt) — it keeps line-length
  readable and the brand bg framing the content.
- Three layout modes, chosen per section (not per merchant):

  | Mode | Max content width | Used by |
  |---|---|---|
  | **Centered** | 600 px | intro, question, email gate, message |
  | **Split** (media \| copy, ~48/52) | 960 px | hero/intro, featured result |
  | **Grid** | 1080 px | results / `product_cards` |

- Section vertical padding: **48 px** top/bottom desktop (24 px mobile). Content
  never touches the frame edge (min 24 px side gutter).

---

## 2. Per-section layout + guardrails

### Intro / hero
- **Split** (media left, copy right) or **Centered**. Merchant picks; default Split
  if a hero image exists, else Centered.
- Hero image **4:5** in Split, **16:9** if used as a full-width banner. `object-fit:
  cover`.
- Headline ≤ **60 chars** (2-line clamp). Subtext ≤ **140 chars** (3-line clamp).

### Question (all 13 types)
- **Centered, 600 px.** Serif heading, one question per screen (Typeform model).
- Heading ≤ **3 lines** (~120 chars), clamp.
- **Text answers:** full-width stacked buttons (same as mobile). Switch to a
  **2-column grid** only when there are **≥ 5 options AND every label is short**
  (≤ ~24 chars); otherwise stay single-column (long labels in 2-col wrap ugly).
- **Picture / image answers:** **grid**, 2 cols (≤4 options) → 3 cols (5–9) → 4 cols
  (10+). Tile image is **1:1**, capped at **230 px** (Typeform's picture-choice
  desktop cap). Label ≤ 2 lines under the tile.
- Answer label ≤ **60 chars** (2-line clamp).
- Scale: horizontal row of numbers, centered, end-labels beneath the ends.
- "Select up to N" helper sits directly under the heading.

### Email gate
- **Centered, 460 px.** Stacked fields, one consent line, one CTA. Never wider —
  a wide single input reads broken.

### Content block
- **Message:** Centered 600 px. Heading + body + optional image (**16:9** or 4:3).
- **Embed → video:** **16:9**, max **720 px** wide, centered (Typeform resizes
  question media to ~703 px — round to 720). In-quiz player; never navigates away.
- **Embed → blog:** hero **16:9** + excerpt (≤ 3 lines) + the read-more/collect CTA.
- **Embed → image:** max 720 px, native ratio inside a 16:9 max box.

### Results / recommendations (`product_cards`)
- **Grid.** Column count by number of recommendations:
  - **1** → single **featured** card (Split: large 1:1/4:5 image + copy).
  - **2** → 2-col. **3** → 3-col. **4+** → up to **4-col**, wrap to new rows.
  - **Hard cap: 4 columns** on desktop (more than 4 shrinks cards below usable).
- Optional **"top pick"** featured card spanning full width **above** the grid
  (the "No perfect match / our top pick" pattern already in the mobile mock).
- **Discount banner:** full-width strip above the grid (dark pill, code + expiry).
- **Product card** (fixed order, so cards align):
  1. Image — **1:1 square**, `object-fit: cover`. *This is the load-bearing
     guardrail:* mixed ratios (1:1 / 4:3 / 16:9) are the #1 cause of a jittery grid;
     force 1:1 so every card aligns.
  2. Rating + count (one line).
  3. Title ≤ **2 lines**.
  4. Optional "why" reason ≤ **2 lines** (tinted chip).
  5. Price.
  6. **Add to cart** (one-click) — per Shopify results-page best practice.

---

## 3. Image guardrails (global)

| Context | Aspect | Fit | Cap |
|---|---|---|---|
| Product card (grid) | **1:1** | cover | grid cell |
| Answer thumbnail (picture choice) | **1:1** | cover | 230 px |
| Hero (split) | **4:5** | cover | column |
| Hero / content banner | **16:9** | cover | 720 px |
| Embedded video | **16:9** | — | 720 px |

- **Always `object-fit: cover`** — never distort.
- **Reserve the aspect box before load** (skeleton) so images never cause layout
  shift or FOUT (the SPEC's no-lie rule).
- **Missing / broken image → brand-tint block** (with the product's first initial
  or a neutral icon). No emoji fallbacks (repo rule). `onError` swaps to the same
  block.
- Source images ideally ≥ 2000×2000 for products (ecommerce standard); the preview
  never upscales past the cell.

---

## 4. Word guardrails (global — all clamp with ellipsis, never push layout)

| Text | Max |
|---|---|
| Question heading | 3 lines (~120 chars) |
| Answer label | 2 lines (~60 chars) |
| Product title | 2 lines |
| Product "why" / description | 2 lines (full copy on the product page) |
| Badge / discount / "top pick" | 1 line (~28 chars) |
| Hero headline | 2 lines (~60 chars) |
| Hero / message subtext | 3 lines (~140 chars) |

Rationale: results pages convert worse with *too little* product info (Shopify best
practice), but a builder must **cap** it so one long title can't break the grid.
Two lines is the balance — enough to inform, bounded enough to align.

---

## 5. Sizing format per section (desktop, at true scale)

| Section | Column | Notes |
|---|---|---|
| Question / intro / email / message | 600 px (email 460) | centered |
| Content embed | 720 px | centered |
| Results grid | 1080 px | 20 px gutter, card min ~240 px, max 4 cols |
| Split hero / featured | 960 px | media ~48% |

- **Type scale (desktop):** heading 30–36 px, body 16–17 px, **min body 14 px**
  (carried from `SPEC.md`). Applied at true device scale, then the whole frame is
  scaled to fit the pane.
- Grid gutter 20 px; card radius matches the mobile card token.

---

## 6. Display modes, spacing & always-space

The runtime embeds three ways (Shopify quiz-app standard) — **same runtime,
different container:**

| Mode | What | When |
|---|---|---|
| **Inline** | rendered inside a page section (theme block) | quiz lives on a landing / collection page |
| **Pop-up modal** | centered card over a dimmed backdrop on the storefront | quiz triggered by a button / CTA |
| **Full page** | dedicated `/quiz` URL, quiz owns the viewport | shared links, ads |

**Pop-up modal (the one to get right):**
- Centered card, dimmed + slightly blurred backdrop, close (×) top-right.
- **Width = the active section's mode width** (600 / 720 / 960 / 1080) + padding,
  capped at `min(that, 92vw)`.
- **Height caps at `min(content, 88vh)` and the card scrolls internally** — it never
  exceeds the viewport. The progress bar / header stays **sticky** at the top of the
  card; the primary CTA may stick to the bottom.
- Backdrop-click and Esc **do not close mid-quiz** by default (avoid accidental
  abandonment) — only the × closes, with an optional "save & close" setting.

**Always-space rules (every mode):**
- Every screen has a **min content-height (~420px)** so a one-line question isn't
  cramped or vertically collapsed and the CTA doesn't jump between screens.
- Long content (many options, the results grid, stacked results blocks) **scrolls
  the container** — never clips, never lengthens the frame past the scroll. (Carries
  the `SPEC.md` "screen scrolls, frame is fixed" rule into every mode.)
- Constant section padding (48px desktop / 24px mobile) top & bottom; consecutive
  stacked blocks (results: banner → featured → grid) keep **24–32px** rhythm.
- A quiz is a **sequence of screens — one section per screen.** Sections never pile
  onto one screen. The only section that stacks blocks internally is **results**
  (banner + featured + grid), and it scrolls.

## 7. Email gate

- Two placements, merchant's choice:
  1. **Its own screen** in the sequence — Centered **460px**, stacked fields, one
     consent line, one CTA.
  2. **Mid-quiz pop-up modal** — a small centered 460px card over the current
     (dimmed) screen; collect-then-continue.
- Required vs skippable is a setting. A **consent line is mandatory** when collecting.
- **De-dupe (enforced at publish, not left to the merchant):** if a content block
  already collected email, the gate is **auto-skipped** — never ask twice; and if a
  discount was granted there, the coupon shows on results. (Carries the earlier
  content-block ↔ email-gate ↔ results coupling.)

## 8. Image settings (per type)

Every image the merchant picks (answer picture, content-embed image, hero, product
override) exposes the **same settings block**; defaults come from the §3 guardrail
table and are overridable:

| Setting | Options | Default |
|---|---|---|
| **Aspect ratio** | 1:1 · 4:5 · 4:3 · 16:9 · Original | per context (product 1:1, answer 1:1, hero 4:5, banner/video 16:9) |
| **Fit** | Cover · Contain | Cover |
| **Focal point** | draggable point (keeps the subject when Cover crops) | Center |
| **Background** (Contain / transparent PNG) | Brand-tint · White · Custom | Brand-tint |
| **Alt text** | free text (a11y + SEO) | — |

- **Product-grid ratio is one global setting**, not per-card — every card in a
  results grid must share a ratio or the grid jitters (§3). Set once for the results
  page; default 1:1.
- **Answer pictures within one question share one ratio** so the choice grid aligns.
- **Missing / broken → the global brand-tint fallback block** (`onError` swaps to
  it); the fallback isn't per-image configurable.
- Focal point earns its keep at **1:1 Cover on non-square sources** — it's what keeps
  a board/product centered instead of cropped oddly.

## 9. Open decisions (need alignment before final)

1. **Text-answer 2-column threshold** — proposed: 2-col only at ≥5 options *and*
   all-short labels. Alternative: always single-column on desktop (simpler, safer).
2. **Featured "top pick"** — always show a featured card above the grid, or only
   when there's a single strong match (confidence-gated)?
3. **Split hero** — build the Split layout now, or ship Centered-only for v1 and add
   Split later?
4. **Answer image cap** — 230 px (Typeform) vs a larger 280–320 px for a more
   premium feel on wide screens.
5. **Modal close behavior** — × only (proposed, avoids accidental abandonment) vs
   also close on backdrop/Esc.
6. **Email-gate default placement** — its own screen vs a mid-quiz pop-up modal.
7. **Default display mode** for a new quiz — Inline, Pop-up, or Full-page.

---

## Sources
- RevenueHunt — Product Recommendation Quiz for Shopify (results-page patterns): https://revenuehunt.com/product-recommendation-quiz-shopify/
- Odicci — Shopify Product Recommendation Quiz Playbook 2026: https://odicci.com/blog/shopify-product-recommendation-quiz/
- Visual Quiz Builder — Quiz Result Page Design Ideas: https://www.visualquizbuilder.com/post/quiz-result-page-design
- Typeform — Picture Choice question (230 px cap) & Image sizes (703 px): https://www.typeform.com/help/a/picture-choice-question-360052865591/ · https://help.typeform.com/hc/en-us/articles/360029258012-Image-sizes
- Best image aspect ratio for ecommerce (1:1 grid standard): https://www.clippingpathexperts.com/blog/image-aspect-ratio-for-ecommerce/
- E-commerce product grid layout user research: https://medium.com/insights-observations/size-and-layout-of-e-commerce-product-grids-a-user-research-case-study-8a8307cbd087
