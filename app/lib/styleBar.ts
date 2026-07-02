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

// The density RENDERER — OWNER-ACTIVATED 2026-07-03 (previously deliberately
// inert; the owner knowingly approved the repaint of live vibe-template
// quizzes). Below the threshold the runtime hides DECORATIVE imagery only:
// question header images + the intro hero. NEVER functional answer images —
// image_tile/image_picker/swatch answers need theirs to work. The threshold
// splits the vibe templates by intent (vibeTemplates.ts bakes 5 / 15 / 50 /
// 85): Minimal/Technical (5) and Clean/Editorial (15) go text-forward; Bold
// (50) and Warm/Lifestyle (85) keep their imagery — a future template baked
// near 20 must re-run this split analysis. UNSET density = show everything
// (byte-identical for every quiz without a style_bar).
//
// TWO carve-outs where explicit merchant intent beats the gate:
// (1) an explicit question_image_position token — see questionImagePosition;
// (2) an explicit node_layouts block composition (BlockRenderer path) renders
//     its image blocks ungated, incl. a hero_image_url bind — a hand-composed
//     layout is explicit intent, same reasoning as answer images.
export function hideDecorativeImagery(density: number | undefined): boolean {
  return density != null && density < 20;
}

// Question-image position resolution under the density gate. EXPLICIT
// merchant intent always wins — the review caught that gating an explicit
// "top"/"side" turns the Design-panel position picker into a lying control
// (set "side", see nothing, no feedback). Only the UNSET default goes
// text-forward below the threshold; vibe templates never set the position,
// so the owner-approved repaint set is unchanged.
export function questionImagePosition(
  density: number | undefined,
  explicit: "none" | "top" | "side" | undefined,
): "none" | "top" | "side" {
  return explicit ?? (hideDecorativeImagery(density) ? "none" : "top");
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
