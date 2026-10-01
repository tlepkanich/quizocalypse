# Results step — developer handoff

What to change in the app so the Results step matches the final design, what `main` already has, the live defects to fix first, and the server work behind the discount, consent and SMS settings. Every code reference below was checked against `origin/main` at `b4aa278` (2026-09-16), not against a local branch.

<!-- meta -->
| Key | Value |
|---|---|
| Design | [the live mock](https://claude.ai/artifact/A8sTkZg1JjYfzhavze8BEp), version 45 — `results-guided.html` in this folder |
| Checked against | `origin/main` `b4aa278` · 2026-09-16 |
| Applies to | `logic_model === "decider"` only |
| Surfaces | `/studio` and embedded `/app` |
| Written | 2026-09-17 |

## 1 · Read this first

### What you are getting

A bundle with two things in it. The folder `docs/design/results-guided/`, which **is not on `main`** — it has only ever existed in the designer's local checkout, so copy it into the repo at that path. And `patches/`, with one security fix that never left a local branch.

| File | What it is for |
|---|---|
| `DEV-HANDOFF.md` | This document: what to change in code, in what order, and what is already there. |
| `results-guided.html` | The mock. One file, no build step — open it in a browser. It is the reference for layout, wording and behaviour. |
| `master.md` | The design spec: why each decision was made, with sources. Read it when a rule here looks arbitrary. |
| `probes/*.mjs` | 33 Playwright scripts that assert the mock's behaviour. They drive the mock, not the app; §16 says which to port. |
| `patches/0001-SEC-1-….patch` | Beside the docs folder, not in it. A security fix that exists only on a local branch. See §4, defect 0. |
| `results-list-v33.html`, `nav-variations.html` | Older builds, kept for history. Not needed to build this. |

### What `main` already has — do not rebuild it

| Landed | Commit | What it gave us |
|---|---|---|
| The guided Results flow, as **six** steps | `03ed001` · 2026-08-02 | `app/components/onboarding/resultsGuided/{ResultsGuided,GuidedPreview,DiscountEditor,modals,state}` |
| Open-the-builder gate | `6887b30` · 2026-08-13 | The funnel bar's button stays disabled until every step has been visited |
| Guided settings reach the live quiz | `464f45b` · 2026-08-18 | The loading on/off gate, the skip link, the button label, a marketing-consent box stored as `EmailCapture.marketingConsent`, the extra-picks shelf, `perRow`, description overrides |
| Questions-step email screen | `0504c26` · 2026-09-08 | Placement including inline capture, `captureTermsMode`, `smsConsentMode`, consent evidence on `/captures` (`consentEvidence`, `consentRecordedAt`), policy links resolved against the shop's domain |

The design moved on after all four. This document is the difference.

### Which source wins

The owner's standing rule is **newest wins**: when two dated decisions conflict, the later one stands.

1. **This document (2026-09-17)** wins over the Questions-step handoff (2026-09-08) where they overlap. §10 lists every overlap and names one owner per setting.
2. **Inside the step's two columns — the settings card and the phone — the mock wins** for structure, content, wording and behaviour.
3. **Shared funnel chrome follows `main`.** The mock was never meant to restyle it.
4. **Colour, type and component styling come from `main`'s Quartz tokens**, not from the mock's palette. `node scripts/check-tokens.mjs` enforces this.

Rules 2 and 3 produce two lists. The owner should skim both; nothing else in this document reverses a past ruling.

**Rulings on `main` that this design reverses**

| On `main` today | Becomes | Decided |
|---|---|---|
| Six steps, with "The offer" as its own step | Five steps; the discount sits under the email placement | Owner, 2026-09-15 |
| Sub-tabs Loading › Email › Consent, landing on Loading (owner, 2026-08-18) | Email › Loading › Consent, landing on Email; Next walks the tabs | Owner, 2026-09-14 |
| Mobile/Desktop toggle, Expand view and size tag on the preview (owner, 2026-08-27) | Phone only | Owner, 2026-09-15 |
| No card around the settings column (QRTZ-G45, 2026-08-13) | A card with a fixed minimum height, so Back and Continue hold one position | Owner, 2026-09-16 |
| Progress pips 3px tall, capped at 260px wide | 4px, the current one 9px, spanning the column | `master.md` §5 |
| Step head shows "Step n of 6 · name", an "All reviewed" chip and a rationale line | "Step N of 5" and the title only | `master.md` §8 |
| Clicking any region of the phone changes the step | The phone never changes the step | Owner, 2026-09-16 |
| Highlight ring holds 2.6 s and re-rings on every render | One second, then a 0.45 s fade; a touched control rings only its own element | Owner, 2026-09-16 and 09-17 |
| Review stars, verified badge, products per row and match count are controls on step 2 | Removed from this step. The live quiz keeps reading the keys | Owner, 2026-09-14 and 09-15 |
| Marketing consent is off unless turned on | On for every new quiz | Owner, 2026-09-17 |
| Questions step offers "Notice only" for SMS, a terms on/off switch, and editable consent sentences | SMS always has its own checkbox; terms can be a line or a checkbox but never off; required wording is fixed | Owner, 2026-09-16 |

**Kept from `main`, although the mock shows something else**

| The mock shows | Keep `main`'s | Why |
|---|---|---|
| "Next →" and "← Back" | "Continue" and the bare `‹` | Owner ruling 2026-08-18, shared with the other steps. The last button stays "Open the builder →". Do adopt the mock's layout: back on the left, forward on the right. |
| A "Saving… / Saved" pill | The save chip that is silent when healthy | Owner ruling 2026-08-18 on the shared `FunnelSaveChip` |
| "2.0s" printed on the loading preview | No read-out | Owner removed it 2026-08-18 |
| "Continue ›" in the funnel bar | "Open builder" | Shared chrome; asserted by `e2e/design-step-removal-verify.mjs` |
| A 390×844 phone | `DeviceFrame`'s 390×745 phone, capped at 86% | Shared preview primitive, pinned by `previewWidth.test.ts:28`. Pass `zoom={86}`. |
| Different default sentences for the headline, intro line and inline capture copy | The live quiz's read-time defaults, untouched | Changing them would alter quizzes that are already published. The mock's sentences are sample copy. |

## 2 · The work, in order

Ten packages. A is first because three of its defects put something on a public page that should not be there. B to G are builder work; H to J are server work.

| # | Package | What it is | Where | Risk |
|---|---|---|---|---|
| A | Fix first | Seven live defects (§4) | runtime, publish, routes | High — touches `app/components/runtime/**` |
| B | Flow | Six steps to five, tab walking, one completion signal, Overview (§5) | `resultsGuided/` | Low |
| C | Steps 1, 2, 4 | Cuts on steps 1 and 2; step 4's two rows and the picker (§6) | `resultsGuided/` | Low |
| D | Email tab | Placement, the discount list, the unlock switch, Page Copy, Loading (§7) | `resultsGuided/`, two new keys | Medium |
| E | Discount editor | Every control mapped to one Shopify field (§8) | `DiscountEditor.tsx`, schema | Medium |
| F | Consent | Four rows, fixed wording, links-only pop-up, the live form, the consent record, Questions-step changes (§9, §10) | builder, runtime, `/captures`, schema | High |
| G | Preview | Phone only, rings, click rules, scrolling (§11) | `GuidedPreview.tsx` | Low |
| H | Discount pipeline | API upgrade, config → Shopify, code pools, mint on submit, the page, the cart (§12) | server, runtime | High |
| I | Klaviyo event | One event from the mint (§13) | server | Blocked on the Integrations work |
| J | SMS pass-through | Hand the number on, never store it (§14) | server, runtime | Blocked on Integrations and on Shopify's data review |

**Order.** A first. B, C and G are independent of everything and of each other. D needs B. E needs D. F's builder half needs B; its runtime half is independent. H needs E's schema. I and J need H and the Integrations framework, which is **not on `main`** — it is separate, unfinished local work with its own design notes.

> [!IMPORTANT] Release rule — no control ships without its reader
> The owner's call on 2026-09-08 was that no control carries a "not connected yet" tag: each one gets wired for real. The mock has no such tags. So **E and H release together**, and F's builder half releases with its runtime half. If a release has to go out in between, keep `main`'s `Unwired` tag on exactly the controls whose reader has not landed, and keep the `WIRED` map in `resultsGuided/state.ts:169-193` honest. Delete both when the last reader lands. A control that silently does nothing is the one outcome worse than a tag.

## 3 · Ground rules that bite here

These are in the root `CLAUDE.md`. Each one has a specific consequence for this work.

**Decider-gated, and gated on an explicit value.** Every new live-quiz behaviour renders only when its key is explicitly present. An absent key must render exactly today's DOM — that is how `464f45b` wired the guided settings, and its negative-control probe proves it. The byte-pinned legacy quiz must not change.

**New schema fields are `.optional()`, never `.default()`.** A default rewrites every stored quiz on its next parse-and-save.

**Sparse writes make "default" a loaded word.** `patchGuided` deletes any key whose value equals its entry in `GUIDED_DEFAULTS` (`state.ts:88-101`), and `DiscountEditor` does the same against `DISCOUNT_DEFAULTS`. So a builder default must equal what the live quiz does when the key is absent. Where this design wants a different starting value for new quizzes, **write it explicitly when the draft is created** — `app/lib/funnelDraft.server.ts:77-82` — and leave the read-time defaults alone:

| Key | Live quiz when absent | New quizzes start with |
|---|---|---|
| `consentOn` | No marketing box | `true`, written explicitly |
| `consentCopy` | — | "Email me news and offers from {the store's name}." — the name filled in once, at creation, as ordinary text |
| `showDesc` | Descriptions shown | `false`, written explicitly |
| `termsUrl`, `privacyUrl`, `termsLabel`, `privacyLabel` | **No links at all** (§4, defect 1) | Always stored; take all four out of the sparse-clear |
| `consentVersion` (new, §9) | Today's consent form | The current wording version |

> [!WARNING] A trap at the seeding point
> `app/lib/smartBuild.ts:483` seeds the no-match fallback with `rec_page_settings: doc.rec_page_settings ?? { global: { emptyFallbackCol } }`. Once the draft is created with `rec_page_settings` already present, that `??` skips the fallback seed. Change it to a merge that keeps existing keys.

**One write path.** Every rec-page write goes through `setRecPageGlobal` (`app/lib/mutations/resultMutations.ts:163-187`), which holds the invariants — phone needs email, the SMS keys clear with the phone switch. Never spread `rec_page_settings` by hand.

**`app/components/runtime/**` is the highest-risk edit class.** Decompose, don't rewrite. Prove the DOM is unchanged for quizzes that don't use the new behaviour, run the full e2e, review screenshots. After every deploy run the byte pin by hand — `CLAUDE.md` states it, but **nothing in CI enforces it** (`.github/workflows/ci.yml` has no hash step).

**New shopper-facing strings and translations.** Adding a chrome token marks every locale on every quiz stale (`quizTranslate.ts` hashes `CHROME_TOKENS`), and the translation guard protects `@tag` placeholders but not `{…}` ones. §9 says how the fixed consent wording avoids both.

**Migrations are hand-authored** under `prisma/migrations/`. Never run `prisma migrate dev` against a shared database.

**The gate chain, unpiped, before every commit:** `npm run typecheck && npm test -- --run && npm run build && npm run lint && node scripts/check-tokens.mjs`.

## 4 · Fix first — live defects

Bugs in code that has already shipped. Each was confirmed by reading `main`. Status says what `main` does today.

| # | Defect | Status | Fix |
|---|---|---|---|
| 0 | **Integration credentials are public.** A quiz with an integration node publishes the merchant's Klaviyo private key (`api_key`) and webhook `secret` in `nodes[].data.actions[]`. They are served by `/q/:id`, `/q/:id.json` (open to any origin, cacheable), `/q/:id/results` and the new `/q/:id.embed.json`. | defect | Apply `patches/0001-SEC-1-….patch` from this bundle, with `git am`. It was written 2026-08-11 on a local branch and never reached `main`; `git apply --check` passes against `b4aa278`. It redacts inside `stripPublicDoc`, the one seam all four surfaces share, keeps the byte pin, adds tests, and adds `scripts/audit-published-credentials.mjs`. **Any key that script finds was exposed and must be rotated.** `/q/:id.embed.json` is newer than the patch; it goes through the same seam (`runtimePayload.server.ts:80`), so add one assertion for it. |
| 1 | **Terms links: tokens print, links vanish.** Three separate faults. (a) With terms as a checkbox — or with no mode set — the label prints `captureTermsText` verbatim, and the Results pop-up seeds that text with `{terms}` and `{privacy}`, so shoppers read the braces (`DeciderViews.tsx:384-386`, `modals.tsx:25-27`). (b) The builder's default link URLs equal `GUIDED_DEFAULTS`, so they are never stored, and the live quiz has no defaults of its own: a merchant who keeps the defaults publishes **no links at all**. (c) With no mode set, `termsUrl` goes into `href` raw: a store path resolves against the app's domain and 404s, and `javascript:` is not blocked (`DeciderViews.tsx:222-223`). Only "notice" mode substitutes the tokens and resolves the links today (`ConsentNotice.tsx:27-76`). | partly | §9 replaces the editable sentence with fixed wording, which removes (a). For (b), always store the four link keys. For (c), route every mode through `policyHref`, and tighten it: `https:` and store paths only — it allows `http:` today. |
| 2 | **A live shared discount code is public, and nothing uses it.** Publish mints a random `QUIZ-` code whenever `discount_config.enabled` is true and no code exists, with no decider gate (`quizEditorIO.server.ts:395-399`, `discount.server.ts:173-175`). The decider results page never reads that code (`DeciderViews.tsx:599-601` reads only `incentiveCode`). The guided editor's expiry is never read, so the code **never expires**. `discount_config.code`, `static_code`, `incentiveCode` and `engagement.reward` all ship in the public payload. "Duplicate" copies the code into the new quiz (`studio.quizzes.tsx:127-138`). | defect | Decider-gate the publish-time mint: decider quizzes mint per shopper (§12). Redact codes from every public payload in the same seam as defect 0, without changing key order. Clear `code` on Duplicate. Add assertions to `publicJsonStrip.test.ts`, which has none for discounts. |
| 3 | **Every product metafield is published.** The catalog sync asks for metafields with no namespace filter (`app/jobs/catalogSync.ts:69-73`), and publish copies them all into each `product_index` entry (`quizPublish.ts:591,618`). Cost, supplier notes or another app's data can end up in the public quiz file. | defect | Publish only the metafields the quiz uses — the ranking and match-strategy keys — or an explicit allow-list. |
| 4 | **The builder preview creates real discounts.** `RewardReveal` posts to `/reward` with no preview guard (`RewardReveal.tsx:42`); its sibling `ReferralShare` has one. `/reward` never checks that `session_id` belongs to a real, completed session (`reward.tsx:30`), and every replay for an existing reward issues another create call (`reward.tsx:97-106`). `FeedbackWidget.tsx:28` has no preview guard either. | defect | Pass `preview={isPreviewMode}` and render an example without fetching. Require a matching, completed `QuizSession` before minting. Add route tests — `/reward` has none. |
| 5 | **Phone numbers are stored, unusable.** `/captures` keeps the phone as typed, in plaintext, with no format check and no retention (`captures.tsx:86`). Merchants see it in the embedded Captures table (`app.captures.tsx`) and the contacts CSV (`customerHub.server.ts:101-108`). Nothing forwards it. With no recorded SMS consent a merchant cannot lawfully text it, and phone is Level 2 protected customer data under Shopify's rules. | defect | §14 — hand the number straight to a ready destination, or drop it. |
| 6 | **The "email unlocks a discount" placement publishes with no email form at all.** `patchGuided` maps `capturePlacement: "discount"` to `captureEmail: false` (`state.ts:90-93`), and the live quiz has no unlock card (`WIRED.placement_discount: false`). A merchant who picks it gets nothing. The same write deletes `capturePhone` and the SMS keys. | defect | Package D turns unlock into a switch and removes the mapping. Until then, hide the option. |

### Smaller defects found on the way

| Where | Defect | Fix |
|---|---|---|
| `QuizRuntime.tsx:1687` | `interstitial={engagement?.interstitial ?? guidedLoading}` — `resolveEngagement` always returns an interstitial, so **any quiz with an `engagement` key ignores the guided loading settings** and plays "Calculating your results…" for 2.5 s. | Let explicit guided loading values win over a defaulted engagement interstitial. |
| `state.ts:33`, `QuizRuntime.tsx:1667-1672` | The three default step labels are never stored, and the live quiz reads only stored steps. The preview shows named steps; the live quiz shows a bar and two other lines. | Give the guided interstitial the same three labels as its read-time default. |
| `DeciderViews.tsx:78` | The live delay is clamped to 1.5 s or more; the builder's stepper starts at 1.0 s. | Make the stepper's floor 1.5 s. No runtime edit. |
| `QuizRuntime.tsx:529-576` | With loading off, the reveal paints the template intro, then swaps in the AI copy. | Hold the first paint until the fetch settles or times out. |
| `QuizRuntime.tsx:1224,1422` | The decider capture never fires `email_captured`; only legacy paths do. | Fire it from `DeciderCaptureView`. |
| `QuizRuntime.tsx:1604-1624` | Hand-picked extra products are not filtered against the matches already shown. | Filter them, as the auto-fill path already does. |
| `state.ts:38`, `DeciderViews.tsx:838` | The default shelf copy shows in the preview but is never stored, so the live quiz has none. | Store it when the shelf is first switched on. |
| `DeciderViews.tsx:460` | The policy-links row renders at 10.9px when the base size is 14. | Never below 11px (§9). |
| `DiscountEditor.tsx:110-115` | Keys equal to their default are deleted **before** the merge, so resetting a field to its default never overwrites the stored value. A stored shared code survives a switch back to per-shopper codes — including the forced switch under unlock. | Merge first, then strip. Do not set keys to `undefined`: `resolveDiscount` spreads an explicit `undefined` over the default (`state.ts:134-138`). |
| `rewardPicker.ts:26` | A reward with no value mints a 0% code. | Refuse to mint without a value. |
| `engagementSchema.ts:145` | A blank usage cap means 100, while the field shows "∞". | Blank means no limit. |
| `QuizRuntime.tsx:1599` | The live quiz ignores account-level reward defaults that `/reward` applies (`reward.tsx:72-76`). | One resolver for both. |
| `studio.quizzes.tsx:150-157` | This publish path skips steps the editor's publish runs. | One shared publish function. |
| `analytics.ts:56-63` | `consent.terms.text` has no length cap. A `/captures` 400 resolves silently in the browser, so an over-long value loses the whole capture row. | Cap it; log 400s. |
| `gdpr.server.ts:84` | Redaction matches the email exactly and case-sensitively; `/captures` does not normalise case. | Lower-case on write and on match. |
| `app/shopify.server.ts:22,65` | The Admin API is pinned to `2025-01`, which Shopify retired on 2026-01-16. Also hard-coded in `shopifyConnect.server.ts:26` and `extensions/quizocalypse-block/shopify.extension.toml:6`. | §12, step 1. |
| `reward.tsx:16-18`, `rewardDiscount.ts:9-10` | Comments say codes are deterministic per session. They are random. | Correct them. |

## 5 · Flow, navigation and the Overview

Package B. All of it is in `app/components/onboarding/resultsGuided/ResultsGuided.tsx` (`RG` below) and its CSS in `app/styles/quizocalypse.css`.

### Five steps

| # | Title | Holds |
|---|---|---|
| 1 | What does the page say? | Headline, intro line |
| 2 | How do the matches look? | Arrangement, three card toggles |
| 3 | Do you want their email? | Sub-tabs **Email · Loading · Consent**. The discount lives in the Email tab. |
| 4 | Anything after the matches? | Extra picks, the no-match switch |
| 5 | Overview | Read-back, then "Open the builder →" |

- Delete the `disc` entry from `FLOW` (`RG:42-79`) and the `disc` group from the Overview rows (`RG:85-91`). Its body moves into the Email tab (§7).
- Re-index everything that addresses steps by number: `jumpFromPreview`'s 0–4 map (`RG:312-313`), `gotoStep(3)` in the discount editor's `onSaved` (`RG:1113`), the `gotoStep` open-section switch (`RG:285-289`). Fold `blockers.disc` (`RG:234`) and `summary.disc` (`RG:946`) into `keep`.
- The step head is "Step N of 5" and the title. Remove the `· {step.name}` suffix, the "All reviewed" chip (`RG:239`, `:1049`) and the rationale paragraph (`RG:1052`).
- Update the comments that still say "six-step" (`RG:23-38`, `Step1Funnel.tsx:329`) and the one that says the last button is "Continue to Design →" (`RG:30-31`).

### Walking the sub-tabs

`main` orders the tabs Loading › Email › Consent, lands on Loading, remembers the last open tab between steps, and leaves the step on the first press of the forward button (`RG:224`, `:298-302`, `:995-999`).

Change to:

- Order **Email, Loading, Consent**.
- Arriving forward — or from an Overview row — opens the **first** tab. Arriving with Back opens the **last** tab, so Back from step 4 lands on Consent.
- The forward button moves to the next tab and leaves the step only from the last one. Back is the reverse. The walk is seven stops: five steps, plus Loading and Consent.
- The step is marked done only when the forward button leaves its last tab.
- Each tab's dot turns green once that tab has been used or passed. `main` has no per-tab state; add one.

### One completion signal

`main` keeps two maps. `seen`, set by the forward button, colours the pips. `visited`, set by any arrival, gates both doors into the builder (`RG:215`, `:281`, `:296`, `:329-343`). They disagree after a preview jump — and preview jumps go away (§11).

- Delete `visited`. Drive the pips **and** the funnel bar's gate from one `seen` map, including the Overview's own entry (`__ovw`, set on first arrival).
- The funnel bar's button is disabled until every step is done. Tooltip: **"Finish the Results steps first."** Once live it stays live if the merchant walks back, and it submits `generate-build` exactly as "Open the builder →" does. To-dos on the Overview do not hold it back.
- The last button needs no gate of its own: the Overview cannot be reached without passing every step. Remove `is-disabled` and its title (`RG:1074-1076`).
- `e2e/design-step-removal-verify.mjs:67-88` asserts the current gate. Update it in the same commit.

### Pips

4px tall. The current one is 9px and stays green once its step is done: height says *here*, colour says *done*. No amber. Span the full column width — the card's right edge lines up with the bar's — so remove the 260px cap (`quizocalypse.css:9690-9694`). Give each segment a title: "You are here", "Done", "Not reached yet".

### The card and the footer

- Draw a card around the settings column, in Quartz tokens.
- Give the panel a **minimum height equal to its tallest step's natural height**, so Back and Continue sit at one height at every stop of the walk. The mock's figure is 449px for its own type scale; measure `main`'s.
- The card grows past that floor only when something inside it expands — today, only the Page Copy section. The buttons move with it; that is the one time they should move.
- On a short window, lower the floor to the room actually left under the title, and let the card scroll inside itself. The mock's `fitCard()` measures from the card's own top edge. Summing the head's `offsetHeight` misses its 16px bottom gap, and that was the overflow bug.
- Footer: back on the left, forward on the right, a hairline rule above. No Back on step 1 — absent, not disabled.

### Overview

| | `main` | Change to |
|---|---|---|
| Rows | Five, "Discount" among them | Four, in this order: **Email capture & offer**, What it says, The matches, Extra picks |
| Band headers | "Before the results" and "The results page" always drawn | Drawn only when the rows split — that is, only when placement is *before the results* |
| A row click | Opens the step on whichever tab was last open. The `holdSel` flag is dead: `gotoStep` clears it in the same batch (`RG:283`, `:964-967`). | Opens the step on its **first** tab. Delete `holdSel` (`RG:218`, `:965`, `:1100`; `GuidedPreview.tsx:51`, `:126`). |
| Matches read-back | `Hero + list · 3 shown · stars, cart, description` | `Hero + list · cart, description` |
| Email read-back | `Before results · Email[ + SMS][ · 2.0s]` | `Before results` or `On the page`, then ` · Email[ + SMS] · 2.0s[ · 10% off[ (unlocks)]]`. With no capture: `No email asked · 2.0s` |
| Extras read-back | `Extra picks · N shown`, or "Off" | `After all results · N shown` and/or `If no results`, or "Off" |
| To-dos | keep, says, **edge** | keep ("Needs a discount to unlock") and says ("Needs a headline"). Drop the edge to-do: picking products is what turns the shelf on, so it cannot be on and empty. |
| Arrival | All pips swell at once | The swell runs left to right, 90 ms apart. Confetti fires once, cleans up after 1.9 s, and respects reduced motion — `main` already does that part. |
| The phone | Stays where step 4 left it | Scrolls to the top. Scroll the `.qz-rg-screen` element: `DeviceFrame`'s `resetKey` resets a different one. |

The mock also defines a "partly done · N of M" row state. It cannot occur here, because the Overview is reachable only after every step is passed. `main`'s three states are enough.

## 6 · Steps 1, 2 and 4

Package C.

### Step 1 — What it says

- Rename the textarea's label "Intro line" → **"Why we recommend"** (`RG:399`), and both chip-row labels "Try" → **"Suggestions"** (`RG:380`, `:408`). The chips, their rotation and the window of three already match.
- No caption about personas under the headline. The rule it described is live-quiz behaviour to keep: the persona's name replaces the headline only while the headline is byte-equal to the default "Your perfect match" (`DeciderViews.tsx:726-728`). **Never change that default string.**

### Step 2 — The matches

Keep the four arrangement tiles and exactly three toggles: **One-click add to cart** (on), **Product description** (off; a pencil opens the per-product editor only while it is on), **"Add all to cart" button** (off).

Remove from `RG:430-517`: the "Products per row" and "How many to show" steppers, "Review stars", "Verified-buyer badge", and their preview markup (`GuidedPreview.tsx:284-293`). The main builder owns per-row and count. The live quiz keeps reading `perRow`, `gridMax`, `showStars` and `showVerified`; this step just stops writing them.

- The preview shows a fixed count per arrangement — Hero + list 3, Grid 4, List 3, Single 1 — at two per row. It draws "Add all to cart" only when two or more products show, as the live quiz does (`DeciderViews.tsx:647-656`).
- `GuidedPreview.tsx:254-256` treats `gridMax` as the total. The engine counts it **after** the hero (`recommendDecider.ts:448-449`). With the stepper gone the preview no longer reads `gridMax`; do not carry the mistake forward.
- The description editor lists only `productIndex.slice(0,24)` (`modals.tsx:131-206`). That does not scale, and whether descriptions belong on the card at all is an open decision (§17).

### Step 4 — Extra picks

Replace `RG:864-928` with:

| Row | Behaviour | Key |
|---|---|---|
| **Show these products if no results** | A switch, on by default. It governs only *whether* the no-match block renders; the products come from the Logic step's fallback. Nothing in the phone rings — the preview never simulates a no-match. | `fallbackOn`. The guided flow never writes it today. The live quiz reads `cfg.fallbackOn !== false` (`QuizRuntime.tsx:1587`). It has no entry in `GUIDED_DEFAULTS`, so write `false` explicitly and clear the key for `true`. |
| **Show these products after all results** | The whole row opens the picker. On the right it reads `Choose ›` until something is picked, then `2 products ›` or `Best sellers · 3 products ›`. **Picking is the switch** — there is no toggle. | `extrasProductIds`; write `extrasOn: picks > 0` from the same save. |
| Heading · Copy · How many to show (1–6, default 3) | Always open. Remove the "Copy and count" disclosure. | `extrasHeading`, `extrasCopy`, `extrasCount` |

- The picker gets Products / Tags / Collections tabs, a selection line "N selected · shown under the matches" and a "Save picks" button. Remove the green "✓ Inherits everything…" note. `collections` is already passed into the modal and ignored (`modals.tsx:202`).
- **Schema gap.** Only `extrasProductIds` exists. To read back "Best sellers · 3 products" the quiz must remember the source. Add `extrasSource: { kind: "collection" | "tag", id, label }`, optional, and resolve it to product ids at publish. Or ship product-only picking first and leave the other two tabs out.
- The mock's default heading is "You might also like"; the live quiz's read-time default is "Also worth a look" (`state.ts:37`, `QuizRuntime.tsx:1620`). Leave the read-time default alone and write the heading explicitly the first time products are picked.

## 7 · Step 3 — Email, the discount, unlock, Page Copy, Loading

Package D.

### Placement

A dropdown with three options, in this order and with these exact strings:

1. **Email collection on the results page.**
2. **Email collection before the results page.** — carries the "Best" tag; this is the default
3. **No email capture.**

`main` has four. The fourth — "On the results page. Email unlocks a discount." — becomes the switch below.

- The Questions step writes the same keys. Placement is `capturePlacement`, plus `captureEmail` and `captureInlineOn`, which move with it. Both steps must write all three together through `setRecPageGlobal`, the way `EmailScreen.tsx:56-61` does. `patchGuided` derives them one way only (`state.ts:90-93`); share one helper.
- Keep parsing `capturePlacement: "discount"`. Read it as *inline + unlock on*, and normalise it on the next write. Remove its mapping to `captureEmail: false` (defect 6).

### The discount, under the placement

In this order: the label "Discount", the list, **"+ Create a discount"**, the unlock switch, then "Required to see results", then Page Copy. Under *No email capture* the discount block stays and everything below it hides.

- **The list starts empty.** Delete both preset rows and `presetOn`, `customOn`, `applyPreset` (`RG:519-571`).
- A quiz has **one** discount. Its row shows the name ("10% off your order"), a sub-line ("`QUIZ-••••••` · a new code per shopper"), **Edit**, and a switch. The row stays when it is switched off. "+ Create a discount" hides once the row exists; Edit is the only way in.
- **"A discount exists" cannot be read from the quiz today**, because `discount_config` always parses to defaults (`quizSchema.ts:2186`). Add `discount_config.configured: z.boolean().optional()`, written on the editor's first Save and never stripped. Treat `configured === true || enabled === true` as "exists", so quizzes that used the old presets keep their row.

### Require the email to unlock it

A switch on the discount. Hidden under *No email capture*; choosing that placement turns it off.

- **New key:** `rec_page_settings.global.captureUnlocksOffer: z.boolean().optional()`, cleared by `setRecPageGlobal` when `captureEmail` is false.
- Turning it on, or changing placement while it is on, rewrites the stored discount to `code_mode: "dynamic"`. A shared or existing code must never sit behind the ask: the published quiz is public, so such a code is one `curl` away. The editor already refuses the other two modes while unlock is on (`DiscountEditor.tsx:42,108`), but the strip-before-merge bug (§4) defeats that today.
- **On, with no active discount:** no sentence, no purple "Set up discount" button. "+ Create a discount" turns solid purple — or, when a discount exists but is switched off, its row does — and a plain underlined **Set up later** link appears under the switch. Replace `RG:612-649`.
- **Set up later never turns the switch off.** It swaps the link for a quiet note — "No discount yet. The unlock card won't show until you create one." or "Your discount is off. The unlock card won't show until you turn it on." The highlight stays, and the Overview keeps "Needs a discount to unlock". Creating the discount, or switching it on, clears all three. Persist this: `deferredUnlock` is React state today (`RG:226`) and is lost on reload.
- **Preview.** Inline + unlock: the locked offer card replaces the offer bar. With no discount yet the card is blurred, with "Add a discount to unlock this" — `main` already has it (`GuidedPreview.tsx:164-173`). Before + unlock: the gate screen is normal, and the results page shows the offer bar with the code.
- **"Required to see results"** shows only for *before the results*. The Questions step edits the same key, `captureRequired`. The starting value is an open decision (§17).

Two cases the mock does not settle. Build the recommendation unless the owner says otherwise (§17):

1. *Before* + unlock + no active discount. The gate copy must not promise a discount. Until a discount is active, the live quiz renders the plain ask, as if unlock were off.
2. *Before*, not required, unlock on, and the shopper skips. Show the inline locked card on the results page, so they get a second chance to unlock.

### Page Copy

- Rename the disclosure "Wording" → **"Page Copy"**, set as a bare title like the other field labels. No read-back under it (`RG:667-670`).
- Opening it scrolls the whole section to the top of the card, so all four fields — headline, supporting line, button, skip link — are on screen at once.
- Remove the captions under Supporting line (`RG:699-702`) and Skip link (`RG:729-731`), and the "Test" pill (`RG:655`).
- The skip link field shows only for *before* and not required. `main` already does this (`RG:718`).
- Placement copy presets apply only while the three copy keys are absent (`RG:353-358`), and applying a preset writes them, so they never re-apply after the first change. `copyTouched` is an unpersisted ref. Keep "apply only when untouched", but persist the fact that the merchant edited the copy; otherwise a placement change on a later visit overwrites it. This is defect D7 in the Questions handoff.
- Adopt the mock's inline preset in `GATE_COPY` (`state.ts:51-55`): "Want these emailed to you?" / "We'll send this match list to your inbox." / "Email me my matches". The builder writes presets explicitly, so the live quiz's own fallbacks (`InlineDeciderCapture.tsx:26-30`) stay untouched.

### Loading tab

The on/off switch belongs to the Questions step (`EmailScreen.tsx:203-222`). Remove the "Show a loading screen" toggle from this tab (`RG:744-749`), and the caption at `RG:810-813`.

| Control | Spec | `main` |
|---|---|---|
| Duration | Stepper in 0.5 s steps, up to 5.0 s | Present. An absent value resolves to 1.6 s, so the stepper shows "1.6s" and steps off the 0.5 grid. Snap to the grid on first change, and set the floor to 1.5 s (§4). |
| Name the steps | On, carries the "Best" tag | matches |
| Step labels | Add and delete, five at most, one at least. Focus the new input after Add. | matches, except the focus |

- When the Questions step has loading **off**, this tab still opens. Show one line in place of the controls: "The loading screen is off. Turn it on in the Questions step." The preview shows the results page. The mock pins loading on and does not model this.
- Stale since `464f45b`, and no longer true: that `GUIDED_DEFAULTS.loadingOn` is `false` (it is `true`, `state.ts:30`), and that the live quiz ignores `loadingOn` (it gates on `cfg.loadingOn !== false`, `QuizRuntime.tsx:1677-1681`).

## 8 · The discount editor

Package E. The rule: **every control writes one documented Shopify Admin GraphQL field. A control that cannot be mapped is cut, not explained.** `master.md` §4 has the reasoning for each cut.

Layout: one 680px column, no side rail. Basics first, then Advanced in Shopify's own section order with Shopify's own labels, then the read-back, then Save. Confirm before closing with unsaved changes.

### Basics

| Control | Doc key | Shopify field |
|---|---|---|
| Discount type: **Amount off orders** (default) / **Amount off products** / **Free shipping** | `kind`, with `applies_to` | Chooses the mutation and the items. Order → `customerGets.items.all`. Products → `.products` or `.collections`; Shopify has no "all products" product discount. Free shipping → `discountCodeFreeShippingCreate`. |
| Value: Percentage / Fixed amount | `kind`, `value` | `customerGets.value.percentage`, sent as value ÷ 100, or `.discountAmount.amount` |
| Only apply discount once per order | new `applies_on_each_item` | `customerGets.value.discountAmount.appliesOnEachItem`. Shown only for a fixed amount on products, which is when Shopify shows it. The server hardcodes `false` today. |
| Exclude shipping rates over… — free shipping only | new `max_shipping_price` | `maximumShippingPrice`. A bare `Decimal`, not a `MoneyInput`. |
| Active dates: Doesn't expire / Hours after the quiz / On a date | `expiry_mode`, `expiry_hours`, `ends_at` | `endsAt`; "Doesn't expire" sends `null`. **Hours is not a Shopify field**: every code shares its discount's `endsAt`, so it is served from hourly buckets (§12), and the read-back says the deadline is rounded up to the hour. `none` and `date` exist in the schema but are unreachable in the UI today. |
| Code | read-back only | `code` |

### Advanced

| Group | Control | Doc key | Shopify field |
|---|---|---|---|
| Discount code | Where the code comes from: a new code per shopper / one shared code / an existing discount | `code_mode` | Three pipelines: one code per shopper from a pool, one discount created at publish, or **nothing created** — an existing discount is only read |
| | Code prefix — per shopper only | `code_prefix` | Joined into `code` by the app |
| | Code — shared only | `static_code` | `code`. Empty blocks Save. |
| | Existing discount: **a real picker** | `existing_code` and new `existing_discount_id` | Read with `discountNode(id:)`; `codeDiscountNode` is deprecated |
| | Discount name | `title` | `title`. Required on create, and Shopify shows it to the merchant **and to customers**. The guided editor has no such field today, so every quiz lands in Discounts as "Quiz reward". Hidden for an existing discount. |
| Applies to — products only | What we recommend / Specific collections / Specific products, each with a real picker | `applies_to` — add `"recommended"` — with `applies_collection_ids`, `applies_product_ids` | `customerGets.items.products.productsToAdd` or `.collections.add`, 100 items at most. "What we recommend" is resolved per result (§12) and needs per-shopper codes. |
| Countries — free shipping only | All countries / Selected countries, with a picker | new `shipping_countries` | `destination.all` or `destination.countries.add`. The server hardcodes `all` today. |
| Minimum requirements | None / purchase amount / quantity — one three-way, never two fields | `minimum_subtotal` or `minimum_quantity` | `minimumRequirement.subtotal…` or `.quantity…`. Shopify rejects both together. |
| Usage limits | Total uses · One use per customer | `usage_limit`, `once_per_customer` | `usageLimit`, `appliesOncePerCustomer`. With per-shopper codes the first reads "Total codes this quiz can give out", and the second becomes a note: Shopify counts use per code, so the app enforces it by email (§12). |
| Purchase type | One-time / Subscription / Both; then Recurring payments: first payment only / a set number / every payment | `purchase`, `recurring_limit` | `appliesOnOneTimePurchase`, `appliesOnSubscription` — **top-level** on the free-shipping input, which has no `customerGets` — and `recurringCycleLimit`; 0 means every payment |
| Combinations | Three rows: product, order, shipping discounts | `combines.*` | `combinesWith.*`; all three default to false. Hide the shipping row on a free-shipping discount. Drop the red "unanswered" note. |

**Retire the guided-only `scope` key** — it duplicates `applies_to`, which the server already reads. Keep parsing it.

### Cut from `main`'s editor

| Control on `main` | Why it goes |
|---|---|
| "Exclude items already on sale" — **on by default** (`DiscountEditor.tsx:414-424`, `state.ts:122`) | No Shopify field expresses it, and a Discount Function cannot read compare-at price either. The read-back has been confirming a margin protection that does not exist. |
| "Who can use it": first-time buyers / a customer segment (`:336-369`) | First-time needs a Discount Function the app does not have. A typed segment name can never resolve to the id the API wants, and the app has no `read_customers` scope. |
| "Auto-apply at checkout" (`:320-333`) | Not an API field, and already always true: the cart link carries `?discount=CODE`. With it goes the preview's "with code" tag (`GuidedPreview.tsx:277`). |
| "Can stack with other discounts" in Basics (`:212-228`) | One checkbox over three independent booleans. A mixed state rendered unchecked, so one click wiped per-class answers. |
| Scope "Top pick only"; the two preset rows | No such scope in Shopify. Each preset was a discount the merchant never looked at. |
| The amber "You can finish this later" note (`:464-468`); the five rail warnings (`:74-86`) | Each restated a note already in the pane. The 0% warning becomes a Save blocker. |
| `deliver_on_page`, `deliver_klaviyo`, `deliver_rivo`, `auto_apply`, `eligibility`, `segment`, `exclude_sale` | No reader anywhere. Stop writing them; keep parsing them. Also delete the dead `combinesUnset` export (`state.ts:156-157`). |

### What this creates in Shopify

Replace the sticky side rail "What you're building" (`DiscountEditor.tsx:508-542`) with a block at the **bottom** of the editor, just above Save. Labelled rows, never prose, each suppressed when it has nothing to say: **Discount · Code · Expires · Shipping · Stacking · Limits · Subscriptions**.

- It carries what no single control can. Discount adds "— split across the matching items, not taken off each one" when that applies. Expires resolves relative time to a wall clock: "24h after each shopper finishes, rounded up to the hour — someone finishing now has until 3:00 PM Thursday, store time."
- For an existing discount the heading is **"What this uses in Shopify"**, because on that path the app creates nothing.

### Save blockers

`main` never blocks Save and silently clamps the value to 1 or more (`DiscountEditor.tsx:100-121`). Instead, disable Save and show the first message, in red, on the Save row:

- "A 0% / $0 reward takes nothing off. Give it a value."
- "A percentage cannot go over 100."
- "Type the code shoppers will use."
- "Pick the discount you already made."
- "A shared code can only expire on a fixed date. Pick a date, or switch to a code per shopper."
- "Pick the date it expires."
- "Pick at least one collection." · "Pick at least one product." · "Pick at least one country."

Coupled resets, so an impossible state can never be saved. Choosing a shared or existing code while expiry is "hours" resets expiry to "Doesn't expire". Choosing one while Applies-to is "What we recommend" resets it to "Specific collections". Both settings need per-shopper codes.

### What the shopper is told

One pair of helpers feeds the offer bar, the unlock card and the Klaviyo event (§13), so all three always agree.

- **The noun follows the scope.** Order discount → "your order". What we recommend → "your match". A picked list is named → "10% off Best sellers". Free shipping has none. `main` hardcodes "your match" (`GuidedPreview.tsx:324-333`).
- **The terms follow the settings.** " · orders $50+", " · 2+ items", " · expires in 24h", " · ends {date}". A minimum the page never mentioned is a code that silently fails at checkout.
- **The code reads** `QUIZ-••••••` for per-shopper codes, the typed code for a shared one, "your existing code" otherwise. `main` shows the real `d.code` or a fake sample (`state.ts:151-155`).
- **Card prices strike only** for a product discount scoped to what we recommend, not locked behind the email, and not subscription-only. A fixed amount strikes `value ÷ number of matching cards` unless "once per order" is off. `main` strikes the full amount off every card (`GuidedPreview.tsx:265-271`): three matches preview three times the real saving.

> [!NOTE] The existing-discount picker is a stand-in
> The mock offers three sample codes as buttons. Production needs a real picker over the store's Shopify discounts, saving the discount's id as well as its code.

Subscribe & save sits in this editor in the mock, but it writes results-card state and has no schema key. It is an open decision (§17); leave it out of the first build.

## 9 · Consent

Package F. The owner's rule, in their words: *"If there is something standard we have to say, don't make it editable. We should be 100% compliant."* The pattern is the one large beauty brands use — a short checkbox over a short terms line. The brand writes its own marketing-checkbox text and points two links. Everything a rule requires is fixed.

### The Consent tab — four rows, in this order

| Row | Starts | Writes | Behaviour |
|---|---|---|---|
| **Email marketing consent** | on | `consentOn`; the text is `consentCopy` | An optional, **unticked** box under the email field. It never blocks submit. Under the row sits a plain text input where the brand writes the box's text: 120 characters in the UI, shown exactly as typed, escaped, **no tokens, nothing appended**. No caption. Left empty, the row says "Write the checkbox text — until then shoppers see the default." and the form keeps the default. |
| **Terms and conditions checkbox** | off | `captureTermsMode`: on → `"checkbox"`, off → `"notice"`. Hold `captureTermsOn: true`. | Off: the terms are a passive line. On: they become a box the form **will not submit without**. |
| **Email terms of service** | — | `termsLabel`, `termsUrl`, `privacyLabel`, `privacyUrl` | "Edit →" opens the pop-up below. It edits the two links and nothing else. |
| **SMS collection** | off | `capturePhone`; write `smsConsentMode: "checkbox"` with it | Adds the phone field and its own optional, unticked box. Under the row: "Integrations are set up later. Until one is connected, the phone field stays off your live quiz." |

- The labels are sentence case; "SMS" stays capitalised.
- Under *No email capture* there is no form, so all four rows give way to one line: "No email is collected, so there's no form to add these to." `main` shows the rows under every placement, and turning SMS on there silently bounces.
- `main`'s tab has three rows — "Marketing consent", a "Terms & conditions" **on/off** switch with a pencil, and "SMS opt-in" — and writes neither mode (`RG:819-862`).
- **The privacy link cannot be switched off while an email is collected.** It is the notice at collection that GDPR art. 13 and the CCPA require. That is why terms has a mode and no off switch — here and on the Questions step (§10).

### The fixed wording

One module, versioned, imported by the builder preview and the live quiz alike — for example `app/lib/consentWording.ts`. Current version: **`2026-09-17`**.

| Sentence | Wording | Why it reads this way |
|---|---|---|
| Terms, as a line | By continuing, you agree to our {Terms} and acknowledge our {Privacy Policy}. | A privacy notice is *acknowledged*, not agreed to. "Agreeing" to it is not a lawful basis. |
| Terms, as a box | I agree to the {Terms} and acknowledge the {Privacy Policy}. | Requiring agreement to *terms* is fine. Requiring marketing consent is not. |
| Under the boxes, while marketing consent is on | You can unsubscribe from {store} emails at any time. | The brand's own checkbox text can say anything, so the two things CASL s. 4 requires *in the request* — who is asking, and that consent can be withdrawn — live in this fixed line. The business's address and contact details arrive through the Privacy link. |
| SMS box label | Text me offers from {store}. | Short, so it reads as a checkbox. |
| SMS small print | By ticking "Text me offers", you agree to receive recurring automated marketing texts from {store} at the number provided. Consent isn't a condition of purchase. Msg frequency varies; msg & data rates may apply. Reply HELP for help, STOP to cancel. | Every element US carrier (CTIA) and Klaviyo guidance list. It names its box because it no longer sits beside it. |

- `{Terms}` and `{Privacy Policy}` are the two links, with the merchant's own labels. `{store}` is the store's display name.
- **The store's name is not in the published quiz today** — only `shop_domain` is baked (`quizPublish.ts:829`). Bake `shop_name` the same way, for decider quizzes only, and update the publish byte-stability test (`quizPublish.test.ts:374`). Standalone workspaces use the brand name.
- The brand's own checkbox text never gets the name filled in. Its default — "Email me news and offers from {store's name}." — is written once, when the quiz is created, as ordinary text.
- `captureTermsText` and `smsConsentText` stop being written. Keep parsing both forever. A merchant's old custom sentence stays in their quiz and is ignored once the quiz moves to the fixed wording.

