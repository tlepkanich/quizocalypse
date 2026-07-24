// BLD-2 — pure application + readability guardrail for the Design AI patch.
//
//   applyDesignAiPatch  — merge the validated flat patch onto the doc's
//                         design_tokens exactly the way the BLD-1 Global
//                         styles panel writes them (nested merges; the single
//                         page-padding value expands to all four sides;
//                         curated fonts stamp source: "google").
//   ensureReadableTokens — the contrast clamp: text-on-background and the
//                         white button label on primary must both hit WCAG AA
//                         4.5:1. A failing pick is adjusted DETERMINISTICALLY
//                         (linear mix toward the higher-contrast pole in 5%
//                         steps — the minimal passing step wins), never
//                         rejected: the merchant asked for the vibe, we keep
//                         it readable. Same-input → same-output, unit-tested.
//
// Pure + I/O-free so the server intent and the tests share one code path.
import type { DesignAiPatchT } from "./ai/designAi";
import type { DesignTokensT } from "./designTokens";
import { DEFAULT_TOKENS, contrastRatio } from "./designTokens";

const AA_RATIO = 4.5;

/** Linear per-channel mix of `hex` toward `target` by t∈[0,1] — lowercase
 *  #rrggbb out (the color inputs' normalization). Deterministic. */
export function mixHex(hex: string, target: string, t: number): string {
  const parse = (h: string) => {
    const n = Number.parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
  };
  const a = parse(hex);
  const b = parse(target);
  const out = a.map((ch, i) => Math.round(ch + (b[i]! - ch) * t));
  return `#${out.map((ch) => ch.toString(16).padStart(2, "0")).join("")}`;
}

// The pole (#000000 / #ffffff) with the higher contrast against `bg` — mixing
// fully toward it is guaranteed ≥ 4.5:1 for any bg (worst case ≈ 4.58).
function contrastPole(bg: string): string {
  return contrastRatio("#ffffff", bg) >= contrastRatio("#000000", bg)
    ? "#ffffff"
    : "#000000";
}

/** Step `fg` toward `pole` in 5% increments until it clears `minRatio`
 *  against `bg`. The first (minimal) passing step wins — deterministic. */
function adjustToward(fg: string, pole: string, bg: string, minRatio: number): string {
  if (contrastRatio(fg, bg) >= minRatio) return fg;
  for (let t = 0.05; t < 1; t += 0.05) {
    const candidate = mixHex(fg, pole, t);
    if (contrastRatio(candidate, bg) >= minRatio) return candidate;
  }
  return pole;
}

const isHex6 = (v: string | undefined): v is string =>
  !!v && /^#[0-9a-fA-F]{6}$/.test(v);

/**
 * Enforce the two BLD-2 readability checks on a token set, adjusting the
 * offending color minimally:
 *   · text on background ≥ 4.5:1 — the TEXT moves (the background carries the
 *     brief's aesthetic: "cream background" stays cream)
 *   · white label on primary ≥ 4.5:1 — the PRIMARY darkens (filled buttons
 *     render a fixed #FFF label)
 * Defaults fill unset slots for the CHECK (a cream background with no text
 * token still gets a readable explicit text color written); already-passing
 * palettes come back unchanged (same object).
 */
export function ensureReadableTokens(tokens: DesignTokensT): DesignTokensT {
  const c = tokens.colors ?? {};
  const bg = isHex6(c.background) ? c.background : DEFAULT_TOKENS.colors?.background ?? "#ffffff";
  const text = isHex6(c.text) ? c.text : DEFAULT_TOKENS.colors?.text ?? "#1f1f1f";
  const primary = isHex6(c.primary) ? c.primary : DEFAULT_TOKENS.colors?.primary ?? "#5563de";

  const fixes: Partial<NonNullable<DesignTokensT["colors"]>> = {};

  if (contrastRatio(text, bg) < AA_RATIO) {
    fixes.text = adjustToward(text, contrastPole(bg), bg, AA_RATIO);
  }
  // Filled buttons paint a #FFF label on primary (designTokens.buttonStyle) —
  // darken a too-light primary until the label reads. contrastRatio is
  // symmetric, so "white label on candidate" ≡ contrast(candidate, #ffffff).
  if (contrastRatio("#ffffff", primary) < AA_RATIO) {
    fixes.primary = adjustToward(primary, "#000000", "#ffffff", AA_RATIO);
  }

  if (Object.keys(fixes).length === 0) return tokens;
  return { ...tokens, colors: { ...c, ...fixes } };
}

/**
 * Merge a validated Design AI patch onto existing design_tokens — the exact
 * write shapes the Global styles panel commits, so a restyle and a manual
 * edit are indistinguishable downstream (tokensToCssVars, publish, undo).
 * Untouched fields (template_id, chrome, logo, …) pass through byte-identical.
 */
export function applyDesignAiPatch(
  tokens: DesignTokensT,
  patch: DesignAiPatchT,
): DesignTokensT {
  const next: DesignTokensT = { ...tokens };

  if (patch.colors && Object.keys(patch.colors).length > 0) {
    // Lowercase to match the color inputs' normalization (BuilderPageSettings
    // #418 lesson — one canonical case everywhere).
    const lowered = Object.fromEntries(
      Object.entries(patch.colors).map(([k, v]) => [k, v.toLowerCase()]),
    );
    next.colors = { ...(tokens.colors ?? {}), ...lowered };
  }

  if (patch.heading_font || patch.body_font) {
    const typo = tokens.typography ?? {};
    next.typography = {
      ...typo,
      ...(patch.heading_font
        ? { heading: { ...(typo.heading ?? {}), family: patch.heading_font, source: "google" as const } }
        : {}),
      ...(patch.body_font
        ? { body: { ...(typo.body ?? {}), family: patch.body_font, source: "google" as const } }
        : {}),
    };
  }

  if (patch.button_radius !== undefined) next.button_radius = patch.button_radius;

  if (patch.answer_softness !== undefined) {
    next.style_bar = { ...(tokens.style_bar ?? {}), lines: patch.answer_softness };
  }

  if (patch.page_padding !== undefined) {
    const v = patch.page_padding;
    // ONE value for all four sides — the Global panel's deliberate
    // simplification; the Theme rail keeps the per-side cross.
    next.page_padding = { top: v, right: v, bottom: v, left: v };
  }

  return next;
}
