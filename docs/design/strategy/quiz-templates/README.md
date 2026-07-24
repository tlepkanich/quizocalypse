# `quiz-templates/` — the builder-loadable layer

Machine-consumable twin of the prose docs one level up. An AI quiz generator can load these
directly: pick the template whose `category` matches the merchant's catalog, use it as the
starting skeleton, then bind each question's `maps_to` to real product tags/metafields.

## Files

| File | What it is |
|---|---|
| [`_schema.json`](_schema.json) | JSON Schema for a single flow template — the shape every `*.template.json` conforms to. |
| [`build-rules.json`](build-rules.json) | The enforceable generator guardrails as structured data (`error` blocks emit; `warn` surfaces a caution). Mirrors the build-reference guardrails in [QUIZ-MASTER-STRATEGY.md](../QUIZ-MASTER-STRATEGY.md) (Part 7). |
| `*.template.json` | One flow template per vertical (skeleton questions, gate, result shape, recommendation logic). |

## Templates

| File | Category | Length | Gate | Result shape |
|---|---|---|---|---|
| `skincare-formulation.template.json` | beauty/custom-formulation | long (20–35) | at-result, hard | single bespoke formula |
| `instant-shade-match.template.json` | beauty/shade-match | short-med (10–14) | at-result, soft | single hero + match % |
| `supplements-routine.template.json` | health/supplements | med (8–15) | before-results | multi-SKU pack |
| `apparel-fit.template.json` | apparel/fit | short-med (6–12) | deferred-to-action | size + ranked styles |
| `gift-finder.template.json` | gifting | short (5–7) | deferred-to-action, soft | curated shortlist |
| `pet-food-plan.template.json` | food/pet | med (8–14) | at-result | single meal plan |
| `durables-narrower.template.json` | durables | short (6–8) | deferred-to-action, soft | single hero + alt |
| `subscription-onboarding.template.json` | subscription | long (25+) | mid-flow | first box + profile |

## How the generator uses a template

1. **Select** by category (or blend if the catalog spans several).
2. **Bind** each `question.maps_to` to real catalog attributes (reuse Shopify Search &
   Discovery filters/synonyms rather than inventing a parallel vocabulary).
3. **Expand** the skeleton to the catalog: the listed questions are the *proven arc*, not an
   exhaustive set — add/trim within the template's `length` band and the build-rules caps.
4. **Validate** the generated quiz against `build-rules.json` before publishing. Any `error`
   rule that fails blocks the emit.
5. **Set the gate** per the template's `gate` block (category-dependent — the single
   highest-leverage decision).

Every empirical choice here is grounded in the sources cited in the prose docs; treat the
vendor-derived defaults (length caps, gate conventions) as overridable starting points, and the
Tier-A rules (MECE, no-slider, determinism, ≥1 product per path) as hard invariants.

_Last updated: 2026-07-14._
