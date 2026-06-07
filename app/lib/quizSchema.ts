import { z } from "zod";

// Quiz JSON contract — mirrors Technical Spec §3.2 verbatim.
// This is the single source of truth: the AI generator's Claude tool definition
// (see jsonSchema below) and the validator both derive from it.

export const QuestionType = z.enum([
  "single_select",
  "multi_select",
  "image_tile",
  // Phase 4: free-form inputs. The shopper types a value rather than
  // picking from a card list. We still keep an answers[] in storage with a
  // single "default" answer (so existing edge routing + tag-accumulation
  // logic stays untouched), but the runtime renders an input field instead
  // of answer cards. The typed string is captured into the path as the
  // answer's text. Email type also runs HTML5 email validation client-side.
  "text",
  "email",
  // Phase 6 conversational types:
  // - searchable: vertical answer list with a search box on top that
  //   substring-filters as the shopper types. Good for long lists like
  //   brand / country / style pickers.
  // - image_picker: dense thumbnail grid (vs image_tile's tall cards).
  //   Same per-answer fields (image_url, text) but rendered as a
  //   2–3 column grid where image dominates and text is a small caption.
  "searchable",
  "image_picker",
  // Phase 5: a compact dropdown (<select>) — good for long single-choice lists.
  "dropdown",
]);
export type QuestionType = z.infer<typeof QuestionType>;

export const NodeType = z.enum([
  "intro",
  "question",
  "email_gate",
  "result",
  "message",
  "end",
  "branch",
  "ask_ai",
  "integration",
  "product_cards",
]);
export type NodeType = z.infer<typeof NodeType>;

// Legacy single-strategy field on ResultPage. Kept for back-compat: the
// engine maps it onto a one-element match_ladder. "points" added in v3.
export const MatchStrategy = z.enum(["top_n", "archetype", "points"]);
export type MatchStrategy = z.infer<typeof MatchStrategy>;

// v3 recommendation source-priority ladder. A result page resolves products
// by walking these strategies top-to-bottom until one yields ≥ min_products,
// then falling back to fallback_collection_id. This is the doc's explicit
// revenue mechanism ("conditional OR collection OR tags OR metafield, in
// order of importance").
//  - conditional: explicit "if these answers → these products" rules
//  - points:      winning category by per-answer point tally
//  - category:    a bound archetype category's products (existing behavior)
//  - collection:  products in a chosen Shopify (smart) collection
//  - tag:         tag-overlap scoring (the existing top_n behavior)
//  - metafield:   products whose metafield matches a value
export const MatchLadderStrategy = z.enum([
  "conditional",
  "points",
  "category",
  "collection",
  "tag",
  "metafield",
]);
export type MatchLadderStrategy = z.infer<typeof MatchLadderStrategy>;

export const QuizStatus = z.enum(["draft", "published"]);
export type QuizStatus = z.infer<typeof QuizStatus>;

export const Answer = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  // Dev Spec §4.1 — a short plain-English tradeoff explainer shown on the answer
  // option (AI-generated via the tooltip call). Optional + additive.
  tooltip_text: z.string().optional(),
  image_url: z.string().url().optional(),
  tags: z.array(z.string()).default([]),
  collection_filter: z.string().optional(),
  // Phase 5: an optional short video shown in the answer card (mp4/embed URL).
  video_url: z.string().url().optional(),
  edge_handle_id: z.string().min(1),
  // v3 points scoring: weights this answer contributes toward category ids
  // when a result page uses the "points" ladder strategy. categoryId →
  // weight. Optional — only present on quizzes that use points logic.
  points: z.record(z.string(), z.number()).optional(),
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

// Optional config for the freeform input rendering (text / email types).
// For card-based types this is ignored.
export const QuestionInputConfig = z.object({
  placeholder: z.string().default(""),
  // Hard cap on input length so a stuck client can't dump arbitrary data.
  // Defaults sized for typical inputs (name, short answer).
  max_length: z.number().int().min(1).max(500).default(120),
});
export type QuestionInputConfig = z.infer<typeof QuestionInputConfig>;

