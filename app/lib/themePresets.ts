import type { DesignTokensT } from "./designTokens";

// Curated premium theme presets. Each is a full DesignTokens pack a merchant can
// apply in one click from the brand design page, the Preview & theme step, or
// the per-quiz design drawer. Designed to read cleanly out of the box —
// considered palettes, real font pairings, and a surface treatment (flat / soft
// / elevated) so each theme has a distinct *personality*, not just a swapped
// accent color.

export interface ThemePreset {
  id: string;
  name: string;
  description: string;
  tokens: DesignTokensT;
}

// The warm "Linen" house theme — apricot-tinted ivory, espresso ink, a
// terracotta CTA (a friendly colored button instead of the old stern black),
// Lora headlines over rounded Nunito Sans. The default for new + demo quizzes
// (see seedQuiz.ts / demoQuiz.ts). 2026-07 friendly redesign: every palette
// passes all four contrast axes (text/bg + muted/bg ≥4.5, white/primary ≥4.5,
// accent/bg ≥3.0) and no preset uses a face on the AI-overused list
// (Inter / Geist / Fraunces / Space Grotesk all replaced).
export const HOUSE_TOKENS: DesignTokensT = {
  colors: {
    primary: "#AD4B2E", // terracotta CTA — white label 5.49:1
    secondary: "#7C8A6E", // sage
    accent: "#C05B2E", // deep persimmon — 4.03:1 on the ivory bg
    background: "#FBF4EC", // ivory tinted toward the terracotta hue
    text: "#2A211A", // warm espresso ink
    muted: "#6E6357", // 5.37:1 on the ivory bg
  },
  typography: {
    heading: { family: "Lora", source: "google", weight: 600 },
    body: { family: "Nunito Sans", source: "google", base_size: 17, scale_ratio: 1.3 },
  },
  radius: "rounded",
  button_style: "filled",
  spacing: "spacious",
  shadow: "soft",
};

// The pre-2026-07 house tokens, kept ONLY so isUntouchedHouseTokens
// (brandSeed.ts) still recognizes drafts seeded before the friendly redesign
// as "merchant has not chosen a look yet". Never seed new docs with this.
export const LEGACY_HOUSE_TOKENS: DesignTokensT = {
  colors: {
    primary: "#1B1A17",
    secondary: "#7E6B57",
    accent: "#E8623C",
    background: "#F8F6F1",
    text: "#1B1A17",
    muted: "#756E64",
  },
  typography: {
    heading: { family: "Spectral", source: "google", weight: 500 },
    body: { family: "Geist", source: "google", base_size: 17, scale_ratio: 1.3 },
  },
  radius: "rounded",
  button_style: "filled",
  spacing: "spacious",
  shadow: "soft",
};

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "linen",
    name: "Linen",
    description:
      "Apricot ivory, espresso ink, a warm terracotta button, Lora serif. Inviting, elevated DTC.",
    tokens: HOUSE_TOKENS,
  },
  {
    id: "minimal",
    name: "Minimal",
    description: "Calm white space with one friendly teal accent. Outfit throughout.",
    tokens: {
      colors: {
        primary: "#0F766E", // teal CTA — white label 5.47:1
        secondary: "#52606D",
        accent: "#0E7490",
        background: "#FFFFFF",
        text: "#1F2328",
        muted: "#5C6670",
      },
      typography: {
        heading: { family: "Outfit", source: "google", weight: 600 },
        body: { family: "Outfit", source: "google", base_size: 16, scale_ratio: 1.2 },
      },
      radius: "rounded",
      button_style: "filled",
      spacing: "normal",
      shadow: "soft",
    },
  },
  {
    id: "editorial",
    name: "Editorial",
    description: "Newsreader headlines, warm paper, flat bordered cards — magazine-grade.",
    tokens: {
      colors: {
        primary: "#26221C",
        secondary: "#6B5D4F",
        accent: "#A44A0B", // burnt sienna — 5.47:1 on the paper bg
        background: "#FAF6EF",
        text: "#26211A",
        muted: "#6C6152",
      },
      typography: {
        heading: { family: "Newsreader", source: "google", weight: 600 },
        body: { family: "Source Sans 3", source: "google", base_size: 17, scale_ratio: 1.333 },
      },
      radius: "square",
      button_style: "outline",
      spacing: "spacious",
      shadow: "none",
    },
  },
  {
    id: "bold",
    name: "Bold",
    description:
      "Sunny paper, ink pills, vermilion energy — playful high-contrast, Bricolage Grotesque.",
    tokens: {
      colors: {
        primary: "#161310",
        secondary: "#E8431F",
        accent: "#C2410C", // 5.01:1 on the sunny bg (the old yellow sat at 1.6)
        background: "#FFFBF0",
        text: "#161310",
        muted: "#565046",
      },
      typography: {
        heading: { family: "Bricolage Grotesque", source: "google", weight: 700 },
        body: { family: "Schibsted Grotesk", source: "google", base_size: 16, scale_ratio: 1.25 },
      },
      radius: "pill",
      button_style: "filled",
      spacing: "compact",
      shadow: "elevated",
    },
  },
  {
    id: "pastel",
    name: "Pastel",
    description: "Soft rose and lilac on blush white — beauty, baby, and lifestyle brands.",
    tokens: {
      colors: {
        primary: "#B34578", // raspberry CTA — white label 5.20:1 (old rose sat at 3.0)
        secondary: "#7D6BD9",
        accent: "#B26208", // warm amber — 4.19:1 on the blush bg
        background: "#FDF4F8",
        text: "#38222E",
        muted: "#75636D",
      },
      typography: {
        heading: { family: "Quicksand", source: "google", weight: 600 },
        body: { family: "Karla", source: "google", base_size: 16, scale_ratio: 1.2 },
      },
      radius: "rounded",
      button_style: "filled",
      spacing: "normal",
      shadow: "soft",
    },
  },
  {
    id: "dark",
    name: "Dark",
    description: "Cozy plum-black with ember and lavender glow — warm nights, premium tech.",
    tokens: {
      colors: {
        primary: "#9A4B2F", // ember CTA — white label 6.14:1
        secondary: "#B49CE8",
        accent: "#FFB86B",
        background: "#181521",
        text: "#F1EDF7",
        muted: "#A79FB5",
      },
      typography: {
        heading: { family: "Sora", source: "google", weight: 600 },
        body: { family: "Figtree", source: "google", base_size: 16, scale_ratio: 1.25 },
      },
      radius: "rounded",
      button_style: "filled",
      spacing: "normal",
      shadow: "elevated",
    },
  },
];

export function getPreset(id: string): ThemePreset | undefined {
  return THEME_PRESETS.find((p) => p.id === id);
}

// MQ — RETIRED FROM SEEDING (2026-07 friendly redesign): standalone quizzes
// now seed with HOUSE_TOKENS (Linen won the side-by-side render pass), not
// this B&W Quizell pack. Kept only as the historical record of what pre-
// redesign standalone docs were seeded with — those docs carry these values
// baked into their own design_tokens and render unchanged.
export const STANDALONE_MINIMAL_TOKENS: DesignTokensT = {
  colors: {
    primary: "#111111",
    secondary: "#4B5563",
    accent: "#2563EB",
    background: "#FFFFFF",
    text: "#0F1115",
    muted: "#6B7280",
  },
  typography: {
    heading: { family: "Inter", source: "google", weight: 700 },
    body: { family: "Inter", source: "google", base_size: 16, scale_ratio: 1.2 },
  },
  radius: "rounded",
  button_style: "filled",
  spacing: "normal",
  shadow: "none",
};
