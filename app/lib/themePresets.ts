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

// The warm "Linen" house theme — cream paper, ink text, persimmon highlights,
// Spectral headlines. The default for new + demo quizzes (see seedQuiz.ts /
// demoQuiz.ts).
export const HOUSE_TOKENS: DesignTokensT = {
  colors: {
    primary: "#1B1A17", // ink — elegant CTAs
    secondary: "#7E6B57", // warm taupe
    accent: "#E8623C", // persimmon highlights
    background: "#F8F6F1", // cream paper
    text: "#1B1A17",
    muted: "#8B8377",
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
      "Warm cream paper, ink text, persimmon highlights, Spectral serif. An elevated DTC feel.",
    tokens: HOUSE_TOKENS,
  },
  {
    id: "minimal",
    name: "Minimal",
    description: "Clean monochrome with one confident cobalt accent. Inter throughout.",
    tokens: {
      colors: {
        primary: "#111111",
        secondary: "#4B5563",
        accent: "#2563EB",
        background: "#FFFFFF",
        text: "#0F1115",
        muted: "#6B7280",
      },
      typography: {
        heading: { family: "Inter", source: "google", weight: 600 },
        body: { family: "Inter", source: "google", base_size: 16, scale_ratio: 1.2 },
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
    description: "Serif headlines, generous margins, flat bordered cards — magazine-grade.",
    tokens: {
      colors: {
        primary: "#1A1A1A",
        secondary: "#6B5D4F",
        accent: "#B45309",
        background: "#FAF7F2",
        text: "#1A1A1A",
        muted: "#7A6E60",
      },
      typography: {
        heading: { family: "Playfair Display", source: "google", weight: 600 },
        body: { family: "Lora", source: "google", base_size: 17, scale_ratio: 1.333 },
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
    description: "High-contrast and geometric — black buttons, electric accents, lifted cards.",
    tokens: {
      colors: {
        primary: "#0A0A0A",
        secondary: "#FF4D2E",
        accent: "#FFC400",
        background: "#FFFFFF",
        text: "#0A0A0A",
        muted: "#52525B",
      },
      typography: {
        heading: { family: "Space Grotesk", source: "google", weight: 700 },
        body: { family: "Space Grotesk", source: "google", base_size: 16, scale_ratio: 1.25 },
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
    description: "Soft rose and lilac on warm white — beauty, baby, and lifestyle brands.",
    tokens: {
      colors: {
        primary: "#D9709A",
        secondary: "#9D8DF1",
        accent: "#F4B740",
        background: "#FDF6F8",
        text: "#3A2A35",
        muted: "#8B7280",
      },
      typography: {
        heading: { family: "Fraunces", source: "google", weight: 500 },
        body: { family: "Inter", source: "google", base_size: 16, scale_ratio: 1.2 },
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
    description: "Deep navy-black with luminous accents — premium tech and nightlife.",
    tokens: {
      colors: {
        primary: "#7AA2F7",
        secondary: "#B69CFF",
        accent: "#2DD4BF",
        background: "#0C1018",
        text: "#E9EEF7",
        muted: "#8B95A7",
      },
      typography: {
        heading: { family: "Geist", source: "google", weight: 600 },
        body: { family: "Geist", source: "google", base_size: 16, scale_ratio: 1.25 },
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

// MQ — the default theme for standalone "Quizell"-style quizzes: clean B&W, bold
// Inter, flat (no card shadow — the minimal chrome is card-less anyway), one
// cobalt accent for prices/links. New standalone quizzes seed with this so the
// minimal chrome reads as the Quizell reference (white bg, black text/chips)
// rather than the warm Linen house theme. Merchants can re-theme per quiz.
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
