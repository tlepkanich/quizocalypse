# QRTZ screen-agent brief (shared rules)

You are one of six parallel agents porting the Quartz Rail design
(docs/design/brand-2026/) onto the Wiskr admin. The token foundation (QRTZ-T)
is already on this branch: Quartz values live in every `--qz-*` token, Figtree
is the admin face, radii are squared (6/4/8), `--qz-rule-strong`, `--qz-phone-r`
(20px) and `--qz-home-ground` (#F5F4F8) exist, `[data-qz-surface="editor"]`
CSS exists (attribute not yet applied), dark mode is pinned to light.

## Style strictness — the mock is proof of design

The design authority, in order:
1. `docs/design/brand-2026/_src/` — the mock's own markup + CSS
   (`base.mjs` = component CSS, `shared.mjs` = screen markup, `home.mjs`,
   `states.mjs`, `quartz.mjs` = shell vocabulary). Copy VALUES (paddings,
   sizes, weights, tracking, colors-as-tokens) from here. Do not improvise.
2. `docs/design/brand-2026/wiskr-handoff.html` — the assembled spec.
3. `docs/design/brand-2026/PORT-INVENTORY.md` — your element checklist with
   statuses and the resolved conflicts. Follow its owner-call resolutions:
   mock wins on the funnel autosave chip; product keeps roles-on-Logic and the
   locked Logic vocabulary; shopper progress bar is NOT ported.

Map mock variables → repo tokens: --page/--surface→--qz-paper ·
--surface-2→--qz-cream-2 · --ink→--qz-ink · --ink-2→--qz-ink-3 ·
--ink-3→--qz-ink-4 · --line→--qz-rule · --line-strong→--qz-rule-strong ·
--accent→--qz-accent · --accent-ink→--qz-accent-ink ·
--accent-wash→--qz-accent-wash · --accent-line→--qz-accent-line ·
--r-sm/md/lg→--qz-radius-sm/--qz-radius/--qz-radius-lg ·
--e-1/--e-2→--qz-lift-1/--qz-lift-2 · type ramp per meld.mjs (page title
42/800/−.032em · section 26/700 · card title 16.5/700 · body 14.5/400/1.6 ·
UI 14/500-600 · data 13/600 tabular · label 11/700/+.09em uppercase).
Figures always get `font-variant-numeric: tabular-nums`, never monospace.

## Hard rules

- NEVER touch `app/styles/quiz-runtime.css` or `app/components/runtime/**`
  (exception: S4 may touch `runtime/inspect.ts` markers ONLY if its brief says
  so). The shopper surface must stay byte-identical.
- Only edit files your brief assigns. Other files belong to sibling agents.
- New CSS goes in ONE marked section appended at the end of
  `app/styles/quizocalypse.css`:
  `/* ═══ QRTZ-S<n> — <screens> ═══ */`
  Edit existing blocks only where your brief explicitly assigns them.
- Behavior seams stay: mutations through app/lib/quizMutations barrels,
  autosave through useQuizDraft, no new deep imports into barreled modules.
- `var(--qz-ink-1)` is UNDEFINED — never write it. Use `--qz-ink`.
- Accent discipline: violet marks primary action, current selection, focused
  field — nothing else. State color is never decorative. No gradients. No
  full pills. One shadow language (--qz-lift-*).
- Copy tone: sentences from the mock verbatim where it draws your screen.

## Verify + hand off

1. `npm ci --no-audit --no-fund` first (fresh worktree has no node_modules).
2. Gates, unpiped: `npm run typecheck && npm test -- --run && npm run lint`
   (skip the build; the orchestrator runs the full chain at combine).
3. No browser available — do not attempt preview servers or screenshots.
   Visual verification happens at combine.
4. Write a 2-lens adversarial self-review (lens 1: what could my edit have
   broken; lens 2: what does the mock show that I did not deliver) in your
   final report.
5. Commit ALL your changes on your worktree branch, message
   `QRTZ-S<n>: <summary>`, ending with
   `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
   Report: branch name, worktree path, files touched, port checklist with
   done/skipped per element, and gaps-doc notes.
