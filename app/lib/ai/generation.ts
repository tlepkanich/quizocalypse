// BIC-2 C3c — generation: question regeneration, the Smart-Build question
// flow, Step-1 template directions, and the Step-2 web research + quiz types +
// rich battle-card templates. Pure move out of claude.ts (bodies byte-
// identical, prompts untouched). ISOMORPHIC — no node builtins.
import type Anthropic from "@anthropic-ai/sdk";
import { QuestionDataObject, TemplateOption, QuizType, RichTemplateOption } from "../quizSchema";
import type {
  QuestionData,
  TemplateOption as TemplateOptionT,
  QuizType as QuizTypeT,
  RichTemplateOption as RichTemplateOptionT,
} from "../quizSchema";
import {
  buildBrandVoiceAddition,
  type BrandGuidelines,
} from "../brandGuidelines";
import type { GeneratedQuestionFlow } from "../smartBuild";
import { z } from "zod";
import {
  MODEL,
  MODEL_SPEED,
  MAX_TOKENS,
  MAX_ATTEMPTS,
  createMessage,
  QuizGenerationError,
} from "./client";

// QZY-4 (owner supplement) — a shared ban folded onto EVERY question-writing
// prompt: budget questions are not something brands ask their shoppers.
const BANNED_QUESTION_GUIDANCE =
  "\nNEVER ask about budget, price range, or how much the shopper wants to " +
  "spend — brands don't ask that. If price sensitivity matters, infer it " +
  "from product choices instead.";

const REGEN_SYSTEM_PROMPT =
  "You are regenerating ONE question in an existing Shopify product quiz. " +
  "Use the catalog summary for tag accuracy — only use tags that exist in the " +
  "supplied catalog. Keep the question useful for product targeting. The " +
  "downstream system will preserve answer IDs where possible by order — keep " +
  "the answer count similar to the original so edge connections survive." +
  BANNED_QUESTION_GUIDANCE;

const regenQuestionToolJsonSchema = {
  type: "object",
  required: ["text", "question_type", "answers"],
  properties: {
    text: { type: "string" },
    question_type: {
      type: "string",
      enum: ["single_select", "multi_select", "image_tile"],
    },
    required: { type: "boolean" },
    max_selections: { type: "number" },
    answers: {
      type: "array",
      minItems: 2,
      items: {
        type: "object",
        required: ["text", "tags"],
        properties: {
          text: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          collection_filter: { type: "string" },
          image_url: { type: "string" },
        },
      },
    },
  },
} as const;

// Use the raw object (not the refined QuestionData) for .pick/.shape —
// refine wraps the schema in ZodEffects which doesn't expose those APIs.
const RegenInput = QuestionDataObject.pick({
  text: true,
  question_type: true,
  required: true,
  max_selections: true,
}).extend({
  answers: QuestionDataObject.shape.answers.element
    .pick({ text: true, tags: true, collection_filter: true, image_url: true })
    .array()
    .min(2),
});

export interface RegenerateQuestionInput {
  catalogSummary: string;
  existingQuestion: z.infer<typeof QuestionData>;
  steeringPrompt: string;
  // Optional brand guidelines — folded onto REGEN_SYSTEM_PROMPT so a
  // regenerated question matches the same voice as freshly generated ones.
  brandGuidelines?: BrandGuidelines | null;
}

export type QuizTone = "friendly" | "editorial" | "playful" | "professional";

// (generateQuiz / buildUserMessage removed — whole-quiz generation was retired
// when the New Quiz wizard was replaced by minimal create + Smart Build.)

export interface RegeneratedQuestion {
  text: string;
  question_type: z.infer<typeof QuestionDataObject.shape.question_type>;
  required: boolean;
  max_selections?: number;
  answers: Array<{
    text: string;
    tags: string[];
    collection_filter?: string;
    image_url?: string;
  }>;
}