### The live form

**Gate all of it on one new key:** `rec_page_settings.global.consentVersion: z.string().optional()`. The builder writes the current version whenever it writes any consent key, and at draft creation. **Absent → today's DOM, byte for byte.** Present → the form below, from `DeciderCaptureView`, for the gate and the inline placement alike.

Order, top to bottom:

1. The email field; then the phone field, when `capturePhone` is on **and** an SMS destination is ready (§14).
2. Every checkbox together: ☐ email marketing · ☐ SMS · ☐ terms — terms last, and only when it is a box. `main` renders SMS, terms, marketing in that order (`DeciderViews.tsx:359-415`), while its own builder preview renders marketing, SMS, terms.
3. The legal text: the terms line when it is not a box, then the unsubscribe line while marketing consent is on, then the SMS small print.
4. The button. `main` puts the notices *after* the button (`DeciderViews.tsx:431-432`); they move above it.

Rules:

- Submit waits for the terms box only. **Marketing and SMS never block it.** Today a typed phone number with an unticked SMS box blocks submit (`DeciderViews.tsx:236`). In the new form, an unticked SMS box means the phone number is simply not sent.
- Email marketing ticked → the email is marketable: subscribe it once an integration exists. Unticked → the shopper still gets results and any reward code, and is subscribed nowhere.
- Every policy link goes through `policyHref`. Tighten it to `https:` and store paths only, with `target="_blank" rel="noopener noreferrer"`. When a link key is absent, fall back to `/policies/terms-of-service` and `/policies/privacy-policy`, resolved against `https://{shop_domain}`.
- Render the legal text at the theme's small size, **never below 11px**. "Clear and conspicuous" is part of the SMS rule. The mock's 9px is schematic.
- The skip link, when the gate is not required, bypasses all of it. No email is collected, so nothing is owed.
- Text goes in as React text children, as now. No `dangerouslySetInnerHTML`.

