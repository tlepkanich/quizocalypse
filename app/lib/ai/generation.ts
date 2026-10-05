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
import { clampQuestionsTo } from "../questionCountClamp";
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

// AUDIT-21 — the strategy build-rules (docs/design/strategy/quiz-templates/
// build-rules.json, Tier-A survey-methodology rules) folded onto the two
// AUTHORING prompts (flow build + single-question regenerate). Content-quality
// steering only: the tool schemas, Zod parsing, and retries are untouched, and
// the merchant-directed edit-ops prompt deliberately excludes these (an
// explicit merchant request wins over authoring defaults). Exported for the
// prompt-inclusion test.
export const QUESTION_WRITING_RULES =
  "\nQUESTION-WRITING RULES (always apply): one concept per question — never " +
  "double-barreled (\"lightweight AND durable\" is two questions). Use neutral " +
  "wording that describes the shopper's need — never leading, loaded, or " +
  "marketing copy (\"our best-selling premium X\"). Answer options must be " +
  "mutually exclusive and collectively exhaustive: no overlapping numeric " +
  "ranges, and include an \"Other\" / \"Not sure\" escape option when the set " +
  "can't cover everyone. Single-select questions: at most 7 options, 5 or " +
  "fewer preferred — use a searchable or dropdown type for longer lists. " +
  "Multi-select questions: keep the list to ~6 options and set " +
  "max_selections. Order easy, concrete questions first; personal or " +
  "sensitive ones late; never place two high-effort questions (long " +
  "multi-selects) back to back." +
  // FIX-1 — copy standards (anti-slop). The owner's complaint: generated
  // questions kept arriving with emoji and hype framing. These bind the two
  // AUTHORING prompts only — the merchant-directed edit prompt deliberately
  // excludes them (an explicit "add emojis" request must still comply).
  "\nCOPY STANDARDS (always apply): NEVER use emoji or decorative pictographs " +
  "anywhere — not in question text, not in answer options, not in helper or " +
  "welcome copy. No exclamation-mark enthusiasm and no hype framing " +
  "(\"Let's find your perfect match! 🎉\" is banned on both counts) — write " +
  "plain, confident, declarative copy. Use sentence case for questions and " +
  "answers: capitalize only the first word and proper nouns, never Title Case. " +
  "Skip filler superlatives (\"amazing\", \"perfect\", \"incredible\") — say " +
  "what the thing is." +
  // GEN-COPY (owner 2026-08-16) — the owner's complaint: answer options kept
  // arriving as "Label — explanation" em-dash glosses. Same seam as FIX-1:
  // binds the two AUTHORING prompts only.
  "\nANSWER FORMAT (always apply): answer options are short, self-contained " +
  "phrases. NEVER the \"Label — explanation\" em-dash gloss (\"Oily — shiny by " +
  "midday, enlarged pores\" is banned): say the observable thing itself " +
  "(\"Shiny by midday\") or move the clarifier into helper_text. Never use an " +
  "em dash inside an answer option; keep em dashes rare in question copy too.";

