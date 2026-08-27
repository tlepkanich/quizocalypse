# Logic step — start here

The Logic step sits between **Questions** and **Results** in the funnel
(`funnelStages.ts:26`). This folder holds its design and spec.

## Current — build from these

| | |
|---|---|
| **[`DEV-HANDOFF.html`](DEV-HANDOFF.html)** | **The spec.** Flow, rule model, storage, AI changes, the clustering algorithm, shadow detection, rule lifecycle, live bugs, build order. Audited against the code on `builder` — where the mock and the engine disagree, the engine is stated and the gap is named. |
| **[`FILE-MAP.md`](FILE-MAP.md)** | Which files each build step touches, plus the do-not-touch list and the verification chain. |
| **Interactive mock** | https://claude.ai/code/artifact/6afe9ff0-9311-4cdf-b442-dfd64e37730d — 18 modules with per-module build notes, plus a **Live · Made By Mary** tab that is the target design. |
| **Hosted spec** | https://claude.ai/code/artifact/62ecfa60-0d93-424a-8a59-887fa6020224 (same content as `DEV-HANDOFF.html`). |

Read the handoff first, then open the mock's **Live** tab beside it. The mock
is a design artifact, not a reference implementation.

### The four things most likely to trip you up

1. **Rules storage already exists.** `decision_rules` (`quizSchema.ts:1884`) is
   shipped end to end. Show/Pin/Hide map onto the existing
   `action: "show" | "prioritize" | "hide"`. Pin is a rename.
2. **The engine is AND-only.** `ruleMatches` is `conditions.every(...)`. Every
   OR in the design is net-new engine work. Handoff §3.
3. **No code path writes `role: "filter"`.** The narrowing role is set only by
   hand in the Logic tab, so every AI-built quiz arrives with narrowing unset —
   and the generation prompt actively discourages it. Handoff §5.
4. **Rule order is semantic.** First match wins and evaluation stops. Array
   position is priority. Handoff §11.

## Superseded — do not build from these

These describe the **previous** Logic tab design (mock `ca0ec5b5…`). Kept for
history only.

| | |
|---|---|
| `LOGIC-TAB-HANDOFF.md` | Prior spec, 771 lines. |
| `HANDOFF.md` | **Byte-identical duplicate** of the above (same sha256). Safe to delete. |
| `DECISIONS.md`, `NOTES.md` | Working notes from that round. |
| `logic-rules-map-3.html`, `logic-one-window.html`, and the other `.html` mocks in this folder | Prior mocks. |

Two other artifacts from this round are also superseded and now contradict the
current design on the rule builder: `f05b00dc…` (builder) and `668bb05f…`
(rule styles).

## Scope

Applies to `Quiz.logic_model === "decider"` **only**. Legacy points/ladder docs
keep `app/components/questionsLogic/` untouched, and must serialise
byte-identically after every change — see the byte pin in `FILE-MAP.md`.
