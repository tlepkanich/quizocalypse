import { z } from "zod";
import { DesignTokens } from "./quizSchema";
import { BrandVoice, type BrandGuidelines } from "./brandGuidelines";

// ════════════════════════════════════════════════════════════════════════════
// Merchant Brand Identity (Builder Re-work · Step 0 — pre-install).
//
// A persistent, internal digest of who a merchant is — built once from the
// Shopify catalog + theme + shop metadata, then EVOLVED as more signals arrive.
// It is the "cheat code": downstream AI reads this summed-up paragraph (+ a
// design lens and a positioning lens) instead of re-pulling the whole catalog
// every call.
//
// Design rules baked into the shape:
//  · It COMPOSES existing types — `voice` reuses `BrandVoice` verbatim so
//    `buildBrandVoiceAddition` consumes `identity.voice` with zero changes, and
//    `design.derived_tokens` is a real `DesignTokens` partial that drops into
//    `resolveDesignTokens`/`tokensToCssVars`.
//  · The design/layout enums are the ACTUAL preset/variant ids
//    (themePresets.ts / layoutVariants.ts) — the AI picks from the real menu.
//  · It is an ENHANCEMENT, never a dependency: `parseBrandIdentitySafe` returns
//    null on any corrupt/older blob, exactly like `parseBrandGuidelinesSafe`, so
//    every consumer degrades to "no identity" gracefully.
// ════════════════════════════════════════════════════════════════════════════

// ── Confidence + provenance primitives ──────────────────────────────────────
export const Confidence = z.enum(["low", "medium", "high"]);
export type Confidence = z.infer<typeof Confidence>;

// Where a signal came from. Mirrors the inputs buildBrandIdentity reads.
export const IdentitySourceKind = z.enum([
  "catalog", // products / tags / types / prices in Postgres
  "shop_brand", // shop.brand (logo, slogan, short_description, colors)
  "shop_meta", // read_shop (name, description, plan, currency, country)
  "theme", // read_content theme settings_data.json (fonts, colors, logo)
  "best_sellers", // read_orders revenue ranking
  "website", // ingestWebsite() text
  "brand_guidelines", // an uploaded/preset BrandGuidelines, if present
  "merchant_input", // answers from the confirm screen / wizard
]);
export type IdentitySourceKind = z.infer<typeof IdentitySourceKind>;

export const IdentitySource = z.object({
  kind: IdentitySourceKind,
  // Free-text note: "top 100 of 1,240 products by revenue", "5 descriptions
  // widened (low-volume educational)", etc.
  detail: z.string().default(""),
  at: z.string(), // ISO timestamp this source was read
});
export type IdentitySource = z.infer<typeof IdentitySource>;

// ── DESIGN lens ─────────────────────────────────────────────────────────────
// Measures the style choices that map to one of our templates. The adjectives /
// temperament are the AI's reasoning; the *_id fields are the actionable
// mapping; derived_tokens is the concrete cascade-ready output.
export const DesignProfile = z.object({
  // 1–6 aesthetic adjectives: "polished", "editorial", "minimal", "clinical".
  aesthetic: z.array(z.string()).default([]),
  // How photo-heavy the brand reads — drives template + imagery guidance.
  imagery_density: z.enum(["sparse", "moderate", "rich"]).default("moderate"),
  // R-5 Imagery module — the merchant-picked framing style + free-text notes.
  // Optional (never a default) so existing identity blobs parse unchanged.
  imagery_style: z.enum(["product_neutral", "lifestyle", "editorial", "minimal"]).optional(),
  imagery_notes: z.string().optional(),
  // The "black-and-white vs colorful" axis.
  color_temperament: z
    .enum(["warm", "cool", "neutral", "monochrome", "vibrant"])
    .default("neutral"),
  // Visual formality register, parallel to (but distinct from) voice.
  formality: z.enum(["casual", "balanced", "refined", "luxury"]).default("balanced"),
  // THE MAPPING — must be one of THEME_PRESETS ids (themePresets.ts).
  suggested_theme_preset_id: z
    .enum(["linen", "minimal", "editorial", "bold", "pastel", "dark"])
    .default("linen"),
  // Must be one of LAYOUT_VARIANTS ids (layoutVariants.ts).
  suggested_layout_variant_id: z.enum(["cozy", "classic", "editorial"]).default("classic"),
  // Concrete tokens — the chosen preset reconciled with any real brand colors.
  // A partial DesignTokens, so resolveDesignTokens()/tokensToCssVars() consume
  // it directly. Server-written during the build, never invented by the AI.
  derived_tokens: DesignTokens.optional(),
  // One sentence the merchant sees on the confirm screen explaining the pick.
  rationale: z.string().default(""),
  confidence: Confidence.default("low"),
});
export type DesignProfile = z.infer<typeof DesignProfile>;

// ── POSITIONING lens ────────────────────────────────────────────────────────
export const PositioningProfile = z.object({
  // "Skincare", "Outdoor apparel", "Specialty coffee".
  industry: z.string().default(""),
  // Narrower vertical/sub-category if discernible: "clean beauty", "trail running".
  vertical: z.string().default(""),
  // 1–3 short demographic descriptors: "women 25-40", "gift buyers", "pro athletes".
  target_demographic: z.array(z.string()).default([]),
  // Where the catalog sits on price (derived from the price band).
  price_tier: z.enum(["value", "mid", "premium", "luxury", "mixed"]).default("mid"),
  // 2–4 category trends the AI can reuse for retargeting / future inference.
  category_trends: z.array(z.string()).default([]),
  rationale: z.string().default(""),
  confidence: Confidence.default("low"),
});
export type PositioningProfile = z.infer<typeof PositioningProfile>;

