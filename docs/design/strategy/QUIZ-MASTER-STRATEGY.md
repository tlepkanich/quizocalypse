# Quizocalypse — Master Strategy

The single source of truth for the AI-first product-quiz builder: the ROI thesis, the four
levers, the ship-vs-prove feature matrix, the flow-template library, niche per-industry
playbooks, the A/B-testing discipline, the generator build-reference, and the adversarial
audit — combined into one document, audit-corrected.

_Last updated: 2026-07-15._

**Companions (kept separate — not prose):** the builder-loadable JSON layer in
[`quiz-templates/`](quiz-templates/) (per-vertical `*.template.json`, `_schema.json`,
`build-rules.json`) and the two one-page visuals (`quiz-strategy-visual.html`,
`quiz-build-guide-visual.html`).

> **Three governing rules that bind everything below.**
>
> 1. **Every lift number — including ours — is only believable behind an A/B holdout.** Read
>    adversarially, this whole corpus is a set of *testable hypotheses*, not proven results.
>    Plan to a credible **5–15%** band and prove the rest (Part 6).
> 2. **Credibility is tier-graded.** Tier A = independent / academic / regulatory /
>    court-verified; Tier B = vendor benchmark (directional, selection-biased); Tier C =
>    single-brand case study (illustrative only). A "quiz-takers convert Nx" figure is
>    **selection**, never causal lift.
> 3. **Newest-dated global-settings definition wins** — permanently. When an older screen
>    conflicts with a newer definition, the newer governs; update the older to match.

## Contents

1. **The thesis** — a quiz is a value-exchange engine (three loops, honest mechanics)
2. **The four ROI levers** — seamless · interactive & on-brand · AI · personalize
3. **High-ROI functionality** — the ship-vs-A/B-prove feature matrix
4. **Flow templates by vertical** — the reusable library (JSON in `quiz-templates/`)
5. **Niche per-industry playbooks** — flow · benchmark reality · compliance landmine (~20 verticals)
6. **The A/B-testing discipline** — how to prove any of it
7. **The build reference** — how the generator authors a quiz
8. **The adversarial audit** — what held, what was corrected, what was retracted
9. **The reveal & the reward** — best practices for the results moment (the "calculating"
   animation, result-page design, discount timing/framing, price display) + an execution
   build-checklist (§9.7)

> **The meta-finding (Part 8, applied throughout).** The docs are so rigorously
> self-skeptical that, read adversarially, they establish not that quizzes *drive*
> incremental revenue but that no credible causal number for it was found. That is more
> honest than the vendor ecosystem they critique — the correct posture toward the whole set
> is "unproven, testable hypotheses," and the corrections in Part 8 are already reflected in
> Parts 1–7 below.


---

# Part 1 · The thesis — a quiz is a value-exchange engine

Deep-dive on ROI-driving, Shopify-compliant, low-weight functionality for the quiz —
grounded in behavioral science, real conversion data, and current law/platform rules.
Every idea is filtered through three tests: **Does it move an ROI loop? Is it honest
(would it still work if you explained it to the shopper)? Is it compliant & light?**

> ### ⚠️ Read the numbers skeptically (this governs everything)
> Almost every "quiz-takers convert at 25×" stat is **selection bias**: people who
> *choose* to start a quiz are already higher-intent, so most of the "lift" is
> self-selection, not the quiz. Vendor case studies (25× ROI, 96× ROI, +296%) have
> **no holdout/A-B counterfactual** — treat them as marketing. The honest planning
> numbers, from large-sample/third-party data:
> - **E-commerce quiz reality: ~55–65% completion, ~38–40% email capture** (Interact,
>   80M+ leads) — *not* the 80%+ vendors quote, and **flat since 2013**.
> - **Quiz drop-off is front-loaded**: completion ~89% at 10 questions → ~79% at 40
>   (SurveyMonkey, n=100k). Question #4 is expensive; #12 is cheap. **Cut early questions.**
> - The specific play you asked about — *"answer more after the rec to unlock a better
>   discount"* — has **no credible external number**. It's directionally sound (below),
>   but **validate it with an in-house holdout**, don't trust a vendor figure.

---

## 0. The thesis — a quiz is a value-exchange engine

A product quiz isn't a form; it's a **trade**. The shop gives *personalization, a real
reward, and a genuinely good pick*; the shopper gives *attention, zero-party data,
marketing consent, and a purchase*. ROI comes from widening three loops:

1. **Complete** — attention → answers. Lever: friction ↓, momentum ↑.
2. **Convert** — answers → purchase. Lever: a trusted, *earned* recommendation + reward.
3. **Continue** — the rec unlocks *more* data, consent, retention, AOV. **The most
   ignored loop and the biggest ROI** — and the honest truth is **zero-party data is
   worth roughly what your email/SMS flows do with it; near-zero if it sits unused.**

Judge every feature by which loop it moves. If it moves none, it's a gimmick.

## 1. The honest-mechanic principle (borrow the mechanism, reject the manipulation)

TikTok and casinos are sticky because of real cognitive mechanisms. We take the
**mechanism** and drop the **exploitation**. The one-line test (Brignull / FTC): a
design is honest if it works *without creating a false belief or concealing
information* — i.e., **it would still work if you explained it out loud.**

| Sticky mechanic | Dark version (avoid) | Honest analog (use) | Passes the test? |
|---|---|---|---|
| Variable-ratio reward | Gambling; near-miss; "you won nothing" | **Mystery discount where *everyone* wins** | ✅ everyone truly wins |
| Infinite scroll | Endless, no exit, dopamine trap | **Auto-advance, one screen/question, finish line** | ✅ has a real end |
| For-You personalization | Fake/manipulative profiling | **Result genuinely reflects their answers** | ✅ real personalization |
| Progress / goal-gradient | Fake "40% done" on Q1 | **Honest bar + real head-start (intro = a step)** | ✅ head-start is real |
| Scarcity / urgency | Fake/reset timers, fake stock | **Real expiry on a real reward only** | ✅ deadline is real |
| Commitment escalation | Bait-and-switch to a huge ask | **Easy first Q → deeper later as value exchange** | ✅ asks are genuine |

**Dark patterns to never ship** (enforceable under US FTC §5 and, in the EU, the UCPD +
GDPR — *not* DSA Art. 25, which binds platforms not merchants):
fake/reset countdowns, fabricated "only 2 left" / "3 viewing," **near-miss** reward
reveals, **losses-disguised-as-wins**, confirmshaming ("No thanks, I hate discounts"),
pre-checked or bundled email+SMS consent, obstructed opt-out.

## 2. Area 1 — Question flow

**Scroll / swipe — the direct answer: do NOT build infinite scroll.** A quiz is
*goal-directed* (answer → reach a result); infinite scroll is *browse-mode* (passive,
no end) and it deletes the completion payoff — goal-gradient, endowed progress, IKEA
completion, Zeigarnik closure **all require a defined finish line.** UX research is
explicit that goal-oriented tasks "struggle with infinite scrolling... without clear
stopping points users feel lost." **Steal TikTok's micro-interactions, not its
macro-structure:**
- **One question fills the screen** — the single most portable FYP mechanic (full
  attention, flow). The multi-step format itself is a lever: roughly **~3× completion**
  vs single-page (~13.9% vs 4.5% — *vendor lead-form data, Tier B, applied by analogy*).
- **Auto-advance on single-select** (tap → smooth transition) — but the *controlled*
  evidence shows **no significant completion benefit** and ~45% *fewer answer changes*
  (a data-quality downside), so treat it as an A/B experiment, default-OFF where
  accessibility matters. (Keep manual Next for multi-select/free-text.)
  _(Corrected 2026-07-14 — an earlier "12–13 vs 8–9 items/min, fewer break-offs" claim
  was unsourced/fabricated; see Part 8.)_
- **Swipe-back** gesture + **instant feedback** on every tap. No dead air.

**Length:** keep the core quiz to **~5–7 questions / 60–90s** — drop-off is front-loaded,
so cut early questions ruthlessly. Push deeper questions to the *post-rec* loop for the
willing (§4). The tension with the IKEA effect (more effort → more valued result) is
resolved by *where* you spend the questions, not how many.

**Momentum levers (all CSS/light-JS, zero added weight):**
- **Endowed progress** — never start at 0; the intro *is* step 1. Nunes & Drèze's
  car-wash field study: a "2 free of 10 stamps" card redeemed **34% vs 19%**. Keep the
  head-start honest (fabricating "40% done" on Q1 is a dark pattern).
- **Goal-gradient** — the bar visibly accelerates near the end ("1 question left").
  Caveat: bars *backfire* if they show bad news early, so front-load progress + stay short.
- **Commitment & consistency** — open easy and identity-affirming; escalate. Small yes → bigger yes → email → purchase.
- **Open loop (Zeigarnik)** — the result is *waiting* ("your match is taking shape"); pairs with a save-and-resume / abandoned-quiz email that closes *that specific* loop (not spammy nags).

## 3. Area 2 — Recommendation page (the peak-end moment)

Retrospective judgment of the whole quiz is driven by its **peak and its end** (duration
is discounted) — the rec page is both. Design it as a *reveal*, not a grid dump.

- **Make it feel earned** — "Based on your 6 answers…" The IKEA/effort effect turns
  invested effort into perceived value *only if the quiz completed* — another reason
  completion is everything.
- **Explain the *why*** — one confidence line per pick. Thin product info is a top quiz
  conversion killer. Trust > flash.
- **Curate hard — 1 hero + a few alternates, never 12.** The quiz's job is to *collapse*
  the catalog. Iyengar & Lepper's jam study: **6 options converted 30% vs 3% for 24**
  (the effect is context-dependent, so the reliable rule is "narrow the final set").
- **Social proof** (rating + review count) and **one-click add-to-cart + the reward**.
  The honest **mystery-discount reveal lands here** as the peak payoff — real expiry,
  disclosed terms.
- **Reciprocity** — you gave a genuinely useful result *first* (Regan: a free soda ~2×'d
  compliance; free-gift mailers 18%→35%), so the ask now feels fair. Prefer **non-margin
  rewards** (free shipping, sample, early access, a guide) where they work, so every quiz
  isn't a coupon.

## 4. Area 3 — After the recommendation (biggest ROI, most-ignored loop)

**"More questions after the rec that unlock the discount" — the direct answer: yes,
this is the strongest idea, as an *optional* value exchange.** The evidence supports the
*timing* strongly even though the exact trade lacks an external number:

- **The post-purchase / post-result moment is the best continuation window there is:**
  post-purchase surveys see **~45%+ response vs ~10–15% for email surveys** (KnoCommerce)
  — the customer is at peak engagement, and you're spending margin on someone who already
  converted (lower risk).
- **The ROI logic:** trade a *marginal* discount for high-value **zero-party data +
  email/SMS consent + intent**. The data + owned retention channel typically out-value the
  margin, and the discount only costs you if they engage *and* buy. Effort makes the
  reward *earned* → valued more, less "cheap coupon."
- **Do it as progressive profiling** — 1–3 questions per step, each ask justified by
  value ("answer 3 more, we'll refine your picks + unlock a bonus"). **Optional**, clearly
  rewarding, never bait-and-switch.
- **Honest caveat:** no credible external study quantifies the extra-data value vs the
  discount margin. **A/B test it in-house with a holdout** — this is the single most
  worthwhile experiment in the whole strategy.

**Other post-rec loops (ranked in §5):** save/notify (email + restock/price-drop consent),
refine-my-results (more data + control), **build-the-routine / complete-the-set**
cross-sell (AOV lift ~20–40% planning range; works because it solves a *complete*
problem), and a **shareable result card** (the one genuinely TikTok-shaped play —
identity + organic reach).

## 5. ROI prioritization matrix

Rank = **(loop impact) × (honesty) ÷ (cost: margin + dev + page-weight)**.

| Play | Loop | Cost | Verdict |
|---|---|---|---|
| One-Q-per-screen + auto-advance + transitions | Complete | Very low | **Do first** — biggest completion lever, ~zero weight |
| Endowed progress + goal-gradient bar | Complete | Very low | **Do first** |
| "Why this pick" + social proof, curated 1–3 recs | Convert | Low | **Do first** |
| One-click add-to-cart + reward reveal | Convert | Low–med (margin) | **Do first** |
| Save-results email capture (proper consent) | Continue | Low | **Do first** |
| **Post-rec progressive profiling → unlock reward** | Continue | Med (margin, if bought) | **The differentiator — build + A/B test** |
| Mystery/variable discount (everyone wins) | Convert | Med (margin) | Do, gated on completion + honest |
| Build-the-routine / complete-the-set | Continue (AOV) | Med (dev) | Phase 2 |
| Shareable result card | Continue (reach) | Med (dev) | Phase 2 |
| **Spin-to-win wheel** | Convert | Med + **legal + list-quality + margin** | **Skip** — wins *opt-in* (vanity), loses list quality (fake emails), cheapens brand; vendors themselves warn |
| Autoplay video per question | — | **Heavy (weight)** | **Skip** |
| Infinite / endless scroll quiz | — | Fights the model | **Skip** |

## 6. Compliance guardrails (hard rules)

**Discounts (Shopify).** Use the **GraphQL Admin Discounts API** (not deprecated REST
PriceRules) or **Shopify Functions**; bulk-add unique codes async (**≤100/call, 250 from
API 2026-04**) and poll. Mystery/variable amounts are fine at the platform level — mint a
distinct code per outcome, or compute a variable discount at checkout via Functions
(sidesteps code pools). *The legal risk of "mystery" is not Shopify — it's sweepstakes law
(below).*