### The consent record

`/captures` already stores `marketingConsent`, `consentEvidence` and `consentRecordedAt` (`captures.tsx:87-91`, `analytics.ts:46-64`). Against what a consent dispute needs — GDPR art. 7(1) puts the burden of proof on the business — this is still missing:

| Needed | Today |
|---|---|
| The wording version | not recorded |
| The two link URLs as shown | only the labels |
| The marketing checkbox's text | only the boolean |
| Which boxes were shown | inferred; SMS only if a number was typed |
| The placement — gate or inline | not recorded |
| A timestamp whenever any consent element was shown | only when terms or SMS evidence is present |

Extend `CapturePayload.consent`. It is `.strict()`, so add to it; do not replace it:

```ts
consent: z.object({
  version:   z.string().max(40).optional(),
  placement: z.enum(["gate", "inline"]).optional(),
  links:     z.object({ terms: z.string().max(2000), privacy: z.string().max(2000) }).strict().optional(),
  marketing: z.object({ checked: z.boolean(), text: z.string().max(500) }).strict().optional(),
  terms:     /* as now, plus .max(2000) on text */,
  sms:       /* as now; never the number — see §14 */,
}).strict().refine(v => Boolean(v.terms || v.sms || v.marketing))
```

Keep the `marketing_consent` boolean and its column.