// ── The digest itself ───────────────────────────────────────────────────────
// Bump when the SHAPE changes incompatibly: an older blob then safe-fails the
// literal and is treated as "no identity" → rebuilt. No JSON migration script.
export const BRAND_IDENTITY_SCHEMA_VERSION = 1 as const;

export const BrandIdentity = z.object({
  schema_version: z
    .literal(BRAND_IDENTITY_SCHEMA_VERSION)
    .default(BRAND_IDENTITY_SCHEMA_VERSION),

  // THE SUMMED-UP PARAGRAPH — the cheat code a downstream call reads instead of
  // re-pulling the catalog.
  summary: z.string().min(1),

  // Brand-level identity descriptors (distinct from product/catalog tags):
  // "sustainable", "gifting", "minimalist".
  tags: z.array(z.string()).default([]),
  // 2–6 one-line claims / themes / differentiators.
  descriptions: z.array(z.string()).default([]),
  // Builder Re-work Step 1 — what customers STRUGGLE with in product selection,
  // captured in the funnel's goal stage (merchant_input source). The quiz builder
  // can speak directly to these. Additive/optional (older blobs default []).
  pain_points: z.array(z.string()).default([]),

  design: DesignProfile,
  positioning: PositioningProfile,

  // Reuses the EXISTING BrandVoice shape so buildBrandVoiceAddition consumes
  // identity.voice unchanged. Optional — a thin catalog may yield no voice read.
  voice: BrandVoice.optional(),

  // ── Provenance / evolution ──
  version: z.number().int().nonnegative().default(1),
  updated_at: z.string(), // ISO
  confidence: Confidence.default("low"), // overall rollup
  sources: z.array(IdentitySource).default([]),
  // True once the merchant signs off on the "here's what we see" screen.
  merchant_confirmed: z.boolean().default(false),
  // Dot-paths the merchant hand-edited — protected from re-sync overwrite.
  // e.g. "summary", "positioning.price_tier", "design.suggested_theme_preset_id".
  locked_fields: z.array(z.string()).default([]),
});
export type BrandIdentity = z.infer<typeof BrandIdentity>;

// Safe-parse + null fallback — IDENTICAL posture to parseBrandGuidelinesSafe so
// a corrupt or older blob never breaks a loader; it degrades to "no identity".
export function parseBrandIdentitySafe(raw: unknown): BrandIdentity | null {
  if (raw == null) return null;
  const parsed = BrandIdentity.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

// ── Adapter: identity → BrandGuidelines (ships DORMANT this step) ────────────
// Maps the identity's voice onto the BrandGuidelines shape so every one of the
// 7 existing AI prompts consumes it through the UNCHANGED buildBrandVoiceAddition
// in the next step. Returns null when there's no voice to thread (so the prompt
// path stays byte-identical to "no brand voice").
export function identityToBrandGuidelines(
  id: BrandIdentity | null | undefined,
): BrandGuidelines | null {
  if (!id || !id.voice) return null;
  return {
    name: id.positioning.industry.trim() || "Brand",
    voice: id.voice,
    visual_suggestions: {
      ...(id.design.derived_tokens ? { tokens: id.design.derived_tokens } : {}),
      notes: [],
    },
    source: {
      uploaded_at: id.updated_at,
      file_kind: "preset",
      extraction_model: "brand-identity",
    },
  };
}

// ── Lock-preserving merge — the single chokepoint refine + rebuild route through.
// For every dot-path the merchant locked on `prior`, copy that value over `fresh`
// and union the lock lists, so a hand edit survives every future re-sync/refine.
export function getByPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  let cursor = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]!;
    if (cursor[key] == null || typeof cursor[key] !== "object") cursor[key] = {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[keys[keys.length - 1]!] = value;
}

export function applyLocks(fresh: BrandIdentity, prior: BrandIdentity): BrandIdentity {
  if (prior.locked_fields.length === 0) return fresh;
  const merged = structuredClone(fresh) as unknown as Record<string, unknown>;
  for (const path of prior.locked_fields) {
    const priorValue = getByPath(prior, path);
    // Skip a lock that points at nothing on `prior` — never clobber with undefined.
    if (priorValue === undefined) continue;
    setByPath(merged, path, priorValue);
  }
  const lockUnion = Array.from(new Set([...fresh.locked_fields, ...prior.locked_fields]));
  setByPath(merged, "locked_fields", lockUnion);
  // Re-parse so the result is a guaranteed-valid BrandIdentity (defaults filled).
  return BrandIdentity.parse(merged);
}

// The dot-paths the merchant may hand-edit on the confirm screen. Editing any of
// them locks it (P4): a later re-sync/refine then preserves the edit via applyLocks.
export const EDITABLE_IDENTITY_PATHS = [
  "summary",
  "tags",
  "descriptions",
  "pain_points",
  "positioning.industry",
  "positioning.vertical",
  "positioning.target_demographic",
  "positioning.price_tier",
  "positioning.category_trends",
  "design.suggested_theme_preset_id",
  "design.suggested_layout_variant_id",
] as const;

// Which editable paths differ between an edited identity and the stored one —
// those become locks (unioned with any existing locks). Pure; the single place
// "a merchant edit locks the field" is decided.
export function lockEditedFields(edited: BrandIdentity, stored: BrandIdentity): string[] {
  const locks = new Set(stored.locked_fields);
  for (const path of EDITABLE_IDENTITY_PATHS) {
    if (JSON.stringify(getByPath(edited, path)) !== JSON.stringify(getByPath(stored, path))) {
      locks.add(path);
    }
  }
  return [...locks];
}
