/* The wiskr fox — the brand mark (BRAND-3, the 2026-08 rebrand). Renders the
   owner-supplied art EXACTLY: the original raster (brandAssets.ts data URI)
   inside an svg root, so existing `.qz-wordmark-mono svg` sizing rules keep
   applying and no network fetch or stylesheet is needed — it renders
   identically in the admin chrome, the shopper runtime badge and the embed
   bundle. Decorative by default; the parent carries the accessible label.
   Full-color art on a transparent ground: made for light/white tiles (the
   runtime badge sits it on a white tile). Do not redraw or recolor the mark —
   masters live in docs/design/brand-2026/art/. */

import { FOX_PNG } from "./brandAssets";

export function FoxMark({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      aria-hidden="true"
      focusable="false"
      style={{ display: "block", flex: "none" }}
    >
      <image href={FOX_PNG} width={128} height={128} />
    </svg>
  );
}
