# Changelog

Autonomous ship log. The **Quiz Maintainer** routine prepends one entry per run
(newest first) recording what it shipped from the Google Drive specs. Hand-written
notes are welcome above the auto entries.

<!-- routine: insert each run's entry directly below this line, newest first -->

## 2026-06-25 — Step 2 Recommendation Page: sort, sub-filter & display toggles (in progress)

Implementing the `recommendation-page-spec.md` "Now" cluster (per `_roadmap.md`).
On branch `claude/recommendation-page-spec-or43yx`, not yet on `main`.

Shipped (live end-to-end)
- Full per-section **Sort Order** set — Best Selling, Newest, Price ↑/↓,
  Title A→Z/Z→A, Manually Curated (collection order). Engine honors all modes;
  builder dropdown offers them (Manual gated on a collection scope). (`62ff770`, `15fa479`)
- Per-section **Sub-Filter** (tag and/or collection) narrowing within the
  bucket's own pool — engine + builder, with 8 new engine tests. (`62ff770`, `15fa479`)

Builder-set, runtime rendering still pending
- Product-display toggles (Show Variants, Product Descriptions, Urgency
  "Only X left", disabled "Star ratings — coming soon") and page-structure
  toggles (Results-summary bar, Retake link) — schema + builder controls landed;
  runtime rendering, the product-description publish bake, and the live
  inventory fetch for urgency (per the merchant's chosen live-fetch approach)
  are the remaining slices.

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
