# How a quiz reaches a merchant's storefront — pipeline map & recommendations

*Researched 2026-08-06 against `viewport-2026-08` (= `origin/main` @ `559568e`).
Companion to the viewport/2026-08 preview work.*

*Updated 2026-08-15 (`afd5424`, EMBED-1): the storefront section and the
ranked list below were stale — placement propagation had shipped, and the
storefront is no longer iframe-only. Both corrected in place.*

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
   (`extensions/quizocalypse-block/blocks/quiz.liquid`) renders the quiz in a
   section-level app block, in one of two modes chosen by the block's
   `render_mode` setting:
   - **`iframe` (default)** — a cross-origin iframe to
     `/q/:id?locale={{ request.locale.iso_code }}`, plus the postMessage
     bridge: `qz:add-to-cart` (origin-checked, acked, `/cart/add.js`) and
     `qz:height` (auto-resize). `doc.placement` is read from `/q/:id.json` and
     swaps the inline frame for a launcher button + modal on
     `popup` / `product_widget`.
   - **`dom` (opt-in, EMBED-1)** — a `<div data-wiskr-quiz>` plus
     `<script defer src="{app_url}/embed/wiskr-embed.js">`. The runtime mounts
     into a **shadow root** in the merchant's own document. No iframe, so:
     the AJAX cart is same-origin (no bridge, no 1200 ms ack race), height is
     natural (no `qz:height`, `min_height` unused), and `localStorage` is
     first-party so save/resume survives Safari's partitioned storage.
   Settings the merchant fills by hand: `quiz_id`, `app_url` (defaulted),
   `render_mode`, `min_height` (iframe only), `iframe_title`, `button_label`.

   > ⚠️ **`render_mode` is IN THE REPO BUT NOT DEPLOYED** (as of 2026-08-16).
   > The Liquid above ships only with the theme app extension
   > (`npm run deploy` → a Shopify app release), which is deliberately
   > deferred. Every merchant's installed block is still the iframe-only
   > version, and the "Rendering" dropdown does not exist in their theme
   > editor. Do not write merchant-facing copy that references it until the
   > extension ships. Nothing is broken by the gap: `render_mode` defaults to
   > `iframe`, so the deployed and repo versions behave identically.
   >
   > The DOM embed is reachable today WITHOUT the extension — the Share &
   > embed panel's snippet pasted into a **Custom Liquid** section, the theme
   > code editor, or any non-Shopify page. The extension only adds the
   > one-click toggle.
5. **Alternate embed** — `/q/:id.launcher.js` serves a generated floating
   launcher script (gated on `launcher_config.enabled`, which requires a
   republish to take effect). Iframe-based, like the block's default mode.
6. **DOM embed data** — `/q/:id.embed.json` serves the same 19 props the `/q`
   loader feeds `<QuizRuntime>`, via the shared seam in
   `app/lib/runtimePayload.server.ts`, CORS-open + 60 s cached. Deliberately
   NOT `/q/:id.json`: that route serves a different (smaller) shape and its
   bytes are pinned at `c02ccaec98a0fe9e`.

## Resolved: `placement` was preview-only fiction

*Historical — fixed. Kept because the shape of the bug recurs.*

The builder offered four placements (Full page / Pop-up / Inline / Product
page widget), previewed each differently, and auto-assigned one from catalog
size — but the storefront rendered the **identical inline iframe for all
four**. Nothing in `quiz.liquid`, `/q`, or the runtime read `doc.placement`.
The schema comment documented behavior that did not exist.

Now propagated in `quiz.liquid` (`toLauncher`): the block fetches
`/q/:id.json`, reads `placement`, and rewrites its own DOM —
`popup` → launcher button + centered modal, `product_widget` → the compact
variant. Anything else, or a failed fetch, keeps the inline render, so it
cannot produce a dead block. Placement changes reach storefronts on
republish + the 60 s cache window, with no theme edit.

## Friction points, ranked

1. ~~**Placement doesn't propagate**~~ — **DONE** (`quiz.liquid` `toLauncher`,
   see above).
2. **Manual Quiz ID entry** in the theme editor — PARTLY done. (b) `app_url`
   now defaults in the schema, so only the quiz id is pasted; a typo there
   still yields a dashed empty-state box on a live page. Still open: (a) a
   quiz **picker** driven by an app-data metafield the app writes at publish.
3. ~~**No theme-editor deep link.**~~ — **DONE** (`app/lib/themeEditorLink.ts`
   builds the `…&addAppBlockId=<uid>/<handle>` one-click "Add to theme" URL;
   wired into EmbedSnippet + the studio embed page). An install-status check
   is still absent.
4. ~~**Fixed `min_height`, no auto-resize.**~~ — **DONE** (`qz:height`,
   `app/components/runtime/heightBridge.ts` + the `quiz.liquid` listener;
   grow-only within a session by design). Moot entirely in `dom` mode.