> [!CAUTION] Deploy order
> The `consent` object is strict, so a client that posts the new keys to a server that does not know them gets a 400 — and a 400 resolves silently in the browser, losing the whole capture row. CI rolls the server back automatically when the smoke test fails, while browsers keep the new bundle. **Ship the server's schema one deploy before the live quiz starts sending the new keys.**

Nothing reads these columns yet. Show consent in the embedded Captures table and the contacts CSV, and include it in the `customers/data_request` export.

### The terms pop-up — two links, nothing else

`main`'s `TermsModal` edits a sentence with `{terms}` and `{privacy}` tokens, saves it as `captureTermsText`, validates nothing and never disables Save (`modals.tsx:15-127`). Replace it.

- Title "Email terms of service". Sub-line: "Where each link points. The "By continuing…" line and the SMS wording are set."
- Two pairs of fields — Terms label and link, Privacy label and link. **Both are required**, because the fixed line always shows both. Under the Privacy link: "Must include your business address and how to reach you — the email sign-up relies on it."
- Below them, "What shoppers see", marked 🔒 "The legal lines are fixed": the sentences rendered with real, clickable links.
- **Every link is checked as it is typed:**
  - A store path such as `/policies/…` resolves against the **store's** domain. The quiz itself is served from the app's domain, where that path 404s.
  - A custom link must start with `https://`.
  - Refused: `javascript:`, `http://`, bare domains, `//host`, an empty link, empty link text. Save stays disabled — "Fix the link above to save." — until each is fixed.
  - Each link has a status line and an **Open ↗** that goes exactly where a shopper's click will, in a new tab.
