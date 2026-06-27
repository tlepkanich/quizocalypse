import type { DesignTokensT } from "./designTokens";

// Design Settings spec §2 — the FOUR vibe templates, the primary template
// selector. Each is a complete token set (the existing 6 themePresets remain
// reachable as "More themes" — these 4 are additive, no migration). A template
// sets the structural vibe (radius / button / spacing / shadow / type) plus a
// starting palette and the §3 style-bar defaults; applying one writes the whole
// set to design_tokens (incl. template_id, which drives the selected + modified
// indicators). Brand Identity (D3) later overrides colors/fonts on top.

export interface VibeTemplate {
  id: string;
  name: string;
  vibe: string;
  description: string;
  exampleFeel: string;
  tokens: DesignTokensT;
}

// Style-bar axes (0-100): image_density Minimal↔Rich · lines Sharp↔Soft ·
// spacing Compact↔Airy. Stored on the token set so applying a template seeds
// the sliders (D2 renders their CSS effect).
export const VIBE_TEMPLATES: VibeTemplate[] = [
  {
    id: "clean_editorial",
    name: "Clean / Editorial",
    vibe: "Refined",
    description: "Minimal imagery, generous white space, refined serif type, sharp edges.",
    exampleFeel: "Aesop · Glossier · Allbirds",
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
      style_bar: { image_density: 15, lines: 10, spacing: 80 },
      template_id: "clean_editorial",
    },
  },
  {
    id: "bold_graphic",
    name: "Bold / Graphic",
    vibe: "High-impact",
    description: "High contrast, strong type, graphic elements, sharp edges, solid fills.",
    exampleFeel: "Gymshark · Dr. Squatch · OLIPOP",
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
      radius: "square",
      button_style: "filled",
      spacing: "compact",
      shadow: "elevated",
      style_bar: { image_density: 50, lines: 12, spacing: 30 },
      template_id: "bold_graphic",
    },
  },
  {
    id: "warm_lifestyle",
    name: "Warm / Lifestyle",
    vibe: "Approachable",
    description: "Rich imagery, soft warm tones, approachable type, rounded corners.",
    exampleFeel: "Brightland · Great Jones · Boy Smells",
    tokens: {
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
      style_bar: { image_density: 85, lines: 80, spacing: 60 },
      template_id: "warm_lifestyle",
    },
  },
  {
    id: "minimal_technical",
    name: "Minimal / Technical",
    vibe: "Functional",
    description: "Data-forward, clean grid, structured type, no imagery by default.",
    exampleFeel: "Peak Design · Ridge · Cotopaxi",
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
      style_bar: { image_density: 5, lines: 25, spacing: 40 },
      template_id: "minimal_technical",
    },
  },
];

export function getVibeTemplate(id: string | undefined): VibeTemplate | undefined {
  return id ? VIBE_TEMPLATES.find((t) => t.id === id) : undefined;
}

// The "modified" indicator (spec §3): true when the quiz's tokens diverge from
// the named template's baseline on any field the template sets. Right after
// applying a template the tokens equal the baseline → false; nudging the style
// bar / shape / colors → true.
const COMPARED_KEYS = [
  "colors",
  "typography",
  "radius",
  "button_style",
  "spacing",
  "shadow",
  "style_bar",
] as const;

export function isModifiedFromTemplate(
  tokens: DesignTokensT | undefined,
  template: VibeTemplate,
): boolean {
  if (!tokens) return false;
  const base = template.tokens;
  for (const k of COMPARED_KEYS) {
    if (base[k] === undefined) continue;
    if (JSON.stringify(tokens[k]) !== JSON.stringify(base[k])) return true;
  }
  return false;
}
