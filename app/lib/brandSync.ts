import type { DesignTokensT } from "./designTokens";

// Design Settings spec §1 — Re-sync from Shopify. The merchant's brand (colors,
// fonts, logo) was synced into shop.brandTokens at install (themeSync). This
// pure helper overlays that brand onto a quiz's design_tokens so the funnel can
// "re-sync" without re-deriving anything. Only the brand slots that are actually
// present overwrite; everything else (template, radius, style bar, etc.) is kept.

export interface BrandApplyResult {
  next: DesignTokensT;
  applied: string[]; // human labels of what changed: "colors" | "fonts" | "logo"
}

export function applyBrandToDesign(
  design: DesignTokensT,
  brand: Partial<DesignTokensT>,
): BrandApplyResult {
  const applied: string[] = [];
  const next: DesignTokensT = { ...design };

  if (brand.colors && Object.keys(brand.colors).length > 0) {
    next.colors = { ...design.colors, ...brand.colors };
    applied.push("colors");
  }

  const bh = brand.typography?.heading?.family;
  const bb = brand.typography?.body?.family;
  if (bh || bb) {
    next.typography = {
      ...design.typography,
      ...(bh ? { heading: { ...design.typography?.heading, family: bh } } : {}),
      ...(bb ? { body: { ...design.typography?.body, family: bb } } : {}),
    };
    applied.push("fonts");
  }

  if (brand.logo?.url) {
    next.logo = { ...design.logo, ...brand.logo };
    applied.push("logo");
  }

  return { next, applied };
}
