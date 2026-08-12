# Quartz Rail port — gaps, owner decisions, and follow-ups

Written 2026-08-12 at the QRTZ combine, from the six screen agents' verified
reports. Companion to PORT-INVENTORY.md (the full element-level checklist).

## A. Owner decisions — CALLED by the owner 2026-08-12 (build = QRTZ-O phase)

> 1 gold → violet + drop ◆ (recommendation taken) · 2 pastels → shape + label,
> not hue (recommendation taken) · 3 mono leftovers → NO call given, stays
> open · 4 shopper progress bar → **Chapters** (clarified in chat; decider
> docs only — legacy docs lack chapter structure and stay byte-identical) ·
> 5 autosave chip → newer edits win; the restored four-state chip STAYS
> (already shipped, closed) · 6 → ADOPT THE MOCK: Overview gets the role
> column back, the Build inspector gets a Rules tab (deliberate reversal of
> the LOGIC-TAB split) · 7 → ADOPT THE MOCK's vocabulary ("Maps to",
> "Picks the result") replacing "Shows / narrows / Starting set / Info only";
> string-pinned probes update alongside.

Original items, for the record:

1. **The gold signature** (handoff §18.1). Aliased to neutrals by the token
   swap — the five gold moments now render grey. The handoff recommends:
   move them to violet, drop the ◆ glyph. The ◆ glyphs still render (as ink).
2. **The pastel set** (§18.2). Aliased to neutrals. Home's stat cards are now
   the mock's one-tone big-figure tiles. The category surfaces
   (sectionPalette.ts hues) degrade to the neutral ladder — the handoff
   recommends differentiating by shape and label, not hue.
3. **--qz-font-mono leftovers** (§18.3). All 19 inline sites triaged; the
   sheet went 69 → 50 refs. The ~45 leftover label-style refs sit inside
   sibling screen sections (list in the QRTZ-S2 commit) — retuning them to
   the 700/uppercase/+.09em label style is a per-screen design pass.
4. **The shopper progress bar** (§18.4). Five variants built in the handoff,
   none chosen. Runtime surface — deliberately NOT touched. The handoff
   recommends Chapters.
5. **Funnel autosave chip** — the mock (2026-08-09) draws Saving/Saved; an
   owner edit (2026-08-02) had made it error-only. The mock is newer, so the
   port RESTORED all four states. Re-flip in funnelChrome.tsx if unwanted.
6. **Roles stay on Logic; the Build inspector stays design-only** — the mock
   puts a role column in the Overview and a Rules tab in the inspector; the
   LOGIC-TAB program deliberately removed both. The port KEPT the product
   split. Adopt the mock's placement only as a deliberate reversal.
7. **Logic vocabulary** — mock "Maps to / Picks the result" vs the product's
   locked "Shows / narrows / ◆ Starting set / Info only". Product kept.

## B. Unported features (exist in the mock, not built — for future agents)

- **Editor Templates panel tab** (s16): mock's third panel tab. The product
  keeps Add/Layers/Background; `VibeTemplateSelector.tsx` exists unwired.
- **Selection-ring type tag** ("Text" tag on the selected block): needs an
  edit-mode change under app/components/runtime/inspect.ts — runtime-frozen
  in this program. Prove shopper DOM unaffected before building.
- **Per-side spacing** ("Each side on its own", s16 inspector): BlockStyle
  stores ONE uniform padding; per-side needs schema surgery + a
  runtime/blockStyle.ts change.
- **Draft pill count** ("Draft · 10 unpublished"): no unpublished-change
  count exists. Shipped the honest version (Draft / Unpublished changes,
  session-scoped). Cross-session detection needs publishedAt/updatedAt in
  the builder loader.
- **"Synced from Shopify X ago"** in the products popover: `Shop.lastSyncAt`
  exists in the DB but never reaches the logic tab props.
- **"Open in Shopify"** links: no shop domain reaches the logic tab
  (baked only into publishedJson at publish).
- **"Low stock" pill**: `IndexedProduct.inventory_in_stock` is boolean —
  only In/Out possible.
- **Pool "In stock" fact + OOS note** (s10): `FunnelData.catalog.products`
  carries no stock field.
- **Home Revenue tile**: no order attribution exists; 4th tile is
  "Published quizzes". A future analytics phase owns this.
