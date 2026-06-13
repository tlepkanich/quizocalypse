import { z } from "zod";
import {
  BrandIdentity,
  DesignProfile,
  PositioningProfile,
  applyLocks,
  type BrandIdentity as BrandIdentityT,
  type Confidence,
  type IdentitySource,
} from "./brandIdentity";
import { BrandVoice } from "./brandGuidelines";
import { getPreset } from "./themePresets";
import { getLayoutVariant } from "./layoutVariants";
import type { DesignTokensT } from "./designTokens";

// ════════════════════════════════════════════════════════════════════════════
// Brand Identity assembly (Step 0) — the PURE half of the build: the AI-facing
// draft shape, the preset→tokens reconciliation, the confidence rollup, and the
// draft→full-identity assembly. No IO / AI / prisma here, so it's unit-testable
// in isolation; brandIdentityBuild.server.ts does the Claude call + persistence.
// ════════════════════════════════════════════════════════════════════════════

// The AI-emitted subset: the full BrandIdentity MINUS the fields the server
// stamps (derived_tokens + provenance/evolution). Reuses DesignProfile /
// PositioningProfile / BrandVoice so the vocabulary can't drift.
export const BrandIdentityDraft = z.object({
  summary: z.string().min(1),
  tags: z.array(z.string()).default([]),
  descriptions: z.array(z.string()).default([]),
  design: DesignProfile.omit({ derived_tokens: true }),
  positioning: PositioningProfile,
  voice: BrandVoice.optional(),
});
export type BrandIdentityDraft = z.infer<typeof BrandIdentityDraft>;

// AI design pick → derived_tokens: the chosen preset's full palette with the
// merchant's REAL brand colors overlaid for primary/secondary only (so the
// preset's accent/background/text stay coherent). The AI never invents tokens.
export function reconcileDesignTokens(
  presetId: string,
  brandColors?: { primary?: string; secondary?: string },
): DesignTokensT {
  const preset = getPreset(presetId);
  const base: DesignTokensT = preset?.tokens ?? {};
  const overlay: Record<string, string> = {};
  if (brandColors?.primary) overlay.primary = brandColors.primary;
  if (brandColors?.secondary) overlay.secondary = brandColors.secondary;
  return { ...base, colors: { ...base.colors, ...overlay } };
}

export function rollupConfidence(sourceCount: number, lowVolume: boolean): Confidence {
  if (lowVolume) return "low";
  if (sourceCount >= 4) return "high";
  if (sourceCount >= 2) return "medium";
  return "low";
}

// AI draft + signals → a complete, valid BrandIdentity (defaults filled).
export function assembleBrandIdentity(
  draft: BrandIdentityDraft,
  opts: {
    brandColors?: { primary?: string; secondary?: string };
    sources: IdentitySource[];
    now: string;
    lowVolumeEducationalHint?: boolean;
  },
): BrandIdentityT {
  const presetId = draft.design.suggested_theme_preset_id;
  const layoutId = getLayoutVariant(draft.design.suggested_layout_variant_id)
    ? draft.design.suggested_layout_variant_id
    : "classic";
  const derived_tokens = reconcileDesignTokens(presetId, opts.brandColors);

  return BrandIdentity.parse({
    summary: draft.summary,
    tags: draft.tags,
    descriptions: draft.descriptions,
    design: { ...draft.design, suggested_layout_variant_id: layoutId, derived_tokens },
    positioning: draft.positioning,
    ...(draft.voice ? { voice: draft.voice } : {}),
    version: 1,
    updated_at: opts.now,
    confidence: rollupConfidence(opts.sources.length, Boolean(opts.lowVolumeEducationalHint)),
    sources: opts.sources,
    merchant_confirmed: false,
    locked_fields: [],
  });
}

// Catalog re-sync / refresh: build fresh, then re-apply the merchant's locks so
// a hand edit survives the rebuild (the lock chokepoint from P1).
export function refineBrandIdentity(
  fresh: BrandIdentityT,
  current: BrandIdentityT,
): BrandIdentityT {
  return applyLocks(fresh, current);
}

// Step 1 — fold a "what customers struggle with" answer into the identity:
// append (deduped) to pain_points, LOCK it (so a re-sync preserves it via
// applyLocks), stamp a merchant_input source, bump version. Pure.
export function foldPainPoint(
  stored: BrandIdentityT,
  struggle: string,
  now: string,
): BrandIdentityT {
  const trimmed = struggle.trim();
  return BrandIdentity.parse({
    ...stored,
    pain_points: Array.from(new Set([...stored.pain_points, trimmed])),
    locked_fields: Array.from(new Set([...stored.locked_fields, "pain_points"])),
    sources: [...stored.sources, { kind: "merchant_input", detail: "step-1 struggle", at: now }],
    version: stored.version + 1,
    updated_at: now,
  });
}
