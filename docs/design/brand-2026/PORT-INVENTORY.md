# Quartz Rail — port inventory (mock ↔ product)

Measured 2026-08-11 by a recon agent against this worktree + the handoff bundle.
`MOCK` = `docs/design/brand-2026/_src`. Statuses: PRESENT / PARTIAL / MISSING / EXTRA
(product-only, not in the mock). This file is the port checklist AND the
"note for future agents" list the owner asked for.

## Load-bearing findings

1. `data-qz-surface="editor"` CSS exists (quizocalypse.css) but nothing sets the
   attribute. One line on the builder wrapper (`UnifiedWorkspace.tsx` `.qz-builder`)
   delivers the mock's central editor argument.
2. `--qz-home-ground` declared, zero consumers. Home is the ONE tinted page.
3. Three conflicting desktop preview sizes: mock 960×700; `previewWidth.ts` 1128×640;
   `GuidedPreview.tsx` 1180×740. Phone: mock+previewWidth 390×745 vs GuidedPreview 390×844.
4. Two independent fit implementations — `DeviceFrame.tsx` (correct, reports onFit)
   vs `GuidedPreview.tsx:106–145` (its own). Collapse onto DeviceFrame.
5. The editor zoom readout prints REQUESTED zoom, not applied scale
   (`UnifiedWorkspace.tsx:716`) — exactly the F5 failure the handoff names. The
   correct pattern exists at `Step5Preview.tsx:167–174` (onFit-fed).
6. `gen_progress` is computed server-side (`step2Build.server.ts:265–270`) and thrown
   away by the UI (`Step1Funnel.tsx:361–364` retired the checklist). Mock s11 exists
   specifically to bring it back as a 4-row done/now/todo list.
7. Autosave "Paused while AI edits" is fully implemented in `useQuizDraft.ts:77–112`
   and never surfaced. Cheapest state-gallery win.
8. OWNER-CALL CONFLICTS (mock contradicts a deliberate product decision):
   a. Funnel autosave chip is error-only by owner edit 2026-08-02
      (`funnelChrome.tsx:48–53`); the mock (2026-08-09, newer) draws Saving/Saved.
      → Ported per the mock; owner can re-flip.
   b. Roles + attribute slots were deliberately removed from the Overview and the
      Build inspector (`OverviewLedger.tsx:26–28`, `ContextPanel.tsx:43–47`); the
      mock puts a "Type & role" column in Overview and a Rules tab in the inspector.
      → KEPT the product split (LOGIC-TAB program, probe-covered). Owner call.
   c. Vocabulary: mock "Maps to / Picks the result / Narrows" vs product locked
      "Shows / narrows / ◆ Starting set / Info only" (`LogicTabCard.tsx:31`).
      → KEPT product vocabulary. Owner call.
9. Shopper progress bar: five variants built in the handoff, none chosen
   (`handoff-content.mjs:312`). Runtime surface — NOT ported. Owner decision 4.
10. Also open per the handoff §18: the gold signature (aliased to neutrals for now),
    the pastel set (aliased; category surfaces need a non-hue differentiator),
    the 35 --qz-font-mono sites (alias keeps them compiling; per-site triage below).

## Home (s09)

