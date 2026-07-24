# Quizocalypse — design handoff bundle

Every design doc that is **new since the current live version** (`main`), gathered from the
design sessions into one package. All paths mirror where they live in the repo
(`docs/design/...`). Open the `.html` files directly in a browser — they're self-contained
prototypes. Files ending `.artifact.html` are the hosted-artifact copies of the same mock.
Each folder's `HANDOFF.md` / `SPEC.md` is the **dev spec** (maps the mock to the real
runtime/admin files, with guardrails); the other `.html` files are the mocks and
explorations behind it.

## What's inside (`docs/design/`)

| Folder | What it is | From |
|---|---|---|
| `build-tab/` | **The post-funnel Build tab** — block-stack builder, true-to-Shopify device preview, granular per-block design controls, per-device (mobile/desktop) sizing, social-proof + input blocks, split/quadrant backgrounds. `HANDOFF.md` is the spec; `build-tab.html` the prototype. | `design/build-tab` |
| `shape/` | Step 2 — **Shape** (the decider page) redesign + handoff. | `shape-page` |
| `step1-recommendations/` | Step 1 — **Recommendations** redesign: final page, picker options, AI-tip collapse, generating states, start-modal flow/options. | `shape-page` + `local-work` |
| `questions/` | **Questions step** — full builder page + layout / card / list variations. | `shape-page` |
| `results-page/` | **Results page** redesign mock. | `local-work` |
| `phone-preview/` | The shared **phone + desktop preview primitive** — `SPEC.md` + `DESKTOP-SPEC.md` are the **canonical global preview settings** (newest-wins). Fit-the-pane sizing, Mobile/Desktop toggle, display modes, Shopify framing. | `shape-page` (canonical) |
| `app-chrome/` | Shared **app chrome** — top bar + stepper primitive. | `shape-page` |
| `ai-fallbacks/` | **AI fallback states** (generation failed / credits depleted, etc.). | `local-work` |
| `strategy/` | **Quiz master strategy** — ROI playbook, build guide, and the `quiz-templates/` (per-industry template JSON + `build-rules.json` + `_schema.json`). | `shape-page` |

> **Read order for the Build tab** (this session's focus): `build-tab/HANDOFF.md` →
> `build-tab/build-tab.html`. Its preview behavior depends on the
> `phone-preview/` primitive (`SPEC.md` + `DESKTOP-SPEC.md`) — read those first if you're
> implementing the preview.

## Precedence — newest wins (the master rule)

Global settings follow the rule declared in `phone-preview/SPEC.md`: **when two docs
conflict, the most-recently-dated definition always wins.** Date order in this bundle:

1. **2026-07-16 — `build-tab/HANDOFF.md`** (newest). Supersedes the phone-preview SPECs
   **for the desktop preview only**: top-anchored width-fit never-upscale anchoring,
   placement-driven frame dims (replaces the fixed 1180×740), ~700px desktop content
   column, 4:3/200px image tiles. Its header states this explicitly.
2. **2026-07-15 — `strategy/QUIZ-MASTER-STRATEGY.md`** — the consolidated strategy master;
   supersedes any earlier separate strategy notes.
3. **2026-07-14 — `phone-preview/SPEC.md` + `DESKTOP-SPEC.md`** — canonical preview
   settings everywhere not overridden by (1); `app-chrome/SPEC.md`, `questions/`.
4. **2026-07-13 — `step1-recommendations/`, `shape/`, `ai-fallbacks/`, `results-page/`.**

Also applied when assembling this bundle: `phone-preview/` is the shape-page (07-14)
version — `local-work`'s older 3-file copy was **excluded** under the same rule.

## Provenance — the branches & commits behind this

None of this is on `main` yet; it lives on these local branches (not pushed). Commits that
produced the docs:

**`design/build-tab`** (Build tab — newest, 2026-07-16)
- `739d06e` docs(design): Build tab redesign — interactive prototype + dev handoff spec

**`shape-page`** (the integration branch — carries the canonical shared primitives)
- `ed31234` / `0ce3e94` / `481a066` / `dac1dcd` / `aff4af1` / `98e8392` docs(strategy): master strategy, Part 9 reveal & reward, per-industry playbooks, ROI + templates
- `f55d704` docs(design): phone + desktop preview global settings
- `cd4351b` docs(design): Questions step — full builder page
- `ada45ff` docs(design): shared app chrome (top bar + stepper)
- `50eb4b1` docs(design): adopt shared phone preview primitive
- `4ff2842` docs(design): Step 2 Shape redesign — mock + dev handoff spec
- `ccf6650` docs(design): Step 1 Recommendations redesign — mocks + dev handoff spec

**`local-work`** (adds the genuinely-new folders/files not on shape-page)
- `c84804b` docs(design): phone preview primitive + results page + AI fallback spec
- `d675108` docs(design): Step 1 start modal — stacked rows + goal brief screen

**Notes for whoever assembles the branches:** `phone-preview/` here is the **shape-page**
version (canonical, full set incl. `DESKTOP-SPEC.md`); `local-work` has an older 3-file
subset — prefer shape-page's. `step1-recommendations/` is shape-page's 5 files + the 3
extra modal-state mocks from `local-work` (`generating-states`, `start-modal-flow`,
`start-modal-options`); the shared files are byte-identical across branches. The guardrails
in each `HANDOFF.md` (decider-gated, `.optional()` never `.default()`, byte-pin
`c02ccaec98a0fe9e…` stays identical, `/q` loads only `quiz-runtime.css`) apply to all.
