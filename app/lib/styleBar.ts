// Design Settings spec §3 — the Style Bar maps 3 continuous axes (0-100) to CSS
// values that OVERRIDE the chosen template's discrete tokens. Pure + testable, and
// (per the spec dev note) each axis maps to a single CSS variable so a slider move
// is a var reassignment, not a re-render.
//
//   Image density  Minimal ←——→ Rich
//   Lines          Sharp   ←——→ Soft
//   Spacing        Compact ←——→ Airy

function clamp01to100(n: number): number {
  return Math.max(0, Math.min(100, n));
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Lines: Sharp (0) → 0px radius … Soft (100) → 24px. Capped at 24 (the pill cap)
// so a tall card never balloons into an oval — the same guard tokensToCssVars uses.
export function linesToRadiusPx(lines: number): number {
  return Math.round(lerp(0, 24, clamp01to100(lines) / 100));
}

// Spacing: Compact (0) → 12px … Airy (100) → 40px padding scale.
export function spacingToPadPx(spacing: number): number {
  return Math.round(lerp(12, 40, clamp01to100(spacing) / 100));
}

// Image density: Minimal (0) → 0 … Rich (100) → 1. A 0-1 factor the runtime uses
// to gate image-heaviness (answer images / question headers / background layer).
export function imageDensityFactor(density: number): number {
  return Math.round((clamp01to100(density) / 100) * 100) / 100;
}

// CSS-var overrides for a style_bar — only the axes that are set, so a partial
// style_bar leaves the template's other tokens intact. Merged OVER the enum-derived
// vars in tokensToCssVars, so the slider wins.
export function styleBarCssVars(
  sb: { image_density?: number; lines?: number; spacing?: number } | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!sb) return out;
  if (sb.lines != null) out["--qz-radius"] = `${linesToRadiusPx(sb.lines)}px`;
  if (sb.spacing != null) out["--qz-pad"] = `${spacingToPadPx(sb.spacing)}px`;
  if (sb.image_density != null)
    out["--qz-image-density"] = String(imageDensityFactor(sb.image_density));
  return out;
}
