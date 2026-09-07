# Create-a-rule modal — dev handoff

**Reference artifact (live, clickable) — build against this:**
https://claude.ai/code/artifact/88bf84db-0f17-419f-9557-80c5fa69ab65
**Local copy of the same mock:** `docs/design/logic-tab/create-rule-one-screen.artifact.html`
(the artifact's frame HTML, fetched 2026-09-07 — open the file directly)

Background only, not a build target — the four band lengths the one-row version was chosen from:
https://claude.ai/code/artifact/9490c5fd-a222-4f04-854a-10dae3201e9c
(`docs/design/logic-tab/products-band-lengths.html`)

The artifact is the source of truth for pixels and behaviour — it is production-fidelity
(Figtree, Quartz token values, the real `.qz-lm-*` metrics) and every number below is measured
from it, not estimated. This file is the same spec in text, for grepping next to the code.

**One file changes:** `app/components/studio/logicTab/CreateRuleModal.tsx`, plus its section of
`app/styles/quizocalypse.css` (`.qz-lm-*`, the "Logic-step Live modals" block).
No schema change. No engine change. No mutation change.

**Two flows, one component.** Add a `flow: "onboarding" | "builder"` prop (default `"builder"`).
It changes **the products band and nothing else** — questions, operators, verb, footer and every
interaction rule are identical in both. The funnel surface passes `flow="onboarding"`; the Logic tab
passes nothing.

| | `onboarding` | `builder` |
|---|---|---|
| Band content | the quiz's recommendation groups, titled **Your recommendations** | today's mixed band, titled **What the quiz shows** |
| Kind tabs + search | hidden until **+ Add something else** | visible from the start |
| Coverage | headline: a `2/3 have a rule` fraction chip (amber, green at full); uncovered sort first, amber-washed, chipped **Needs a rule**; covered go green with a `✓ 2 rules` chip | a plain `2 rules` count where rules exist, and **nothing** where they don't — no amber, no green, no headline |
| Default filter | n/a — the groups are the content | `All` |
| Band height | 109px, 212px expanded | 114px, 169px with the catalogue opened |
| Modal, 5 questions | 712px (815px expanded) | 717px |

---

## 1. Why it changed

The modal opened at roughly 1,050px of content inside a window that gives it 88 vh. Band 3 —
the products the rule acts on — was below the fold the moment it opened, so nobody could see
what they picked and what it does at the same time. Everything below follows from fixing that.

Owner decisions taken along the way, so they don't get relitigated in review:

| Decision | Why |
|---|---|
| Question **columns → rows**, one row per question | Seven answers down a 246px column is 7 rows tall; the same seven across the width is one. |
| **Every question always shown** | Rows are cheap, so add/remove-a-column has nothing left to do. |
| **`match all` / `match any` cut from the UI** | It governed every row from the header with nothing showing its reach, and every "match any" rule is two rules — which read better in a ledger that is checked top down, first match applies. |
| **Read-back sentence removed** | The footer strip cost no height (the buttons already set it) but added noise; the toast plus the live state carry it. |
| **Fixed-width answer buckets, clipped at two lines** | Uniform tiles scan by position. Clipping is the price; the tooltip is the escape hatch. |
| **Modal at 1,330px** | The approved pop-up size, off the live screenshot. It is what lets seven fixed 130px buckets sit on one row. Narrower variants were tried (1,224 and 1,126) and rejected — this is the chosen width. |
| **Long quizzes grow rather than cap** | Owner call — one scroll for the whole modal, nothing hidden behind an inner scrollbar. |
| **Products band shows one row, opens on `+ N more`** | Owner call after seeing four lengths side by side: 114px instead of 192px, at the cost of five targets visible instead of twelve. |

---

## 2. Layout spec

All values measured from the reference artifact.

### Shell

| Part | Value |
|---|---|
| Modal width | `min(1330px, 96vw)` — was `min(1258px, 96vw)`; the approved pop-up size |
| Height, 5-question quiz | 712px onboarding, covered or not (815px expanded) · 717px builder |
| Height, 8-question quiz | 960px onboarding (grows; no cap) |
| Title bar (`.qz-lm-h`) | 36px — `padding: 8px 20px`, title **13.5px/700**, `line-height: 1.2`, close `×` at 15px. Title and `×` only. |
| Body padding | `10px 20px 12px` |
| Footer (`.qz-lm-f`) | 62px — `padding: 11px 20px`, cream ground |
| Section rules | 1px hairline, `margin: 9px 0` |

The band numerals (`1` `2` `3`) are gone. `THEN` and `WHAT THE QUIZ SHOWS` keep their words;
"when they answer" has no label at all — it is the first thing in the modal.

### Question rows

| Part | Value |
|---|---|
| Row grid | `176px | minmax(0,1fr) | 124px` — label, answers, operators |
| Row padding | `8px 0`, 1px hairline between rows |
| Row height | 77–86px, **bounded** (see clamps) |
| Label line 1 | `Q1` at 10.5px/600 + the type tag, **multi-select only** |
| Type tag | 7.5px/700, uppercase, `.06em`, accent-tinted (`--qz-accent-wash` / `--qz-accent-line` / `--qz-accent-ink`) |
| Label line 2 | question text, 12.5px/600, **clamp 3 lines** + ellipsis, full text in `title` |
| Answer bucket | **130 × 62**, 11px text, **clamp 2 lines** + ellipsis, full text in `title`, vertically centred. 5 of this quiz's 29 answers clip |
| Bucket strip | `display:flex; flex-wrap:nowrap; gap:6px; overflow-x:auto` — one row per question, scrolls sideways past ~7 answers |
| Bucket, selected | `--qz-accent` fill, white 600 text |

Both clamps exist to bound the row: whatever the merchant writes, a row stays ≤ 86px, which is
what makes a long quiz predictable. Q6 in the 8-question tab of the artifact is 107 characters
on purpose — it clips, and its row is exactly as tall as the ones around it.

### Operator cluster (right of every row)

One cluster per row, in a **constant 124px column**, contents **flush right**:

- `is` / `is not` — the existing per-condition negation. Always present.
- `any of` / `all of` — the existing within-question join. **Only rendered once that question
  has two or more answers picked.**
  - `question_type === "multi_select"` → a button; toggles `any of` ⇄ `all of`.
  - anything else → stated, not offered: dashed, cream, `cursor: default`, with
    `title="A shopper answers this question once, so two answers here can only mean either of them"`.
    ("all of" on a single-select can never fire.)

The column is reserved whether or not the join is showing, so the join appears into space the
row already had — **the answer strip does not reflow and the row height does not change**
(verified: the strip measures the same before and after a second pick).

Several answers may be picked on **any** question type. `toggleAnswer` already appends on every
type — do not "fix" it to replace on single-select.

### THEN

One 36px row: the label, a segmented `Show | Pin | Hide`, and the chosen verb's hint beside it
in 11.5px muted ("these become the results"). Verb map is unchanged:
`show → "show"`, `pin → "prioritize"`, `hide → "hide"`.

### The products band — `onboarding`

The merchant's job in the funnel is to finish covering the groups they confirmed on the
**Recommendations** step, so those groups *are* the band. Those groups are `BuilderCategory` rows —
the same objects a rule targets (`target_ids` must be Category ids; see the "the merchant already
CONFIRMED the grouping" note in `onboardingBuild.server.ts`).

Header row: **Your recommendations** · a fraction chip — `2/3` **have a rule** — in `--qz-warn` while
there is a gap, `✓ 3/3` in `--qz-ok` when there is not · `+ Add something else` on the right. No kind
tabs, no search, no progress graphic: the fraction is the fastest read available and costs nothing.

Cards are **248px** here (`minmax(240px, 1fr)`, 5 across), ordered **uncovered first**, then covered,
then anything the rule uses from the catalogue.

- **Uncovered:** amber wash (`color-mix(in srgb, var(--qz-warn) 7%, #fff)`), amber border, thumb
  border tinted to match, and a **Needs a rule** chip.
- **Covered:** green, but quieter — a 5% `--qz-ok` wash, a green edge and a `✓ 2 rules` chip in
  `--qz-ok` on `--qz-ok-wash`. Done should read as "skip these" without being read at all.
- **Selected wins over both.** A card in the rule takes the accent fill; `needs` / `done` are applied
  only when it is not selected, so the three states never fight in the cascade.

Three signals in every state — position, colour and words — so it survives a colourblind reader and a
screenshot in a support thread.

The status chip takes the slot the **SET** kind tag held: in this band every card is a recommendation,
so the kind tag said nothing, and moving the status there keeps it on one line — the count line is
just `9 products`.

**The count opens the group.** Clicking a card's `9 products` opens *Inside firming* — the products it
holds, six rows and a `+ N more` tail. Two rules, both of which the pre-rework modal already got right
with `.qz-crm-rescount`:

- It is **its own button**, a sibling of the card's select button — not nested inside it. Opening the
  list must never toggle selection, and a click inside the list must never close it or select.
- It opens **upward**. This band sits at the bottom of the modal and `.qz-lm` clips overflow.

Cards move between the two states **only when a rule is saved**, never while picking, so nothing
jumps under the cursor mid-task.

Past **six** groups the list wraps to a second row anyway, so it splits into labelled
`Needs a rule · N` / `Has rules · N` sections. Below that the ordering carries it — labelled groups
cost a line each, and measured, three groups in three labelled sections took the modal from 712px to
908px.

**+ Add something else** reveals the catalogue *underneath* the groups, behind a dashed rule. Its
header is the same row treatment as the builder band — a **From the catalogue** label at 11.5px, then
the kind tabs (All · Products · Collections · Tags · Metafields — no Recommendations chip, they are
already above), then the 226px search — followed by a one-row grid with `+ N more`. It adds a
section; it never replaces the list. `Create & add another` collapses it again.

### The products band — `builder`

Opened from the Logic tab on an existing quiz. Nobody is working through a list, so the catalogue is
open from the start.

Header row, left to right, one line:

1. **What the quiz shows** — 12.5px/700
2. kind tabs beside it: **All** · **Recommendations** *3* · Products *214* · Collections *22* ·
   Tags *148* · Metafields *31*
3. search input — **226px fixed**, 12.5px, 1px `--qz-rule-strong` border (3:1, WCAG 1.4.11),
   directly after the last tab

Everything packs left; the tail of the row is empty.

Target cards: `repeat(auto-fill, minmax(180px, 1fr))`, gap 6px → 6 across, 48px tall.
Card = 24px thumb · name 12.5px/600 (ellipsis, `title`) · count sub-line 10.5px ("12 products") ·
kind tag. Recommendation cards also carry their coverage; catalogue kinds do not — a tag is not
expected to have a rule, and "no rule yet" against 214 products would read as 214 to-dos.

Filtering to **Recommendations** shows all of them (nothing of that kind is behind search, because
the quiz owns every one), so its line reads `Recommendations · all 3 groups this quiz recommends`.
Catalogue kinds get `Tags · 2 in this quiz of 148 — search to reach the rest`.

**No "needs a rule" here.** There is no confirmed list to finish in this flow, so an uncovered group
is not a to-do: no amber, no outline, no headline. A group that *does* have rules still says
`2 rules`, because that is a fact about the quiz rather than a task for the merchant.

**One row at rest — `All` view only.** Five cards plus a dashed tile: whatever the rule already acts
on, then the recommendation groups, then anything else the quiz already uses. The tile reads
`+ N from the catalogue`. Clicking it shows everything (band 114 → 169px) and it stays open for that
rule. A filtered view is never capped.

### Both bands

**A filter can never hide part of the rule.** One grid, always, with whatever the rule already acts
on rendered first — regardless of the active filter, and marked by the accent fill. This is the one
bug in this band that could ship a rule the merchant did not mean.

**Coverage rules.** Derive it client-side: for each category id, count the rules in
`doc.decision_rules` whose `target_ids` contains it. No new API. Then:

- **Covered is a count, not a flag.** A group with rules stays fully selectable and the number goes
  up; several rules may legitimately point at the same group, since rules are checked top down and
  the first match applies. Never disable, grey out or hide a covered target.
- **It is a readout, not a gate.** Nothing blocks saving a rule because a group is uncovered, and
  nothing blocks publishing — the existing publish gates are unchanged. If an uncovered group should
  warn at publish time, that belongs in the publish gate, not here.

### Footer

`[N selected] ......... [Cancel] [Create & add another] [Create rule]`

- `N selected` sits at the footer's left, 12.5px muted with the figure in ink. It is a fact about
  the rule you are about to save, so it belongs beside the buttons, not in the band. Hidden at zero.
- `Create rule` and `Create & add another` are both disabled until the rule has ≥1 condition and
  ≥1 target.
- No read-back sentence, no paths readout. `/api/quizzes/rule-impact` is no longer called from
  this surface — leave the endpoint, drop the fetch and the debounce.

---

## 3. Interaction rules

### A pick must never move the merchant

Toggling an answer, a target, the verb or an operator changes state and **nothing else**. Keep the
scroll containers and the focused button mounted so React updates them in place — do not remount
the list or re-key the rows. Scroll position (page and any inner scroller), the sideways position
of an answer strip, and keyboard focus all survive a pick.

(The artifact re-renders wholesale by design, so it snapshots and restores those three things to
get the same behaviour. In React this is free if nothing is remounted.)

### Create & add another

The only place the modal *should* move you.

1. **Commits** on the same path as `Create rule`: `/api/categories/ensure-targets` materialises raw
   tag/collection/product picks as Category rows, then `createDecisionRule` writes the rule.
   The modal does **not** close.
2. **Toast**: `✓ Rule saved`. Nothing else — the old wording explained that rules are checked top
   down, which is a fact about the ledger, not about this click. It is the merchant's only
   confirmation while the modal stays open, so it must not be skipped.
3. **Resets**: answers cleared, verb back to `Show`, targets cleared, kind filter back to `All`,
   search cleared, body scrolled back to Q1.
4. **No counter.** The toast is the whole confirmation — nothing accumulates in the header. The
   rules the merchant has banked are visible in the ledger behind the modal, which is the real record.

Four things this button has to get right:

| Rule | Why |
|---|---|
| Commit against **`getLatestDoc()`** every time | The ensure-targets fetch sits between the click and the write; back-to-back saves against a render-time snapshot drop the earlier rule. The seam already exists for `Create rule` (review L2-5) — reuse it. |
| **Never reset on failure** | If ensure-targets errors, keep the draft exactly as it is and toast the failure. A reset on the error path destroys work that cannot be recovered. |
| **Keep the categories it created** | Rows materialised by ensure-targets are lifted through `onCategoriesCreated` and belong to the quiz, not the draft. Clearing local state must not clear them, or the next rule re-creates duplicates. |
| **Not in edit mode** | When `editRule` is set the footer is `Cancel` + `Save rule` only. "Save this edit and start a new one" is a sentence nobody means. |

The header carries the title and the close `×` and nothing else — no saved counter, no impact readout.

---

## 4. New functionality — and what to watch

Everything above is layout. These are the behaviours that did not exist before, each with the rule
that governs it and the thing most likely to go wrong.

| New | The rule | The risk |
|---|---|---|
| `flow` prop | Changes the products band only. Default `"builder"`; the funnel passes `"onboarding"`. | Forking the whole component. Don't — everything above the band is shared. |
| Coverage readout | Derived from the doc every render: for each category id, count rules whose `target_ids` contains it. | Caching it, or keeping a local counter that drifts from the doc. |
| Products peek | The card's count opens the group's contents. Its own button; never selects. | Nesting it inside the card button, so opening the list toggles the target. |
| `+ Add something else` | Reveals the catalogue *under* the groups; never replaces them. Resets on save. | Swapping the band's content instead of appending a section. |
| `Create & add another` | Commits, toasts, resets, stays open. | Resetting on the failure path. See §3. |
| Position holding | A pick changes state, never the identity of a scroll container. | Remounting or re-keying the list on every pick. |

### Considerations and edge cases

**A quiz with no recommendation groups.** The onboarding band has nothing to lead with. Fall back to
the builder band — title `What the quiz shows`, kind tabs and search visible — rather than rendering
an empty `Your recommendations 0/0`. A funnel quiz should always have categories, so treat this as
defensive, not expected.

**A quiz with many groups.** Past six the list wraps anyway and splits into labelled
`Needs a rule` / `Has rules` sections; the band grows and the modal grows with it, scrolling as one
piece. Nothing needs capping — but do check against a real catalogue that the first row is not
mostly tags.

**Coverage is per group, not per product.** The readout counts rules pointing at a `Category`. A
product sitting in two groups is reachable through either. Do not build a per-product coverage index
— it answers a question nobody asked and it is expensive.

**"3 rules" is not "3 outcomes."** Rules are checked top down and the first match applies, so a group
with three rules still produces one outcome for any given shopper. Never render the count as a number
of outcomes, and never treat "already covered" as a reason to block or hide a target.

**Editing an existing rule.** With `editRule` set, that rule is in the doc, so it counts toward its
targets' coverage — a group can show `1 rule` where that one rule is the very rule being edited.
That is honest, and cheap; if it reads badly in testing, exclude `editRule.id` from the count. Also
hide `Create & add another` in edit mode: the footer is `Cancel` + `Save rule`.

**Targets that are not yet categories.** Tags, collections and products picked from the catalogue are
materialised into Category rows by `/api/categories/ensure-targets` at save time. Before that they
have no id and therefore no coverage — they show a plain product count, which is exactly what the
"coverage only on recommendation groups" rule already gives you.

**Coverage changes made elsewhere.** Deleting a rule from the ledger changes the counts. Because the
readout is derived from the doc on render, reopening the modal is enough — there is no cache to
invalidate.

**The peek's data is already in the component.** `resolveResource` resolves a category to
`IndexedProduct[]` from `productIds` + the product index. Cap the list at six with a `+ N more` tail;
do not fetch. Prefer the existing `QzPopover` primitive for placement — the pre-rework modal used it
for exactly this control — rather than the hand-positioned panel the mock uses.

**Cheap, but not inside the loop.** Build the coverage Map once per render, not per card. It is
O(rules × targets) either way; the loop version is just noise in a profile.

---

## 5. What to delete, and what to leave alone

**Delete** (dead once every question is always a row):

- `activeCols`, `setActiveCols`, `addCol`, `removeCol`, `dirtyCols`, `touchCol`
- the `+ Qn` chip row and the `×` on each column header
- `matchMode` / `setMatchMode` and the `match all` / `match any` segment
- the `impact` state, its debounce and the `/api/quizzes/rule-impact` fetch
- the footer read-back sentence and its `answerLabel` helper if nothing else uses it

**Leave alone** — these look adjacent but are load-bearing:

- `match` stays in the schema and the engine. Rules already saved with `match: "any"` must keep
  behaving that way; we stop *writing* it, we never stop parsing it.
- `any_of` (the within-question join) and the per-condition `op: "is" | "is not"` are unchanged —
  the new cluster writes exactly the same fields.
- Legacy replace rules: an edited rule with `action` absent keeps it absent unless the verb changes
  (`legacyReplace`).
- The draft-safe scrim (clicking it must not discard) and the document-level Esc listener
  (review L2-4).

---

## 6. Accessibility

- Dialog keeps `role="dialog" aria-modal="true" aria-label="Create a rule"`.
- Every bucket, target card, kind chip and operator is a real `<button>` with `aria-pressed`.
- Focus ring: `2px solid var(--qz-accent)`, `outline-offset: 1px`, never removed.
- The search input's border is `--qz-rule-strong` (3.14:1), not `--qz-rule` — WCAG 1.4.11 applies
  to anything you can type into.
- Clipped text always has the full string in `title`; the clamp is never the only copy of it.
- Colour is never the only signal: selected buckets and cards change fill *and* weight; `is not`
  changes colour *and* word.

---

## 7. Verification

Standard gate chain before commit (unpiped `&&`):

```
npm run typecheck && npm test -- --run && npm run build && npm run lint && node scripts/check-tokens.mjs
```

Then, because this is an interactive-state change, screenshots are not optional — a 200 and DOM
markers are not proof (a pointer-trapped overlay renders fine and is unclickable). Check:

1. Five-question quiz: modal is ~717px at 1,330px wide, every question on one row, no sideways scroll;
   the products band is one row of five cards plus `+ 7 more`.
2. Pick a second answer on a **single-select** question → `any of` appears, dashed and not
   clickable, and the answer strip does not move.
3. Pick a second answer on a **multi-select** question → `any of` is a button and flips to `all of`.
4. Scroll an eight-question modal halfway, pick an answer → position and focus unchanged.
5. Filter the products band to Tags with a Set selected → the Set stays visible in `Acting on`.
6. `Create & add another` in the onboarding flow → toast, cleared form, back at Q1, catalogue
   collapsed; the coverage headline, the meter and the card counts must all move (a group that had 2
   rules now shows 3). Then check the ledger behind the modal has the rule and the doc autosaved.
7. Open the same modal with `flow="builder"` → identical questions, operators, verb and footer; only
   the band differs, and it carries **no amber, no green and no headline** — an uncovered group there
   is just a group.
8. Click a card's product count → the group's contents open **upward**, inside the modal; the card's
   selection does not change, and a click inside the list neither selects nor closes.
9. `+ Add something else` → the catalogue appears **below** the groups with its own label row; the
   recommendations are still on screen. Saving collapses it again.
10. Delete a rule from the ledger, reopen the modal → the fraction and the card counts reflect it
    with no cache to clear.
7. Kill the network mid-save → draft intact, error toast, nothing cleared.

The byte pin still applies to any deploy that touches this repo:

```
curl -sS https://quizocalypse-studio.fly.dev/q/cmqqcb0ao004mqvkwjug7t0ya.json | shasum -a 256
```

first 16 chars must stay `c02ccaec98a0fe9e`.

---

## 8. Still open

- **Toast wording.** The button says *create*, the toast says *saved*. Owner's word; make it
  "Rule created" if the verbs should match end to end.
- **Quizzes with many recommendation groups.** With three groups the row is the picks, all three
  groups, and a couple of the quiz's tags. With nine or more it becomes purely recommendations and
  everything else moves behind the tile — the ideal reading of it. Worth checking against a real
  catalogue that the first row is never *mostly* tags.
- **The band's one row.** Chosen deliberately, but it is the thing to watch in testing: this band is
  what the redesign set out to make visible, and one row shows five of the quiz's twelve targets. If
  merchants start hunting through `+ more` or the search for targets they used to see, the two-row
  band (169px) is a one-line change back.
- **Ten-plus-question quizzes.** At 8 questions the modal is 1,043px and scrolls as one piece,
  which is the chosen behaviour. If quizzes routinely run past ten, revisit the capped question
  list (`max-height` + `overflow-y:auto` on the condition zone, ~5 rows) — it is in the artifact
  behind a toggle.
- **Duplicate rule.** Cutting `match any` means "either condition set → same outcome" is now two
  rules kept in sync by hand. A duplicate action on the ledger would mostly erase that cost.