| Element | Status | Note |
|---|---|---|
| H1 "What should this quiz help someone decide?" as THE page | PARTIAL | product: hero card "Launch your next quiz" |
| Goal composer textarea | PRESENT | `studio._index.tsx:161` |
| Inline brief rows (Who is it for / What decides / How long) | PARTIAL | live on a separate `/studio/goal` screen, not inline |
| "How long" must NEVER block the draft | CONFLICT | product requires 3–7 radiogroup before Generate |
| "Audience, factors, length" disclosure (aria-expanded) | MISSING | |
| Circular go button (arrow, aria-label "Draft my quiz") | PARTIAL | text button today |
| Modes: Browse templates / Start from scratch / Duplicate a quiz | PARTIAL | scratch entry removed 2026-07-25; duplicate lives in row ⋯ menu |
| First-run nudge "Set up your global design" | MISSING | no first-run state at all |
| Two-state page, composer byte-identical between states | MISSING | plus a 7s "Welcome back 👋" the mock doesn't have |
| "Pick up where you left off" checklist card (4 revenue-ordered todos) | MISSING | data exists (publish state, email count, integrations) — never joined |
| Section head: h2 + count chip + See all | PARTIAL | QzSectionHeader has no count chip |
| "Last 30 days" label + Full analytics link | PARTIAL | tiles exist; window is all-time; no link |
| Stat deltas (+18% etc.) | PARTIAL | QzStat supports delta; Home doesn't pass it |
| Revenue stat ($ + orders) | MISSING | 4th tile is "Published quizzes" |
| Quiz row meta "4,180 starts · 52% completion" | MISSING | meta is updated-date only |
| Resume meta "3 of 5 steps" | MISSING | funnelStages has the data |
| Week bar chart / hero art / gradient / sparkle | EXTRA | mock dropped them (flat Quartz) — removed in port |

## Build — product pool (s10)

PRESENT: step eyebrow/title/sub, AI note + rationale, tip card (+richer applied/undo),
segmented source picker + counts, search, pick rows, summary card + tally + chips,
Preview results page button, sticky rail. EXTRA (keep): member-list count links,
empty rail state, refresh catalog, picking/failed lifecycle states.
| Missing | Note |
|---|---|
| "Why these?" on-demand expansion | rationale is always-inline today |
| Facts list (With images / In stock / Price range) | no pool-health facts |
| "N out of stock — hidden until back" note | OOS configured later instead |

## While it generates (s11)

| Element | Status |
|---|---|
| Bounded card + ring + 4 orbiting sparks | PRESENT |
| Title = real current checkpoint | PARTIAL — decorative 5s rotation today |
| 4-row gen_progress checklist done/now/todo | MISSING — server signal exists, UI retired it. TOP PORT ITEM |
| No-escape rule (non-stalled) | PRESENT |
| QzLoadingRing "grab a coffee ☕" tone | EXTRA — off-spec for Quartz |

## Questions flow + phone (s12 upper)

PRESENT: tab pair, hint, library, add, flow rows (grip, rename, delete), extra-step
rows, resizer, phone/desktop toggle, merchant tokens in frame, Next drives the walk,
edit chrome outside the frame. EXTRA: expand, live-preview chip, per-question AI regen.
| Delta | Note |
|---|---|
| Remove stacked ↑/↓ (`qz-qf-nmv`) — grip only | mock names this fix |
| "· 2 extra steps" in the flow head | missing |
| "Question 1" qedit-bar label | missing |
| Answer-type select in the edit bar | product floats a tag beside the phone instead |
| 2-line word-boundary clamp | verify `fitSteps.ts` behavior |

## Questions — Overview (s12 lower)

