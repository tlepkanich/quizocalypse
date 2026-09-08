# WIS-026 Question widget

The widget keeps the existing rail and replaces its mapping controls with a
single recommendation picker, staged catalog-value picker, and two-row measured
recommendations tray. The supplied mock's compact four-column table, real product
thumbnails, lilac selection treatment and quiet rules use Wiskr's existing tokens
and type. The ledger and STYLE bar keep their existing layout.

## Adversarial review

**Persistence and legacy lens:** no fields or defaults added. Existing mutations
remain the only writes. Multi-select promotion still enforces a single decider
and required answers; moving the decider intentionally clears its target mappings.
Filter removal rebuilds the complete set, preserving all other families. Info
role changes do not delete narrowing data. Legacy type changes retain their old
behavior. Picker cancellation never commits. The global popover change is opt-in
for these mapping pickers; other consumers retain their prior positioning.

**Resolution and interaction lens:** selected targets dedupe in authored order,
not click order. Single-target resolution has no extra property. The first
matching replace rule still wins; show/hide/prioritize now receive the entire
base union (the handoff's suggested unchanged action branch would have truncated
it). The existing union engine disables the single-product hero-only shape and
narrows the combined set. Shared QuestionView routing is unchanged and pinned by
classic/minimal tests. Occupied armed cells explicitly say what is being replaced.
Browser tests exposed and fixed a tall picker's unreachable footer and shop-wide
categories appearing in the step-1 tray.

## Validation

Local release gates passed: TypeScript, 2,064 tests (2 skipped), production build,
lint and design-token scan. `e2e/qwidget-verify.mjs` passes 30/30 checks, including
real publication and products from both selected recommendations on `/q`, picker
Cancel with zero autosave, role round-trips, keyboard access, and 200-card wrapping
at 1440/1000/390px and back. `e2e/q3-logic-verify.mjs` passes 31/31 preserved Logic
checks. Both restore their local fixtures. Reviewed desktop/mobile, replacement,
picker, narrowing and shopper-result screenshots in `/tmp/wis026-widget-shots/`.
The mobile title overlap and picker thumbnail spacing found during review are fixed.
Deployment evidence is recorded with the WIS-026 Slack completion after CI finishes.
