# Design Rules — Phase 4 (new batch)

Continues from Phase 3\. Same flow: compile edits here, then when ready move into the project, merge into `design-rules.md`, implement, review, commit. Do not push.

**Carried in from Phase 3 (approved, being applied — not repeated here):**

- Left-align \+ fill layout for data/list pages; center only Home \+ forms (Phase 3 Edit 3, revised).  
- List/dashboard polish: 2–3-up grids, compact modules, analytics no-data dashed placeholder trend, Groups empty-state card (Phase 3 Edit 10).

---

## Edit 1 — Hover micro-interaction: "grow on hover"

The KPI numbers scale up slightly on hover. Apply the **same subtle grow** to Home action-card titles (e.g. "Create manually") on hover — a small springy transform. One consistent hover language across numbers \+ card titles. Respect `prefers-reduced-motion` (Phase 3 Edit 8).

*Status: locked.*

---

## Edit 2 — Brand Identity → full brand book (design \+ functionality)

Expand Brand Identity from the current digest into a comprehensive, editable **brand book** that (a) auto-pulls what it can and (b) lets the merchant set everything. It's the source the AI uses to build every quiz (applied automatically; edited fields locked so a Shopify re-sync never overwrites them). Answers the repo's parked `design-settings-spec`.

**Auto-pulled (each with a confidence badge \+ sources \+ re-sync):**

- **Shopify Brand API:** brand colors, logo(s), slogan, short description.  
- **Theme (`settings_data.json`):** theme colors, fonts, button styles.  
- **Catalog:** tags, price range/median (positioning), product types/verticals, product copy → voice/tone, imagery.  
- **Orders:** best-sellers / hero SKUs.  
- **AI-derived:** summary/positioning, voice & tone, brand tags, audience, industry/vertical/price tier, category trends.

**Settable — the brand book, by section:**

1. **Identity** — name, tagline(s), short \+ long description, positioning statement.  
2. **Voice & tone** — adjectives, do/don't, sample copy.  
3. **Logo** — primary, secondary/mark, favicon; light/dark variants; size \+ clear-space.  
4. **Colors** — by role (primary, secondary, accent, background, surface, text, muted, success/error), picker \+ hex, light/dark.  
5. **Typography** — heading \+ body font (curated font list); **sizes by level** (H1/H2/H3/body/caption/label); weights; line-height / letter-spacing.  
6. **Shape & depth** — corner radius; button style; **shadow/elevation (shading)**.  
7. **Spacing & density** — spacing scale, content density, image density.  
8. **Imagery** — style/mood, treatment, do/don't.  
9. **Presets** — named starting themes (Linen / Minimal / Editorial / Bold / Pastel / Dark) as one-click bases.  
10. **Positioning** — industry, vertical, price tier, audience, category trends.

**Behavior:** every field editable; edited fields **locked** (lock icon) so re-sync never overwrites; per-section confidence; applied automatically to AI-built quizzes; feeds the per-quiz Design step via the token cascade (brand → quiz override → default).

