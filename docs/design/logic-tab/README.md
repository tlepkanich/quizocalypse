# Quizocalypse — Logic tab design handoff

Two interactive mocks and the spec that goes with them. No build step, no
dependencies: **open either `.html` file in a browser and it runs.**

## Start here

1. **`LOGIC-TAB-HANDOFF.md`** — the spec. Model, every screen and control, every
   string, the mapping onto `quizSchema.ts`, the gaps that need a decision
   before code starts (§10), and the work breakdown (§13).
2. **`logic-rules-map-3.html`** — the primary mock. Rules and questions in one
   card; `✦ How it works` on each header opens a 4-step explainer.
3. **`logic-one-window.html`** — a later, streamlined variant. Same page, but
   clicking any cell in the Questions table opens the *same three-panel window*
   as Create-a-rule, over one searchable index. Read §"One window" below.

Both are self-contained HTML. Everything is fake data — no network calls, no
storage, nothing persists on refresh.

## What to try

**In `logic-rules-map-3.html`**
- `+ Create rule` — the three-panel rule window: conditions left, verb in the
  middle, one index of 261 tags / collections / metafields / products / variants
  on the right. The sentence and the "fires on N of M paths" line are live.
- Any `NARROWS · GENDER ▾` pill — the role picker.
- Any cell in **Shows / narrows** — the per-answer mapping picker.
- Any number in **Products** — the products behind that count.
- `✦ How it works` on either header — the stepped explainers.

**In `logic-one-window.html`**
- Any cell in the Questions table — the unified window.
- Empty a question's mappings and use **Map N answers for me**.
- Note the `NARROWS · <FIELD>` pill is *derived* from what the answers point at,
  not chosen up front. Point one answer somewhere else and it reads `MIXED`.

## Layout

```
LOGIC-TAB-HANDOFF.md        the spec
logic-rules-map-3.html      built mock — primary
logic-one-window.html       built mock — streamlined variant
build.sh                    regenerates both from source
rules-tab/                  source for logic-rules-map-3.html
  _shell.html                 markup + all CSS (design tokens at the top)
  _v.js                       the tab: rules card, questions table, pickers
  _x.js                       the two explainers
unified/                    source for logic-one-window.html (same three files)
bands/_core.js              shared demo engine + catalogue fixture
rule-create/_tags.js        162-tag fixture
```

`_shell.html` lines 3–72 are the design tokens — light, dark, and explicit
`[data-theme]` overrides. Font is Quicksand with a system fallback.

## Rebuilding

Edit the files under `rules-tab/` or `unified/`, then:

```sh
./build.sh
```

Concatenation order matters — `rule-create/_tags.js` defines `TAGS`, which
`_v.js` reads at load time to build the tag-group attributes.

## Two things worth knowing before you read the source

- These are **design mocks, not reference implementations.** Where the mock's
  engine and the real engine disagree, the real engine is right. §9 and §10 of
  the handoff list every known divergence.
- `logic-one-window.html` deliberately **removes** three of the mock's popovers.
  If you are comparing the two files, that is the intended difference, not drift.
