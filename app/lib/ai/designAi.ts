// BLD-2 — Design AI: a merchant's natural-language brief ("warm editorial,
// cream background, serif headings, soft buttons") → a VALIDATED design-token
// patch. The output surface is deliberately tiny: exactly the fields the BLD-1
// Global styles panel + Theme rail already write (colors · curated Google
// fonts · button_radius · style_bar.lines · page_padding) — no new schema
// fields, so a restyle can never produce a doc shape the runtime hasn't seen.
//
// Boundary rules (the reason this schema exists):
//   · fonts are REJECTED unless they're in the curated list (the retry loop
//     feeds the violation back; on exhaustion the caller keeps the old look)
//   · numerics are CLAMPED to the panel's control ranges, never rejected
//   · colors must be #rrggbb hex
// The contrast guardrail (text-on-bg / white-on-primary ≥ 4.5:1) lives in
// designAiPatch.ts — applied AFTER this parse, before any write.
//
// ISOMORPHIC like every ./ai/* module — no prisma, no node builtins.
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { CURATED_FONTS, isCuratedFont } from "../curatedFonts";
import type { DesignTokensT } from "../designTokens";
import { MODEL, MAX_ATTEMPTS, createMessage, QuizGenerationError } from "./client";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const clampTo = (min: number, max: number) => (v: number) =>
  Math.min(max, Math.max(min, Math.round(v)));

const curatedFont = z
  .string()
  .refine((f) => isCuratedFont(f), "Font is not in the curated list");

// The patch the AI emits. Flat on purpose — a small, unambiguous surface the
// model can't mis-nest. applyDesignAiPatch maps it onto DesignTokens.
export const DesignAiPatch = z
  .object({
    colors: z
      .object({
        primary: z.string().regex(HEX_RE, "Colors must be #rrggbb hex"),
        background: z.string().regex(HEX_RE, "Colors must be #rrggbb hex"),
        text: z.string().regex(HEX_RE, "Colors must be #rrggbb hex"),
        muted: z.string().regex(HEX_RE, "Colors must be #rrggbb hex"),
      })
      .partial()
      .optional(),
    heading_font: curatedFont.optional(),
    body_font: curatedFont.optional(),
    // Clamped to the Global styles panel's control ranges (never rejected —
    // an over-eager 60px radius becomes 48, not a failed restyle).
    button_radius: z.number().transform(clampTo(0, 48)).optional(),
    answer_softness: z.number().transform(clampTo(0, 100)).optional(),
    page_padding: z.number().transform(clampTo(0, 120)).optional(),
  })
  .strip();
export type DesignAiPatchT = z.infer<typeof DesignAiPatch>;

// Exported so the prompt-includes-curated-fonts unit test can assert the AI
// is constrained to EXACTLY the families the dropdowns offer.
export const DESIGN_AI_SYSTEM_PROMPT =
  "You are a design director restyling a Shopify product-recommendation quiz from a merchant's short natural-language brief. " +
  "Emit ONE design-token patch via the tool. Include ONLY the fields the brief calls for — every omitted field keeps its current value, so a brief about colors must not touch fonts and vice versa. " +
  "Colors are #rrggbb hex. Keep text readable: aim for text-on-background and white-on-primary contrast of at least 4.5:1 (a deterministic guardrail will darken/lighten failing picks, so prefer picks that already pass). " +
  `Fonts MUST be chosen from this exact curated list — any other family is rejected: ${CURATED_FONTS.map((f) => f.family).join(", ")}. ` +
  "button_radius is 0-48 px (0 = square buttons, 48 = fully soft). answer_softness is 0-100 (0 = sharp answer cards, 100 = pill-soft). page_padding is 0-120 px of breathing room around the quiz content. " +
  "Respect the BRAND CONTEXT when present unless the brief explicitly overrides it. Output nothing outside the tool call.";

// Loose JSON Schema for the forced tool — the Zod parse above is the real
// gate (curated-font refine + clamps), mirroring the other ai/* tools.
const designPatchToolJsonSchema = {
  type: "object",
  properties: {
    colors: {
      type: "object",
      description: "Only the colors the brief calls for, as #rrggbb hex.",
      properties: {
        primary: { type: "string", description: "Brand/button color, #rrggbb" },
        background: { type: "string", description: "Page background, #rrggbb" },
        text: { type: "string", description: "Body text color, #rrggbb" },
        muted: { type: "string", description: "Secondary text color, #rrggbb" },
      },
    },
    heading_font: {
      type: "string",
      description: "Heading family — MUST be from the curated list in the system prompt.",
    },
    body_font: {
      type: "string",
      description: "Body family — MUST be from the curated list in the system prompt.",
    },
    button_radius: { type: "integer", description: "Button corner radius in px, 0-48." },
    answer_softness: { type: "integer", description: "Answer-card softness, 0-100." },
    page_padding: { type: "integer", description: "Page padding in px, 0-120." },
  },
} as const;

