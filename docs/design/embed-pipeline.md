# How a quiz reaches a merchant's storefront — pipeline map & recommendations

*Researched 2026-08-06 against `viewport-2026-08` (= `origin/main` @ `559568e`).
Companion to the viewport/2026-08 preview work.*

## The pipeline (builder → shopper)

1. **Draft** — the builder autosaves the whole doc (700–800 ms debounce) to
   `Quiz.draftJson` (`app/lib/quizEditorIO.server.ts:282`). `doc.placement` is
   set by `suggestPlacement()` at AI-build time (`app/lib/catalogIndex.ts:307`:
   ≤3 products → `product_widget`, ≥10 → `popup`, else `page`).
2. **Publish** — `publishQuiz` (`app/lib/quizPublish.ts:270`) validates
   (schema + semantic gates), bakes `product_index`, decider target maps,
   result pages, AI copy, strips draft-only state, and writes
   `Quiz.publishedJson` + a `QuizVersion` row in one transaction.
3. **Serve** — `/q/:id` (`app/routes/q.$id.tsx`) reads `publishedJson` (404 if
   null; `status` is never checked), applies `?locale=` server-side, loads ONLY
   `quiz-runtime.css`, and caches 60 s + SWR 300 — so a republish reaches
   shoppers within ~a minute.
4. **Storefront** — the theme app extension
   (`extensions/quizocalypse-block/blocks/quiz.liquid`) renders a cross-origin
   **iframe** to `/q/:id?locale={{ request.locale.iso_code }}` inside a
   section-level app block, plus a postMessage add-to-cart bridge
   (origin-checked, acked, `/cart/add.js`). Settings the merchant must fill by
   hand: `quiz_id`, `app_url`, `min_height` (400–1400, default 720),
   `iframe_title`.
5. **Alternate embed** — `/q/:id.launcher.js` serves a generated floating
   launcher script (gated on `launcher_config.enabled`, which requires a
   republish to take effect).

## The big finding: `placement` is preview-only fiction

The builder offers four placements (Full page / Pop-up / Inline / Product page
widget), previews each differently, and auto-assigns one from catalog size —
but the storefront renders the **identical inline iframe for all four**.
Nothing in `quiz.liquid`, `/q`, or the runtime reads `doc.placement`. A
merchant who picks "Pop-up" gets a full-width inline block. The schema comment
(`quizSchema.ts:1804-1807`) documents behavior that does not exist.

## Friction points, ranked

1. **Placement doesn't propagate** (above). Either implement it in the app
   block (a `placement` block setting or read from `/q/:id.json`; pop-up =
   launcher-style modal, product_widget = compact launcher) or stop offering
   the choice as if it ships.
2. **Manual Quiz ID + App URL entry** in the theme editor — two copy-paste
   text fields, typo → a dashed empty-state box on a live page. Fixes, in
   order of effort: (a) a quiz **picker** driven by an app-data metafield the
   app writes at publish; (b) at minimum, default `app_url` in the schema so
   only the quiz id is pasted.
3. **No theme-editor deep link.** The standard Shopify one-click
   "Add to theme" (`.../themes/current/editor?template=...&addAppBlockId=...`)
   is absent repo-wide, as is any install-status check. This is the single
   cheapest UX win: one anchor in the embed panel.
4. **Fixed `min_height`, no auto-resize.** Only `qz:add-to-cart` crosses the
   iframe boundary. Add a `qz:height` postMessage from the runtime (it already
   knows its content height) and let `quiz.liquid` resize the iframe —
   eliminates both the inner scrollbar and the dead-whitespace failure modes,
   and makes `min_height` a fallback instead of a guess.
5. **Two publish paths, one race-safe.** The unified builder sends the live
   doc with the publish intent; the legacy embedded editor
   (`app.quizzes.$id.tsx:4832`) does not — publishing within ~800 ms of a
   keystroke silently ships the previous draft. Port the `form.set("doc", …)`
   pattern.
6. **Publish does blocking AI + Shopify calls in one request** — same ~60 s
   edge-timeout cliff the AI build already hit. Move the AI copy passes to a
   detached job with a "publishing…" state.
7. **Unpublish is destructive** (nulls `publishedJson`; no revert-to-version
   wire from `QuizVersion`). A "restore version N" intent would make publish
   reversible.
8. **Preview fidelity gaps** (now partly closed by viewport/2026-08):
   `quiz-runtime.css` is never loaded in the builder, so engagement widgets /
   hover presets / reveal images are unstyled in preview; `GuidedPreview` and
   `RecPageV2Preview` are hand-rolled facsimiles, not the runtime; draft baking
   can order products differently than the real publish bake (Shopify
   collection sort). The CSS gap needs the `.qz-dim` / focus-ring namespace
   fixes first (see IMPLEMENTATION.md C3 #4/#5, C6.2).
9. **Naming drift** — the block is "Quizocalypse Quiz" in the theme editor
   while merchant-facing copy says "the Wiskr block". Merchants searching
   "Wiskr" find nothing.
10. **Launcher script broadcasts `postMessage(..., "*")`** from the quiz side
    (`addToCart.ts:56`); inbound is origin-checked but outbound should target
    the parent origin.

## Suggested order of attack

| Step | Win | Status |
|---|---|---|
| Theme-editor deep link in the embed panel | Removes the "find the block" hunt | **DONE 2026-08** (`app/lib/themeEditorLink.ts`; EmbedSnippet + studio embed page) |
| Default `app_url` + rename block to Wiskr | Kills the worst copy-paste + the naming drift | **DONE 2026-08** (quiz.liquid schema; needs `npm run deploy` to ship the extension) |
| `qz:height` auto-resize | Kills the min-height guess | **DONE 2026-08** (`app/components/runtime/heightBridge.ts` + quiz.liquid listener; grow-only within a session by design) |
| Publish-race fix in legacy editor | Silent stale-publish bug | **DONE 2026-08** (`app.quizzes.$id.tsx` sends the live doc) |
| Placement propagation (popup/product_widget in quiz.liquid) | Makes the builder's promise true | Days — open |
| Async publish AI passes | Timeout cliff | ~1 day — open |