// Base z.object shape — exposed for tools that need `.shape` / `.pick` /
// `.extend` (e.g. the AI regeneration tool schema in claude.ts). The
// public `QuestionData` below adds the cross-field refine on top.
export const QuestionDataObject = z.object({
  text: z.string().min(1),
  question_type: QuestionType,
  required: z.boolean().default(true),
  max_selections: z.number().int().positive().optional(),
  // Phase 5: minimum picks for multi_select (the shopper must choose at least
  // this many before continuing). Optional — defaults to "at least one".
  min_selections: z.number().int().positive().optional(),
  // Card types need ≥2 answers; freeform types (text/email) only need a
  // single seed answer so tag accumulation + edge routing keep working.
  // The refine below enforces the per-type minimum.
  answers: z.array(Answer).min(1),
  // Only meaningful for text/email types.
  input_config: QuestionInputConfig.optional(),
  // Mid-quiz product preview: when true, after this question is answered the
  // storefront opens a refining product list. Defaults off — only the
  // questions a merchant explicitly flags start the preview.
  show_preview_after: z.boolean().default(false),
  // Dev Spec §4.1 — optional one-line "micro-education card" shown BEFORE this
  // question (a non-question, Continue-only informational screen). The AI places
  // at most one per quiz. Additive — absent means no card.
  education_card_before: z.string().optional(),
});

export const QuestionData = QuestionDataObject.refine(
  (q) => {
    const cardTypes = [
      "single_select",
      "multi_select",
      "image_tile",
      "searchable",
      "image_picker",
      "dropdown",
    ];
    if (cardTypes.includes(q.question_type)) return q.answers.length >= 2;
    return true;
  },
  {
    message: "Card-style question types require at least 2 answers.",
    path: ["answers"],
  },
);

export const EmailGateData = z.object({
  headline: z.string().min(1),
  subtext: z.string().default(""),
  email_required: z.boolean().default(true),
  name_optional: z.boolean().default(true),
  skip_allowed: z.boolean().default(false),
  // Phase 5 — also collect a phone number for SMS marketing (optional input).
  collect_phone: z.boolean().default(false),
});

// One conditional product rule: "if the shopper picked all of these answers
// (and optionally any of these), show these product ids." Evaluated against
// the visited path's selected answer ids at runtime.
export const ConditionalRule = z.object({
  all_of: z.array(z.string()).default([]),
  any_of: z.array(z.string()).default([]),
  product_ids: z.array(z.string()).default([]),
});
export type ConditionalRule = z.infer<typeof ConditionalRule>;

// Product ranking within a resolved pool. relevance = current tag-overlap
// score; newest = Product.updatedAt desc; best_seller / highest_rated read
// a merchant-mapped metafield, falling back to relevance when unmapped.
export const ResultRanking = z.enum([
  "relevance",
  "newest",
  "best_seller",
  "highest_rated",
]);
export type ResultRanking = z.infer<typeof ResultRanking>;

// Out-of-stock handling for the resolved products.
export const OosBehavior = z.enum(["hide", "show_with_badge", "fallback"]);
export type OosBehavior = z.infer<typeof OosBehavior>;

// One stage of a multi-stage (Advanced) result page. Each stage is a
// section with its own headline + ladder, rendered sequentially. Simple
// result pages have no stages and use the top-level ResultData config.
export const ResultStage = z.object({
  id: z.string().min(1),
  headline: z.string().default(""),
  subtext: z.string().default(""),
  match_ladder: z.array(MatchLadderStrategy).default(["tag"]),
  conditional_rules: z.array(ConditionalRule).default([]),
  category_id: z.string().optional(),
  collection_id: z.string().optional(),
  metafield_key: z.string().optional(),
  metafield_value: z.string().optional(),
  ranking: ResultRanking.default("relevance"),
  min_products: z.number().int().min(1).max(12).default(3),
  max_products: z.number().int().min(1).max(12).default(3),
  // Dev Spec §5 — feature→benefit "why this" bullets for the stage. Baked at publish.
  why_bullets: z.array(z.string()).default([]),
});
export type ResultStage = z.infer<typeof ResultStage>;

