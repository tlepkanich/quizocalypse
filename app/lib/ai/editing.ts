// BIC-2 C3c — inline AI chat editing (Dev Spec "Call 2"): editQuiz + the ops
// tool schema. Pure move out of claude.ts. ISOMORPHIC — no node builtins.
import type Anthropic from "@anthropic-ai/sdk";
import {
  buildBrandVoiceAddition,
  type BrandGuidelines,
} from "../brandGuidelines";
import { EditOp } from "../quizEdit";
import { z } from "zod";
import { MODEL, MAX_TOKENS, MAX_ATTEMPTS, createMessage, QuizGenerationError } from "./client";

// ---------- Inline AI chat edit (Dev Spec "Call 2") ----------

const EDIT_QUIZ_SYSTEM_PROMPT =
  "You edit an existing Shopify product-recommendation quiz by emitting a SMALL list of structured edit OPERATIONS — never the whole quiz, never raw graph JSON. " +
  "Translate the merchant's request into the minimal set of ops. Reference ONLY node ids and answer ids that appear in the QUIZ OUTLINE. " +
  "Use ONLY tags that appear in the CATALOG SUMMARY — never invent tags. Preserve everything the merchant did not ask to change. " +
  "Use edit_question or set_text for wording; add_question / remove_node / reorder_question for structure; add_answer / remove_answer for options. " +
  "Use set_theme to restyle the WHOLE quiz when the merchant asks for a different look or vibe (preset is one of: linen, minimal, editorial, bold, pastel, dark). " +
  "Use set_answer_icon to give answers emoji icons (icon is the emoji itself; empty string removes it); set_answer_image (https URLs only) for answer photos on image-style questions; set_answer_columns (1 or 2; 0 = automatic) to change a question's answer-grid layout. " +
  "Use set_question_type to change how a question renders (single_select, multi_select, dropdown, image_tile, image_picker, rating, swatch, numeric, date, slider, searchable, text, email — card types need at least 2 answers); set_selections {min?, max?} for multi-select pick bounds. " +
  "Use set_node_field for any step's content fields (intro: headline/subtext/button_label/hero_image_url; email_gate: headline/subtext; result: headline/subtext/cta_label/escape_hatch_label/escape_hatch_url ('talk to a human' link — both parts needed); question: text/section_label (chapter, ≤40 chars)/helper_text (reassurance line); message: text; end: headline/subtext/cta_label/cta_url; ask_ai: persona_name/opening_message/system_prompt; product_cards: headline/subtext/cta_label; URL fields must be https). " +
  "Use set_flag for collect_email_on_result / result_split / show_recap (answer review before results) / show_match_reasons (because-you-chose chips) / computing_reveal (the weighing-your-answers beat) — all quiz-level — or collect_phone (on an email gate). Use add_node {type: message|email_gate|end, headline?, text?, after_node_id?} to insert non-question steps. " +
  "Use set_node_design {node_id, layer(synced|desktop|mobile), colors{primary?/background?/text? as hex}, radius?, button_style?} to restyle ONE step, and add_image_block {node_id, placement(above|below), image_url?} to place a picture on a step. " +
  "If a SELECTED NODE is provided in context, phrases like 'this question' or 'this step' refer to it. " +
  "Always include a one-sentence, friendly assistant_message describing what you changed. Output nothing outside the tool call.";

