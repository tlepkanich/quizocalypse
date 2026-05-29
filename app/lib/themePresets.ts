import type { DesignTokensT } from "./designTokens";

// Curated theme presets. Each is a full DesignTokens pack that a merchant
// can apply in one click from the brand design page or per-quiz design
// drawer. Designed so any preset reads cleanly even before the merchant
// tweaks it — sensible contrast, font pairs from Google Fonts, and
// spacing/radius that match the visual feel of the name.
//
// Presets are deliberately broad (Minimal/Editorial/Bold/Pastel/Dark) so a
// merchant can pick the one closest to their brand and tweak from there
// rather than starting from defaults.

export interface ThemePreset {
  id: string;
  name: string;
  description: string;
  tokens: DesignTokensT;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "minimal",
    name: "Minimal",
    description: "Clean monochrome with restrained accents. Inter throughout.",
    tokens: {
      colors: {
        primary: "#111111",
        secondary: "#555555",
        accent: "#0066FF",
        background: "#FFFFFF",
        text: "#111111",
        muted: "#777777",
      },
      typography: {
        heading: { family: "Inter", source: "google", weight: 600 },
        body: { family: "Inter", source: "google", base_size: 16, scale_ratio: 1.2 },
      },
      radius: "rounded",
      button_style: "filled",
      spacing: "normal",
    },
  },
  {
    id: "editorial",
    name: "Editorial",
    description: "Serif headlines, generous spacing — magazine-style.",
    tokens: {
      colors: {
        primary: "#1B1A17",
        secondary: "#7E6B57",
        accent: "#C2410C",
        background: "#FAF5EF",
        text: "#1B1A17",
        muted: "#7E6B57",
      },
      typography: {
        heading: { family: "Playfair Display", source: "google", weight: 600 },
        body: { family: "Lora", source: "google", base_size: 17, scale_ratio: 1.333 },
      },
      radius: "square",
      button_style: "outline",
      spacing: "spacious",
    },
  },
  {
    id: "bold",
    name: "Bold",
    description: "High-contrast, geometric. Big buttons, tight spacing.",
    tokens: {
      colors: {
        primary: "#FF3D00",
        secondary: "#1A1A1A",
        accent: "#FFD600",
        background: "#FFFFFF",
        text: "#0A0A0A",
        muted: "#525252",
      },
      typography: {
        heading: { family: "Space Grotesk", source: "google", weight: 700 },
        body: { family: "Space Grotesk", source: "google", base_size: 16, scale_ratio: 1.25 },
      },
      radius: "pill",
      button_style: "filled",
      spacing: "compact",
    },
  },
  {
    id: "pastel",
    name: "Pastel",
    description: "Soft pinks and pale blues — beauty, baby, lifestyle.",
    tokens: {
      colors: {
        primary: "#E879A4",
        secondary: "#A78BFA",
        accent: "#FBBF24",
        background: "#FFF6F8",
        text: "#3F2A38",
        muted: "#8B6B7C",
      },
      typography: {
        heading: { family: "Fraunces", source: "google", weight: 500 },
        body: { family: "Inter", source: "google", base_size: 16, scale_ratio: 1.2 },
      },
      radius: "rounded",
      button_style: "filled",
      spacing: "normal",
    },
  },
  {
    id: "dark",
    name: "Dark",
    description: "Inverted palette for premium / tech / nightlife brands.",
    tokens: {
      colors: {
        primary: "#60A5FA",
        secondary: "#A78BFA",
        accent: "#34D399",
        background: "#0B0F17",
        text: "#F1F5F9",
        muted: "#94A3B8",
      },
      typography: {
        heading: { family: "Geist", source: "google", weight: 600 },
        body: { family: "Geist", source: "google", base_size: 16, scale_ratio: 1.25 },
      },
      radius: "rounded",
      button_style: "filled",
      spacing: "normal",
    },
  },
];

export function getPreset(id: string): ThemePreset | undefined {
  return THEME_PRESETS.find((p) => p.id === id);
}