// FIX-1 — deterministic anti-slop backstop at the generation PARSE boundary.
// Strips emoji / pictograph sequences (ZWJ chains, variation selectors, skin
// tones, flags, keycaps) from AI-authored question + answer text, keeping
// legitimate symbols (& % $ ° – — © ® ™) and all letters (accents, CJK).
// Applied ONLY where AI output is parsed (regenerateQuestion +
// generateQuestionFlow below) — merchant-typed text and existing docs are
// never touched.
const EMOJI_SEQUENCE_RE =
  // pictograph (opt. variation selector FE0E/FE0F) + any ZWJ(200D)-joined
  // continuations | regional-indicator pair (flags) | keycap sequences
  /\p{Extended_Pictographic}[\uFE0E\uFE0F]?(?:\u200D\p{Extended_Pictographic}[\uFE0E\uFE0F]?)*|[\u{1F1E6}-\u{1F1FF}]{2}|[0-9#*]\uFE0F?\u20E3/gu;
// Stray skin-tone modifiers, ZWJs, variation selectors, and keycap combiners
// left behind by partial sequences.
const EMOJI_RESIDUE_RE = /[\u{1F3FB}-\u{1F3FF}\u200D\uFE0E\uFE0F\u20E3]/gu;
const KEEP_PICTOGRAPHS = new Set(["©", "®", "™"]);

export function stripEmoji(text: string): string {
  const cleaned = text
    .replace(EMOJI_SEQUENCE_RE, (m) => (KEEP_PICTOGRAPHS.has(m.charAt(0)) ? m.charAt(0) : ""))
    .replace(EMOJI_RESIDUE_RE, "")
    .replace(/ {2,}/g, " ")
    .trim();
  // An all-emoji string must not collapse to "" (blank buttons are worse than
  // slop) — keep the original in that degenerate case.
  return cleaned.length > 0 ? cleaned : text;
}

// GEN-COPY (owner 2026-08-16) — deterministic backstop for the ANSWER FORMAT
// rule: answer options never carry an em dash (the "Label — explanation"
// gloss). Applied to ANSWER text only at the same parse boundaries as
// stripEmoji — question copy may legitimately use one, and en dashes
// (ranges like 10–20) are untouched.
export function stripAnswerEmDash(text: string): string {
  if (!text.includes("—")) return text;
  const cleaned = text
    .replace(/\s*—\s*/g, ", ")
    .replace(/,\s*,/g, ", ")
    .replace(/^[,\s]+/, "")
    .replace(/[,\s]+$/, "")
    .replace(/ {2,}/g, " ");
  return cleaned.length > 0 ? cleaned : text;
}

const REGEN_SYSTEM_PROMPT =
  "You are regenerating ONE question in an existing Shopify product quiz. " +
  "Use the catalog summary for tag accuracy — only use tags that exist in the " +
  "supplied catalog. Keep the question useful for product targeting. The " +
  "downstream system will preserve answer IDs where possible by order — keep " +
  "the answer count similar to the original so edge connections survive." +
  BANNED_QUESTION_GUIDANCE +
  QUESTION_WRITING_RULES;

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
        // FIX-1 — deterministic anti-slop pass on the AI-authored copy only.
        text: stripEmoji(parsed.data.text),
        question_type: parsed.data.question_type,
        required: parsed.data.required ?? true,
        ...(parsed.data.max_selections !== undefined
          ? { max_selections: parsed.data.max_selections }
          : {}),
        answers: parsed.data.answers.map((a) => ({
          text: stripAnswerEmDash(stripEmoji(a.text)),
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
  BANNED_QUESTION_GUIDANCE +
  QUESTION_WRITING_RULES;

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
          // Logic-step handoff §5 — the model can now mark a question as
          // NARROWING; before this field existed no code path ever wrote
          // role "filter", so every AI-built quiz arrived role-less.
          role: {
            type: "string",
            enum: ["decides", "narrows", "info"],
            description:
              "What the question does to the product pool: 'decides' picks the outcome (exactly one per quiz), 'narrows' cuts the pool by a real catalog attribute (its answers carry accurate catalog values), 'info' only collects the answer.",
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
        role: z.enum(["decides", "narrows", "info"]).optional(),
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
  // HOME-3 (first-run handoff §10.1) — the merchant pinned the count (Home's
  // Questions picker). The tool schema, the prompt and a retry all ask for
  // EXACTLY this many; a final overshoot is trimmed (clampQuestionsTo).
  // Absent → "Target question count" stays a hint, byte-identical to before.
  exactQuestionCount?: number;
  // OVERLAP — PLANNED build only: the plan step picks the count itself, by
  // category norm (the build's plan now starts before the direction pass
  // that used to pick it has finished). Ignored when exactQuestionCount is
  // set, and by the single-call generator.
  chooseQuestionCount?: boolean;
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
    "\nLOGIC MODEL: ONE-DECIDER. Exactly ONE question (prefer an early one) decides " +
    "the outcome — single_select, roughly one answer per bucket, each answer's tags " +
    "matching that bucket's routing tags so it maps 1:1 to a bucket. Phrase the " +
    "deciding question DIAGNOSTICALLY: probe a concrete behavior, feeling, or " +
    "situation the shopper can observe (\"How does your skin feel a few hours after " +
    "cleansing?\"), never a self-classification that recites the bucket names " +
    "(\"How would you describe your skin?\"). Each answer describes the observable " +
    "experience and still maps cleanly to exactly one bucket. Mark it role \"decides\". " +
    // Logic-step handoff §5 — the old "keep qualifier answers' tags light"
    // instruction actively worked against narrowing; narrowing answers want
    // ACCURATE catalog values, not light tags.
    "Every OTHER question is either NARROWING (role \"narrows\") or INFO (role \"info\"). " +
    "A narrowing question cuts the product pool on ONE real catalog attribute " +
    "(a tag family, metafield, variant option like size or color, or product type): " +
    "each of its answers carries the accurate catalog value(s) it matches, taken " +
    "from the supplied catalog summary — never invented, never deliberately light. " +
    "Prefer 1-2 narrowing questions when the catalog has attributes that split it. " +
    "An info question only collects the answer: empty tags [], role \"info\". " +
    "Do NOT include email_gate copy: the results page has its own capture screen."
  );
}

// Generate the question flow (questions only — no nodes/edges/ids) for a quiz
// whose intro + bucket result pages already exist. The deterministic merge in
// app/lib/smartBuild.ts wires the nodes/edges/branch.
export async function generateQuestionFlow(
  input: GenerateQuestionFlowInput,
): Promise<GeneratedQuestionFlow> {
  const exact = input.exactQuestionCount;
  const tool = {
    name: "emit_question_flow",
    description:
      "Emit the quiz's questions (and optional welcome/email copy). No intro/result/branch nodes.",
    input_schema: (exact
      ? {
          ...questionFlowToolJsonSchema,
          properties: {
            ...questionFlowToolJsonSchema.properties,
            questions: {
              ...questionFlowToolJsonSchema.properties.questions,
              minItems: exact,
              maxItems: exact,
            },
          },
        }
      : questionFlowToolJsonSchema) as unknown as Anthropic.Tool.InputSchema,
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
    exact
      ? `Question count: EXACTLY ${exact} questions — no more, no fewer. The merchant chose this number.`
      : `Target question count: ${input.questionCount}.`,
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
    // A pinned count that misses is a validation failure while retries remain.
    if (parsed.success && exact && parsed.data.questions.length !== exact && attempt < MAX_ATTEMPTS) {
      lastIssue = `Expected exactly ${exact} questions, got ${parsed.data.questions.length}`;
      continue;
    }
    if (parsed.success) {
      // Last resort: trim an overshoot, never cutting the deciding question.
      const questions = exact
        ? clampQuestionsTo(parsed.data.questions, exact)
        : parsed.data.questions;
      return {
        questions: questions.map((q) => ({
          // FIX-1 — deterministic anti-slop pass on the AI-authored copy only.
          text: stripEmoji(q.text),
          question_type: q.question_type,
          // Logic-step §5 role + E3 chapter/reassurance copy: parsed and
          // prompted for since those programs, but this mapping used to drop
          // them, so built quizzes never received any. Absent stays absent.
          ...(q.role ? { role: q.role } : {}),
          ...(q.section_label?.trim() ? { section_label: stripEmoji(q.section_label) } : {}),
          ...(q.helper_text?.trim() ? { helper_text: stripEmoji(q.helper_text) } : {}),
          ...(q.required !== undefined ? { required: q.required } : {}),
          ...(q.max_selections !== undefined ? { max_selections: q.max_selections } : {}),
          ...(q.education_card_before ? { education_card_before: q.education_card_before } : {}),
          answers: q.answers.map((a) => ({
            text: stripAnswerEmDash(stripEmoji(a.text)),
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

// ── QBUILD-FAST: the decider question build as PLAN → parallel WRITES ────────
// generateQuestionFlow (above) writes the whole quiz in ONE Sonnet response:
// ~1,400 output tokens ≈ 20 s, output-bound. The planned build keeps every
// word on the same model (the owner's keep-Sonnet decision) and cuts the WALL
// time instead:
//   1. generateQuestionPlan  — a short outline, one line per question (working
//      text, input type, role, chapter).
//   2. writePlannedQuestions — the outline's questions written IN PARALLEL.
//      Every call sees the whole plan (so concepts never overlap) and writes
//      only its own slice: wall time is the slowest slice, not the sum.
// Both steps send ONE byte-identical request prefix — both tools, the system
// rules, and the quiz context as a cached system block — so the plan call
// writes the prompt cache and every write call reads it. N parallel calls then
// cost ~0.1× the shared input each instead of N× the full prompt. (tool_choice
// differs per step; it does not invalidate the tools + system cache.)
//
// Roles and chapter labels come from the PLAN, deterministically — one author
// for the quiz's structure. Decider builds only (onboardingBuild.server.ts
// gates it); the single-call generator stays the legacy path and the fallback.

// At most this many write calls run at once; a longer plan is cut into
// equal slices of consecutive questions.
const MAX_PARALLEL_QUESTION_WRITES = 8;

const PLAN_QUESTION_TYPES = [
  "single_select",
  "multi_select",
  "image_tile",
  "searchable",
  "image_picker",
] as const;

const QuestionPlanSchema = z.object({
  questions: z
    .array(
      z.object({
        text: z.string().min(1),
        question_type: QuestionDataObject.shape.question_type,
        role: z.enum(["decides", "narrows", "info"]),
        section_label: z.string().max(40).optional(),
        needs_explainer: z.boolean().optional(),
        needs_helper: z.boolean().optional(),
        answer_outline: z.array(z.string()).optional(),
      }),
    )
    .min(1),
});
export type QuestionPlan = z.infer<typeof QuestionPlanSchema>["questions"];

const WrittenQuestionsSchema = z.object({
  questions: z
    .array(
      z.object({
        text: z.string().min(1),
        question_type: QuestionDataObject.shape.question_type,
        required: z.boolean().optional(),
        max_selections: z.number().int().positive().optional(),
        education_card_before: z.string().optional(),
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
});

// BOTH tools ride EVERY planned request, in this order — the tool list is the
// head of the cached prefix, so it must never vary between the two steps.
const PLANNED_BUILD_TOOLS = [
  {
    name: "emit_question_plan",
    description: "Step 1. Emit the outline of every question in the quiz, in order. No answers.",
    input_schema: {
      type: "object",
      required: ["questions"],
      properties: {
        questions: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            required: ["text", "question_type", "role"],
            properties: {
              text: { type: "string", description: "The question's working text — one concept." },
              question_type: { type: "string", enum: PLAN_QUESTION_TYPES },
              role: {
                type: "string",
                enum: ["decides", "narrows", "info"],
                description:
                  "What the question does to the product pool: 'decides' picks the outcome (exactly one per quiz), 'narrows' cuts the pool by a real catalog attribute, 'info' only collects the answer.",
              },
              section_label: {
                type: "string",
                description: "Optional chapter label (≤40 chars). Consecutive questions share one; ≤3 distinct labels.",
              },
              needs_explainer: {
                type: "boolean",
                description:
                  "true on AT MOST ONE question: shoppers need a concept explained before they can answer it well.",
              },
              needs_helper: {
                type: "boolean",
                description:
                  "true on AT MOST TWO questions: shoppers might overthink this one, so it gets a one-line reassurance.",
              },
              answer_outline: {
                type: "array",
                items: { type: "string" },
                description:
                  "The DECIDING question only: its answer options, a few words each, roughly one per outcome bucket — proof that this question can route a shopper to every bucket.",
              },
            },
          },
        },
      },
    },
  },
  {
    name: "emit_questions",
    description: "Step 2. Emit the requested question(s) of the plan, written in full with answers.",
    input_schema: {
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
              question_type: { type: "string", enum: PLAN_QUESTION_TYPES },
              required: { type: "boolean" },
              max_selections: { type: "number" },
              education_card_before: { type: "string" },
              helper_text: {
                type: "string",
                description: "Optional one-line reassurance under the question (≤160 chars).",
              },
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
      },
    },
  },
] as const;

const PLANNED_BUILD_ADDENDUM =
  "\nTWO-STEP BUILD: this quiz is built in two steps, and each request names its " +
  "step. Step 1 (emit_question_plan) outlines every question of the quiz. Step 2 " +
  "(emit_questions) writes ONLY the questions the request names, in full. The quiz " +
  "context below is the same for both steps.";

// The request prefix both steps share. `context` carries everything the
// single-call build's user message carries about THIS quiz — and nothing that
// differs between the steps.
function plannedBuildPrefix(input: GenerateQuestionFlowInput): {
  system: Anthropic.TextBlockParam[];
  tools: Anthropic.Tool[];
} {
  const exact = input.exactQuestionCount;
  const context = [
    "QUIZ CONTEXT",
    `Tone: ${input.tone}.`,
    exact
      ? `Question count: EXACTLY ${exact} questions — no more, no fewer. The merchant chose this number.`
      : input.chooseQuestionCount
        ? "Question count: choose it by category norm — 5 to 7 questions for most catalogs, up to 9 where shoppers need more guidance before they can choose (wellness, skincare routines, nutrition)."
        : `Target question count: ${input.questionCount}.`,
    "Merchant's quiz goal (verbatim):",
    input.goalPrompt || "(none — infer from the catalog + buckets)",
    "",
    "Outcome buckets the shopper must be routed to (use these tags so answers map to them):",
    ...input.buckets.map((b) => `- ${b.name} [routing tags: ${b.tags.join(", ") || "(none)"}]`),
    "",
    "Catalog summary (only use tags that appear here):",
    input.catalogSummary,
    ...(input.toneSample
      ? ["", "Brand voice sample — match this writing style:", input.toneSample]
      : []),
    ...(input.websiteText
      ? ["", "Brand website content (use for on-brand language, mission, FAQ patterns):", input.websiteText]
      : []),
    ...(input.flow.mixed_input_types
      ? [
          "",
          "Flow requirement: use a mix of input styles — include at least one image_picker or searchable question alongside single/multi-select.",
        ]
      : []),
  ].join("\n");
  const system = [
    {
      type: "text",
      text:
        QUESTION_FLOW_SYSTEM_PROMPT +
        experienceAddendum(input.experienceType) +
        deciderAddendum(input.logicModel) +
        buildBrandVoiceAddition(input.brandGuidelines) +
        PLANNED_BUILD_ADDENDUM,
    },
    // The cache breakpoint: tools + both system blocks are the shared prefix.
    { type: "text", text: context, cache_control: { type: "ephemeral" } },
  ];
  return {
    // cache_control postdates this SDK version's param types; the API takes it.
    system: system as unknown as Anthropic.TextBlockParam[],
    tools: PLANNED_BUILD_TOOLS as unknown as Anthropic.Tool[],
  };
}

function validationIssue(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".")}: ${i.message}`)
    .join("; ");
}

const PLAN_TASK =
  "STEP 1 — PLAN. Outline the whole quiz, in the order shoppers answer it. For each " +
  "question give its working text, input type, role, and an optional section_label " +
  "(≤3 distinct labels across the quiz, consecutive questions share one — e.g. " +
  "\"Skin profile\", \"Your preferences\"). Every question covers a DIFFERENT concept: " +
  "no two questions may ask about the same thing in different words. Exactly ONE " +
  "question has role decides — phrased DIAGNOSTICALLY, as the one-decider rule " +
  "above requires: a concrete behavior, feeling, or situation the shopper can " +
  "observe, never \"what are you shopping for\" or any other self-classification " +
  "that recites the bucket names. Give the deciding question its answer_outline, so " +
  "the question you choose is one whose answers reach every bucket. At most TWO " +
  "questions have role narrows, and only " +
  "where the catalog summary shows a real attribute that splits the products; every " +
  "other question has role info. Set needs_explainer true on at most one question, " +
  "and only where shoppers need an unfamiliar material, spec, fit, or term explained " +
  "before they can answer. Set needs_helper true on at most two questions where " +
  "shoppers might overthink. No answers yet. Emit via emit_question_plan.";

// Step 1 — the outline. A pinned count that misses is a validation failure
// while retries remain; the final attempt trims an overshoot (never the
// deciding question) and keeps a short plan as-is, the single-call rule.
export async function generateQuestionPlan(
  input: GenerateQuestionFlowInput,
): Promise<QuestionPlan> {
  const prefix = plannedBuildPrefix(input);
  const exact = input.exactQuestionCount;
  let lastIssue: string | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await createMessage({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: prefix.system,
      tools: prefix.tools,
      tool_choice: { type: "tool", name: "emit_question_plan" },
      messages: [
        {
          role: "user",
          content:
            attempt === 1
              ? PLAN_TASK
              : `${PLAN_TASK}\n\nPrevious attempt failed validation: ${lastIssue}. Regenerate strictly matching the schema.`,
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
    const parsed = QuestionPlanSchema.safeParse(toolUse.input);
    if (!parsed.success) {
      lastIssue = validationIssue(parsed.error);
      continue;
    }
    const planned = parsed.data.questions;
    if (exact && planned.length !== exact && attempt < MAX_ATTEMPTS) {
      lastIssue = `Expected exactly ${exact} questions, got ${planned.length}`;
      continue;
    }
    return exact ? clampQuestionsTo(planned, exact) : planned;
  }
  throw new QuizGenerationError(
    "Question plan generation failed validation after retries.",
    MAX_ATTEMPTS,
    lastIssue,
  );
}

function planLine(q: QuestionPlan[number], index: number): string {
  const chapter = q.section_label?.trim() ? ` · chapter "${q.section_label.trim()}"` : "";
  return `${index + 1}. [${q.role} · ${q.question_type}${chapter}] ${q.text}`;
}

// Consecutive-question slices, at most MAX_PARALLEL_QUESTION_WRITES of them.
function planSlices(count: number): number[][] {
  const size = Math.ceil(count / MAX_PARALLEL_QUESTION_WRITES);
  const slices: number[][] = [];
  for (let start = 0; start < count; start += size) {
    slices.push(
      Array.from({ length: Math.min(size, count - start) }, (_, offset) => start + offset),
    );
  }
  return slices;
}

type WrittenQuestion = z.infer<typeof WrittenQuestionsSchema>["questions"][number];

// An AI-written image_url is kept only when it is a real absolute http(s)
// URL. The writer has no image URLs to draw on, and a placeholder
// ("<UNKNOWN>", seen live when the IMAGERY HIGH directive asks for answer
// images) fails the doc schema — which would cost the merchant the WHOLE
// build over one optional field.
function realImageUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:" ? url : undefined;
  } catch {
    return undefined;
  }
}

// What the plan decided for ONE question, restated for the call that writes
// it. A write call sees one slice in isolation, so the quiz-wide budgets (one
// explainer card, a couple of reassurance lines) are the plan's to hand out.
function sliceRules(q: QuestionPlan[number], n: number): string[] {
  const role =
    q.role === "decides"
      ? `#${n} is the DECIDING question: write roughly one answer per outcome bucket, each answer's tags matching ONE bucket's routing tags, so every bucket is reachable from this question. Each answer describes what the shopper observes or does — never the bucket's name.` +
        (q.answer_outline?.length
          ? ` Its planned answers, to refine: ${q.answer_outline.join(" | ")}.`
          : "")
      : q.role === "narrows"
        ? `#${n} NARROWS the product pool: each answer carries the accurate catalog value(s) it matches, taken from the catalog summary.`
        : `#${n} is an INFO question: its answers carry empty tags [].`;
  return [
    role,
    q.needs_explainer
      ? `#${n} needs a concept explained first: give it ONE education_card_before, one short plain-language sentence.`
      : `#${n} gets no education_card_before.`,
    q.needs_helper
      ? `#${n} gets a one-line helper_text reassurance, written for this question.`
      : `#${n} gets no helper_text.`,
  ];
}

// One write call: the questions at `indexes`, in plan order. A wrong count is
// a validation failure while retries remain; the final attempt keeps the
// first `indexes.length` of an overshoot and fails on a short result (a
// missing question cannot be invented).
async function writePlanSlice(
  prefix: ReturnType<typeof plannedBuildPrefix>,
  plan: QuestionPlan,
  indexes: number[],
  guidance: string | undefined,
): Promise<WrittenQuestion[]> {
  const numbers = indexes.map((i) => `#${i + 1}`).join(" and ");
  const task = [
    "STEP 2 — WRITE. The quiz plan, in order:",
    ...plan.map(planLine),
    "",
    `Write ONLY question ${numbers} of this plan, in full: the final question text, its input type, and its answers with tags. Keep each question's planned concept and role; refine the wording. The other questions are written separately — do not cover their concepts, and do not repeat their answer sets.`,
    "Never invent an image_url or a placeholder for one: give an answer an image_url only when the catalog summary shows that exact URL.",
    ...indexes.flatMap((i) => sliceRules(plan[i]!, i + 1)),
    ...(guidance
      ? ["", "Style guidance for this quiz — honor it where natural; the per-question rules above win:", guidance, ""]
      : []),
    `Emit exactly ${indexes.length} question${indexes.length === 1 ? "" : "s"} via emit_questions, in plan order.`,
  ].join("\n");

  let lastIssue: string | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await createMessage({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: prefix.system,
      tools: prefix.tools,
      tool_choice: { type: "tool", name: "emit_questions" },
      messages: [
        {
          role: "user",
          content:
            attempt === 1
              ? task
              : `${task}\n\nPrevious attempt failed validation: ${lastIssue}. Regenerate strictly matching the schema.`,
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
    const parsed = WrittenQuestionsSchema.safeParse(toolUse.input);
    if (!parsed.success) {
      lastIssue = validationIssue(parsed.error);
      continue;
    }
    const written = parsed.data.questions;
    if (written.length === indexes.length) return written;
    if (written.length > indexes.length && attempt === MAX_ATTEMPTS) {
      return written.slice(0, indexes.length);
    }
    lastIssue = `Expected exactly ${indexes.length} question(s), got ${written.length}`;
  }
  throw new QuizGenerationError(
    "Planned question write failed validation after retries.",
    MAX_ATTEMPTS,
    lastIssue,
  );
}

// Step 2 — every slice of the plan, written concurrently and merged in plan
// order. One failed slice fails the build (the caller falls back to the
// single-call generator); the same deterministic copy passes run here as
// there. Emits questions only — never welcome / email-gate copy, so the
// caller takes this path only when the flow needs neither.
//
// `input` MUST be the input the plan was generated from: it is the cached
// prefix the write calls read. `guidance` is for context that arrived AFTER
// the plan (OVERLAP — the direction pass's angle and style directives, when
// the plan ran concurrently with it); it rides each call's own message, so it
// never touches the cache.
export async function writePlannedQuestions(
  input: GenerateQuestionFlowInput,
  plan: QuestionPlan,
  guidance?: string,
): Promise<GeneratedQuestionFlow> {
  const prefix = plannedBuildPrefix(input);
  const slices = planSlices(plan.length);
  const written = (
    await Promise.all(slices.map((indexes) => writePlanSlice(prefix, plan, indexes, guidance)))
  ).flat();
  return {
    questions: written.map((q, i) => {
      const planned = plan[i]!;
      return {
        // FIX-1 — deterministic anti-slop pass on the AI-authored copy only.
        text: stripEmoji(q.text),
        question_type: q.question_type,
        role: planned.role,
        ...(planned.section_label?.trim()
          ? { section_label: stripEmoji(planned.section_label) }
          : {}),
        // Only the questions the plan marked carry a reassurance line or the
        // explainer card.
        ...(planned.needs_helper && q.helper_text?.trim()
          ? { helper_text: stripEmoji(q.helper_text) }
          : {}),
        ...(q.required !== undefined ? { required: q.required } : {}),
        ...(q.max_selections !== undefined ? { max_selections: q.max_selections } : {}),
        ...(planned.needs_explainer && q.education_card_before
          ? { education_card_before: q.education_card_before }
          : {}),
        answers: q.answers.map((a) => ({
          text: stripAnswerEmDash(stripEmoji(a.text)),
          tags: a.tags,
          ...(a.collection_filter ? { collection_filter: a.collection_filter } : {}),
          ...(realImageUrl(a.image_url) ? { image_url: a.image_url } : {}),
        })),
      };
    }),
  };
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
  // GEN-GROUND — the quiz's own context, when the caller has it. The research
  // then targets the products THIS quiz routes to, not just the brand's
  // positioning (a multi-category store's positioning can describe a different
  // product line than the one the merchant picked).
  quizGoal?: string;
  bucketNames?: string[];
}): Promise<string> {
  try {
    const audience = input.demographic.join(", ") || "general shoppers";
    const focusLine =
      input.bucketNames?.length || input.quizGoal
        ? ` This specific quiz recommends from: ${(input.bucketNames ?? []).join(", ") || "(see goal)"}.` +
          (input.quizGoal ? ` Its goal: ${input.quizGoal.slice(0, 300)}.` : "") +
          " Research quiz practices for THESE products' category, not other categories the brand may also sell."
        : "";
    const query =
      `Research best practices for ${input.industry} ${input.vertical} product-recommendation quizzes. ` +
      `Focus on: typical question counts, proven quiz types/formats, and what drives conversion for ` +
      `${input.priceTier} brands targeting ${audience}.` +
      focusLine;
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

export const QUIZ_TYPES_SYSTEM_PROMPT =
  "You propose 2-3 DISTINCT quiz TYPES for a Shopify brand, each tailored to the " +
  "brand's positioning AND real-world best practices for the category. Rules:\n" +
  // GEN-GROUND (owner incident 2026-08-16) — a pet-nutrition research cache +
  // brand digest once steered every card pet-ward while the merchant's chosen
  // buckets were outdoor gear. The catalog summary and buckets are the ground
  // truth; identity/research advise on form only.
  "- GROUND EVERY TYPE in the outcome buckets and catalog summary provided: " +
  "the quiz is about THOSE products. The brand summary, positioning, and web " +
  "research inform tone, format, and question-count norms ONLY — when they " +
  "mention product categories that do not appear in the catalog summary or " +
  "buckets, IGNORE those categories entirely. Never propose a quiz about " +
  "products the catalog summary does not contain; name each type after what " +
  "the catalog actually sells.\n" +
  "- Names are plain product names in plain words — no em dashes, no colon " +
  "taglines, no subtitle suffixes.\n" +
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

export const RICH_TEMPLATES_SYSTEM_PROMPT =
  "You generate 2-3 DISTINCT template configurations for a chosen quiz type — each " +
  "a full 'battle card'. Rules:\n" +
  // GEN-GROUND — same ground-truth rule as the types pass; the template title
  // becomes the quiz's NAME, so an off-catalog title is merchant-visible.
  "- GROUND EVERY TEMPLATE in the outcome buckets and catalog summary provided: " +
  "titles, angles, and sample questions must be about THOSE products. Ignore any " +
  "product category from the brand summary that the catalog summary does not " +
  "contain. Titles are plain names in plain words — no em dashes, no colon " +
  "taglines.\n" +
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

// ── DRAFT-FAST: the headless chains' ONE merged middle pass ──────────────────
// The headless chains (goal-first confirm, pop-up "Generate with AI", the
// speculative pre-build) never show Shape: they auto-picked the best
// product_match type out of 2-3, then templates[0] out of 2-3 — two
// sequential Haiku passes writing ~2,400 output tokens to keep ~350 of them.
// This pass writes ONLY the kept direction (one product_match type + its one
// template) in a single call. The Shape route still runs the two card passes
// above — a merchant choosing between cards needs the cards.
//
// The tool shape is FLAT and carries no ids / experience_type / rationale:
// those are derived here (headless builds are decider docs — product matching
// by construction, the pickHeadlessType rule), so no output tokens are spent
// on them. Buckets are shown under short refs (B1, B2 …) and mapped back to
// their ids here — echoing 25-char ids cost ~1.5 s on a 27-bucket draft. The
// result is assembled into the SAME persisted shapes (QuizType +
// RichTemplateOption) the two-pass chain produced.
const QuizDirectionDraft = z.object({
  type_name: z.string().min(1),
  achieves: z.string().min(1),
  question_range: z.object({
    min: z.number().int().min(1).max(20),
    max: z.number().int().min(1).max(20),
  }),
  title: z.string().min(1),
  angle: z.string().min(1),
  sample_questions: z.array(z.string().min(1)).min(2).max(3),
  feature_notes: z.array(z.string().min(1)).min(1).max(3),
  dials: z.object({
    imagery: z.enum(["high", "medium", "low"]),
    graphics: z.enum(["high", "medium", "low"]),
    word_forward: z.enum(["high", "medium", "low"]),
    lines: z.enum(["soft", "sharp", "rounded"]),
  }),
  rec_defaults: z.object({
    max_products: z.number().int().min(1).max(12),
    oos_behavior: z.enum(["hide", "show_with_badge", "fallback"]),
  }),
  recommended_buckets: z.array(z.string()).optional(),
  question_count: z.number().int().min(1).max(40),
});

const QUIZ_DIRECTION_TOOL_SCHEMA = {
  type: "object",
  required: [
    "type_name",
    "achieves",
    "question_range",
    "title",
    "angle",
    "sample_questions",
    "feature_notes",
    "dials",
    "rec_defaults",
    "question_count",
  ],
  properties: {
    type_name: { type: "string", description: "the quiz format's display name" },
    achieves: { type: "string", description: "one line: what this quiz achieves" },
    question_range: {
      type: "object",
      required: ["min", "max"],
      properties: {
        min: { type: "integer", minimum: 3, maximum: 20 },
        max: { type: "integer", minimum: 3, maximum: 20 },
      },
    },
    title: { type: "string", description: "the quiz's name" },
    angle: { type: "string", description: "one line: how this quiz frames the journey" },
    sample_questions: {
      type: "array",
      minItems: 2,
      maxItems: 3,
      items: { type: "string" },
    },
    feature_notes: {
      type: "array",
      minItems: 1,
      maxItems: 1,
      items: { type: "string" },
      description: "one short note (under 12 words) on what is distinctive about this quiz",
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
    recommended_buckets: {
      type: "array",
      items: { type: "string" },
      description: "the most relevant buckets, by their short ref (e.g. B2)",
    },
    question_count: { type: "integer", minimum: 3, maximum: 20 },
  },
} as const;

export const QUIZ_DIRECTION_SYSTEM_PROMPT =
  "You choose ONE quiz direction for a Shopify brand's product-recommendation " +
  "quiz: the quiz TYPE (its format) and the ONE template configuration that " +
  "implements it. Rules:\n" +
  // GEN-GROUND — the same ground-truth rule the two card passes carry; the
  // title becomes the quiz's NAME, so an off-catalog title is merchant-visible.
  "- GROUND THE DIRECTION in the outcome buckets and catalog summary provided: " +
  "the quiz is about THOSE products. The brand summary, positioning, and web " +
  "research inform tone, format, and question-count norms ONLY — when they " +
  "mention product categories that do not appear in the catalog summary or " +
  "buckets, IGNORE those categories entirely. Name the type and the title " +
  "after what the catalog actually sells.\n" +
  "- This is a product-match quiz: every result is one of the outcome buckets. " +
  "Pick the single strongest format for THIS brand, catalog, and goal (e.g. " +
  "Type/Needs Matcher, Routine Builder, Gift Finder, Educational Explainer).\n" +
  "- type_name and title are plain names in plain words — no em dashes, no " +
  "colon taglines, no subtitle suffixes.\n" +
  "- question_range is informed by the category (educational/wellness run " +
  "longer, 8-12; gifting/style run 4-7); question_count sits within it.\n" +
  "- angle is one line on how the quiz frames the journey. Give 2-3 sample " +
  "question texts (never budget / price-range questions — brands don't ask " +
  "that) and ONE short feature note on what is distinctive (e.g. 'Opens with " +
  "a visual mood question').\n" +
  "- Set the dials (imagery/graphics/word_forward high|medium|low and lines " +
  "soft|sharp|rounded) to match the brand: an educational brand leans " +
  "word_forward high; a visual brand leans imagery high; a refined brand leans " +
  "lines sharp.\n" +
  "- rec_defaults: a recommended max_products + oos_behavior. " +
  "recommended_buckets is optional (the refs of the most relevant buckets).\n" +
  "- If no web research is provided, draw on your own knowledge of quiz best " +
  "practices for the industry.\n" +
  "- Respond ONLY via the tool call.";

export interface GenerateQuizDirectionInput {
  brandSummary: string;
  brandVoiceSample?: string;
  positioning: { industry: string; vertical: string; price_tier: string; demographic: string[] };
  goalPrompt: string;
  struggle?: string;
  buckets: Array<{ id: string; name: string; tags: string[] }>;
  catalogSummary: string;
  webResearchText: string;
  // The goal brief's chosen length (flow1). A pin, not a hint: the returned
  // type's question_range and the template's question_count both carry it.
  questionLength?: number;
}

export interface QuizDirection {
  type: QuizTypeT;
  template: RichTemplateOptionT;
}

// Stable slug for the derived ids ("" can't satisfy the schemas' min(1)).
function directionSlug(text: string, fallback: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || fallback;
}

export async function generateQuizDirection(
  input: GenerateQuizDirectionInput,
): Promise<QuizDirection> {
  const tool = {
    name: "emit_quiz_direction",
    description: "Emit the one quiz direction: its type and its template. The only allowed response.",
    input_schema: QUIZ_DIRECTION_TOOL_SCHEMA as unknown as Anthropic.Tool.InputSchema,
  } satisfies Anthropic.Tool;

  const pin = input.questionLength;
  const bucketIdByRef = new Map(input.buckets.map((b, i) => [`B${i + 1}`, b.id]));
  const userMessage = [
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
    "Outcome buckets (ref — name):",
    input.buckets.length
      ? input.buckets.map((b, i) => `- B${i + 1} — ${b.name}`).join("\n")
      : "- (no buckets — recommend from the whole catalog)",
    "",
    "Catalog summary:",
    input.catalogSummary,
    "",
    "Web research (best practices for this category):",
    input.webResearchText || "(no research available — use your own knowledge)",
    "",
    ...(pin
      ? [`The merchant chose the length: exactly ${pin} questions. Set question_range to ${pin}-${pin} and question_count to ${pin}.`, ""]
      : []),
    "Choose the one quiz direction. Emit via the tool call.",
  ].join("\n");

  let lastIssue: string | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await createMessage({
      model: MODEL_SPEED,
      max_tokens: 1024,
      system: QUIZ_DIRECTION_SYSTEM_PROMPT,
      tools: [tool],
      tool_choice: { type: "tool", name: "emit_quiz_direction" },
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
    const parsed = QuizDirectionDraft.safeParse(toolUse.input);
    if (!parsed.success) {
      lastIssue = validationIssue(parsed.error);
      continue;
    }
    const draft = parsed.data;
    // Normalize the range (a swapped min/max is the model's slip, not a
    // failure), apply the pin, and keep the count inside the range and the
    // persisted schema's floor of 3.
    const range = pin
      ? { min: pin, max: pin }
      : {
          min: Math.min(draft.question_range.min, draft.question_range.max),
          max: Math.max(draft.question_range.min, draft.question_range.max),
        };
    const questionCount = Math.max(
      3,
      Math.min(range.max, Math.max(range.min, pin ?? draft.question_count)),
    );
    const type = QuizType.parse({
      id: directionSlug(draft.type_name, "quiz-type"),
      experience_type: "product_match",
      name: draft.type_name,
      achieves: draft.achieves,
      question_range: range,
    });
    const template = RichTemplateOption.parse({
      id: directionSlug(draft.title, "quiz-template"),
      experience_type: "product_match",
      title: draft.title,
      angle: draft.angle,
      sample_questions: draft.sample_questions,
      feature_notes: draft.feature_notes,
      dials: draft.dials,
      rec_defaults: draft.rec_defaults,
      // An unknown ref silently drops (never persists) — an empty list means
      // "every confirmed bucket", the same reading initPickedTemplate gives it.
      recommended_bucket_ids: (draft.recommended_buckets ?? []).flatMap((ref) => {
        const id = bucketIdByRef.get(ref.trim().toUpperCase());
        return id ? [id] : [];
      }),
      question_count: questionCount,
    });
    return { type, template };
  }

  throw new QuizGenerationError(
    "Quiz direction generation failed validation after retries.",
    MAX_ATTEMPTS,
    lastIssue,
  );
}

// ── FLOW-1: the "Write Your Goal" product pre-pick ───────────────────────────
// Given the merchant's goal and the shop's catalog candidates, pick the set of
// recommendations (buckets) the quiz should route to. One strategy per pick —
// the recs surface locks selections to a single type, so the model must too.
// Keys MUST come verbatim from the candidate lists; the caller re-resolves them
// through bucketRowsFor, so a hallucinated key silently drops (never persists).

export const GoalBucketPick = z.object({
  strategy: z.enum(["product", "tag", "collection"]),
  keys: z.array(z.string().min(1)).min(1).max(12),
  rationale: z.string(),
});
export type GoalBucketPick = z.infer<typeof GoalBucketPick>;

const GOAL_BUCKET_TOOL_SCHEMA = {
  type: "object",
  required: ["strategy", "keys", "rationale"],
  properties: {
    strategy: {
      type: "string",
      enum: ["product", "tag", "collection"],
      description: "the ONE kind of key every entry in `keys` is",
    },
    keys: {
      type: "array",
      minItems: 1,
      maxItems: 12,
      items: { type: "string" },
      description: "keys copied VERBATIM from the chosen strategy's candidate list",
    },
    rationale: {
      type: "string",
      description: "one merchant-facing sentence: why these fit the goal",
    },
  },
} as const;

const GOAL_BUCKET_SYSTEM_PROMPT =
  "You choose which of a Shopify store's products a product-finder quiz should " +
  "recommend, given the merchant's goal for the quiz. Each key you pick becomes " +
  "ONE outcome the quiz routes shoppers to. Rules:\n" +
  "- Pick exactly ONE strategy: `collection` or `tag` when the store's groupings " +
  "map cleanly onto the goal (each collection/tag = one distinct recommendation), " +
  "`product` when the catalog is small or the goal targets specific items.\n" +
  "- Aim for 3-6 keys — enough distinct outcomes for the quiz to genuinely " +
  "differentiate shoppers, never one, rarely more than 8.\n" +
  "- Every key MUST be copied verbatim from the candidate lists. Never invent, " +
  "rename, or normalize a key.\n" +
  "- Choose the set most relevant to the merchant's goal, not simply the largest.\n" +
  "- The rationale is shown to the merchant: one plain sentence, no hype.\n" +
  "- Respond ONLY via the tool call.";

export interface PickGoalBucketsInput {
  goal: string;
  brandSummary: string;
  candidates: {
    products: Array<{ id: string; title: string }>;
    tags: Array<{ key: string; label: string; count: number }>;
    collections: Array<{ key: string; label: string; count: number }>;
  };
}

export async function pickGoalBuckets(input: PickGoalBucketsInput): Promise<GoalBucketPick> {
  const tool = {
    name: "emit_goal_buckets",
    description:
      "Emit the recommendation set (one strategy + its keys) for the merchant's goal. The only allowed response.",
    input_schema: GOAL_BUCKET_TOOL_SCHEMA as unknown as Anthropic.Tool.InputSchema,
  } satisfies Anthropic.Tool;

  const c = input.candidates;
  const userMessage = [
    "Merchant's goal for this quiz:",
    input.goal || "(none stated)",
    "",
    "Brand summary:",
    input.brandSummary || "(no brand digest — infer from the catalog)",
    "",
    `Candidate collections (key — title · member count):`,
    c.collections.length
      ? c.collections.map((x) => `- ${x.key} — ${x.label} · ${x.count}`).join("\n")
      : "- (none)",
    "",
    `Candidate tags (key — label · member count):`,
    c.tags.length ? c.tags.map((x) => `- ${x.key} — ${x.label} · ${x.count}`).join("\n") : "- (none)",
    "",
    `Candidate products (key — title)${c.products.length >= 150 ? " (truncated list)" : ""}:`,
    c.products.length
      ? c.products.map((x) => `- ${x.id} — ${x.title}`).join("\n")
      : "- (none)",
    "",
    "Pick ONE strategy + the keys that best serve the goal. Emit via the tool call.",
  ].join("\n");

  let lastIssue: string | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // MODEL (Sonnet), not MODEL_SPEED: this is the merchandising judgment the
    // whole Flow-1 quiz hangs off (the owner's Haiku approval covers only the
    // Shape type/template middle passes).
    const response = await createMessage({
      model: MODEL,
      max_tokens: 1024,
      system: GOAL_BUCKET_SYSTEM_PROMPT,
      tools: [tool],
      tool_choice: { type: "tool", name: "emit_goal_buckets" },
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
    const parsed = GoalBucketPick.safeParse(toolUse.input);
    if (parsed.success) return parsed.data;
    lastIssue = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
  }

  throw new QuizGenerationError(
    "Goal product pre-pick failed validation after retries.",
    MAX_ATTEMPTS,
    lastIssue,
  );
}
