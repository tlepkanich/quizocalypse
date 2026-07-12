// Design Settings spec §1 — the curated Google Fonts list for the heading/body
// dropdowns (~20: 5 serif · 8 sans · 4 display · 3 mono). Only the SELECTED
// families load at runtime (googleFontsUrl reads the family off the tokens), so a
// long menu costs nothing. The merchant's Shopify theme font is surfaced first by
// the panel when it isn't already in this list (see BrandIdentityPanel).

export type FontCategory = "serif" | "sans" | "display" | "mono";

export interface CuratedFont {
  family: string;
  category: FontCategory;
}

export const CURATED_FONTS: CuratedFont[] = [
  // Serif (6)
  { family: "Playfair Display", category: "serif" },
  { family: "Lora", category: "serif" },
  { family: "Spectral", category: "serif" },
  { family: "Fraunces", category: "serif" },
  { family: "Cormorant Garamond", category: "serif" },
  { family: "Newsreader", category: "serif" },
  // Sans-serif (15 — includes every family the friendly theme presets ship,
  // so a preset's faces stay re-selectable in the typography dropdowns)
  { family: "Inter", category: "sans" },
  { family: "Geist", category: "sans" },
  { family: "Poppins", category: "sans" },
  { family: "Work Sans", category: "sans" },
  { family: "DM Sans", category: "sans" },
  { family: "Manrope", category: "sans" },
  { family: "Space Grotesk", category: "sans" },
  { family: "Figtree", category: "sans" },
  { family: "Nunito Sans", category: "sans" },
  { family: "Outfit", category: "sans" },
  { family: "Karla", category: "sans" },
  { family: "Source Sans 3", category: "sans" },
  { family: "Schibsted Grotesk", category: "sans" },
  { family: "Quicksand", category: "sans" },
  { family: "Sora", category: "sans" },
  // Display (4)
  { family: "Archivo", category: "display" },
  { family: "Bricolage Grotesque", category: "display" },
  { family: "Unbounded", category: "display" },
  { family: "Syne", category: "display" },
  // Mono (3)
  { family: "JetBrains Mono", category: "mono" },
  { family: "Space Mono", category: "mono" },
  { family: "IBM Plex Mono", category: "mono" },
];

export const FONT_CATEGORY_LABEL: Record<FontCategory, string> = {
  serif: "Serif",
  sans: "Sans-serif",
  display: "Display",
  mono: "Mono",
};

export const CURATED_FONT_CATEGORIES: FontCategory[] = ["serif", "sans", "display", "mono"];

export function isCuratedFont(family: string | undefined): boolean {
  return !!family && CURATED_FONTS.some((f) => f.family === family);
}