export const ResultData = z.object({
  headline: z.string().min(1),
  subtext: z.string().default(""),
  slot_count: z.number().int().min(1).max(6).default(3),
  cta_label: z.string().default("Shop now"),
  fallback_collection_id: z.string().min(1),

  // ---- v3 recommendation logic ----
  // Source-priority ladder. Default ["tag"] reproduces the legacy top_n
  // behavior exactly, so existing quizzes are byte-identical.
  match_ladder: z.array(MatchLadderStrategy).default(["tag"]),
  // Explicit conditional product rules (used when the ladder includes
  // "conditional"). First matching rule wins.
  conditional_rules: z.array(ConditionalRule).default([]),
  // Bound archetype category (used by the "category" strategy). Mirrors the
  // existing ResultPage.category_id but lives on the node data too.
  category_id: z.string().optional(),
  // Collection / metafield targets for those strategies.
  collection_id: z.string().optional(),
  metafield_key: z.string().optional(),
  metafield_value: z.string().optional(),

  // ---- v3 result-page settings depth ----
  ranking: ResultRanking.default("relevance"),
  // Ladder threshold: a strategy must yield ≥ this many products to win,
  // else the ladder falls through. Default 1 = "first non-empty wins".
  min_products: z.number().int().min(1).max(12).default(1),
  // Display cap. Optional — when unset the engine uses slot_count, so
  // existing quizzes that set slot_count keep their cap exactly.
  max_products: z.number().int().min(1).max(12).optional(),
  // Default keeps out-of-stock products in the list (ranked last) — the
  // pre-v3 behavior. Merchants opt into "hide" / "fallback" explicitly.
  oos_behavior: OosBehavior.default("show_with_badge"),
  oos_fallback_collection_id: z.string().optional(),
  include_discount: z.boolean().default(false),
  subscription_eligible: z.boolean().default(false),

  // ---- v3 multi-stage (Advanced) ----
  // Empty = Simple (one page). Non-empty = Advanced ordered sections.
  stages: z.array(ResultStage).default([]),
  // Dev Spec §5 — "Why this product" benefit bullets (feature→benefit), baked at
  // publish time. Empty by default (back-compat).
  why_bullets: z.array(z.string()).default([]),
});

// Chat-style copy block. Supports lightweight merge tags resolved at render
// time: @name, @email, @answer.<questionNodeId> (resolved to the picked
// answer's text). See app/components/runtime/MessageStep.tsx.
export const MessageData = z.object({
  text: z.string().min(1),
  supports_merge_tags: z.boolean().default(true),
});

// Terminal screen. Optional CTA opens in a new tab; optional redirect_url
// auto-navigates after a short delay.
export const EndData = z.object({
  headline: z.string().min(1),
  subtext: z.string().default(""),
  redirect_url: z.string().url().optional(),
  cta_label: z.string().optional(),
  cta_url: z.string().url().optional(),
});

// One named output slot on a Branch node. The slot's id is also used as the
// source_handle for outgoing edges so the runtime can pick the right target.
// In rules mode, edges from this slot fire when the slot's rule matches.
// In ab_split mode, the slot is chosen by weighted random and stuck for the
// session via sessionStorage.
export const BranchSlot = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  // Weighted random share. Only meaningful in ab_split mode.
  weight: z.number().int().min(0).default(1),
});
export type BranchSlot = z.infer<typeof BranchSlot>;

