---
name: "source-command-polish-builder"
description: "Ship ONE verified polish/usability improvement to the standalone quiz builder"
---

# source-command-polish-builder

Use this skill when the user asks to run the migrated source command `polish-builder`.

## Command Template

You are doing **one** focused, fully-verified improvement to the **standalone quiz builder** (the `/studio/<id>` `UnifiedWorkspace` chrome). This command is meant to be run on a loop (`/loop 30m /polish-builder`); each run ships exactly one improvement, then stops. The next run continues.

Backlog file (your source of truth + memory across runs): `.Codex/builder-polish-backlog.md`.

## 1 — Pick the work
1. Read `.Codex/builder-polish-backlog.md`.
2. **Refresh the backlog when it's thin or stale** — if it has fewer than 3 `[ ]` (todo) items, OR you haven't audited in the last ~5 runs: open the live builder with Playwright (a standalone quiz at `https://quizocalypse-studio.fly.dev/studio/<id>`, studio cookie via `STUDIO_ACCESS_TOKEN`), screenshot the dashboard + the builder (top bar, rail, each tool panel, canvas, filmstrip) in **light and dark**, critique them against a real design/usability bar (Quizell + Linear/Figma as references), and append new prioritized `[ ]` items. Note in the backlog that you re-audited.
3. Pick the single highest-priority `[ ]` item. Mark it `[~]`. If a genuinely higher-value issue jumps out from the audit, do that instead (and add the item).
4. **If there are no `[ ]` items left after a fresh audit → STOP.** Report "builder-polish backlog is dry — nothing high-value left." Do not manufacture churn.

## 2 — Implement (the project discipline — non-negotiable)
- Branch first: `git checkout -b polish-<slug>`.
- Make ONE focused, reversible change. Prefer additive / CSS / component-local edits.
- `source .env` in every probe block (memory: [[source-env-every-bash-block]]).
- Gates as a strict `&&` chain, UNPIPED (memory: [[strict-gate-chains]]): `npm run typecheck && npm test && npm run build && npm run lint`. Add a test when you add real logic.
- ff-merge to main, then `fly deploy --remote-only --app quizocalypse-studio`.
- **Live screenshot-verify** every visual/interaction change (the hard lesson — the panel/gates lie; eyes don't). For a new design token, verify the whole chain via PUT-then-`getComputedStyle`, not the panel (memory: [[design-tokens-four-wirings]]). Check light AND dark.
- Commit with the trailer `Co-Authored-By: Codex Opus 4.8 (1M context) <noreply@anthropic.com>`. Delete temp verify scripts; leave the tree clean.

## 3 — Record
- In the backlog: move the item to `## Done` as `[x] <item> — <commit sha> — <one-line verified result>`. Append any new issues you spotted.
- Keep the report to the user short: what shipped, the commit, the screenshot confirmation.

## Guardrails (the loop must not drift or regress)
- **Scope = the standalone builder chrome ONLY**: `UnifiedWorkspace.tsx`, `BuilderChrome.tsx`, `BuilderTopBar`/`BuilderSettings`/`BuilderThemePanel`/`BuilderBlocksPalette`/`BuilderPageSettings`, `FlowRail`/`ContextPanel`, `Step5Preview`/`DeviceFrame` (bare path), the `.qz-builder-*`/`.qz-canvas-card`/`.qz-film-*`/`.qz-ps-*` CSS. NEVER touch: embedded `/app/*` Polaris, published `/q/:id` runtime output, the recommendation engine, `quizPublish`/`quizSchema` semantics, `shopify.server.ts`, the sacred rules in AGENTS.md.
- **One change per run.** Never batch.
- **Don't auto-ship the subjective or risky.** If an item is a brand/design-direction call, a layout reversal the user flip-flopped on (e.g. card vs full-bleed canvas), a schema/migration, or anything you're <80% sure improves things → mark it `[?]` needs-human in the backlog with a one-line rationale and pick the next safe item instead.
- **Regression guard:** every run keeps 585+ tests green; embedded `/app` and published `/q` stay byte-identical (your changes are builder-chrome-scoped, so verify-by-construction + a quick `/q` smoke if you touched anything shared).
- **Stop when dry.** A clean, finished builder is the goal, not endless churn.
