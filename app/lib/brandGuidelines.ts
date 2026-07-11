import { z } from "zod";
import { DesignTokens } from "./quizSchema";

// Structured brand voice + visual guidelines, distilled from a merchant's
// uploaded brand book (PDF / image / plain text) OR selected from a
// curated preset library. Stored on shop.brandGuidelines and folded into
// every AI surface so generated copy stays on-brand.

// The five tone presets offered in the Brand Identity → Voice module's Tone
// single-select. Optional so every existing guidelines blob parses unchanged
// (never a default — absent stays absent through a parse→save round-trip).
export const BrandTone = z.enum(["warm_expert", "playful", "clinical", "luxury", "minimal"]);
export type BrandTone = z.infer<typeof BrandTone>;

// Display labels for the tone presets — shared by the UI select and the prompt.
export const TONE_LABEL: Record<BrandTone, string> = {
  warm_expert: "Warm & expert",
  playful: "Playful",
  clinical: "Clinical",
  luxury: "Luxury",
  minimal: "Minimal",
};

export const BrandVoice = z.object({
  // 1–2 sentence summary of the brand's tone (e.g. "Warm and knowing,
  // never preachy. Speaks like a trusted friend who happens to be an
  // expert.").
  tone_description: z.string().min(1),
  // A coarse tone register the merchant picks (R-5 Voice module). Complements
  // the free-form tone_description; folded into the AI prompt when present.
  tone: BrandTone.optional(),
  // Hand-curated "do this" list. Each entry is short — chip-sized.
  do_list: z.array(z.string()).default([]),
  // Hand-curated "avoid this" list. Empty by default.
  dont_list: z.array(z.string()).default([]),
  // Example phrases that exemplify the voice. Used in prompts to give
  // Claude a concrete pattern to mimic.
  sample_phrases: z.array(z.string()).default([]),
  // Brand-banned phrases — sent to the AI as a hard "never use" list.
  // Typically only populated for real brand uploads (presets leave empty).
  forbidden_phrases: z.array(z.string()).default([]),
});
export type BrandVoice = z.infer<typeof BrandVoice>;

export const BrandVisualSuggestions = z.object({
  // Suggested design tokens — surfaced on the review card. NEVER applied
  // automatically to shop.brandTokens; merchant clicks Apply.
  tokens: DesignTokens.optional(),
  // Free-text observations like "Logo: navy, sans-serif" that don't fit
  // the structured tokens cleanly.
  notes: z.array(z.string()).default([]),
});
export type BrandVisualSuggestions = z.infer<typeof BrandVisualSuggestions>;

export const BrandGuidelinesSource = z.object({
  uploaded_at: z.string(),
  file_name: z.string().optional(),
  // "preset" covers archetypes from the curated library — same downstream
  // pipeline as uploads, but no Claude call ran.
  file_kind: z.enum(["pdf", "image", "text", "preset"]),
  extraction_model: z.string(),
});
export type BrandGuidelinesSource = z.infer<typeof BrandGuidelinesSource>;

export const BrandGuidelines = z.object({
  // Friendly display name. Shown in the "Brand voice: <name> active" pill
  // on the New Quiz wizard.
  name: z.string().default("Brand"),
  voice: BrandVoice,
  visual_suggestions: BrandVisualSuggestions.default({
    notes: [],
  }),
  source: BrandGuidelinesSource,
});
export type BrandGuidelines = z.infer<typeof BrandGuidelines>;

// Append a structured "BRAND VOICE" section to any system prompt. Returns
// the empty string when guidelines are absent so the existing prompt paths
// stay byte-identical for shops that haven't uploaded anything.
//
// Used by:
//  - generateQuiz   (SYSTEM_PROMPT)
//  - regenerateQuestion (REGEN_SYSTEM_PROMPT)
//  - runAskAIChat   (per-node persona prompt)
export function buildBrandVoiceAddition(
  g: BrandGuidelines | null | undefined,
): string {
  if (!g) return "";

  const lines: string[] = [];
  lines.push("");
  lines.push("");
  lines.push(
    "--- BRAND VOICE (apply this to all generated copy; takes precedence over generic tone hints) ---",
  );
  lines.push(`Brand: ${g.name}`);
  lines.push(`Tone: ${g.voice.tone_description}`);
  if (g.voice.tone) {
    lines.push(`Tone register: ${TONE_LABEL[g.voice.tone]}`);
  }
  if (g.voice.do_list.length > 0) {
    lines.push(`Do: ${g.voice.do_list.map((s) => `"${s}"`).join(" / ")}`);
  }
  if (g.voice.dont_list.length > 0) {
    lines.push(
      `Don't: ${g.voice.dont_list.map((s) => `"${s}"`).join(" / ")}`,
    );
  }
  if (g.voice.sample_phrases.length > 0) {
    lines.push(
      `Sample phrasing (mimic the pattern, don't copy): ${g.voice.sample_phrases.map((s) => `"${s}"`).join(", ")}`,
    );
  }
  if (g.voice.forbidden_phrases.length > 0) {
    lines.push(
      `Never use these phrases verbatim or near-verbatim: ${g.voice.forbidden_phrases.map((s) => `"${s}"`).join(", ")}`,
    );
  }
  return lines.join("\n");
}

// Safe parse + null fallback. Used at every loader boundary that passes
// brandGuidelines into Claude — a corrupt blob from prior versions never
// breaks generation, it just degrades to "no brand voice".
export function parseBrandGuidelinesSafe(
  raw: unknown,
): BrandGuidelines | null {
  if (raw == null) return null;
  const parsed = BrandGuidelines.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
