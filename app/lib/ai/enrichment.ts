// BIC-2 C3c — enrichment: reviews/FAQ enrichment, feature→benefit bullets,
// answer tooltips, grounded why-copy (WHY_COPY_CONSTRAINT is byte-pinned by a
// test), runtime per-shopper rec-copy, and the Tier-2 advisory path-quality
// review. Pure move out of claude.ts. ISOMORPHIC — no node builtins.
import type Anthropic from "@anthropic-ai/sdk";
import {
  buildBrandVoiceAddition,
  type BrandGuidelines,
} from "../brandGuidelines";
import { ReviewEnrichment } from "../reviewEnrichment";
import { z } from "zod";
import {
  MODEL,
  MODEL_FAST,
  MAX_TOKENS,
  MAX_ATTEMPTS,
  createMessage,
  QuizGenerationError,
} from "./client";

// ---------- Reviews/FAQ enrichment (Dev Spec §3.2) ----------

const ENRICH_SYSTEM_PROMPT =
  "You improve an existing product-recommendation quiz using REAL customer language from reviews/FAQs. " +
  "Rewrite answer-option wording so it matches how customers actually describe themselves and their needs (not marketing speak); " +
  "add a one-line tooltip per answer that addresses a real objection or point of confusion surfaced in the reviews; " +
  "rewrite each result's why-bullets (2–3, benefit-first, under 15 words each) to reflect what customers actually praise. " +
  "Reference ONLY node ids and answer ids that appear in the QUIZ OUTLINE — never invent ids, products, questions, or answers. " +
  "Only emit fields you are genuinely improving from the reviews; omit anything the reviews don't inform. Output only the tool call.";

const enrichToolJsonSchema = {
  type: "object",
  required: ["questions", "results"],
  properties: {
    summary: { type: "string", description: "One short sentence on what you changed." },
    questions: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "answers"],
        properties: {
          id: { type: "string" },
          answers: {
            type: "array",
            items: {
              type: "object",
              required: ["id"],
              properties: {
                id: { type: "string" },
                text: { type: "string" },
                tooltip_text: { type: "string" },
              },
            },
          },
        },
      },
    },
    results: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "why_bullets"],
        properties: {
          id: { type: "string" },
          why_bullets: { type: "array", items: { type: "string" }, maxItems: 3 },
        },
      },
    },
  },
} as const;

export interface EnrichFromReviewsInput {
  // Compact id-bearing outline of the current quiz (from quizEdit.outlineQuiz).
  outline: string;
  // The merchant's pasted review/FAQ text (clamped by clampReviewText).
  reviewText: string;
  brandGuidelines?: BrandGuidelines | null;
  toneSample?: string;
}