- The modal needs the shop's domain and name. Neither reaches `ResultsGuided` today (`Step1Funnel.tsx:331-338`).
- **Do the default policy pages exist?** Shopify serves `/policies/terms-of-service` only if the merchant wrote that policy. Recommended: a server-side `HEAD`, falling back to `GET`, against `https://{shop_domain}/policies/…`, with a short timeout. A 2xx means it exists — "✓ Your store's Terms of Service page". A 404 means "This store has no Terms of Service page yet." A password-protected store answers with a redirect: treat that as unknown and say nothing. Run the same check on custom links before publish, and **warn, don't block**. This needs **no new scope**. Reading `shop { shopPolicies }` would need `read_legal_policies`, and adding a required scope makes every merchant re-approve the app.

### Translations

The fixed wording is English. Keep it **out of `CHROME_TOKENS`**: adding tokens marks every locale of every quiz stale, and the translation guard does not protect `{…}` placeholders, so a locale that drops `{terms}` silently loses its links. For the first release a quiz served with `?locale=` shows the English legal lines. Hand-translated, counsel-approved wording per locale belongs in the same versioned module later (§17).

### Counsel

Because merchants cannot change the wording, one review covers every store. Two questions to put:

1. May CASL's contact details arrive through the privacy-policy **link** under the checkboxes?
2. Is the fixed unsubscribe line close enough to a brand's free-text checkbox to count as part of the same request?