**Layout (chosen):** V1 — **single scroll \+ click-jump \+ scrollspy** (the nav highlights the section you're in; clicking jumps to it). A document/book, not a panel-swap.

*Status: locked (big feature — design \+ functionality).*

---

## Edit 3 — Brand-book data-health signals

Every section shows a status so the merchant knows what to fill:

- **Green check — confirmed / strong** (good Shopify pull or merchant-edited).  
- **Amber — weak / low confidence** (pulled but uncertain).  
- **Red — missing / none** (nothing from the Shopify download and unset).

Shown as **colored dots in the left nav** \+ a **badge on each section card** \+ a **top completeness summary** ("6 of 10 confirmed · 3 weak · 1 missing"). Missing sections get an inline "add it" prompt. Nudges the merchant to complete the book — better brand data → better AI-built quizzes.

*Status: locked.*

---

## Edit 4 — Brand page color animation (deliberate color-rule exception)

The Brand Identity page is the ONE place the app celebrates the merchant's colors, so it gets a tasteful **animated color element** — a slow flowing gradient built from the brand's own palette (primary/secondary/accent). This is an explicit, scoped exception to the global color-restraint rule (Phase 3 Edit 6\) — this page only. Subtle, looping, `prefers-reduced-motion`\-safe.

*Status: locked.*

---

## Edit 5 — Groups page: explain the concept (empty state \+ how-it-works)

The Groups & Personas landing doesn't make clear WHAT a group is. Add:

- **Animated "how it works" flow** under the description: **Catalog → a Group *or* Persona** (a unique combination; optionally a named shopper-facing persona) **→ Quiz outcome** (the shopper lands here). Persona must be visible in the flow, not just "a group." Give the panel real **visual definition** (tinted container \+ white bordered step cards — the faint shading had no impact). Flow imagery \= small branded flat icons; example cards show **real product thumbnails / persona art**.  
- **"Start from an example" cards** — AI-generated from the catalog: **2 personas \+ 1 novel unique combination** the merchant doesn't already have (a fresh, creative lens on their catalog — not something obvious). **No "persona vs combo" type labels** — they're all just Groups (a subtle persona cue where relevant is fine). Clicking pre-fills the create wizard.  
- **Reframe the page purpose** (§C4 outcome model): the headline/subtitle makes clear this page is for the **custom** outcomes only — personas \+ combinations — because **tags & collections are already usable as quiz outcomes with no setup**. Replace the old "map to a collection directly" disclaimer with: *"Your tags & collections are already usable as quiz outcomes — no setup. Groups here are the custom ones: personas and combinations."*  
- **"manage source" link** → opens product-source management (connect Shopify / import CSV / add & manage manual products — the light "All products" view, §C4 / Phase 3 Edit 2).  
- Keep a compact "how groups work" cue accessible even once groups exist (an ⓘ or collapsible help).  
- **Example-group generation (personalized, not static):** examples come from the merchant's own Brand Identity digest \+ catalog (tags, collections, price bands, verticals, best-sellers) — a snowboard shop sees snowboard examples, not skincare. Reuses the existing digest (cheap, no fresh AI per visit). **Run:** on brand-digest (install/sync) or lazily on first Groups visit; cached; regenerate on demand or after catalog change. **Cold-start fallback:** 3 generic structural templates (persona / dynamic / manual), clearly labeled, until personalized ones exist.

*Status: locked.*

---

## Edit 6 — Global rule: ambient motion, one per page

The subtle floating/bob animation on the "how groups work" widgets is the direction — promote it to a global rule, used sparingly:

- The page's **single main/hero element** (primary section, hero card, or the headline KPI) may carry a **subtle continuous idle animation** (gentle float/bob, \~3s, small amplitude).  
- **Max ONE ambient animation per page** — never on secondary content, never several at once. It draws the eye to the one main thing; more than that reads as clutter.  
- Distinct from hover motion (hover-lift Phase 3 Edit 11, grow-on-hover Edit 1), which stays on interactive cards.  
- `prefers-reduced-motion`\-safe.

*Status: locked.*

---

## Edit 7 — Make "how it ties together" obvious (create wizard)

Merchants don't intuit how mixed sources \+ the quiz connect. In the create wizard's Define step, make the union \+ usage visible:

- **Show the union math in the live preview:** per-source counts merging into the total — e.g. "8 from `tag:oily-skin` \+ 6 from `metafield:matte` \+ 1 hand-picked \= **11 products** (deduped)." The merchant *sees* sources combine into one pool (a subtle animation of sources flowing into the pool is welcome — the one ambient motion for this surface, per Edit 6).  
- **A one-line "how it's used" hint:** "This becomes a quiz outcome — when a shopper's answer points here, they land on this curated set (e.g. their persona)." **Do NOT** say "then later questions narrow it" — narrowing is filtering (needs no group) and that framing confuses (see §C4 "Groups vs. filtering").  
- Reinforces union-not-intersection (§C4): the group *gathers* its product set; it isn't a narrowing tool.

*Status: locked.*

---

## Edit 8 — Group wizard: "Manual selection" \+ clickable source counts

- Rename the source **"Hand-picked" → "Manual selection."**  
- The per-source count chip (+8, \+6, \+1) is **clickable** → opens a modal showing exactly which products that source contributes (same surface as the source's Edit / product picker). Transparency into what each source adds to the union.

*Status: locked.*

---

## Edit 9 — Rename: "Personas & Groups" (lead with personas)

Since groups are primarily a persona feature (§C4), lead with the value:

- Page title **"Personas & Groups"** (was "Groups & Personas").  
- Nav label **"Personas & Groups"** (full name in nav — RESOLVED by owner).  
- Update all references (nav, page title, empty state, wizard copy, how-it-works) to match. "Group" stays the internal/technical term for the object.

*Status: locked.*

---

## Edit 10 — Phase 4 review resolutions (baked-in fixes)

From the Phase 4 stock-take:

**Consistency**

- **R1 — Ambient motion (clarifies Edit 6):** one ambient **unit per surface** (a page *or* a modal). A multi-part unit (e.g. the 3-step how-it-works flow with staggered bob) counts as **one**. A modal is its own surface (the wizard's floating pool is that modal's one). All ambient motion \= transform/opacity only, `prefers-reduced-motion`\-safe, and **pauses when the tab is hidden / element off-screen**.  
- **R2 — Rename propagation (Edit 9):** every reference flips to **"Personas & Groups"** / nav **"Personas"** — page title, empty state, wizard, how-it-works, §C4 references ("Group" stays the internal object term).  
- **R3 — Hover-grow (Edit 1\)** applies only to **active/clickable** titles — never to "Soon" placeholder cards.

**Flow / placement**

- **R4 — Brand book scope:** governs the **shopper-facing quiz output** (runtime design tokens), **not** the admin studio (app's own design system). State it on the page.  
- **R5 — "manage source" destination:** opens a **Sources** surface — connect Shopify / import CSV / manage manual products (the light "All products" view, §C4). A dedicated sub-page reachable from the link, not an undefined modal.  
- **R6 — Brand Identity ↔ per-quiz Design:** the Step 05 Design shows **"inherited from Brand Identity · override for this quiz."** Editing there doesn't change the account brand book.

**Edge cases**

- **R7 — Brand book states:** **not-built** ("Build identity" CTA from catalog/theme/best-sellers) → **built** (sections \+ health signals). Cold-start opens on Build-identity, **not** a wall of red.  
- **R8 — Union count edge cases:** a source matching 0 → "+0" (flagged); a product already in the set → "+1 (already in set) · 0 unique." Recompute "N unique / M overlapped" correctly, including full overlap.  
- **R9 — "Use example" validation:** on click, validate the example's criteria against the **current** catalog; if stale/empty, regenerate or warn — never pre-fill dead criteria.  
- **R10 — Regenerate throttle \+ cache:** reuse the cached brand digest; rate-limit "Regenerate" — no fresh expensive AI per click.  
- **R11 — Locked field \+ upstream change:** if Shopify has a newer value for a locked brand field, show a quiet "new value available — review" cue; never silently overwrite a locked edit.  
- **R12 — No-catalog guard:** with no catalog, examples fall to generic templates **and** "New group" nudges "connect a source first" (ties to §K6) — never dead-end at empty sources.

*Status: locked.*

---

## 📌 For the master design system (backlog — approved, add later)

**Coral/pink "priority" accent — a second semantic accent.** Introduce a warm coral/pink as a **high-value / act-now** highlight, distinct from the violet primary.

- **Tokens:** accent `#D4537E` · tint `#FBEAF2`. (Already used in the prototype as `--pink` / `#FBEAF2`.)  
- **Meaning (semantic, not decorative):** reserved for the **hero / money / act-now** item on a surface — e.g. the flagship win-back segment ("Recommended → didn't buy"), the "Suggested play" card. Signals *this is the one to act on.*  
- **Usage:** a soft tint gradient background (`linear-gradient(135deg,#FBEAF2,#fff)`) \+ a coral border/CTA on the single priority element. **One per surface** — it loses meaning if everything is coral (same restraint as the violet-accent rule).  
- **Palette roles now:** violet `#6D5AE6` \= primary/brand/interactive · green `#1D9E75` \= success/healthy · amber \= attention/needs-review · **coral `#D4537E` \= priority/act-now** · neutral for everything else.  
- **Note:** liked by owner (2026-07-09) from the Customers re-engagement hub. Fold into `design-rules.md` when merging the master.