// Ask Claude to rewrite answer wording/tooltips + result why-bullets in the
// customers' own language from review/FAQ text. The caller applies it with
// applyReviewEnrichment + Quiz.parse (the AI emits no graph/ids it wasn't given).
// Throws QuizGenerationError after retries — the caller keeps the prior draft.
export async function enrichFromReviews(
  input: EnrichFromReviewsInput,
): Promise<ReviewEnrichment> {
  const tool = {
    name: "emit_enrichment",
    description:
      "Emit answer rewrites/tooltips and result why-bullets drawn from the customer reviews. Reference only ids from the outline.",
    input_schema: enrichToolJsonSchema as unknown as Anthropic.Tool.InputSchema,
  } satisfies Anthropic.Tool;

  const userMessage = [
    "QUIZ OUTLINE (reference these node/answer ids exactly):",
    input.outline,
    ...(input.toneSample
      ? ["", "BRAND VOICE SAMPLE (match this writing style):", input.toneSample]
      : []),
    "",
    "CUSTOMER REVIEWS / FAQ (the source of real language — use this, do not invent):",
    input.reviewText,
  ].join("\n");

  const system = ENRICH_SYSTEM_PROMPT + buildBrandVoiceAddition(input.brandGuidelines);

  let lastIssue: string | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await createMessage({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      tools: [tool],
      tool_choice: { type: "tool", name: "emit_enrichment" },
      messages: [
        {
          role: "user",
          content:
            attempt === 1
              ? userMessage
              : `${userMessage}\n\nPrevious attempt failed validation: ${lastIssue}. Re-emit strictly matching the schema.`,
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
    const parsed = ReviewEnrichment.safeParse(toolUse.input);
    if (parsed.success) return parsed.data;
    lastIssue = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
  }

  throw new QuizGenerationError(
    "Review enrichment failed validation after retries.",
    MAX_ATTEMPTS,
    lastIssue,
  );
}

// ---------- Feature→benefit translation (Dev Spec "Call 3") ----------

const BENEFIT_SYSTEM_PROMPT =
  "You are a conversion copywriter. Translate each product FEATURE into a customer BENEFIT. " +
  'Rules: start each bullet with the OUTCOME for the customer, not the attribute; max 15 words each; ' +
  'plain English, no jargon; do NOT use the words "just", "simply", or "easy". Return 2–3 bullets. ' +
  "Output only the tool call.";

const benefitsToolJsonSchema = {
  type: "object",
  required: ["bullets"],
  properties: {
    bullets: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 3 },
  },
} as const;

const BenefitsSchema = z.object({ bullets: z.array(z.string().min(1)).min(1).max(3) });

export interface BenefitInput {
  features: string[];
  // A brand-voice style cue (e.g. catalog tone sample). Optional.
  brandVoiceSample?: string;
  brandGuidelines?: BrandGuidelines | null;
}

// Turn product features into 2–3 benefit-first bullets for the result page's
// "Why this product". Enhancement only — returns [] on any failure (never
// throws, so a publish bake is never blocked).
export async function translateFeaturesToBenefits(input: BenefitInput): Promise<string[]> {
  if (input.features.length === 0) return [];
  const tool = {
    name: "emit_benefits",
    description: "Emit 2–3 benefit bullets translated from the given features.",
    input_schema: benefitsToolJsonSchema as unknown as Anthropic.Tool.InputSchema,
  } satisfies Anthropic.Tool;

  const userMessage = [
    "Features to translate:",
    ...input.features.map((f) => `- ${f}`),
    ...(input.brandVoiceSample
      ? ["", "Brand voice sample (match this writing style):", input.brandVoiceSample]
      : []),
  ].join("\n");
  const system = BENEFIT_SYSTEM_PROMPT + buildBrandVoiceAddition(input.brandGuidelines);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await createMessage({
      model: MODEL_FAST,
      max_tokens: 512,
      system,
      tools: [tool],
      tool_choice: { type: "tool", name: "emit_benefits" },
      messages: [{ role: "user", content: userMessage }],
    });
    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (!toolUse) continue;
    const parsed = BenefitsSchema.safeParse(toolUse.input);
    if (parsed.success) return parsed.data.bullets;
  }
  return [];
}

// ---------- Answer-option tooltips (Dev Spec "Call 4") ----------

const TOOLTIP_SYSTEM_PROMPT =
  "You write ONE short tooltip per quiz answer option, explaining the tradeoff in plain English. " +
  'Each tooltip ≤ 30 words, concrete, no jargon, no "just/simply/easy". Return exactly one tooltip ' +
  "per provided answer id. Output only the tool call.";

const tooltipsToolJsonSchema = {
  type: "object",
  required: ["tooltips"],
  properties: {
    tooltips: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "tooltip"],
        properties: { id: { type: "string" }, tooltip: { type: "string" } },
      },
    },
  },
} as const;

const TooltipsSchema = z.object({
  tooltips: z.array(z.object({ id: z.string().min(1), tooltip: z.string().min(1) })),
});

export interface TooltipInput {
  answers: Array<{ id: string; text: string }>;
  // Question text + a short note about what the answers map to, for grounding.
  context: string;
  brandGuidelines?: BrandGuidelines | null;
}