Double opt-in for email, which Germany and some other markets expect, and the SMS confirmation text are the email and SMS platform's job, not this form's. Say so in the setup guide.

## 10 · One owner per setting — Questions step and Results step

Both steps edit the same keys under `rec_page_settings.global`, which is what the owner asked for: *what is selected on the Questions step is already set when the merchant reaches Results.* That holds as long as both write the same keys through `setRecPageGlobal`. The table says which step shows what.

| Setting | Key | Questions step | Results step |
|---|---|---|---|
| Where to ask | `capturePlacement`, with `captureEmail` and `captureInlineOn` | edits | edits. One shared helper writes all three. |
| Required to see results | `captureRequired` | edits | edits, for *before* only |
| Terms: line or checkbox | `captureTermsMode` | edits | edits, as "Terms and conditions checkbox" |
| Terms on/off | `captureTermsOn` | **remove the switch** | never shown; held `true` |
| The terms sentence | `captureTermsText` | shows the fixed wording | not editable |
| Policy links | `termsUrl`, `privacyUrl`, and the two labels | — | edits |
| Email marketing consent | `consentOn`, `consentCopy` | — | edits |
| SMS on/off | `capturePhone` | edits | edits, as "SMS collection" |
| SMS: checkbox or notice | `smsConsentMode` | **remove the pair** | never shown; always `"checkbox"` |
| The SMS sentence | `smsConsentText` | shows the fixed label | not editable |
| Loading on/off | `loadingOn` | edits | not shown |
| Loading duration and labels | `loadingMs`, `loadingNamed`, `loadingSteps` | — | edits |
| Gate headline, line, button, skip link | `captureHeadline`, `captureSubtext`, `captureCta`, `captureSkipLabel` | — | edits, in Page Copy |
| The discount and the unlock | `discount_config`, `captureUnlocksOffer` | — | edits |

### Changes this makes to the Questions step

All in `app/components/onboarding/questionsWalkthrough/EmailScreen.tsx`.

1. **Terms.** Remove the on/off switch. Keep the Checkbox / Notice pair. Its sample sentences become the fixed wording; today they read "I agree to the Terms of Service and Privacy Policy." and "By continuing you agree to our…" (`ConsentNotice.tsx:3-25`).
2. **SMS.** Remove the Checkbox / Notice pair (`:85`, `:195`). Turning SMS on writes `smsConsentMode: "checkbox"`. "Notice only" is not valid consent for marketing texts, and the owner's call is that SMS always carries its own box.
3. **The summary line** (`:22-40`). Drop "SMS no consent configured", "SMS notice" and "Discount capture".
4. **Every consent write stamps `consentVersion`**, through the same helper the Results step uses, so a quiz edited only here still moves to the fixed wording.
5. **Decisions that handoff left open, now settled.** `consentOn` is kept and wired, not retired. Placement is edited on both steps through one helper. `capturePlacement: "discount"` is not surfaced; the unlock switch replaces it.
6. **Tests to update with it:** `QuestionsWalkthrough.test.tsx:220-257`, `e2e/q3-questions-verify.mjs`, and `e2e/q3-capture-verify.mjs`, which checks evidence for before and inline × checkbox and notice.

Already-published quizzes keep whatever mode they have: the live quiz reads the old keys until a quiz carries `consentVersion`.

## 11 · The preview

Package G. `app/components/onboarding/resultsGuided/GuidedPreview.tsx` (`GP`).

### The frame

- **Phone only.** Remove the Mobile/Desktop toggle, the Expand button and its portal overlay, the size tag and `data-device` (`GP:83-84`, `:433-466`, `:478-514`), and the CSS that widens the page for the desktop preview (`quizocalypse.css:816`, `:9676-9679`).
- Keep `DeviceFrame`'s 390×745 phone and cap the scale at **0.86** with `zoom={86}` — `DeviceFrame.tsx:52-56` already clamps. Slightly under life-size reads as a preview beside the settings, not a second page.
- A 6px light bezel drawn **outside** the viewport (`box-sizing: content-box`), a hairline outline, one small tight shadow. No floating animation. No gradient over the bottom of the screen.
- Top-align the phone with the settings card. Space the two evenly: the same gap left of the card, between the two, and right of the phone. The phone's column is exactly as wide as the phone, so take the available width from the split container, not from that column.

### What it shows

| Step or tab | Screen |
|---|---|
| Email or Consent, with placement *before the results* | The gate screen |
| Loading | The loading screen |
| Everything else | The results page |

`main` already maps it this way (`RG:245-250`). Add a dashed hint on the Email and Consent tabs when there is no email capture.

### Scrolling

- Arriving on a step or tab scrolls the phone to the region that step owns. Scroll on arrival, on opening a tab and on touching a control — **not on every render**. `main`'s effect has no dependency array (`GP:99-132`), so it re-rings and re-centres constantly.
- **Step 4 scrolls to the bottom.** The shelf renders under the matches. With nothing picked, a dashed purple placeholder sits right there — "No products picked yet, so nothing shows under the matches." — and the phone scrolls to it. On `main`, nothing renders and nothing scrolls while the shelf is off.
- **Adding products, or raising the count, scrolls to the bottom again**, so what was just added is on screen.
- The Overview scrolls to the top.
- The frame is CSS-scaled, so `scrollIntoView` lands wrong: client rects are in scaled pixels and `scrollTop` is not. Walk `offsetTop` and set `scrollTop`.
- When a region and its empty-state hint share a `data-jump`, scroll to the real region.

### Highlight rings

- **Arriving** on a step or tab draws one hairline ring — 1.5px at 30% — around the region that step owns.
- **Touching a control rings only the element it changes**, sharply, and nothing else. The section ring is not repainted. Turning something *off* rings nothing: its element is gone.
- Both hold for **one second**, then fade over 0.45 s. `main` holds for 2.6 s (`GP:129`).
- Put the transition on `[data-part]` as well as `[data-jump]` (`quizocalypse.css:10068`).
- **Parts are per element.** Split `main`'s shared `consent` part into `mkt`, `sms` and `terms`, and drop `stars` and `verified`. The full list: `hl why gcopy gform gskip mkt sms terms grid price cart desc addall capture offer xhead xprods`. On the Consent tab, the marketing row and typing its text ring the marketing box; both terms rows ring the terms box or line; SMS rings the phone field and its box — never the small print. Give ringed rows padding with an equal negative margin, so the ring has air and the text does not move.

### Clicks

**The phone never changes the step.** Only Back, the forward button and the Overview's rows do. A click on a region the *current* step owns opens that tab: on step 3, the form opens Email and the loading screen opens Loading. Every other region does nothing and is not styled as clickable — no pointer, no hover ring. On the Overview the phone is inert. Replace `jumpFromPreview` (`RG:311-318`) and the blanket `cursor: pointer` (`quizocalypse.css:10068`).

### Also remove

The "Extra picks" tag chip (`GP:407`), the "with code" suffix (`GP:277`), the offer and reveal empty-hints (`GP:346-355`), and every `Unwired` tag once its reader has landed (§2).

Keyboard focus rings are for the keyboard only. WebKit paints `:focus-visible` after a mouse click on a button, which left a purple box on the Page Copy row. The mock draws focus rings only while `html.kbd` is set: Tab sets it, any pointer press clears it.

## 12 · The discount, end to end: Shopify → the page → the cart

Package H. **None of this is built.** The editor in §8 is the target. This is what makes every setting in it real: created in Shopify, shown to the shopper, applied to the cart.

### Today: five code paths that never meet

| Path | Reads | When the code is made | What the shopper gets |
|---|---|---|---|
| Per-shopper reward | `engagement.reward` — **not** the `discount_config` the guided editor writes | When the shopper clicks "Reveal my reward" (`RewardReveal` → `POST /reward`). One Shopify discount per shopper. | The code, the value and "Expires soon." No expiry time, minimum or scope — and the code is **never applied to the cart**. |
| Shared code | `discount_config` | At publish, for any quiz with a discount on (`ensureQuizDiscount`) | Legacy quizzes: a banner and struck prices. **Decider quizzes: nothing** — the results page never reads it. |
| Existing code | `rec_page_settings.global.incentiveCode` | Never | The typed text, carried in the cart link |
| Coupon block | A string the merchant types | Never | The string, with a copy button |
| Referral codes | `engagement.referral` | In the `orders/create` webhook: two `createCodeDiscount` calls per grant (`referralGrant.server.ts:143-155`) | `QZG-` and `QZF-` codes by email. Out of scope here, but it is the same one-discount-per-code pattern. |

Of `DiscountConfig`'s 30 keys (`quizSchema.ts:1266-1329`), 13 have a server reader. **None of the 17 the guided editor added do**: `code_mode`, `code_prefix`, `static_code`, `existing_code`, `expiry_*`, `scope`, `combines`, `purchase`, `recurring_limit` and the rest. `discount.server.ts` sends `title`, `code`, `startsAt`, `customerSelection`, `customerGets`, `appliesOncePerCustomer`, `usageLimit`, `endsAt`, `minimumRequirement`, and `destination: { all: true }` for free shipping. `combinesWith` has zero hits in `app/`: every discount the app has ever created combines with nothing.

**The target is one source of truth.** `discount_config` drives the Shopify discount, what the page says, and the Klaviyo event. The mint reads it, not a second config in `engagement.reward`.

### 1 · Upgrade the Admin API first

`app/shopify.server.ts:22,65` pins `ApiVersion.January25`. Shopify retired 2025-01 on 2026-01-16 and now answers with its oldest supported version. Move to **`2026-04`** — `ApiVersion.April26`, the newest the installed `@shopify/shopify-api` 13.0.0 exposes. Change `shopifyConnect.server.ts:26` and `extensions/quizocalypse-block/shopify.extension.toml:6` with it.

- `2026-04` is the first version with `tags` on discounts — the only way to label a bucket without putting bookkeeping in `title`, which customers can see.
- From `2025-10`, `context` replaces the deprecated `customerSelection`, and takes `{ all: "ALL" }` — an enum, not a boolean.

