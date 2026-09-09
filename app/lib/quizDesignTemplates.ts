import { THEME_PRESETS, type ThemePreset } from "./themePresets";

// Original token adaptations from live quiz observations (2026-09-08).
// Sources, observed properties, and deliberate substitutions are documented in
// docs/design/quiz-design-template-sources.md. No source assets or fonts copied.
export const QUIZ_DESIGN_TEMPLATES: ThemePreset[] = [
  {
    id: "discovery",
    name: "Discovery",
    description: "White space, charcoal serif headings and rounded answers. For guided product discovery.",
    tokens: {
      colors: { primary: "#252525", secondary: "#EDFF99", accent: "#347297", background: "#FFFFFF", text: "#252525", muted: "#5E6268" },
      typography: {
        heading: { family: "Lora", source: "google", weight: 500 },
        body: { family: "Figtree", source: "google", base_size: 17, scale_ratio: 1.25 },
      },
      radius: "rounded", button_style: "filled", spacing: "spacious", shadow: "none",
    },
  },
  {
    id: "clear-care",
    name: "Clear Care",
    description: "White and blue, clear sans-serif type and crisp edges. For focused care and routine finders.",
    tokens: {
      colors: { primary: "#2D6EAF", secondary: "#DDEAF4", accent: "#2D6EAF", background: "#FFFFFF", text: "#18344A", muted: "#566674" },
      typography: {
        heading: { family: "Figtree", source: "google", weight: 600 },
        body: { family: "Figtree", source: "google", base_size: 17, scale_ratio: 1.2 },
      },
      radius: "square", button_style: "filled", spacing: "spacious", shadow: "none",
    },
  },
];

const DECIDER_THEMES = [...THEME_PRESETS, ...QUIZ_DESIGN_TEMPLATES];

// Keep the global preset registry and legacy gallery unchanged. These additions
// are opt-in choices in the decider builder, never defaults on parse or save.
export function builderThemePresets(logicModel: "decider" | undefined): ThemePreset[] {
  return logicModel === "decider" ? DECIDER_THEMES : THEME_PRESETS;
}
