# Account and Billing Handoff

## Open, pending and site-wide

Read this first. The page itself is small; most of the risk is in the items below. Nothing here is settled by the mock unless it says **Decided**.

### Owner decisions still open

Each row says what the mock shows today so the build can start, and what it blocks.

| # | Question | The mock assumes | Blocks |
| --- | --- | --- | --- |
| 1 | Which event is an engagement? The owner's rule is "the start of a quiz". The app has two candidates: `quiz_started` fires when the quiz renders (a view), `quiz_engaged` fires when the shopper leaves the intro or first interacts. | `quiz_engaged`, once per quiz per session. It is what Home and Analytics already call "engaged", so the numbers match. Billing on `quiz_started` would charge a credit for every page view of an embedded quiz. | Usage recording |
| 2 | The real numbers: credits per plan, the price of a credit on each plan, the rate of each AI feature, the trial length, the slider's minimum, maximum and step. | 400 / 2,200 / 7,250+ credits; $0.15 and $0.10 a credit; 0.2 and 0.1 credit per AI use; 14 days; 50–2,000 step 50 and 100–5,000 step 100. | Nothing in the build (all are values in one list), but nothing ships without them |
| 3 | Plan names. | Starter, Growth, Enterprise. | Copy only |
| 4 | The spending cap. Shopify's Billing API makes a maximum usage charge per 30-day cycle mandatory (see Shopify billing). What is the cap on each plan, and what happens when a shop reaches it: keep serving and stop charging, or ask the merchant to raise it? | Not shown. The mock has no cap. | Overage billing |
| 5 | Is there a free plan, and what does Cancel mean? | No free plan. Cancel keeps the plan until the cycle ends, then the quizzes come off the store; quizzes and results are kept. | Cancel flow, the runtime gate |
| 6 | Do plans differ by anything other than credits? | The low plan allows 2 live quizzes and has no A/B testing or custom CSS (copied from Octane). The downgrade dialog names those losses. | Downgrade dialog copy, plan gates site-wide |
| 7 | What happens on a downgrade to quizzes over the new plan's limit? | "Only 2 quizzes can be live. You pick which ones." No picker is designed. | Downgrade flow |
| 8 | Is the price of a credit the same when a shop runs out without buying (overage) as when it buys ahead (top-up)? | Yes. One rate per plan. | Pricing list |
| 9 | "Every cycle" credits: added on every bill until removed? (The owner's word was "permanently".) | Yes. Removal takes effect on the next bill date. | Recurring add-on |
| 10 | If a shop is already over and then buys credits or upgrades, do the new credits cover the overage in that cycle? | Yes. | Overage maths |
| 11 | Do one-time credits roll over like plan credits? | Yes, once, for 30 days. | Rollover maths |
| 12 | The paywall on AI help in onboarding and the builder (for example AI design tweaks). The owner said it sits "behind a paywall"; which kind is not decided: locked during the trial, plan-gated, or charged in credits. | Nothing. It is not metered and not mentioned on the page. | Out of this build; see site-wide work |
| 13 | Yearly billing. | Monthly only. | Out of this build |
| 14 | Should the credit slider stop where the next plan becomes cheaper? | It keeps going, with a mark at that point and an upgrade prompt. | Slider maximum |
| 15 | Where "Talk to us" (Enterprise) goes. | A toast saying a form opens. No form exists. | Enterprise button |
| 16 | Which shops see Account. Standalone workspaces (`Shop.source = "standalone"`) can't be billed through Shopify, and no other payment processor is chosen. | Shopify-installed shops only. | Account for standalone shops |

### Site-wide work outside this page

These follow from the billing model. None of them is designed here, and each needs its own task.

- **A usage record for the whole app.** Every engagement and every AI use has to be stored with its shop, quiz, feature and credits. The owner wants the same record for internal tracking, per feature and per shop. Today `AiUsage` is one row per shop per UTC day (tokens and calls), with no feature and no quiz.
- **The daily AI ceilings fight paid credits.** `AI_BUDGET_RUNTIME_DAILY_USD` (default $2 per shop per day) switches off AI on live quizzes once reached (`checkAiBudget(…, "runtime")` in `q.$id.rec-copy.tsx` and `q.$id.ai-chat.tsx`). A shop that is paying for credits would be cut off at $2 a day. Decide how the two live together: credits replace the ceiling for paying shops, or the ceiling stays as a much higher abuse backstop.
- **AI-written personalization becomes opt-in.** `Shop.aiRecCopyEnabled` defaults to `true` (schema, migration `20260703120000_add_ai_rec_copy_enabled`, and the `?? true` fallback in `runtimePayload.server.ts`). The July owner call was "default on"; the October call is opt-in. Existing shops need a value too.
- **The credit tag across the builder.** Every control that turns on a per-use AI feature carries the tag (see Credit tag). Placing it in the new builder belongs to the builder work; the two controls that exist today are listed below.
- **Plan gates.** If plans limit live quizzes, A/B testing or custom CSS (decision 6), those limits have to be enforced where the features live, including at publish.
- **Taking quizzes off the store.** A cancelled or ended plan means `/q`, the embed and the launcher stop serving that shop's quizzes. That is a runtime change, the highest-risk edit class in this repo, and the byte-pinned legacy quiz must not change.
- **Uninstall deletes everything.** `webhooks.app.uninstalled.tsx` deletes the `Shop` row and cascades to its quizzes and products. Cancel in Account is not uninstall and must keep the data. The cancel dialog promises that quizzes and results are kept.
- **The paywall for merchant-side AI** (decision 12): funnel generation, why-copy, path review, brand guidelines and builder help all spend AI today under `AI_BUDGET_MERCHANT_DAILY_USD`.
- **Low-credit signal outside Account.** The teal signal is reserved for things that cost money if ignored. A shop that is nearly out or over probably wants the teal dot on the rail's Account item and a line on Home. Not designed.
- **Email templates.** The receipt and the two alerts need designed templates. Only their triggers and contents are specified here.
- **The embedded `/app`.** It is not launched. When it is, it needs the same page in the Shopify admin's look (Built for Shopify 4.1.1), reached through the admin's own navigation, with plan changes completed inside the admin.
- **Who can change the plan.** Anyone who can sign in to `/studio` sees Account and can change or cancel the plan. There are no roles.
- **Stale prices elsewhere.** The wiskr.ai pricing mock (Free / $49 / $149) and the App Store listing must show the same plans as this page; the App Store requires the listing to match what is charged.
- **A way for us to grant credits.** Support refunds and goodwill credits need an internal tool. Not designed.
- **"Engagements" must mean one thing.** Account, Analytics and Home should all count the same event (decision 1).

### Left out on purpose

Yearly billing, invoice PDFs, payment-method management, pausing a plan, coupons, and a merchant-set spending limit of our own. Payment method, tax details and tax invoices live in Shopify; Account links there.

## Summary

Build one page, **Account**, and one sub-page, **Change plan**, in `/studio`.

- **Where it lives.** The rail's footer shows "My account" today as a label that goes nowhere (`app/components/chrome/Rail.tsx:140–146`, `.qz-rail-account`). Rename it **Account** and make it a link to `/studio/account` with the same active state as the other rail items. `/studio/settings` stays exactly as it is.
- **Routes.** `/studio/account` (plan, credits, bill emails, past bills) and `/studio/account/plan` (plans, more credits, cancel). The sub-page has a back button to Account.
- **Scope.** `/studio` only. The shopper quiz is untouched by the pages themselves; recording usage and switching quizzes off are separate tasks with their own risk (see What must be recorded).
- **Nothing exists yet.** There is no billing configuration in `app/shopify.server.ts`, no plan or credit table, and no usage record per feature.
- **Mock.** [Wiskr Billing mock](https://claude.ai/artifact/JTRf5iGdWsUtNBkQjivB6w). It is the contract for layout, copy and behaviour. Numbers in it are examples.
- **Shopify takes the money.** Every action that changes what a shop pays ends in a hand-off to Shopify's approval screen and returns to Account.

## Reading the mock

- The dark bar at the top is preview controls, not product. **Page** switches Account / Change plan / Credit tag. **On plan** and **Credits** switch the example data.
- Deep links: `#change`, `#tag`, `#near`, `#over`, `#trial`, `#starter`.
- The store, the quizzes, every number, the plan names and the plan feature lists are examples. All values come from one block at the top of the page's script (`PLANS`, `AI_FEATURES`, `USE`, `QUIZZES`, `HIST`).
- The mock's maths is the spec for how figures relate (what adds up to what). Its example values are not.
- Buttons that would leave the page show a toast describing what happens instead.
- After a confirmed change the mock updates its own state so the result is visible (new plan, added credits, "Ends Oct 18"). Switching **On plan** or **Credits** resets that.
- The card edge and the print strength in the mock come from the Home contrast study and are not final. See Look.

## Billing rules

**Decided** = the owner's call. **Placeholder** = the rule is decided, the number is not. **Assumed** = the mock's reading, shown to the owner, not yet confirmed.

| Rule | Status |
| --- | --- |
| Three plans at $50, $200 and $500+ a month. The top plan is not self-serve. | Decided |
| Each plan includes a number of credits per cycle (400 / 2,200 / 7,250+). | Placeholder |
| 1 credit = 1 quiz engagement, and an engagement is the start of a quiz. | Decided (which event: open, decision 1) |
| AI features on a live quiz are charged per use, in fractions of a credit. Each feature has its own rate. | Decided (rates: placeholder) |
| A reused AI answer costs the same as a fresh one. | Decided |
| Product recommendations are not charged. They come from the quiz logic, set up once. | Decided |
| AI-written personalization is off until the merchant turns it on. Every per-use AI feature starts off. | Decided |
| Credits a shop doesn't use roll over once and last one more cycle (30 days). | Decided |
| Rolled-over credits are spent first, because they expire first. | Assumed |
| Quizzes never stop when credits run out. Credits used past what was available are billed per credit at the end of the cycle, as their own line on the bill. | Decided |
| The price of a credit depends on the plan and falls as the plan rises, so the bigger plan is always the better deal. | Decided (prices: placeholder) |
| A shop can buy more credits on its current plan: once, or on every cycle, in any whole number. | Decided |
| Upgrades start immediately and are charged pro rata. Downgrades start on the next bill date. | Assumed |
| A 14-day free trial. Changing plan during the trial is free; cancelling in the trial bills nothing. | Placeholder |
| Cancel keeps the plan until the cycle ends. | Assumed |
| Alerts at 80% of the cycle's credits and when they run out. A receipt on every bill. | Decided |
| The cycle is Shopify's 30-day app billing cycle, not the calendar month. | Fact |

A constraint for whoever sets the prices: on each plan, the price of one extra credit must be higher than the next plan's price divided by its credits. With the placeholders, Starter is $0.15 against Growth's $200 ÷ 2,200 = $0.09.

### The AI feature list

One list, used by billing, the "i" on Account, the usage record and the credit tag. A new AI feature is added here and nowhere else.

| Key | Name on screen | One use is | Rate | Served by |
| --- | --- | --- | --- | --- |
| `rec_copy` | AI-written personalization | one results page shown with AI copy | 0.2 (placeholder) | `app/routes/q.$id.rec-copy.tsx` |
| `ask_ai` | Ask AI | one AI reply in the shopper chat | 0.1 (placeholder) | `app/routes/q.$id.ai-chat.tsx` |

### How the figures relate

- **Available this cycle** = plan credits + every-cycle credits + one-time credits bought this cycle + credits rolled over from the last cycle.
- **Used** = engagements × 1 + the sum over AI features of uses × that feature's rate.
- **Left** = available − used, never below 0. **Over** = used − available when that is above 0.
- **Next bill** = plan price + every-cycle credits × rate + over × rate. It is labelled "so far" while over.
- **Rolls over at the cycle's end** = whatever is left, once. Credits that were themselves rolled over expire.

## Shopify billing

Checked against shopify.dev on 1 October 2026. Confirm each point in the current reference before building.

Apps on the Shopify App Store must bill through Shopify. There are two ways, and neither covers the whole design:

| Need | Shopify App Pricing (the default for new apps) | Billing API |
| --- | --- | --- |
| Monthly plan | Yes | Yes, `appSubscriptionCreate` |
| Per-credit overage | Yes, as usage events. No cap is possible. | Yes, `appUsageRecordCreate`. A `cappedAmount` is mandatory: the most a merchant is billed for usage in a 30-day cycle. |
| One-time credits | No | Yes, `appPurchaseOneTimeCreate` |
| Every-cycle credits in any amount | Only as predefined plans (8 public plans at most) | Yes, as a new subscription at the new monthly price, approved by the merchant |
| The plan picker | Shopify hosts it | Ours (the Change plan page) |
| Free trial | Yes | Yes |

**Recommendation: the Billing API.** The design has one-time top-ups, an any-amount recurring add-on and its own plan page, and App Pricing supports none of the three. What that brings:

- **A cap is required** (decision 4). At 90% of it Shopify sends `APP_SUBSCRIPTIONS_APPROACHING_CAPPED_AMOUNT`. Merchants can raise the cap themselves in the Shopify admin.
- **Every money action returns a confirmation URL.** Our dialog's "Continue in Shopify" sends the merchant there; Shopify sends them back to the return URL, which is `/studio/account`. The change is real only after that return, or the webhook, confirms it.
- **Shopify's docs position the Billing API for "existing apps and outlier pricing models".** Confirm with Shopify that a new public app may launch on it before committing.
- **Merchants can change or cancel outside our UI.** Account must read the live subscription, not only our own record. Subscribe to `APP_SUBSCRIPTIONS_UPDATE` and `APP_PURCHASES_ONE_TIME_UPDATE`.
- **Upgrade and downgrade timing** is set by the subscription's replacement behaviour. The mock's rule (upgrade now, downgrade at the next bill date) should be what Shopify's standard behaviour does; verify, and verify how proration is charged.

Notes on the current code:

- `/studio` signs in by magic link, not by a Shopify session. Billing calls need the shop's stored offline session; `app/shopify.server.ts` already exports `unauthenticated`.
- `app/shopify.server.ts` pins `ApiVersion.January25`; `shopify.app.toml` registers webhooks at `2026-07`.
- The charge lands on the merchant's Shopify invoice. An app cannot read that invoice, so **Past bills** is our own record, in USD before tax, with a link to Shopify for the tax invoice.
- Use test charges on development stores.

Sources: [Shopify app billing](https://shopify.dev/docs/apps/launch/billing), [Shopify App Pricing](https://shopify.dev/docs/apps/launch/billing/managed-pricing), [usage-based subscriptions](https://shopify.dev/docs/apps/launch/billing/subscription-billing/create-usage-based-subscriptions), [one-time purchases](https://shopify.dev/docs/apps/launch/billing/support-one-time-purchases).

## What must be recorded

These are requirements. The schema is the dev's call; migrations in this repo are hand-authored.

1. **Plan state per shop:** plan, status (trial, active, ending), cycle start and end, trial end, every-cycle credits, a pending downgrade, the cancel date, and the Shopify subscription it mirrors.
2. **Credits granted per cycle, by source:** plan, every-cycle, one-time, rolled over (with its expiry).
3. **Usage:** every engagement and every AI use, with shop, quiz, feature key, time and credits. It has to answer three questions: the cycle total, the split per feature, and the split per quiz.
4. **Bills:** per cycle, the bill date, plan, credits available, credits used, credits over, the lines and the total.
5. **Bill emails:** the saved addresses and the three switches, per shop.
6. **The feature list** above, in one place.

Where the facts come from today:

- **Engagements.** The runtime posts events from the shopper's browser to `app/routes/events.tsx` (CORS-open, rate-limited per IP), stored in `Event` with `eventType`. `quiz_started` fires on render; `quiz_engaged` fires when the shopper leaves the intro (`QuizRuntime.tsx`, near the `track("quiz_engaged")` calls). `QuizSession` rows are written once, on completion (`app/routes/sessions.tsx`), so they do not count starts.
- **Browser-posted events can be blocked or forged.** Decide whether billing may count from them or needs a server-side record of the start. This is the main design question on the recording side.
- **AI uses.** Both endpoints run on the server, so counting there is reliable. `rec-copy` returns `{ copy, cached }`; charge on both.
- **Anything under `app/components/runtime/**` or in the `/q` payload is the highest-risk edit class.** Prefer recording on the server endpoints. The byte-pinned legacy quiz must hash the same after every deploy.

## Account page

One column, 840px, centred in the room the rail leaves. Cards top to bottom:

### 1. Header

"Account" on the left, the shop's domain on the right (`Shop.shopDomain`).

### 2. Your plan

- Label "Your plan", the plan name, and a status chip: **Active** (green) or **Free trial · 9 days left** (violet wash).
- A second, grey chip when a change is pending: **Starter from Oct 19** (downgrade booked) or **Ends Oct 18** (cancelled).
- One line: "$200 a month · 2,200 credits each cycle". Both figures include every-cycle credits.
- **Change plan** goes to `/studio/account/plan`. It is the only action on this card. Cancel is not here.
- The bill box on the right: the label is "Next bill", "First bill" during a trial, or "Last bill" once cancelled. Then the amount, the date, and one line per item: the plan, added credits if any, extra credits if over. The amount is followed by "so far" while the shop is over.

### 3. Credits

- **Heading row:** "Credits", the "i", and on the right the cycle's dates and days left. In a trial: "Free trial · ends Oct 10 · 9 days left".
- **The "i"** opens on hover, focus or click, and closes on Escape or a click elsewhere. It says: "1 credit: 1 quiz engagement: a shopper starts a quiz" and "0.1–0.2 credit: 1 use of an AI feature on a quiz. Each feature has its own rate." The range is the lowest and highest rate in the feature list.
- **The figure:** "1,043 left of 2,380 this cycle". When over: "131 over your 2,380 credits this cycle", in teal. In a trial: "left of 2,200 in your trial".
- **The meter:** violet for the share used. When over, the bar is full: violet for what was available, teal for the part over. Under it: "56% used" and the total, or "All 2,380 used" and "+131 extra".
- **The teal banner** appears in two cases, with a **Get more credits** button that opens Change plan:
    - At 80% or more, not yet over: "84% of this cycle's credits are used. When they run out your quizzes keep running, and each extra credit is $0.10."
    - Over: "Your quizzes are still running. You're 131 credits over, which adds $13.10 to your Oct 19 bill so far." If the plan, added credits and overage together already cost more than the next self-serve plan, add: "Growth would have cost $200.00 this cycle."
- **Used** (left): "Quiz engagements" with the count of shoppers; "AI features, charged per use" with total uses; under it one indented line per AI feature with its uses, its rate and its credits; then "Used so far". Every feature in the list is shown, at 0 if unused.
- **Current cycle** (right): "Included in Growth"; "Added every cycle" and "Bought one time" only when above 0; "Rolled over from last cycle" with "Use by Oct 18" only when above 0; then "Total".
- **By quiz:** a table with one row per quiz that had usage in the cycle. Columns: Quiz, Engagements, one column per AI feature, Credits. A dash where the quiz doesn't use the feature. A last row, "All quizzes", which equals the Used figures.
- **Footnote:** "Product recommendations come from your quiz logic and use no credits. Credits you don't use roll over once and last 30 more days."
- Credits are shown as whole numbers. Rows and columns must add up to the totals shown.

### 4. Bill emails

- A "Send to" field and **Save**. Save adds the address to the list under the field and clears the field.
- Each saved address is a chip with a remove button. More than one address is allowed.
- Errors, under the field: "Enter a full email address, like name@yourstore.com." and "name@x.com is already on the list."
- With no addresses: "No email saved. Receipts and alerts aren't being sent."
- Three switches, all on by default: "Receipt on every bill", "Alert at 80% of your credits", "Alert when your credits run out". The last one's sub-line states the plan's price per extra credit.
- The list starts with the store's Shopify email. The page doesn't say so.

### 5. Past bills

- Columns: Bill date, Plan, Available credits, Credits used, Total cost, and an **Email receipt** action.
- Extra credits are not a column. They are inside Credits used and inside the total, and they are a separate line on the receipt and on the Shopify invoice.
- **Email receipt** sends that bill's receipt to the saved addresses. With none saved it says "Save an email under Bill emails first."
- In a trial there are no rows: "No bills yet. Your first bill is on Oct 10, 2026."
- Footer: "Credits used past what was available are a separate line on that bill." and a link, **Invoices in Shopify**, to the Shopify admin's billing page.

## Change plan page

### 1. Header

A back button to Account, "Change plan", and on the right "You're on Growth · 1,043 credits left" (or "131 credits over").

### 2. Plans

- Three tiles: name, price a month, credits each cycle, the price of more credits on that plan, and a short feature list.
- The current plan is marked "Your plan" and has no button. Lower plans: **Downgrade**. Higher self-serve plans: **Upgrade**. The top plan: **Talk to us**.
- Under the tiles: "Upgrades start today and you pay only for the days left in this cycle. Downgrades start on your next bill date, Oct 19." In a trial: "Change plans during your trial at no cost. Your first bill, on Oct 10, is for the plan you're on that day."

### 3. More credits

- Heading "More credits", and on the right "$0.10 a credit on Growth".
- **One time / Every cycle.** One time: "A single top-up, added today." Every cycle: "Added to your plan on every bill, until you remove it."
- **The amount:** a number field and a slider on the same value, with the price beside the field ("$50.00 · one time", or "a month, added to your plan").
    - The slider moves in steps. The field takes any whole number between the minimum and maximum and is clamped when the merchant leaves it.
    - It opens on the plan's usual amount. If the shop is over, it opens on the overage rounded up to the next step.
    - **The mark:** a tick on the track at the amount where this plan plus the added credits costs the same as the next plan, labelled "1,000 · same price as Growth". Amount = (next plan's price − current monthly price) ÷ price per credit. Hide it when it falls in the first or last eighth of the track.
- **The summary line:** "500 credits today, charged once. What you don't use rolls over like the rest." or "Your plan becomes $250.00 a month with 2,700 credits each cycle."
- **The button** carries the amount and the price: "Buy 500 credits · $50.00" or "Add 500 every cycle · $50.00 a month".
- **Existing every-cycle credits** show as a row above the button: "You add 500 credits every cycle · $50.00 a month" with **Remove**.
- **The upgrade prompt** (violet wash): "Growth is $200 a month for 2,200 credits. That's $0.09 a credit instead of $0.15." When the plan with these credits costs as much as the next plan or more, add: "Starter with these credits comes to $237.50." On the plan below Enterprise it reads "Need this many every cycle? Enterprise starts at 7,250 credits and a lower price per credit." with **Talk to us**.

### 4. Cancel

The last card on the page, and the only place Cancel appears.

- "Growth stays on until Oct 18 if you cancel. After that your quizzes come off your store." with **Cancel plan**.
- In a trial: "Cancel before Oct 10 and you pay nothing. Your quizzes come off your store when you cancel." with **Cancel trial**.
- Once cancelled: "Growth is cancelled and ends on Oct 18. Changed your mind?" with **Keep Growth**, which undoes it without a dialog.

## Dialogs and messages

Every dialog opens from a click, never by itself. Each has a quiet button on the left and the action on the right. Actions that go to Shopify say **Continue in Shopify**. Destructive confirms are red.

| Dialog | Shows | Buttons | Afterwards |
| --- | --- | --- | --- |
| Upgrade to Growth? | Price, credits each cycle and price of more credits, each as old → new; Starts: Today; You pay today: about the price difference × days left ÷ 30 | Not now / Continue in Shopify | Back on Account, on the new plan. "You're on Growth." |
| Downgrade to Starter? | The same three rows; Starts: the next bill date; Until then: you keep the current plan; then what is lost (decision 6) | Keep Growth / Continue in Shopify | Account shows "Starter from Oct 19". "Starter starts Oct 19. You keep Growth until then." |
| Buy 500 credits? | Credits: +500 today; Price: $50.00, charged once; On your bill: its own line | Not now / Continue in Shopify | Account shows "Bought one time 500". "500 credits added." |
| Add 500 credits every cycle? | Credits each cycle old → new; Price a month old → new; You pay today: about the pro-rata amount | Not now / Continue in Shopify | Account shows "Added every cycle 500" and the new monthly price. |
| Remove the 500 added credits? | "You keep them for this cycle. From Oct 19 your plan goes back to $200.00 a month." | Keep them / Remove (red) | The row is gone. |
| Cancel Growth? | Stays on until the cycle ends; then quizzes come off the store; extra credits used before then are on the last bill; quizzes and results are kept | Keep Growth / Cancel plan (red) | Account shows "Ends Oct 18" and "Last bill". |
| Cancel your free trial? | Quizzes come off the store today; quizzes and results are kept | Keep trial / Cancel trial (red) | "Trial cancelled. Nothing was billed." |

In a trial the upgrade and downgrade dialogs show "Starts: Today, still in your free trial" and "First bill: $200.00 on Oct 10" instead of a charge today.

Confirmations appear as a short toast. The full list of strings is in the mock's script; use them as written.

## Emails

Sent to every saved address, through `sendEmail` in `app/lib/email.server.ts`. Templates are not designed (see site-wide work).

| Email | Sent | Contains |
| --- | --- | --- |
| Receipt | On each bill date, and on demand from Past bills | Plan and price; added credits; credits available and used; extra credits as their own line; the total before tax; that the tax invoice is in Shopify |
| 80% alert | Once per cycle, the first time usage reaches 80% of the cycle's credits | Credits used and left; the price of an extra credit; a link to Change plan |
| Run-out alert | Once per cycle, when credits reach 0 | That quizzes keep running; the price of an extra credit; a link to Change plan |

Buying credits can take a shop back under a threshold. Each alert is still sent at most once per cycle.

## Credit tag

A small grey pill on any control that turns on an AI feature charged per use. It reads "AI", the rate, and what counts as one use: **AI · 0.2 credit per results page**.

- **Which features:** only AI that runs each time a shopper uses the quiz. Product recommendations carry no tag.
- **Opt-in:** every tagged feature starts off.
- **Where:** on the control that turns the feature on, and again at the top of that feature's own settings. Nowhere else.
- **Wording and look:** no dollar amounts, because the price of a credit depends on the plan. Grey, the same on every feature. It states a cost and is not a warning, so it never uses the teal signal.
- **One list:** the tag reads the same feature list as Account.

The two controls that exist today:

- **The personalization switch.** `RecCopyToggleCard` ("Shopper AI · Personalized recommendation copy"), rendered in `studio.integrations.tsx` and `app.settings.tsx`. Rename it "AI-written personalization", add the tag, default it off. New sub-line: "Off unless you turn it on. On: AI writes a "why we recommend this" paragraph for each shopper. Your product recommendations come from your quiz logic either way and use no credits."
- **The Ask AI screen type** (`ask_ai`), where a merchant adds it to a quiz. The tag goes on its row in the add-a-screen list. Its placement in the new builder is the builder work's to decide.

## Look

Light only, desktop only, nothing animates.

- **Shell and tokens:** the shipped `/studio` Home. Quartz tokens from `app/styles/quizocalypse.css`, Figtree, solid white cards with a 22px radius on `--qz-edge`, pill buttons, the Crest print on the page ground only.
- **Card edge and print strength:** the mock uses a stronger edge and the print at 65%, both from the Home contrast study, which is not closed. Use whatever Home ships. Do not give this page its own values.
- **Inner boxes** (the bill box, the amount box, plan tiles, dialog rows): 12px radius, a 1px `--qz-rule` border, `#FBFAFD` fill. No shadows inside a card.
- **Teal** (`--qz-teal`, `--qz-teal-wash`) appears only in the nearly-out and over states: the banner, its button, the over figure and the over part of the meter.
- **Red** only on destructive confirms (Cancel, Remove) and the email field error.
- **Green** only on the Active chip.
- **Violet** on primary buttons, the meter, the current plan tile, the slider and the upgrade prompt's wash.
- **Sizes:** page title 30/700; card heading 17/700; labels 10.5/700 uppercase; body 13.5–14; the credits figure 40/800; plan name and prices 27–30/800. All figures use tabular numerals.

## Acceptance checklist

- [ ] The rail's footer item reads "Account", links to `/studio/account`, and shows the active state there and on Change plan.
- [ ] `/studio/settings` is unchanged.
- [ ] Account shows the live plan, including a change made in the Shopify admin.
- [ ] Used = engagements + AI credits; Current cycle adds up to its total; the By quiz rows and columns add up to the Used figures.
- [ ] The 80% banner, the over banner and the "would have cost" sentence appear exactly under the conditions above.
- [ ] Over a cycle boundary: unused credits roll over once and expire at the end of the next cycle; rolled-over credits are spent first.
- [ ] A shop that runs out keeps serving quizzes and AI features.
- [ ] Overage is one line on the bill, inside Credits used and Total cost in Past bills.
- [ ] Upgrade, downgrade, one-time credits, every-cycle credits and their removal each go through a dialog and Shopify's approval, and Account shows the result on return.
- [ ] Declining on Shopify's screen changes nothing.
- [ ] The slider and the field stay in step; the field accepts any whole number in range; the mark sits at the break-even amount.
- [ ] Cancel appears only at the bottom of Change plan; cancelling keeps quizzes and data; Keep undoes it.
- [ ] Bill emails: save adds, duplicates and bad addresses are refused with the messages above, each address can be removed, the three switches persist.
- [ ] Each alert is sent once per cycle; the receipt is sent on the bill date and from Past bills.
- [ ] AI-written personalization is off for a new shop, and the tag is on its switch and on Ask AI.
- [ ] No dialog opens on its own.
- [ ] The byte pin holds after deploy.

## Files

The design files are untracked. They exist only in the owner's checkout; a fresh clone won't have them. The owner sends `billing-handoff.zip`: unzip it at the repo root and every file lands at the path named here.

- `docs/design/settings/billing/billing.src.html`: the mock's source. Edit this.
- `docs/design/settings/billing/build.py`: inlines the logo and the print, writes `index.html`.
- `docs/design/settings/billing/index.html`: the built mock, the same page as the link above.
- `docs/design/settings/billing/BILLING-HANDOFF.md`: this document. `build_handoff.py` renders it to `handoff.html`.
- `docs/design/home/first-run/assets.json` and `docs/design/background-print/tiles/print-crest.svg`: the logo art and the print the mock builds from. `tiles/crest-10.svg` is the print behind the handoff page.