// Loose JSON Schema (the discriminated-union strictness is enforced by the Zod
// EditOp validator + retry, mirroring the other tool definitions here).
const editQuizToolJsonSchema = {
  type: "object",
  required: ["ops"],
  properties: {
    assistant_message: {
      type: "string",
      description: "One short, friendly sentence telling the merchant what you changed.",
    },
    ops: {
      type: "array",
      description:
        "Edit operations applied in order. Reference only ids from the outline. " +
        "Variants: set_text {node_id, field(headline|subtext|text|button_label|cta_label), value}; " +
        "edit_question {node_id, text?, answers?:[{text, tags[]}]}; " +
        "add_question {after_node_id?, text, question_type(single_select|multi_select), answers:[{text, tags[]}]}; " +
        "remove_node {node_id}; add_answer {node_id, text, tags[]}; remove_answer {node_id, answer_id}; " +
        "reorder_question {node_id, before_node_id|null}; " +
        "set_education_card {node_id, value} (a one-line teaching card shown before a question; empty value clears it; max 1 per quiz); " +
        "set_theme {preset} (restyle the whole quiz; preset is one of linen|minimal|editorial|bold|pastel|dark).",
      items: {
        type: "object",
        required: ["op"],
        properties: {
          op: {
            type: "string",
            enum: [
              "set_text",
              "edit_question",
              "add_question",
              "remove_node",
              "add_answer",
              "remove_answer",
              "reorder_question",
              "set_education_card",
              "set_theme",
              "set_answer_icon",
              "set_answer_image",
              "set_answer_columns",
              "set_question_type",
              "set_selections",
              "set_node_field",
              "set_flag",
              "add_node",
              "set_node_design",
              "add_image_block",
            ],
          },
          node_id: { type: "string" },
          field: {
            type: "string",
            enum: [
              "headline",
              "subtext",
              "text",
              "button_label",
              "cta_label",
              "hero_image_url",
              "cta_url",
              "persona_name",
              "opening_message",
              "system_prompt",
              "label",
            ],
          },
          value: { type: "string" },
          // Unified P5 op fields (loose — Zod enforces the per-op shapes).
          min: { type: "integer" },
          max: { type: "integer" },
          flag: {
            type: "string",
            enum: ["collect_email_on_result", "result_split", "collect_phone", "show_recap", "show_match_reasons", "computing_reveal"],
          },
          type: { type: "string", enum: ["message", "email_gate", "end"] },
          headline: { type: "string" },
          layer: { type: "string", enum: ["synced", "desktop", "mobile"] },
          colors: {
            type: "object",
            properties: {
              primary: { type: "string" },
              background: { type: "string" },
              text: { type: "string" },
            },
          },
          radius: { type: "string", enum: ["square", "rounded", "pill"] },
          button_style: { type: "string", enum: ["filled", "outline", "ghost"] },
          placement: { type: "string", enum: ["above", "below"] },
          // keep in sync with THEME_PRESETS ids in themePresets.ts
          preset: {
            type: "string",
            enum: ["linen", "minimal", "editorial", "bold", "pastel", "dark"],
          },
          text: { type: "string" },
          // add_question allows single/multi; set_question_type allows all 13 —
          // loose here, the Zod EditOp union enforces per-op.
          question_type: { type: "string" },
          after_node_id: { type: "string" },
          before_node_id: { type: ["string", "null"] },
          answer_id: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          answers: {
            type: "array",
            items: {
              type: "object",
              required: ["text"],
              properties: {
                text: { type: "string" },
                tags: { type: "array", items: { type: "string" } },
              },
            },
          },
        },
      },
    },
  },
} as const;

const EditQuizSchema = z.object({
  ops: z.array(EditOp),
  assistant_message: z.string().default(""),
});

export interface EditQuizInput {
  // Compact id-bearing outline of the current quiz (from quizEdit.outlineQuiz).
  outline: string;
  // Catalog tag whitelist (same shape as the generator's catalogSummary).
  catalogSummary: string;
  // The merchant's free-text edit request.
  message: string;
  // Prior chat turns (oldest first), plain text — NOT tool blocks.
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  brandGuidelines?: BrandGuidelines | null;
  // Dev Spec §3.1 — catalog tone sample, so rewritten copy stays on-brand.
  toneSample?: string;
}

export interface EditQuizResult {
  ops: z.infer<typeof EditOp>[];
  assistant_message: string;
}

// Ask Claude to turn a merchant's free-text edit into a validated list of edit
// operations. The caller applies them with applyEditOps + Quiz.parse (the ops
// never carry ids/edges, so the graph stays sound). Throws QuizGenerationError
// after retries — the caller keeps the prior draft intact on failure.
export async function editQuiz(input: EditQuizInput): Promise<EditQuizResult> {
  const tool = {
    name: "emit_quiz_edits",
    description:
      "Emit the edit operations (and a one-sentence summary) to apply to the quiz. Reference only ids from the outline.",
    input_schema: editQuizToolJsonSchema as unknown as Anthropic.Tool.InputSchema,
  } satisfies Anthropic.Tool;

  const userMessage = [
    "QUIZ OUTLINE (reference these node/answer ids exactly):",
    input.outline,
    "",
    "CATALOG SUMMARY (only use tags that appear here):",
    input.catalogSummary,
    ...(input.toneSample
      ? ["", "BRAND VOICE SAMPLE (match this writing style when you change copy):", input.toneSample]
      : []),
    "",
    "MERCHANT REQUEST:",
    input.message,
  ].join("\n");

  const system =
    EDIT_QUIZ_SYSTEM_PROMPT + buildBrandVoiceAddition(input.brandGuidelines);

  // Plain-text prior turns for conversational context (no tool blocks, so the
  // forced tool_choice has no dangling tool_use to satisfy). Capped.
  const historyMsgs: Anthropic.MessageParam[] = (input.history ?? [])
    .slice(-10)
    .map((m) => ({ role: m.role, content: m.content }));

  let lastIssue: string | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await createMessage({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      tools: [tool],
      tool_choice: { type: "tool", name: "emit_quiz_edits" },
      messages: [
        ...historyMsgs,
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

    const parsed = EditQuizSchema.safeParse(toolUse.input);
    if (parsed.success) {
      return {
        ops: parsed.data.ops,
        assistant_message:
          parsed.data.assistant_message || "Done — I updated your quiz.",
      };
    }

    lastIssue = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
  }

  throw new QuizGenerationError(
    "Quiz edit failed validation after retries.",
    MAX_ATTEMPTS,
    lastIssue,
  );
}