**Marketing consent.** Email and SMS are **separate channels** — write each via
`customerEmailMarketingConsentUpdate` / `customerSmsMarketingConsentUpdate` with **state,
opt-in level, timestamp, and collection location**. **Distinct, unchecked opt-ins per
channel — never bundled into one "I agree," never pre-checked.**
- **US SMS (TCPA) is the highest-liability surface:** *prior express written consent*
  required, **$500–$1,500 per message**, must disclose and state consent isn't a purchase
  condition. The **FCC "one-to-one" rule is dead** (vacated Jan 2025 — don't build to it).
  Honor opt-out (any reasonable form) **within 10 business days** (rule in effect since
  Apr 2025).
- **US email:** CAN-SPAM (working opt-out + postal address); CCPA/CPRA disclose collection.
- **EU/UK (GDPR + ePrivacy):** consent freely-given/specific/informed/unambiguous;
  **pre-ticked boxes invalid** (*Planet49*); keep a timestamped record; soft opt-in is
  narrow (existing customers, similar products).
- **Canada (CASL):** express opt-in, keep records **3 years**, penalties to **C$10M**.

**Gamified rewards & sweepstakes law.** Prize + **Chance** + Consideration = illegal
lottery, and *providing data used for marketing can itself be consideration in some
states*. **Remove the chance:** only a **fixed/deterministic** reward — everyone gets the
*same* guaranteed discount, or "your quiz result = your reward" — reliably falls *outside*
the lottery definition. **A random-amount "mystery" reveal reintroduces chance** — everyone
winning *something* does not cure it — so a random-value reveal gated on email can carry
**both** chance and consideration → a regulated lottery in stricter states. There is **no
codified "safe harbor"**; the analysis is **state-by-state**. If you keep true randomness,
you need a "No Purchase Necessary" alternate entry + posted official rules + odds.
_(Corrected 2026-07-14 — the earlier "(amount may vary) → not a lottery / safe harbor"
framing was wrong; see Part 8.)_

**Dark patterns.** **US FTC §5** (and, in the EU, the **UCPD + national consumer law +
GDPR**) prohibit manipulative design regardless of the (currently vacated) FTC
click-to-cancel rule. *(DSA Art. 25 binds "online platforms," not a single merchant; the
EU Digital Fairness Act is a ~Q4-2026 proposal, not yet law.)* **Do-not-ship:** fake/reset
timers, false scarcity, confirmshaming, pre-checked/bundled consent, obstructed opt-out.

## 7. Page-weight guardrails (hard platform gate + budgets)

- **Built-for-Shopify gate: the app must not drop a storefront's Lighthouse score by
  more than 10 points.** This is the measurable publication gate.
- **Budgets:** **< 10 KB JS and < 50 KB CSS per page** (Shopify's own guidance); minified
  JS bundle ideally **≤ 16 KB**; **defer non-critical JS until interaction** — load the
  quiz *on interaction*, not on every page.
- **Core Web Vitals:** LCP ≤ 2.5s, **CLS ≤ 0.1**, INP ≤ 200ms. Third-party JS is the #1
  CWV culprit on Shopify (~50–150 KB/app; >8 scripts → median mobile LCP > 3s).
- **Protect CLS ≈ 0** — reserve every image's aspect box (the 1:1 rule from the image
  guardrails); injected DOM must not shift content.
- **Why it's ROI, not hygiene:** Deloitte's "Milliseconds Make Millions" — a **0.1s**
  mobile-speed gain lifted retail **conversion +8.4% and AOV +9.2%.** Speed *is* a
  conversion lever, so the gamification must be CSS + light JS, never a heavy engine. Our
  runtime is already server-free after load with inline `--qz-*` theming — protect that.

## 8. Sources

**Behavioral / attention mechanics**
- Multi-step vs single-page completion (Formstack 650k+): https://quizify.io/blog/multi-step-forms-vs-single-page-forms · Auto-advance survey study: https://www.surveypractice.org/article/6381
- Endowed progress (Nunes & Drèze; Kivetz goal-gradient): https://home.uchicago.edu/ourminsky/Goal-Gradient_Illusionary_Goal_Progress.pdf · progress-bar backfire: https://irrationallabs.com/blog/knowledge-cuts-both-ways-when-progress-bars-backfire/
- Zeigarnik / resumption: https://en.wikipedia.org/wiki/Zeigarnik_effect · Foot-in-the-door (Freedman & Fraser 1966): https://en.wikipedia.org/wiki/Foot-in-the-door_technique
- Peak-end rule (Kahneman/Redelmeier): https://en.wikipedia.org/wiki/Peak%E2%80%93end_rule · Choice overload (Iyengar & Lepper jam study): https://faculty.washington.edu/jdb/345/345%20Articles/Iyengar%20&%20Lepper%20(2000).pdf
- IKEA effect (Norton/Mochon/Ariely): https://www.hbs.edu/ris/Publication%20Files/11-091.pdf · Reciprocity (Regan): https://news.wpcarey.asu.edu/20061206-gentle-science-persuasion-part-two-reciprocity · Loss aversion / prospect theory: https://www.nngroup.com/articles/prospect-theory/
- Variable reward / spin ethics: https://claspo.io/spin-the-wheel-popup/ · Near-miss brain circuitry (dark): https://pmc.ncbi.nlm.nih.gov/articles/PMC2658737/ · Infinite scroll fights goal-directed tasks: https://www.justinmind.com/blog/infinite-scroll-design-best-practices-and-examples/ · TikTok variable-reward mechanism: https://sites.brown.edu/publichealthjournal/2021/12/13/tiktok/

**Conversion data (weight large-sample; distrust single-brand)**
- Realistic e-comm benchmarks (Interact 80M leads, 55.5%/37.6%): https://www.tryinteract.com/blog/quiz-conversion-rate-report/ · Length drop-off (SurveyMonkey n=100k): https://www.surveymonkey.com/curiosity/survey_questions_and_completion_rates/
- Length/email-leak playbooks (RevenueHunt, Okendo): https://docs.revenuehunt.com/customer-success/reduce-dropoff/ · https://support.okendo.io/en/articles/9077960-quizzes-conversion-rate-optimization
- Completion-gated discount reveal: https://revenuehunt.com/product-quiz-discounts/ · Spin-to-win downsides (Privy/Wisepops, vendor-acknowledged): https://www.privy.com/blog/spin-to-win-popup-strategy
- Post-purchase survey response (KnoCommerce 45%+): https://knocommerce.com/blog/survey-response-rate/ · Progressive profiling: https://zapier.com/blog/progressive-profiling/ · ZPD consumer preference (Okendo 58%): https://okendo.io/resources/blog/zero-party-data-and-email-personalization/

**Compliance & performance**
- Shopify Discounts API (bulk add): https://shopify.dev/docs/api/admin-graphql/latest/mutations/discountredeemcodebulkadd · Consent mutations: https://shopify.dev/docs/api/admin-graphql/latest/mutations/customerSmsMarketingConsentUpdate
- TCPA SMS consent + $500–1,500/msg: https://www.termsfeed.com/blog/sms-marketing-consent/ · FCC 1:1 rule vacated: https://www.wiley.law/alert-UPDATE-11th-Circuit-Vacates-FCCs-One-to-One-TCPA-Consent-Rule · TCPA opt-out (Apr 2025): https://www.bclplaw.com/en-US/events-insights-news/the-tcpas-new-opt-out-rules-take-effect-on-april-11-2025.html
- GDPR pre-ticked invalid (Planet49): https://www.osborneclarke.com/insights/planet49-cjeu-rules-consent-requirements-cookies · CASL: https://crtc.gc.ca/eng/com500/guide.htm
- Sweepstakes / lottery test + safe harbor: https://fasthofflawfirm.com/blog/sweepstakes-contests-illegal-lotteries · https://www.olshanlaw.com/sweepstakes-law-basics
- Dark patterns — EU DSA Art. 25: https://dsa-library.com/article/25/ · FTC junk-fees rule (May 2025): https://www.federalregister.gov/documents/2025/01/10/2024-30293/
- Shopify perf gate + budgets: https://shopify.dev/docs/apps/build/performance · CWV + conversion (Deloitte 0.1s → +8.4%): https://www.flatlineagency.com/blog/shopify-core-web-vitals-conversion/

_Last updated: 2026-07-14._


---

# Part 2 · The four ROI levers

Deeper pass on four levers on top of the Part 1:
**seamless · interactive & on-brand · AI for the shopper · personalization.** Same
tests as Part I — moves an ROI loop? honest (works if you explain it)? compliant &
light? — plus the same skeptical read on vendor numbers.

_Last updated: 2026-07-14._

---

## Lever 1 — Seamless (remove every gram of friction)

The biggest seamless win is fixing the biggest leak. The hard anchor (Baymard, 50
studies, ~70% cart abandonment): **forced account creation drives ~19% of abandonment**
(tied 3rd–4th; extra costs lead at ~39%). Any mandatory wall before value is a major leak.
_(Corrected 2026-07-14 from an earlier survey wave that read 26%/#2 — see
Part 8.)_

- **Results-first, gate-to-save (flip the toll into a benefit).** The peak-motivation
  moment to ask for email is **on the transition into the result, after they've
  invested answers — never mid-quiz, never before Q1** (mid-quiz asks inflate drop-off
  with no lead-quality gain). Show the recommendation, then capture as *"save / send me
  my results (+ the reward)."* Ship **results-first with a *soft/optional* gate as the
  default**; make a hard gate an A/B variant, not the baseline. (Vendor opt-in
  magnitudes of 30–55% are selection-biased — the *direction* is sound, instrument your
  own per-question drop-off.)
- **Skip the gate entirely for logged-in customers.** If Shopify's `customer` Liquid
  object is present you already hold email + marketing consent (sessions persist up to
  365 days) — so the biggest leak simply *disappears* for your highest-intent segment.
  Pure win, platform-native.
- **Carry the reward to checkout in one tap — this is a concrete Shopify mechanism, not
  a wish.** The "Shop your match" CTA is a **discount permalink**:
  `store.com/discount/CODE?redirect=/cart/VARIANT_ID:qty` — one click **adds the product
  *and* arms the discount**, which then **auto-applies at checkout with no code entry**.
  Limits: one code per link, must be active, one code at a time. More robust across
  cookie-loss / cross-device: stamp a **cart attribute** and target it with an
  **automatic discount / Discount Function** (no code at all).
- **Surface Shop Pay / express checkout *on the result page*, not just at checkout.**
  It's the largest single continuity lever — even mere presence lifts ~5%, and returning
  customers convert far higher; the pre-armed discount holds through the express flow.
  (Shopify's headline "up to 50%" is a commissioned study — optimistic; the *direction*
  is well-supported by Baymard's "checkout too long" = ~18% abandonment.)
- **Don't re-ask; resume prefilled.** Persist quiz progress + result under a resumable
  token keyed to the customer/cookie; an **abandoned-quiz email replaying the
  near-complete result + a one-time code** recovers high-intent sessions from the ~70%
  default loss.
- **No spinners — perf *is* seamlessness.** ~**+1% conversion per 100ms** saved (Mobify;
  Deloitte 0.1s → +8.4%; a full CWV fix drove +33% conversion at Rakuten). Advance to the
  next question **optimistically in <100ms** and reconcile server state in the background
  — our 700ms-debounced autosave already fits this; a spinner that freezes interactivity
  is cognitive friction (and hurts INP).

## Lever 2 — Interactive & on-brand (pull them in without gimmicks)

**The correction that matters most:** the intuitive "sliders for spectrums, drag-to-rank
for engagement" instinct is **wrong on the evidence.** Sliders don't improve data quality
over radio buttons and are slower and less-preferred (Bosch et al. 2019, *SSCR*, probability
panel; MeasuringU); swipe/drag has **no** credible completion-lift data and carries real
accessibility + motor cost. The workhorse input is the boring one.

- **Tap-to-select cards, built on *native* radios/checkboxes — the default for almost every
  question.** Fastest input, near-zero weight, and you inherit keyboard/screen-reader/focus
  for free (WebAIM/Yale). Styling `div`s with click handlers is the most common accessibility
  failure class — don't. Reserve **sliders** for the rare genuinely-continuous input, never
  as the default; use **image choice only where a photo *disambiguates faster than words***
  (style, shade, finish, product form) — and image choice is the main page-weight risk, so
  lazy-load + subset.
- **One-question-at-a-time for long quizzes, with a conversational *tone* — not a literal
  chatbot.** A peer-reviewed RCT (PMC9606606, n=206) found users *prefer* chat (70%) but it
  takes **~90s longer** — engagement ≠ efficiency. The card format captures the warmth without
  the time-tax. Don't fragment a 2–3 field capture into a slow drip, though (one-at-a-time only
  pays on 6+ steps).
- **Brand-native theming is trust — but the font is the hidden tax.** Inheriting the store's
  colors/radius/buttons so the quiz reads first-party is defensible on trust/consistency
  grounds (don't quote the commissioned "33% revenue" figure to merchants). The real cost is
  **fonts: a top cause of poor LCP + layout shift.** Load only the faces the quiz renders,
  subset them, `font-display: swap` with a metric-matched fallback. Our runtime already themes
  via inline `--qz-*` tokens.
- **Functional micro-motion only — and one real number.** Selection/tap feedback, progress,
  and **inline validation on the email step (validate on *blur*, not per-keystroke)** — that
  last one is the single micro-interaction with a measured payoff (Wroblewski/Etre: +22%
  success, −42% time; small n, treat as strong signal not exact size). Skip decorative reveals;
  ship every transition behind `@media (prefers-reduced-motion: reduce)` (WCAG 2.3.3).
  *(Note: the widely-circulated "NN/g: animation → +12% completion / 22% correction" stats are
  fabricated — the source contains no such numbers. Never put them in front of a merchant.)*
- **Earn the start (the hook).** A first screen promising a benefit ("Find your match in 6
  questions"), length visible, single CTA. Favor **contextual embedded entry** (a block on a
  collection/PDP where choice is genuinely hard) over interruptive exit-intent — and instrument
  start-rate yourself; every public entry-point number is a popup vendor's.
- **Accessibility is a conversion floor, not just compliance.** Native controls; any drag needs
  a tap/keyboard equivalent (WCAG 2.5.7); ≥24px targets (2.5.8); AA contrast enforced *on the
  inherited brand palette* (brand colors often fail on tinted backgrounds).

## Lever 3 — AI for the shopper (show genuinely useful info, grounded)

**The one-line synthesis:** AI's real value is *compressing and personalizing
information the merchant already has* — done **at publish time, grounded in the real
catalog + real reviews, source-linked, honest about negatives.** It becomes a gimmick
*and a liability* the moment it generates net-new claims, runs live in the shopper's
critical path, or replaces a deterministic recommendation with a black box.

**The architecture decision that makes AI cheap, fast, and safe — pre-compute, don't
call live.** Generate review summaries and per-result "why it fits" copy **at publish
time** (or a background job), bake them into the published doc, serve as **static
text**: zero added page-weight, zero client LLM, **no per-shopper cost, deterministic
output** — and it fits our runtime exactly (publish-time enrichment stripped from the
client payload; `/q` stays server-free). Live agent calls "often exceed 15s" and are
unacceptable in the flow; only truly per-shopper-novel interactions (free-text Q&A)
justify a live call, and those need **streaming + a per-shop budget cap (`AI_BUDGET_*`
already exists) + a strict fallback.** (Prompt caching cuts ~90% cost / ~85% latency
when you do call.)

**Grounding is the whole game — and RAG *reduces* but does not *eliminate*
hallucination.** Amazon's Rufus, with RAG over catalog + reviews, still fabricates
specs, invents prices, and claims features a product's own description denies. So: AI
copy must be **extract-and-attribute — render only retrieved product fields / real
review quotes, never free-generate claims from the model's weights** — with a hard "no
verified answer" fallback. If Amazon can't fully stop it, neither can we.

Ranked by ROI-confidence:
- **AI review summaries on the result card** — the clearest independently-supported win
  (NN/g usability). *Rules:* supplement, never replace, the star rating + raw reviews;
  make themes **clickable back to source reviews**; **surface negatives** (a rosy-only
  summary reads as fake and is FTC exposure); disclose. Pre-compute per product.
- **"Why this fits *you*" tied to the shopper's own answers × real product attributes**
  ("you said *sensitive skin* → this is *fragrance-free*"). The sweet spot: it feels
  *earned* (they told us) not creepy, is inherently grounded, and rides the credible
  personalization anchor — **McKinsey: personalization drives ~10–15% revenue lift**
  (relevance, not LLM prose). Pre-compute per result path.
- **AI comparisons ("A vs B for your needs")** built strictly from structured attributes
  + review themes — useful at the 2-choice moment, low hallucination surface if it only
  reformats retrieved fields.
- **Adaptive / conversational AI questioning — weakest evidence; skip or heavily
  constrain.** No *independent* proof it beats a good decision tree on conversion (the
  "141% / 4×" numbers are all vendor self-report); it adds latency, **non-determinism**
  (same answers → different result breaks a doc-model product), and QA surface. Best
  low-risk form: keep the spine a **fixed, auditable tree**; let an *optional* free-text
  "anything else?" nudge it.

**Compliance is a hard boundary, not a nicety.** FTC **Fake Reviews Rule** (effective
Oct 2024, up to **$53,088/violation** as of Jan 2025): the Rule targets *fabricated*
reviews — a faithful AI *summary*'s duty to surface negatives is grounded in **FTC Act §5
deception**, not the Rule's per-violation hook (fabricating/laundering reviews is the
Rule's exposure). FTC "keep your AI claims in check": benefit/comparison claims need real
substantiation. And the creepiness ceiling (Cisco 2023: **~88% concerned** about data use;
**~48%** see AI as helpful) is exactly why tying copy to the shopper's *own stated answers*
is the safe path.

## Lever 4 — Personalize more (the kind that pays)

**The finding that reorders the whole lever:** the credible, independently-measured
payoff from personalization is **modest (single-to-low-double-digit revenue lift)** and
comes **overwhelmingly from lifecycle activation of the quiz data — not from fancier
on-quiz personalization.** Anchor internal planning to McKinsey's **~10–15% revenue lift**
(5–25% by sector/execution), *not* the vendor "96×/300%/+296%" case studies — those
compare self-selected quiz-takers to all traffic (textbook selection bias) and evaporate
without a holdout. So the ranking is *inverted* from where the excitement usually goes:

1. **Post-quiz lifecycle flows are where the ROI actually lives (build this first).**
   Segmented, automated email/SMS keyed to the answers is the highest-leverage use of the
   data and the *only* place with defensible economics: Klaviyo segmented sends ≈ **2×
   opens/clicks, >3× revenue per recipient**; Omnisend automations ≈ **41% of email orders
   from ~2% of sends**. Patterns: result-personalized welcome series; cart/browse recovery
   that references the *stated hesitation* (budget, sensitivity); replenishment timed to the
   declared usage cadence; winback pairing the original goal with new products. **"Quiz data
   is worth what your flows extract — near-zero if unused."** Ship the answer→segment→flow
   handoff as a first-class feature, not an afterthought.
2. **Strong result-page recs + bundles — the honest on-quiz lever is AOV, not CVR.**
   A confident rec plus a **bundle assembled from the answers** ("your routine") lifts
   basket size; that's the believable, generalizable mechanism (the "3–5× conversion"
   numbers are not causal).
3. **Static rules-based mapping is the correct default** (answer → segment → rec → flow):
   most of the value at a fraction of the effort. Real-time/AI behavioral personalization
   only out-earns it at high traffic/SKU scale — a later tier, not v1.
4. **Branching for relevance & clean data, not for conversion.** No credible controlled
   study shows branching beats a short linear quiz on conversion; one multi-store review
   found **linear 5–7 questions outperforms complex branching** for most stores. Keep the
   default path short; justify each branch by measured completion + data quality.
5. **Layer only two high-signal sources** (returning-customer/purchase context + browse/cart
   signals) on top of the answers. Value drops fast after that — more sources is complexity
   theater until the first two drive flows.

**Privacy/consent — the ZPD edge is real but conditional.** Zero-party data is
consent-friendly *only if* you state the purpose at collection, don't silently repurpose
answers into broad profiling (GDPR risk), and honor withdrawal/deletion as easily as
collection (GDPR opt-in/granular; CCPA/CPRA opt-out + "do not sell/share"). Respect the
trust gap (91% of brands claim data-transparency; only 48% of consumers agree) and the
creepiness ceiling — which is exactly why personalization tied to the shopper's *own
stated answers* (Lever 3) is the safe path. And guard page-weight: a heavy personalization
payload can cost more conversion (+32% bounce 1s→3s; ~1% sales/100ms) than it earns — our
server-free `/q` runtime is the right posture.

**The through-line for all four levers:** every lift number here — including your own —
is only believable behind an **A/B holdout**. Plan to the credible 5–15% band; prove the
rest.

## Warnings — the adversarial layer

The research surfaced as many *traps* as tactics. This section is the one to re-read
before building anything, and the one to hand a merchant who asks "why not just do what
the quiz vendor's blog says?" Three classes: **numbers that are fabricated or
selection-biased, instincts that are wrong on the evidence, and legal lines that are
priced per violation.**

### A. Numbers to never repeat (they'll get you caught)

Each of these circulates widely and each is false, unsourceable, or non-causal. Quoting
them to a merchant is a credibility bomb — the moment they check the source, everything
else you said is suspect.

- **"NN/g: animation → +12% faster completion / −22% correction time."** *Fabricated.*
  NN/g's microinteractions article is entirely qualitative and contains **no such
  percentages.** This one is passed around design decks as if authoritative — it is not.
- **"Quiz-takers convert 3.2× / 25× vs non-takers."** *Selection bias, not causation.*
  People who finish a quiz are already high-intent; the gap is *who they are*, not what
  the quiz did. Only an A/B holdout separates the two, and the case studies have none.
- **Vendor case-study lifts — "96× ROI," "+296%," "+141%," "4×," "+102% AOV."**
  *Tier-C marketing.* Single self-selected brand, no control group, published because it
  won. Directional at best; never cite as an expected outcome.
- **"Slider scales capture more precise / higher-quality data."** *False* (Bosch et al.
  2019, probability panel): no quality gain over radios, and slower + less-preferred.
- **"Branching/adaptive quizzes convert better than linear."** *No credible controlled
  evidence;* one multi-store review found the opposite. Branch for relevance and clean
  data, never sold as a conversion number.
- **"Conversational/AI quiz lifts conversion 141% / 4×."** *Vendor self-report.* The one
  peer-reviewed comparison (chatbot vs form) found chat is *preferred* but **~90s
  slower** — engagement, not efficiency.
- **Shop Pay "up to 50%."** *Commissioned study, optimistic.* The *direction* (express
  checkout reduces abandonment) is well-supported by Baymard; the magnitude is a vendor's.

### B. Instincts that are wrong (the counter-intuitive corrections)

These are the moves that *feel* modern, premium, or smart — and lose on the evidence. Each
is a place where the obvious design choice is the wrong one.

| The tempting instinct | Why it's wrong | Do instead |
|---|---|---|
| Sliders for spectrums, drag-to-rank for engagement | Slower, less-preferred, no data gain; drag adds a11y + motor cost | **Tap-cards on native radios** — the boring input wins |
| Adaptive **AI** picks the next question — feels 1:1 | No independent conversion proof; adds latency + **non-determinism** (same answers → different result breaks a doc-model product) | **Fixed, auditable tree**; optional free-text nudge only |
| A live **AI concierge** on the result page — feels premium | Live agent calls "often exceed 15s"; per-shopper cost; breaks the flow | **Pre-compute at publish time**, serve static text |
| More data sources = richer personalization | Diminishing returns after ~2; most brands can't even activate what they have | Layer **two** high-signal sources, then build the flows |
| More branches = more personalized | Linear 5–7Q often *out*-converts complex branching | Short default path; branch for data, not conversion |
| Ask for the email early to "capture the lead" | **~19% of abandonment** is forced account creation; early asks inflate drop-off with no lead-quality gain | Gate on the **transition into the result**, soft by default |
| A real chat UI feels engaging | ~90s slower per the RCT; trust friction on sensitive data | Card format with conversational **tone** |
| RAG "eliminates" hallucination | It *reduces* but doesn't kill it — Amazon's Rufus still fabricates specs/prices | **Extract-and-attribute** only; hard "no verified answer" fallback |

### C. The gimmick tripwire (per lever)

Every lever has an honest form and a theater form separated by a bright line. Name the
line so the build never drifts across it:

- **Seamless** becomes dark the moment the gate moves *before* value — a wall before Q1,
  or a "results ready! enter email to see" bait. Honest = capture *at* the reveal, soft.
- **Interactive** becomes gimmick the moment novelty controls (spin-wheels, swipe decks,
  drag games) *replace* the fast tap input for the sake of "engagement."
- **AI** becomes a liability the moment it **generates net-new claims**, **runs live in
  the critical path**, or **replaces the deterministic recommendation** with a black box.
- **Personalize** becomes theater the moment it's on-quiz vanity instead of **lifecycle
  flows**, or crosses the **creepiness line** (using data the shopper didn't knowingly give).

### D. Legal lines — priced per violation (see also §Hard gates in Part I)

- **FTC Fake Reviews Rule** (eff. Oct 2024): up to **$53,088/violation** (2025 amount) for
  *fabricated* reviews; the "summaries must surface negatives" duty rides **FTC Act §5**.
- **TCPA** (SMS): **$500–1,500 per message** — email and SMS must be **separate,
  unchecked** opt-ins; no bundling. (Plus state mini-TCPAs — FL/OK/WA.)
- **GDPR / CCPA-CPRA**: purpose-stated consent, no silent repurposing of quiz answers into
  broad profiling, withdrawal as easy as collection. **Health-adjacent quizzes (skin,
  supplements, wellness) touch GDPR Art. 9 special-category data → need *explicit* consent,
  not a checkbox**; syncing answers to Klaviyo/Attentive for ad targeting can be a CCPA
  "sale/share."
- **Dark patterns — UCPD + national consumer law + GDPR (EU), FTC §5 (US)**: no fake
  timers, false scarcity, confirmshaming, or pre-checked consent. *(For a single merchant
  it's the UCPD/FTC §5, not DSA Art. 25 — that binds "online platforms." The EU Digital
  Fairness Act is a ~Q4-2026 proposal, not yet law.)*
- **Lottery law**: a **fixed/deterministic** everyone-wins reward falls *outside* the
  lottery definition (removes chance). A **random-amount "mystery" reveal reintroduces
  chance** — and providing data used for marketing is *consideration* in some states — so a
  random-value reveal gated on email can be a regulated lottery. No codified "safe harbor";
  the analysis is state-by-state.

## Sources

**Seamless (Lever 1)**
- Baymard Institute — cart-abandonment (50 studies, ~70%; forced account creation ~19%, extra costs ~39%): https://baymard.com/lists/cart-abandonment-rate
- Shopify — discount permalinks (`/discount/CODE?redirect=…`) + auto-applied checkout: https://help.shopify.com/en/manual/discounts/create-discount/discount-links
- Shopify — cart attributes / automatic discounts (Discount Functions): https://shopify.dev/docs/apps/build/discounts
- Shopify `customer` Liquid object / session persistence: https://shopify.dev/docs/api/liquid/objects/customer
- Shop Pay / express checkout on-page (direction; "up to 50%" is a commissioned study): https://www.shopify.com/shop-pay
- Speed → conversion: Mobify (~+1% CVR/100ms), Deloitte "Milliseconds Make Millions," Google (bounce +32% 1s→3s): https://www.outerboxdesign.com/articles/cro/page-speed-conversion-statistics/

**Interactive & on-brand (Lever 2)**
- Bosch, Revilla, DeCastellarnau & Weber (2019), *Social Science Computer Review* — sliders vs radios, no quality gain: https://journals.sagepub.com/doi/10.1177/0894439317750089
- MeasuringU (Sauro) — sliders slower / less-preferred: https://measuringu.com/time-and-preference-numeric-slider-desktop-mobile/
- Chatbot-vs-form RCT (PMC9606606, n=206) — preferred but ~90s slower: https://pmc.ncbi.nlm.nih.gov/articles/PMC9606606/
- Wroblewski / Etre — inline validation on-blur (+22% success, −42% time; small n): https://www.lukew.com/ff/entry.asp?883=
- NN/g — microinteractions (qualitative; note: no "12%/22%" stats exist in source): https://www.nngroup.com/articles/microinteractions/
- WCAG 2.3.3 animation-from-interactions / C39; 2.5.7 Dragging; 2.5.8 Target Size: https://www.w3.org/WAI/WCAG21/Understanding/animation-from-interactions.html
- WebAIM & Yale — native form controls: https://webaim.org/techniques/forms/controls
- Font performance (LCP/CLS, `font-display`, subsetting): https://www.debugbear.com/blog/website-font-performance

**AI for the shopper (Lever 3)**
- FTC — Rule on fake/AI-generated reviews (eff. Oct 2024; up to $51,744/violation): https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials
- FTC — "Keep your AI claims in check": https://www.ftc.gov/business-guidance/blog/2023/02/keep-your-ai-claims-check
- NN/g — AI/LLM-generated summaries & review synthesis usability: https://www.nngroup.com/articles/ai-summaries/
- Amazon Rufus — RAG-grounded shopping assistant still hallucinates (cautionary): https://www.nngroup.com/articles/ai-shopping-assistants/
- Prompt caching — ~90% cost / ~85% latency reduction: https://www.anthropic.com/news/prompt-caching
- Cisco Consumer Privacy Survey — ~80% nervous about AI data use / 41% benefit-justifies: https://www.cisco.com/c/en/us/about/trust-center/consumer-privacy-report.html

**Personalization (Lever 4)**
- McKinsey — "The value of getting personalization right—or wrong—is multiplying" (10–15% lift): https://www.mckinsey.com/capabilities/growth-marketing-and-sales/our-insights/the-value-of-getting-personalization-right-or-wrong-is-multiplying
- Twilio Segment — State of Personalization 2024 (n=4,750 execs / 6,300+ consumers): https://www.twilio.com/en-us/report/state-of-personalization-report
- Klaviyo — segmentation ≈ 2× engagement / >3× revenue per recipient: https://www.klaviyo.com/blog/ecommerce-quizzes
- Omnisend — 2024 automation benchmarks (41% of orders from ~2% of sends): https://www.omnisend.com/blog/email-marketing-statistics/
- Build Grow Scale — linear 5–7Q vs complex branching (multi-store review): https://buildgrowscale.com/product-quiz-conversion-guide
- Selection/self-selection bias (why vendor quiz stats inflate): https://www.qualtrics.com/articles/strategy-research/selection-bias/
- GDPR vs CCPA/CPRA consent (opt-in/granular vs opt-out): https://usercentrics.com/knowledge-hub/gdpr-vs-ccpa-compliance/

> **Credibility note.** Tier A (independent / large-sample / methodology-disclosed):
> McKinsey, Twilio Segment, Omnisend, Baymard, WCAG, the peer-reviewed slider/chatbot
> studies, Google/Amazon speed data. Tier B (vendor benchmarks, directional): Klaviyo,
> Attentive, RevenueHunt, Interact. Tier C (single-brand vendor case studies — illustrative
> only, never causal): the "96×/+296%/4×" stories. Every lift number, including ours, is
> only believable behind an A/B holdout.


---

# Part 3 · High-ROI functionality — ship vs A/B-prove

An evidence-tiered inventory of quiz features, each graded by the *strongest independent
evidence* behind it — not the loudest vendor number — and tagged **DEFAULT** (ship it) or
**EXPERIMENT** (validate before rollout). Pair with Part 6
for *how* to prove the EXPERIMENT set, Part 4 for
where each fits, and Part 2 for the mechanisms.

_Last updated: 2026-07-14._

> **The credibility flag that governs this whole doc.** Almost every headline conversion
> stat in the quiz/popup/email-tool ecosystem (Octane, Jebbit, Klaviyo, Attentive, OptiMonk,
> Shop Pay's own multipliers) is **self-published and selection-biased** — brands that failed
> with the tool never enter the benchmark denominator. Only Baymard, Spiegel, Iyengar,
> Scheibehenne, Kivetz/Nunes-Drèze, McKinsey, NN/g, and the FTC/EU regulators are treated as
> independent anchors. Tier A = independent/academic; B = vendor benchmark; C = single-brand
> case study. "ROI" here is a directional judgment: funnel-proximity × evidence-strength × cost.

---

## Master ranked table

| # | Feature | Best independent evidence (tier) | Credible effect | Cost (weight / compliance) | Verdict |
|---|---|---|---|---|---|
| 1 | **One-click ATC + pre-applied discount permalink + Shop Pay/express on result** | **A** — Baymard | ~70% cart abandonment; ~35% upside from checkout-friction removal. (Shop Pay "1.72×" is B) | Wallet JS/LCP hygiene; honest pricing on permalink | **DEFAULT** |
| 2 | **Curated 1–3 recs (vs large set)** | **A** — Iyengar & Lepper 2000, *tempered by* Scheibehenne 2010 | Jam study 30% vs 3% — but meta-analytic mean ≈ 0; real-but-fragile | ~0; fewer cards = lighter | **DEFAULT** (pitch = cut cognitive load, not "more = worse") |
| 3 | **Social proof on result (rating + count + verified-buyer)** | **A** — Spiegel | +270% purchase likelihood at 5 reviews vs 0; peaks **4.0–4.7★**; verified-buyer +15% | Server-render aggregates; **FTC Fake Reviews Rule** ($53,088/violation, 2025) | **DEFAULT** (ratings). Badges/"X chose this" → EXPERIMENT + must be true |
| 4 | **Progress indicator + one-question-per-screen** | **A** — NN/g, Baymard | No quiz-specific number; strong UX consensus it cuts perceived effort | Trivial; `aria-valuenow`; honesty risk if bar recalcs on branching | **DEFAULT** |
| 5 | **Save-my-results email + resumable state** | Mechanism **A** (endowment); benchmarks **B** (~42% opt-in, vendor) | No independent number | One field; abandoned-quiz email → CAN-SPAM + GDPR/PECR | **DEFAULT** |
| 6 | **Results-first + soft (skippable) gate "into the result"** | Mechanism **A** (curiosity gap, reciprocity); NN/g on deceptive gates | No independent placement number | GDPR "freely given" risk if hard-gated; confirmshaming risk | **DEFAULT** (soft). **Hard gate → EXPERIMENT** |
| 7 | **Segmented post-quiz EMAIL lifecycle flows** | **A/contested** — McKinsey (10–15%) *vs* Gartner (personalization backfires for 53%) | Anchor the 10–15% *adversarially*; the lift is real for *relevant, own-answer-based* flows, not fancy personalization | Flow ops; CAN-SPAM/GDPR | **DEFAULT** (segmented email); over-personalization → EXPERIMENT |
| 8 | **Post-rec progressive profiling (skippable, 1–3 Q for a reward)** | Mechanism only — **no independent evidence** it converts; survey fatigue worsening | No incremental-conversion number (the "biggest ROI" ranking was **retracted** — see AUDIT) | One skippable step; reward must be delivered | **EXPERIMENT** (speculative; not a default) |
| 9 | **Real-expiry urgency (countdown on a genuine deadline)** | Mechanism **A** (Cialdini); *counter* — B&IT 2023 (reactance backfires) | "8–32% lift" is **B/C, uncorroborated** | **Server-authoritative expiry.** Fake/resetting timers = illegal | **DEFAULT only if genuinely expiring**; fake = do-not-build |
| 10 | **Bundles / "complete the routine" (AOV)** | **B** — McKinsey directional | Cross-sell +15–25%; bundle-app "+20–35% AOV" = vendor | Low JS; real cost = pricing/inventory + honest total | **EXPERIMENT** (default-on for genuine complements) |
| 11 | **Endowed progress (bar starts >0%)** | **A** — Nunes & Drèze 2006; Kivetz 2006 | Car-wash 34% vs 19% completion — but *loyalty-card* context, not web quiz | Free; "fake bar" perception risk; needs a stated reason | **EXPERIMENT** |
| 12 | **Auto-advance on select** | **A** — Survey Practice controlled study; WCAG 3.2.2 | Break-off 13.99% vs 14.68% — **not significant**; ~45% fewer answer changes (a downside) | **Accessibility risk** (WCAG 3.2.2, keyboard/SR); multi-select can't auto-advance | **EXPERIMENT** (single-select only, a11y guardrails, default OFF where a11y matters) |
| 13 | **AI review summaries + "why this fits you"** | Mechanism **A** (relevance/load); **FTC** substantiation duty | No conversion number (94% "useful" = vendor perception) | **Highest compliance risk** — ungrounded output = deceptive-claim exposure (FTC Operation AI Comply) | **EXPERIMENT** (gate behind grounding + claim guardrails) |
| 14 | **Mystery / "everyone-wins" discount** | Mechanism **A** (variable reward); *counter* — reactance/skepticism | Vendor opt-in ~7–13% vs ~3% (B, inconsistent denominators) | Odds shown must be real; every prize redeemable; email consent | **EXPERIMENT** |
| 15 | **Segmented post-quiz SMS lifecycle flows** | **A** — McKinsey; Attentive is **B** | Same 10–15% personalization anchor; SMS ROI figures are vendor | **Hard legal cost: TCPA prior express *written* consent** ($500–1,500/message) | **EXPERIMENT / compliance-gated** (never default-on) |

---

## The ~5 to SHIP BY DEFAULT

Tier-A independent evidence, low cost, close to the money:

1. **One-click ATC + discount permalink + Shop Pay/express on the result page** — Baymard's
   ~70% abandonment / ~35% friction-removal upside is the strongest independent case in the
   set. Every removed step is measured money.
2. **Curated 1–3 recommendations** — the quiz *is* the expert filter; ship few. Ground the
   pitch on cognitive-load reduction, not the overstated "paradox of choice."
3. **Social proof (aggregate rating + count + verified-buyer badge)** — Spiegel's
   +270% / verified-buyer +15% is independent and large; server-render to stay light.
4. **Progress indicator + one-question-per-screen** — cheap, independently endorsed, directly
   attacks mid-quiz abandonment.
5. **Save-my-results (soft, results-first gate) + segmented EMAIL flows** — core list-building
   + McKinsey's 10–15% personalization lift; CAN-SPAM is hygiene you owe anyway.

*(Note: post-rec progressive profiling was **downgraded from a default to a speculative
experiment** in the audit — no independent evidence it converts, and survey fatigue is
worsening. See Part 8.)*

## The ~5 worth the differentiation but MUST be A/B-PROVEN

Strong upside or brand-differentiating, but the evidence is vendor-biased, context-fragile,
or carries a compliance/UX tax — see Part 6 for the test design:

1. **Bundles / "complete-the-routine"** — best AOV lever, but the numbers are McKinsey-
   directional + vendor; validate on *your* catalog, default-on only for true complements.
2. **Endowed progress (bar >0%)** — Tier-A theory, but the clean 34%-vs-19% number is a
   loyalty-card context; A/B the start-offset and keep it honest.
3. **Auto-advance on select** — the *controlled* study shows **no significant completion
   benefit** and a real reconsideration + accessibility cost. The clearest case where the
   vendor narrative contradicts independent evidence. Test, single-select only, default OFF
   where a11y matters.
4. **AI review summaries + "why this fits you"** — high perceived value, but ungrounded output
   is FTC deceptive-claims exposure. Ship only behind strict grounding; prove groundedness +
   lift before rollout. (See Part 2 Lever 3.)
5. **Mystery discount + SMS lifecycle** — spin-to-win lift is vendor-inflated and academically
   contested; SMS carries a hard **TCPA written-consent** liability. Both opt-in/experiment-
   gated, never defaults.

## Two do-not-build lines (regulatory, not preference)

- **Fake / resetting countdown timers & false scarcity** — FTC *Bringing Dark Patterns to
  Light* (2022) + EU UCPD (the Digital Fairness Act is a ~Q4-2026 *proposal*, not yet law).
  Honest **server-enforced** real-expiry urgency is fine;
  the cosmetic client-side version is illegal.
- **Non-redeemable "everyone-wins" wheels** — the prize shown must be real and redeemable.

---

## Sources

**Tier A — independent / academic / authoritative**
- Baymard — cart abandonment https://baymard.com/lists/cart-abandonment-rate · payment UX https://baymard.com/learn/payment-ux · one-page checkout https://baymard.com/blog/one-page-checkout
- Spiegel Research Center — how reviews influence sales https://spiegel.medill.northwestern.edu/how-online-reviews-influence-sales/
- Iyengar & Lepper 2000, "When Choice Is Demotivating" https://faculty.washington.edu/jdb/345/345%20Articles/Iyengar%20&%20Lepper%20(2000).pdf
- Scheibehenne, Greifeneder & Todd 2010 — choice-overload meta-analysis (mean ≈ 0) https://scheibehenne.com/ScheibehenneGreifenederTodd2010.pdf
- Kivetz, Urminsky & Zheng 2006 — goal-gradient (JMR) https://journals.sagepub.com/doi/abs/10.1509/jmkr.43.1.39
- Nunes & Drèze 2006 — endowed progress (JCR) https://academic.oup.com/jcr/article-pdf/32/4/504/17928623/32-4-504.pdf
- NN/g — progress indicators https://www.nngroup.com/articles/progress-indicators/ · wizards https://www.nngroup.com/articles/wizards/ · cognitive load https://www.nngroup.com/articles/4-principles-reduce-cognitive-load/ · deceptive patterns https://www.nngroup.com/articles/deceptive-patterns/ · scarcity https://www.nngroup.com/articles/scarcity-principle-ux/ · progressive disclosure https://www.nngroup.com/articles/progressive-disclosure/
- Survey Practice — auto-advance controlled study https://www.surveypractice.org/article/6381-impacts-of-implementing-an-automatic-advancement-feature-in-mobile-and-web-surveys
- WCAG 2.1 SC 3.2.2 On Input https://www.w3.org/WAI/WCAG21/Understanding/on-input.html
- Behaviour & Information Technology 2023 — scarcity/timer backfire https://www.tandfonline.com/doi/full/10.1080/0144929X.2023.2242966
- McKinsey — Next in Personalization (10–15%) https://www.mckinsey.com/capabilities/growth-marketing-and-sales/our-insights/the-value-of-getting-personalization-right-or-wrong-is-multiplying
- Forrester — zero-party data https://www.forrester.com/report/QA+What+Marketers+Need+To+Know+About+ZeroParty+Data/-/E-RES145095
- FTC — Dark Patterns report (2022) https://www.ftc.gov/system/files/ftc_gov/pdf/P214800+Dark+Patterns+Report+9.14.2022+-+FINAL.pdf · Fake Reviews Rule (2024) https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials · Operation AI Comply https://www.ftc.gov/news-events/news/press-releases/2024/09/ftc-announces-crackdown-deceptive-ai-claims-schemes · CAN-SPAM https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business
- EU Digital Fairness / dark patterns https://epthinktank.eu/2025/01/14/regulating-dark-patterns-in-the-eu-towards-digital-fairness/
- TCPA written-consent for SMS https://activeprospect.com/blog/tcpa-text-messages/

**Tier B — vendor / directional (selection-biased):** Shop Pay https://www.shopify.com/blog/shop-pay-checkout · Klaviyo https://www.klaviyo.com/blog/abandoned-cart-benchmarks · Attentive https://www.attentive.com/blog/high-performing-sms-campaign-insights · Octane AI https://www.octaneai.com/ · OptiMonk/Claspo/WisePops (spin-to-win) · Bazaarvoice (AI summaries) · Jebbit (quiz completion)

**Tier C — single-brand, illustrative only:** SplitBase, Outgrow, Oxify guides; Polysleep "6×", Hunter & Gather "258%", PACK'd "15.26%" — never treat as expected outcomes.


---

# Part 4 · Flow templates by vertical

Reusable quiz *flow* templates by vertical: the sequence, question types, branching,
email-gate placement, and result shape that recur across high-performing ecommerce
quizzes. Reconstructed from brand quiz pages + independent teardowns; the machine-readable
versions live in [`quiz-templates/`](quiz-templates/). Companion to
Part 7 (authoring rules),
Part 3 (features), and
Part 6 (how to prove any of it).

_Last updated: 2026-07-14._

> **Credibility discipline (same as the strategy docs).** Structure — sequence, gate
> placement, result shape — is *reliably observed* from real quizzes and transfers well.
> The *conversion numbers* attached to quizzes ("20–40% vs 2–3% baseline") are **selection
> bias, not causal lift**: a person who finishes a 20-question quiz is a pre-qualified,
> high-intent shopper who self-selected in. Treat every quiz-conversion figure as Tier B/C
> directional at best, never as a promised uplift. Exact question counts are approximate —
> brands A/B test constantly. Tier A = independent/academic; B = vendor benchmark; C =
> single-brand case study.

---

## The two decisions that define every template

Before the per-vertical detail, the two choices that matter most — both **category-dependent**:

**1. Email-gate placement (the single highest-leverage decision).**
- **Gate at the result transition** (peak anticipation, "enter email to see your result")
  for **diagnostic / formulation / pack / plan / shade** categories — beauty, supplements,
  pet, custom haircare, shade-match. The shopper has invested answers; the reveal is worth
  an email.
- **Defer the gate to the action step** (save / try-on / discount, *after* results are
  shown free) for **fit, durables, and gifting** — buyers there won't trade an email for an
  *unseen* answer, and hard pre-result gating measurably suppresses completion.

**2. Length, mapped to category (do NOT globally minimize).**
- **Short (5–8):** gifting, durables — low patience or high-ticket confidence-building.
- **Medium (8–15):** supplements, pet, fit.
- **Long (15–35):** custom formulation (Prose/Function of Beauty), subscription styling
  (Stitch Fix) — here **length is the value proposition**: it signals thoroughness and
  builds sunk-cost commitment. Care/of and Stitch Fix are on record that *longer beat
  shorter* for them.

---

## Part 1 — Per-vertical flow templates

### 1 · Beauty / skincare — two sub-patterns (keep both)

**1a. Custom-formulation diagnostic** (Prose, Function of Beauty) — long, thorough, length *is* the pitch.
- **Length:** 20–35 Q across labeled sections. Prose = 30+ across 4 sections; FoB = 4 stages.
- **Arc:** physical attributes first (type/structure — easy, concrete, momentum) → behaviors/treatments → lifestyle/environment (diet, climate, stress) → goals/preferences last (aspirational) → product/subscription config.
- **Types:** single-select dominant; **image-choice with reference photos** to disambiguate physical traits; **capped multi-select** for goals ("pick up to 5 of 18" — the cap prevents dilution); optional short-text.
- **Branching:** moderate — physical answers gate later treatment questions.
- **Gate:** at the **formula-reveal transition** (account/email to see & buy). The long quiz is deliberate sunk-cost before the gate.
- **Result:** single bespoke "your formula/routine" hero + per-goal ingredient rationale + subscription config. *(Tier C: brand pages, DTC Patterns teardown.)*

**1b. Instant-match diagnostic** (Il Makiage PowerMatch, Curology) — short, speed is the pitch.
- **Length:** ~10–14 Q, marketed as "90 seconds."
- **Arc:** skin-attribute questions (tone, undertone via reference imagery, coverage, concerns); "no face scan required" is the hook.
- **Types:** heavy image-choice / visual swatches; single-select. Light user-facing branching over a large algorithmic match space.
- **Gate:** Il Makiage gates at results + a try-before-you-buy offer. **Curology captures email at the START** — but that's a *prescription-medical* signup, not a shopping quiz (different logic; don't copy the front-gate for a commerce quiz).
- **Result:** single hero match ("your shade is X") with a **claimed accuracy %** as the trust device. *(Tier C/B — but see Part 9.2: a precise "97% match" can backfire; prefer qualitative or a high, *explained* confidence, not spurious precision.)*

### 2 · Supplements / health (Care/of, Ritual, Persona)
- **Length:** 8–15 Q. Care/of deliberately long ("5-minute quiz") — a useful counter-anchor to "keep it short" for high-personalization categories.
- **Arc:** basics first (age, "currently taking vitamins?") → **goal framing** (overall wellness vs specific: immunity/sleep/stress/energy/digestion) → concern deep-dive → diet/lifestyle → (Persona) medications & health history for safety.
- **Types:** single- & multi-select; goal grids; Persona adds medication/condition inputs cross-referenced against a nutrient–drug interaction database (real conditional safety logic).
- **Gate:** **before the results page** — the canonical "ask at peak anticipation, right before the reveal" placement.
- **Result:** a **"routine" / personalized pack** (multiple SKUs as a daily set), each with rationale; Care/of adds **evidence/citation cards** per rec → subscription. *(Note: Ritual's "quiz" is a light router to a pre-set SKU — a good "lite" variant, not a personalization engine.)* *(Tier C + MySubscriptionAddiction independent-ish.)*

### 3 · Apparel & fit (ThirdLove, Warby Parker, True Fit)
- **Length:** 6–12 Q; ThirdLove markets "~60 seconds."
- **Arc:** current garment as anchor ("what size/brand do you wear now?") → **fit-problem diagnosis** (gaping, band tightness, strap slip — diagnosing what's *wrong* with the current product) → body-shape → style/color preferences last (doubles as an upsell capture).
- **Types:** single-select, image-choice for fit issues/body shape, preference multi-select. Warby Parker uses **adaptive branching** (face shape → usage → size → style), "conversation-like rather than a static form."
- **Gate:** **deferred to the action step.** Warby Parker → Home Try-On (5 frames shipped free), email/address captured at try-on. Fit tools gate later because the payoff (a size) can be shown free to build trust.
- **Result:** **single recommended size + a small ranked set of matching styles.** *(Data-network variant, True Fit: minimal questions, borrow sizes the shopper already owns, output one size.)* *(Tier C/B.)*

### 4 · Gifting / gift-finder
- **Length:** **5–7 Q — the tightest template** (giver has low patience, shopping for someone else).
- **Arc:** **recipient/relationship first** (partner/parent/friend/pet — reframes the whole result set) → occasion (→ formality) → **budget early** (so every result is in-range) → recipient personality/interests → optional category constraint.
- **Types:** single-select + image-choice for "vibe"; budget as a range selector. Light-moderate branching (interest tags filter catalog).
- **Gate:** **weakest gating pressure of all templates** — givers resist a gate before seeing ideas. Show results, capture as "email me this gift list / get a discount."
- **Result:** a **ranked/curated shortlist (3–6 ideas)**, not a single hero. *(Tier C vendor templates — treat the 5–7 / budget-early convention as convergent consensus, not measured.)*

### 5 · Food & beverage / pet (Ollie, Nom Nom, Farmer's Dog)
- **Length:** 8–14 Q; marketed "under 5 minutes."
- **Arc (a strong, repeatable pattern):** **pet name + gender first** (personalizes everything downstream — the quiz addresses the dog by name) → age → breed → current & goal weight → spayed/neutered → activity level → **allergies/sensitivities (large multi-select)** → specific health conditions.
- **Types:** short-text (name), single-select, date (birthday), **large multi-select** (allergies), image-choice body-condition. Moderate branching; a portion/calorie **algorithm** computes the plan (personalization is mostly server-side math).
- **Gate:** at the **plan-reveal transition** (email/account to see the custom plan & price). Subscription intent captured with the plan.
- **Result:** **single custom "meal plan"** (portion, cadence, price) → subscription. Naming the pet early is the signature move. *(Tier C.)*

### 6 · High-consideration durables (mattresses, bikes, skis, golf)
- **Length:** **short despite high price** — Casper markets "2 minutes, ~6–8 Q." For durables the quiz is a *confidence-builder / shortlist-narrower*, not a data harvest.
- **Arc:** current product ("foam/innerspring/hybrid?") → **primary use / sleep position** (the single most predictive input) → firmness preference → temperature concern → size → other issues.
- **Types:** single-select, image-choice (position, firmness), a **1–5 firmness scale** (discrete taps, not a slider). Light branching — the catalog is small (3–5 models), so the quiz narrows a shortlist.
- **Gate:** **after results, soft** — high-ticket buyers won't gate-trade for an unseen answer; capture as "save your result / get a discount."
- **Result:** **single hero model (+1 alternative),** heavy justification (why this matches your position/firmness) + price + trial/returns reassurance. *(Generalize: current gear → primary use/terrain → skill level → body metrics → preference → single hero + fit reassurance.)* *(Tier C.)*

### 7 · Subscription onboarding (Stitch Fix)
*Distinct from a shopping quiz — the goal is a committed profile + first box; friction is deliberate investment.*
- **Length:** **longest template — 10–15 min / 25+ inputs.** The survey is "friction that increases investment, trust, and identity" (IKEA/sunk-cost effect is the mechanism, not a bug).
- **Arc:** objective/sizing first (height, weight, sizes) → fit preferences (loose/fitted per garment area) → **style-identity questions** (image-based "rate this outfit" like/dislike) → lifestyle/occasion → budget per category → **account creation mid-flow** → cadence/subscription config.
- **Types:** the widest mix — image-preference rating, single/multi-select, numeric. Moderate branching (garment-specific fit follow-ups).
- **Gate:** **mid-flow** — create the account partway (after initial investment), then continue the deep profile. Enough sunk cost to convert, then lock identity in before the heaviest questions.
- **Result:** **not a product list** — a *scheduled first box* + a saved style profile the user feels ownership of. *(Tier B/C: Reforge teardown.)*

### 8 · Color / shade match (Sephora Color IQ, Il Makiage, paint)
- **8a. Device/scan-assisted (Sephora + Pantone Color IQ):** a spectrophotometer scans the jawline → a 3-digit code matched across a cross-brand shade DB, saved to the loyalty account. **Effectively zero questions — hardware replaces the questionnaire.** Lesson: *when you can measure, do; the "quiz" collapses to a scan + a persistent saved profile.*
- **8b. Questionnaire-only (Il Makiage, paint):** ~10–14 image-heavy Q standing in for a scan → **single shade + claimed match %.** Paint follows the same skeleton: room/light → existing palette → mood/undertone → single recommended color.
- **Gate:** results-transition (Il Makiage) or account-save (Sephora — the code *becomes the retention hook*).
- **Result:** single hero match + confidence signal; the durable asset is the **saved shade profile** personalizing future sessions. *(Tier B/C.)*

---

## Part 2 — Result-page shapes (three archetypes)

| Template | Result shape | Archetype |
|---|---|---|
| Beauty 1a (Prose/FoB) | Single bespoke formula/routine + per-goal rationale | **Single bespoke output** |
| Beauty 1b (Il Makiage) | Single hero match + accuracy % | Single bespoke output |
| Supplements | Personalized multi-SKU pack + evidence cards | Single bespoke output |
| Food/pet | Single custom meal plan (portion, cadence, price) | Single bespoke output |
| Durables | Single hero model (+1 alt) + justification + reassurance | Single bespoke output |
| Shade match | Single hero shade + match % + saved profile | Single bespoke output |
| Apparel/fit | Single size + small ranked style set | **Ranked shortlist** |
| Gifting | Curated shortlist (3–6 ideas) | Ranked shortlist |
| Subscription | Scheduled first box + saved profile (no product list) | **Profile + first box** |

---

## Part 3 — Length & order evidence

**Tier A anchors:**
- **Goal-gradient / endowed progress** (Kivetz, Urminsky & Zheng 2006, *J. Marketing
  Research*): motivation to complete rises as perceived progress increases; artificial early
  progress accelerates completion. The real basis for progress bars (Prose's segmented
  4-section bar) and **front-loading easy questions.**
- **SurveyMonkey** (large sample, disclosed method): completion falls **~89% at 10 Q → ~79%
  at 40 Q**; abandonment climbs sharply past ~7–8 min. *Survey* research, not ecommerce-quiz
  — apply directionally.
- **Sensitive-question placement** (Cambridge Core experiments): demographics/sensitive items
  belong **late** — both for the commitment effect on completion and to avoid priming bias.

**Order rules for the library:**
1. **Easy/concrete first, aspirational/goals mid, config last.** Physical attributes build
   the endowed-progress streak; goals engage mid-to-late; SKU/subscription config closes.
2. **Show a segmented progress indicator** (labeled sections make a long quiz feel navigable).
3. **Gifting:** recipient/context before content; budget early so all results are in-range.
4. **Demographics/email late** (commitment + anti-priming).
5. **Email gate at peak anticipation** (just before the reveal) for diagnostic categories;
   **deferred to the action step** for fit/durables/gifting.
6. **Name/personalize early where it pays** (pet food uses the pet's name from Q1 onward).

**The "5–8 question sweet spot / −15% per question" folklore is Tier C** vendor consensus
(Interact et al., no disclosed method). It rhymes with the Tier-A survey data directionally,
which is why it's plausible — but don't cite the precise "−15% per question" as fact, and
**don't hardcode a global cap:** map length to category (Part 1).

---

## Sources

**Tier A:** Kivetz/Urminsky/Zheng 2006 (goal-gradient) https://journals.sagepub.com/doi/abs/10.1509/jmkr.43.1.39 · SurveyMonkey completion-vs-length https://www.surveymonkey.com/curiosity/survey_questions_and_completion_rates/ · Cambridge Core sensitive-question order https://www.cambridge.org/core/journals/political-science-research-and-methods/article/where-to-place-sensitive-questions-experiments-on-survey-response-order-and-measures-of-discriminatory-attitudes/7161889E9597C2CB65C50B4EA0570057 · Coglode endowed-progress https://www.coglode.com/nuggets/endowed-progress-effect

**Tier B:** Octane AI benchmarks/case-studies https://www.octaneai.com/ · Interact "how many questions" https://help.tryinteract.com/en/articles/10752954 · Reforge Stitch Fix teardown https://www.reforge.com/blog/stitchfix-personalization-retention-monetization · Digiday Color IQ https://digiday.com/marketing/color-iq-sephoras-shade-matching-skin-care-tool-boosts-brand-loyalty/ · True Fit https://www.truefit.com/how-it-works

**Tier C (illustrative brand pages / teardowns):** Prose https://prose.com/ + DTC Patterns · Function of Beauty https://functionofbeauty.com/pages/hair-quiz · Il Makiage PowerMatch https://www.ilmakiage.com/powermatch-me · Curology https://curology.com/ + GoodUX · Care/of https://prehook.com/4-easy-tactics-to-steal-from-care-ofs-225m-quiz-strategy/ · Ritual/Persona/Care-of https://www.mysubscriptionaddiction.com/vitamin-subscriptions-compared-persona-nutrition-vs-care-of-vs-ritual · ThirdLove https://www.thirdlove.com/pages/fitting-room + Prehook · Warby Parker https://www.warbyparker.com/quiz/frames · Ollie https://www.ollie.com/how-it-works/ · Casper https://casper.com/pages/mattress-quiz · Sephora Color IQ (PRNewswire) · Stitch Fix https://lexineubauer.com/portfolio/onboarding-style-quiz/ · Gift-finder conventions: Digioh / Quizell / WithGifted


---

# Part 5 · Niche per-industry playbooks

Deep, vertical-specific quiz/guided-selling patterns — the distinctive flow, the one
mechanic worth stealing, the benchmark reality, and the compliance landmine — for each
major DTC category. Complements the category-agnostic Part 4
and Part 7. Sourced from an industry-by-industry
research sweep; every empirical claim is tier-graded and vendor bias flagged.

_Last updated: 2026-07-14. Status: assembled from the research sweep; verticals appended as
research lands._

> **How to read.** Tier A = independent/academic/regulatory/court-verified; B = credible
> single-source or vendor benchmark (directional); C = vendor marketing / single-brand case
> study (illustrative only). The **structure** of each flow is reliably observed; the
> **conversion numbers** attached to quizzes are selection-biased (quiz-takers self-select as
> high-intent) — never a causal lift.

---

## Cross-cutting: the compliance landmine map

The single biggest finding of the sweep is that **quiz compliance is category-specific and
several categories carry per-violation legal exposure the generic docs don't flag.** This
table is the fast reference; details in each vertical.

| Landmine | Bites in… | The rule / exposure |
|---|---|---|
| **BIPA face-scan litigation** | any vertical adding a **camera/selfie** step (shade, skin, hair, eyewear, apparel body-scan) | Illinois BIPA = **private right of action, $1,000–$5,000/violation**. Live settlements: **Charlotte Tilbury $2.925M**, MAC (survived dismissal 2026), Estée Lauder (split rulings), Ulta/Mary Kay, Louis Vuitton. **A camera-free quiz sidesteps this entire category** — a genuine product advantage. |
| **FDA cosmetic-vs-drug claim line** | skincare, haircare, cosmetics | Result-page copy establishes "intended use." "Treats acne / boosts collagen / removes wrinkles / regrows hair" = **unapproved drug claims** (real FDA warning letters: Lancôme, Repare). Safe = appearance language ("reduces the *look* of"). |
| **FDA/DSHEA structure-function** | supplements, some food | A result implying a supplement "treats/prevents" a condition = illegal drug claim; the "not evaluated by the FDA" disclaimer is mandatory. |
| **FTC Eyeglass Rule (2024) + Contact Lens Rule** | eyewear | Rx must be released free/automatically *before* any sale offer; a quiz **cannot examine eyes or issue an Rx** (Warby paid KY AG **$138K** for online-vision-test violations in 26 states). |
| **Alcohol age-gate + DTC shipping law** | wine/spirits | 21+ verification + state-by-state three-tier shipping legality; must gate eligibility *before* the sale. |
| **COPPA** | baby/kids | Data about/from under-13s triggers COPPA obligations. |
| **Health-data via ad pixels** | supplements, CBD, Rx-telehealth, skin | FTC 2023–24 actions (GoodRx, BetterHelp, Cerebral) over sharing quiz health answers to Meta/Google pixels; WA My Health My Data Act adds a private right of action. |
| **FTC Endorsement/Reviews + "clean/natural"** | all (esp. beauty) | Before/after must be representative; "clean/hypoallergenic/dermatologist-tested" are **undefined** and litigated (Truly Organic **$1.76M** FTC penalty). |

**Two honesty corrections the sweep forces on the main docs:**
- **Return-reduction reality.** Fit-tool vendors sell "30–40% fewer returns"; independent
  Coresight (2026) found most real deployments deliver **2–8%** — because a perfect
  measurement still maps against a brand size chart that is itself wrong ("the size chart is
  the lie"; ~71% of fit-returners *had* checked the chart). Claim **single-digit-to-low-teens**
  return reduction + conversion/AOV/email, never 30–40%.
- **Camera diagnostics are a legal decision, not just a UX one** — see BIPA row. The strategy
  docs' AI/visual-diagnostic ideas must carry this warning.

---

## Beauty & personal care

### Skincare (diagnostic / regimen)
**Distinctive:** the one vertical where the quiz is a genuine *diagnostic*, not a preference
filter. Real brands sit a **clinical taxonomy** under the answers (Baumann 16-type: Oily↔Dry,
Sensitive↔Resistant, Pigmented↔Non, Wrinkled↔Tight; Typology's 24-type). Sensitivity is an
**orthogonal axis, not a fifth type**. Canonical sequence: skin type (via *behavioral proxy*,
not self-label — Bubble even mandates a bare-face 1-hr protocol) → **concern + severity +
priority rank** (the core branch; cap at ~3) → sensitivity/allergies → routine/experience →
ingredient/texture prefs → **lifestyle & environment** (Prose pulls climate + water hardness
from ZIP) → **safety gating** (pregnancy/meds).
**Steal:** the result is a **sequenced AM/PM regimen with ingredient-conflict logic**
(retinol + AHA → alternate nights; vitamin C AM / retinoid PM) and a **pregnancy branch that
suppresses retinoids** — not a single SKU.
**Benchmarks (Tier B, bias-flagged):** ~60–70% completion, 5–8 Q, email gated pre-results
35–55% opt-in, quiz AOV **+~20%** in beauty; the real battle is **order-1→3 subscription
retention** (~60–70% lost by order 3). Category return rate low (~8%, consumable). Site CVR
~2–3.5% (premium lower).
**Compliance:** FDA cosmetic-vs-drug line is the #1 risk — enforce a **claims allow/deny
lexicon** on result copy ("reduces the *look* of fine lines" ✅ / "boosts collagen / treats
acne" ❌; real warning letters). "Clean/hypoallergenic/dermatologist-tested" are undefined —
treat as user-selected filters, not asserted claims. MoCRA (2022) is the backdrop; Rx skincare
(Curology) is telemedicine + HIPAA. AI selfie analysis: validated for wrinkles/texture on
lighter-mid tones, **weak on pigmentation for deep skin tones** (r≈0.40) → bias + BIPA risk.
**Failure mode:** AI-generated result copy gravitates to illegal drug claims; thin branching
that returns "everyone gets the priciest regimen" erodes trust.

### Cosmetics shade-match (foundation / complexion)
**Distinctive:** must estimate a **continuous color coordinate** (depth × undertone) and land
it on one discrete SKU, without the product in hand or a calibrated color read — and mismatch
is the **#1 return driver in beauty** (foundation returns ~23% vs skincare ~11%, and opened
complexion is a near-total loss). Four camera-free input strategies, blend 2–3:
**(1) undertone-proxy questions** (jewelry gold/silver, vein, sun-reaction — resolve on 2
agreeing signals); **(2) reference-imagery / "pick the model who looks like you"** (heavy
image-choice, needs diverse well-lit photography); **(3) "what do you wear now" cross-brand
mapping** (Findation — the single highest-signal, zero-biometric input); **(4) depth/coverage/
finish axes**. Result = single hero shade + match-confidence signal + lighter/deeper alternates
+ **an explicit shade guarantee**.
**Steal:** the undertone-proxy + "what you wear now" combo — **camera-free, BIPA-free,
returns-lowering**. Il Makiage's "without seeing your face" positioning *is* this.
**Compliance:** **BIPA is the headline** — camera/AR try-on drove **Charlotte Tilbury's
$2.925M settlement**, MAC, Estée Lauder (split). A questionnaire matcher avoids it entirely.
Also shade-**inclusivity** (the "Fenty effect" — 40+ evenly-distributed shades are table
stakes; a matcher that can't confidently return deep shades publicly exposes a thin range —
Youthforia backlash). Accuracy %s ("98%") are all self-reported/survivorship-biased — track
**return rate on quiz orders** as the real KPI.
**Failure mode:** confidently-wrong single result; light-skewed reference imagery; creepy
face-scan without consent.

---

## Apparel & fit-driven verticals

### Apparel & intimates (fit-finder)
**Distinctive:** must solve *which style* **and** *which size* at once, and size is where the
money leaks. The winning pattern is **anchor-and-diagnose, not measure** — asking shoppers to
self-measure with a tape fails (drop-off + garbage inputs). Canonical bra flow (ThirdLove "The
Fitting Room", the most-copied): **anchor on current garment** ("what brand/size do you wear
now, how old is it") → **diagnose fit problems with interactive imagery** (gaping, spillover,
band riding up — point at it, don't describe) → **breast/body shape** (drives *style*, not
size) → style prefs → **deferred email gate at results** → **size + ranked style set**. Band
and cup are *coupled* — encode **sister-sizing** (down a band → up a cup).
**Steal:** "name a brand & size that already fits you" imports another brand's fit calibration
for free — the strongest single survey input; and reframe the "you're a different size than you
thought" shock ("70% get a different rec" + generous return guarantee).
**Benchmarks:** apparel returns **20–40%** (≈1 in 4 garments); **fit is ~53–70% of returns**
(Coresight/McKinsey/Prime AI) — but the honest **return-reduction from a fit tool is 2–8%**,
not the vendor 30–40% (size charts are themselves wrong). Sell the *bundle* (conversion + AOV +
email + first-party fit data), not an inflated return number.
**Compliance:** mobile **body-scan = BIPA exposure**; prefer **self-reported anchors + a
digital-twin from 4–6 questions** (Bold Metrics: no photo, no PII) over image capture; if you
scan, explicit written consent + process-and-discard + no image retention. Size **inclusivity**
(Universal Standard 00–40, per-size patterns, no separate "plus" flow) is an expectation.
**Failure mode:** recommending an **out-of-stock size** (dead-end — always tell them their size,
then offer nearest in-stock); over-asking measurements; ignoring body-shape-vs-size.

### Footwear
**Distinctive:** **use-case-first, then biomechanics, then sizing** (never style-first): activity
(road/trail/gym/lifestyle) → mileage/intensity → **arch/pronation/width/volume** → cushion
preference → pain flags → size. Result = model(s) + a size + width.
**Steal:** **Atoms' per-foot quarter-sizing** (~80% of people have unequal feet; ships 3 pairs,
keep the best *per foot*) — the fit-innovation benchmark. And map cross-brand on **foot-length
mm against brand lasts**, never on label size (there is **no width standard**).
**Reality:** camera foot-measurement is decent on length/width, **weak on arch/volume** (the
dimensions that drive support) — one US size ≈ 4.23mm, so a phone-app's cm-level error is a full
size. In-store 3D (Volumental ±1mm) is materially better. Footwear returns ~17–30%.
**Compliance:** foot scans are **not** BIPA "biometric identifiers" → far less risk than
face-scan (a structural advantage for footwear VTO/measurement).

### Eyewear
**Distinctive & legally gated:** flow = face-shape (a *soft* heuristic, not science) → **fit
measurements (PD, frame width, the 52-18-140 numbers)** → style → **the Rx branch** (non-Rx =
frictionless; prescription = collect a valid Rx + PD + lens type) → try-on. Warby Parker is the
reference (Frames Quiz + **Home Try-On** 5-free + AR VTO with TrueDepth PD measurement + a
privacy-forward PD tool that doesn't store without permission).
**Compliance (the decisive difference):** prescription eyewear is an **FDA Class I medical
device**. A quiz **CANNOT examine eyes or issue an Rx** — online refraction is a *renewal* only,
banned in ~26 states; Warby paid the **KY AG $138K**. Must honor the **FTC Eyeglass Rule (eff.
Sept 2024** — release the Rx free/automatically before any sale offer) and **Contact Lens Rule**
(verify; beware passive-verification robocall abuse). **The double-edged sword:** the same
medical-device status hands eyewear VTO a **BIPA §10 healthcare exemption** (Dior/Warmack-Stillwell
2023 — eyewear VTO exempt) that makeup/jewelry/apparel VTO on the same page do **not** get.
**Failure mode:** building any "vision test" into the quiz (practicing optometry); assuming the
medical-device BIPA exemption covers non-eyewear try-on.

---

### Haircare
**Distinctive:** layer **four independent axes** — curl pattern (Andre Walker 1–4/A–B–C, but it's
*Eurocentric-critiqued* and captures pattern only), **porosity** (via proxy Qs — dry-time, buildup),
density vs strand-diameter (routinely conflated), scalp/damage/goals. Curl-pattern-only logic is the
trap; "I'm a 3B" doesn't tell you protein vs moisture. Image-choice for curl pattern is best-practice —
**but 4C is chronically under-represented in quiz art**; a set that stops at 3C reads as exclusionary.
**Steal:** scale length to product bespokeness (Prose's 30+ Q *is* the product; an off-the-shelf
recommender needs 5–7). Result = custom formula (ingredient-per-goal transparency) or a numbered-system
regimen (Olaplex).
**Compliance:** the drug/cosmetic line is sharp — **"grow/regrow/prevent hair loss" is a DRUG claim**
(only minoxidil/finasteride are FDA-approved). *A quiz asking "experiencing hair loss?" then routing to
a cosmetic can legally convert that cosmetic into an unapproved drug* — the intended-use trap. Vegamour's
"appearance of density / signs of shedding" framing is the model. Ingestible hair-growth supplements are
a third regime (DSHEA).

### Fragrance
**Distinctive:** the hardest vertical — you can't smell online, so every quiz is a **proxy-inference
router to a sample, not the sale.** Signals (blend 2–3): olfactory families (fresh/floral/woody/amber/
gourmand), **"scents you already love" anchoring** (the most *predictive*), mood/personality (engagement
theater, low validity), occasion, **intensity** (Commodity's Personal/Expressive/Bold). Personality/"ideal
date" questions are entertainment, not prediction — and *Sniff AI* research shows scent-descriptor language
isn't even shared person-to-person.
**Steal:** the **discovery-set with a redeemable credit** ($20 toward a full bottle) IS the conversion
engine — result routes there, not to add-to-cart. Henry Rose "high double-digit" sample→full conversion.
**Benchmark:** RevenueHunt within-store AOV lift is **flat** for fragrance (credible — within-store, not
cross-cohort). Sell on discovery, not basket.
**Compliance:** **EU allergen labeling expands 26→80+ compounds (deadline 31 Jul 2026)**; IFRA usage
standards; perfume is a **Class-3 flammable** (UN1266) — domestic-ground only, Limited-Quantity ≤70%
alcohol; why sample vials dominate the funnel.

### Supplements & vitamins
**Distinctive:** the **most-regulated** quiz vertical. Spectrum curation → compounding → clinical. Spine:
goal framing (energy/sleep/immunity/gut/beauty) → life-stage → diet/lifestyle → **medication cross-check
(a safety function, not a nicety)** → a personalized "pack"/subscription. Evidence/citation cards on
results are the category's trust device. Persona's **4,000-interaction drug-nutrient auto-exclusion** is
the benchmark; collecting the meds answer without *acting* on it is a latent liability.
**Compliance (two regimes bite the quiz itself):** **DSHEA structure/function vs disease** — "supports
healthy energy" ✅ / "treats chronic fatigue / prevents osteoporosis / fixes hormonal imbalance" ❌ (implied
disease via symptom/name/imagery counts); mandatory "not evaluated by the FDA" disclaimer *on the results
page*; FTC now wants **RCT-grade** substantiation for health claims. Never "diagnose" ("your answers
indicate a deficiency") = practicing medicine. **Never say "FDA-approved"** (only a *device* like Baze's
collector can be cleared). *Safety:* large-breed-puppy-style over-supplementation (UL exceedance for iron/
A/D) — cap cumulative doses.
**Failure mode:** disease-claim drift (the #1 risk, acute for AI-generated copy); the **AG1 whole-product
substantiation** class action; unsafe stacks; and the **health-data pixel leak** (see cross-cutting).

### Jewelry & engagement rings
**Distinctive:** three architectures, mostly picked one-at-a-time — **content-quiz-as-top-of-funnel**
(Blue Nile's 7 personality/style quizzes — 10–12 Q, *zero budget/sizing*, hand off to browse),
**configurator-as-the-product** (Brilliant Earth/VRAI "start with a diamond/setting" 3-step build), and
**concierge hybrid** (Ring Concierge/AUrate — quiz is a lead-qual form routing to a human stylist +
home-try-on). Gifting splits recipient/occasion/budget-first (Catbird 3-Q); Jaxxon discovered via quiz data
that **80% of "gift" buyers were men buying for themselves** and re-branched. Engagement rings must teach
the 4Cs *without* overwhelming ("cut ≠ shape" is a named confusion point).
**Steal:** ring size is the hardest remote datapoint — **branch "do you know your size?" don't block it**:
Yes → capture; own-a-ring → printable-circle method; no idea → mail a free sizer + checkout with an
average-size placeholder (women's ~6, men's ~9) and lean on the **free-resize window** as the real
correction. Add a **surprise-proposal branch** (borrow/ask-a-friend/placeholder).
**Benchmark:** lowest site-CVR vertical (~0.9%); avg US engagement ring **$5,200** (64% under $6k, 33%
under $3k) — anchor budget buckets low. Ring-size returns are "the fit problem of jewelry" but **no
rigorously-sourced % exists** (vendor estimates 8–20% conflict) — don't cite a hard number.
**Compliance:** FTC Jewelry Guides (natural vs lab-grown disclosure, karat/"handmade"); the resale-value
asymmetry (lab-grown doesn't hold value) is the one substantive budget-branch fact; IGI-vs-GIA leniency is
a real trust objection but the magnitude claims are thinly sourced. *Note:* James Allen is being folded
into Blue Nile (Signet) — no longer an independent competitor.

### Mattress & sleep
**Distinctive:** the **"short quiz despite a $1,000+ ticket"** pattern — price raises the *stakes* of a good
match but not the shopper's *patience* (drop-off still climbs past ~8 Q). Fit is low-dimensional, so ~9–11
Q span it: **sleep position (most predictive) → body weight (a *feel-transformer* — same bed feels softer
to a heavier sleeper; the input merchants under-weight) → firmness pref → temperature → pain → partner**.
Small catalog → narrow to **one hero + 1–2 alternates**, not a formula. Helix is the benchmark (dual
question sets + compromise logic for couples).
**The real lever = the 100-night trial**, not the quiz (lifts purchase ~20–40% for high-ticket); the
better-matched rec is the *cheapest* return-reducer since returns are dominated by "too firm/too soft."
Casper's pre-IPO filings showed **~20% of revenue in returns/refunds/discounts** — the trial that drives
conversion can swallow the P&L; reverse logistics ~2–3× forward, so brands add 21–30-night break-in gates.
**Compliance:** federal flammability (16 CFR 1633) — the fire barrier is *required*, so never let copy imply
"no flame retardants"; **"organic/natural/non-toxic/VOC-free/CertiPUR" is an active FTC zone** (Essentia,
Ecobaby barred; "organic" needs a reasonable basis) — gate those to substantiated claims.

### Furniture & home
**Distinctive:** *inverts* the mattress flow — **style-first (pick-the-picture, not jargon), then space/
dimensions, material, budget**. Two UI archetypes not to conflate: style-finder → SKU shortlist vs
configurator → one built SKU (Interior Define's 6-step). Ruggable's rug quiz (multi-select *photographed*
palettes) and paint finders (quiz + visualizer) are strong adjacents.
**Return economics are the defining constraint:** furniture online returns **~22.7%**, and **~58% are
size/space mismatch** — a quiz that skips room dimensions optimizes the wrong axis. Per-return cost ~$72–80
(LTL freight ~50%); a single return can erase 50–100% of an item's margin. So ROI here is **returns
avoided**, and the real lever is **AR "view in your room" + AI room-capture** (IKEA Kreativ, Wayfair
Decorify) — which attacks the dominant return driver (unlike mattresses, where "feel" isn't visual → trial).

### Pet (food, supplements, supplies)
**Distinctive:** the **"named-pet plan builder"** — pet name/species first (every screen re-uses it),
signalment (breed/age/**spay-neuter** — changes calorie math), **current + ideal weight + Body Condition
Score** (the most pet-specific input), activity, allergies → a **server-side RER/MER/BCS calorie engine**
outputs grams + calories + price + cadence, credited to a board-certified vet nutritionist. The *plan is
the product* — a "here are 3 recipes" finder (genre B) leaves the subscription on the table. **Fork cats vs
dogs** (obligate carnivore, taurine, texture/hydration) — don't reskin. Sentiment is the conversion mechanic
(44% cite "love of pet" over price for retention).
**Compliance:** result copy is regulated — **AAFCO nutritional-adequacy + life-stage** mapping must match the
recipe; structure/function not disease; **prescription/therapeutic diets need a vet-authorization gate**
(no legal "prescription pet food" category — sold under vet direction); NASC seal for supplements;
"human-grade" is auditable. **Allergy checkboxes filter, never diagnose** (true allergy is ~1–2% of dogs;
route suspected cases to a vet); large-breed-puppy calcium max is a safety gate.

### Food & meal-kits
**Distinctive:** allergen/diet answers are **HARD EXCLUSION filters with liability**, not soft scores — the
architectural difference. Two-layer model: *hard constraints* (9 allergens, vegan) **remove** SKUs;
*soft preferences* (cuisine, spice) only **re-rank**. Spine: household/servings → dietary pattern → allergens
→ cook-time/skill → cuisine → goal → cadence → a **recurring box seeded with week 1**. Thistle is the safety
gold-standard (omit/replace ingredient + explicit "not recommended for severe allergies" disclaimer);
Sakara's "no substitutions" is the anti-pattern. Box-1→box-2 (**35–50%**) is the only retention gate that
matters; skip-as-retention ≈ 2× retention.
**Compliance:** FALCPA + FASTER Act **9 allergens incl. sesame** ("Contains:" statement; advisory "may
contain" is voluntary and can't replace GMP); undeclared allergens are the #1 recall cause + strict liability
(wrongful-death precedent). The **FDA "healthy" rule redefined (2024/25)** — it's a *regulated nutrient-content
claim* now (added-sugar cap + food-group requirement), so auto-labeling a product "healthy" is a substantiable
claim. **GLP-1-aligned quizzes** are the hot 2024–26 trend + enforcement hot-zone (FDA 100+ warning letters;
FTC v. NextMed) — describe *food attributes* (protein/satiety), never a drug outcome (Territory Foods model).
**Builder implication:** the decider engine needs a **hard-exclusion primitive** distinct from scoring; a
result-level disclaimer slot AI copy can't override; and "unknown allergen = exclude."

### Coffee & tea
**Distinctive:** shares fragrance's "can't taste online" problem + a mechanical twist — **brew method must be
question #1** (it gates *grind*; espresso grind in a French press is undrinkable). Anchor taste on **current
habits** (milk/sugar → bitterness/body inference) not self-assessed flavor; a **3-tier adventurousness axis**
(Classic → Subtle → Adventurous) maps onto the SCA Flavor Wheel. The **feedback loop is the moat, not the
quiz** — Trade/Driftaway/Sips By refine per shipment. De-risk the first match with a **sampler/explorer kit**
(the ~28% 90-day churn is mostly first-bag disappointment). Trade = "Spotify for coffee" (normalize a common
roast scale across 55 roasters). Yes Plz's single-blend anti-quiz is the boundary case.
**Benchmark:** AOV lift **flat** (like fragrance). Justify on conversion + retention, not basket.
**Compliance:** light — no caffeine-mg disclosure required; "single-origin" is undefined (don't over-specify);
the real risk is **tea health claims** ("antioxidant"/"lowers cholesterol" → drug claims; real FDA letters to
Lipton/Canada Dry). Keep result copy to *flavor & ritual*.

### Wine & alcohol
**Distinctive:** "can't taste" + the heaviest shipping/age law. Palate quizzes map **everyday taste** (coffee
sweetness, chocolate, citrus) to wine chemistry (Bright Cellars, Winc), refined by a post-shipment **rating
loop**. But **Winc — the palate-quiz poster child — went bankrupt** (Nov 2022): great quiz UX ≠ unit
economics; the quiz is a retention tool, not a business model.
**Compliance is the defining constraint** — resolve *before* building a box they can't buy: **(1) 21+
age-gate** (self-declared splash ≈ 45% underage bypass — necessary not sufficient; 8 states mandate
time-of-sale ID verification); **(2) state DTC-shipping legality** — three-tier system, wine legal in 48
states, **spirits DTC in only ~10** (a wine-eligibility table applied to a spirits SKU is the classic bug);
**(3) delivery = adult-21+ signature, no unattended drop, USPS prohibited**; **(4) TTB mandatory Government
Warning + no health claims** (sharper post-2025 Surgeon-General cancer advisory). Sequence: alcohol/NA branch
→ soft age-gate → quiz → email/DOB → **hard state/ID gate at reveal/checkout**. Treat the eligibility table
as config, class-specific, never hard-coded. NA/low-ABV boom is a growth play *and* a compliance escape hatch.

### Fitness, sports & outdoor
**Distinctive:** early answers are **functional constraints, not tastes** — goal/activity first → **experience/
ability level (the most safety-relevant input)** → environment/equipment → body metrics *last* (highest
friction). The strongest quizzes are **rule-encoded expert fitters** that expose the *why* (weight→snowboard
length, inseam→bike frame, handicap→shaft) because buyers cross-check against known heuristics. Sports-nutrition
is the most quiz-native sub-vertical (Gainful); connected-fitness is *assessment-as-product* (Tonal Strength
Score); performance apparel is under-quizzed (a wedge). Momentous deliberately *doesn't* quiz — informed
premium buyers find it friction.
**Compliance:** supplement structure/function + **RCT-grade** substantiation (FTC 2023); **NSF Certified for
Sport** is the only cert recognized by USADA/major leagues — a "Certified-for-Sport-only" toggle is both a
safeguard and a conversion feature (mis-recommending a non-certified product to a tested athlete is the
category's highest-stakes failure); equipment finders should capture room clearance/weight-capacity as safety
gates (ASTM). **Remote-fit ceiling:** online golf/ski/gait fitting narrows + sets expectations, then *hands
off to in-person* — over-promising precision manufactures returns.

### CBD, sexual wellness & Rx-telehealth (the most regulated)
**The cross-cutting precedent that dominates:** **FTC v. BetterHelp** — an *intake questionnaire* that promised
privacy then shared answers + email + IP of 7M via pixels = **$7.8M + ad-data ban**. Any health-adjacent quiz
firing a Meta/Google pixel on a condition answer is reproducing this. Design invariants: **no third-party
pixels on health-signal events; first-party/server-side only; separate consent to *collect* vs *share* (WA
MHMDA); provider-review gate for anything ending in an Rx (never auto-prescribe); geofencing off near clinics.**
- **CBD** = a *claims + payments/ads* problem: keep copy structure/function (goal = "wind down," never "cure
  insomnia" — answer labels are seller claims), link COAs, expect high-risk payments + LegitScript-gated,
  non-ingestible-only ads. CBD can't be a supplement/food-additive per FDA.
- **Sexual wellness** = a *tone + ad-platform* problem: short, inclusive, "prefer not to say"/skip, optional
  email (Dame's 4-Q quiz). Assume paid social gets blocked (documented discriminatory rejection of women's
  sexual-health ads) → email capture matters more. Therapeutic claims can trigger FDA device rules.
- **Rx/telehealth** = the quiz *is a clinical intake* → eligibility + contraindication screening → **state-
  licensed provider review** → prescribe/decline. HIPAA and/or **WA MHMDA (private right of action)**;
  Ryan Haight for controlled substances; the GoodRx ($1.5M)/Cerebral ($7M) pixel actions. **GLP-1 funnels**
  are the hottest + most-enforced (FDA 30-letter sweep; questionnaire-only intake with no labs is a live
  safety/enforcement risk).

### Baby & kids
**Distinctive:** the buyer profile is **a moving target measured in weeks** — a rec correct at 3 months is
wrong at 5 — so **age-in-months / due-date is the spine and the right answer has a half-life** (forces
*auto-advancing* personalization, not a one-shot result; Lovevery's stage engine is the benchmark, selling
"education as a service"). First question is often **"expecting or already have your baby?"** Recipient ≠
buyer dominates (registry/gifting — Lovevery's gift is an *activation code* the recipient redeems with the
child's birth month, deferring personalization to whoever knows the baby). The buyer is anxious, safety-first,
sleep-deprived → 5–8 Q, mobile, warm, reassuring; independent/expert-endorsed ("earned, not bought" —
SafeInTheSeat CPST-built) out-trusts a thinly-veiled catalog. For consumables, the quiz sets the entry size;
**subscription mechanics own fit over time** (Coterie sizes by *weight* + trial-up packs + time-in-size
nudges).
**Compliance (heaviest child regime):** **CPSC recalls must be *suppressed* by the rec engine** (recall churn
is constant — a banned stroller/seat is a liability event; don't dispense car-seat install advice); **ASTM
F963 age-grading is legally load-bearing** — never recommend a small-parts toy for under-3, surface choking
warnings. **Infant formula** is FDA-regulated with strict claim limits + the WHO Code (never imply
equivalence/superiority to breastfeeding — the "organic-washing" backlash; pediatrician gate on symptom
branches). **The COPPA nuance:** a *parent-facing* quiz (adult answering about their child) is generally
**outside COPPA** ("does not cover information collected from adults that may pertain to children") — it
flips only if the surface is *child-directed*. **The sharper real exposure is state consumer-health-data
law:** a quiz collecting due-date + baby health signals (reflux/eczema/allergy) is sensitive data — **WA
MHMDA explicitly treats pregnancy-inferable retail data as consumer health data, citing the Target
pregnancy-score case by name**, with a private right of action.
**Failure mode:** recommending a recalled SKU; formula over-claiming (ByHeart recall as the trust-fragility
tale); **"congratulations on your baby!" to someone who miscarried** (needs suppression + easy opt-out — the
creepy/harm line); milestone "scoring" that induces the anxiety it's meant to relieve (present milestones as
*ranges, not tests*).

---

## Cross-cutting: the emerging-tactics read (2024–2026)

**The headline reversal:** the loudest hype — *conversational AI replaces the quiz and shoppers buy in the
chatbot* — **empirically failed in its own proving window.** OpenAI walked back in-chat checkout after its own
data showed near-zero completion; **Walmart: in-chat converted at ~⅓ the rate of sending the shopper to
walmart.com.** The reorganized consensus — **"discover in AI, buy on your own site"** — is *good* for a
structured quiz: it's exactly the deterministic, brand-owned conversion surface AI-referred (higher-intent)
traffic should land on. Durable bets: **(1)** be the "buy on your own site" destination, not a chatbot;
**(2) one data model, two payoffs** — a clean, schema-marked product feed powers both quiz recs *and* AEO/agent
legibility; **(3)** an optional *bounded* free-text AI front door mapped onto deterministic branches, keeping
the recommendation engine deterministic; **(4)** for complex-spec catalogs (electronics), productize **need→spec
translation + Good/Better/Best + a 2–3 item comparison table** (Baymard-backed; disintermediation-resistant);
**(5)** make **ZPD→lifecycle activation** first-class (the compounding value exceeds one-shot conversion lift);
**(6) be camera-skeptical** — questionnaire by default; camera only where it yields a measurement a
questionnaire can't (PD is the clear win) *and* you've done explicit consent + no biometric retention;
**(7)** the "cookies are dying" pitch weakened (Google *reversed* 3p-cookie deprecation Apr 2025) — sell ZPD on
**declared intent + consent + quality**, not cookie apocalypse, and treat health-adjacent answers as sensitive
(the CIPA/pixel wave).

## Sources
Per-vertical source lists (tier-graded, full URLs) are captured with each research stream and
will be consolidated here. Load-bearing anchors so far: BIPA try-on litigation (ArentFox Schiff
roundup; Charlotte Tilbury settlement; Dior healthcare-exemption ruling); FDA cosmetic-vs-drug &
anti-aging guidance + warning letters; FTC Eyeglass Rule (2024) & Contact Lens Rule; Coresight
2026 size/fit-returns report; Baumann skin-type taxonomy (PubMed 18555952); peer-reviewed AI
skin-analysis accuracy (Flament 2023, JEADV).


---

# Part 6 · The A/B-testing discipline

How to prove a quiz feature actually *causes* more revenue, instead of trusting a
vendor dashboard that compares quiz-takers to everyone else. Companion to
Part 1 and Part 2;
this is the "prove it behind a holdout" discipline those docs keep invoking, made
operational.

_Last updated: 2026-07-14._

> **The uncomfortable headline, up front.** For most Shopify stores, a statistically
> rigorous test of a *small* revenue effect is **infeasible** — the traffic isn't there.
> The honest move is often to **ship on strong priors and monitor with a small permanent
> holdout** — but you must know exactly which case you're in, and never fool yourself
> with a biased "lift" number. This playbook is mostly about knowing which case you're in.

---

## 1. What to measure

**Primary metric = money per *randomized visitor*, not completion.** Define one Overall
Evaluation Criterion (OEC): short-term measurable, causally tied to the goal (Kohavi/Tang/
Xu). For a quiz that's **Revenue per Visitor (RPV) = total revenue ÷ all visitors assigned
to the arm**:

> RPV = (visitor→purchaser conversion) × (average order value)

- Use **RPV, not conversion alone** — a change can lift conversion while cutting AOV (or
  the reverse); only revenue captures the net.
- The denominator is **all visitors in the arm, including those who never touched the
  quiz.** This one design choice is what makes the estimate causal (see §4).

**Guardrail metrics (must not regress):** AOV / units per order; **return/refund rate**
(mis-fit recs sell then bounce back); overall site conversion & add-to-cart (a quiz
interstitial can deflect buyers who already knew what they wanted); entry-page latency &
bounce; **list quality** (unsubscribe + spam-complaint rate, not just opt-in count);
sample-ratio health (§4).

**Why completion / opt-in mislead.** They're proxies, not the OEC, and both are trivially
gameable — make the gate mandatory or the quiz shorter and opt-in rises while purchase
quality falls. Interact's own cross-platform data: ~40% average opt-in but only **~5.5% of
finishers place a tracked order** — the opt-in number is ~7× the one that actually matters.
Optimizing the big number optimizes the wrong thing. A proxy is only safe if it's causally
upstream of revenue *and* hard to game; completion is neither.

## 2. Experiment design

- **Randomization unit = the persistent visitor** (cookie/login-stable id), never the
  session (same person seeing both arms contaminates the contrast) and never the
  quiz-*taker* (fatal — see §4).
- **Assign at the entry point to the whole population, then measure everyone**
  (*intent-to-treat*): analyze people by the arm they were assigned, whether or not they
  engaged. This is the only design that yields an unbiased causal estimate. Analyzing only
  engagers reintroduces the exact selection bias in §4.
- **Holdout.** For a new feature, a 50/50 quiz / no-quiz split maximizes power. After
  launch, keep a **small permanent global holdout (~5%)** to catch novelty decay and
  re-measure true incrementality over time.

**Sample size & MDE.** Pick the Minimum Detectable Effect *before* running. For two
proportions (95% two-sided, 80% power): **n per arm ≈ 16 · p(1−p) / δ²**. At a baseline
purchase rate **p = 2%**:

| Relative MDE | Absolute δ | ~n per arm | ~Total visitors | Duration @ 10k/mo |
|---|---|---|---|---|
| +10% (2.0→2.2%) | 0.002 | ~80,000 | ~160,000 | **~16 months** |
| +20% (2.0→2.4%) | 0.004 | ~20,000 | ~40,000 | ~4 months |
| +50% (2.0→3.0%) | 0.010 | ~3,800 | ~7,600 | ~3 weeks |

Two brutal facts from this table:
1. A modest **+10% relative** lift on a 2% base needs **~160k visitors** — over a year at
   10k/month. Run at least 1–2 full weekly cycles (never mid-week to mid-week), and never
   below the pre-computed n.
2. **RPV needs *more* sample than shown, not less** — revenue is heavy-tailed (a few big
   orders dominate), so its variance is worse than a clean proportion. Treat the table as a
   floor.

## 3. The low-traffic problem (the main event for real stores)

Most Shopify stores simply **cannot** reach significance on a small revenue effect in a
sane timeframe — the table is the proof. Vendors selling testing tools understate this.
Honest workarounds, most-useful first:

1. **Test bigger swings, not tweaks.** A +50% MDE needs ~20× less traffic than +10%. Only
   run experiments where you truly expect a large effect — *quiz vs no quiz*, a wholesale
   redesign, *gate vs no gate*. Skip button-color optimization; you can't afford the
   resolution.
2. **Move up-funnel to higher-frequency proxies — with caution.** Quiz-start and
   completion happen far more often than purchases, so they reach significance faster. Use
   them to test *quiz UX* (length, ordering, copy) — but they're proxies: a completion win
   is evidence about mechanics, **not** proof of revenue. Confirm direction on RPV +
   guardrails before believing it.
3. **Sequential / always-valid methods** let you stop as soon as evidence is decisive
   without the peeking penalty (§5) — genuinely useful at low traffic for capturing a big
   early effect fast. They don't manufacture signal that isn't there.
4. **Bayesian reporting** ("probability B beats A" + expected loss/uplift) is more
   actionable under thin data than a binary p-value. Caveat: **not immune to peeking**, and
   a bad prior tilts the answer.
5. **Accept "ship on credible priors + monitor."** When a clean test would take a year,
   that's a legitimate answer: adopt on strong external evidence + pre/post monitoring with
   a small permanent holdout, and state explicitly it's a **monitored bet, not a proven
   result.** Supplement with qualitative data (session recordings, a few user tests) —
   insight per-user, not per-thousand.

**What not to do:** run a "test" to 200 visitors, see +20%, and ship. At that sample the
result is noise, and stopping when it looks good is the peeking trap that inflates your
false-positive rate to ~26% (§4).

## 4. Statistical pitfalls

- **Peeking / early stopping.** Repeated significance checks inflate false positives —
  checking after every observation drives the false-positive rate to **~26%** (vs a claimed
  5%). Fix: fix n in advance and look once, *or* use a method built for continuous looks
  (§5). Automated "stop at significance" buttons are a statistical abomination.
- **The selection-bias trap — comparing quiz-takers to all traffic (the #1 error in quiz
  marketing).** Vendor dashboards report "quiz-takers convert ~2.75× store average / spend
  11–15% more." **This is not the quiz's causal lift** — quiz-takers are self-selected
  high-intent shoppers who'd convert higher anyway. The *only* fix is a randomized holdout
  analyzed intent-to-treat (§2): *all visitors with quiz available* vs *all without*.
- **Multiple comparisons.** Test 20 metrics/segments at α=0.05 and ~1 "wins" by chance.
  Pre-register one OEC + a short guardrail list; correct (Bonferroni) or discount surprise
  segment findings.
- **Novelty & primacy.** New features draw curiosity clicks that fade — a real early lift
  can evaporate ("won the test, lost in production"). Run long enough to stabilize;
  re-check against the long-run holdout.
- **Simpson's paradox.** An aggregate winner can lose in every segment when traffic mix
  differs across arms (often from uneven splits). Check per-segment directions agree with
  the aggregate.
- **Sample Ratio Mismatch (SRM) & Twyman's law.** If a 50/50 split doesn't arrive ~50/50,
  the experiment is broken (bots, redirect bugs, differential tracking) — Microsoft found
  ~6% of experiments have SRM. And any result that looks too good is probably wrong;
  investigate large lifts before celebrating.

## 5. Fixed-horizon vs sequential vs Bayesian

| Approach | Decide by | Pros | Honest caveats |
|---|---|---|---|
| **Fixed-horizon (frequentist)** | Pre-set n, analyze once | Simple, best power for a given n, no peeking risk if disciplined | Must wait for full n; **no valid early looks**; painful at low traffic |
| **Sequential (always-valid, mSPRT / Stats Engine)** | Monitor continuously, stop when the always-valid CI crosses | Peek legitimately; stop early on big effects → great for low traffic | Lower power per sample than an optimal fixed test; still cap a max n |
| **Bayesian** | Posterior P(B>A) + expected loss | Intuitive, natural for decisions under thin data, continuous updating | **Not immune to peeking**; prior choice matters and many tools hide theirs |

**Pragmatic pick for a small Shopify store:** sequential or Bayesian — they tolerate the
continuous monitoring you'll do anyway and capture a large effect fast. Neither invents
statistical power; Bayesian still needs stopping discipline.

## 6. Pragmatic test roadmap (ranked by impact × testability)

Spend a tiny experiment budget where the effect is large (detectable) and the decision is
high-stakes.

1. **Quiz vs no quiz at all** (holdout, intent-to-treat, RPV). Biggest possible effect,
   cleanest causal question, directly kills the selection-bias myth. If you run *one* test,
   run this.
2. **Email/lead gate: required vs optional vs post-result.** High stakes (list growth vs
   conversion friction), plausibly large effect, and opt-in is high-frequency so it reaches
   significance faster. Watch the conversion guardrail — gating suppresses buyers.
3. **Quiz length / number of questions.** Completion is high-frequency (testable at low
   traffic); every question past ~8 reportedly drops completion 5–10%. Test on completion,
   then confirm RPV didn't move the wrong way.
4. **Entry point / placement & prominence** (homepage hero vs PDP vs nav). Moderate effect,
   moderate testability.
5. **Recommendation logic / result quality** (algorithm A vs B). Potentially high revenue
   impact but usually a *small* effect that's hard to detect at low traffic — defer to
   sequential/Bayesian, or judge via return rate + qualitative fit rather than a powered
   RPV test.
6. **Cosmetic tweaks** (copy, color, imagery). Lowest expected effect; effectively
   **untestable** on small traffic. Decide by heuristic, not experiment.

**Rule of thumb:** if the pre-computed sample says >~8 weeks at your traffic, escalate to a
bigger swing, drop to a higher-frequency proxy (then confirm on revenue), or make it a
monitored bet on priors — don't run an underpowered test and pretend it settled anything.

## Sources

- Kohavi, Tang, Xu — *Trustworthy Online Controlled Experiments* (OEC, guardrails, SRM ~6%, Twyman, Simpson): https://experimentguide.com/wp-content/uploads/TrustworthyOnlineControlledExperiments_PracticalGuideToABTesting_Chapter1.pdf
- Evan Miller — *How Not To Run an A/B Test* (peeking → 26% FPR): https://www.evanmiller.org/how-not-to-run-an-ab-test.html · sample-size calculator: https://www.evanmiller.org/ab-testing/sample-size.html
- Airbnb Engineering — *Selection Bias in Online Experimentation* (self-selection, winner's curse, global holdout): https://medium.com/airbnb-engineering/selection-bias-in-online-experimentation-c3d67795cceb
- Johari, Pekelis et al. — *Always Valid Inference / mSPRT* (sequential): https://arxiv.org/pdf/1512.04922 · power comparison: https://blog.analytics-toolkit.com/2022/comparison-of-the-statistical-power-of-sequential-tests/
- Sequential vs fixed vs Bayesian: https://www.statsig.com/perspectives/sequential-vs-fixed-tests-use-cases · https://www.convert.com/blog/a-b-testing/frequentist-vs-bayesian-ab-testing/
- Bayesian isn't immune to peeking: https://www.alexmolas.com/2025/10/30/bayesian-ab-test-peeking.html · http://varianceexplained.org/r/bayesian-ab-testing/
- Novelty/primacy: https://arxiv.org/pdf/2102.12893 · Twyman's law: https://atticusli.com/replication-crisis/ab-testing-twymans-law/
- Low-traffic guidance (read skeptically — vendors sell testing tools): https://vwo.com/blog/ab-split-testing-low-traffic-sites/ · https://support.optimizely.com/hc/en-us/articles/4410283325325-Test-tips-for-low-traffic-sites · https://marketingexperiments.com/a-b-testing/testing-small-sample-sizes

> **Credibility note.** The methodology backbone (Kohavi, Miller, Johari, Airbnb) is Tier A.
> The quiz-industry numbers (2.75× conversion, 5.5% order rate, 11–15% AOV) are vendor-
> sourced and cited here as **the thing to distrust** — they are the selection-bias error
> §4 warns against, not evidence the quiz works. Every lift number, including your own, is
> only believable behind a randomized holdout.


---

# Part 7 · The build reference

The knowledge an AI builder references when *generating* a Shopify product-recommendation
quiz: question-writing rules, a question-type decision table, recommendation-logic patterns,
and enforceable generator guardrails. This is the human-readable playbook; its
machine-consumable twin (JSON templates + a structured ruleset the generator loads) lives in
[`quiz-templates/`](quiz-templates/). Companion to
Part 4 (the flow library),
Part 3, and
Part 6.

_Last updated: 2026-07-14._

> **Scope note.** Survey-methodology research (Pew, Krosnick) is about *measurement accuracy
> for research*. A product quiz optimizes for *completion + a recommendation that feels
> earned*, not statistical estimation. Where the goals diverge it's flagged — but the core
> wording/option-hygiene rules transfer directly, because a badly-worded question corrupts the
> recommendation exactly as it corrupts a poll estimate. Tier A = academic/independent (Pew,
> Krosnick, Bosch, NN/g, GESIS); Tier C = quiz-vendor (directional defaults, not audited).

---

## 1. Question-writing methodology (enforceable wording rules)

**Wording**
- **One concept per question — no double-barreled questions.** "Do you value a lightweight
  *and* durable pack?" forces one answer to two attributes and corrupts attribute mapping.
  Split it. *(Pew, Qualtrics, Kantar)*
- **No leading / loaded wording.** Framing swings answers hugely (Pew: "welfare" vs
  "assistance to the poor" moved support >20 pts). Don't editorialize options ("our
  best-selling premium X") — describe the *shopper's* need neutrally. *(Pew, Tier A)*
- **Simple, concrete language at the respondent's level.** No jargon, abbreviations, or double
  negatives. *(Pew)*
- **Avoid agree/disagree ("acquiescence bias")** — less-engaged respondents disproportionately
  agree. Instead of "I prefer matte (agree/disagree)," offer concrete alternatives: "Matte /
  Glossy / No preference." *(Pew)*
- **Watch social desirability** on sensitive attributes (skin problems, budget, body concerns);
  normalize the set so the less-flattering answer feels ordinary. *(Pew)*

**Answer options**
- **MECE — mutually exclusive AND collectively exhaustive.** No overlapping ranges ("$0–50 /
  $50–100" overlaps at 50 → "$0–49 / $50–99"); cover the full space; add "Other / None / Not
  sure" when the set can't be exhaustive. *(Pew, MeasuringU, Alchemer)*
- **Cap single-select at ~4–5 options; ≤7 hard limit for radios; 8+ → dropdown.** Pew: people
  can't hold >5 in mind; NN/g: radio groups >7 overwhelm and long lists belong in a dropdown.
  *(Pew, NN/g)*
- **Order effects are real.** Self-administered surveys show a **primacy effect** (top options
  picked more). Present ordinal scales in logical order (Excellent→Poor); **randomize order of
  nominal options** across respondents; pin "Other/Not sure" last, exempt from randomization.
  *(Pew)*
- **Neutral / "not sure" handling.** Offer an explicit escape rather than forcing a guess (a
  forced guess injects noise into the recommendation). In scoring, treat "No preference" as
  *neutral* (equal/no weight), never as a hidden filter.

**Quiz structure / ordering**
- **Front-load easy, concrete questions;** group by topic; don't stack multiple hard questions
  consecutively. *(Pew + goal-gradient — see Part 4)*
- **Demographics / email late,** unless needed to route eligibility. *(Pew)*
- **Beware context effects** — a specific question before a general one changes the general
  answer. Keep each question independently answerable; don't let Q_N presuppose Q_N-1's answer.

---

## 2. Question-type taxonomy & decision table

**Bias the whole system toward tap-to-select controls (radios / image cards / checkboxes).**
The credible independent finding: **sliders are NOT higher-quality than radio buttons and are
slower** (Bosch et al. 2019; Toepoel & Funke found sliders *worse* and more error-prone on
mobile). On a mobile-first Shopify quiz, prefer discrete taps. **Never emit a slider for a
scale question.**

| Type | Use when the attribute is… | Rules & caveats | Tier |
|---|---|---|---|
| **Single-select (radio / card)** | A **mutually-exclusive** attribute — pick one (skin type, primary goal, budget band). The default. | ≤7 options; MECE; randomize nominal order, fix ordinal order. Maps to one attribute value. | A |
| **Image / visual choice** | **Visual or hard-to-name** (shade, style, finish, "which look is you"). | Same rules; ≤6 tiles for mobile; **text label on every tile** (a11y). | B/C |
| **Multi-select ("select all")** | Shopper legitimately has **multiple simultaneous** attributes (several concerns, dietary flags). | **Accuracy problem:** "select all" causes satisficing/under-selection — Pew measured endorsement ~8 (up to 16) pts lower than forced-choice. **Guard:** prefer forced-choice yes/no per item for short lists; if multi-select, cap ~5–6 and **normalize scoring** (§3.4) so more boxes can't auto-win. | A |
| **Binary (yes/no, this/that)** | A **clean dichotomy** (sensitive skin? gift or self?). | Fastest; great for routing/branching. Don't force a real spectrum into binary. | A/B |
| **Scale / Likert (3–5 discrete pts)** | **Intensity/degree** of one attribute (coverage light↔full, firmness). | **Discrete tap points, not a slider** (Bosch). 5–7 pts optimal for reliability (Krosnick, Preston & Colman); **3–5 labeled points** plenty for a consumer quiz (GESIS). Label every point; keep length consistent. | A |
| **Ranking / prioritization** | Must know the **top priority among several** (price vs ingredients vs speed). | Powerful for tie-breaking but **high effort** — ranking >4–5 causes drop-off. Use sparingly, late, short; often better as "pick your #1" single-select. | B/C |
| **Short text (open)** | A **freeform value you can't enumerate** (name; a specific concern). | Surfaces unanticipated categories but **hard to map deterministically** — use for personalization/lead data, **not** scoring. | A |
| **Dropdown** | A **long enumerable list (8+)** — country, exact shade code, brand. | Only when radios would be too many; dropdowns hide options + are weaker for SR/keyboard — never for ≤7. | A |

**Master rule:** default to single-select radios/cards; escalate to image choice for visual
attributes; scale only for true intensity; multi-select only with the forced-choice/normalize
guard; ranking/text for edge cases.

---

## 3. Recommendation-logic design (answers → attributes → product)

### 3.1 Three canonical architectures
- **(A) Route-based / decision tree** — each answer path → a hand-mapped outcome.
  *Controllable, explainable, but combinatorial:* a 4-Q × 4-answer quiz implies hundreds of
  terminal routes, each needing a manual mapping — unmaintainable and not reliably
  auto-generable. **Use only for a few deliberate top-level forks** (gift vs self;
  men/women/unisex). *(RevenueHunt, Tier C)*
- **(B) Attribute matching / filtering** — each answer tags a **product attribute**; each
  question **filters the catalog** to matching products; the survivors are the recommendation.
  *Scales to any catalog, no per-route authoring, stays in sync as the catalog changes.*
  **The right default for an AI generator** — it maps `question → product metafield/tag`, which
  is machine-derivable from the catalog. *Risk: hard filters can empty the set (§3.4).*
- **(C) Weighted scoring** — each answer adds points to attributes/personas; the highest score
  wins. *Soft, tolerant of imperfect matches, never empties the set; needs tuning; ties.*

**Recommended default = a hybrid:** a *small* decision tree only for genuine hard forks →
**attribute filtering** to shrink the eligible set → **weighted scoring** to rank within it.
This is where the vendors converge.

### 3.2 Weighting discipline
- **Not every question is equally predictive** — give the strongest predictor the most weight
  (skin type worth 15 pts, scent preference 5). Assign each question a **weight tier**
  (primary / secondary / tie-breaker) that a merchant can **see and edit.**

### 3.3 "Earned" and explainable
- **Every recommendation traceable to the answers** — generate a "because you said X and Y"
  rationale from the specific driving answers. An unexplained rec reads as random.
- **Determinism:** identical answers must always yield an identical result. Randomize *display
  order* of options, **never the outcome.** A testable build invariant.
- **Show the fit, not just the product** — the matched attributes are the justification.

### 3.4 Pitfalls the generator MUST handle

| Pitfall | Failure | Required handling |
|---|---|---|
| **Ties** | Two products score equal → arbitrary/nondeterministic pick | Deterministic tie-break chain: primary-question weight → priority/popularity attribute → stable sort by product id. Never random. Optionally show 2–3 as "top matches." |
| **Empty result set** | Hard filters intersect to zero products | Never dead-end. Fallback ladder: relax least-important filter → weighted "closest match" → catalog best-seller. Always return ≥1. |
| **One answer dominating** | A single question's weight (or multi-select box-count) swamps the rest | Cap per-question contribution; normalize multi-select by *proportion* matched, not raw count. |
| **Over-fitting** | So many attributes every product is uniquely pigeonholed → brittle | Prefer scoring over exact routing; keep the attribute vocabulary small and shared. |
| **Non-determinism** | Any randomness / time / inventory-order dependence in scoring | Pure function `(answers, catalog snapshot) → ranked list`. Unit-testable. |
| **Dead questions** | A question whose answers never change any rec | Every question must influence ≥1 filter or score (guardrail §5). |

---

## 4. How existing systems template quizzes (with skepticism)

- **Typeform (AI):** one-question-per-screen; AI drafts questions from a prompt. Borrow the
  **conversational pacing / single-focus screens;** weak on catalog-aware logic. *(Tier C)*
- **RevenueHunt / Shop Quiz:** the most explicit public writeup of recommendation
  architectures — §3 leans on it. Borrow the **attribute-filter + weighted-score hybrid** and
  the honest route-explosion warning. *(Tier C, methodologically the most useful vendor.)*
- **Interact:** **goal/persona-first template library**, tuned for email capture + a tag.
  Borrow the taxonomy; treat its "completion holds to ~6 Q then drops" as a planning heuristic,
  not truth (vendor data, unaudited). *(Tier C)*
- **Octane AI:** Shopify-native, answers → Klaviyo/email profile. Borrow the **quiz-answer →
  marketing-profile** pattern; discount the headline opt-in numbers. *(Tier C)*
- **Shopify Search & Discovery (first-party):** not a quiz tool, but the **canonical primitives**
  a quiz's attribute engine should reuse — **filters** (attribute/metafield), **synonyms**
  (map shopper vocabulary → catalog terms; directly relevant to writing answer labels that
  match product tags), **boosts/merchandising rules**, and **complementary recommendations**.
  A quiz recommendation engine is essentially an attribute-filter + boost layer over the
  catalog — reuse product metafields/tags as the attribute vocabulary rather than inventing a
  parallel one. *(First-party platform docs.)*

**Skeptic's summary:** vendors agree on the *shape* (attribute matching + light scoring, 5–8
short questions, email near the end) — that convergence is meaningful. Their *conversion
statistics* are self-reported; never quote them to a merchant as fact.

---

## 5. Generator guardrails — enforceable checklist

The builder should refuse to emit (or auto-warn on) a quiz that violates these. The structured
version is [`quiz-templates/build-rules.json`](quiz-templates/build-rules.json).

**Length & flow**
- [ ] **Cap ~5–8 scored questions** (hard-warn past ~8–10). Tier-C default the merchant can
  override; **map to category** (Part 4 — gifting/
  durables short, formulation/subscription long).
- [ ] **Front-load easy/engaging questions;** demographics/personal late.
- [ ] Don't place two high-effort questions (ranking, long multi-select) back to back.

**Question integrity**
- [ ] No double-barreled, leading, or loaded question passes review.
- [ ] Every question's options are **MECE**; ranges don't overlap; an "Other/Not sure" escape
  exists where the set isn't exhaustive.
- [ ] **Single-select ≤7 as radios/cards; 8+ → dropdown.**
- [ ] **No sliders** — scale questions render as 3–5 discrete labeled tap points.
- [ ] Multi-select only with the forced-choice/normalize guard and a capped list.
- [ ] Nominal option order randomized (Other/Not-sure pinned); ordinal order logical.

**Logic integrity (the hard invariants)**
- [ ] **No dead questions** — every question changes ≥1 filter or score for ≥1 product.
- [ ] **No dead-end / unreachable paths** — every branch reachable, every path terminates at a
  result.
- [ ] **Every reachable result path resolves to ≥1 product** (validated against the live
  catalog; empty-set fallback ladder defined). *The single most important runtime guardrail.*
- [ ] **Determinism proven** — same answers → same rec; scoring is a pure function.
- [ ] **Tie-break rule defined and deterministic.**
- [ ] **No single question can dominate** — per-question weight capped; multi-select normalized.
- [ ] Attribute vocabulary **shared and small**, reusing catalog tags/metafields.
- [ ] **Recommendation is explainable** — a "because you chose X" rationale is generable.

**Email-gate placement**
- [ ] Gate **late — after the shopper has invested answers, at/just before the result** — never
  the first screen. Category-dependent (see flow templates): at-result for diagnostic/
  formulation/pack/pet/shade; deferred-to-action for fit/durables/gifting.

**Accessibility & rendering defaults**
- [ ] **Native, labeled controls** — real `<input type=radio/checkbox>`, one `<label>` per
  option; radios announce as a group and are arrow-navigable (NN/g).
- [ ] Every option (including image tiles) has a **text label**.
- [ ] **Sufficient contrast**; selection state not by color alone.
- [ ] Mobile-first hit targets (≥24px; this is a storefront surface — mobile is the majority
  case, reinforcing tap-over-slider).

---

## One-paragraph synthesis (for the generator's system prompt)

> Default every question to a single-select radio/card of ≤5 MECE options, neutral non-leading
> wording, one concept each; escalate to image choice for visual attributes, 3–5 discrete
> labeled points (never a slider) for intensity, forced-choice for "multiple concerns,"
> dropdown only for 8+ options. Keep the quiz to 5–8 front-loaded questions (map length to
> category) with the email gate at/just before results. Map each answer to a small shared
> vocabulary of catalog attributes; recommend via attribute-filtering narrowed then
> weighted-scored, with a deterministic tie-break and a never-empty fallback; ensure every
> question changes some outcome, every path reaches a result with ≥1 product, and every
> recommendation can explain itself from the answers that drove it.

---

## Sources

**Tier A:** Pew *Writing Survey Questions* https://www.pewresearch.org/writing-survey-questions/ · Pew *Select Some That Apply* (2019) https://www.pewresearch.org/methods/2019/05/09/when-online-survey-respondents-only-select-some-that-apply/ · Bosch et al. 2019 (sliders vs radios) https://journals.sagepub.com/doi/abs/10.1177/0894439317750089 · Preston & Colman 2000 (optimal response categories) https://www.sciencedirect.com/science/article/abs/pii/S0001691899000505 · GESIS rating-scale design https://www.gesis.org/fileadmin/admin/Dateikatalog/pdf/guidelines/design_rating_scales_questionnaires_menold_bogner_2016.pdf · NN/g dropdowns https://www.nngroup.com/articles/drop-down-menus/ · MeasuringU select-all vs yes/no https://measuringu.com/sata-vs-yes-no-forced-choice/

**Tier B:** Qualtrics double-barreled https://www.qualtrics.com/articles/strategy-research/double-barreled-question/ · Kantar https://www.kantar.com/north-america/inspiration/research-services/double-barrelled-questions-pf · Alchemer best practices https://www.alchemer.com/resources/blog/7-best-practices-for-creating-optimal-survey-questions/

**Tier C (vendor — directional defaults):** RevenueHunt recommendation systems https://revenuehunt.com/product-quiz-recommendation-systems/ + scoring setup https://revenuehunt.com/scoring-quiz-setup/ · Interact "how many questions" https://help.tryinteract.com/en/articles/10752954 · Octane AI https://www.octaneai.com/ · Shopify Search & Discovery https://apps.shopify.com/search-and-discovery

> **Credibility note.** The measurement rules (§1–2) are Tier A — enforce them as hard rules.
> Everything about *recommendation architecture and completion metrics* (§3–4) is Tier C vendor
> material — methodologically consistent and usable as defaults, but not independently audited.


---

# Part 8 · The adversarial audit

An adversarial audit of the committed strategy set (Part 1,
Part 2, Part 3,
Part 4, Part 7,
Part 6). Three independent agents were tasked to *break* the
docs — fact-check every statistic, pressure-test every legal claim, and refute the core
theses. This records what held, what was corrected, and what got retracted, then lists the
corrections applied back to the docs.

_Last updated: 2026-07-14._

> **The meta-finding (applies to the whole corpus).** The docs are so rigorously
> self-skeptical — every impressive number pre-flagged as selection bias, every play
> deferred to an in-house holdout, the marquee play admitted to have "no credible external
> number" — that read adversarially they **do not establish that quizzes drive incremental
> revenue; they establish that no credible causal number for it was found.** That is a
> testable-hypothesis backlog wearing the costume of a strategy. This is *more* honest than
> the vendor ecosystem the docs critique — but the correct posture toward the whole set is
> "unproven, testable hypotheses," and the one place the docs violate their own discipline
> (ranking post-rec progressive profiling as "the biggest ROI") is exactly where the audit
> bites hardest.

---

## Part 1 — Thesis pressure-test (refutation pass)

| # | Thesis | Verdict |
|---|---|---|
| 1 | Quizzes drive incremental revenue worth building for | **SURVIVES weakened** → "worth *testing* in narrow categories"; zero positive causal evidence supplied |
| 2 | The "three loops" framing | **WEAKENED** → a relabeled funnel; useful heuristic, not a validated model |
| 3 | Post-rec progressive profiling = biggest ROI | **RETRACT the ranking** → least-evidenced play elevated to #1 on hedged wishfulness |
| 4 | Mystery everyone-wins discount | **WEAKENED** → under-weights LTV erosion / deal-seeker anchoring |
| 5 | Honest mechanics are costless ROI | **PARTIALLY RETRACT** → honesty carries a *measured* conversion cost; it's an ethics/legal trade, not free (but fake timers genuinely are useless) |
| 6 | Personalization 10–15% (McKinsey) | **WEAKENED number, surviving stance** → Gartner shows it often backfires; the docs' flow-first, own-answers approach dodges the worst |

### 1 · "Quizzes drive incremental revenue worth building for" — SURVIVES, weakened
No controlled study showing positive *incremental* lift is cited, because the docs concede
none was found (completion "flat since 2013," ~55–65% clear the quiz, the marquee play "has
no credible external number"). A quiz is a *net-new friction wall* solving a
problem — choice overload / poor discovery — that has a cheaper, independently-validated
fix: **faceted search & filtering** (Baymard: only ~16% of top ecommerce sites have even a
"good" filtering UX, so for most stores fixing navigation/PDP outranks bolting on a quiz).
Practitioners note most finder quizzes "die at question 3" and only ever reach the minority
who click "Take the Quiz." **Correction:** soften "worth building for" → "worth *testing* in
complex-catalog / high-personalization categories; for many stores, fixing search/filtering
is the higher-ROI first move." *(Sources: Shopify community thread on finder-quiz drop-off;
Baymard product-lists research; hellorep teardown; guided-selling-vs-faceted-search analysis.)*

### 2 · The "three loops" (Complete → Convert → Continue) — WEAKENED
It's a **relabeled linear funnel**, not a growth loop. "Complete → Convert" are sequential
funnel stages (AIDA/AARRR by other names); only "Continue" is loop-shaped, and the one
genuinely compounding mechanic (the shareable result card) the docs demote to "Phase 2." A
real growth loop compounds because output re-feeds input; a quiz completion doesn't generate
new quiz-takers. **Correction:** present the three loops as an *organizing heuristic / table
of contents*, not a mechanism; stop implying compounding. *(Sources: Reforge growth-loops;
growthmethod.com.)*

### 3 · "Post-rec progressive profiling is the biggest under-used ROI" — RETRACT THE RANKING
The docs' clearest self-violation: they rank this "the differentiator / biggest ROI, most
ignored" while conceding **no external study quantifies it.** The prop number (KnoCommerce
"~45% post-purchase response") measures *attribution surveys*, a different activity. Three
independent trends cut against it: **(a)** survey fatigue is worsening (email response ~20–25%
in 2019 → ~10–15% in 2025; ~70% of starters quit); **(b)** the value only exists if the data
is *activated*, and the base rate for activation is failure (~62% of orgs can't use the data
they already hold; only ~24% personalize at scale) — i.e. the doc's own hinge ("worth
near-zero if unused") describes the *median* outcome; **(c)** so the #1-ranked play is the
least-evidenced in the set. **Correction:** downgrade from "biggest ROI / the differentiator"
to "a speculative, optional experiment"; keep the narrow "worth A/B testing" claim only.
*(Sources: koji.so survey-fatigue 2026; clootrack; supermetrics data-activation-gap; cmswire;
these are practitioner/aggregator — directional, Tier B/C.)*

### 4 · The "mystery everyone-wins discount" — WEAKENED
"Everyone wins" solves the *lottery-law* problem but not the *economics*: it's still a
discount, and a *mystery* one anchors "this store always has a deal." Cohort/practitioner
evidence on discount-led acquisition: discount-acquired customers show **~35–45% lower
12-month LTV, ~40–50% lower repeat rate**, and are 2–3× more likely to need a discount next
time — you train a deal-seeking habit and re-anchor "real" prices as markups. **Partial
defenses hold:** the docs gate on *completion* (higher intent than a cold popup), prefer
*non-margin* rewards (free shipping / sample / guide), and mark it EXPERIMENT. **Correction:**
foreground the LTV-erosion + price-anchoring risk; lean harder on the non-margin-reward
preference over a mystery code. *(Sources: niblin, peelinsights — practitioner cohort
analyses, Tier C directional; and the discount literature mostly studies *cold* first-purchase
discounts, so the post-completion context is a partial mitigant.)*

### 5 · "Honest mechanics beat dark patterns (costless ROI)" — PARTIALLY RETRACT
The implicit promise — take the mechanism, drop the exploitation, lose nothing — is refuted
by the best controlled evidence. **Luguri & Strahilevitz (*Journal of Legal Analysis*, Oxford;
large randomized experiment): dark patterns are "strikingly effective"** — mild ones roughly
*doubled* acceptance (11.3% → 25.8%), aggressive ones nearly *quadrupled* it (→41.9%). Several
patterns the docs ban outright are the ones that measurably work (hidden info +15.3pp, trick
questions +14.2pp). So refusing them **leaves real, measured conversion on the table** —
honesty is *not free*. **The honest counter-counter (credit the docs):** the *same* study
found countdown timers / scarcity produced **no significant lift** and "recommended" labels
barely moved — so the docs' specific "skip fake timers" advice genuinely costs nothing.
**Correction:** reframe the honest-mechanics section as a deliberate **ethics + legal +
sustainability trade that forgoes some measured conversion**, not a free lunch — while keeping
the (correct) point that the fake-urgency patterns they ban are useless anyway. *(Sources:
Luguri & Strahilevitz 2021 — Tier A, the load-bearing anchor.)*

### 6 · Personalization ROI (McKinsey 10–15%) — WEAKENED number, surviving stance
Elevating McKinsey's "10–15% (5–25%)" to "the credible planning anchor" is cherry-picking one
consulting survey's optimistic, self-reported, non-causal estimate (range so wide it's nearly
unfalsifiable) over an equally credible pessimist: **Gartner (2019) predicted 80% of marketers
would abandon personalization by 2025 for lack of ROI**, and **Gartner's 2025 survey (n≈1,464)
found personalization *backfires* — negative experiences for 53% of customers, who were 3.2×
more likely to regret a purchase.** With the activation data from Thesis 3, the *median*
personalization outcome is failure-to-activate or backfire, not a 10–15% lift. **The docs'
*stance* survives and is arguably vindicated:** their actual position — ROI lives in *lifecycle
flows* not fancy on-quiz personalization; tie copy to the shopper's *own stated answers*;
insist on holdouts — is exactly the less-creepy, less-overwhelming path Gartner's regret data
points toward. **Correction:** present the McKinsey number *adversarially* (McKinsey optimist
vs Gartner pessimist), not as a clean anchor; keep the flow-first execution guidance. *(Sources:
Gartner 2019 abandon-prediction; Gartner 2025 regret survey; McKinsey — all Tier A/B.)*

> **Verification status:** the two load-bearing independent anchors here — Luguri &
> Strahilevitz effect sizes and the Gartner 2025 regret figures — are being cross-checked in a
> verification wave before any are quoted as settled fact in the main docs. The discount-LTV
> and survey-fatigue figures are practitioner/aggregator (Tier B/C, directional) and are
> labeled as such.

---

## Part 2 — Statistic fact-check

**Headline: the docs are unusually well-sourced.** The large majority of quantitative claims
verify *exactly* against primary sources, and the docs' own debunks (the fabricated NN/g stat,
the Shop Pay "up to 50%" caveat, the Scheibehenne temper on the jam study) are correct. Four
problems, ranked by load-bearingness:

1. **Baymard "26% forced account creation, second only to extra costs" — OUTDATED.** The
   current Baymard list (same URL the docs cite) shows **account creation = 19%** (tied
   3rd–4th, *not* #2); extra costs **39%** (not 48%); checkout-too-long **18%** (not 22%);
   **50 studies** (not 49). The ~70% headline is fine. *Appears in: STRATEGY-II Lever 1 +
   Warnings table, ROI-FUNCTIONALITY row 1, and the visual's "26%".*
2. **Auto-advance "12–13 vs 8–9 items/min, fewer break-offs" — FABRICATED / unsupported.**
   The cited Survey Practice study shows **no significant duration or break-off difference**
   (13.99% vs 14.68%) and frames the ~45% drop in answer-changes as a *downside*. The
   items/min figures appear in no source — and *contradict the docs' own* ROI-FUNCTIONALITY
   row, which reports it correctly. *Appears in: STRATEGY §2.*
3. **Cisco "~80% nervous / 41% benefit-justifies" — MISATTRIBUTED.** Actual Cisco figures:
   **88%** concerned (or 62% about org AI use), **48%** see AI as helpful. Neither 80% nor 41%
   is a Cisco number (direction OK, figures wrong). *Appears in: STRATEGY-II Lever 3.*
4. **Formstack "13.9% vs 4.5%, 650k+ submissions" — WEAK PROVENANCE.** The ratio is
   corroborated (~13.85% vs 4.53%) but traces to a ~2015 vendor report that isn't locatable as
   a live primary; the "650k+" sample is unconfirmable; it's *lead-form* data applied by
   analogy to quizzes. Relabel **Tier B**, drop "650k+", soften to "roughly 3× (vendor data)."

**Verified exactly (spot list):** Iyengar & Lepper 30%/3%; Scheibehenne mean≈0; Nunes & Drèze
34%/19%; Spiegel +270% / 4.0–4.7★ / verified-buyer +15%; McKinsey 10–15%; Baymard ~70%;
Deloitte 0.1s→+8.4%; auto-advance 13.99%/14.68%; SurveyMonkey 89%→79%; chatbot RCT n=206/~90s;
Wroblewski +22%/−42%; Bosch sliders; TCPA $500–1,500; CASL C$10M; NN/g "+12%/22%" correctly
called fabricated; Shop Pay "up to 50%" correctly flagged commissioned; Rakuten +33%; prompt
caching ~90%/85%. (All Tier-A/primary except vendor items, which the docs mostly label.)

## Part 3 — Legal / compliance pressure-test

*Not legal advice.* The behavioral "don't ship dark patterns" advice is sound; the **legal
citations** are where the docs are sloppy. Four "risky-confidence" items, ranked:

1. **Mystery discount "safe harbor (amount may vary)" — WRONG as written; highest risk.**
   A *fixed/deterministic* everyone-wins reward genuinely removes chance (sound). But a
   **random-amount "mystery reveal" reintroduces chance** — everyone winning *something*
   doesn't cure it, which contradicts the doc's own next sentence. Worse, **providing personal
   data used for marketing is treated as consideration in some states**, so a random-value
   reveal gated on email can carry *both* chance and consideration → illegal lottery. And
   "safe harbor" is the wrong term (there's no codified safe harbor; removing an element puts
   it *outside* the lottery definition, state-by-state). **Fix:** strike "(amount may vary)";
   require a fixed/deterministic reward to claim no-chance; note data-as-consideration; align
   STRATEGY.md to the more careful ROI-FUNCTIONALITY wording.
2. **DSA Art. 25 as the binding merchant rule — WRONG STATUTE.** Art. 25 binds *online
   platforms* (marketplaces/social), not a single Shopify merchant (a "trader"), and expressly
   excludes practices covered by the UCPD/GDPR. The *behavior* is prohibited for a merchant,
   but under the **Unfair Commercial Practices Directive + national law + GDPR + FTC §5** —
   re-cite. **EU Digital Fairness Act is NOT law** (consultation closed Oct 2025; a ~Q4-2026
   proposal) — cite as direction of travel, not current regulation.
3. **FTC "$51,744 / Fake Reviews Rule → AI summaries" — OUTDATED + MISCITED.** The penalty is
   now **$53,088** (eff. Jan 17, 2025). And the Rule targets *fabricated* reviews; a faithful
   AI *summary* duty ("must surface negatives") is grounded in **FTC Act §5 deception**, not
   the Rule's per-violation hook — re-attribute (ROI-FUNCTIONALITY already cites §5 correctly
   via "Operation AI Comply").
4. **"Zero-party data is consent-friendly" — misses GDPR Art. 9.** Skincare/supplement/wellness
   quiz answers are likely **health data** needing *explicit* consent + an Art. 9 condition +
   Art. 22 profiling care. Add a carve-out: health-adjacent quizzes need explicit consent, not
   a checkbox; and note CCPA "sale/share" exposure of Klaviyo/Attentive ad syncs.

**Sound as written:** the whole TCPA section (best-sourced — $500–1,500/msg, prior express
written consent, one-to-one rule vacated Jan 2025, 10-business-day opt-out); CAN-SPAM (add:
"save my results" can be transactional, but bundling recs / the abandoned-quiz nudge flips it
to commercial → full compliance); Planet49 pre-ticked boxes; click-to-cancel "vacated";
endowed-progress-as-honest.

## Part 4 — Corrections to apply to the committed docs

**Thesis-level (from the refutation):**
1. **Downgrade post-rec progressive profiling** from "the differentiator / biggest ROI" to a
   *speculative, optional experiment* (STRATEGY-II Lever 4, ROI-FUNCTIONALITY #8, the visuals'
   "biggest ROI · most ignored" tag). *Highest-priority thesis correction.*
2. **Reframe honest-mechanics** as an ethics/legal/sustainability *trade* that forgoes some
   measured conversion (Luguri & Strahilevitz: dark patterns ~2–4× acceptance), keeping "fake
   timers are useless anyway."
3. **Present McKinsey 10–15% adversarially** vs Gartner (2019 abandon-prediction; 2025 regret
   survey — 53% negative, 3.2× more likely to regret).
4. **Soften Thesis 1** — "worth *testing* in narrow high-personalization/complex-catalog
   categories"; name faceted search/filtering as the higher-ROI first move for many stores.
5. **Relabel the three loops** as an organizing heuristic, not a compounding mechanism.
6. **Foreground discount LTV-erosion / deal-seeker anchoring**; prefer non-margin rewards.

**Factual (from fact-check):** 7. Baymard 26%→19%, 48%→39%, "second only"→tied, 49→50,
checkout 22%→18%. 8. Delete the fabricated auto-advance items/min line. 9. Cisco →88%/48%.
10. Formstack → Tier B, drop "650k+".

**Legal (from pressure-test):** 11. FTC →$53,088 + re-attribute AI-summary duty to §5. 12.
Mystery discount: strike "amount may vary" safe-harbor; fixed/deterministic only + data-as-
consideration. 13. Add GDPR Art. 9 health-data carve-out. 14. DSA Art. 25 → UCPD+GDPR+FTC §5.
15. EU Digital Fairness Act = not-yet-law.

**Cross-cutting (from the industry sweep — new material, not in the original docs):**
16. **BIPA camera warning** — any camera/selfie diagnostic (shade, skin, hair, body-scan)
    triggers Illinois BIPA ($1,000–5,000/violation); Charlotte Tilbury settled **$2.925M**, MAC
    proceeding, plus the *Melzer* ruling (AI skin-photo assessment denied the medical exemption).
    A camera-free quiz sidesteps it — state this as a first-class design advantage.
17. **Return-reduction honesty** — fit-tool vendors sell "30–40% fewer returns"; independent
    Coresight (2026) finds real deployments deliver **2–8%** ("the size chart is the lie").
    Claim single-digit-to-low-teens, never 30–40%.
18. **Health-data pixel risk** — a quiz firing health-adjacent answers into Meta/Google/TikTok
    pixels reproduces the GoodRx ($1.5M) / BetterHelp ($7.8M) / Meta-CIPA fact pattern +
    WA My Health My Data Act (private right of action). Gate pixels behind consent; keep
    answers first-party.

## Sources

**Refutation (Part 1):** Luguri & Strahilevitz, *Shining a Light on Dark Patterns*, J. Legal
Analysis 2021 (https://academic.oup.com/jla/article/13/1/43/6180579); Gartner 2019
abandon-prediction (https://www.gartner.com/en/newsroom/press-releases/2019-12-02-gartner-predicts-80--of-marketers-will-abandon-person)
+ 2025 regret survey (https://www.businesswire.com/news/home/20250603316164/en/); Baymard
product-lists (https://baymard.com/research/ecommerce-product-lists); growth-loops
(https://www.reforge.com/blog/growth-loops); discount-LTV (niblin, peelinsights — Tier C);
survey-fatigue (koji.so, clootrack — Tier B/C).
**Fact-check (Part 2):** Baymard cart-abandonment (https://baymard.com/lists/cart-abandonment-rate);
Survey Practice auto-advance (https://www.surveypractice.org/article/6381); Cisco 2023 Consumer
Privacy Survey (https://www.cisco.com/c/en/us/about/trust-center/consumer-privacy-survey.html).
**Legal (Part 3):** FTC 2025 penalty adjustment
(https://www.ftc.gov/news-events/news/press-releases/2025/02/ftc-publishes-inflation-adjusted-civil-penalty-amounts-2025);
sweepstakes/lottery consideration (https://www.beeliked.com/beelegal/amoe-sweepstakes-requirements-state-by-state-us-guide);
DSA Art. 25 scope (https://www.europarl.europa.eu/RegData/etudes/ATAG/2025/767191/EPRS_ATA(2025)767191_EN.pdf);
GDPR Art. 9 (https://gdpr-info.eu/art-9-gdpr/); TCPA one-to-one vacated
(https://www.wiley.law/alert-UPDATE-11th-Circuit-Vacates-FCCs-One-to-One-TCPA-Consent-Rule).
**Cross-cutting:** BIPA try-on litigation (ArentFox Schiff roundup; Charlotte Tilbury
settlement; *Melzer*); Coresight 2026 size/fit report; GoodRx/BetterHelp FTC actions;
WA My Health My Data Act (RCW 19.373). Full per-vertical source lists in
Part 5.


---

# Part 9 · The reveal & the reward — best practices

The post-quiz **results reveal + the earned reward** is the peak-end moment of the whole
experience — it's what the shopper remembers and describes to others — so it earns its own
evidence-based playbook. Synthesized from seven focused research streams (labor illusion &
loading UX, discount timing & framing, strike-through/reference-price compliance, price
presentation, result-page design, and reveal-moment behavioral science). Same tier
discipline as the rest of the doc; the load-bearing findings here are unusually
**Tier-A-heavy** (peer-reviewed), and the vendor-grade claims are flagged.

_Added 2026-07-15._

> **The unifying test (from the audit's dark-patterns literature).** Every mechanic below
> has an honest form and a manipulative one, separated by one line (Luguri & Strahilevitz):
> **persuasion** helps the shopper reach a choice they'd endorse on reflection (transparent,
> true, reversible); **manipulation** engineers a choice they wouldn't make if they saw it
> clearly (obscured, false, coerced). **Reactance is the built-in smoke alarm** — if a
> reveal mechanic only works when the shopper doesn't notice it, it's on the wrong side of
> the line and carries brand/retention risk, not just an ethics problem. The honest versions
> below are "the same mechanic without the lie."

---

## 9.1 The reveal moment — the "calculating your results" animation

**Build a deliberate reveal — it's the rare wait that *adds value* rather than merely being
tolerated.** This is the single most counter-intuitive finding and it's Tier A: **Buell &
Norton, "The Labor Illusion," *Management Science* 2011** (5 experiments, N=116–280, travel
search + online dating — a near-perfect analog for a matching quiz). **Caveat the audit flags:
this measures *perceived value / willingness-to-pay* in lab vignettes — there is no *field*
evidence it lifts e-commerce *purchase*, and it was demonstrated at 10–60s waits, so the
"2–4s" spec below is calibrated inference, not a directly-tested number. Treat the reveal as
an EXPERIMENT (per §9.5), not a proven conversion lever.** Showing the system
*visibly at work* raised the perceived value of an **identical** result even though it made
the wait **longer**; given a free instant option vs. a slower transparent one, **62–63% chose
to wait** when the labor was shown (vs 23% at 60s with a blank bar). The mechanism is
**reciprocity** — perceived effort on the shopper's behalf, not reduced uncertainty or extra
info, and it runs on *perceived* effort, not actual compute. This is a genuine exception to
our "advance in <100ms / kill spinners" rule (Part 1): that rule governs **mid-quiz
navigation friction**; the reveal is the **payoff**, the one place a meaningful beat helps.
**Fast everywhere, one intentional beat at the reveal.**

**The spec (what to build):**
- **~2–4 seconds on desktop; cap at ~2–3s on mobile** (quizzes are mobile-first, and mobile
  attention drops off a cliff after ~3s — the ~8–10s ceiling is a *desktop* number, already a
  loss on mobile). Clears Nah's (2004) ~2s tolerance floor and stays well inside the
  labor-illusion benefit window (below); past that you *must* switch to a true percent-done bar
  + an escape hatch (Nielsen response-time limits), and the value-add is spent.
- **Narrate the *real* steps** — "Reading your 6 answers → matching against 24 products →
  ranking your top fit." A **blind/generic spinner does not capture the lift** (it's
  content-free and signals uncertainty); a **content-shaped skeleton** or narrated labor beats
  it (NN/g; ECCE 2018 — skeletons win *perceived* speed, though the popular "30% faster" stat
  is unsourced folklore, Tier C).
- **Accelerate into a snappy finish; never pause near the end.** Harrison ("Rethinking the
  Progress Bar," UIST 2007): accelerating fill feels fastest; late pauses feel slowest —
  front-load any real slowness so stalls happen early, cache early progress. Texture/shimmer
  moving *against* the fill adds ~**11% perceived speed-up "for free"** (Harrison, CHI 2010).
- **Below ~1s of real compute, show *nothing*** — reveal immediately. A sub-second loader
  *flash* reads as instability and is a net negative (NN/g).

**Two backfire guardrails (the vendor literature omits both):**
1. **Skip the drama if the result might disappoint.** Buell & Norton's Exp 5: dramatized
   effort + an *unfavorable* result rates **worse than an instant reveal** — the shopper
   blames you for the let-down. Stage the reveal for confident, welcome matches; reveal
   plainly otherwise.
2. **The window is short and the labor must be real.** The benefit decays fast (earlier the
   more "Google-fast" the shopper expects), and a **faked** delay is an ethics line that
   *collapses the effect if detected*. Because our matching work is genuine, narrate the real
   steps and you stay on the right side of both the evidence and the ethics.

**Anticipation, honestly (Tier A).** A brief "calculating" beat opens a *curiosity gap*
(Loewenstein 1994) the shopper is now motivated to close, and anticipation carries its own
positive utility (Loewenstein 1987). It backfires the instant the payoff under-delivers the
tease (clickbait reactance) — so resolve the gap generously and keep it to a beat.

**Accessibility (normative).** Default to the animated version, then inside
`@media (prefers-reduced-motion: reduce)` **keep the staged *text* steps and drop the motion**
(shimmer/spin/scale are vestibular triggers). Set `aria-busy="true"` on the results container
during compute and put status in a polite live region so a screen reader announces the
*finished* result **once**, not the micro-steps; **move focus to the result heading** on
completion; never trap focus during the wait. A short full-screen reveal is exempt from WCAG
2.2.2 (Pause/Stop/Hide) as sole content; a longer or in-parallel animation is not.

---

## 9.2 The result page — what the reveal shows

- **Hero-first: one confident primary match, alternates secondary — not a co-equal grid.**
  Diehl & Poynor (*JMR*): a larger visible assortment **inflates expectations**, so the *same*
  chosen product yields **more regret and negative disconfirmation** when picked from a big
  set. And the choice-overload moderators (Chernev meta-analysis, 99 studies) bite hardest
  under exactly the post-quiz shopper's conditions (preference uncertainty, no pre-formed
  ideal) — which is the specific justification for the curated 1–3 recommendation.
- **Match %: use sparingly — it's specifically the *percentage format* that backfires.** *(This
  revises the "match %" trust device recommended in Parts 4–5 for shade/instant-match quizzes.)*
  The precise finding (2026 AVI study, a small cross-domain lab task — treat as directional):
  **raw confidence *increased* appropriate trust; the *percentage format* lowered it** and drove
  over-trust. Novices also don't parse confidence displays well (McNee et al., RecSys). Real-world
  corroboration: **Netflix added a match % in 2021 and is removing it in 2026** in favor of tags.
  So the lesson is narrower than "confidence backfires": prefer **qualitative confidence ("Your
  top match")** or a **high, *explained* score** — avoid the bare percentage (a round "100%"
  reads as fake; an unexplained "72%" invites doubt).
- **"Why this fits you" — tie it to the shopper's *specific answers*, but thin is worse than
  none.** "Because you said *sensitive skin*…" (NN/g: users are forgiving of imperfect recs
  *when they understand the basis*; vague "Recommended for you" underperforms). **Caveat**
  (Tintarev & Masthoff): an explanation that exposes *weak* internal reasoning **lowers**
  trust — transparency isn't automatically trust-positive. Keep it 1–2 lines of real
  reasoning, expandable if wanted; the seven explanation goals (trust, persuasion,
  effectiveness…) trade off, so decide which one the page optimizes.
- **Frame the result as *authored by the shopper*, not handed over.** The "I Designed It
  Myself" effect (Franke, Schreier & Kaiser, *Management Science* 2010) raises willingness-to-
  pay through *feelings of authorship*, over and above preference fit — "You built your
  routine." This rides the **IKEA effect** (Norton/Mochon/Ariely 2012) and effort
  justification (Aronson & Mills 1959) — **but only on *successful completion*** (those who
  failed showed *no* lift), so **never dead-end or error out the reveal**, and show their
  inputs reflected back to cash the endowment.
- **Name the algorithm — shoppers *trust* it (algorithm appreciation), with one caveat.** Logg,
  Minson & Moore (*OBHDP* 2019): non-experts weight advice **more** when told it's from an
  algorithm than a person — so "matched by our algorithm from your answers" is an asset.
  **Caveat (their own Exp 1D):** for *subjective/taste* domains (movies, romantic-partner recs)
  people flipped back to preferring *human* advice — and a product-preference quiz is partly a
  taste domain. So lean on it for the *functional* match ("matched to your skin type"), and pair
  the algorithm framing with a human/expert cue for taste-heavy categories (fragrance, style).
- **Social proof: "others *like you* chose…", item-level, with UGC photos.** Similarity beats
  generic popularity (liking principle); attach a *product-specific* review snippet to the
  matched item at the reveal (each bounce to the PDP to validate leaks conversion); reviews
  with user photos beat text (Baymard).
- **Separate alternatives from complements** (Baymard) — "or consider…" aids the *primary*
  decision; "complete your routine" builds basket, but shoppers won't shop complements until
  they've accepted the main pick.
- **Reciprocity: give the result *first*, in full, then ask.** Regan (1971) — an unsolicited
  favor ≈ doubled later compliance, and mattered more than liking; Strohmetz's "Sweetening the
  Till" — a *personalized* gift amplifies it. The free personalized result *is* the gift.
  **A hard email wall *before* the result flips reciprocity into extortion** (an FTC
  forced-action pattern) — the shopper feels it. Give the answer, then a **soft, declinable**
  ask ("want this sent to you + your reward?").
- **Ride the finish-line pull, honestly.** The last question and the reveal sit at the
  steepest part of the goal gradient (Kivetz 2006); endowed progress (Nunes & Drèze 2006: 34%
  vs 19% completion) is honest only when the head-start reflects a *real* first step.
- **CTA: express checkout at the reveal + a pre-applied incentive.** One-tap express buy on
  the matched product; pre-apply the reward (don't make them hunt a code); show the total
  honestly. The killers: dead-ends, weak recs, and unexpected extra costs (Baymard's #1
  abandonment cause, ~39%).

---

## 9.3 The reward — timing, type, depth

**WHEN — at the result reveal, gate the *deep* reward on *completion*; don't lead with it.** The
best *independent* evidence here cuts against "take our quiz for 10% off": **Lewis (2006, *JMR*)**
— acquisition-discount *depth* is negatively tied to repeat rate and customer asset value; a ~35%
acquisition discount produced customers worth roughly **half** the LTV, because deal-led
acquisition selects for people who haven't formed genuine preference. *(It's observational
customer-panel modeling, not a randomized experiment — the best independent signal, but
correlational.)* **Nuance the audit adds:** "never any upfront incentive" is too binary — the
**hybrid pattern** (a *small* incentive shown upfront that *unlocks a bigger reward on
completion*) banks the start-rate lift without violating Lewis, since the *deep* reward is still
completion-gated. Name it as an explicit A/B variant. Lead with the
*value of the result* ("Find your match in 60s"), not the deal; reveal the reward at the
results moment, gated on completion + email. *(Honesty flag: the "reveal-at-results converts
better" **placement** claims are all quiz-vendor-grade — including Okendo, our own employer,
maximally self-interested there; the **independent** evidence is the LTV/deal-seeker side,
Lewis.)*

**WHAT — prefer free shipping or a free gift over a % discount.** Three reasons stack:
1. **Zero-price effect** (Shampanier, Mazar & Ariely 2007) — "free" out-converts an
   economically *identical* discount; people value *free* as a category. Free shipping also
   attacks the **#1 stated cart-abandonment reason** (extra costs, Baymard ~39%).
2. It **sidesteps the entire strike-through legal exposure** (§9.4) and doesn't erode your
   reference price the way a % does.
3. It **fits a premium, personalized brand** — a loud % undercuts "this is uniquely right for
   you."

**But "free gift" is *not* a settled win — A/B it, don't default it (audit correction).** The
literature is two-sided: Raghubir (2004) found a product offered *as* a free gift is valued
*less* (a bigger/more visible gift signals *poorer* quality of the hero product — the inverse of
what a one-sided reading assumes), and Palazon & Delgado-Ballester (2014) found *promotion-prone*
shoppers (a big slice of the reward audience) get a *better* brand image from a **discount** than
a gift. Guardrails if you use a gift: **require gift↔product congruency, keep it small/premium**,
and A/B by audience. And for **high-AOV carts a % simply saves more money** and can out-convert
free shipping — so free shipping is the strong default at low/mid cart values, not universally.

**If it must be a %:** **Rule of 100** — under ~$100 show **% off**, over ~$100 show **$ off**
(root: Chen, Monroe & Lou 1998; the >$100 "$-off wins" leg is the statistically significant
one; popularized by Berger, not "Chris Anderson"). Keep depth **modest (~10–15%)** — deeper
mostly transfers margin to buyers you'd have converted anyway and *erodes perceived quality*
(inverted-U; premium goods tolerate only ~20% before the discount signals lower quality).
**One-time, single-use code.** A **precise** discount (7.7%) can out-pull a rounded-up one
(8%) by reading as "the firm's calculated best" (Gauri et al. 2024) — never round a computed
discount *up*. Avoid **tensile "up to X%"** (underperforms specific claims, clearance-coded).

**Honest expiry (24–72h).** A *short, genuine* deadline **raises** redemption — Shu & Gneezy
(2010): longer deadlines *lower* it via procrastination; Inman & McAlister (1994): a second
redemption spike right before expiry. Real countdown only — **fake/resetting timers are a
dark pattern and increasingly illegal** (Mathur et al., "Dark Patterns at Scale": ~**157
deceptive/resetting** timers across 140 sites — of 361 sites showing countdowns; FTC/EU targets).

**Mystery vs fixed — default fixed; mystery is an A/B, not a default.** The
**motivating-uncertainty effect** (Shen, Fishbach & Hsee 2015) — people invest *more* effort
for an *uncertain* reward — is real, **but it reverses the moment attention shifts to the
*outcome***, which is exactly where a reward reveal sits. So mystery is a coin-flip at the
reveal. If you test it: keep the **floor genuinely attractive (every outcome a real win, no
near-miss/"try again")** — that's the whole ethical distinction from a slot machine — and
**exclude it for premium positioning** (it cheapens the brand and over-selects deal-seekers).

**LTV — conditional, not absolute.** The "discounts destroy LTV" claim is *overstated*:
Anderson & Simester (2004, field experiments) found deeper discounts **increased** future
purchasing for *first-time* buyers while decreasing it for *established* ones. The real danger
isn't the first discount — it's **training deal-seeking behavior** (selection, reference-price
learning, deal-sensitivity). **Completion-gating + a non-margin reward + one-time code +
modest depth** defuses all three mechanisms — which is precisely why a quiz reward is
structurally better than a spin-wheel popup.

---

## 9.4 The price display — strike-through & presentation

**Strike-through: the conversion upside is real but direction-only, and the lever that lifts
is the lever that creates liability.** Reference-price anchoring raises perceived value and
purchase likelihood (Tversky & Kahneman 1974; Compeau & Grewal meta-analysis) — **but the
effect grows with the *size* of the anchor, which is exactly what regulators flag as
deception.** No credible universal "+N%"; vendor percentages are Tier C.

**Do NOT auto-default a strike-through.** For a discount **everyone who completes the quiz
gets**, the "perpetual/universal sale" trap is fatal: if the product never actually sells at
the struck price, that price is *fictitious* — the exact fact pattern behind **JCPenney
(~$50M), Overstock ($6.8M), Kohl's ($6.15M), Amazon ($2M)**. The hard rules:
- **US FTC Guides Against Deceptive Pricing (16 CFR 233):** the "was/regular" price must be a
  *bona fide* price at which the item was **openly and actively offered in the recent, regular
  course of business** — not an invented MSRP, a formula, or a different product's price.
- **California (Bus. & Prof. Code §17501):** that price must have prevailed **within the last
  90 days**, or the ad must conspicuously state the date it applied.
- **EU (Omnibus Directive, Art. 6a):** the struck price must equal the **lowest price in the
  prior 30 days** — and the **personalized-discount exemption does NOT save a quiz-for-everyone
  discount** (Commission guidance: a reduction "offered to consumers in general although
  presented as personalized," i.e. a code most customers use, is squarely inside Art. 6a).
  Penalties up to 4% of turnover.
- **UK:** DMCCA 2024 / CMA 2025 online-pricing enforcement drive (same genuineness principle).
- **This is live and tightening:** **Amazon's April 2026 reference-price rule** (eff. Apr 23,
  2026) now requires a "List Price" to be *verified against a real recent offer* — driven by a
  lawsuit over fictional Prime Day list prices, i.e. exactly this fact pattern, dated *after*
  this doc was drafted.

**Recommendation:** frame the reward as a **personalized coupon/voucher applied at checkout**
("Your quiz reward: 20% off, applied at checkout"), *not* a "was/now" claim baked into the
result page. If you do offer strike-through, **gate it behind a merchant attestation** that
the compare-at is a genuine regular price, sourced from real price history — not a free-text
MSRP. The modest, direction-only upside doesn't justify strict-liability exposure, especially
for a premium/personalized quiz where a loud discount also dilutes the brand.

**Presentation, for a premium personalized card — the quiet tactics win on *both* the
evidence and the brand filter:**
- **Round, cents-less price in brand ink** — `$180`, not `$179.99`, not red. Charm/.99's real
  purchase effect is **small** (Troll et al. 2024 meta-analysis, 69 studies: g≈0.13, *no*
  quality effect) and a 2026 preregistered study found **precise** prices won "price image"
  while endings didn't move purchase at all — and .99 carries a *bargain* connotation that
  fights premium positioning. **Red price is folklore** as a blanket rule: helps men only,
  **vanishes under high involvement** (exactly a quiz result), backfires on shallow discounts.
- **One integrated "your routine" price; segregate gains, integrate losses** (Thaler 1985):
  show component value + savings as *positive* lines ("Components $X · You save $Y"), one
  combined price to pay. **Never drip or partition a low-benefit surcharge** (shipping/
  "handling"/personalization fee) — bake it in or show a clean "Free shipping" line (Hamilton
  & Srivastava 2008; Santana et al. 2020 — drip pricing corrodes trust and is increasingly
  regulated).
- **Set the sale price *smaller/lighter* than the reference price** (magnitude congruency,
  Coulter & Coulter 2005 — contradicts the giant-bold-sale-price habit); a **horizontal** gap
  between reference and sale price increases perceived discount (vertical doesn't).
- **Precise price only** for small/functional items **or** when the card visibly shows the
  number was *calculated for the user* (bundle math) — otherwise round; hyper-precise reads as
  low-confidence to discerning buyers (Loschelder et al. 2016).
- **No decoys.** The attraction/decoy effect **largely evaporates or reverses with real
  product images/words** (Frederick, Lee & Baskin 2014, "The Limits of Attraction"; Yang & Lynn
  2014 — only 11/91 attempts reliable). *(The 1982 originators pushed back in their 2014 "Let's
  Be Honest About the Attraction Effect" — but it's the *losing* side of that exchange for real
  product cards, not a retraction.)* The **compromise effect** (middle of a good/better/best
  trio) is the only
  robust context effect — but it's structurally *opposed* to a single "perfect pick," so
  adopting a trio to harvest it is a deliberate trade.

---

## 9.5 Feature-matrix additions (reveal & reward)

| Feature | Best evidence | Verdict |
|---|---|---|
| **Staged "calculating your results" reveal (2–4s desktop / ~2–3s mobile, narrated real steps)** | **A** but *perceived-value/lab only — no field CVR evidence* (Buell & Norton 2011; Harrison 2007/2010) | **EXPERIMENT** — guardrails (skip if result disappoints; never fake it) + reduced-motion + mobile cap |
| **Reward = free *shipping* (over a % discount) at low/mid cart value** | **A** — zero-price effect (Shampanier 2007); Baymard | **DEFAULT** over a % — converts + sidesteps strike-through law + premium-safe (at high AOV a % may save more) |
| **Reward = free *gift*** | **A** but two-sided (Raghubir 2004 value-discounting; Palazon 2014) | **EXPERIMENT** — A/B by audience; require gift↔product congruency; keep small/premium |
| **Reward revealed at result, gated on completion** | **A** — Lewis 2006 (LTV); placement itself vendor-grade | **DEFAULT** — never the entry hook |
| **Honest short expiry (24–72h) on the reward** | **A** — Shu & Gneezy 2010; Inman & McAlister 1994 | **DEFAULT if genuinely expiring**; fake/resetting timers = do-not-build |
| **"Why this fits you" tied to the shopper's answers** | **A** — NN/g; Tintarev & Masthoff | **DEFAULT** — but real reasoning, not a thin/generic line |
| **Name the algorithm ("matched by our algorithm")** | **A** — Logg et al. 2019 (algorithm appreciation) | **DEFAULT** |
| **Match % / confidence score** | **A** — McNee RecSys; AVI 2026 | **CAUTION** — qualitative or high+explained only; never spurious precision |
| **Mystery / variable reward** | **A** — motivating-uncertainty (Shen 2015), *reverses at outcome* | **EXPERIMENT** — every outcome a real win; exclude premium |
| **Auto strike-through "was/now" price** | **A** — FTC 16 CFR 233; CA §17501; EU Omnibus | **EXPERIMENT + merchant attestation** — coupon framing is the safer default |
| **Charm .99 / red sale price** | **A** — Troll 2024 meta; Puccinelli 2013 | **AVOID for premium** — small effect, wrong semiotics under high involvement |
| **Drip / partitioned surcharge** | **A** — Santana 2020; Hamilton & Srivastava 2008 | **DO-NOT-BUILD** — corrodes trust, increasingly regulated |

---

## 9.6 · Second peak, added levers & evidence caveats (pressure-test convergence)

The two adversarial audits of this part (2026-07-15) confirmed the marquee claims but surfaced
one big omission and several additions:

- **There are *two* peaks, not one — and this part had ignored the second.** §9.1 frames the
  *result reveal* as "the peak-end moment," but the **order-confirmation / thank-you page** is a
  second peak shown to **100% of buyers at maximum intent**. A one-click *post-purchase* upsell
  there converts far higher than the same offer in a next-day email, yet most brands leave the
  page a dead end. Treat the confirmation page as a first-class surface: reprise the quiz's
  "complete your routine" cross-sell, and place the *reward for the next order* here rather than
  burning margin on the first. *(The mechanism — peak intent at confirmation — is sound; the
  specific conversion multiples are upsell-vendor numbers, Tier C, flagged.)*
- **Peak-end holds *because the quiz is short* — say so, and don't over-generalize.** The
  peak-end rule is robust for **short experiences / short retention intervals** but weakens or
  fails for day-long ones (Alaybek 2022 meta; 2024 review). A 60–90s quiz is squarely in the
  zone where it applies — which is *why* the reveal-and-end investment pays off — but don't
  present peak-end as a universal law.
- **Add a loss-aversion framing of the reward** ("your reward is reserved — claim it before it's
  gone"), distinct from the urgency/expiry lever and typically stronger (loss aversion,
  Kahneman & Tversky). Same reactance caveat as everywhere else: it must reference a *real*
  reservation/expiry, not a manufactured one.
- **Savoring vs impatience — delay the *result*, not the *reward*.** Hardisty & Pfeffer (2020,
  *JCP*): for **small, immediate** rewards, **impatience dominates savoring** — so the
  anticipation beat belongs on the *result* reveal (§9.1), while the *reward itself* should be
  revealed promptly once earned. Don't make the shopper wait to *see the discount*.
- **Most of these are too small to A/B on one store — be honest about it.** A 2–4s reveal tweak
  or a match-%-*format* change produces effects far below the minimum detectable effect a typical
  Shopify store can power (see Part 6). For a single small store these are **"ship on the
  Tier-A priors + monitor,"** not "run an A/B" — real testing needs high traffic, pooling across
  shops, or sequential methods. Don't imply every recommendation here is independently testable
  by every merchant.
- **The soft gate has a measured cost — make the trade with eyes open.** §9.2/Lever 1 default to
  a *soft, after-result* email gate for ethics + list quality; vendor data indicates a **hard,
  pre-result gate can capture ~20–30 percentage points more email** (Il Makiage's model at scale
  — Tier B/C, self-interested). The soft gate is the right *default*, but it trades measurable
  capture for quality/consent — state the cost rather than pretend it's free.
- **Two smaller caveats.** (1) The precise-discount win (Gauri et al. 2024) works partly via a
  *scarcity / limited-time* signal — so it sits in slight tension with the "quiet, non-urgent
  premium" framing; use it where a real deadline exists, not on an evergreen premium card. (2)
  **Scope:** Rule-of-100, charm, and precise-discount effects are largely **US/Western** —
  asymmetric "was/now" pricing reads as *less fair* in more collectivist markets (dual-entitlement
  research); add a scope caveat before applying globally.

## 9.7 · Execution notes — from finding to build

A build-level checklist translating §9.1–9.6 into concrete product decisions. Each names the
**surface**, the **behavior to build**, and the finding it rests on. `DEFAULT` = ship it;
`EXPERIMENT` = validate (per-store if powerable, else platform-pooled — see the decision rule
at the end).

**The reveal (the "calculating your match" beat)**
- Build a **staged reveal component**: on quiz submit, show **~2–3s mobile / 2–4s desktop** of
  **narrated real steps** ("Reading your answers → matching 24 products → ranking your fit"),
  fill **accelerating into a snappy finish**, then reveal. Not a blind spinner; a skeleton of
  the result layout is fine.
- **Guards:** (a) if the computed match is low-confidence / could disappoint → skip the drama,
  reveal plainly; (b) if real compute < ~1s → reveal instantly or hold a *genuine* short beat,
  never a fake delay; (c) `prefers-reduced-motion` → keep the text steps, drop the motion;
  `aria-busy` + a polite live region announces the finished result once; move focus to the
  result heading. **Grade: EXPERIMENT** — ship as a monitored default, watch RPV.

**The result page**
- **Hero-first:** one confident primary match, 1–2 alternates de-emphasized — never a co-equal grid.
- **"Why this fits you":** 1–2 lines tied to the shopper's *specific* answers ("Because you said
  sensitive skin…"), expandable. If you can't generate a *real* rationale, show none.
- **Ownership copy:** "your routine / you built this"; reflect their inputs back.
- **Confidence:** avoid a bare "97% match" → "Your top match" or a high, *explained* score
  (revises the shade/instant-match templates in Parts 4–5).
- **Name the algorithm** for the *functional* match ("matched to your skin type"); add a
  human/expert cue for taste-heavy categories (fragrance, style).
- **Social proof:** item-level "others like you chose" + a product-specific review snippet
  (with a photo), attached to the matched product — not generic.
- **CTA:** one-tap express checkout (Shop Pay) on the matched product + pre-applied reward;
  never a dead-end. Separate "or consider" (alternatives) from "complete your routine" (complements).

**The reward**
- **Timing:** reveal the reward at the result, **instantly** — no suspense animation, no
  spin-to-reveal (impatience beats savoring for a small reward). Gate the *deep* reward on
  completion; don't lead the quiz with it. Optional A/B: the **hybrid** "small upfront incentive
  that unlocks more on completion."
- **Type:** default **free shipping** at low/mid cart (zero-price effect + kills the #1
  abandonment reason); at high AOV a % may save more. Free *gift* only A/B'd, congruent,
  small/premium. Reserve margin % discounts for the **confirmation page (next order)**.
- **Framing:** loss-aversion + endowment — "Your reward is **reserved** — claim before [real
  expiry]." One-time code, real 24–72h expiry, honest countdown.
- **Depth/format:** modest ~10–15%; Rule of 100 ($ off >$100, % off <$100); precise, not
  rounded-up; no tensile "up to X%."

**The price display**
- **Coupon framing by default** ("Your quiz reward: 20% off, applied at checkout") — *not* an
  auto "was/now" strikethrough. If a merchant enables strikethrough, **gate it behind an
  attestation** that the compare-at is a genuine regular price sourced from price history
  (FTC 16 CFR 233 / CA 90-day / EU 30-day-low; the everyone-gets "perpetual sale" trap is fatal).
- **Premium card:** round, cents-less price in brand ink (not `$179.99`, not red); one
  integrated "your routine" price with savings as a *positive* line; sale price *smaller/lighter*
  than the reference; shipping baked in (never drip a surcharge).

**The confirmation page (the second peak — build it, don't leave a receipt)**
- **One-click same-order cross-sell** ("complete your routine") via a post-purchase extension —
  converts far above an email because payment friction is already gone.
- **The comeback reward:** put the *margin* discount **here, for the next order / first refill**
  — at peak satisfaction, without discounting the sale you already won.
- Optional: referral / subscription upsell — the highest-intent moment you get.

**The decision rule — what to A/B vs ship on priors**
- **Ship on the Tier-A priors + monitor guardrails (RPV, return rate):** all the micro-decisions
  above (reveal animation, confidence format, price typography, reward copy) — too small to A/B
  on one store's traffic (Part 6).
- **A/B the big swings a store *can* power:** quiz vs no-quiz, gate placement, free-shipping vs
  %-reward, quiz length.
- **Platform-pooled testing (the builder's unlock):** the small effects an individual merchant
  can't detect *are* testable across the install base — run once at platform scale
  (sequential/Bayesian, Part 6), ship the winning default to every shop. Hand merchants a proven
  default, not a knob they can't calibrate.

## Sources — Part 9

**Reveal / loading (Tier A):** Buell & Norton, "The Labor Illusion," *Management Science*
2011 https://www.hbs.edu/ris/Publication%20Files/Norton_Michael_The%20labor%20illusion%20How%20operational_f4269b70-3732-4fc4-8113-72d0c47533e0.pdf
· Harrison et al., "Rethinking the Progress Bar," UIST 2007 https://www.chrisharrison.net/projects/progressbars/ProgBarHarrison.pdf
· Harrison/Yeo/Hudson, "Faster Progress Bars," CHI 2010 https://www.chrisharrison.net/projects/progressbars2/ProgressBarsHarrison.pdf
· Nah, "Tolerable Waiting Time," *Behaviour & IT* 2004 https://doi.org/10.1080/01449290410001669914
· Maister, "Psychology of Waiting Lines" 1985. **(Tier B):** NN/g response-time limits
https://www.nngroup.com/articles/response-times-3-important-limits/ · skeleton screens
https://www.nngroup.com/articles/skeleton-screens/ · ECCE 2018 skeleton study
https://dl.acm.org/doi/10.1145/3232078.3232086 · MDN prefers-reduced-motion / aria-busy · WCAG 2.2.2.

**Result page & behavioral (Tier A):** Diehl & Poynor, "Great Expectations?!" *JMR* · Chernev
et al. choice-overload meta https://chernev.com/wp-content/uploads/2017/02/ChoiceOverload_JCP_2015.pdf
· McNee et al. "Confidence Displays…" (RecSys) · "Trust Me, I'm Probably Right," AVI 2026
https://dl.acm.org/doi/full/10.1145/3811427.3811445 · Tintarev & Masthoff (explanations)
https://link.springer.com/chapter/10.1007/978-0-387-85820-3_15 · NN/g recommendation guidelines
https://www.nngroup.com/articles/recommendation-guidelines/ · Franke/Schreier/Kaiser, "I Designed
It Myself," *Management Science* 2010 https://pubsonline.informs.org/doi/10.1287/mnsc.1090.1077
· Norton/Mochon/Ariely, "IKEA Effect," *JCP* 2012 · Aronson & Mills 1959 · Logg/Minson/Moore,
"Algorithm Appreciation," *OBHDP* 2019 https://www.hbs.edu/ris/Publication%20Files/17-086_610956b6-7d91-4337-90cc-5bb5245316a8.pdf
· Kahneman/Fredrickson peak-end (JPSP 1993; Psych Sci 1993) + Alaybek 2022 meta caveat
https://www.sciencedirect.com/science/article/abs/pii/S0749597822000334 · Loewenstein curiosity
(Psych Bulletin 1994) & anticipation (Econ J 1987) · Regan 1971 (reciprocity) · Strohmetz et al.
"Sweetening the Till" 2002 · Kivetz/Urminsky/Zheng goal-gradient 2006 · Nunes & Drèze endowed
progress 2006. **(Baymard, Tier A/B):** product-page suggestions & cart-abandonment.

**Reward timing/framing (Tier A):** Lewis, "Customer Acquisition Promotions & Customer Asset
Value," *JMR* 2006 https://journals.sagepub.com/doi/10.1509/jmkr.43.2.195 · Shampanier/Mazar/
Ariely, "Zero as a Special Price," *Marketing Science* 2007 · Chen/Monroe/Lou 1998 (%-vs-$) ·
Anderson & Simester, "Long-Run Effects of Promotion Depth," *Marketing Science* 2004
https://www.kellogg.northwestern.edu/faculty/anderson_e/htm/personalpage_files/Papers/Long_Run_Effects_of_Promotion_Depth_on_New_versus_Established_Customers.pdf
· Shen/Fishbach/Hsee, motivating-uncertainty, *JCR* 2015 · Shu & Gneezy, *JMR* 2010 · Inman &
McAlister, *JMR* 1994 · Gauri et al. (precise discounts), *JCP* 2024 · Mathur et al., "Dark
Patterns at Scale," 2019 https://arxiv.org/pdf/1907.07032

**Price display — compliance (Tier A):** FTC 16 CFR 233 https://www.ecfr.gov/current/title-16/chapter-I/subchapter-B/part-233
· Cal. BPC §17501 · EU Omnibus Art. 6a guidance https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:52021XC1229(06)
· Riverside DA–Amazon; Overstock $6.8M; JCPenney ~$50M; Kohl's $6.15M (law-firm/press, Tier B).
**Presentation (Tier A):** Troll et al. price-ending meta, *JCP* 2024
https://myscp.onlinelibrary.wiley.com/doi/10.1002/jcpy.1353 · Escher et al. 2026 (precise wins
price image) · Thomas & Morwitz (left-digit) 2005 · Coulter & Coulter (font magnitude) 2005 ·
Coulter & Norberg (horizontal distance) 2009 · Puccinelli et al. (red price) 2013 · Frederick
et al. 2014 (decoy limits; Huber/Payne/Puto 2014 is the defense, not a retraction) · Simonson & Tversky 1992 (compromise) ·
Loschelder et al. 2016 (over-precision) · Thaler mental accounting 1985 · Hamilton & Srivastava
2008 · Santana/Dallas/Morwitz 2020 (drip). **Verified nulls to respect:** Wadhwa & Zhang 2015
"round=emotional" *failed* preregistered replication (Harms et al. 2018); the Cornell drop-the-$
effect is single-site and omnibus-non-significant — A/B, don't assume.

**Pressure-test additions (2026-07-15, Tier A unless noted):** Raghubir, "Free Gift with
Purchase," *JCP* 2004 (value-discounting) https://myscp.onlinelibrary.wiley.com/doi/abs/10.1207/s15327663jcp1401&2_20
· Palazon & Delgado-Ballester, *Service Business* 2014 (gift-vs-discount flips on
promotion-proneness) · Hardisty & Pfeffer, "Impatience and Savoring," *JCP* 2020
https://myscp.onlinelibrary.wiley.com/doi/abs/10.1002/jcpy.1169 · Alaybek et al., peak-end
meta-analysis, *OBHDP* 2022 https://www.sciencedirect.com/science/article/abs/pii/S0749597822000334
· Mathur et al., "Dark Patterns at Scale" 2019 — corrected figure: 157 deceptive/resetting
timers on 140 sites (of 361 with countdowns) https://arxiv.org/pdf/1907.07032 · Frederick/Lee/Baskin
2014 & Yang/Lynn 2014 (decoy limits; Huber/Payne/Puto 2014 is the *defense*, not a retraction)
· Amazon reference-price rule, eff. Apr 23 2026 (Tier B) https://www.ecommercebytes.com/2026/04/08/amazon-upends-discount-pricing-with-new-reference-price-rule/
· Netflix removing match % 2026 (Tier B) https://www.indiewire.com/news/business/match-percentages-netflix-going-away-1234944402/
· post-purchase/confirmation-page upsell (Tier C, upsell-vendor — directional) · Il Makiage
hard-gate capture magnitude (Tier B/C, self-interested).

> **Vendor-bias throughline for Part 9:** nearly every headline *quiz* conversion figure
> (RevenueHunt, Octane, Interact, and spin-to-win popup vendors) is self-published and
> measured on a self-selected finisher denominator — directional ceilings, not causal lift.
> Okendo (our employer) appears in the reveal-timing evidence and is flagged the same as any
> vendor. The load-bearing findings above are the **Tier-A behavioral and legal** anchors,
> not the vendor numbers.