// Branch node — invisible to shoppers. The runtime auto-advances through it
// by picking an outgoing edge based on the configured mode. Used for
// rules-based steering (e.g. "if shopper picked the Oily answer, go to slot
// A; else B") and for A/B variant testing.
export const BranchData = z.object({
  label: z.string().default("Branch"),
  mode: z.enum(["rules", "ab_split"]).default("rules"),
  slots: z.array(BranchSlot).min(2),
});
export type BranchData = z.infer<typeof BranchData>;

// Outbound webhook action — fired server-side when the runtime reaches an
// integration node. The secret is sent as a custom header so receivers can
// verify the request actually came from this app (HMAC validation is the
// receiver's responsibility — we don't currently sign the body, just pass
// the secret verbatim for the receiver to match).
export const IntegrationWebhookAction = z.object({
  kind: z.literal("webhook"),
  url: z.string().url(),
  // Sent as the `X-Quizocalypse-Secret` header. Optional. Stored server-side
  // only — never echoed back to the storefront client.
  secret: z.string().optional(),
  // Friendly label so the merchant can tell webhooks apart in the canvas.
  label: z.string().default("Outbound webhook"),
});

// Klaviyo profile-sync action. Fires a Klaviyo Profile API upsert with the
// shopper's email + answers as custom properties so the merchant's email
// flows can segment on quiz responses. Requires a Klaviyo private API key
// scoped to Profile:Write; list_id optional (omit to just create/update the
// profile without list subscription).
export const IntegrationKlaviyoAction = z.object({
  kind: z.literal("klaviyo"),
  // Klaviyo private API key (pk_xxxxx). Stored server-side only.
  api_key: z.string().min(1),
  // Optional list ID — if set, the profile is subscribed to this list as
  // well as upserted. Klaviyo list IDs are 6-character codes.
  list_id: z.string().optional(),
  label: z.string().default("Klaviyo profile sync"),
});

export const IntegrationAction = z.discriminatedUnion("kind", [
  IntegrationWebhookAction,
  IntegrationKlaviyoAction,
]);
export type IntegrationAction = z.infer<typeof IntegrationAction>;

// Integration node — invisible to shoppers (like branch). When the runtime
// reaches one, the storefront POSTs to /q/:id/integration with the session
// payload; the server fires every configured action and the runtime
// auto-advances to the next node.
export const IntegrationData = z.object({
  label: z.string().default("Integration"),
  actions: z.array(IntegrationAction).min(1),
  // If true, runtime advances even if every action errored. Default: yes —
  // we don't want a broken Zapier endpoint to dead-end the shopper.
  continue_on_error: z.boolean().default(true),
});
export type IntegrationData = z.infer<typeof IntegrationData>;

// ProductCards — a visible step that showcases merchant-picked products.
// Distinct from result (which uses the recommendation engine on the path
// answers) and from the mid-quiz preview rail (which refines as answers
// accumulate). Useful for "before we move on, check these out" moments and
// for nudging upsells partway through.
export const ProductCardsData = z.object({
  headline: z.string().min(1),
  subtext: z.string().default(""),
  // Storefront product IDs to render as cards. Min 1, max 6 (UI gets
  // unwieldy beyond that).
  product_ids: z.array(z.string().min(1)).min(1).max(6),
  cta_label: z.string().default("Shop"),
  continue_label: z.string().default("Continue"),
});
export type ProductCardsData = z.infer<typeof ProductCardsData>;