### 2 · Create it the way Built for Shopify requires

Requirement 5.5.3, in Shopify's words: *"Your app must use the `discountRedeemCodeBulkAdd` mutation to create any discounts with multiple redeem codes. Instead of creating separate discounts with the same value and different codes…"* Today `/reward` calls `createCodeDiscount` once per shopper — the pattern the rule names. It has to be rebuilt before listing.

**A redeem code carries only its string.** Expiry, items, minimum, limits, purchase type and combinations all live on the parent discount, shared by every code under it.

| Setting | Can many shoppers share one discount? |
|---|---|
| Type, value, once-per-order, rate cap, countries, minimum, limits, purchase type, recurring limit, combinations, name | Yes |
| Collections or products the merchant picked | Yes |
| Doesn't expire · On a date | Yes |
| **Hours after the quiz** | **No** — `endsAt` belongs to the discount |
| **What we recommend** | **No** — the product list belongs to the discount, 100 products at most |

The build:

1. **One discount per key.** The key is the quiz plus a hash of every shared setting; plus the result's product set when Applies-to is "what we recommend" — in practice one per result; plus an **hourly bucket** when expiry is relative.
2. **Relative expiry means hourly buckets.** A bucket's discount gets `endsAt = the end of that hour + N hours`. The shopper is shown that exact time, so a "24 hour" code lasts 24 to 25 hours. The editor's read-back already says so.
3. **Issue from a pool.** Creating a discount needs a first code, and that code is live at once. After it, keep a pool filled with `discountRedeemCodeBulkAdd` — 250 codes per call, asynchronous: poll `discountRedeemCodeBulkCreation(id)` or subscribe to `discounts/redeemcode_added`. Hand codes out atomically from the database and refill in the background. Store each code's `DiscountRedeemCode` id.
4. **Never edit a discount once codes are out.** `discountCodeBasicUpdate` rewrites the terms of every code already given. A settings change is a new hash, so a new discount.
5. **Clean up.** After a bucket expires, delete its unassigned codes with `discountCodeRedeemCodeBulkDelete`. The store-wide cap is 20,000,000 codes and no app can raise it.
6. **Once-per-customer across codes is ours to enforce.** Shopify counts usage per code, so two codes under one discount do not share `appliesOncePerCustomer`. Dedupe by email.
7. **Shared code:** one discount at publish, created with the code the merchant typed — not a random `QUIZ-` one. **Existing discount:** create nothing; read it with `discountNode(id:)`.

Send every field in §8's tables: `combinesWith`, the purchase flags, `recurringCycleLimit`, `maximumShippingPrice`, `destination`, `appliesOnEachItem`, `title`, the prefix, and `tags`.

Limits that shape this:

- An order takes at most five product or order codes, and one shipping code.
- The 25-discount cap applies to **automatic** discounts only.
- A create costs about 12 GraphQL points — roughly eight creates a second on a standard plan. A 250-code bulk add costs about the same as one create.
- Shopify rejects both minimum types together (`MINIMUM_SUBTOTAL_AND_QUANTITY_RANGE_BOTH_PRESENT`), both purchase flags false (`APPLIES_ON_NOTHING`), and a recurring limit above 1 on a discount that does not apply to subscriptions.

### 3 · Mint when the shopper earns it

- **Email before the results, or unlock on the results page:** on email submit. That is the moment the address, and the reason for the code, exist. Today the capture posts only to `/captures`, and the reward widget never receives that email (`presetEmail` is never passed), so a shopper who typed it has to type it again.
- **No email capture:** on results reveal.
- Before either: require a real, completed `QuizSession` for the posted `session_id`, and never mint from a preview (defect 4).
- The old "Reveal my reward" widget stays for quizzes that already use `engagement.reward`, behind those guards. A quiz with a guided discount shows the offer bar instead. Never both (§17).

### 4 · What the page shows, and how the code reaches the cart

The page shows what the mock's offer bar shows: **value + noun + terms + code** — "$10 off your order · orders $50+ · expires in 24h · `QUIZ-7K2M9Q`". The route returns only `{code, type, value, expires_at}` today, so return the minimum, the scope and the bucket's real `endsAt` as well. Build the words from the structured fields, not from Shopify's `summary`, whose language is unverified.

| Purchase | How the code is applied |
|---|---|
| One-time | The cart link the app already builds: `/cart/{variant}:{qty}?discount=CODE` (`app/lib/cartLink.ts:37-39`). Today only `incentiveCode` ever reaches it (`DeciderViews.tsx:599-601`). |
| Subscription | Shopify: *"Selling plans don't work with cart permalinks."* Use the AJAX cart — `/cart/add.js` with the selling plan, then `/cart/update.js` with `{ discount: "CODE" }`. The quiz iframe is cross-origin, so both calls belong in the parent-page bridge, `extensions/quizocalypse-block/blocks/quiz.liquid:46-101`, beside its existing `/cart/add.js`. Whether `discount` replaces or appends existing codes is unverified: send every code that should stay. |

Two gaps on the way. The AJAX add-to-cart path never carries a code: `addToCart.ts:37-40` falls back to the permalink whenever a discount exists. And the launcher (`q.$id[.]launcher[.]js.tsx`) has no message listener, so add-to-cart from its modal always ends at the permalink.

**Keep codes out of the public quiz file** — defect 2. A locked offer card over a code anyone can `curl` is theatre.

### 5 · Build order

1. Admin API to `2026-04`.
2. Everything in §4.
3. Map `discount_config` into the create call.
4. Rebuild the per-shopper mint on keyed discounts, pooled codes and hourly buckets.
5. Mint on email submit or reveal; return the full facts; apply the code on both cart paths.
6. The Klaviyo event (§13).
7. Subscribe Profiles, once a marketing tick exists to act on (§9).

## 13 · Klaviyo

Package I. **Nothing sends a code to Klaviyo today.** The one Klaviyo client, `app/routes/q.$id.integration.tsx`, runs only from an *integration* node. A decider quiz reaches that node before any email exists, and publish now blocks that arrangement (`quizValidation.ts:113-119`). It also uses a key pasted per quiz, the retired revision `2024-02-15`, and a list-add body Klaviyo's schema rejects. Leave it alone; build this beside it.

**It is blocked on a shop-level Klaviyo connection, which does not exist on `main`.** The Integrations framework — connections page, credential storage, health states — is separate, unfinished local work with its own design notes. Its open decision E1 is key-first or OAuth-only. A per-quiz key cannot reach the mint.

Then: **one event, sent from the mint, after the code exists.** Fire-and-forget, so it never delays the reveal. Never from the "already issued" branch.

- `POST https://a.klaviyo.com/api/events`, with headers `Authorization: Klaviyo-API-Key …`, `revision: 2026-07-15`, `Content-Type: application/vnd.api+json`.
- Metric **`Earned Quiz Reward`** — a fixed constant, because Klaviyo flows bind to the exact name.
- `unique_id` is the reward row's id, so a retry never double-sends.
- No `value`: a discount is not revenue.
- Rate limit 350 a second burst, 3,500 a minute. Back off on `429`.

Properties — the same facts the page shows, flat snake_case so a template can write `{{ event.discount_code }}`:

| Property | Source |
|---|---|
| `discount_code` | the issued code |
| `discount_type`, `discount_value`, `discount_value_text` | type and value; the text formatted in the shop's currency — "$10 off your order" |
| `discount_applies_to`, `discount_applies_to_text` | the scope, named — "Best sellers" |
| `discount_minimum_subtotal` or `discount_minimum_quantity`, and `discount_minimum_text` | the minimum, when set |
| `discount_expires_at` (ISO, UTC), `discount_expires_text` | the bucket's real `endsAt`, not "24h" |
| `discount_url` | `https://{shop}/discount/{code}?redirect=/` — saves the code to the shopper's cart |
| `quiz_id`, `quiz_name`, `quiz_results_url`, `result_id`, `result_name` | the quiz and the shopper's result |
| `recommended_products` (id, title, url, image_url, price), `top_product_title` | the matches, from the session and the published `product_index` |

Leave out any key with no value. Keep the code on the **event**, not the profile: a profile property is overwritten by the next quiz, and a delayed flow step would then show a newer, or expired, code.

- **Consent.** A profile created by an event is *Never subscribed*. Only the Subscribe Profiles endpoint subscribes anyone. Call it only when the shopper ticked the marketing box — `subscriptions.email.marketing.consent: "SUBSCRIBED"`. Build the reward email as a **marketing** flow: transactional status needs Klaviyo's approval and forbids marketing content.
- **Tell the merchant two things in setup.** Turn Smart Sending **off** on the reward email: it skips anyone emailed in the last 16 hours, and skipped emails are not resent. And do not schedule a reminder at the hour the code expires.
- **Why not Klaviyo's own Shopify coupons:** they create a *different* code at send time, so a shopper who also saw one on the page would hold two. They fit only an email-only offer, or a standalone workspace where `/reward` answers `no_shopify`.

## 14 · SMS numbers: hand them on, never keep them

Package J. The owner's call: *"We probably don't want to keep that data."* Onboarding never asks the merchant to connect anything — the SMS switch always works and says integrations come later. The goal of this step is a best-practice build, fast.

### The rule

A number is handed to a destination that can take it **during the capture request**, or it is dropped. No queue, nothing to encrypt, because nothing is stored. Per capture, record only: opted in or not, when, which wording version was shown, which destinations were tried and whether each took it — **never the number**. That still powers an opt-in count and a delivery log. The price, stated plainly: if a destination is down at that moment, after two quick retries that shopper's opt-in is lost.

### Destinations

| Destination | What it takes | Shopify approval | Ships |
|---|---|---|---|
| **Klaviyo** | The shop-level connection (§13) with `lists:write`, `profiles:write`, `subscriptions:write`; Subscribe Profiles with `subscriptions.sms.marketing.consent: "SUBSCRIBED"` and the phone in E.164; SMS set up in the merchant's own Klaviyo account | **None.** The number comes from our own form, not from a Shopify API. | First |
| **Shopify customers** | Find the customer by email; create or update with the phone; then `customerSmsMarketingConsentUpdate` (`SUBSCRIBED`, `SINGLE_OPT_IN`, `consentUpdatedAt`) | **Two:** the `read_customers` and `write_customers` scopes, and Shopify's **protected customer data** review for Phone and Email (Level 2) | After the review passes |