// Generate a tooltip per answer in ONE batched call. Enhancement only — returns
// {} on any failure (never throws). Output keyed by the answer id, filtered to
// the ids we actually asked about.
export async function generateAnswerTooltips(
  input: TooltipInput,
): Promise<Record<string, string>> {
  if (input.answers.length === 0) return {};
  const tool = {
    name: "emit_tooltips",
    description: "Emit one tooltip per answer id.",
    input_schema: tooltipsToolJsonSchema as unknown as Anthropic.Tool.InputSchema,
  } satisfies Anthropic.Tool;

  const userMessage = [
    "Context:",
    input.context,
    "",
    "Answer options (write one tooltip per id):",
    ...input.answers.map((a) => `- id=${a.id}: ${a.text}`),
  ].join("\n");
  const system = TOOLTIP_SYSTEM_PROMPT + buildBrandVoiceAddition(input.brandGuidelines);

  const known = new Set(input.answers.map((a) => a.id));
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await createMessage({
      model: MODEL_FAST,
      max_tokens: 1024,
      system,
      tools: [tool],
      tool_choice: { type: "tool", name: "emit_tooltips" },
      messages: [{ role: "user", content: userMessage }],
    });
    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (!toolUse) continue;
    const parsed = TooltipsSchema.safeParse(toolUse.input);
    if (parsed.success) {
      const out: Record<string, string> = {};
      for (const t of parsed.data.tooltips) if (known.has(t.id)) out[t.id] = t.tooltip;
      return out;
    }
  }
  return {};
}

// ---------- Grounded why-copy (rec-page-spec-V2 §8.2, L2-11) ----------

// The spec's explicit prompt constraint, VERBATIM (§8.2 — a SAFETY
// requirement: free-generated AI copy is an unsubstantiated-claims liability).
// Exported so a test pins the exact wording against drift.
export const WHY_COPY_CONSTRAINT =
  "Reason only from the supplied product attributes. Never assert efficacy, ingredients, or " +
  "outcomes not present in the product data. If the data doesn't support a specific reason, " +
  "give a general benefit statement.";

const WHY_COPY_SYSTEM_PROMPT =
  'You draft the "why we recommend" paragraph a merchant shows next to quiz-recommended ' +
  "products. ONE warm, concrete paragraph of 1–3 sentences (≤ 60 words), written to the " +
  'shopper ("you"), no headings, no quotes, no exclamation-mark pileups, no "just/simply". ' +
  WHY_COPY_CONSTRAINT +
  " Output only the tool call.";

const whyCopyToolJsonSchema = {
  type: "object",
  required: ["copy"],
  properties: {
    copy: { type: "string", description: "The grounded why-we-recommend paragraph." },
  },
} as const;

const WhyCopySchema = z.object({ copy: z.string().min(1).max(600) });

export interface WhyCopyInput {
  /** Display name for the scope: a bucket's name, or the quiz name for global. */
  targetName: string;
  /** The scope's products — the ONLY grounding material (§8.2). */
  products: { title: string; description: string; tags: string[] }[];
  brandGuidelines?: BrandGuidelines | null;
}

export async function generateWhyCopy(input: WhyCopyInput): Promise<string> {
  const tool = {
    name: "emit_why_copy",
    description: "Emit the grounded why-we-recommend paragraph.",
    input_schema: whyCopyToolJsonSchema as unknown as Anthropic.Tool.InputSchema,
  } satisfies Anthropic.Tool;

  const userMessage = [
    `Recommendation scope: ${input.targetName}`,
    "",
    "Product data (the ONLY facts you may reason from):",
    ...input.products.map(
      (p) =>
        `- ${p.title}${p.tags.length ? ` [tags: ${p.tags.join(", ")}]` : ""}${
          p.description ? ` — ${p.description.slice(0, 400)}` : ""
        }`,
    ),
  ].join("\n");
  const system = WHY_COPY_SYSTEM_PROMPT + buildBrandVoiceAddition(input.brandGuidelines);

  let lastError = "no tool call";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await createMessage({
      model: MODEL_FAST,
      max_tokens: 512,
      system,
      tools: [tool],
      tool_choice: { type: "tool", name: "emit_why_copy" },
      messages: [{ role: "user", content: userMessage }],
    });
    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (!toolUse) continue;
    const parsed = WhyCopySchema.safeParse(toolUse.input);
    if (parsed.success) return parsed.data.copy.trim();
    lastError = parsed.error.issues[0]?.message ?? "invalid tool output";
  }
  throw new QuizGenerationError("Why-copy generation failed", MAX_ATTEMPTS, lastError);
}

