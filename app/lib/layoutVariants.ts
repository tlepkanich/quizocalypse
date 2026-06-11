import type { Quiz, DesignTokens } from "./quizSchema";

// ════════════════════════════════════════════════════════════════════════════
// Layout variants (Phase H) — three STRUCTURAL presets, orthogonal to the
// color themes: a variant touches only density/scale/result-layout fields
// (spacing, body base_size, result_split) and never colors, fonts, radius,
// button style, or shadow — so "Dark + Editorial" and "Linen + Cozy" compose
// freely. Applying one merges exactly these keys into design_tokens.
// ════════════════════════════════════════════════════════════════════════════

type QuizDoc = Quiz;

export interface LayoutVariant {
  id: string;
  name: string;
  description: string;
  patch: {
    spacing: NonNullable<DesignTokens["spacing"]>;
    base_size: number;
    result_split: boolean;
  };
}

export const LAYOUT_VARIANTS: LayoutVariant[] = [
  {
    id: "cozy",
    name: "Cozy",
    description: "Dense and compact — fits tight embeds and popups.",
    patch: { spacing: "compact", base_size: 15, result_split: false },
  },
  {
    id: "classic",
    name: "Classic",
    description: "The balanced default — centered card, stacked result.",
    patch: { spacing: "normal", base_size: 16, result_split: false },
  },
  {
    id: "editorial",
    name: "Editorial",
    description: "Airy and premium — spacious type, 2-column desktop result.",
    patch: { spacing: "spacious", base_size: 17, result_split: true },
  },
];

export function getLayoutVariant(id: string): LayoutVariant | undefined {
  return LAYOUT_VARIANTS.find((v) => v.id === id);
}

/** Merge ONLY the variant's structural keys; everything else is preserved. */
export function applyLayoutVariant(doc: QuizDoc, variantId: string): QuizDoc {
  const v = getLayoutVariant(variantId);
  if (!v) return doc;
  const t = doc.design_tokens ?? {};
  return {
    ...doc,
    design_tokens: {
      ...t,
      spacing: v.patch.spacing,
      result_split: v.patch.result_split,
      typography: {
        ...t.typography,
        body: { ...t.typography?.body, base_size: v.patch.base_size },
      },
    },
  };
}

/** Which variant the doc currently matches exactly (for the pressed state). */
export function detectLayoutVariant(doc: QuizDoc): string | null {
  const t = doc.design_tokens ?? {};
  for (const v of LAYOUT_VARIANTS) {
    if (
      (t.spacing ?? "normal") === v.patch.spacing &&
      Boolean(t.result_split) === v.patch.result_split &&
      (t.typography?.body?.base_size ?? 16) === v.patch.base_size
    ) {
      return v.id;
    }
  }
  return null;
}