**No reinstall is needed.** Declare the two scopes as `optional_scopes` in `shopify.app.toml` — today it lists only `read_inventory,read_orders,read_products,read_themes,write_discounts`. Request them when a merchant turns the Shopify destination on: `shopify.scopes.request([...])` in the embedded app, a redirect on the standalone studio. Merchants who never use SMS never see a prompt. Protected data can be used on development stores without review, so the Shopify path can be built and tested now; on merchant stores it stays "Coming soon" until the review is approved.

### Guardrails

1. **Destinations live on the Integrations page, not in onboarding.** Each shows its state and its fix — "Klaviyo — Not connected · Connect"; "Shopify customers — Needs your approval · Allow", or "Coming soon".
2. **The phone field reaches the live quiz only while a destination is ready.** No destination, no field, so no number is ever typed. Compute `sms_ready` **at serve time**, in the shared payload seam (`runtimePayload.server.ts`), only for decider quizzes that have `capturePhone` and `consentVersion`, so the byte-pinned quiz is untouched. Until Integrations ships this is always false, which matches the note on the row.
3. **Collect only with the tick.** The box starts unticked; no tick, the phone is not sent. With the tick: parse to E.164 in the browser and again on the server, with the store's country as the default. Refuse anything that does not parse, in the form.
4. **A failed hand-off is dropped and logged, not retried later.** The log has the destination, the time and the error — no number.
5. **A destination that refuses on setup pauses itself.** If Klaviyo rejects a number because SMS is not set up in the account, or the customer scopes are revoked, mark the destination not ready; the field comes off the quiz if nothing else is ready, and the merchant is told. Klaviyo's subscribe call is a background job: read the immediate response for request errors and poll the job for the rest. The job's failure reporting is not documented; verify it against a real account.
6. **No onboarding nag.** SMS on with nothing connected is a normal state, not an Overview to-do. The notice lives on the Integrations page and the dashboard: "SMS is on, but nothing can take numbers yet, so the phone field is off your live quiz."
7. **Where the merchant finds them:** their Klaviyo, and Shopify Customers filtered to SMS subscribers. The Captures table shows "SMS opt-in ✓ — sent to Klaviyo" instead of the number, and the CSV drops the Phone column. The studio Customers hub is already retired — `studio.customers.tsx` redirects to Analytics — but its CSV export still includes Phone (`studio.customers.export.tsx`, `customerHub.server.ts:101-108`).
8. **The numbers already stored** have no consent record, so they cannot be sent anywhere. The recommendation is a one-off migration that deletes them and drops `EmailCapture.phone` (§17).

The confirmation text carriers expect after opt-in is the merchant's SMS platform's job. Wiskr sends no texts.

## 15 · Schema and data changes, in one place

All new fields are `.optional()`.

**`rec_page_settings.global`**

| Key | Type | For |
|---|---|---|
| `consentVersion` | string | Gates the new consent form; recorded with each capture (§9) |
| `captureUnlocksOffer` | boolean | The unlock switch (§7). Cleared when `captureEmail` is false. |
| `extrasSource` | `{ kind, id, label }` | Collection or tag picks for the shelf (§6). Optional feature. |

Stop writing `captureTermsText` and `smsConsentText`; write `smsConsentMode` only as `"checkbox"`. Keep parsing all three. Keep parsing `capturePlacement: "discount"`.

Builder-only state — which steps are done, "Set up later", "the merchant edited the copy" — belongs in `build_session`, which publish already strips. Today all of it is React state and is lost on reload.

**`discount_config`**

| Change | Detail |
|---|---|
| Add `configured` | boolean — "a discount exists" (§7) |
| Add `applies_on_each_item` | boolean |
| Add `max_shipping_price` | number |
| Add `shipping_countries` | ISO codes; absent means all countries |
| Add `existing_discount_id` | the Shopify id behind `existing_code` |
| Extend `applies_to` | add `"recommended"` |
| Widen `recurring_limit` | `.min(0)`; 0 means every payment |
| Percentage ceiling | a `superRefine` keyed on `kind`. Never `.max(100)` on `value`, which `kind: "amount"` shares. |
| Stop writing | `scope`, `auto_apply`, `eligibility`, `segment`, `exclude_sale`, `deliver_on_page`, `deliver_klaviyo`, `deliver_rivo`. Keep parsing them. |

**Baked at publish, decider quizzes only:** `shop_name`. **Added at serve time, only where it applies:** `sms_ready`.

**Database** — hand-authored migrations:

| Table | Change |
|---|---|
| New: keyed discounts | quiz, settings hash, result or product-set key, hourly bucket, Shopify discount id, `endsAt` |
| New: code pool | code, `DiscountRedeemCode` id, discount, assigned session and email, assigned at |
| `QuizReward` | Add the Shopify discount id, the code id, the bucket, the minimum and the scope. It stores only the code string today. |
| `EmailCapture` | `consentEvidence` takes the new keys — it is JSON, so no migration. Add an SMS opt-in flag and a delivery log with no number. Drop `phone` after the owner's call. |

## 16 · Tests

**`main` has no unit test for `ResultsGuided.tsx` or `GuidedPreview.tsx`.** These existing tests and probes assert behaviour this work changes:

| File | Asserts today | Change |
|---|---|---|
| `e2e/design-step-removal-verify.mjs:67-88` | The funnel bar's button is disabled on arrival; the foot button is not | Re-key to the single `seen` gate and the new tooltip |
| `e2e/q3-logic-verify.mjs:281-294` | Foot reads "Continue", back is `‹`, no fallback section on the matches step | Stays green — those labels are kept |
| `app/lib/captureMode.test.ts:33-125` | `patchGuided` and `resolveGuided`, including the `"discount"` placement mapping and the 1600/2000 ms rules | Update for the unlock key, and for the link keys leaving the sparse-clear |
| `app/components/runtime/views/ConsentCapture.test.tsx` | Checkbox gating, notice mode, "SMS required when a phone is typed", `policyHref` | Add the `consentVersion` cases: order, fixed wording, SMS never blocks, `https:` only |
| `app/lib/publicWriteGuards.test.ts:63-77` | `/captures` stores evidence; 400 over 500 characters | Add the new consent keys |
| `app/lib/publicJsonStrip.test.ts` | Two stripped keys, CORS | Add discount-code redaction, credentials, metafields, `/q/:id.embed.json` |
| `app/lib/quizPublish.test.ts:374` | Publish byte-stability | Add the `shop_name` bake and the metafield allow-list |
| `QuestionsWalkthrough.test.tsx:220-257`, `e2e/q3-questions-verify.mjs`, `e2e/q3-capture-verify.mjs`, `e2e/rg-wiring-verify.mjs` | The email screen's writes; evidence for before and inline × checkbox and notice | Update for §10 |
| `previewWidth.test.ts:28`, `DeviceFrame.test.tsx:76` | The 390×745 phone; zoom clamps the scale | Unchanged — the viewport is kept |

**Add:** route tests for `/reward`, which has none; a `RewardReveal` preview case; tests for the new mint — key hashing, bucket maths, pool hand-out under concurrency; a test for the loading gate in `QuizRuntime`, which has none.

**Port from the mock's probes.** Each of the 33 asserts behaviour, not pixels; `master.md` §11 lists them all. They hardcode three things you will want to change: an absolute Playwright import path, `localhost:8842`, and a scratch folder for screenshots. The ones worth turning into app e2e:

| Probe | What it pins |
|---|---|
| `gflow`, `gshot`, `gskip` | The seven-stop walk, titles and labels, Overview row jumps landing on the first tab |
| `gcont` | The funnel bar's button: disabled at every stop before the Overview, live on it, still live after walking back |
| `gfoot` | Back and Continue at one height at every stop, at three window sizes |
| `gclick` | Phone clicks never change the step; step 4 scrolls to the bottom placeholder |
| `gshelf` | Adding extra picks brings the last card into view |
| `ghl` | A touched control rings only its own element; every ring is gone after a second |
| `gnew` | Unlock with no discount: Create lights up, "Set up later" keeps the requirement, creating clears it |
| `gdisc` | The editor: empty list, read-back last, every Save blocker, free-shipping swaps, order by default |
| `gconsent` | Four rows in order, marketing on and unticked, form order, fixed wording, nothing but terms blocks submit |
| `gterms` | Link resolution and every refused link |

## 17 · Decisions still open

**For the owner**

1. **"Required to see results" — the starting value.** The Questions handoff starts it on; this mock starts it off, on the evidence that a soft gate out-converts a hard one (`master.md` §8). Both steps edit one key, so there can be only one answer. The live quiz reads an absent key as *required*. Recommendation: off, written explicitly at creation.
2. **A shopper skips a soft gate while unlock is on.** Recommendation: show the locked offer card on the results page, so they can still unlock (§7).
3. **Phone numbers already stored.** Recommendation: delete them and drop the column (§14).
4. **The old "Reveal my reward" widget.** Recommendation: keep it working for quizzes that use it; a quiz with a guided discount shows the offer bar instead; never both (§12).
5. **The fixed wording in other languages.** Recommendation: English for the first release; hand-translated, counsel-approved wording per locale later (§9).
6. **Product descriptions on the cards.** One editor row per product stops working well before 200 products, and Shopify descriptions are HTML whose first 90 characters are often boilerplate. Either auto-excerpt everything and override by exception, or cut descriptions from the card. The toggle ships off meanwhile.
7. **Subscribe & save** sits in the discount editor but writes results-card state. Left out of the first build (§8).
8. **First run versus returning.** Guided is right the first time. A merchant changing one setting should not walk five steps — consider the rail layout in `nav-variations.html` for return visits.

**For Shopify, before launch**

9. **Will Built for Shopify review accept bucketed and per-result discounts?** Nobody has answered it publicly. If the answer is no, cut "Hours after the quiz" to "On a date" and "What we recommend" to "Specific collections". Nothing else in the editor changes.
10. **The protected customer data review** for Phone and Email gates the Shopify-customers SMS destination (§14).

**For counsel**

11. The two CASL questions in §9, and one sign-off on the fixed wording. Because merchants cannot change it, one review covers every store.

## 18 · Running the mock and its probes

```bash
open docs/design/results-guided/results-guided.html
```

One file, inline CSS and JavaScript, nothing to install. The probes drive it over HTTP:

```bash
cd docs/design/results-guided && python3 -m http.server 8842
```

Then `node probes/gflow.mjs`, and so on, after repointing the Playwright import at the top of each file. All 33 pass against version 45 of the mock.

Sources for the Shopify, Klaviyo and compliance facts above are linked where each is used in `master.md` §4, §8 and §9.