// ---------- Runtime per-shopper rec-copy (rec-page-spec-V2 §8.3, L2-12b) ------

// The RUNTIME variant of the grounded why-copy: generated per shopper at result
// time (raced against the reveal interstitial), grounded in the ONE hero product
// + the shopper's OWN answers. §8.3 combination-framing: when a rule fired, the
// copy explains the recommendation as the COMBINATION of answers that matched.
// Reuses WHY_COPY_CONSTRAINT VERBATIM — the same anti-unsubstantiated-claims
// safety line the config-time generator uses. ONE paragraph that REPLACES the
// merchant's template (never stacked).
const RUNTIME_REC_COPY_SYSTEM_PROMPT =
  'You write the single "why we recommend this for you" paragraph a shopper sees ' +
  "after finishing a product quiz. Speak directly to the shopper (\"you\"), warm and " +
  "specific, ONE paragraph of 1–3 sentences (≤ 55 words). No headings, no quotes, no " +
  'exclamation pile-ups, no "just/simply". Connect their quiz answers to why this ' +
  "product fits. " +
  WHY_COPY_CONSTRAINT +
  " Output only the tool call.";

const runtimeRecCopyToolJsonSchema = {
  type: "object",
  required: ["copy"],
  properties: {
    copy: {
      type: "string",
      description: "The grounded, shopper-personalized why-we-recommend paragraph.",
    },
  },
} as const;

const RuntimeRecCopySchema = z.object({ copy: z.string().min(1).max(600) });

export interface RuntimeRecCopyInput {
  /** The resolved target's display name (bucket/collection/product name). */
  targetName: string;
  /** The ONE hero product — the primary grounding material (§8.2). Null when the
   *  target resolved but has no in-stock hero (the copy stays general). */
  heroProduct: { title: string; description: string; tags: string[] } | null;
  /** The shopper's chosen answer texts — the personalization + framing source. */
  answerTexts: string[];
  /** §8.3 — a human-readable phrase for the rule that fired, when a rule (not the
   *  bare deciding answer) decided the target. Drives combination-framing. */
  matchedRuleText?: string;
  brandGuidelines?: BrandGuidelines | null;
}

export async function generateRuntimeRecCopy(input: RuntimeRecCopyInput): Promise<string> {
  const tool = {
    name: "emit_rec_copy",
    description: "Emit the shopper-personalized why-we-recommend paragraph.",
    input_schema: runtimeRecCopyToolJsonSchema as unknown as Anthropic.Tool.InputSchema,
  } satisfies Anthropic.Tool;

  const lines = [
    `Recommendation scope: ${input.targetName}`,
    "",
    input.answerTexts.length
      ? `The shopper's quiz answers: ${input.answerTexts.join("; ")}`
      : "The shopper completed the quiz.",
  ];
  if (input.matchedRuleText) {
    lines.push(
      "",
      `This recommendation was chosen because that COMBINATION of answers matched: ${input.matchedRuleText}. ` +
        "Frame the paragraph around how those answers together point to this product.",
    );
  }
  lines.push("", "Hero product data (the ONLY product facts you may reason from):");
  if (input.heroProduct) {
    const p = input.heroProduct;
    lines.push(
      `- ${p.title}${p.tags.length ? ` [tags: ${p.tags.join(", ")}]` : ""}${
        p.description ? ` — ${p.description.slice(0, 400)}` : ""
      }`,
    );
  } else {
    lines.push("- (no specific product data — give a general, answer-grounded benefit statement)");
  }
  const userMessage = lines.join("\n");
  const system = RUNTIME_REC_COPY_SYSTEM_PROMPT + buildBrandVoiceAddition(input.brandGuidelines);

  let lastError = "no tool call";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await createMessage({
      model: MODEL_FAST,
      max_tokens: 512,
      system,
      tools: [tool],
      tool_choice: { type: "tool", name: "emit_rec_copy" },
      messages: [{ role: "user", content: userMessage }],
    });
    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (!toolUse) continue;
    const parsed = RuntimeRecCopySchema.safeParse(toolUse.input);
    if (parsed.success) return parsed.data.copy.trim();
    lastError = parsed.error.issues[0]?.message ?? "invalid tool output";
  }
  throw new QuizGenerationError("Runtime rec-copy generation failed", MAX_ATTEMPTS, lastError);
}

