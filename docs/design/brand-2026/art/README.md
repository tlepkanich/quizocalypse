# Wiskr brand art — masters (2026-08 rebrand)

The owner-supplied brand art (originals: `Quiz Requests/IMG_7204–7206.PNG`
in the owner's Drive), processed once: near-white background flood-filled to
transparent from the borders (threshold ≥242 on all channels, so the light
lavender cheeks are untouched), trimmed to content + 4px, no other edits.

- `fox-master.png` — the fox head mark, 1008px wide.
- `wordmark-master.png` — the lowercase "wiskr" logotype, 1024px wide.
- `lockup-master.png` — fox + logotype lockup, 1600px wide.

These are the source of truth for every shipped brand asset. Downscale from
here — NEVER redraw, trace, or recolor the marks:

- `app/components/chrome/brandAssets.ts` — the data-URI embeds the chrome
  components and the runtime badge render (fox @128px square-padded,
  logotype @64px tall).
- `public/favicon.svg` + `public/wiskr-fox.svg` — SVG wrappers around the
  fox @128px embed (same URLs as before the rebrand).
- `public/favicon.ico` — fox @32px, PNG-in-ICO.
- `public/apple-touch-icon.png` — fox @180px on white, 14px margin.

The logotype is dark indigo on transparency: light grounds only. The mock's
monochrome `mark()` in `_src/shared.mjs` is a separate ink-contract cut for
the brand-2026 design docs, not the shipped logo.