// AskAI — multi-turn conversational layer. Renders a chat panel where the
// shopper can ask follow-up questions in natural language; Claude responds
// using merchant-provided system prompt + the quiz path context as grounding.
// Suggested questions seed the chat as one-click prompts. max_turns caps the
// conversation length so runaway sessions are bounded.
export const AskAIData = z.object({
  // Merchant-authored persona/instructions handed to Claude as the system
  // prompt. Should describe tone, do/don'ts, and link to product catalog.
  system_prompt: z.string().min(1),
  persona_name: z.string().default("Assistant"),
  // First assistant turn shown when the shopper arrives at this step.
  opening_message: z.string().min(1),
  // Optional pre-seeded user prompts shown as quick-reply chips.
  suggested_questions: z.array(z.string().min(1)).default([]),
  // Conservative default — enough for a meaningful exchange but not a
  // runaway. Each "turn" = one user message + one assistant reply.
  max_turns: z.number().int().min(1).max(20).default(6),
  // Button label shown once the shopper is ready to advance.
  continue_label: z.string().default("Continue"),
});
export type AskAIData = z.infer<typeof AskAIData>;

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
  z.object({
    id: z.string().min(1),
    type: z.literal("message"),
    position: Position,
    data: MessageData,
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("end"),
    position: Position,
    data: EndData,
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("branch"),
    position: Position,
    data: BranchData,
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("ask_ai"),
    position: Position,
    data: AskAIData,
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("integration"),
    position: Position,
    data: IntegrationData,
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("product_cards"),
    position: Position,
    data: ProductCardsData,
  }),
]);
export type QuizNode = z.infer<typeof QuizNode>;

// Edge condition for Branch routing (and back-compat with v1 question
// answer_id conditions). All fields are optional — a condition object with
// no field set is a no-op (always matches), but in practice you'd set one:
//  - answer_id: matches when the shopper picked this answer for the source
//    question. Legacy v1 shape, still supported.
//  - tag: matches when the accumulated path tags include this tag.
//  - ab_slot: matches when the Branch in ab_split mode rolled this slot.
export const EdgeCondition = z.object({
  answer_id: z.string().min(1).optional(),
  tag: z.string().min(1).optional(),
  ab_slot: z.string().min(1).optional(),
});
export type EdgeCondition = z.infer<typeof EdgeCondition>;

export const QuizEdge = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  source_handle: z.string().optional(),
  condition: EdgeCondition.optional(),
});