// Regenerate a single question's content. Returns updated text + answers
// without IDs — caller merges with existing question to preserve answer/handle
// IDs (and thus edge connections).
export async function regenerateQuestion(
  input: RegenerateQuestionInput,
): Promise<RegeneratedQuestion> {
  const tool = {
    name: "emit_question",
    description:
      "Emit the regenerated question. Only the question's content — text, type, and answers — not the surrounding quiz.",
    input_schema:
      regenQuestionToolJsonSchema as unknown as Anthropic.Tool.InputSchema,
  } satisfies Anthropic.Tool;

  const userMessage = [
    "Catalog summary (only use these tags):",
    input.catalogSummary,
    "",
    "Existing question (regenerate this — keep the same intent, refine the wording or answer set):",
    JSON.stringify(input.existingQuestion, null, 2),
    "",
    "Merchant steering (optional, may be empty):",
    input.steeringPrompt || "(none)",
  ].join("\n");

  // Brand voice (optional) takes precedence over the generic regen
  // instructions so a tuned brand always wins over the default tone.
  const regenSystem =
    REGEN_SYSTEM_PROMPT + buildBrandVoiceAddition(input.brandGuidelines);

  let lastIssue: string | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await createMessage({
      model: MODEL,
      max_tokens: 2048,
      system: regenSystem,
      tools: [tool],
      tool_choice: { type: "tool", name: "emit_question" },
      messages: [
        {
          role: "user",
          content:
            attempt === 1
              ? userMessage
              : `${userMessage}\n\nPrevious attempt failed validation: ${lastIssue}. Regenerate matching the schema.`,
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

    const parsed = RegenInput.safeParse(toolUse.input);
    if (parsed.success) {
      return {
        text: parsed.data.text,
        question_type: parsed.data.question_type,
        required: parsed.data.required ?? true,
        ...(parsed.data.max_selections !== undefined
          ? { max_selections: parsed.data.max_selections }
          : {}),
        answers: parsed.data.answers.map((a) => ({
          text: a.text,
          tags: a.tags,
          ...(a.collection_filter ? { collection_filter: a.collection_filter } : {}),
          ...(a.image_url ? { image_url: a.image_url } : {}),
        })),
      };
    }

    lastIssue = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
  }

  throw new QuizGenerationError(
    "Question regeneration failed validation after retries.",
    MAX_ATTEMPTS,
    lastIssue,
  );
}

// ---------- Smart Build: generate a question flow for existing buckets ----------

const QUESTION_FLOW_SYSTEM_PROMPT =
  "You design ONLY the question flow for an existing Shopify product-finder quiz. " +
  "The intro page and the result pages (one per outcome bucket) already exist — " +
  "do NOT emit intro, result, branch, email, or end nodes; output only questions " +
  "(plus optional welcome/email-gate copy if requested). Every answer's tags[] must " +
  "reference tags that exist in the supplied catalog summary — never invent tags. " +
  "Across the whole quiz every bucket must be reachable: each answer should lean " +
  "toward exactly one bucket by including at least one of that bucket's routing tags, " +
  "and together the answers must cover every bucket's tags. Keep questions concise and " +
  "useful for narrowing products. Never write commentary or anything outside the tool call." +
  BANNED_QUESTION_GUIDANCE;

const questionFlowToolJsonSchema = {
  type: "object",
  required: ["questions"],
  properties: {
    questions: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["text", "question_type", "answers"],
        properties: {
          text: { type: "string" },
          question_type: {
            type: "string",
            enum: ["single_select", "multi_select", "image_tile", "searchable", "image_picker"],
          },
          required: { type: "boolean" },
          max_selections: { type: "number" },
          education_card_before: { type: "string" },
          section_label: { type: "string", description: "Optional chapter label (≤40 chars). Group consecutive questions into ≤3 chapters." },
          helper_text: { type: "string", description: "Optional one-line reassurance under the question (≤160 chars)." },
          answers: {
            type: "array",
            minItems: 2,
            items: {
              type: "object",
              required: ["text", "tags"],
              properties: {
                text: { type: "string" },
                tags: { type: "array", items: { type: "string" } },
                collection_filter: { type: "string" },
                image_url: { type: "string" },
              },
            },
          },
        },
      },
    },
    welcome_message: {
      type: "object",
      required: ["text"],
      properties: { text: { type: "string" } },
    },
    email_gate: {
      type: "object",
      required: ["headline"],
      properties: { headline: { type: "string" }, subtext: { type: "string" } },
    },
  },
} as const;

const QuestionFlowSchema = z.object({
  questions: z
    .array(
      z.object({
        text: z.string().min(1),
        question_type: QuestionDataObject.shape.question_type,
        required: z.boolean().optional(),
        max_selections: z.number().int().positive().optional(),
        education_card_before: z.string().optional(),
        section_label: z.string().max(40).optional(),
        helper_text: z.string().max(160).optional(),
        answers: z
          .array(
            z.object({
              text: z.string().min(1),
              tags: z.array(z.string()).default([]),
              collection_filter: z.string().optional(),
              image_url: z.string().optional(),
            }),
          )
          .min(2),
      }),
    )
    .min(1),
  welcome_message: z.object({ text: z.string().min(1) }).optional(),
  email_gate: z
    .object({ headline: z.string().min(1), subtext: z.string().default("") })
    .optional(),
});

export interface GenerateQuestionFlowInput {
  goalPrompt: string;
  questionCount: number;
  catalogSummary: string;
  buckets: Array<{ id: string; name: string; tags: string[] }>;
  flow: { welcome_message: boolean; email_gate: boolean; mixed_input_types: boolean };
  tone: QuizTone;
  brandGuidelines?: BrandGuidelines | null;
  // Dev Spec §3.1 — first ~5 product descriptions as a writing-style reference.
  toneSample?: string;
  // Dev Spec §3.2 — extracted brand-website text (mission/FAQ/voice). Pre-capped.
  websiteText?: string;
  // Experiences E2 — shapes the question style per experience type.
  experienceType?: "product_match" | "personality" | "lead_capture" | "survey";
  // LOGIC v2 (L2-10c) — steer the flow toward the one-decider shape. QUALITY
  // only: the deterministic post-process (deciderMapping + the decider merge
  // in smartBuild) owns correctness regardless of what the AI emits. Absent →
  // the prompt is byte-identical to before.
  logicModel?: "decider";
}

// Per-type prompt addendum (E2). Empty for the historical product_match.
function experienceAddendum(t?: string): string {
  switch (t) {
    case "survey":
      return (
        "\nEXPERIENCE TYPE: SURVEY. Write questions that gather honest feedback/insight " +
        "from existing customers (satisfaction, priorities, open feedback). Answers must " +
        "use EMPTY tags [] — there is no product routing. Do NOT reference products or " +
        "recommendations anywhere. Vary input types (rating scales, single selects, one " +
        "optional open text)."
      );
    case "lead_capture":
      return (
        "\nEXPERIENCE TYPE: LEAD CAPTURE. Write 2-3 short QUALIFICATION questions " +
        "(who they are, what they need, how ready they are) that make the follow-up " +
        "email more relevant. Answers use EMPTY tags [] unless buckets are provided. " +
        "The email gate is the point — write a gate headline that frames the capture " +
        "as a service (\"Where should we send it?\"), never as a toll."
      );
    case "personality":
      return (
        "\nEXPERIENCE TYPE: PERSONALITY. Frame questions in second person about the " +
        "SHOPPER's identity/preferences (not product attributes) — the payoff is a " +
        "persona reveal. Answers still carry routing tags toward the buckets, but the " +
        "voice is \"which one are you\", warm and identity-affirming."
      );
    default:
      return "";
  }
}

// LOGIC v2 (L2-10c) — the one-decider prompt addendum. Exported for the
// byte-stability test (absent flag MUST return "" so the legacy system prompt
// is character-identical). The tool schema / Zod parsing / retries are
// untouched — this only steers content quality.
export function deciderAddendum(m?: "decider"): string {
  if (m !== "decider") return "";
  return (
    "\nLOGIC MODEL: ONE-DECIDER. Exactly ONE question (prefer an early one) should " +
    "directly ask WHICH outcome bucket fits the shopper — single_select, roughly one " +
    "answer per bucket, each answer's tags matching that bucket's routing tags so it " +
    "maps 1:1 to a bucket. Every OTHER question is a qualifier that refines the " +
    "recommendation but must NOT try to route — keep qualifier answers' tags light. " +
    "Do NOT include email_gate copy: the results page has its own capture screen."
  );
}

// Generate the question flow (questions only — no nodes/edges/ids) for a quiz
// whose intro + bucket result pages already exist. The deterministic merge in
// app/lib/smartBuild.ts wires the nodes/edges/branch.
export async function generateQuestionFlow(
  input: GenerateQuestionFlowInput,
): Promise<GeneratedQuestionFlow> {
  const tool = {
    name: "emit_question_flow",
    description:
      "Emit the quiz's questions (and optional welcome/email copy). No intro/result/branch nodes.",
    input_schema: questionFlowToolJsonSchema as unknown as Anthropic.Tool.InputSchema,
  } satisfies Anthropic.Tool;

  const toneLine = `Tone: ${input.tone}.`;
  const flowLines: string[] = [];
  if (input.flow.welcome_message)
    flowLines.push("Include a short, on-brand welcome_message (chat-style) shown before the first question.");
  if (input.flow.email_gate)
    flowLines.push("Include email_gate copy (headline + subtext) for an email capture shown before results.");
  if (input.flow.mixed_input_types)
    flowLines.push("Use a mix of input styles — include at least one image_picker or searchable question alongside single/multi-select.");

  const userMessage = [
    toneLine,
    `Target question count: ${input.questionCount}.`,
    "Merchant's quiz goal (verbatim):",
    input.goalPrompt || "(none — infer from the catalog + buckets)",
    "",
    "Outcome buckets the shopper must be routed to (use these tags so answers map to them):",
    ...input.buckets.map((b) => `- ${b.name} [routing tags: ${b.tags.join(", ") || "(none)"}]`),
    "",
    "Catalog summary (only use tags that appear here):",
    input.catalogSummary,
    "",
    "Optionally add ONE education_card_before (at most one across the ENTIRE quiz) to a single question where shoppers need a concept explained before they can answer well — e.g. an unfamiliar material, spec, fit, or term. One short, plain-language sentence. Omit it entirely if nothing genuinely needs explaining.",
    "Optionally group questions into chapters via section_label (≤3 distinct labels across the quiz, consecutive questions share one — e.g. \"Skin profile\", \"Your preferences\") and add a one-line helper_text reassurance to questions where shoppers might overthink (\"There's no wrong answer…\"). Both optional — use them where they genuinely lower friction.",
    ...(input.toneSample
      ? ["", "Brand voice sample — match this writing style:", input.toneSample]
      : []),
    ...(input.websiteText
      ? ["", "Brand website content (use for on-brand language, mission, FAQ patterns):", input.websiteText]
      : []),
    "",
    flowLines.length ? "Flow requirements:" : "",
    ...flowLines,
  ]
    .filter((l) => l !== "")
    .join("\n");

  const system =
    QUESTION_FLOW_SYSTEM_PROMPT +
    experienceAddendum(input.experienceType) +
    deciderAddendum(input.logicModel) +
    buildBrandVoiceAddition(input.brandGuidelines);

  let lastIssue: string | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await createMessage({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      tools: [tool],
      tool_choice: { type: "tool", name: "emit_question_flow" },
      messages: [
        {
          role: "user",
          content:
            attempt === 1
              ? userMessage
              : `${userMessage}\n\nPrevious attempt failed validation: ${lastIssue}. Regenerate strictly matching the schema.`,
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

    const parsed = QuestionFlowSchema.safeParse(toolUse.input);
    if (parsed.success) {
      return {
        questions: parsed.data.questions.map((q) => ({
          text: q.text,
          question_type: q.question_type,
          ...(q.required !== undefined ? { required: q.required } : {}),
          ...(q.max_selections !== undefined ? { max_selections: q.max_selections } : {}),
          ...(q.education_card_before ? { education_card_before: q.education_card_before } : {}),
          answers: q.answers.map((a) => ({
            text: a.text,
            tags: a.tags,
            ...(a.collection_filter ? { collection_filter: a.collection_filter } : {}),
            ...(a.image_url ? { image_url: a.image_url } : {}),
          })),
        })),
        ...(parsed.data.welcome_message ? { welcome_message: parsed.data.welcome_message } : {}),
        ...(parsed.data.email_gate ? { email_gate: parsed.data.email_gate } : {}),
      };
    }

    lastIssue = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
  }

  throw new QuizGenerationError(
    "Question flow generation failed validation after retries.",
    MAX_ATTEMPTS,
    lastIssue,
  );
}

// ── Step 1 — lightweight quiz "directions" (the cheap one-pass options) ──────
// Propose 2–3 distinct quiz DIRECTIONS the merchant picks from at the end of the
// Step-1 funnel. Each = experience type + angle + 2–3 sample question texts (no
// tags/answers — tag-correctness is the full build's job). One cheap pass, so it
// fits the awaited studio window. Clones the forced-tool + retry skeleton.

const TemplateOptionsResult = z.object({
  options: z.array(TemplateOption).min(2).max(3),
});

const TEMPLATE_OPTIONS_TOOL_SCHEMA = {
  type: "object",
  required: ["options"],
  properties: {
    options: {
      type: "array",
      minItems: 2,
      maxItems: 3,
      items: {
        type: "object",
        required: ["id", "experience_type", "title", "angle", "sample_questions"],
        properties: {
          id: { type: "string", description: "stable slug, e.g. skin-goals-match" },
          experience_type: {
            type: "string",
            enum: ["product_match", "personality", "lead_capture", "survey"],
          },
          title: { type: "string", description: "the direction name shown on the card" },
          angle: { type: "string", description: "one line: how this quiz frames the journey" },
          rationale: { type: "string", description: "why it fits this brand + goal" },
          sample_questions: {
            type: "array",
            minItems: 2,
            maxItems: 3,
            items: { type: "string" },
          },
        },
      },
    },
  },
} as const;

const TEMPLATE_OPTIONS_SYSTEM_PROMPT =
  "You propose 2-3 DISTINCT quiz directions for a Shopify product-finder, grounded " +
  "in the brand and the merchant's goal. Rules:\n" +
  // QZY-4 (owner supplement) — the surfaced mix is fixed: shoppers compare a
  // product-match direction against a personality one, so they read as two
  // genuinely different products, not three flavors of one.
  "- The set MUST contain 1-2 product_match directions and EXACTLY 1 personality " +
  "direction (no lead_capture/survey unless the merchant's goal demands it).\n" +
  "- Each direction picks an experience type from the menu and frames the shopper's " +
  "journey differently — make them genuinely DIFFERENT angles, not variations of one.\n" +
  "- Each has a short title, a one-line angle, a one-sentence rationale (why it fits " +
  "THIS brand + goal + what customers struggle with), and 2-3 sample question texts.\n" +
  "- Sample questions must be answerable given the outcome buckets; NO answers, NO tags. " +
  "Never a budget / price-range / how-much-to-spend question — brands don't ask that.\n" +
  "- Lean on the brand summary + voice so copy sounds on-brand from the first read.\n" +
  "- Respond ONLY via the tool call.";

const EXPERIENCE_MENU = [
  "product_match — recommend the right products from the catalog (results required)",
  "personality — a persona reveal + matching products",
  "lead_capture — qualify shoppers, then capture the email (gate is the point)",
  "survey — learn from the audience, no products (answers are the outcome)",
].join("\n  ");

export interface GenerateTemplateOptionsInput {
  brandSummary: string;
  brandVoiceSample?: string;
  goalPrompt: string;
  struggle?: string;
  buckets: Array<{ name: string; tags: string[] }>;
  catalogSummary: string;
}

export async function generateTemplateOptions(
  input: GenerateTemplateOptionsInput,
): Promise<TemplateOptionT[]> {
  const tool = {
    name: "emit_template_options",
    description: "Emit 2-3 distinct quiz directions. The only allowed response.",
    input_schema: TEMPLATE_OPTIONS_TOOL_SCHEMA as unknown as Anthropic.Tool.InputSchema,
  } satisfies Anthropic.Tool;

  const userMessage = [
    "Experience types you may choose from:\n  " + EXPERIENCE_MENU,
    "",
    "Brand summary:",
    input.brandSummary || "(no brand digest — infer from the catalog)",
    ...(input.brandVoiceSample ? ["", "Brand voice:", input.brandVoiceSample] : []),
    "",
    "Merchant's quiz goal:",
    input.goalPrompt || "(none stated)",
    ...(input.struggle ? ["", "What customers struggle with:", input.struggle] : []),
    "",
    "Outcome buckets the quiz routes to:",
    input.buckets.length
      ? input.buckets.map((b) => `- ${b.name}`).join("\n")
      : "- (no buckets — recommend from the whole catalog)",
    "",
    "Catalog summary:",
    input.catalogSummary,
    "",
    "Propose 2-3 distinct directions. Emit via the tool call.",
  ].join("\n");

  let lastIssue: string | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await createMessage({
      model: MODEL,
      max_tokens: 2048,
      system: TEMPLATE_OPTIONS_SYSTEM_PROMPT,
      tools: [tool],
      tool_choice: { type: "tool", name: "emit_template_options" },
      messages: [
        {
          role: "user",
          content:
            attempt === 1
              ? userMessage
              : `${userMessage}\n\nPrevious attempt failed validation: ${lastIssue}. Regenerate strictly matching the schema.`,
        },
      ],
    });

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (!toolUse) {
      lastIssue = "No tool_use block in response.";
      continue;
    }
    const parsed = TemplateOptionsResult.safeParse(toolUse.input);
    if (parsed.success) return parsed.data.options;
    lastIssue = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
  }

  throw new QuizGenerationError(
    "Template options generation failed validation after retries.",
    MAX_ATTEMPTS,
    lastIssue,
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Step 2 — enhanced template creation. Two AI passes: (1) brand-tailored quiz
// TYPE cards (optionally grounded in live web research), (2) rich battle-card
// TEMPLATES for the chosen type. Both clone the forced-tool + retry skeleton.
// ════════════════════════════════════════════════════════════════════════════

// Concat every TextBlock in a response (skips tool_use / server_tool_use blocks).
function extractTextFromResponse(response: Anthropic.Message): string {
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

const WEB_RESEARCH_SYSTEM =
  "You are a quiz-strategy researcher. Search for current best practices for " +
  "product-recommendation quizzes in the given industry. Return a CONCISE summary " +
  "(≤400 words) covering: typical question counts by quiz type, proven quiz formats " +
  "(gift finder, routine builder, type/needs matcher, educational explainer, etc.), " +
  "and conversion-driving patterns. Be specific and cite real examples where you can. " +
  "If you are unable to search, briefly say so and give your best general guidance.";

// The SEPARATE preparatory call. Anthropic's web_search server tool CANNOT be
// combined with a forced tool_choice, so research runs first and its TEXT feeds
// generateQuizTypes. Best-effort: any failure (web search not enabled on the key,
// timeout, error) degrades to "" and generateQuizTypes falls back to model
// knowledge. Runs inside the detached typing job (no edge-window pressure).
export async function runWebResearchForQuizTypes(input: {
  industry: string;
  vertical: string;
  priceTier: string;
  demographic: string[];
}): Promise<string> {
  try {
    const audience = input.demographic.join(", ") || "general shoppers";
    const query =
      `Research best practices for ${input.industry} ${input.vertical} product-recommendation quizzes. ` +
      `Focus on: typical question counts, proven quiz types/formats, and what drives conversion for ` +
      `${input.priceTier} brands targeting ${audience}.`;
    const res = await createMessage({
      model: MODEL,
      max_tokens: 1536,
      system: WEB_RESEARCH_SYSTEM,
      // Server-side web search tool — typed loosely so it survives SDK-version drift;
      // the whole call is best-effort behind try/catch.
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }] as never,
      messages: [{ role: "user", content: query }],
    });
    return extractTextFromResponse(res).slice(0, 4000);
  } catch (err) {
    console.warn(
      "[step2] web research unavailable, degrading to model knowledge:",
      err instanceof Error ? err.message : err,
    );
    return "";
  }
}

// ── Tier 1: brand-tailored quiz TYPE cards ──────────────────────────────────
// QZY-4 — 2-3 types (1-2 product_match + exactly 1 personality; enforced
// post-parse in generateQuizTypes with a retry, degrading to the last valid
// parse rather than failing the funnel).
const QuizTypesResult = z.object({ types: z.array(QuizType).min(2).max(3) });

function quizTypeMixIssue(types: Array<{ experience_type: string }>): string | null {
  const pm = types.filter((t) => t.experience_type === "product_match").length;
  const pers = types.filter((t) => t.experience_type === "personality").length;
  if (pm >= 1 && pm <= 2 && pers === 1) return null;
  return `Wrong archetype mix: got ${pm} product_match + ${pers} personality; need 1-2 product_match and exactly 1 personality.`;
}

const QUIZ_TYPES_TOOL_SCHEMA = {
  type: "object",
  required: ["types"],
  properties: {
    types: {
      type: "array",
      minItems: 3,
      maxItems: 4,
      items: {
        type: "object",
        required: ["id", "experience_type", "name", "achieves", "question_range"],
        properties: {
          id: { type: "string", description: "stable slug, e.g. vitamin-educator" },
          experience_type: {
            type: "string",
            enum: ["product_match", "personality", "lead_capture", "survey"],
          },
          name: { type: "string", description: "display name shown on the card" },
          achieves: { type: "string", description: "one line: what this quiz type achieves" },
          question_range: {
            type: "object",
            required: ["min", "max"],
            properties: { min: { type: "integer" }, max: { type: "integer" } },
          },
          best_practice_note: {
            type: "string",
            description: "a real best-practice note for this category/type",
          },
          rationale: { type: "string", description: "why it fits THIS brand + catalog + goal" },
          web_research_excerpt: {
            type: "string",
            description: "a short supporting snippet from the research (or empty)",
          },
        },
      },
    },
  },
} as const;

const QUIZ_TYPES_SYSTEM_PROMPT =
  "You propose 2-3 DISTINCT quiz TYPES for a Shopify brand, each tailored to the " +
  "brand's positioning AND real-world best practices for the category. Rules:\n" +
  // QZY-4 (owner supplement) — fixed archetype mix, so the two cards read as
  // genuinely different products (a matcher vs a persona reveal).
  "- The set MUST contain 1-2 product_match types and EXACTLY 1 personality type.\n" +
  "- Each type names a concrete format (e.g. Educational Explainer, Gift Finder, " +
  "Routine Builder, Type/Needs Matcher), a one-line 'what it achieves', a question-" +
  "count RANGE informed by the category (educational/wellness run longer, 8-12; " +
  "gifting/style run 4-7), a best-practice note that references a real pattern, a " +
  "rationale tied to THIS brand's catalog + goal, and a short supporting excerpt " +
  "from the web research (empty string if no research was provided).\n" +
  "- Make the types genuinely DIFFERENT strategic choices, not variations of one.\n" +
  "- If no web research is provided, draw on your own knowledge of quiz best " +
  "practices for the industry.\n" +
  "- Respond ONLY via the tool call.";

export interface GenerateQuizTypesInput {
  brandSummary: string;
  brandVoiceSample?: string;
  positioning: { industry: string; vertical: string; price_tier: string; demographic: string[] };
  goalPrompt: string;
  struggle?: string;
  buckets: Array<{ name: string; tags: string[] }>;
  catalogSummary: string;
  webResearchText: string;
  // FAST F4 quality gate — probe-only seam (e2e/fast-sidebyside.mjs) to force
  // a specific model for side-by-side comparison. Production callers never set
  // it; absent → MODEL_SPEED.
  modelOverride?: string;
}

export async function generateQuizTypes(input: GenerateQuizTypesInput): Promise<QuizTypeT[]> {
  const tool = {
    name: "emit_quiz_types",
    description:
      "Emit 2-3 distinct, brand-tailored quiz types (1-2 product_match + exactly 1 personality). The only allowed response.",
    input_schema: QUIZ_TYPES_TOOL_SCHEMA as unknown as Anthropic.Tool.InputSchema,
  } satisfies Anthropic.Tool;

  const userMessage = [
    "Experience types you may choose from:\n  " + EXPERIENCE_MENU,
    "",
    "Brand summary:",
    input.brandSummary || "(no brand digest — infer from the catalog)",
    ...(input.brandVoiceSample ? ["", "Brand voice:", input.brandVoiceSample] : []),
    "",
    "Positioning:",
    `industry: ${input.positioning.industry || "(unknown)"} · vertical: ${input.positioning.vertical || "(unknown)"} · price tier: ${input.positioning.price_tier || "(unknown)"} · audience: ${input.positioning.demographic.join(", ") || "(unknown)"}`,
    "",
    "Merchant's quiz goal:",
    input.goalPrompt || "(none stated)",
    ...(input.struggle ? ["", "What customers struggle with:", input.struggle] : []),
    "",
    "Outcome buckets the quiz routes to:",
    input.buckets.length
      ? input.buckets.map((b) => `- ${b.name}`).join("\n")
      : "- (no buckets — recommend from the whole catalog)",
    "",
    "Catalog summary:",
    input.catalogSummary,
    "",
    "Web research (best practices for this category):",
    input.webResearchText || "(no research available — use your own knowledge)",
    "",
    "Propose 2-3 distinct, tailored quiz types: 1-2 product_match + exactly 1 personality. Emit via the tool call.",
  ].join("\n");

  let lastIssue: string | undefined;
  let lastValidTypes: QuizTypeT[] | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await createMessage({
      model: input.modelOverride ?? MODEL_SPEED,
      max_tokens: 2048,
      system: QUIZ_TYPES_SYSTEM_PROMPT,
      tools: [tool],
      tool_choice: { type: "tool", name: "emit_quiz_types" },
      messages: [
        {
          role: "user",
          content:
            attempt === 1
              ? userMessage
              : `${userMessage}\n\nPrevious attempt failed validation: ${lastIssue}. Regenerate strictly matching the schema.`,
        },
      ],
    });

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (!toolUse) {
      lastIssue = "No tool_use block in response.";
      continue;
    }
    const parsed = QuizTypesResult.safeParse(toolUse.input);
    if (parsed.success) {
      const mixIssue = quizTypeMixIssue(parsed.data.types);
      if (!mixIssue) return parsed.data.types;
      lastValidTypes = parsed.data.types; // degraded-but-usable if retries run out
      lastIssue = mixIssue;
      continue;
    }
    lastIssue = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
  }

  // QZY-4 — a wrong archetype MIX with an otherwise-valid parse degrades to
  // that parse rather than stranding the funnel (the mix is a preference,
  // schema validity is the contract).
  if (lastValidTypes) return lastValidTypes;

  throw new QuizGenerationError(
    "Quiz types generation failed validation after retries.",
    MAX_ATTEMPTS,
    lastIssue,
  );
}

// ── Tier 2: rich battle-card TEMPLATES for the chosen type ───────────────────
const RichTemplatesResult = z.object({ templates: z.array(RichTemplateOption).min(2).max(3) });

const RICH_TEMPLATES_TOOL_SCHEMA = {
  type: "object",
  required: ["templates"],
  properties: {
    templates: {
      type: "array",
      minItems: 2,
      maxItems: 3,
      items: {
        type: "object",
        required: [
          "id",
          "experience_type",
          "title",
          "angle",
          "sample_questions",
          "feature_notes",
          "dials",
          "rec_defaults",
          "question_count",
        ],
        properties: {
          id: { type: "string", description: "stable slug" },
          experience_type: {
            type: "string",
            enum: ["product_match", "personality", "lead_capture", "survey"],
          },
          title: { type: "string", description: "the template name on the battle card" },
          angle: { type: "string", description: "one line: how this template frames the journey" },
          rationale: { type: "string" },
          sample_questions: {
            type: "array",
            minItems: 2,
            maxItems: 3,
            items: { type: "string" },
          },
          feature_notes: {
            type: "array",
            minItems: 1,
            maxItems: 3,
            items: { type: "string" },
            description: "the 3 unique feature notes shown on the battle card",
          },
          dials: {
            type: "object",
            required: ["imagery", "graphics", "word_forward", "lines"],
            properties: {
              imagery: { type: "string", enum: ["high", "medium", "low"] },
              graphics: { type: "string", enum: ["high", "medium", "low"] },
              word_forward: { type: "string", enum: ["high", "medium", "low"] },
              lines: { type: "string", enum: ["soft", "sharp", "rounded"] },
            },
          },
          rec_defaults: {
            type: "object",
            required: ["max_products", "oos_behavior"],
            properties: {
              max_products: { type: "integer", minimum: 1, maximum: 12 },
              oos_behavior: { type: "string", enum: ["hide", "show_with_badge", "fallback"] },
            },
          },
          recommended_bucket_ids: { type: "array", items: { type: "string" } },
          question_count: { type: "integer", minimum: 3, maximum: 20 },
        },
      },
    },
  },
} as const;

const RICH_TEMPLATES_SYSTEM_PROMPT =
  "You generate 2-3 DISTINCT template configurations for a chosen quiz type — each " +
  "a full 'battle card'. Rules:\n" +
  "- Each template: a title, a one-line angle, a rationale, 2-3 sample question " +
  "texts (never budget / price-range questions — brands don't ask that), exactly 3 feature_notes that distinguish THIS template (e.g. 'Opens with " +
  "a visual mood question'), design dials (imagery/graphics/word_forward high|medium|" +
  "low and lines soft|sharp|rounded) that genuinely match the template's style, a " +
  "recommended max_products + oos_behavior, optional recommended_bucket_ids (the " +
  "most relevant bucket ids), and a question_count within the type's range.\n" +
  "- Make the templates genuinely different implementations of the SAME type — vary " +
  "the opening, the dial settings, and the emphasis.\n" +
  "- Set the dials to match the brand: an educational brand leans word_forward high; " +
  "a visual brand leans imagery high; a refined brand leans lines sharp.\n" +
  "- Respond ONLY via the tool call.";

export interface GenerateQuizTemplatesInput {
  chosenType: QuizTypeT;
  brandSummary: string;
  brandVoiceSample?: string;
  positioning: { industry: string; vertical: string; price_tier: string };
  goalPrompt: string;
  struggle?: string;
  buckets: Array<{ id: string; name: string; tags: string[] }>;
  catalogSummary: string;
  brandGuidelines?: BrandGuidelines | null;
  // FAST F4 quality gate — probe-only model override (see GenerateQuizTypesInput).
  modelOverride?: string;
}

export async function generateQuizTemplates(
  input: GenerateQuizTemplatesInput,
): Promise<RichTemplateOptionT[]> {
  const tool = {
    name: "emit_quiz_templates",
    description: "Emit 2-3 distinct battle-card templates for the chosen type. The only allowed response.",
    input_schema: RICH_TEMPLATES_TOOL_SCHEMA as unknown as Anthropic.Tool.InputSchema,
  } satisfies Anthropic.Tool;

  const system = input.brandGuidelines
    ? RICH_TEMPLATES_SYSTEM_PROMPT + buildBrandVoiceAddition(input.brandGuidelines)
    : RICH_TEMPLATES_SYSTEM_PROMPT;

  const t = input.chosenType;
  const userMessage = [
    "Chosen quiz type:",
    `${t.name} (${t.experience_type}) — ${t.achieves}`,
    `question range: ${t.question_range.min}-${t.question_range.max}${t.best_practice_note ? ` · best practice: ${t.best_practice_note}` : ""}`,
    "",
    "Brand summary:",
    input.brandSummary || "(no brand digest — infer from the catalog)",
    ...(input.brandVoiceSample ? ["", "Brand voice:", input.brandVoiceSample] : []),
    "",
    "Positioning:",
    `industry: ${input.positioning.industry || "(unknown)"} · vertical: ${input.positioning.vertical || "(unknown)"} · price tier: ${input.positioning.price_tier || "(unknown)"}`,
    "",
    "Merchant's quiz goal:",
    input.goalPrompt || "(none stated)",
    ...(input.struggle ? ["", "What customers struggle with:", input.struggle] : []),
    "",
    "Outcome buckets (id — name):",
    input.buckets.length
      ? input.buckets.map((b) => `- ${b.id} — ${b.name}`).join("\n")
      : "- (no buckets — recommend from the whole catalog)",
    "",
    "Catalog summary:",
    input.catalogSummary,
    "",
    `Generate 2-3 distinct templates for the "${t.name}" type. Emit via the tool call.`,
  ].join("\n");

  let lastIssue: string | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await createMessage({
      model: input.modelOverride ?? MODEL_SPEED,
      max_tokens: 3072,
      system,
      tools: [tool],
      tool_choice: { type: "tool", name: "emit_quiz_templates" },
      messages: [
        {
          role: "user",
          content:
            attempt === 1
              ? userMessage
              : `${userMessage}\n\nPrevious attempt failed validation: ${lastIssue}. Regenerate strictly matching the schema.`,
        },
      ],
    });

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (!toolUse) {
      lastIssue = "No tool_use block in response.";
      continue;
    }
    const parsed = RichTemplatesResult.safeParse(toolUse.input);
    if (parsed.success) return parsed.data.templates;
    lastIssue = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
  }

  throw new QuizGenerationError(
    "Quiz templates generation failed validation after retries.",
    MAX_ATTEMPTS,
    lastIssue,
  );
}