- **Home todos "See all"**: no todos destination exists; omitted.
- **Post-failure regenerate on the blank-Questions landing**: `retry-gen`
  400s once failure resets the stage; a safe re-kick needs a server branch
  that regenerates headless without clobbering manual edits.

## C. Code follow-ups (mechanical, safe to hand to any agent)

- **Port the role-popover footer + Coverage-matters treatment into
  `QuestionWindow.tsx`** — S6's enrichments landed in
  LogicTabMenus.tsx menus that lost their importers in LOGIC-TAB P10/P11
  (`RoleMenuButton`/`StartingSetMenuButton`/`NarrowsMenuButton` are orphaned;
  `ProductCountButton`/`RouteMenuButton` in the same file ARE live and did
  ship). The popover work is written and tested — it needs re-homing.
- **Breakpoint migration**: 26 max-width queries at 12 ad-hoc widths →
  the three Quartz breakpoints (--qz-bp-sm/md/lg). Locations greppable.
  Deliberately deferred past QRTZ-D1 — needs per-screen visual verification.
- **Weight segmented control** maps 400/500/700 only; an AI-written 600
  shows no active segment.
- **Mona Sans + shim + MonaSans.woff2** can be deleted the day
  quiz-runtime.css:33 changes its shell stack (runtime-frozen here).
- **Customer Engagement (/studio/customers) keeps page-local hardcoded
  colors** — the brown Win-back chip + gradient segment washes — never in
  the mock's eight screens; needs its own Quartz pass.
- **Toggle-switch tracks stay round** (four sites: `.qz-wswitch`,
  `.qz-s4-sw`, `.qz-eng-tg`, `.qz-rg-sw`) — the mock draws no switch, and a
  6px track around a 50% knob mismatches; squaring them is a design call,
  not a sweep.
- **Colour-alone focus rules left unscoped on purpose** (`.qz-rb-count-link`,
  `.qz-cust-row`): their payload is `outline: none` + a wash — scoping them
  above the global would strip the a11y ring. They need a real focus
  treatment before the specificity fix applies.

### Done in QRTZ-D1 (2026-08-12)

- ~~Dark-mode CSS deletion phase~~ — all 5 inert `html[data-theme="dark"]`
  blocks + historical dark comments deleted.
- ~~79 hardcoded `999px` pill literals~~ — swept: 59 admin-chrome sites →
  `var(--qz-radius-pill)`; 15 shopper-mimic preview sites keep the literal
  (marked `/* shopper-mimic: stays round */`); 4 toggle tracks kept (above).
- ~~13 `var(--qz-ink-1)` sites~~ — 12 sheet sites → `--qz-ink`; the 2 inline
  TSX sites (BrandIdentityPanel/BuilderDesignPanel) carry explicit `#111111`
  fallbacks and were left as-is.
- ~~`--qz-spring` + 500 body~~ — 9 remaining spring sites → `--qz-ease`,
  definition deleted; body is 400 per the Quartz ramp (segment-control rest
  states re-pinned at 500 — the one inheritance the mock draws heavier).
- ~~Two loading-button patterns~~ — unified on `.qz-btn-loading::before`;
  the `.qz-btn-ring` span + keyframe deleted, funnel primary migrated.
- ~~Sticky Overview header offset~~ — `--qz-topbar-h: 58px` added; the
  Overview sticky head, the topbar height, and the rec-rail 74px offset
  read it.
- ~~Latent focus-visible specificity trap~~ — 14 bare losing rules scoped
  under `body[data-qz]` (see the colour-alone exception above).
- ~~Stale comments~~ — qz.tsx `--qz-z-dropdown`, studio_.login/verify
  "Mona Sans" fixed; the "GLOBAL-VIEWPORT §4" 1160×672 comments were already
  gone (removed by an earlier phase).

## D. Known minor behaviors (accepted at combine)

- First-ever publish via the aiDegradeStrip's "Generate them now" can skip
  the button width capture (~20px wobble once).
- A selected block scrolled far out of view keeps its fixed-position toolbar
  until the next click/Esc.
- Figtree is the standard Google latin subset — extended-latin scripts fall
  back to system faces (same posture as the old Quicksand setup).
- GuidedPreview lost its ad-hoc 0.2 scale floor (canonical fit rule wins).
