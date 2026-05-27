import Anthropic from "@anthropic-ai/sdk";
import { Quiz, quizToolJsonSchema, QuestionData } from "./quizSchema";
import type { z } from "zod";

const REGEN_SYSTEM_PROMPT =
  "You are regenerating ONE question in an existing Shopify product quiz. " +
  "Use the catalog summary for tag accuracy — only use tags that exist in the " +
  "supplied catalog. Keep the question useful for product targeting. The " +
  "downstream system will preserve answer IDs where possible by order — keep " +
  "the answer count similar to the original so edge connections survive.";

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

const RegenInput = QuestionData.pick({
  text: true,
  question_type: true,
  required: true,
  max_selections: true,
}).extend({
  answers: QuestionData.shape.answers.element
    .pick({ text: true, tags: true, collection_filter: true, image_url: true })
    .array()
    .min(2),
});

export interface RegenerateQuestionInput {
  catalogSummary: string;
  existingQuestion: z.infer<typeof QuestionData>;
  steeringPrompt: string;
}

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 8192;
const SYSTEM_PROMPT =
  "You are an expert DTC merchandiser building a product finder quiz for a Shopify storefront. " +
  "Generate a quiz that helps a shopper land on the right product. Every answer must contribute " +
  "to product targeting via tag overlap or collection filter. Every question must have at least " +
  "two answers. Every answer's tags[] must reference tags that actually exist in the supplied " +
  "catalog summary — never invent tags. Always include an intro node first and at least one " +
  "result node last, connected by edges in order. Lay nodes out roughly left-to-right starting " +
  "at x=0, spacing ~300 between columns. Never write commentary or anything outside the tool call.";

let cachedClient: Anthropic | null = null;
function client(): Anthropic {
  if (!cachedClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
    cachedClient = new Anthropic({ apiKey });
  }
  return cachedClient;
}

export interface GenerateQuizInput {
  goalPrompt: string;
  questionCount: number;
  collectionIds: string[];
  catalogSummary: string;
  quizId: string;
}

export class QuizGenerationError extends Error {
  constructor(
    message: string,
    public readonly attempts: number,
    public readonly lastValidationIssue?: string,
  ) {
    super(message);
    this.name = "QuizGenerationError";
  }
}

const MAX_ATTEMPTS = 3; // initial + 2 retries per spec.

export async function generateQuiz(
  input: GenerateQuizInput,
): Promise<z.infer<typeof Quiz>> {
  const userMessage = buildUserMessage(input);
  const tool = {
    name: "emit_quiz",
    description:
      "Emit the structured quiz JSON. This is the only allowed response — do not write free text.",
    input_schema: quizToolJsonSchema as unknown as Anthropic.Tool.InputSchema,
  } satisfies Anthropic.Tool;

  let lastIssue: string | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await client().messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools: [tool],
      tool_choice: { type: "tool", name: "emit_quiz" },
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

    const parsed = Quiz.safeParse(toolUse.input);
    if (parsed.success) return parsed.data;

    lastIssue = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
  }

  throw new QuizGenerationError(
    "Quiz generation failed validation after retries.",
    MAX_ATTEMPTS,
    lastIssue,
  );
}

function buildUserMessage(input: GenerateQuizInput): string {
  return [
    `Quiz id: ${input.quizId}`,
    `Question count: ${input.questionCount}`,
    `Collections in scope (collection IDs): ${input.collectionIds.join(", ") || "(none — use full catalog)"}`,
    "",
    "Merchant's quiz goal (verbatim):",
    input.goalPrompt,
    "",
    "Catalog summary (real tags, types, price bands, sample products from the scoped catalog):",
    input.catalogSummary,
  ].join("\n");
}

export interface RegeneratedQuestion {
  text: string;
  question_type: z.infer<typeof QuestionData.shape.question_type>;
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

  let lastIssue: string | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await client().messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: REGEN_SYSTEM_PROMPT,
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