| Element | Status |
|---|---|
| Real grid + sticky column header (# · Question · Answers · Type) | MISSING — still cards. Biggest structural delta |
| Editable rows/answers/add-answer-on-divider | PRESENT |
| Role tag + attribute per row | OWNER CALL 8b — lives on Logic |
| "Show the other 3 questions" truncation | MISSING |
| Attribute picker: example values line, is-thin flag, footer (Coverage matters + Cancel/Use), per-tab counts | MISSING (rest PARTIAL/PRESENT) |

## Explainers (s13)

Near-full parity (both galleries, chip rail, footer). Verify the fixed-height
no-scroll guarantee in `Explainers.tsx`. EXTRA: "How this quiz resolves" strip
(`Step3Shell.tsx:466–514`) — mock has no equivalent; kept.

## Logic (s14)

PRESENT: headers, add rule, numbered sentences w/ chips + and-joins + is_not,
verb chips, target tags, delete, per-question grouping, role popover + coverage
meta, products count button, editable Then-go-to. Richer than mock: maps-to tone
system, deleted-target state, empty states, Diagnose/Fallback/Capture (EXTRA,
needs a designed rest state).
| Missing | Note |
|---|---|
| Rules meta sentence "Run first, in order…" | product's note says something else |
| Questions meta sentence "Each question either picks…" | |
| Rule reorder by DRAG | product has ↑/↓ buttons; explainer copy says "Drag" — mismatch |
| Products popover: kind chip, "synced N min ago" line, price + stock pills, footer sentence, Open in Shopify | count + image + title only today |
| Role popover footer sentence | |

## Results + live preview (s15)

PRESENT: 6 pips, step title/sub, fields + suggestions, live-bound preview,
phone/desktop toggle, alternates shelf, hero layout, back-button rule.
| Delta | Note |
|---|---|
| Eyebrow lacks section name ("· The page copy") | |
| Forward button must NAME the next step | generic "Next →" today |
| "Try" suggestion label | product says "Suggestions" |
| "Top pick" ribbon on hero card | missing |
| Saved chip beside primary | ported per mock (owner-call 8a) |
| Zoom readout | missing in GuidedPreview; port Step5Preview pattern |
| Frame sizes | GuidedPreview 390×844 / 1180×740 → canonical 390×745 / 960×700 |
| Steps 2–6 have NO mock | designed by extension of the system |

## Editor (s16)

PRESENT: saved text, undo/redo, Assist, publish, rail items (Build/Products/
Logic/Theme/Settings), panel Add tab, flow tree + fix dots, add-step, canvas-bar
name, one/all screens, stage inline+phone, inspector Content/Design.
| Delta | Note |
|---|---|
| Breadcrumb "Quizzes / {name}" | missing (EditableTitle EXTRA — kept) |
| "Draft · N unpublished" pill | missing — no unpublished-change count exists anywhere |
| Analytics rail item | missing; route exists (`studio.$id_.analytics.tsx`) |
| Templates panel tab | missing; `VibeTemplateSelector.tsx` exists unwired |
| Floating block toolbar over selection (↑ ↓ duplicate ✕) | missing; list-only in Layers, and no duplicate action |
| Type tag on the selection ring | missing |
| Spacing Above/Below/Sides + per-side disclosure | single combined Padding today |
| Alignment + weight segmented controls | select / absent |
| Colour swatch + palette-name + scope hint | free-hex input today |
| "fold" marker on phone | missing |
| Device+mode toggles relocated to top bar | PARTIAL — accepted relocation |
| Inspector Rules tab | OWNER CALL 8b — deliberately design-only |

## Live states (s17)

| State | Status |
|---|---|
| Autosave Saving/Saved (funnel) | ported per mock (owner-call 8a) |
| Autosave error + Retry, never fades | PRESENT both surfaces |
| Autosave "Paused while AI edits" | MISSING — seam fully built, never surfaced |
| Gen stalled card + Start again + Use a template | PRESENT |
| Gen failed as centred empty-state, blame-free copy | PARTIAL — warn banner today; verify genError copy |
| Publish blocked persistent list card + foot sentence | PARTIAL — button+popover today; node links PRESENT |
| Publishing… holds width, glyph→ring | PARTIAL — width changes today (the exact forbidden thing) |
| Zero-quizzes empty | PRESENT |
| No-results names query + clears filter | PARTIAL — bare line today |

## --qz-font-mono triage (35 sites)

Closed direction: no monospace; figures get `font-variant-numeric: tabular-nums`,
labels become Figtree 700 uppercase +.09em. Inline `fontFamily` call sites:
`app.quizzes.$id.tsx` ×14, `app.design.tsx` ×3, `studio.products.tsx` ×1,
`app._index.tsx` ×1, plus 69 CSS refs. Alias keeps them compiling; per-site
classification done in the QRTZ-S2 pass (see commit).