// Compact one-line-per-fact context so the model restyles FROM the current
// look instead of from nothing. Pure string building — unit-testable.
export function describeTokensForPrompt(t: DesignTokensT): string {
  const c = t.colors ?? {};
  const lines: string[] = [];
  if (c.primary) lines.push(`primary ${c.primary}`);
  if (c.background) lines.push(`background ${c.background}`);
  if (c.text) lines.push(`text ${c.text}`);
  if (c.muted) lines.push(`muted ${c.muted}`);
  const heading = t.typography?.heading?.family;
  const body = t.typography?.body?.family;
  if (heading) lines.push(`heading font ${heading}`);
  if (body) lines.push(`body font ${body}`);
  if (t.button_radius !== undefined) lines.push(`button_radius ${t.button_radius}px`);
  if (t.style_bar?.lines !== undefined) lines.push(`answer_softness ${t.style_bar.lines}`);
  if (t.page_padding) lines.push(`page_padding ${t.page_padding.top}px`);
  return lines.length > 0 ? lines.join(" · ") : "(house defaults)";
}

export interface DesignRestyleInput {
  // The merchant's brief, already trimmed/clamped by the caller.
  prompt: string;
  // The doc's current design_tokens (context, not constraint).
  currentTokens: DesignTokensT;
  // DGN-1 brand pack (brandIdentity.design.derived_tokens) when the shop has
  // one — surfaced as BRAND CONTEXT so restyles stay on-brand by default.
  brandTokens?: DesignTokensT | null;
}

// One small, low-temperature, forced-tool call on the shared client (Gap-8:
// never a self-built Anthropic client) → validated DesignAiPatch. Retries
// with the validation issue appended, like every other ai/* generator.
// Throws QuizGenerationError after MAX_ATTEMPTS — callers keep the old look.
export async function generateDesignRestyle(
  input: DesignRestyleInput,
): Promise<DesignAiPatchT> {
  const tool = {
    name: "emit_design_patch",
    description:
      "Emit the design-token patch for the merchant's brief. Only include fields the brief calls for.",
    input_schema: designPatchToolJsonSchema as unknown as Anthropic.Tool.InputSchema,
  } satisfies Anthropic.Tool;

  const userMessage = [
    "CURRENT DESIGN (restyle from here; unmentioned fields stay as-is):",
    describeTokensForPrompt(input.currentTokens),
    ...(input.brandTokens
      ? [
          "",
          "BRAND CONTEXT (the merchant's brand identity — respect unless the brief overrides it):",
          describeTokensForPrompt(input.brandTokens),
        ]
      : []),
    "",
    "MERCHANT BRIEF:",
    input.prompt,
  ].join("\n");

  let lastIssue: string | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await createMessage({
      model: MODEL,
      // Small on purpose — the patch is a handful of fields; a runaway
      // response is a failure, not a cost.
      max_tokens: 600,
      temperature: 0.2,
      system: DESIGN_AI_SYSTEM_PROMPT,
      tools: [tool],
      tool_choice: { type: "tool", name: "emit_design_patch" },
      messages: [
        {
          role: "user",
          content:
            attempt === 1
              ? userMessage
              : `${userMessage}\n\nPrevious attempt failed validation: ${lastIssue}. Re-emit strictly matching the schema (fonts ONLY from the curated list).`,
        },
      ],
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );
    if (!toolUse) {
      lastIssue = "No tool_use block in response.";
      continue;
    }

    const parsed = DesignAiPatch.safeParse(toolUse.input);
    if (parsed.success) {
      // An all-empty patch is a validation failure too — the merchant asked
      // for a restyle; "change nothing" means the brief wasn't understood.
      const p = parsed.data;
      const hasAny =
        (p.colors && Object.keys(p.colors).length > 0) ||
        p.heading_font !== undefined ||
        p.body_font !== undefined ||
        p.button_radius !== undefined ||
        p.answer_softness !== undefined ||
        p.page_padding !== undefined;
      if (hasAny) return parsed.data;
      lastIssue = "Patch was empty — include at least one field the brief calls for.";
      continue;
    }
    lastIssue = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
  }
  throw new QuizGenerationError(
    `Design restyle failed after ${MAX_ATTEMPTS} attempts`,
    MAX_ATTEMPTS,
    lastIssue,
  );
}
