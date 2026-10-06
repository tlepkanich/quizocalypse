# Analytics Handoff

*Wiskr admin · dev handoff · updated 7 October 2026 · code references checked against `origin/main` at `a540be1` · mock: [Wiskr Analytics Mock](https://claude.ai/artifact/DoTWmdQZdJgN5zDBeBaXCJ) (also sent as `analytics-main.html`)*

## Read first

The mock is finished and reviewed. It covers the Analytics Overview (all quizzes) and the seven tabs of one quiz (Overview, Revenue, Questions & Answers, Products, Quiz flow, Customers, Compare), plus the contacts panel that opens from almost every number. Every figure in the mock comes from one example data set, and the final review checked that the figures agree with each other on every tab, in all three example data sets.

Today's analytics on `origin/main` already has the same seven tabs and most of the underlying counts. Most of this build is therefore a new interface over existing queries. The exceptions are listed under "Structural work or design only" below.

### The biggest changes

1. **One layout on every screen**, on the Home look (Crest print, white cards, Tight edge): a one-line header, full-width folder tabs, then a first card that holds the date range and the headline figures, then the detail. The date range follows the reader in a slim bar once it scrolls away.
2. **Every number opens the contacts behind it.** Answers, results, result boxes, Customers figures and bars open one contacts panel that always shows the number that was clicked, with consent, Export, Copy emails and "Create Klaviyo segment".
3. **Products became a journey table**: Shown, Clicked, Added to cart, Bought, Revenue, Returned, Days to return. An opened row explains how shoppers reach the product in the Logic step's own words. Products no logic reaches are flagged.
4. **Revenue answers more questions**: AOV, revenue and AOV per result, and the top products by their own line revenue.
5. **Customers figures are about what to do next**: Can be emailed, Bought, No purchase yet, Added, not bought.
6. **Compare to previous period** is one switch beside the date range. On Overview and All quizzes it splits the first card into two periods.
7. **Insights** are collapsed by default, show a count, and open into a data-first box: Data, Impact, Analysis, and why the item was listed.
8. **KPIs show a number and a name only**; every detail sits in a tooltip that waits for the pointer to rest.
9. **Long names and big numbers have rules**, so nothing breaks the layout and no number is ever cut.
10. **Branching quizzes show their paths**: side by side in the journey map, grouped in Step by step, and named on every question that only one path sees.
11. **Attribution becomes 14 days from starting the quiz**, in the code and in every label.

### Structural work or design only

**Design only**: the page can be built from data and queries the app already has. **Query**: a new or changed server query over data already stored. **New data**: something must start being recorded (a webhook, a stored field, a credential). **Integration**: a new call to an outside service.

| Area | What the mock needs | Type | On main today |
|---|---|---|---|
| Page shell | Header, folder tabs, first card, sticky date bar, KPI tooltips, long-value rules, chart style | Design only | Seven tabs exist in `QuizAnalyticsView.tsx`; this replaces their look |
| Date range | The seven presets, with "All time" | Design only | `resolveAnalyticsRange` and `RANGE_PRESETS`; rename "Since published" to "All time" |
| Attribution | 14 days from starting the quiz | Query | `DEFAULT_ATTRIBUTION_WINDOW_MS` is 72 hours, measured from completion; the label constant says 7 days |
| Compare | Previous-period totals (started, finished, contacts, orders, revenue, bought), step drop-off and answer shares, counted the same way as the current period | Query | Only engaged and completed, filtered by event time rather than the session cohort, so the two periods count differently |
| Overview funnel | Started, Finished, Left an email, Bought | Query | Bought must count shoppers (converted sessions), not the first session per order |
| Revenue figures | Revenue influenced, attributed orders, AOV, per completion | Design only | Revenue and orders exist; AOV is revenue ÷ orders |
| Revenue by result | Orders, revenue and AOV per result | Query | Doesn't exist yet. Needs the results fix (Data work 3) |
| Top products by revenue | Each product's line revenue | New data | The orders webhook stores product ids only, no price or quantity |
| Results everywhere | Result names for contacts, responses, "Where shoppers ended up", journey result boxes | Query | A session stores its result node id, but the analytics looks it up as a category id, so names come out empty. Decider quizzes get no result counts at all |
| Products table | All products, not 50; "Add all to cart" counted per product; preview clicks excluded | Query | `productPerformance` caps at 50 rows |
| Returned, Days to return | Refunds per product and date | New data | No refunds webhook or store; the `read_orders` scope already covers `refunds/create` |
| How shoppers reach a product | Rule, Starting set and Narrows sentences per product | Query | `pathsByProduct` returns up to four question-answer pairs and ignores rules, `target_ids` and narrowing. Reusable pieces: `resolveTarget`, `narrowIdsByFilters`, `enumeratePaths`, `routeTrace` |
| No logic flag | Mapped products no answer path reaches | Design only | `computeReachability` and the "unreachable-products" insight exist (published decider quizzes only; ignores hide rules and narrowing) |
| Answers | Counts per option, most common answer | Design only | `answerDistributions` (options are sorted, so the first is the most common) |
| Individual responses | All responses, paged, exported | Query | The 100 most recent, no paging, no export |
| Quiz flow | Steps, drop-off, steepest, median | Design only | `buildStepLedger`; return the median it already computes inside the insights rule |
| Branching paths | Each path's steps with reached, left and drop-off; where paths split and join; per-path answer counts | Query | `buildStepLedger` gives lanes after a branch counts only, and the drop-off insight runs on linear quizzes only |
| Customers figures | Can be emailed, Bought, No purchase yet, Added, not bought | Query | Consent is stored (`EmailCapture.marketingConsent`) but never read by analytics; "Added, not bought" replaces today's "abandoned" (session not completed) |
| Contacts | Counts over every contact | Query | The list is capped at 500 and the counts are taken after the cap |
| Contacts panel | Filter contacts by an answer, a result or a product, server-side | Query | Result and product filters run in the browser over 500 rows or fewer; no answer filter |
| Exports | A CSV per section, following the range and filters on screen | Query | Contacts CSV only (studio), and it ignores the range and the filters |
| Copy emails | Full emails of the contacts in the panel | Query | Doesn't exist yet |
| Klaviyo connection | One connection per shop, in Integrations; quiz actions use it | New data | Today a private key is pasted into each quiz's integration node and stored in plain text in the quiz document |
| Create Klaviyo segment | One call to Klaviyo's Create Segment endpoint | Integration | No segment code |
| Klaviyo profile data | Readable question text, the result name, consent | Integration | Sends `quiz_q_<id>` keys, no result, no consent |
| Insights | Rules and format | Design only | `buildQuizInsights` has every rule the mock shows; dismissing one should bring in the next (it doesn't today) |
| A/B variants | Entered, Completed, Clicked | Design only | `aggregateVariantFunnel` |
| Analytics Overview | Every quiz, totals, previous period | Query | Top 10 published quizzes only, counted by event time; the overview lists every quiz, drafts included |
| Compare tab | Month rows and "vs month before" | Design only | "Metrics by month" exists |

## Reading the mock

Open the [mock](https://claude.ai/artifact/DoTWmdQZdJgN5zDBeBaXCJ). The dark bar along the top is not part of the product. It switches what the page shows, so every state can be checked without real data.

| Control | Options | What it shows |
|---|---|---|
| Screen | All quizzes · One quiz | The Analytics Overview, or one quiz with its seven tabs |
| Data | 5 results · 42 results · 1 response | A live quiz with three months of traffic; the same traffic on a quiz with 42 results and 200 products; a quiz with a single session and no Shopify store |
| Paths | One path · Branching | A quiz that goes straight through, or the same traffic on a quiz that splits after Question 1 (Path A: Dry or Sensitive → Questions 2 and 4; Path B: everyone else → Question 3) and joins again at Question 5. Branching needs traffic, so it does nothing with "1 response" |
| Klaviyo | Connected · Not connected | Whether the contacts panel offers "Create Klaviyo segment" or "Connect Klaviyo" |
| Text | Typical · Long | Long makes every name very long (quizzes, results, products, questions, answers, one email domain) and multiplies money by 100, to check that nothing breaks |

Each tab has its own address: `#all`, `#overview`, `#revenue`, `#answers`, `#products`, `#flow`, `#customers`, `#compare`.

All example figures come from one seeded generator inside the mock. Change the inputs, never the printed numbers.

## Rules for every screen

### Look

- Page ground: the Crest print at 6.5%, light only. Cards are solid white, 22px corners, the Tight edge (a 14% ring plus a soft shadow), at least 18px apart, in a 1120px column. This is the same ground and edge as Home.
- No text sits on a violet fill. Labels go above bars, never inside them.
- No dark mode.

### Header and tabs

- One quiz: one line, "Analytics › {quiz name} Live", with "Open in builder" on the right. A long quiz name stays on one line and ends in "…"; the full name shows on hover. All quizzes: just "Analytics Overview".
- The seven tabs are folder tabs joined to the first card. They span the card's full width and are all the same width and height, with 13px labels centred. The open tab is white with a violet top edge and bold label; it is not taller or bigger than the others. The first card under the tabs has square top corners. Customers shows its contact count beside the name.
- At the narrowest desktop windows the longest tab ("Questions & Answers") may grow a few pixels rather than be cut.

### Date range and Compare

- The date range sits in a strip at the top of the first card on every screen: "Date range", a select (Last 7 days, Last 30 days, Last 90 days, Last 6 months, Last 12 months, All time, Custom range…) and the resolved dates.
- "Compare to previous period" sits beside it. It is off by default. It appears on All quizzes, Overview, Revenue, Questions & Answers, Quiz flow and Customers, and not on Products or Compare. The previous period is the same number of days immediately before the range.
- With Compare on, previous values read "was 32%" in grey under the figure. Changes on headline figures use ▲/▼ with a percent for counts and points for rates. On Overview and All quizzes the first card splits into "This period" and "Previous period" columns on one shared bar scale.
- When the first card's date strip scrolls out of view, a slim bar sticks to the top of the content column: "{quiz name} · {tab}", the range, the dates and Compare. It always stays on one line; the title is cut first.

### KPIs

- Every KPI shows only its number and its name, centred. Rates, "x of y" counts, math such as "$7,372 ÷ 750" and explaining sentences live in a tooltip on that KPI.
- The tooltip waits: it opens only after the pointer rests or slows on one KPI for 350 ms. Moving faster than 0.6 px/ms restarts the wait, so sweeping across the page never opens one. Once open it follows the pointer, and it closes on leave, scroll or redraw. The same rule applies to every tooltip on the page (chart bars, contact bars).
- A KPI with a tooltip gets a soft background on hover and a help cursor. The tooltip text is also present for screen readers.
- What stays on screen: Compare's "was …" lines and ▲/▼ changes, and notices such as "Too few to read a rate from yet".
- Numbers in a row share one baseline, also when only some of them have a "was …" line.
- Figures of nine or more characters ($100K and up) step down a size so they stay on one line.

### Long values

- Names in rows and tables (products, results, quizzes, emails, A/B variants) stay on one line and end in "…".
- Headings that may wrap (insight headlines, highlight product names, result boxes, the contacts panel title) stop at two lines. Result boxes always reserve two lines so their numbers line up.
- Numbers are never cut. Columns are sized for them.
- No horizontal scroll at desktop width. Anything cut shows its full text on hover.

### Words

- The merchant's question and answer text appears exactly as written. No generated short names.
- "Completions" for counts ("Revenue per completion"), "shoppers who finished" for people. Never "finisher".
- One money name: "Revenue influenced". "AOV" for average order value.
- No verdicts on products ("over-shown", "healthy" and the like). The one exception is the "No logic" flag.
- No intensifiers such as "clearly" or "just". State the numbers and the plain reason.
- No "i" buttons. "How we count this" opens the method drawer.
- Every section's download button says "Export".

### Charts over time

- Bars sit close together from the left edge, where the range starts. Each period gets a slot of at most 96px; its bar (at most 48px wide) is centred in the slot with its date directly underneath. With many periods, as in the daily view, the slots shrink so every bar fits.
- A period still in progress is drawn hatched and labelled "partial".
- With Compare on, the previous period's bar sits beside each bar in a lighter violet.

## The screens

### Analytics Overview (all quizzes)

- **First card.** Quiz sessions (tooltip: "Across 3 live quizzes in the last 90 days."), then Completion rate, Contacts captured and Revenue influenced, each with its detail in the tooltip. Compare splits the card.
- **Quizzes table.** Quiz name, Status (Live, Draft, or a warning tag such as "1 result only"), Starts, Completion, Contacts, Orders, Revenue, Per completion, then a "Review ›" pill on live quizzes and "Edit ›" on drafts. Filter All / Live / Draft with counts, search, Export, and sortable headings (Revenue, highest first, by default). Live rows open that quiz's Overview.
- **Insights** across all quizzes, collapsed, each headline starting with the quiz name.
- The figures in the first card are the totals of the live rows.

### Overview

- **First card, left.** Completion rate, a hairline, then Revenue influenced.
- **First card, right.** "Where shoppers go": Started, Finished, Left an email and Bought, each as "N of 1,053 shoppers" with a bar out of the shoppers who started. Rows link to Quiz flow, Customers and Revenue. Without a Shopify store, Bought reads "Not measurable here" and revenue reads "Not measurable".
- **Too few sessions** (under 50): the left side shows "Sessions so far", the count, a visible notice with the range the rate could sit in, and a meter marked "50 · rates firm up" and "200 · reliable".
- **Compare on:** the card splits into This period and Previous period, rows aligned, bars on one scale, change only in the current column, plus a Revenue influenced row and a "Compare month by month" link.
- **Insights.** Collapsed on load: "Insights" with an amber pill holding only the count, and Show / Hide. Opening shows up to three items, the first one open, then "N more waiting". A closed item shows its tag (Drop-off, Products, Contacts, Traffic, Logic), a headline that starts with the number, and the impact figure on the right. An open item shows one box in two equal columns: Data | Impact on top (centred figures, Impact on a light grey ground) and Analysis | Why we're calling it out underneath. Then a primary action, a link action and Dismiss (hides it for 14 days; it comes back if nothing changes).
- **A/B variants** (only when a test is running): Variant, Split, Entered, Completed (with the rate from 150 entered), Clicked. No test name above the table.

### Revenue

- **First card.** Revenue influenced, then Attributed orders, AOV and Revenue per completion.
- **Revenue by week.** Day / Week / Month switch and Export. "Show the table" opens a sortable table (period, completions, orders, revenue, per completion; with Compare: previous and change).
- **Revenue by result.** One row per result: name, bar, revenue, orders and "$78.85 AOV". The top 8, then "Show all". A row opens the contacts panel on that result's buyers, with a note tying orders to contacts ("40 orders came from this result: 28 from shoppers who left an email…").
- **Top products by revenue.** The five products with the most line revenue in attributed orders, with their order counts. This needs line-item prices saved (see Data work).
- **No Shopify store:** one empty card, "Revenue can't be measured on this workspace", with what turns it on.

### Questions & Answers

- **First card.** On the left, "The most common shopper", a hairline, then "1,053 started" and "750 finished". On the right, one tile per question with its most common answer (two lines at most). The tooltip gives the question and "343 of 1,006 answered · 34%".
- **Answer breakdown** (title tab, default). One block per question: a "Q1" badge, the question as written (one line, cut), and "1,006 of 1,053 answered" on the right (" · pick any" for multi-select). A soft dotted line, then labels such as "34% Dry" above one stacked bar. Each part of the bar opens the contacts panel on that answer. With Compare on, each label gets "was 32%".
- **Question breakdown** (title tab). Cards two across: badge and question, one row per answer (answer, bar, "343 · 34%"), and "1,006 of 1,053 total shoppers picked an answer" at the bottom.
- **Where shoppers ended up.** One row per result with count and share of completions.
- **Individual responses.** Collapsed. Ten rows: shopper id, date, one column per question, result. Export carries every response.

### Products

- **First card.** Three highlights: Most shown, Highest click rate (only among products with 100 or more views) and Most bought. Each shows the product name and the label; the tooltip gives the figures.
- **Product table.** The only view. Chips: All and No logic, each with a count; picking No logic shows a one-line explanation above the table. "Find a product" appears from 12 products. Export.
- **Columns.** A fixed layout: product 27%, then seven equal centred columns. Every figure is a number with a smaller rate under it:

| Column | Number | Small figure |
|---|---|---|
| Shown | Times on a results page | % of shoppers who finished |
| Clicked | Clicks | % of shown (from 30 views) |
| Added to cart | Adds with the quiz's own button | % of shown |
| Bought | Attributed orders holding the product | % of shown |
| Revenue | The product's line revenue | % of all product sales |
| Returned | Units refunded as returns | % of bought |
| Days to return | Median days from order to refund | "days" |

- Any heading sorts by its number. 25 rows, then "Show 25 more". A "No logic" tag sits under the product's name, and its figures show dashes. Today's State column and its states (over-shown, never clicked, healthy) go away.
- **An opened row** is a two-column box with no titles. Left: the product's click rate against the quiz's, and its reach against the median product. Right: every way a shopper reaches the product, in the Logic step's own words, each pointing to its result:
  - **Starting set**: "Dry opens the Hydrating set, which includes this product."
  - **Narrows**: "Budget $25–50 keeps it: priced $38."
  - **Rule 3**: "When they pick Redness, show Barrier Repair Cream."
  - Then "Open in Logic".
- **No logic**: no answer path reaches the product. It is the only flag on products.

### Quiz flow

- **First card.** Started, Finished, Steepest drop and Typical step drop-off. Tooltips: "71.2% of the 1,053 shoppers who started"; "Question 3: What's your biggest skin concern? 139 of 979 left here"; "The middle drop-off across all the steps". With Compare: "was …" under each.
- **Journey map** (title tab, default). One node per step (Start, each question, Email capture, Result), the band narrowing with the share still in the quiz, "% still here" on the left and exits on the right ("25 left · 2.4%"). The steepest step is red, with "Open in builder" beside its exit. The result node spouts into one box per result: name (two lines, always two lines tall), count and share, a bar, and "28 of 174 contacts bought". A box opens the contacts panel. With more than 40 results: the top four boxes, "N more", and a searchable list of all of them. The map is designed for a linear quiz.
- **Step by step** (title tab). One row per step: label, question (up to two lines), bar, reached, "left · %". "Show the step-by-step table" opens the full table.
- Under 30 shoppers at a step, drop-off shows counts only.

### Branching quizzes

Set Paths to Branching in the mock to see it.

- **Journey map.** The shared steps run down the middle as before. Where the quiz splits, the band forks into one box per path, side by side. Each path box is headed "Path A", "If they pick Dry or Sensitive" and "453 shoppers · 45%", holds that path's steps with their own band and exits, and ends with "396 continue". Where the paths meet again, they join back into the middle band. The steepest step can sit inside a path; it is marked the same way, and "Open in builder" drops under its exit chip.
- **Step by step.** A grey header row opens each path ("Path A · If they pick Dry or Sensitive · 453 shoppers"); its steps are indented with a thin violet rule. A "Paths join" row shows how the paths add up ("396 from Path A + 414 from Path B · 810 shoppers"). The full table tags each path step with its path.
- **Questions & Answers.** A question only one path sees carries a "Path A" chip beside its "Q2" badge, and counts out of that path: "426 of 453 on this path answered". Questions every shopper sees still count out of everyone who started.
- **Contacts and responses** only hold answers to the questions on their own path, so an answer's contacts panel never lists a shopper from another path.
- **Insights.** The drop-off rule runs across every step, path steps included, against the median of all steps, and names the path: "25.1% of shoppers on Path B leave at …".
- **Paths are named by their entry answers** in the merchant's own words ("If they pick Combination, Oily or Not sure"). The letters follow the order of the answers on the splitting question.
- **More paths.** Up to three paths sit side by side. With four or more, the map shows the three biggest side by side and a "+N more paths" box listing the rest with their shoppers; Step by step always lists every path. A path that splits again shows its own fork inside its box. These two cases are rules for the build; the mock shows the two-path case.
- **The numbers still tie out**: the shoppers who continue from the splitting question equal the sum of the paths' starts, and each path's "continue" figures add up to the shoppers at the step where they join.

### Customers

- **First card.** Contacts captured (tooltip: "58.9% of the 750 shoppers who finished left an email"), then four figures. Each opens the contacts panel showing exactly its own number:
  - **Can be emailed**: contacts who said yes to marketing. Opens with "Marketing consent only" on.
  - **Bought**: contacts with an attributed order. Opens with the switch off.
  - **No purchase yet**: can be emailed, no purchase. Opens with the switch on.
  - **Added, not bought**: can be emailed, added to cart through the quiz, no order yet. Opens with the switch on.
- **Contacts by result** (title tab, default). An "All contacts" row, then one row per result: the name (one line, cut) and "N contacts", a bar split into Bought, Added, not bought and No purchase yet, and the share that bought (one decimal, with an asterisk under 50 contacts). Every name and every part of a bar opens the panel on that exact count.
- **Contact list** (title tab). Chips All, Purchased, Didn't buy, Saw no match, Back-in-stock; Result and Recommended filters. Columns: Contact (masked email), Captured, Result, Recommended (+N more), Status, Consent, Value. Twelve rows, then "Show 25 more". Emails are masked on screen and complete in the export.

### The contacts panel

- Opens from answer bars, result rows, result boxes, the Customers figures and the Customers bars. It always opens on the exact number that was clicked.
- Header: what was clicked (the question, "Result" or "Everyone who left an email") and its name (two lines at most).
- Facts: for example Finished, Left an email, Marketing consent, Bought.
- Status chips: All, No purchase yet, Added, not bought, Bought, each with its count.
- "Marketing consent only" switch with "383 of 442 said yes to marketing".
- Actions: "Create Klaviyo segment" opens a short form (segment name, the rules Klaviyo will keep checking, Create). Without Klaviyo connected it reads "Connect Klaviyo" and goes to Integrations. Then Export and Copy emails.
- Table (fixed columns): Contact (masked, with capture date), Result, Status, Consent, Value. Forty rows, then "Showing 40 of 383. The export and the copy include all of them."
- A Klaviyo segment only ever includes people Klaviyo may email, whatever the switch says.

### Compare

- **First card.** The latest full month ("September") with its change, and Started, Completion and Revenue with their changes against the month before ("▲ 1 point" for rates). With fewer than two full months, a visible notice says when the first comparison appears.
- **"{Metric} by month".** A chart with Started, Finished, Completion, Contacts and Revenue; the month in progress is hatched. The table: Month (the current one marked "partial"), Started, Finished, Completion, Contacts, Orders, Revenue, Per completion, and "{metric} vs month before". Sortable; newest first.

## Definitions

| Term | Definition |
|---|---|
| Started | Sessions that pressed Start in the range (`quiz_engaged`, not the render event `quiz_started`) |
| Finished, completions | Sessions that reached a result |
| Completion rate | Finished ÷ Started |
| Contacts captured | Sessions in the range that left an email, one per session |
| Capture rate | Contacts ÷ Finished |
| Attributed orders | Distinct Shopify order ids attributed to a session in the range: the order holds a recommended product, matches the shopper, and is placed within 14 days of the shopper starting the quiz |
| Revenue influenced | Sum of those orders' totals, each order counted once |
| Bought (shoppers) | Sessions marked converted (`QuizSession.converted`): shoppers with at least one attributed order, each counted once. Used by the "Where shoppers go" row and "% of shoppers who finished bought" |
| AOV | Revenue influenced ÷ Attributed orders |
| Revenue per completion | Revenue influenced ÷ Finished |
| Reached a step | Inferred from answering: a shopper who saw a question and left without answering counts as leaving at the step before, so drop-off is a worst-case figure (as today in `stepLedger.ts`) |
| Drop-off | Left at the step ÷ Reached the step |
| Steepest drop | The step with the highest drop-off among steps reached by 30 or more shoppers |
| Typical step drop-off | The median drop-off across all steps (today the median exists only inside the insights rule, as the median of the other steps) |
| Shown | Distinct sessions whose results page showed the product |
| Click rate | Distinct sessions that clicked it ÷ Shown |
| Added to cart | Distinct sessions that added it with the quiz's own button |
| Bought (product) | Attributed orders whose line items include the product |
| Product revenue | Sum of the product's line items (price × quantity) in attributed orders. It is part of Revenue influenced, so the column never adds up to more than it |
| Returned | Units on refund line items Shopify marks as a return (`restock_type` = `return`), matched to attributed orders; other refunds are left out |
| Days to return | Median of refund date minus order date |
| Can be emailed | Contacts whose marketing consent is yes |
| Added, not bought | Contacts whose session added to cart through the quiz and has no attributed order. This replaces today's "abandoned" status, which means "session not completed" and can hardly occur |
| No purchase yet | Contacts with neither an order nor a quiz add to cart |
| Path | The steps a shopper takes after a splitting question, named by the answers that lead into it |

**Confidence gates** (already in `analyticsConfidence.ts`): completion firms up at 200 sessions and shows a range under 50; capture at 150 / 50 finished; conversion at 400 / 150. A rate under its gate carries an asterisk whose tooltip gives the likely range. Product rates show from 30 views and are solid from 100.

**Precision.** Headline rates and anything also shown in a tooltip use one decimal (71.2%, 2.7%, 13.6%). Shares inside bars and tables of products use whole percents.

## How the numbers tie together

The final review checked each of these on all three example data sets. They make good acceptance tests for the real queries.

- The days in the range add up to the totals: started, finished, contacts, orders and revenue. The same holds for the previous period.
- The results add up to Finished; contacts per result add up to Contacts captured; buyers per result add up to Bought on Customers.
- Each step's reached minus left equals the next step's reached. The first step equals Started and the result equals Finished.
- Answer counts for a single-choice question add up to the shoppers who answered it.
- Orders per result add up to Attributed orders, and revenue per result to Revenue influenced.
- Product order counts add up to at least Attributed orders, since every attributed order holds at least one recommended product. Product revenue adds up to no more than Revenue influenced.
- Returned is never more than Bought; Bought and Clicked are never more than Shown.
- Months on Compare add up to the range totals.
- On a branching quiz, the paths' starts add up to the shoppers who continue from the splitting question, and the paths' "continue" figures add up to the shoppers at the join.
- The Analytics Overview totals equal the sum of the live quizzes.
- The same figure is identical wherever it appears: the steepest drop and typical drop-off on Quiz flow and in Insights; the no-match contacts in Insights and on Customers; the products with no logic in Insights and on Products.
- Every link into the contacts panel opens on the number that was clicked.
- Insight actions land on the exact rows they talk about: "See the products" opens Products filtered to No logic; "Open these 11 contacts" opens the Contact list filtered to Saw no match.

## Data work

What the backend has to add or change, in the order the screens depend on it.

### 0. The attribution rule

Change attribution to **14 days from the shopper starting the quiz** (`quiz_engaged`): today `DEFAULT_ATTRIBUTION_WINDOW_MS` is 72 hours and candidate sessions are filtered by `completedAt`. Match against the session's engaged time instead, and replace `ATTRIBUTION_WINDOW_DAYS = 7` and every "7 days" label with the same 14-day rule ("within 14 days of starting the quiz").

### 1. Line items on attributed orders

The `orders/create` webhook already receives every order. When it writes `order_attributed`, also save each line item: product id, variant id, quantity, and the line price after discounts. Save the order's own `created_at` too (today `Event.ts` is the receipt time). This feeds Revenue → Top products by revenue and the Products → Revenue column. Keep it inside the `order_attributed` payload so the existing order redaction removes it with the order.

### 2. Refunds

Subscribe to `refunds/create`. The existing `read_orders` scope covers it. For each refund, match `order_id` to an `order_attributed` event. Store the refund date and, for every refund line item whose `restock_type` is `return`, the product and quantity. Products → Returned is the units returned; Days to return is the median of refund date minus order date. Order redaction must delete these too. Orders from the last 30 days are still open to returns, which the Returned heading's tooltip says.

### 3. Results

A session's `outcomeId` holds the result node id (`resultNodeId` in `DeciderViews.tsx`). Look results up by node id and show the result node's headline. Decider quizzes also need result counts; `recommendation_viewed` carries `resolved_target_id` and `matched_rule_id`. Everything grouped by result depends on this: Where shoppers ended up, the journey's result boxes, Revenue by result, Contacts by result, the Result filter and the Result column.

### 4. Previous period

Compare needs the same totals for the previous window, counted exactly like the current one (the same session cohort, not event time): started, finished, contacts, orders, revenue, bought, each step's drop-off and each answer's share. On the Analytics Overview, the same for every quiz.

### 5. Contacts

- Read `EmailCapture.marketingConsent` for the Consent column, the "Can be emailed" figure and the panel's switch.
- Status per contact: Bought (session converted), Added, not bought (an `add_to_cart` event in the session and no attributed order), otherwise No purchase yet.
- Count over all contacts, not the first 500, and page the list.
- Filter contacts on the server by an answer (join contact → session → answers), a result or a recommended product.
- Copy emails returns the full emails of the panel's current list.

### 5b. Branching paths

Extend `buildStepLedger` so the steps after a splitting question are grouped into paths, each with reached, continued, skipped, left and drop-off, plus where the paths split and join and how many shoppers take each. Answer counts for a path question count out of that path's shoppers. Run the drop-off insight on every step, path steps included.

### 6. How a product is reached

A per-product explainer that returns every way in, in the Logic step's words: the starting-set answer that opens a set containing the product, each narrowing question that keeps it (and why, for example its price), and each rule that shows it ("When they pick Redness, show Barrier Repair Cream."), each with the result it lands on. Reuse `resolveTarget`, `narrowIdsByFilters`, `enumeratePaths` and `routeTrace` rather than extending `pathsByProduct`.

### 7. Exports

One CSV per section, each following the date range and every filter on screen. Emails in exports are complete; on screen they stay masked.

### 8. Klaviyo

- **One connection per shop.** Klaviyo is connected once, in Integrations, with every permission the features need (profiles, lists, events, subscriptions, `segments:write`), and the credential is stored encrypted like the Shopify connector token. A quiz's Klaviyo action uses that connection; where Klaviyo isn't connected yet, it links to Integrations instead of asking for a key. Existing per-quiz keys need a one-time move to the shop connection.
- **Create Klaviyo segment.** One call to Klaviyo's Create Segment endpoint (`POST /api/segments`, limited to 100 a day) with the panel's rules as condition groups: took this quiz, plus the answer, result or product, plus the status. It needs an API revision newer than the pinned `2024-02-15`. Klaviyo keeps the segment up to date by itself. Purchase and add-to-cart rules use Klaviyo's own metrics, so its counts can differ slightly from ours.
- **Profile data** (in `q.$id.integration.tsx`, a server route): add a readable property per answer named with the question text as written, next to the existing `quiz_q_<id>` keys; send the result name as `quiz_result`; look up the stored marketing consent and subscribe the profile when it is yes. A shopper who said no is left off the list.

### 9. Small changes

- Return the median step drop-off from `buildStepLedger`.
- Products: count "Add all to cart" per product, exclude preview clicks and adds, and return every product, not the first 50.
- Insights: remove dismissed items before trimming to three, so the next one moves up.
- Analytics Overview: load every quiz, drafts included.

## Problems on main this page depends on

Found while mapping the mock to the code. Each one changes a number the new page shows, so fix it with the build.

- **The attribution window doesn't match its label**: 72 hours from finishing in code, "7 days" on screen. Both become 14 days from starting (Data work 0).
- **Result names are empty**: node ids are looked up as category ids (`quizAnalytics.server.ts` around line 645 and 916; `customerHub.server.ts` around line 66).
- **"Abandoned" can hardly occur**: session rows are only written on completion (`sessions.tsx`).
- **Contact counts are taken after a 500-row cap.**
- **The contacts export ignores the date range and the Result and Recommended filters**, though the screen says what you see is what downloads.
- **The previous period and the Analytics Overview count by event time**, while the quiz pages count by session cohort, so the pages can disagree.
- **Dismissing an insight doesn't bring in the next one.**
- **Klaviyo's list add sends an email where Klaviyo expects profile ids**, and the failure is swallowed (`q.$id.integration.tsx` around line 354). The Klaviyo key is stored in plain text in the quiz document; the Shopify connector token, by contrast, is encrypted.
- **Back-in-stock flags match by email across the whole shop**, not by quiz and session.

## Acceptance checklist

- [ ] Every screen matches the mock at 1440px and 1180px with Text set to Typical and to Long.
- [ ] The same figure is identical everywhere it appears, at the same precision.
- [ ] Every tie-out in "How the numbers tie together" holds on real data.
- [ ] Every number that opens the contacts panel opens it on that number.
- [ ] Insight actions land on the filtered rows they describe.
- [ ] Compare counts both periods the same way, and appears only on the six screens listed.
- [ ] KPI tooltips wait 350 ms and never open while the pointer sweeps past.
- [ ] No text is cut without an ellipsis and a full-text hover; no number is ever cut; no horizontal scroll at desktop width.
- [ ] Revenue and orders count orders placed within 14 days of starting the quiz, and every label says so.
- [ ] A branching quiz shows its paths in the journey map, Step by step and Questions & Answers, and its counts tie out at the split and the join.
- [ ] Klaviyo is connected once per shop; no screen asks for a per-quiz key.
- [ ] Result names show for decider and legacy quizzes.
- [ ] Top products by revenue and the Revenue column use line items; their total never exceeds Revenue influenced.
- [ ] Returned counts only returns, and an order's redaction removes its refunds.
- [ ] Each Export follows the range and the filters on screen.
- [ ] A Klaviyo segment never includes a contact who said no to marketing.
- [ ] Legacy (points) quizzes still render their analytics, and the byte pin holds after deploy.

## Files

Sent with this document:

- `ANALYTICS-HANDOFF.md`: this document.
- `analytics-main.html`: the mock as one self-contained file. Open it in any browser, nothing to install; it is the same page as the mock link above. Use the dark bar along its top to switch screens and states (see "Reading the mock").

The design sources are untracked; they exist only in the owner's checkout:

- `docs/design/analytics/analytics-main.src.html`: the mock's source. Edit this.
- `docs/design/analytics/build_crest.py`: inlines the logo and the print and writes `analytics-main.html`, the page behind the mock link.
- `docs/design/analytics/ANALYTICS-HANDOFF.md`: this document. `build_handoff.py` renders it to `handoff.html`, the web version.
- `docs/design/analytics/analytics-crest.src.html` and `analytics-tabs.src.html`: earlier rounds, kept for reference only.
- `docs/design/home/first-run/assets.json` and `docs/design/background-print/tiles/print-crest.svg`: the logo art and the print the mock builds from.