5. ~~**Two publish paths, one race-safe.**~~ — **DONE**: the legacy embedded
   editor now sends the live doc too (`app.quizzes.$id.tsx:4871`,
   `form.set("doc", …)`), closing the ~800 ms stale-publish window.
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
9. ~~**Naming drift**~~ — **DONE**: the block's schema `name` is "Wiskr Quiz".
   (The repo, Fly app and `X-Quizocalypse-*` wire headers keep the legacy name
   deliberately — see the root `CLAUDE.md`.)
10. **Quiz side broadcasts `postMessage(..., "*")`** (`addToCart.ts`,
    `heightBridge.ts`); inbound is origin-checked, outbound is not targeted.
    Now documented as an ACCEPTED limitation rather than a bug: a cross-origin
    iframe cannot know its embedder's origin, and the payloads are a variant
    id and a pixel count. Moot in `dom` mode, which sends no postMessage at
    all. Revisit only if a payload ever carries shopper data.

## Suggested order of attack

| Step | Win | Status |
|---|---|---|
| Theme-editor deep link in the embed panel | Removes the "find the block" hunt | **DONE 2026-08** (`app/lib/themeEditorLink.ts`; EmbedSnippet + studio embed page) |
| Default `app_url` + rename block to Wiskr | Kills the worst copy-paste + the naming drift | **DONE 2026-08** (quiz.liquid schema; needs `npm run deploy` to ship the extension) |
| `qz:height` auto-resize | Kills the min-height guess | **DONE 2026-08** (`app/components/runtime/heightBridge.ts` + quiz.liquid listener; grow-only within a session by design) |
| Publish-race fix in legacy editor | Silent stale-publish bug | **DONE 2026-08** (`app.quizzes.$id.tsx` sends the live doc) |
| Placement propagation (popup/product_widget in quiz.liquid) | Makes the builder's promise true | **DONE 2026-08** (`quiz.liquid` `toLauncher`, reads `placement` from `/q/:id.json`) |
| DOM embed (`render_mode: dom`) | Kills the iframe's cart bridge, height bridge and partitioned storage | **DONE 2026-08-15** (`afd5424`, EMBED-1 — opt-in; iframe stays the default and the rollback) |
| Ship `render_mode` to merchants' theme editors | Turns the copy-paste snippet into a dropdown | **DEFERRED** — needs `npm run deploy` (a Shopify app release). Not blocking: the DOM embed already works via Custom Liquid / the theme code editor. |
| Async publish AI passes | Timeout cliff | ~1 day — open |
| Unpublish / restore-version wire | Publish becomes reversible | open |

## The DOM embed, in one screen (EMBED-1, `afd5424`)

Opt-in per block via `render_mode: dom`. **The iframe remains the default**;
flipping the setting back is the rollback and needs no deploy.

| Concern | How it is handled |
|---|---|
| Our origin | `app/lib/apiBase.ts` — `apiUrl()` prefixes the ~14 runtime API paths. Defaults to `""`, so every `/q` caller is byte-identical. `entry.tsx` derives the origin from its own `<script src>`; no configuration. |
| Which mode | `app/lib/embedMode.ts`. NOT `window.parent === window` — that is true for a top-level `/q` tab and false for a DOM embed inside the theme editor's framed preview. Genuinely different questions. |
| Data | `/q/:id.embed.json` → `runtimePayload.server.ts`, shared with the `/q` loader so the surfaces cannot drift. |
| Theme CSS | Shadow root. Light DOM was built and measured first: a theme carrying `button{background:#c0392b!important}` recoloured the quiz's Start button. Shadow blocks theme *selectors* while inherited properties (font-family, color) still cascade in — the "native feel" half without the override half. |
| Fonts | `@font-face` cannot register from inside a shadow root. `entry.tsx` collects the doc's families and puts the Google Fonts `<link>` in `document.head`, leaving `QuizRuntime` untouched. |
| Cart | `/cart/add.js` called directly — same-origin. No bridge, no ack protocol, no 1200 ms race. **Discounted adds still navigate** to the cart permalink: the AJAX cart cannot carry a code. That is a Shopify constraint, not a framing one, and the only iframe cost DOM mode does not remove. |
| Height | `heightBridge` no-ops; height is just height. |
| Storage | First-party, so save/resume is no longer subject to partitioned-storage eviction. |
| Bundle | `vite.embed.config.ts` → `build/client/embed/wiskr-embed.js`, IIFE, ~420 KB / ~119 KB gzip, served from our origin (so a runtime fix ships on the next deploy, no theme edit, no extension release). |

**Traps for the next agent.** `entry.tsx` must stay free of server imports —
it is a public bundle (grep it for `PrismaClient`/`ANTHROPIC` after any change
to its import graph). `vite.embed.config.ts` needs `publicDir: false`, or Vite
re-copies `public/` into `build/client/embed/`. The embed build runs AFTER
`remix vite:build` (which wipes `build/client`) — the `build` script chains
them in that order for a reason.
