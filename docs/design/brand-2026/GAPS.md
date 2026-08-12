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
   → **BUILT (QRTZ-OA, 2026-08-12)**: --qz-gold* re-pointed at the accent
   family per role (text→accent-ink, fill sites→accent at the site,
   wash/line→the washed pair) + re-declared under `[data-qz-surface=
   "editor"]` (baked-token rule, so the stand-down still neutralizes them);
   two mis-tagged WARN sites (.qz-rb-warn, .qz-gen-haltglyph.is-warn) moved
   to the warn pair instead; preview review stars pinned amber
   (shopper-mimic). ◆/◇ dropped from all owned markup; the logicTab/**,
   OverviewLedger and ContextPanel occurrences stay for their owning
   siblings (Decision 7 vocabulary).
2. **The pastel set** (§18.2). Aliased to neutrals. Home's stat cards are now
   the mock's one-tone big-figure tiles. The category surfaces
   (sectionPalette.ts hues) degrade to the neutral ladder — the handoff
   recommends differentiating by shape and label, not hue.
   → **BUILT (QRTZ-OA, 2026-08-12)**: sectionPalette keys are positional
   slots on ONE neutral tone; step-3 cards carry `data-qz-cat` and draw a
   6-way left-edge marker (solid / dashed / double rail / dot column /
   end caps / hairline — QRTZ-OA CSS section); the decider keeps the
   accent (solid accent bar). Nine zero-reference --qz-pal-* tokens
   deleted (green/coral/pink/amber pairs + purple); blue/teal pairs and
   all --qz-pastel-* keep live call sites and stay.
3. **--qz-font-mono leftovers** (§18.3). All 19 inline sites triaged; the
   sheet went 69 → 50 refs. The ~45 leftover label-style refs sit inside
   sibling screen sections (list in the QRTZ-S2 commit) — retuning them to
   the 700/uppercase/+.09em label style is a per-screen design pass.
   → **BUILT (QRTZ-O6, 2026-08-12)**: all 51 remaining refs retuned —
   label sites to Figtree 700 / +.09em / uppercase (sizes kept), numeric
   sites (number chips, ords, counts, the blurred URL, the discount code,
   seconds) to --qz-font-body + font-variant-numeric: tabular-nums. The
   --qz-font-mono token is DELETED (zero refs anywhere incl. runtime).
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

- ~~**Editor Templates panel tab** (s16)~~ — **BUILT (QRTZ-O6, 2026-08-12)**:
  fourth Build-panel tab (Add · Layers · Background · Templates) in
  `UnifiedWorkspace.tsx`; `VibeTemplateSelector` applies wholesale through
  the same validated writeTokens seam as BuilderDesignPanel (quiz scope).
- ~~**Selection-ring type tag** ("Text" tag on the selected block)~~ —
  **BUILT (QRTZ-F3, 2026-08-12)**: `inspectAttrs` adds `data-qz-sel-tag`
  only when onInspect is present AND the target is selected (returns `{}`
  on /q); the tag renders via `[data-qz-sel-tag]::after` in quizocalypse.css
  (admin sheet — /q loads quiz-runtime.css alone), names from
  `INSPECT_PART_NAME` (PALETTE_BLOCKS vocabulary).
- ~~**Per-side spacing** ("Each side on its own", s16 inspector)~~ —
  **BUILT (QRTZ-F3, 2026-08-12)**: optional `padding_top/bottom/left/right`
  on BlockStyle (never defaulted); per-side wins over uniform `padding` in
  blockStyleToCss (absent = byte-identical, pinned by a frozen-legacy
  equality test); LayoutTab's Space group grew the "Each side on its own"
  disclosure over the existing setNodeLayout write path.
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

### Noted at the QRTZ-B boundary pass (2026-08-12)

- Builder route has no viewport gate and horizontally overflows below ~760px
  — PRE-EXISTING (overflows both stacked and unstacked, so not the boundary
  move); consider extending the `.qz-viewport-notice` gate to `studio_.$id`.
- ~~The funnel tip's "Use this" primary renders FILLED violet~~ — **BUILT
  (QRTZ-O6)**: restyled to the mock's outlined `.tip .btn-primary` (paper
  bg, accent-ink text, accent border, hover accent-wash).
- `.qz-unified`'s below-lg panel drop applies to the embedded /app twin's
  shell; the standalone builder (.qz-bt-*) keeps three regions at 1280 ✓.
- quartz-tokens.css line ~127's "eight ad-hoc points" prose is now stale —
  the twelve widths were migrated to 720/1024(/1023 gate)/1439-below-lg.

### Noted at the QRTZ-O5 combine (2026-08-12)

- ~~Chapter labels skip `?locale=` overlays~~ — **BUILT (QRTZ-F2)**:
  `section_label` joined extractTranslatableStrings (additive — tables gain
  the key on their next translation run), and applyTranslations now re-labels
  baked `chapters[].label` from the FIRST question's translated section_label
  (per-chapter English fallback; docs without baked chapters pass through
  deep-equal — never re-derives, only re-labels).
- ~~Builder preview shows the classic bar while published /q shows Chapters~~
  — **BUILT (QRTZ-F2)**: `withDraftChapters` (quizPublish) injects the
  draft-derived bake into Step5Preview + RecPagePreview's preview docs (same
  deriveChapters + bails as publish, stale-draft strip included), and the
  `.qz-chapters` rules are mirrored into quizocalypse.css (the canvas never
  loads quiz-runtime.css — keep the two blocks in sync). The funnel's
  PhoneCanvas/PhoneScreen is a bespoke mock (no QuizRuntime, no runtime
  progress bar) — no injection needed there.

## FINAL STATE — QRTZ-F close (2026-08-13)

Every design-spec item in the plan is BUILT and live. This section is the
authoritative closing ledger; strike-lists above record the history.

Built in the F wave: Quartz-conformant switches (shape rule applied — knob
r4 nests in track r6 at 2px inset) · compliant focus treatments on the two
colour-alone rules · Customer Engagement colour pass (0 gradients, 0
wrong-family tokens) · chapter-label locale overlays through
applyTranslations · preview-side chapters parity (Step5Preview +
RecPagePreview) · per-side padding end-to-end (schema/runtime/inspector,
byte-order-pinned) · edit-mode selection type tag (4-link static gate;
quiz-runtime.css untouched) · honest unpublished-change count (publish-
strip-aware doc diff) · 134 off-scale radii onto the 6/4/8 scale (54 kept:
shopper-mimic, device geometry, and the mock's own deliberate composer
14px) · persona SEO pages onto the deepened brand violet.

NOT design-spec items (require product-data systems the plan never
specified; the mock draws sample DATA for them, not the systems):
- Revenue tile + "9 orders" (Home s09): needs quiz→order attribution.
  The plan's own inventory recorded "no order attribution exists; a future
  analytics phase owns this."
- "Low stock" pill (s14 popover): needs inventory QUANTITIES; the Shopify
  sync stores a boolean. A sync-schema widening + resync is product-data
  work, not a design port.
- Home todos "See all" link: the mock draws the link with no destination;
  with at most 4 derivable todos the link is dead chrome — omitted as the
  truthful reading.
- Post-failure regenerate on the blank-Questions landing: S5's safety
  decision stands (a regenerate there could clobber manual work); the
  mock's fail card does not draw that specific landing.