// ---------- Tier-2 advisory path-quality review (spec §7 Tier-2, L2-12c) ------

// The ADVISORY AI pass behind "Run AI quality review". Reads each reachable,
// mapped outcome (path → recommendation target + its why-copy + a product
// sample) and judges whether the pairing makes sense — "looks_right" or
// "review" with a one-line note. NEVER gates publish: publish never calls this
// (it fills a draft-only panel field), so a throw here is merchant-button
// feedback only. Capped at 2 attempts (own bound, not the module's 3) to stay
// inside the Fly ~60s edge window; runs on MODEL (Sonnet) explicitly.
const PATH_QUALITY_MAX_ATTEMPTS = 2;

const pathReviewToolJsonSchema = {
  type: "object",
  required: ["rows"],
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
        required: ["outcome_id", "verdict", "note"],
        properties: {
          outcome_id: { type: "string", description: "The exact outcome_id from the input list." },
          verdict: { type: "string", enum: ["looks_right", "review"] },
          note: { type: "string", description: "One short sentence: why it looks right, or what to reconsider." },
        },
      },
    },
  },
} as const;

const PathReviewSchema = z.object({
  rows: z.array(
    z.object({
      outcome_id: z.string().min(1),
      verdict: z.enum(["looks_right", "review"]),
      note: z.string().max(400),
    }),
  ),
});

export interface PathReviewInput {
  outcomes: Array<{
    outcome_id: string;
    path: string;
    target: string;
    whyCopy: string;
    products: string[];
  }>;
  brandGuidelines?: BrandGuidelines | null;
}

export async function reviewPathQuality(
  input: PathReviewInput,
): Promise<Array<{ outcome_id: string; verdict: "looks_right" | "review"; note: string }>> {
  const tool = {
    name: "emit_path_review",
    description: "Emit one advisory row per outcome judging recommendation quality.",
    input_schema: pathReviewToolJsonSchema as unknown as Anthropic.Tool.InputSchema,
  } satisfies Anthropic.Tool;

  const system =
    "You are a merchandising reviewer for a product-recommendation quiz. For EACH outcome you are " +
    "given the shopper's path, the product group it recommends, that group's shown \"why we " +
    "recommend\" copy, and a sample of its products. Judge whether the recommendation is a sensible " +
    "fit for that path. Return ONE row per outcome (use the given outcome_id verbatim): verdict " +
    "\"looks_right\" when the pairing is coherent, \"review\" when the path and the recommended " +
    "products/copy seem mismatched or the copy overclaims. Keep each note to one short, concrete " +
    "sentence. Reason only from the supplied data. Output only the tool call." +
    buildBrandVoiceAddition(input.brandGuidelines);

  const userMessage = [
    "Outcomes to review:",
    ...input.outcomes.map((o, i) =>
      [
        `${i + 1}. outcome_id: ${o.outcome_id}`,
        `   Shopper path: ${o.path}`,
        `   Recommends: ${o.target}`,
        `   Why-copy shown: ${o.whyCopy || "(none set)"}`,
        `   Sample products: ${o.products.length ? o.products.join(", ") : "(none synced)"}`,
      ].join("\n"),
    ),
  ].join("\n\n");

  let lastError = "no tool call";
  for (let attempt = 1; attempt <= PATH_QUALITY_MAX_ATTEMPTS; attempt++) {
    const response = await createMessage({
      model: MODEL,
      max_tokens: 1024,
      system,
      tools: [tool],
      tool_choice: { type: "tool", name: "emit_path_review" },
      messages: [{ role: "user", content: userMessage }],
    });
    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (!toolUse) continue;
    const parsed = PathReviewSchema.safeParse(toolUse.input);
    if (parsed.success) return parsed.data.rows;
    lastError = parsed.error.issues[0]?.message ?? "invalid tool output";
  }
  throw new QuizGenerationError("Path-quality review failed", PATH_QUALITY_MAX_ATTEMPTS, lastError);
}
