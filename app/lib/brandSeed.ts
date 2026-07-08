// DGN-1 — the seam that makes AI-generated quizzes look like the merchant's
// brand instead of the house "Linen" theme. The AI design director already
// computes `brandIdentity.design.derived_tokens` (a cascade-ready DesignTokens
// pack: the chosen preset palette with the store's real primary/secondary
// overlaid — see brandIdentityAssemble.ts); this module is the pure adapter that
// drops that pack onto a fresh funnel draft's `design_tokens`.
//
// Kept pure + I/O-free so both the server seed path (funnelDraft.server.ts) and
// the Design-stage "Your brand" card read it the same way and it unit-tests
// without a DB. Absent/thin identity → null, so every caller degrades to
// HOUSE_TOKENS exactly as before (the dual-model "no new behavior for legacy
// docs" posture).
import type { BrandIdentity } from "./brandIdentity";
import type { DesignTokensT } from "./designTokens";
import { HOUSE_TOKENS } from "./themePresets";

// The synthetic template id stamped on brand-seeded tokens. It is NOT a
// THEME_PRESETS id — it exists only so the Design-stage selector can show a
// "Your brand" card as the active pick (the same `template_id`-equality
// mechanism vibe templates use) and so the late-adopt guard can tell a
// brand-seeded draft from a merchant-edited one.
export const BRAND_TEMPLATE_ID = "brand";

// Order-independent structural compare — the parsed draft's design_tokens key
// order follows the Zod schema, which need not match HOUSE_TOKENS' literal
// order, so a plain JSON.stringify compare would false-negative.
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}

/**
 * The brand-derived token pack for a shop's identity, ready to drop onto a
 * draft's `design_tokens`, or null when there's no usable brand design to seed
 * from (no identity, or the director produced no `derived_tokens`). Stamps
 * `template_id: "brand"` so the Design-stage "Your brand" card reads as active.
 */
export function brandSeedTokens(identity: BrandIdentity | null): DesignTokensT | null {
  const derived = identity?.design.derived_tokens;
  if (!derived || Object.keys(derived).length === 0 || !derived.colors) return null;
  return { ...derived, template_id: BRAND_TEMPLATE_ID };
}

/**
 * True when `tokens` is a pristine house-theme seed — deep-equal to
 * HOUSE_TOKENS and carrying no `template_id`. This is the "the merchant has not
 * chosen a look yet" signal the late-adopt path uses: any preset/vibe/brand pick
 * or hand edit either changes a token value or stamps a `template_id`, flipping
 * this to false, so we never overwrite a merchant's choice.
 */
export function isUntouchedHouseTokens(tokens: DesignTokensT | null | undefined): boolean {
  if (!tokens || tokens.template_id) return false;
  return stableStringify(tokens) === stableStringify(HOUSE_TOKENS);
}