export const ResultPage = z.object({
  id: z.string().min(1),
  headline: z.string().min(1),
  subtext: z.string().default(""),
  product_ids: z.array(z.string()).default([]),
  match_strategy: MatchStrategy.default("top_n"),
  // When match_strategy === "archetype", the runtime returns products
  // from this category instead of running tag-overlap scoring. The
  // publisher resolves this id to an inlined product list so the
  // storefront doesn't need a DB lookup.
  category_id: z.string().min(1).optional(),
  // Baked at publish time from prisma.category.findUnique(category_id).
  // Storefront-facing — not authored by the merchant.
  category_product_ids: z.array(z.string()).optional(),
  // v3: baked category → productIds map for every category referenced by
  // the result node's ladder (category + points strategies). Lets the
  // points winner be resolved at runtime with no DB lookup.
  category_product_ids_map: z.record(z.string(), z.array(z.string())).optional(),
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

// Floating launcher config: when set + `enabled: true`, the storefront can
// embed /q/:id/launcher.js to render a floating button anywhere on the
// merchant's site. Clicking the button opens the quiz inside a modal iframe.
// Existing inline embedding via the Theme App Extension keeps working —
// this is an *additional* embed mode, not a replacement.
export const LauncherConfig = z.object({
  enabled: z.boolean().default(false),
  // The visible affordance the shopper clicks. Sparkle is the spec default;
  // star/chat are alternatives for stores that already use sparkle for AI.
  icon: z.enum(["sparkle", "star", "chat"]).default("sparkle"),
  // Pin corner. We keep this restricted — full positional control invites
  // overlap with merchant chrome.
  corner: z
    .enum(["bottom-right", "bottom-left", "top-right", "top-left"])
    .default("bottom-right"),
  // Button background color. Falls back to the quiz primary token when
  // unset so the launcher matches brand without extra config.
  color: z.string().optional(),
  // Optional pre-click pill label that draws attention. Empty hides it.
  label: z.string().default(""),
});
export type LauncherConfig = z.infer<typeof LauncherConfig>;

// ───────────────────────────────────────────────────────────────────────────
// Phase 2 — Content blocks (the visual builder's "Layout Library").
//
// Blocks are a PRESENTATION overlay, never a store of record. They live in a
// per-node map on the Quiz (`node_layouts`, below) keyed by node id, exactly
// like `design_overrides` / `breakpoint_overrides`. A node ABSENT from the map
// renders its fixed template exactly as before (byte-identical back-compat); a
// node PRESENT renders its block stack. The discriminated node union and every
// existing parser stay untouched.
//
// "Smart" blocks (answers / recommendations / email_input / ai_chat /
// product_grid) carry no data — they read the node's existing `data` and
// delegate to the same render + recommendation paths as the fixed template, so
// output is identical. "Literal" blocks (heading / text / image / button) can
// `bind` to a node data field (falling back to their own literal when absent).
// ───────────────────────────────────────────────────────────────────────────

// Per-block style overlay. Deliberately small + explicit (not the full
// DesignTokens) so it can't collide with the token cascade. Colors are kept as
// loose strings here and sanitized to hex at render time (blockStyle.ts).
export const BlockStyle = z
  .object({
    align: z.enum(["left", "center", "right"]),
    margin_top: z.number().int().min(0).max(160),
    margin_bottom: z.number().int().min(0).max(160),
    padding: z.number().int().min(0).max(160),
    max_width: z.number().int().min(80).max(1200),
    text_color: z.string(),
    background: z.string(),
    font_size: z.number().int().min(8).max(96),
    font_weight: z.number().int().min(100).max(900),
    radius: z.enum(["square", "rounded", "pill"]),
  })
  .partial();
export type BlockStyle = z.infer<typeof BlockStyle>;

// Closed bind enums keep the renderer total and the surface bounded. A bound
// block reads node.data[<bind>]; "none" (or a missing field) uses the literal.
export const HeadingBind = z.enum(["none", "headline", "text", "persona_name"]);
export const TextBind = z.enum(["none", "subtext", "text", "opening_message"]);
export const ButtonBind = z.enum([
  "none",
  "button_label", // intro
  "cta_label", // result / end / product_cards
  "continue_label", // product_cards / ask_ai
]);
export const ImageBind = z.enum(["none", "hero_image_url"]);

// Fields shared by every block. `id` is a layout-local stable id (React key +
// CSS-editor target via data-qz-block). `class_name` lets node_css target a
// block by a human name.
const blockBase = {
  id: z.string().min(1),
  class_name: z.string().max(64).optional(),
  style: BlockStyle.default({}),
};

// ── Literal blocks ─────────────────────────────────────────────────────────
export const HeadingBlock = z.object({
  ...blockBase,
  type: z.literal("heading"),
  level: z.enum(["h1", "h2"]).default("h2"),
  bind: HeadingBind.default("none"),
  text: z.string().default(""),
});
export const TextBlock = z.object({
  ...blockBase,
  type: z.literal("text"),
  bind: TextBind.default("none"),
  text: z.string().default(""),
  // Mirrors MessageData so a message-style block can resolve @name/@answer.<id>.
  supports_merge_tags: z.boolean().default(false),
});
export const ImageBlock = z.object({
  ...blockBase,
  type: z.literal("image"),
  bind: ImageBind.default("none"),
  url: z.string().url().optional(),
  alt: z.string().default(""),
  fit: z.enum(["cover", "contain"]).default("cover"),
  aspect: z.enum(["auto", "1/1", "4/3", "16/9"]).default("auto"),
});
export const SpacerBlock = z.object({
  ...blockBase,
  type: z.literal("spacer"),
  size: z.number().int().min(0).max(200).default(24),
});
export const DividerBlock = z.object({
  ...blockBase,
  type: z.literal("divider"),
  thickness: z.number().int().min(1).max(8).default(1),
  color: z.string().optional(),
});
export const ButtonBlock = z.object({
  ...blockBase,
  type: z.literal("button"),
  bind: ButtonBind.default("none"),
  label: z.string().default("Continue"),
  variant: z.enum(["primary", "outline", "ghost"]).default("primary"),
});

// ── Smart blocks (delegate to node data + the existing render/recs path) ─────
export const AnswersBlock = z.object({
  ...blockBase,
  type: z.literal("answers"),
  // "auto" reproduces the fixed template's layout for the node's question_type.
  layout: z.enum(["auto", "list", "grid"]).default("auto"),
});
export const RecommendationsBlock = z.object({
  ...blockBase,
  type: z.literal("recommendations"),
  // "all" = the full result / multi-stage stack; a stage id = just that stage.
  stage: z.string().default("all"),
});
export const EmailInputBlock = z.object({
  ...blockBase,
  type: z.literal("email_input"),
});
export const AiChatBlock = z.object({
  ...blockBase,
  type: z.literal("ai_chat"),
});
export const ProductGridBlock = z.object({
  ...blockBase,
  type: z.literal("product_grid"),
});

export const ContentBlock = z.discriminatedUnion("type", [
  HeadingBlock,
  TextBlock,
  ImageBlock,
  SpacerBlock,
  DividerBlock,
  ButtonBlock,
  AnswersBlock,
  RecommendationsBlock,
  EmailInputBlock,
  AiChatBlock,
  ProductGridBlock,
]);
export type ContentBlock = z.infer<typeof ContentBlock>;
export type ContentBlockType = ContentBlock["type"];

// Phase 5 — quiz-level discount on recommended products. Disabled by default
// (byte-identical back-compat). When enabled, the publisher creates a Shopify
// code discount and stores the generated `code` here; result pages opt into
// showing/applying it via the per-result `include_discount` flag.
export const DiscountConfig = z.object({
  enabled: z.boolean().default(false),
  kind: z.enum(["percentage", "amount"]).default("percentage"),
  // percent (clamped to 1–100 at discount-build time) when kind="percentage";
  // a fixed amount in the shop currency when kind="amount" (no upper bound).
  value: z.number().min(0).default(10),
  // Approximates "first purchase only" — Shopify caps the code at one use per
  // customer.
  once_per_customer: z.boolean().default(true),
  title: z.string().default("Quiz reward"),
  // Generated at publish (e.g. "QUIZ-AB12CD"); present once created.
  code: z.string().optional(),
});
export type DiscountConfig = z.infer<typeof DiscountConfig>;

export const Quiz = z.object({
  quiz_id: z.string().min(1),
  status: QuizStatus.default("draft"),
  scope: z.object({
    collection_ids: z.array(z.string()),
  }),
  // Optional collection ID for the mid-quiz preview cold-start. Used when
  // accumulated answer tags score zero against the candidate pool.
  featured_collection_id: z.string().optional(),
  // Dev Spec Phase 4 — how the published quiz appears on the storefront. The
  // standalone /q/:id is always a full page; this drives the Theme App Extension
  // embed mode + the publish embed hint. Optional (absent = "page") to stay
  // additive without forcing the field onto every existing Quiz literal.
  placement: z.enum(["page", "popup", "inline", "product_widget"]).optional(),
  nodes: z.array(QuizNode).min(2),
  edges: z.array(QuizEdge).default([]),
  results_pages: z.array(ResultPage).default([]),
  // v3 page-model posture. "shared" = all result nodes inherit one design
  // template (design_overrides["__shared_result__"]); "custom" = each
  // result node is independently editable (the pre-v3 behavior). Default
  // "custom" so existing quizzes are unchanged.
  result_layout_mode: z.enum(["shared", "custom"]).default("custom"),
  design_tokens: DesignTokens.default({}),
  design_overrides: z.record(z.string(), DesignTokens).default({}),
  // Per-breakpoint overrides on top of design_overrides. Synced edits write
  // to design_overrides; "edit Desktop" / "edit Mobile" in the drawer write
  // here. Spec §6.
  breakpoint_overrides: z
    .record(
      z.string(),
      z.object({
        desktop: DesignTokens.optional(),
        mobile: DesignTokens.optional(),
      }),
    )
    .default({}),
  // Phase 2 — visual builder. Per-node block stack. A node id PRESENT here is
  // rendered as a block stack; ABSENT renders its fixed template exactly as
  // before. Mirrors design_overrides/breakpoint_overrides (keyed by node id,
  // defaulted to {}), so the node union + every existing parser stay untouched
  // and existing quizzes are byte-identical (empty map = no behavior change).
  node_layouts: z.record(z.string(), z.array(ContentBlock)).default({}),
  // Phase 2 (paid) — per-node merchant CSS. Raw declaration/selector text,
  // scoped to the node root at render time (see app/components/runtime/
  // blockStyle.ts scopeNodeCss). Empty default = no CSS injected.
  node_css: z.record(z.string(), z.string()).default({}),
  // Phase 6: floating launcher embed mode. Disabled by default so existing
  // inline-embed quizzes don't suddenly grow a floating button.
  launcher_config: LauncherConfig.default({
    enabled: false,
    icon: "sparkle",
    corner: "bottom-right",
    label: "",
  }),
  // Phase 5 — quiz-level discount on recommended products. Defaults to disabled.
  discount_config: DiscountConfig.default({}),
});
export type Quiz = z.infer<typeof Quiz>;

// JSON Schema for Claude tool-use. Hand-written to match the Zod schema above
// (single source of truth in spirit; structurally duplicated to avoid pulling in
// zod-to-json-schema for one tool definition). Keep in sync with the Zod above.
export const quizToolJsonSchema = {
  type: "object",
  required: ["quiz_id", "scope", "nodes", "edges", "results_pages"],
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
            enum: [
              "intro",
              "question",
              "email_gate",
              "result",
              "message",
              "end",
              "branch",
              "ask_ai",
              "integration",
              "product_cards",
            ],
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
              "For type=question: { text, question_type ('single_select'|'multi_select'|'image_tile'|'text'|'email'|'searchable'|'image_picker'), required?, max_selections?, show_preview_after? (boolean, default false), input_config? ({ placeholder?, max_length? }) — used only for text/email types, answers: [{id, text, image_url?, tags[], collection_filter?, edge_handle_id}]. Card types (single_select/multi_select/image_tile/searchable/image_picker) require ≥2 answers; freeform types (text/email) need ≥1 seed answer for tag accumulation. }. " +
              "For type=email_gate: { headline, subtext?, email_required?, name_optional?, skip_allowed? }. " +
              "For type=result: { headline, subtext?, slot_count? (1..6), cta_label?, fallback_collection_id }. " +
              "For type=message: { text, supports_merge_tags? }. " +
              "For type=end: { headline, subtext?, redirect_url?, cta_label?, cta_url? }. " +
              "For type=branch: { label?, mode ('rules'|'ab_split'), slots: [{id, label, weight?}] (≥2 slots) }. Branch nodes auto-advance; outgoing edges must carry source_handle = slot id and an EdgeCondition (answer_id|tag|ab_slot). " +
              "For type=ask_ai: { system_prompt, persona_name?, opening_message, suggested_questions[]?, max_turns? (1..20, default 6), continue_label? }. Renders a chat panel; backend calls Claude with the path-derived context. " +
              "For type=integration: { label?, actions: [{kind:'webhook', url, secret?, label?}] (≥1), continue_on_error? (default true) }. Invisible node — runtime fires actions server-side then auto-advances. " +
              "For type=product_cards: { headline, subtext?, product_ids[] (1..6 storefront product IDs), cta_label?, continue_label? }. Visible step showcasing merchant-picked products.",
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
            properties: {
              answer_id: { type: "string" },
              tag: { type: "string" },
              ab_slot: { type: "string" },
            },
          },
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
          match_strategy: {
            type: "string",
            enum: ["top_n", "archetype", "points"],
          },
        },
      },
    },
    design_tokens: { type: "object" },
    design_overrides: { type: "object" },
  },
} as const;
