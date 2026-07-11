import type { BrandIdentity, Confidence } from "./brandIdentity";
import type { DesignTokens } from "./quizSchema";

// ════════════════════════════════════════════════════════════════════════════
// Brand book (R-5 redesign) — the section catalogue + per-section data-health
// signals for the editable brand book. Pure + unit-tested: the health rules are
// the single source the nav dots, section badges, and the completeness summary
// all read, so they can never disagree. The book binds two stores — the AI brand
// identity (`shop.brandIdentity`) and the visual design tokens
// (`shop.brandTokens`) — so both are passed in.
//
// The redesign collapses the old 10 flat sections into 6 grouped modules
// (docs/prototypes/quizocalypse-brand-identity-handoff.md): the old "Positioning"
// folds into Identity, "Spacing" folds into "Shape & spacing", and "Presets" is
// no longer a checklist item (it's auto-derived from colors/type/shape).
// ════════════════════════════════════════════════════════════════════════════

export type BrandSectionId =
  | "identity"
  | "voice"
  | "logo"
  | "colors"
  | "type"
  | "shape"
  | "imagery";

// Two module bands — "the words the AI writes with" vs "how quizzes are styled".
export type BrandGroupId = "basics" | "lookfeel";

export type SectionHealth = "ok" | "warn" | "bad";

export interface BrandGroup {
  id: BrandGroupId;
  index: number; // "1 ·" / "2 ·" band label
  name: string;
  tagline: string;
}

export const BRAND_GROUPS: readonly BrandGroup[] = [
  { id: "basics", index: 1, name: "Brand basics", tagline: "the words the AI writes with" },
  { id: "lookfeel", index: 2, name: "Look & feel", tagline: "how quizzes are styled" },
] as const;

export interface BrandSection {
  id: BrandSectionId;
  group: BrandGroupId;
  name: string;
  icon: string; // emoji marker (no external icon dep in the runtime-agnostic lib)
  hint: string; // one-line preview shown in the nav / when collapsed
  usedFor: string; // the "Used for:" line — why the AI needs this module
}

// Ordered as the redesign's grouped modules (Brand basics → Look & feel).
export const BRAND_BOOK_SECTIONS: readonly BrandSection[] = [
  { id: "identity", group: "basics", name: "Identity", icon: "🪪", hint: "Positioning statement, description, market", usedFor: "naming, headlines, result copy" },
  { id: "voice", group: "basics", name: "Voice & tone", icon: "💬", hint: "Tone, voice summary, do / don't", usedFor: "the wording + tone of every generated line" },
  { id: "logo", group: "lookfeel", name: "Logo", icon: "🖼️", hint: "Primary mark, size, alignment", usedFor: "the brand mark shown on quiz screens" },
  { id: "colors", group: "lookfeel", name: "Colors", icon: "🎨", hint: "Primary, ink, accent, surface", usedFor: "the color theme of every quiz" },
  { id: "type", group: "lookfeel", name: "Typography", icon: "🔤", hint: "Heading + body font, scale", usedFor: "quiz fonts and the type scale" },
  { id: "shape", group: "lookfeel", name: "Shape & spacing", icon: "🔲", hint: "Corners, elevation, density", usedFor: "corner radius, elevation and layout density" },
  { id: "imagery", group: "lookfeel", name: "Imagery", icon: "📷", hint: "Style, mood, density", usedFor: "how product imagery is framed" },
] as const;

const set = (s: string | undefined | null): boolean => typeof s === "string" && s.trim().length > 0;
const tri = (strong: boolean, weak: boolean): SectionHealth => (strong ? "ok" : weak ? "warn" : "bad");

/** Per-section data-health: green = confirmed/strong · amber = weak · red =
 *  missing. Derives purely from what's set on the two stores. */
export function sectionHealth(
  id: BrandSectionId,
  identity: BrandIdentity | null,
  tokens: DesignTokens,
): SectionHealth {
  const c = tokens.colors ?? {};
  const t = tokens.typography ?? {};
  switch (id) {
    case "identity":
      return tri(set(identity?.summary) && (identity?.descriptions?.length ?? 0) > 0, set(identity?.summary));
    case "voice": {
      const n = identity?.tags?.length ?? 0;
      return tri(n >= 3, n >= 1);
    }
    case "logo":
      return set(tokens.logo?.url) ? "ok" : "bad";
    case "colors": {
      const have = [c.primary, c.secondary, c.accent, c.background, c.text].filter(set).length;
      return tri(have >= 4, have >= 1);
    }
    case "type":
      return tri(set(t.heading?.family) && set(t.body?.family), set(t.heading?.family) || set(t.body?.family));
    case "shape": {
      // Merged module: corners/button/elevation (shape) + density (spacing).
      const shapeSet = [tokens.radius, tokens.button_style, tokens.shadow].filter(Boolean).length;
      const densitySet = !!tokens.spacing;
      return tri(shapeSet >= 3 && densitySet, shapeSet >= 1 || densitySet);
    }
    case "imagery":
      return tokens.style_bar?.image_density !== undefined ||
        set(identity?.design?.imagery_style) ||
        (identity?.design?.aesthetic?.length ?? 0) > 0
        ? "ok"
        : "warn";
  }
}

/** The AI-digest confidence for a section, or null for sections whose value is
 *  purely merchant/token-driven (health already covers those). Identity + voice
 *  read the overall rollup; imagery reads the design lens. */
export function sectionConfidence(id: BrandSectionId, identity: BrandIdentity | null): Confidence | null {
  if (!identity) return null;
  switch (id) {
    case "identity":
    case "voice":
      return identity.confidence ?? "low";
    case "imagery":
      return identity.design?.confidence ?? "low";
    default:
      return null; // logo/colors/type/shape — token-driven
  }
}

export interface BrandBookSummary {
  ok: number;
  warn: number;
  bad: number;
  total: number;
}

/** The top completeness read-out: "N of {total} confirmed · M weak · K missing". */
export function brandBookSummary(identity: BrandIdentity | null, tokens: DesignTokens): BrandBookSummary {
  const summary: BrandBookSummary = { ok: 0, warn: 0, bad: 0, total: BRAND_BOOK_SECTIONS.length };
  for (const s of BRAND_BOOK_SECTIONS) {
    const h = sectionHealth(s.id, identity, tokens);
    summary[h] += 1;
  }
  return summary;
}
