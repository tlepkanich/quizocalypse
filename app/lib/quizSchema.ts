import { z } from "zod";

// Quiz JSON contract — mirrors Technical Spec §3.2 verbatim.
// This is the single source of truth: the AI generator's Claude tool definition
// (see jsonSchema below) and the validator both derive from it.

export const QuestionType = z.enum(["single_select", "multi_select", "image_tile"]);
export type QuestionType = z.infer<typeof QuestionType>;

export const NodeType = z.enum(["intro", "question", "email_gate", "result"]);
export type NodeType = z.infer<typeof NodeType>;

export const MatchStrategy = z.enum(["top_n", "archetype"]);
export type MatchStrategy = z.infer<typeof MatchStrategy>;

export const QuizStatus = z.enum(["draft", "published"]);
export type QuizStatus = z.infer<typeof QuizStatus>;

export const Answer = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  image_url: z.string().url().optional(),
  tags: z.array(z.string()).default([]),
  collection_filter: z.string().optional(),
  edge_handle_id: z.string().min(1),
});
export type Answer = z.infer<typeof Answer>;

export const Position = z.object({
  x: z.number(),
  y: z.number(),
});

export const IntroData = z.object({
  headline: z.string().min(1),
  subtext: z.string().default(""),
  button_label: z.string().default("Start"),
  hero_image_url: z.string().url().optional(),
});

export const QuestionData = z.object({
  text: z.string().min(1),
  question_type: QuestionType,
  required: z.boolean().default(true),
  max_selections: z.number().int().positive().optional(),
  answers: z.array(Answer).min(2),
  // Mid-quiz product preview: when true, after this question is answered the
  // storefront opens a refining product list. Defaults off — only the
  // questions a merchant explicitly flags start the preview.
  show_preview_after: z.boolean().default(false),
});

export const EmailGateData = z.object({
  headline: z.string().min(1),
  subtext: z.string().default(""),
  email_required: z.boolean().default(true),
  name_optional: z.boolean().default(true),
  skip_allowed: z.boolean().default(false),
});

export const ResultData = z.object({
  headline: z.string().min(1),
  subtext: z.string().default(""),
  slot_count: z.number().int().min(1).max(6).default(3),
  cta_label: z.string().default("Shop now"),
  fallback_collection_id: z.string().min(1),
});

// Discriminated union of node types — keeps each node's `data` shape strict.
export const QuizNode = z.discriminatedUnion("type", [
  z.object({
    id: z.string().min(1),
    type: z.literal("intro"),
    position: Position,
    data: IntroData,
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("question"),
    position: Position,
    data: QuestionData,
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("email_gate"),
    position: Position,
    data: EmailGateData,
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("result"),
    position: Position,
    data: ResultData,
  }),
]);
export type QuizNode = z.infer<typeof QuizNode>;

export const QuizEdge = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  source_handle: z.string().optional(),
  condition: z
    .object({
      answer_id: z.string().min(1),
    })
    .optional(),
});

export const RecommendationRule = z.object({
  question_id: z.string().min(1),
  answer_id: z.string().min(1),
  tags: z.array(z.string()).default([]),
  collection_filter: z.string().optional(),
});

export const ResultPage = z.object({
  id: z.string().min(1),
  headline: z.string().min(1),
  subtext: z.string().default(""),
  product_ids: z.array(z.string()).default([]),
  match_strategy: MatchStrategy.default("top_n"),
});

// Design tokens — see Spec §3.5.
export const DesignTokens = z
  .object({
    colors: z
      .object({
        primary: z.string(),
        secondary: z.string(),
        accent: z.string(),
        background: z.string(),
        text: z.string(),
        muted: z.string(),
      })
      .partial(),
    typography: z
      .object({
        heading: z
          .object({
            family: z.string(),
            source: z.enum(["google", "custom", "system"]),
            weight: z.number().optional(),
          })
          .partial(),
        body: z
          .object({
            family: z.string(),
            source: z.enum(["google", "custom", "system"]),
            weight: z.number().optional(),
            base_size: z.number().optional(),
            scale_ratio: z.number().optional(),
          })
          .partial(),
      })
      .partial(),
    radius: z.enum(["square", "rounded", "pill"]).optional(),
    button_style: z.enum(["filled", "outline", "ghost"]).optional(),
    spacing: z.enum(["compact", "normal", "spacious"]).optional(),
  })
  .partial();
