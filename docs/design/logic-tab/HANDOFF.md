# Logic tab — developer handoff

**One document.** Everything needed to build the Logic tab against the real
store: the model it teaches, every screen and control, every string, the exact
mapping onto `quizSchema.ts`, and the list of places where the design asks for
something the engine cannot do yet.

| | |
|---|---|
| **Design mock (interactive)** | https://claude.ai/code/artifact/ca0ec5b5-2261-42f2-b05a-1325f81622b0 |
| **Mock sources** | `docs/design/logic-tab/rules-tab/` — `_shell.html` (markup + CSS) · `_v.js` (the tab) · `_x.js` (the explainers) |
| **Shared demo engine** | `docs/design/logic-tab/bands/_core.js` · tag fixture `docs/design/logic-tab/rule-create/_tags.js` |
| **Rebuild the mock** | see [§12](#12-running-the-mock) |
| **Applies to** | `Quiz.logic_model === "decider"` **only**. Legacy points/ladder docs keep `app/components/questionsLogic/` untouched. |

The mock is a design artifact, not a reference implementation. Where its engine
and the real engine disagree, **the real engine is right** — see [§10](#10-gaps--decisions-needed-before-build).

---

## 1. The model the tab teaches

A shopper's results come from four stages, in this order:

```
STARTING SET      one question's answers each open a set of products
      ↓
QUESTIONS NARROW  every "Narrows" question removes what doesn't match
      ↓
RULES DECIDE      your rules act on what's left — top rule wins
      ↓
RESULTS
```

Two authoring surfaces sit in **one card**, in that engine order:

- **Rules** — "when they answer this, do that to these products". Merchant-named
  products. Best for hero sets and exceptions.
- **Questions** — every question, and what it currently does. Data does the work.

The design's central claim, and the reason there is no separate "map" tab:
**a quiz built entirely on rules is a normal quiz.** "Rules only" is not a mode
you switch to — it is simply a quiz where no question was set to Narrow. The
questions table always renders; it just says "Info only" on every row.

**Locked vocabulary.** Never surface: decider, bucket, branch, boost, weight,
score. The three question jobs are **Starting set** / **Narrows** / **Info only**.
The three rule verbs are **Show** / **Highlight** / **Exclude**.

---

## 2. Screen anatomy

One scrolling card. No tabs, no view switcher, no compact/full toggle.

```
┌──────────────────────────────────────────────────────────────┐
│ Rules            ✦ How it works              [ + Create rule ]│  ← .rch
├──────────────────────────────────────────────────────────────┤
│ 1  When they pick Women and Smart, show Workwear Capsule.   ✕│  ← .rrow
│ 2  When they pick Relaxed, exclude Wool Trousers…           ✕│
│ 3  When they pick Training kit and Under $60, show …        ✕│
├──────────────────────────────────────────────────────────────┤
│ Questions        ✦ How it works                              │  ← .rch.divrow
├──────────────────────────────────────────────────────────────┤
│ Question │ │ Answer │ Shows / narrows │ Products │ Then go to │  ← .mtbl head
│──────────┼─┼────────┼─────────────────┼──────────┼───────────│
│ shopping │A│ Work…  │ Workwear Capsule│ 8 products│ next q    │
│ for      │B│ Weekend│ Weekend Capsule │ 6 products│ next q    │
│ [◆ START-│C│ Training│Performance…    │ 6 products│ next q    │
│  ING SET▾]│ │        │                 │          │           │
│══════════╪═╪════════╪═════════════════╪══════════╪═══════════│  ← 2px rule
│ gender   │A│ Men    │ [Men][Unisex]   │ 20 / 23  │ next q    │
│ [NARROWS·│B│ Women  │ [Women][Unisex] │ 20 / 23  │ next q    │
│  GENDER ▾]│C│ Doesn't│ keeps everything│ all 23   │ next q    │
└──────────────────────────────────────────────────────────────┘
```

**Rules sit above questions** because that is engine order for the thing the
merchant is authoring: a rule's verb is the last word on the result. The
questions block below is the same card, divided by a header row, not a new panel.

**Row metrics are shared.** A rule row and an answer row have the same height,
font size (12.5px) and line-height (1.45) so the two halves read as one list.

**The map never reflows.** `table-layout: fixed`; the "Shows / narrows" column is
pinned at 36%. Adding or removing a chip must not move any other column.

**Question blocks are separated by a 2px `--bar` rule** (`tr.qs td`), and the
question label column carries a 2px right border. Between answers of the same
question: 1px `--line2`. The divide between questions is the heaviest line in
the table.

---

## 3. The Rules card

### 3.1 Header

| Element | Copy | Notes |
|---|---|---|
| `h2` | `Rules` | 14.5px / 700 / -.01em |
| Explainer button | `✦ How it works` | opens the rules explainer ([§7](#7-the-explainers)) |
| Create button | `+ Create rule` | `margin-left:auto` — hard right of the card |

The **Questions** header is identical (`✦ How it works`, same label string, so
both pills are the same width without padding hacks). Neither header carries a
count or a description.

### 3.2 Empty state

One row, no rules:

> **—** No rules yet. Your **N** switched-on questions are below deciding everything.

…where N = questions whose role is not Info only. When N is 0:

> **—** No rules yet. And no question is switched on — so every shopper sees the same products.

This is the only place the tab states the rules-only ↔ questions-only spectrum.
Do not add a mode picker.

### 3.3 A rule row

`[n] [sentence] [✕]`

Sentence grammar (`ruleText`, `_v.js:414`):

```
When they pick <A> and <B>, show <Target> (collection).
When they pick <A> or <B>, exclude <Target>.
Always highlight <Target>.                      ← zero conditions
```

- Answer labels are `<b>`. The joiner between clauses (`and` / `or`) is a muted
  `.join` span.
- Within one question, multi-select answers join with `or` (any-of) or `and`
  (all-of) per the rule's own stored mode.
- A target that is not a product or variant gets a trailing muted kind:
  ` (collection)`, ` (tag)`, ` (metafield)`.
- **Order is priority.** Row 1 is checked first. Do not surface any other
  ranking language.
- `✕` deletes. Look the rule up **by id**, never by row index.
- A freshly created rule gets `.fresh` (a brief highlight) for 1800 ms.

---

## 4. Create-a-rule modal

`min(1160px, 95vw) × min(720px, 88vh)`. Three columns, `1fr 182px 1fr`.

```
┌─ Create a rule ───── Who it applies to on the left… ── [ Create rule ] ─┐
│ WHEN THEY ANSWER   2 picked │    THEN    │ WHAT IT ACTS ON  8 products  │
│ ┌─────────────────────────┐ │ ┌────────┐ │ ┌──────────────────────────┐ │
│ │ Q1  shopping for        │ │ │ Show   │ │ │ [Search…              ]  │ │
│ │ (Work)(Weekend)(Train)  │ │ │replaces│ │ │ All|Tags|Colls|Meta|…    │ │
│ │ ─────── and | or ────── │ │ ├────────┤ │ │ ── Collections ──── 12 ─ │ │
│ │ Q2  gender  multi-select│ │ │Highlight│ │ │ [Set] ● Workwear   8 pr ✓│ │
│ │ shopper picked any|all  │ │ │adds in │ │ │ [Tag] quiz-modal   3 pr  │ │
│ │ (Men)(Women)(Doesn't…)  │ │ ├────────┤ │ │ …                        │ │
│ │ …                       │ │ │Exclude │ │ │                          │ │
│ └─────────────────────────┘ │ └────────┘ │ └──────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────────┤
│ Acts on  [Workwear Capsule 8 ✕]  8 products · updates as the catalogue…  │
├─────────────────────────────────────────────────────────────────────────┤
│ When a shopper picks Women and Smart, show Workwear Capsule.             │
│ Fires on 1,296 of 10,368 paths                              [ Cancel ]  │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4.1 Left — "When they answer"

- **Every question is listed**, including Info-only ones. On a rules-only quiz
  those are the only conditions there are. (`condQs()` returns `doc.questions`
  unfiltered — deliberately different from the engine's `condQs`.)
- Each question is a `.qblock`: `Q<n>` numeral + label truncated to 20 chars +
  a row of answer chips. **The numeral is what a merchant scans by**; the label
  is the reminder.
- A block with any chip on gets `.used`.
- Between two *used* blocks, an `and` / `or` toggle appears (`.joinrow`).
- Multi-select questions show a `multi-select` tag; once 2+ chips are on they
  also show `shopper picked [any of] [all of]`.
- Header count: `<n> picked`, muted when 0.

### 4.2 Middle — "Then"

Three stacked verb buttons, centred, each a bold name + a muted one-line hint:

| Verb | Hint |
|---|---|
| **Show** | replaces whatever the quiz picked |
| **Highlight** | adds these in, even if a filter would drop them |
| **Exclude** | takes these away for those shoppers |

Default on open: **Exclude** for a blank draft; **Show** when the modal is
opened pre-seeded with a condition. (`dOpen`, `_v.js:183`.)

⚠️ These three do **not** map onto `DecisionRule.action` the way the names
suggest. See [G4](#g4-verb-semantics-do-not-map-name-to-name-blocker).

### 4.3 Right — "What it acts on"

**One resource index.** A tag, a collection, a metafield value, a product and a
variant are all the same shape: *a named thing that resolves to products*. There
is nothing to choose between — you search and click. The mock indexes 261 of them.

- Search box, then type filter chips with live counts. In the demo catalogue:
  `All 261 · Tags 162 · Variants 56 · Products 23 · Metafields 13 · Collections 7`
  (chip order is fixed: All · Tags · Collections · Metafields · Products · Variants).
- **Nothing typed + All** → one group, `This quiz already recommends`, listing
  the curated sets plus the tags the quiz already uses.
- **Nothing typed + a type chosen** → that type's full list (first 40, then
  `+N more — type to narrow`).
- **Typed** → `Found N across M types · K matched by what they belong to`, then
  one group per kind, 12 rows each. Name matches rank above sub-line matches.
- **No hits** → `Nothing matches "x".` + `Add it as a one-off product`.

A resource row is `[KIND] ● Name — sub — [N products] ✓`:

- The kind chip already says what it is, so the **sub-line only earns its place
  when it carries something else** — where a product lives, which family a tag
  belongs to. Collections and tags render no sub-line.
- `N products` is its own button: it opens a product list popover. It must not
  toggle selection.
- Clicking anywhere else on the row toggles it.

### 4.4 Tray

Appears once anything is selected. Chips with a `✕`, then
`N products · updates as the catalogue changes` (the second clause only when a
live target — tag / collection / metafield — is in the selection).

### 4.5 Footer

- **The sentence**, live: `When a shopper picks <clauses>, <verb> <targets>.`
  Unfilled parts render as muted placeholders (`pick answers`, `pick what it acts on`).
- **Impact**: `Fires on <n> of <total> paths` when the quiz enumerates under
  200 000 paths; `≈<pct>% of shoppers (sampled)` above that (4 000 samples);
  `Needs multi-answer shoppers — not estimable yet` when an all-of condition
  makes it unenumerable.
- `Create rule` is disabled until ≥1 condition **and** ≥1 target.
- **Clicking the scrim must not discard the draft.** `Esc` closes.

---

## 5. The Questions table

Six columns: `Question · key · Answer · Shows / narrows · Products · Then go to`.

### 5.1 The role button

Under the question label, an uppercase pill showing the current job:

| Role | Pill |
|---|---|
| decides | `◆ STARTING SET ▾` |
| filter, field mode | `NARROWS · GENDER ▾` |
| filter, groups mode | `NARROWS · ANYTHING ▾` |
| qualifier | `INFO ONLY ▾` |

Opens the **role menu** ([§6.1](#61-role-menu)).

### 5.2 "Shows / narrows"

| Role | Control |
|---|---|
| Info only | static muted `not used for products` |
| Starting set | button → set menu; label = the target's name, or `pick what it opens` |
| Narrows · Anything | button → set menu; label = the target's name, `N things`, `keeps everything`, or `pick anything` |
| Narrows · <field> | button → value menu; label = coloured value chips, `keeps everything`, or `not mapped yet` |

### 5.3 "Products"

| Role | Label |
|---|---|
| Info only | `·` |
| Starting set | `N products` |
| Narrows, no-preference | `all 23` |
| Narrows, mapped | `14 / 23` |
| Narrows, unmapped | `not set` (flagged) |

`0…` and `not set` render in the bad colour. Every count is a button that opens
the product list behind it.

### 5.4 "Then go to"

`next question` (muted, dashed) · `→ Q4` · `→ results`. Opens the route menu.
**Forward-only** — a quiz can never loop, and a skipped question narrows nothing.

---

## 6. The five popovers

All five render into a single `#menu` element, positioned by `placeMenu`
(`_v.js:463`):

> Open downwards when there is room below, upwards when there is not, and cap
> `max-height` to whichever side won. Clamp `left` to the viewport using the
> menu's **measured** width (`m.offsetWidth`), never a constant.

### 6.1 Role menu

Title = the full question text. Then three jobs, **one flat list**:

```
◆ Starting set                        (now on Q1)
  Info only
  Narrows                                       ▸ / ▾
  ─────────────────────────────────────────────────
    Anything          each answer picks its own
    [All][Metafields][Tags][Variant options][Collections]
    [ Search your fields…                            ]
    Gender      custom.gender                   23/23
    Fit         fit:*                           23/23
    Size        Size                            23/23
    …
```

- `Narrows` expands in place. It is **not** a rival mode to the fields under it —
  **"Anything" is the absence of a field.** Picking a field just means every
  answer draws from one list; picking Anything means each answer picks its own
  targets. Same job, two shapes.
- Collapsed, `Narrows` shows what it currently narrows by as its sub-line.
- `Starting set` shows where it currently lives if it's on another question.
- Choosing a **new** field clears every answer's values and toasts
  `"<Q>" now narrows by Fit — map its answers`. The old values are meaningless
  against a new field; say so, don't silently keep them.
- Choosing `Starting set` demotes the previous holder to its saved role and
  toasts `Starting set moved from "<old>" to "<new>" — map its answers`.

### 6.2 Set menu (Starting set / Narrows · Anything)

Type chips → tag-family chips (when Tags is active) → search over all 261 →
`Selected` group at the top → the rest. Multi-select. Ends with
`Keeps everything` (filter role only) and `Clear this answer`.

### 6.3 Value menu (Narrows · field)

The field's values with per-value product counts; a search box appears above 8
values; caps at 60 with `+N more — keep typing`. Ends with `Keeps everything`.

### 6.4 Product menu

`<Title> — N products`, then a swatch + name + home-set list. Empty state:
`Nothing carries this yet. Everyone who lands here reaches your safety net instead.`

### 6.5 Route menu

`The next question` (with the next question's text as sub-line), every question
after the next one (`skips N questions`), then `Straight to the results`.

---

## 7. The explainers

A `✦ How it works` button on each header opens a stepped sheet. `min(900px,94vw)`,
`max-height:92vh`.

**Four steps each**, one at a time, with a clickable numbered progress bar
(done steps get `✓` and a green connector) and a `N of 4 · Back · Next/Done`
footer.

**Both explainers are locked to one height** for continuity: on open, every
step of *both* explainers is measured off-screen and the body is fixed to
`min(tallest + 30, 92vh − chrome)`. Re-measure on resize. Render the sheet
visible **before** measuring or `scrollHeight` reads 0.

**Content is a single 680px column, centred** in the sheet, with prose capped at
68ch and left-aligned to that column. One measure for figures, ledgers,
comparison cards and prose alike.

### 7.1 How rules work

| # | Title | Figure |
|---|---|---|
| 1 | One sentence, three parts | 3 example rules on a `When they answer → Do this → To these` grid |
| 2 | Top rule wins | 5 rules, 2 lit (`wins`, `also applies`), 3 dimmed (`skipped`) |
| 3 | Rules can be the entire quiz | a 6-row rules ledger, no counts, no ranking |
| 4 | Rules vs. Questions | two cards: Rules "Name products in" · Questions "Rule products out" |

Step 2 body copy: *Checked top down. The first **Show these** that matches
decides — excludes and pins always apply.*

Step 3 body copy: *A quiz can run on rules alone — no question has to touch your
products. It suits a catalogue that is already grouped: curated capsules, tagged
ranges, bundles, or a short list of hero products.*

### 7.2 How questions work

| # | Title | Figure |
|---|---|---|
| 1 | One question, three parts | The answer they pick `Women's` → Matched against `metafield · custom.gender` → What survives `18 of 32` |
| 2 | What each question narrows by | a 6-row ledger with a running count: 18 → 12 → 9 → 6 → 4 |
| 3 | Questions vs. Rules | the same two cards, Questions first |
| 4 | Both together | Starting set → Questions narrow → Rules decide → Results |

Step 1 and 2 deliberately do **not** both teach narrowing arithmetic: step 1 is
the anatomy of one question, step 2 is the whole quiz walked once. The running
count appears in exactly one place.

Step 4 body copy: *Questions cut the catalogue down. Your rules then decide what
to show out of what is left.* — this is the pipeline order, stated once.

Each closing card links across (`How rules work →` / `How questions work →`),
which swaps the sheet's content and resets to step 1.

---

## 8. Data model — mock → real

### 8.1 Questions

| Mock (`doc.questions[]`) | Real |
|---|---|
| `q.role: "decides"` | `QuestionData.role: "decides"` |
| `q.role: "filter"` | `QuestionData.role: "filter"` |
| `q.role: "info"` | `QuestionData.role: **"qualifier"**` — the stored value is `qualifier` forever. The UI label is "Info only". Never write `"info"`. |
| `q.dim` (which field it narrows by) | **no field** — see [G5](#g5-narrowing-sources-tags--collections-only-today) |
| `q.mode: "groups" \| "field"` | **no field** — see [G8](#g8-anything-mode-needs-a-storage-shape) |
| `q.short` (nickname) | no equivalent; use `data.text` truncated |
| `a.target` (starting-set answer) | `Answer.target_id` |
| `a.tags` (filter values) | `Answer.tags: string[]` + `Answer.collection_filter?: string` |
| `a.nopref` | `Answer.no_preference?: boolean` |
| `a.go: "next" \| "<qid>" \| "end"` | `Answer.edge_handle_id` + a `QuizEdge { source, source_handle, target }` |

Mutations that already exist: `setQuestionRole`, `setAnswerTarget`, `moveDecider`
(`app/lib/mutations/deciderMutations.ts`). Role changes already demote the
previous decider and force `required: true` — matches the mock's behaviour.

### 8.2 Rules

| Mock (`doc.rules[]`) | Real (`Quiz.decision_rules[]`) |
|---|---|
| `r.cells: { qid: { inc: [aid], exc: [] } }` | `conditions: [{ question_id, answer_id, op: "is" \| "is_not" }]` — flat, AND-only |
| `r.show: [id]` | `target_id` + **no** `action` (legacy replace) |
| `r.pin: [id]` | `target_id` + `action: "show"` |
| `r.hide: [id]` | `target_id` + `action: "hide"` |
| `r._j` (and/or joins) | **no equivalent** — [G2](#g2-or-between-conditions-has-no-storage) |
| `r._qm` (any-of / all-of) | **no equivalent** — [G3](#g3-any-of--all-of-has-no-storage) |
| array order = priority | array order = priority ✓ |

Mutations that exist: `addDecisionRule`, `removeDecisionRule`,
`moveDecisionRule`, `updateDecisionRule`. Note `updateDecisionRule`'s patch type
covers only `conditions` and `target_id` — **`action` cannot be written today**.

### 8.3 Persistence

Every interaction in the mock mutates and re-renders synchronously. In the real
build:

1. UI calls a **pure** function in `app/lib/mutations/deciderMutations.ts`
   (add new ones there; unit-test each).
2. The mutation returns a new doc; `useQuizDraft` debounces 700 ms and PUTs the
   whole document.
3. Every new schema field is `.optional()`, **never `.default()`** — a default
   rewrites every legacy doc on the next parse→save round trip.
4. Every mutation early-returns `doc` unchanged when `doc.logic_model !== "decider"`.

---

## 9. The real engine contract

`app/lib/recommendationEngine.ts` (decider branch, ~line 375) runs:

```
resolveTarget(selected, quiz)            recommendDecider.ts:139
  ├─ first rule whose conditions ALL match wins, evaluation STOPS
  ├─ a rule with no `action` REPLACES the target and returns immediately
  ├─ a rule with an action is remembered, then the base mapping resolves
  └─ base mapping = the decides question's picked answer's target_id
        ↓
narrowIdsByFilters(baseIds, byId, quiz, selected)     filterMatching.ts:102
  ├─ within one question: OR across the shopper's selected answers
  ├─ across filter questions: AND (intersection)
  ├─ no_preference / unmapped answers are pass-through — they NEVER narrow
  └─ matches on answer.tags (case-insensitive) OR answer.collection_filter
        ↓
applyRuleAction(poolIds, ruleMemberIds, action)       recommendDecider.ts:194
  ├─ show       → append the rule target's missing members to the pool
  ├─ hide       → remove them
  └─ prioritize → stable-move members already present to the front
        ↓
targetProducts(...)  → hero + grid, ordered by heroLogic/gridSort
        ↓
fallback (emptyFallback → safetyNetCol)
```

Two consequences the UI must respect:

- **A rule's action runs *after* filters.** That is exactly what the explainer's
  "Both together" step teaches. Keep them consistent.
- **`show` appends, it does not replace.** The only replace is a rule with no
  `action` at all.

Path enumeration for the impact/coverage numbers already exists:
`app/lib/pathEnumeration.ts`, `app/lib/pathQuality.server.ts`,
`app/lib/pathReport.ts`. Use them; do not re-implement `paths()` from the mock.

Rules with **zero conditions never fire** (`resolveTarget` skips them). The mock
renders such a rule as `Always <verb> …` — either block creating one, or accept
that it is inert and label it.

---

## 10. Gaps — decisions needed before build

Ordered by how much they cost if discovered late.

### G4. Verb semantics do not map name-to-name (BLOCKER)

The three UI verbs and the three `action` values share words but not meanings.
The correct wiring is:

| UI verb | UI hint | Store as | Why |
|---|---|---|---|
| **Show** | replaces whatever the quiz picked | `action` **absent** | Only an action-less rule replaces the target. |
| **Highlight** | adds these in, even if a filter would drop them | `action: "show"` | `applyRuleAction("show")` appends missing members *after* filters — exactly the hint. |
| **Exclude** | takes these away for those shoppers | `action: "hide"` | ✓ |

`action: "prioritize"` (rank the target's products first, add nothing) has **no
verb in this design**. Either leave it unexposed, or add a fourth verb — but do
not attach it to Highlight, where it would silently do nothing to a product the
filters already removed.

### G1. A rule has one target; the modal picks many

`DecisionRule.target_id` is a single string. The modal's tray is a multi-select.
Options:

- **(a)** widen the schema: `target_ids: z.array(z.string()).optional()`,
  keeping `target_id` parsed forever as the single-target form. *Recommended* —
  it is additive, and "Exclude these three tags" is a real merchant sentence.
- **(b)** the UI writes N rules from one modal. Cheap, but the rules list then
  shows three rows for one authored thought, and "top rule wins" gets confusing.

### G2. OR between conditions has no storage

`ruleMatches` is `conditions.every(...)`. The modal's `and` / `or` joiner cannot
be persisted. Options:

- **(a)** ship v1 **AND-only**: hide the joiner. The explainer already only
  teaches `and`, and every worked example uses it.  *Recommended for v1.*
- **(b)** add `condition_groups: DecisionRuleCondition[][]` (OR of ANDs),
  `conditions` parsed forever as the single-group form.

### G3. Any-of / all-of has no storage

Two `is` conditions on the same question are ANDed by `ruleMatches` — i.e.
always "all of". "Any of" needs the same shape as G2. Ship with G2's decision.

### G5. Narrowing sources: tags + collections only, today

`productMatches` (`filterMatching.ts:52`) checks **`collection_ids` and `tags`**
and nothing else. The role menu offers more than the engine can honour:

| Menu category | Status |
|---|---|
| Tags | ✅ works |
| Collections | ✅ works |
| Metafields | ⚠️ `IndexedProduct.metafields` **is** baked, but `productMatches` never reads it. Small engine change: extend `AnswerFilterValues` with `{ key, value }` and add a branch. |
| Variant options | ❌ not baked into the product index at all. Needs publish-time work — `filterMatching.ts` already flags this as a known dependency. |
| Product type / Computed (price bands) | ❌ not baked as filterable. |

**Decision needed:** ship v1 with Tags + Collections only (and hide the rest of
the category chips), or fund the metafield branch now. Do not ship a menu that
offers a field the engine silently ignores — a narrowing question that matches
nothing looks identical to one that matches everything.

### G8. "Anything" mode needs a storage shape

In Anything mode an answer points at an arbitrary mix — several tags, a
collection, even a single product. The schema gives a filter answer
`tags: string[]` (fine, several) and `collection_filter?: string` (**one**).
Selecting two collections, or a product, cannot be stored.

Options: widen to `collection_filters: string[]` (additive), and either drop
product/variant from the Anything picker or resolve them to a tag/collection at
write time.

### G9. Starting-set answers pointing at several things

`syncSel` invents a synthetic `sel:` id when >1 resource is selected;
`Answer.target_id` is one Category id. Recommendation: **restrict a starting-set
answer to one target.** "Several things at once" is what a Group is for — send
the merchant to Group creation rather than inventing a doc-level union.

### G6. Do not port the mock's `resolve()`

`bands/_core.js` never applies `r.pin` — a mock-only omission. The real engine
does. Port UI, not engine.

### G7. `updateDecisionRule` cannot write `action`

Its patch type is `Partial<Pick<DecisionRule, "conditions" | "target_id">>`.
Widen it (and add a test) before wiring the verb control.

### G10. Coverage numbers are expensive

The demo quiz enumerates 10 368 paths client-side. Real quizzes go much higher.
Use the server-side path machinery, cap enumeration, and **say so in the UI when
you sample** — the mock already prints `(sampled)`.

---

## 11. Design tokens

Full token block: `docs/design/logic-tab/rules-tab/_shell.html:3-72`. Light,
dark (`prefers-color-scheme`) and explicit `[data-theme]` overrides in both
directions. Font: **Quicksand**, fallback Mona Sans → system.

```
--ac  #6D5AE6   accent            --ok  #2E9B76   good / "Highlight"
--ac-d #4A3AAF  accent, on wash   --bad #BE3A31   flag / "Exclude"
--ink #2A2438   --soft #5A5470   --faint #837D96  --faint2 #B4AEC6
--line #E9E7EF  --line2 #F2F0F6  --bar #E2DFEA
--s1..s6  4 8 12 16 22 30        --rx/r1/r2/r3  4 6 9 12
```

Per-field chip palette `--t-<dim>` / `--t-<dim>-s` (gender, fit, size, style,
fabric, price, colour, season, incoll, any). In the real build these must be
assigned by hashing the field key — there is no fixed list of merchant fields.

Row metrics to preserve:

| | |
|---|---|
| Rule row / map row | 12.5px, line-height 1.45, padding `7px var(--s5)` |
| Card header | `9px var(--s4) 9px var(--s5)`, `h2` 14.5px/700 |
| `Create rule` | 11.5px, padding `6px 12px`, radius 8px |
| `✦ How it works` | 10.5px, padding `3px 10px 3px 8px` |
| Explainer column | 680px, centred; prose capped at 68ch |
| Question divider | 2px `--bar` · answer divider 1px `--line2` |

---

## 12. Running the mock

```bash
cd docs/design/logic-tab && { cat rules-tab/_shell.html; echo '<script>'; cat bands/_core.js; cat rule-create/_tags.js; cat rules-tab/_v.js; cat rules-tab/_x.js; echo '</script>'; } > logic-rules-map-3.html
```

Concatenation order matters: `_tags.js` defines `TAGS`, which `_v.js` reads at
load time to build the tag-group attributes.

Sanity check without a browser:

```bash
node -e "const fs=require('fs'),vm=require('vm');const s=fs.readFileSync('docs/design/logic-tab/logic-rules-map-3.html','utf8');new vm.Script(s.slice(s.indexOf('<script>')+8,s.lastIndexOf('</script>')));console.log('parse ok')"
```

Known mock-only shortcuts, for anyone reading the source: `setProducts` is
reassigned (never redeclared — a declaration hoists over the original and
recurses forever); the demo doc stores bare ids (`C_work`) while the resource
index is prefixed (`set:C_work`), reconciled by `normId`.

---

## 13. Build order

1. **Read-only questions table** against a real decider doc — roles, mappings,
   counts, routing. No editing. Proves the data is all reachable.
2. **Role menu + mapping menus**, wired to `setQuestionRole` / `setAnswerTarget`
   and new filter-mapping mutations. Resolve [G5](#g5-narrowing-sources-tags--collections-only-today) and [G8](#g8-anything-mode-needs-a-storage-shape) first.
3. **Rules list** (read + delete + reorder) on `decision_rules`.
4. **Create-a-rule modal.** Resolve [G1](#g1-a-rule-has-one-target-the-modal-picks-many)–[G4](#g4-verb-semantics-do-not-map-name-to-name-blocker) first; widen `updateDecisionRule` ([G7](#g7-updatedecisionrule-cannot-write-action)).
5. **Explainers** — static content, no engine dependency; can land any time.
6. **The modal's impact line**, computed server-side ([G10](#g10-coverage-numbers-are-expensive)).

### Not in scope — present in the mock source, deliberately unused

`_v.js` still carries two earlier variations and their machinery. The shipped
design renders `paneB()` only. **Do not build:** `paneA()` (a separate Map card
under a global on/off switch), `paneC()` (a Coverage / Map segmented control),
`coverageHTML()` + `coverage()` (the "who no rule speaks for" percentage panel),
`setAllNarrow()` (the switch-everything-off control), and the `segC` / `VIEW` /
`expQ` state they use. The `data-seed` handler survives from `paneC`'s
"Write a rule for this" button; keep it only if you add another entry point that
pre-seeds a condition.

Ship 1–3 behind the decider gate before touching 4. Every step needs the
byte-pin check from `CLAUDE.md` after deploy — the legacy published doc must
stay `c02ccaec98a0fe9e`.
