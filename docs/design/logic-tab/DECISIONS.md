# Logic tab — locked build decisions (2026-08-07)

Companion to `HANDOFF.md` (the spec of record). Every open question in the
handoff's §10 gap list is resolved here; where the handoff and the engine
disagree, the engine wins (handoff's own rule, §0). Owner directive: build the
features the handoff asks for, taking their spec from the handoff.

## Gap resolutions

| Gap | Decision |
|---|---|
| **G1** multi-target rules | **Widen the schema** — `DecisionRule.target_ids: string[].optional()`. `target_id` is parsed forever as the single-target form and always mirrors `target_ids[0]`, so every legacy reader (publish baking, ruleSummary, path analyzer) keeps working unmodified until updated. Engine unions member pools; the FIRST target anchors config/persona lookup; a multi-target union never takes the `product` hero-only shape. |
| **G2** OR between conditions | **AND-only v1** (handoff's own recommendation). The `and`/`or` joiner is not rendered; no storage added. |
| **G3** any-of / all-of | Ships with G2: not stored. **The modal hard-limits one chip per single-select question** — two ANDed `is` conditions on a single-select can never fire (dead-rule trap), so authoring one is blocked, not warned about. |
| **G4** verb wiring | Per the handoff's table: UI **Show** → `action` absent (replace), **Highlight** → `action: "show"`, **Exclude** → `action: "hide"`. `prioritize` stays unexposed in this design. |
| **G5** narrowing sources | **Tags + Collections + Metafields.** The metafield branch is funded: `Answer.metafield_filters` + a `productMatches` branch over the already-baked `IndexedProduct.metafields`. Variant options / product type / price bands stay hidden (not baked as filterable). |
| **G6** mock `resolve()` | Not ported (mock never existed in-repo anyway; see below). |
| **G7** `updateDecisionRule` | Patch widened to `conditions \| target_id \| target_ids \| action`; `action` is clearable (Show = absent). |
| **G8** Anything mode | `Answer.collection_filters: string[].optional()` (additive; `collection_filter` parsed forever, unioned in). Products/variants are **dropped from the Anything picker** — "several things at once" is what a Group is for. |
| **G9** starting-set answers | One target per answer (handoff's recommendation). |
| **G10** impact numbers | Server-side over `app/lib/pathEnumeration.ts`. Note the real cap is **2 000 paths** (`maxPaths`), not the mock's 200 000 — the `truncated` flag drives the "(sampled)" wording much earlier than the handoff implies. |

## Copy corrections (engine-is-right rule)

1. **Explainer "Top rule wins" (§7.1 step 2):** the engine is strict
   first-match-wins — at most ONE rule applies per shopper
   (`resolveTarget` stops at the first match, action or not). The mock copy
   "excludes and pins always apply" is wrong and must not ship. Corrected copy:
   *"Checked top down. The first rule that matches applies — the rest are
   skipped."*
2. **Show's taught order (§1 pipeline, §4.2 hint, §7.2 step 4):** an
   action-less rule (UI **Show**) replaces the target BEFORE
   `narrowIdsByFilters` runs, so Narrows still narrow a Show rule's products.
   Teach: *"Show replaces the starting set — your Narrows questions still
   apply."* Highlight/Exclude genuinely run after filters, as the handoff says.
3. **Zero-condition rules:** blocked at creation (§4.5's disabled Create is the
   one canonical rule); the `Always <verb>` grammar of §3.3 is unreachable and
   not built.

## Additions the handoff missed

- **Dangling references:** rules whose conditions/targets point at deleted
  questions/answers/categories surface via the existing
  `pathAnalyzer.ts` checks (`brokenRuleRefs`, `halfBuiltRules`, `deadRules`,
  `shadowedRules`) — rendered flagged, never silently dropped.
- **Rule reorder:** explicit per-row affordance (the current RuleRow's ↑/↓
  pattern), since row order is priority and drag alone is not specced.
- **Draft-time counts** come from the builder loader's `productIndex` +
  `filterAnswerMatchCount` — no publish required, no new endpoint.

## Surface fate

The one card **replaces** `BuilderLogicView`'s Map · Paths · Table chrome and
`LogicRulesBar` in the studio Logic view. Funnel Step-3's logic mode migrates
to the same shared component in a follow-up phase. Legacy
`app/components/onboarding/questionsLogic/` (points model) is untouched.

## Mock sources

`docs/design/logic-tab/rules-tab/…` never existed in this repo or its history;
the only design artifact is the claude.ai link in HANDOFF.md. HANDOFF.md's
copy strings, metrics and token table are the buildable spec. Its mock token
names (`--ac`, `--ink`, `--s1..s6`) map onto the repo system: `--ac` →
`--qz-accent`, good/bad → the repo's ok/danger tokens; no hex literals in new
`.tsx` (check-tokens gate).