export type DesignTokens = z.infer<typeof DesignTokens>;

export const Quiz = z.object({
  quiz_id: z.string().min(1),
  status: QuizStatus.default("draft"),
  scope: z.object({
    collection_ids: z.array(z.string()),
  }),
  // Optional collection ID for the mid-quiz preview cold-start. Used when
  // accumulated answer tags score zero against the candidate pool.
  featured_collection_id: z.string().optional(),
  nodes: z.array(QuizNode).min(2),
  edges: z.array(QuizEdge).default([]),
  recommendation_logic: z.array(RecommendationRule).default([]),
  results_pages: z.array(ResultPage).default([]),
  design_tokens: DesignTokens.default({}),
  design_overrides: z.record(z.string(), DesignTokens).default({}),
});
export type Quiz = z.infer<typeof Quiz>;

// JSON Schema for Claude tool-use. Hand-written to match the Zod schema above
// (single source of truth in spirit; structurally duplicated to avoid pulling in
// zod-to-json-schema for one tool definition). Keep in sync with the Zod above.
export const quizToolJsonSchema = {
  type: "object",
  required: [
    "quiz_id",
    "scope",
    "nodes",
    "edges",
    "recommendation_logic",
    "results_pages",
  ],
  properties: {
    quiz_id: { type: "string" },
    status: { type: "string", enum: ["draft", "published"] },
    scope: {
      type: "object",
      required: ["collection_ids"],
      properties: {
        collection_ids: { type: "array", items: { type: "string" } },
      },
    },
    featured_collection_id: { type: "string" },
    nodes: {
      type: "array",
      minItems: 2,
      items: {
        type: "object",
        required: ["id", "type", "position", "data"],
        properties: {
          id: { type: "string" },
          type: {
            type: "string",
            enum: ["intro", "question", "email_gate", "result"],
          },
          position: {
            type: "object",
            required: ["x", "y"],
            properties: {
              x: { type: "number" },
              y: { type: "number" },
            },
          },
          data: {
            type: "object",
            description:
              "Node-type-specific payload. For type=intro: { headline, subtext?, button_label?, hero_image_url? }. " +
              "For type=question: { text, question_type ('single_select'|'multi_select'|'image_tile'), required?, max_selections?, show_preview_after? (boolean, default false), answers: [{id, text, image_url?, tags[], collection_filter?, edge_handle_id}] (≥2 answers) }. " +
              "For type=email_gate: { headline, subtext?, email_required?, name_optional?, skip_allowed? }. " +
              "For type=result: { headline, subtext?, slot_count? (1..6), cta_label?, fallback_collection_id }.",
          },
        },
      },
    },
    edges: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "source", "target"],
        properties: {
          id: { type: "string" },
          source: { type: "string" },
          target: { type: "string" },
          source_handle: { type: "string" },
          condition: {
            type: "object",
            properties: { answer_id: { type: "string" } },
          },
        },
      },
    },
    recommendation_logic: {
      type: "array",
      items: {
        type: "object",
        required: ["question_id", "answer_id", "tags"],
        properties: {
          question_id: { type: "string" },
          answer_id: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          collection_filter: { type: "string" },
        },
      },
    },
    results_pages: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "headline", "product_ids"],
        properties: {
          id: { type: "string" },
          headline: { type: "string" },
          subtext: { type: "string" },
          product_ids: { type: "array", items: { type: "string" } },
          match_strategy: { type: "string", enum: ["top_n", "archetype"] },
        },
      },
    },
    design_tokens: { type: "object" },
    design_overrides: { type: "object" },
  },
} as const;
