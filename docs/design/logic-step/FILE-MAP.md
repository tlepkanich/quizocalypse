# Logic step — file map

Which files each build step touches. Paths verified against `builder`.
Line numbers are anchors, not contracts — grep the symbol if one has moved.

Read first: [`DEV-HANDOFF.html`](DEV-HANDOFF.html) · mock:
https://claude.ai/code/artifact/6afe9ff0-9311-4cdf-b442-dfd64e37730d

---

## Step 1 — Fix the index gaps

| File | Change |
|---|---|
| `app/lib/productIndexing.ts` (41) | `flattenMetafields()` — split `list.*` metafields on comma. The `type` is already on the raw value. **Bug 1.** Also drop `N/A`-family values here (**bug 4**). |
| `app/lib/recommendationEngine.ts` (1029) | `IndexedProduct` — add `status`, and `vendor` if in scope. |
| `app/lib/quizPublish.ts` (866) | Bake the new fields into `product_index`. |
| `app/lib/quizEditorIO.server.ts` (980) | Same derivation for the draft-time menus — publish and builder must never disagree. |
| `app/lib/filterMatching.ts` (195) | `productMatches()` — add a `vendor` branch only if vendor ships. |
| `prisma/schema.prisma` | **Read only.** `vendor` :116, `status` :118 already exist. |

## Step 2 — The attribute read-out

| File | Change |
|---|---|
| `app/lib/attributeClustering.ts` | **New.** Full algorithm in handoff §10. Pure function over the index. |
| `app/lib/attributeClustering.test.ts` | **New.** Fixture catalogs; assert the guards (`hits >= 2`, the copy/identifier pre-classification) by the real cases named in §10. |

## Step 3 — Engine: OR

| File | Change |
|---|---|
| `app/lib/recommendDecider.ts` (456) | `ruleMatches()` :275 is `conditions.every(...)`. Add: rule-level `match any`, OR between conditions on the same question, `all of` on multi-select. Keep first-match-wins at :199. |
| `app/lib/quizSchema.ts` (2193) | `DecisionRule` :1657 — new fields `.optional()`, **never** `.default()`. |
| `app/lib/pathEnumeration.ts` | Path maths must agree with the new semantics. |

## Step 4 — Attributes + Rules workspace

| File | Change |
|---|---|
| `app/components/studio/logicTab/QuestionWindow.tsx` (988) | Rail, header, role control, mapping table. Writes `role`. Add the one-`decides` lockout (handoff §12). |
| `app/components/studio/logicTab/LogicTabCard.tsx` (675) | Shell. |
| `app/components/studio/logicTab/logicTabFields.ts` (367) | `narrowFieldOptions()`, `derivedNarrowLabel()`, `guessAnswerMappings()` — reuse, don't rewrite. |
| `app/lib/filterMatching.ts` | **Reuse** `filterAnswerMatchCount()` — `null` = pass-through, `0` = dead end. Do not recompute. |

## Step 5 — Rule surfaces

| File | Change |
|---|---|
| `app/components/studio/logicTab/CreateRuleModal.tsx` (674) | Rebuild to the mock. Verbs map: Show→`show`, Pin→`prioritize`, Hide→`hide`. Add `is`/`is not`. |
| `app/lib/mutations/deciderMutations.ts` | `createDecisionRule` lives here — `quizMutations.ts` is only a re-export barrel. Add edit / duplicate / reorder. |
| *(ledger + paste)* | New components. Shadow detection per handoff §11. |

## Step 6 — AI

| File | Change |
|---|---|
| `app/lib/ai/generation.ts` (1241) | Add `role` to the tool schema (~:120, :303). Rewrite the "keep qualifier answers' tags light" instruction at **:420–421**. |
| `app/lib/smartBuild.ts` (517) | :436 writes `decides`/`qualifier` only — teach it `filter`. |
| `app/lib/funnelDraft.server.ts` (176) | :80 sets `logic_model` and no roles at all. |

## Step 7 — Chooser, style bar, gates

| File | Change |
|---|---|
| `app/lib/funnelStages.ts` (98) | :26 — the `logic` stage already exists. |
| `app/lib/quizValidation.ts` (421) | Gates. Rule checks at :189. |
| `app/lib/quizPublish.ts` (866) | `PublishError` blocks; rule baking at :204. |

---

## Do not touch

| | Why |
|---|---|
| `app/components/questionsLogic/` | Serves **legacy points docs** by design. `Tier1CheckList` + `usePathQuality` are live deps of `questionsLogicV3/HealthPopover`. |
| `conditional_rules` | Result-node field on the legacy match-ladder engine (`recommendationEngine.ts:245`). Not this project — see handoff §12. |
| `walkLadder`, `pickPointsWinner`, `ensureQuizDiscount` | Legacy engine. Decider docs never write them; nothing is removed. |
| `collect_email_on_result`, `hero_logic: "match"` | Parsed forever for published legacy docs. |

## Verify

```
npm run typecheck && npm test -- --run && npm run build && npm run lint && node scripts/check-tokens.mjs
```

Unpiped `&&`. Then the byte pin — must not change unless a legacy doc was
deliberately republished:

```
curl -sS https://quizocalypse-studio.fly.dev/q/cmqqcb0ao004mqvkwjug7t0ya.json | shasum -a 256
```

First 16 chars must read `c02ccaec98a0fe9e`.

Probe library, fixtures and seed/restore contracts: [`e2e/README.md`](../../../e2e/README.md).
Public HTTP surface: [`docs/public-api.md`](../../public-api.md).
