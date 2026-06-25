# Changelog

Autonomous ship log. The **Quiz Maintainer** routine prepends one entry per run
(newest first) recording what it shipped from the Google Drive specs. Hand-written
notes are welcome above the auto entries.

<!-- routine: insert each run's entry directly below this line, newest first -->

## 2026-06-25 — Step 4 Question Builder: roadmap "Now" cluster

Implemented the `question-builder-spec.md` "Now" items on branch
`claude/question-builder-spec` (off `main`, separate from the Step-2 PR). Full
gate chain green locally (typecheck, 656 tests, build, lint). Merge to ship.

- Char counters + soft limits (question 150 / answer 60), Required/Optional
  toggle (surfaces `required`; runtime already renders Skip → zero score), and
  an informational 4–8 question-count nudge.
- Question row actions — Duplicate, Add above/below, and a flow-order number
  badge — via new pure spine-splice mutations (duplicateQuestionNode /
  insertQuestionRelative), unit-tested.
- Bucket Coverage Indicator (right panel): green/yellow/red pills per bucket
  (weak = under 50% of the best-covered), hover shows the answer count
  (computeBucketCoverage, unit-tested).
- Structured Skip-Logic: each answer reads as a rule with an "End the quiz"
  target (routeAnswerToEnd) and inline conflict warnings (routingConflicts —
  dead/self/loop/multi-select), plus a read-only Flow View toggle.
- Per-question AI Regenerate surfaced in the studio editor (the regenerate-node
  intent already existed server-side), routed through the autosave/AI-edit guard
  with a ~10s undo.

Gated (human) and intentionally untouched: the Direct-vs-Weighted scoring-model
concept and open-text customer-metafield creation on publish.

## 2026-06-25 — Step 2 Recommendation Page: FULL spec (Now-cluster + all deferred)

Implemented the entire `recommendation-page-spec.md` on branch
`claude/recommendation-page-spec-or43yx` (owner greenlit the whole cluster plus
every deferred item). Not yet on `main` — full gate chain (typecheck, 665 tests,
build, lint) is green locally; merge the branch to ship.

Now-cluster (§1/§2/§6)
- Full per-section **Sort Order** (Best Selling, Newest, Price ↑/↓, Title
  A→Z/Z→A, Manually Curated) + per-section **Sub-Filter** (tag/collection).
  (`62ff770`, `15fa479`)
- Product-display toggles — **Show Variants**, **Product Descriptions** (new
  baked `IndexedProduct.description`), **Urgency "Only X left"** via a live
  `/q/:id/inventory` fetch (read at page load, never baked), disabled
  **Star-Ratings** placeholder. Page-structure: **Results-summary bar** +
  **Retake** link. (`bfda717`)

Deferred items — all shipped
- §3 **Why we recommend** — Mode A page-intro copy + Mode B per-product blurbs
  with `{{token}}` resolution ({{name}}/{{answers}}/{{answer.<id>}}). (`HEAD`)
- §4 **Discount depth** — free-shipping kind, applies-to (collections/products),
  usage cap, expiry date, minimum order; Shopify basic + free-shipping create. (`ac90a0a`)
- §5 **Notify-Me / back-in-stock** — `notify_me` OOS behavior, `/q/:id/notify`,
  new `BackInStockRequest` table (additive migration), optional webhook forward. (`HEAD~1`)
- §6 **Share-results** button (persistent results URL) + §7 quiz-level
  **global no-match fallback** (opt-in; truly-match default preserved). (`748e5ba`)

Note: the spec's "Fixed price" discount and "X days after completion" expiry are
intentionally omitted (Shopify code discounts express neither); the schematic
right-pane preview stays a full-fidelity live preview per `_roadmap.md`.

## 2026-06-24 — recommendation / runtime / builder hardening (audit loop + chips)

Shipped via the in-session audit loop and the spawned background-task chips (not
the spec routine — no new Drive-spec features; Steps 2–4 triaged + queued in
`_roadmap.md`). All deployed via CI (gates → Fly → smoke → auto-rollback).

Recommendations
- Truly-match results: removed the generic `fallback_collection_id` rung — a result
  that resolves no real bucket now returns NO products instead of an unrelated
  collection. (`1ecede1`)
- Case-insensitive answer↔product tag matching ("acne" now matches "Acne"). (`52ab973`)
- Secondary "you might also like" no longer drops OOS picks under `show_with_badge`
  (now consistent with the primary list). (`a8b27ab`)

Runtime / storefront
- Branch routes against the just-picked answer — fixed a stale-path mis-route that
  sent shoppers to the wrong result. (`4fdc6c4`)
- Out-of-stock products show a disabled "Sold out" instead of a doomed add-to-cart. (`a000061`)
- Hid the dead variant `<select>` on standalone result cards (no cart there). (`8dd22c7`)
- Prices/discounts now format in the shop currency (¥886, not "$886") — adds a
  `Product.currency` column + migration. (`0680c6e`)

Builder / publish
- Publish bakes the LIVE doc — no missed-final-edit race within the autosave
  debounce. (`6138a38`)
- AI edits no longer clobber edits typed during the LLM call. (`3e5cb08`)
- AI-edit URL guard matches the schema — one malformed URL no longer discards the
  whole edit. (`786d4ec`)
- Publish blocks when per-answer result routing is dead (was: every shopper on the
  affected quiz got zero recommendations). (`e387c94`)
- smartBuild routes by points plurality so every archetype result page stays
  reachable. (`d6a3c48`)
- Stopped the public `/q/<id>.json` route leaking editor-only fields (pasted review
  text, full translation maps). (`e5978f2`)

## 2026-06-23 — pipeline + control docs set up (manual)
- Autonomous CI/CD live: push to `main` → gates → Fly deploy → post-deploy e2e
  smoke → auto-rollback. (`ce72873`, `011fbe8`)
- Lockfile regenerated so `npm ci` passes on Linux. (`a7e294b`)
- Scope control added: `_roadmap.md` (Drive), `docs/spec-status.md`, this changelog.

_No autonomous spec runs yet — the first scheduled run records the first auto entry._
