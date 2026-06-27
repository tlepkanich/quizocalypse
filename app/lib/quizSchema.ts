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
  // Phase F: a horizontal rating/Likert scale — a single-select rendered as a
  // compact row of buttons (1–N or labeled). Surfaces without a dedicated
  // renderer fall through to the default single-select render (still functional).
  "rating",
  // Phase F: swatch picker — single-select rendered as colour/material swatches
  // (card variant; uses each answer's image_url, else a neutral chip + label).
  "swatch",
  // Phase F: freeform numeric + date inputs — a typed value piggybacks on
  // answers[0], exactly like text/email. Registered in FREEFORM_QUESTION_TYPES
  // below so every freeform check picks them up from one source.
  "numeric",
  "date",
  // Phase F: a 0–100 slider — the slider position is a freeform value → seed answer.
  "slider",
]);
export type QuestionType = z.infer<typeof QuestionType>;

// Single source of truth for "freeform" question types — those that render a
// typed input (piggybacking on answers[0]) rather than a card/answer list.
// Every freeform check across runtime/builder/mutations imports this, so adding
// a freeform type is a one-line change here instead of N scattered edits.
export const FREEFORM_QUESTION_TYPES = ["text", "email", "numeric", "date", "slider"] as const;
export function isFreeformType(qt: string): boolean {
  return (FREEFORM_QUESTION_TYPES as readonly string[]).includes(qt);
}

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
  // Editor revamp P3 — an optional emoji icon rendered before the answer label
  // (all question types). 16 chars allows multi-codepoint emoji. Additive.
  icon: z.string().max(16).optional(),
  image_url: z.string().url().optional(),
  tags: z.array(z.string()).default([]),
  collection_filter: z.string().optional(),
  // Phase 5: an optional short video shown in the answer card (mp4/embed URL).
  video_url: z.string().url().optional(),
  edge_handle_id: z.string().min(1),
  // v3 points scoring: weights this answer contributes toward category ids
  // when a result page uses the "points" ladder strategy. categoryId →
  // weight. Optional — only present on quizzes that use points logic.
  // This is the ACTIVE store the engine + publish read (whichever scoring model
  // is current). `points_alt` is the dormant other model's data (see below).
  points: z.record(z.string(), z.number()).optional(),
  // Question-Builder spec — dual scoring storage: the INACTIVE scoring model's
  // weights, parked here so switching Direct↔Weighted preserves both. The engine
  // never reads this; swapScoringModel swaps points↔points_alt on a model change.
  points_alt: z.record(z.string(), z.number()).optional(),
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
  // B6 — an optional context/education image shown ABOVE the question text (any
  // type). Distinct from Answer.image_url (per-answer visuals) and Intro
  // hero_image_url. Additive — absent means no image, /q byte-stable.
  image_url: z.string().url().optional(),
  // Experiences E3 — named-chapter progress (the Jones Road "21 steps feel
  // like 3" pattern): consecutive questions sharing a section_label group
  // under one chapter header in the progress trail. Absent = classic pills.
  section_label: z.string().max(40).optional(),
  // Experiences E3 — one line of reassurance under the question text
  // ("There's no wrong answer — pick what feels like you."). Additive.
  helper_text: z.string().max(160).optional(),
  // Editor revamp P3 — explicit answer-grid column count (1 or 2). Unset keeps
  // the responsive default (2-up desktop, 1-up mobile). Additive.
  answer_columns: z.number().int().min(1).max(2).optional(),
  // B6 — scale config for rating / slider / numeric questions: a configurable
  // range + endpoint labels. All optional; absent = today's behavior exactly
  // (slider 0–100 step 1, numeric unbounded, rating flanked by nothing). Per-point
  // bucket mapping for rating is the existing answer→bucket mapping — each rating
  // button is a real Answer, so no new scoring field is needed. Slider/numeric
  // stay unscored (freeform seed); per-value→bucket is a deferred routing layer.
  scale_config: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
      step: z.number().positive().optional(),
      endpoint_label_min: z.string().max(40).optional(),
      endpoint_label_max: z.string().max(40).optional(),
    })
    .optional(),
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
      "rating",
      "swatch",
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

// Product ranking / sort order within a resolved pool. relevance = current
// tag-overlap score; newest = Product.updatedAt desc; best_seller /
// highest_rated read a merchant-mapped metafield, falling back to relevance
// when unmapped. The price_* / title_* modes sort on the baked price/title;
// "manual" keeps the resolved pool order (a collection's own Shopify sort)
// untouched. The Rec-Page spec's "Sort Order" dropdown maps onto this set:
//   Best Selling → best_seller, Newest → newest, Price ↑/↓ → price_asc/desc,
//   Title A→Z/Z→A → title_az/title_za, Manually Curated → manual.
export const ResultRanking = z.enum([
  "relevance",
  "newest",
  "best_seller",
  "highest_rated",
  "price_asc",
  "price_desc",
  "title_az",
  "title_za",
  "manual",
]);
export type ResultRanking = z.infer<typeof ResultRanking>;

// Out-of-stock handling for the resolved products.
//   hide            — drop OOS products from the list.
//   show_with_badge — keep them, muted, with an "Out of stock" badge.
//   notify_me       — keep them; the card's CTA becomes a "Notify Me" email
//                     capture (Rec-Page spec §5 per-product behavior).
//   fallback        — when ALL are OOS, swap in the OOS fallback collection.
export const OosBehavior = z.enum(["hide", "show_with_badge", "notify_me", "fallback"]);
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
  // Rec-Page spec §1 sub-filter — narrows the resolved pool to products that
  // ALSO carry this tag / sit in this collection. Drawn from the bucket's own
  // pool, not the full catalog. Both empty = use the full resolved pool.
  sub_filter_tag: z.string().optional(),
  sub_filter_collection_id: z.string().optional(),
  min_products: z.number().int().min(1).max(12).default(3),
  max_products: z.number().int().min(1).max(12).default(3),
  // Dev Spec §5 — feature→benefit "why this" bullets for the stage. Baked at publish.
  why_bullets: z.array(z.string()).default([]),
  // Experiences E4 — a quiet "talk to a human" link under the result. Partial
  // pairs are storable (two-field editing); rendering requires BOTH parts.
  escape_hatch: z
    .object({ label: z.string(), url: z.string() })
    .optional(),
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
  // Rec-Page spec §1 sub-filter for the single-section (Simple) page — narrows
  // the resolved pool to products that ALSO match this tag / collection.
  sub_filter_tag: z.string().optional(),
  sub_filter_collection_id: z.string().optional(),

  // ---- Rec-Page spec §2 product-display toggles (apply to all cards) ----
  // Inline variant selector on the card before Add to Cart. Off = the CTA
  // links to the PDP / opens the picker. Star ratings are a UI-only "coming
  // soon" placeholder (no field — the toggle is always disabled in the builder).
  show_variants: z.boolean().default(false),
  // Short Shopify product description beneath the title on each card.
  show_descriptions: z.boolean().default(false),
  // §2 Urgency: "Only X left in stock" beneath the title. Quantity is fetched
  // LIVE at results-page load (never baked) so it reflects real-time stock; the
  // badge only shows at/below the threshold and never when tracking is off.
  urgency_enabled: z.boolean().default(false),
  urgency_threshold: z.number().int().min(1).max(99).default(5),

  // ---- Rec-Page spec §6 page-structure toggles ----
  // Answer-summary chips above the sections ("Oily skin · Sensitive").
  results_summary_bar: z.boolean().default(false),
  // "Not what you were looking for? Retake the quiz" link.
  retake_link: z.boolean().default(false),
  // Share button that copies/native-shares the shopper's persistent results URL
  // (reconstructed server-side from the saved session — see /q/:id/results).
  share_results: z.boolean().default(false),

  // ---- Rec-Page spec §3 "Why we recommend this" copy ----
  // Mode A — one intro copy block above all sections (per bucket). Supports
  // {{token}} variables resolved at quiz-time ({{name}}, {{email}}, {{answers}},
  // {{answer.<questionNodeId>}}). AI/merchant authors a starting draft.
  why_intro_enabled: z.boolean().default(false),
  why_intro: z.string().default(""),
  // Mode B — short blurb beneath each product title. Map of product_id → blurb
  // (also supports {{token}} variables). Both modes can be active at once.
  why_blurbs_enabled: z.boolean().default(false),
  product_blurbs: z.record(z.string()).default({}),
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
  // Experiences E4 — a quiet "talk to a human" link under the result. Partial
  // pairs are storable (two-field editing); rendering requires BOTH parts.
  escape_hatch: z
    .object({ label: z.string(), url: z.string() })
    .optional(),
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
// A; else B"), for A/B variant testing, and for points-winner steering.
//   - rules:    first slot whose edge condition matches (author priority order).
//   - ab_split: weighted-random slot, sticky for the session.
//   - points:   the slot whose `condition.points_category` is the winning
//               category of the per-answer points tally (argmax). This routes
//               by PLURALITY across the whole path instead of first-match over
//               the accumulated-tag union, so every outcome stays reachable in
//               proportion to how often the shopper picked it. Falls back to the
//               first unconditioned slot when nothing scored.
export const BranchData = z.object({
  label: z.string().default("Branch"),
  mode: z.enum(["rules", "ab_split", "points"]).default("rules"),
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
//  - points_category: matches when this category id WINS the per-answer points
//    tally (pickPointsWinner). Only honored by a Branch in `points` mode; in
//    other modes it is inert (treated as no constraint).
export const EdgeCondition = z.object({
  answer_id: z.string().min(1).optional(),
  tag: z.string().min(1).optional(),
  ab_slot: z.string().min(1).optional(),
  points_category: z.string().min(1).optional(),
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
        // Filled surface for answer chips / soft panels (the minimal chrome's grey
        // cards). Absent → derived from `text` at low alpha so it adapts to any theme.
        surface: z.string(),
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
    // Card elevation — distinguishes flat editorial from lifted/glowing themes.
    shadow: z.enum(["none", "soft", "elevated"]).optional(),
    // BIC P8 (user opt-in): 2-column desktop result — pitch/headline/why left,
    // vertical product cards right. Absent/false = today's stacked layout, so
    // every existing quiz is unchanged. Mobile always stacks.
    result_split: z.boolean().optional(),
    // MQ program — shopper-runtime CHROME (structure, not colors): "classic" =
    // today's card + pill-trail + auto-advance; "minimal" = Quizell-style top
    // progress bar + "Question # N" + card-less grey-chip question + explicit
    // Back/Next + vertical product row. Absent → the runtime defaults by platform
    // (standalone → minimal, shopify → classic), so Shopify /q is untouched.
    chrome: z.enum(["classic", "minimal"]).optional(),
    // QP-2 — per-quiz page padding (Quizell's "Page Paddings"): the inset in px
    // from the viewport edge to the centered quiz content. Absent → the runtime's
    // default 24px (every existing quiz byte-identical via the var fallback); set →
    // emits `--qz-page-pad` on the runtime root, consumed by `.qz-runtime-page`.
    page_padding: z
      .object({
        top: z.number().min(0).max(240),
        right: z.number().min(0).max(240),
        bottom: z.number().min(0).max(240),
        left: z.number().min(0).max(240),
      })
      .optional(),
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
  // percentage / amount (fixed amount off) → discountCodeBasicCreate;
  // free_shipping → discountCodeFreeShippingCreate. (Shopify code discounts have
  // no "fixed price" type, so the spec's Fixed-price option is not offered.)
  kind: z.enum(["percentage", "amount", "free_shipping"]).default("percentage"),
  // percent (clamped to 1–100 at discount-build time) when kind="percentage";
  // a fixed amount in the shop currency when kind="amount" (no upper bound).
  // Ignored for free_shipping.
  value: z.number().min(0).default(10),
  // Rec-Page spec §4 "Applies to". For products/collections, the matching id
  // list scopes customerGets.items; "all" applies to the whole cart.
  applies_to: z.enum(["all", "collections", "products"]).default("all"),
  applies_collection_ids: z.array(z.string()).default([]),
  applies_product_ids: z.array(z.string()).default([]),
  // Approximates "first purchase only" — Shopify caps the code at one use per
  // customer.
  once_per_customer: z.boolean().default(true),
  // Spec §4 "Usage limits" → total redemption cap across all customers.
  // Undefined = unlimited.
  usage_limit: z.number().int().min(1).optional(),
  // Spec §4 "Expiry" → fixed end date (ISO). Undefined = no expiry. (A single
  // shared code can't express "X days after each shopper completes", so only a
  // fixed date is offered.)
  ends_at: z.string().optional(),
  // Spec §4 "Minimum order" → subtotal (shop currency) OR quantity. At most one
  // is meaningful; subtotal wins if both are set.
  minimum_subtotal: z.number().min(0).optional(),
  minimum_quantity: z.number().int().min(1).optional(),
  title: z.string().default("Quiz reward"),
  // Generated at publish (e.g. "QUIZ-AB12CD"); present once created.
  code: z.string().optional(),
});
export type DiscountConfig = z.infer<typeof DiscountConfig>;

// Rec-Page spec §7 — Global Fallback (No Bucket Match). Rendered when a result
// page resolves ZERO products. OPT-IN (enabled=false by default): the
// "truly-match → show nothing" behavior stays the default, so this never
// resurrects the removed generic per-result padding. A merchant turns it on
// only if they'd rather show evergreen picks than an empty state. The pool is
// drawn from a collection, a tag, and/or explicit product ids (union), capped
// at `count` and ordered best-effort by the page's own ranking.
export const GlobalFallback = z.object({
  enabled: z.boolean().default(false),
  heading: z.string().default("Our most-loved products"),
  collection_id: z.string().optional(),
  tag: z.string().optional(),
  product_ids: z.array(z.string()).default([]),
  count: z.number().int().min(1).max(12).default(4),
});
export type GlobalFallback = z.infer<typeof GlobalFallback>;

// ── Builder Re-work Step 1 — the creation funnel's scratch state ─────────────
// A lightweight AI-proposed quiz "direction" the merchant picks from at the end
// of Step 1 (no tags/answers — tag-correctness is the full build's job).
export const TemplateOption = z.object({
  id: z.string().min(1), // stable slug, e.g. "skin-goals-match"
  experience_type: z.enum(["product_match", "personality", "lead_capture", "survey"]),
  title: z.string().min(1), // the direction name on the card
  angle: z.string().min(1), // one-line pitch — how this quiz frames the journey
  rationale: z.string().default(""), // why it fits (shown on expand)
  sample_questions: z.array(z.string().min(1)).min(2).max(3),
});
export type TemplateOption = z.infer<typeof TemplateOption>;

// ── Builder Re-work Step 2 — enhanced template creation (the "battle card") ──
// Tier-1: an AI-surfaced quiz TYPE tailored to the brand (catalog + identity +
// optional web research). The merchant picks one before tier-2 templates generate.
export const QuizType = z.object({
  id: z.string().min(1), // stable slug, e.g. "vitamin-educator"
  experience_type: z.enum(["product_match", "personality", "lead_capture", "survey"]),
  name: z.string().min(1), // display name, e.g. "Educate Customers on Vitamins"
  achieves: z.string().min(1), // one-line "what it achieves"
  question_range: z.object({
    min: z.number().int().min(1).max(20),
    max: z.number().int().min(1).max(20),
  }),
  best_practice_note: z.string().default(""), // a real-pattern note for this category
  rationale: z.string().default(""), // why it fits THIS brand
  web_research_excerpt: z.string().default(""), // supporting snippet ("" when web research degraded)
});
export type QuizType = z.infer<typeof QuizType>;

// The four high-level design dials the merchant sets on a battle card. `lines`
// maps 1:1 to DesignTokens.radius (soft=pill, sharp=square, rounded=rounded);
// the other three become build-time generation directives (dialDirectives.ts).
export const DesignDials = z.object({
  imagery: z.enum(["high", "medium", "low"]).default("medium"),
  graphics: z.enum(["high", "medium", "low"]).default("medium"),
  word_forward: z.enum(["high", "medium", "low"]).default("medium"),
  lines: z.enum(["soft", "sharp", "rounded"]).default("rounded"),
});
export type DesignDials = z.infer<typeof DesignDials>;

// The battle card's recommendation-page settings (a subset of ResultData, applied
// to every built result node). The match-ladder is set by the build from the
// confirmed buckets — the merchant only tunes count / OOS / fallback here.
export const RecDefaults = z.object({
  max_products: z.number().int().min(1).max(12).default(3),
  oos_behavior: OosBehavior.default("show_with_badge"),
  fallback_collection_id: z.string().default(""),
});
export type RecDefaults = z.infer<typeof RecDefaults>;

// A recommended product group on the battle card — the confirmed buckets, with
// per-template enable toggles + product de-selection (template-scoped overrides
// applied to Category.productIds at build time, never mutating other quizzes).
export const RecommendedGroup = z.object({
  group_id: z.string(), // category id, or "manual"
  group_name: z.string().default(""),
  product_ids: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
});
export type RecommendedGroup = z.infer<typeof RecommendedGroup>;

// Tier-2: a rich AI-proposed template for the chosen type — TemplateOption plus
// the battle-card data (3 feature notes, design dials, rec defaults, count).
export const RichTemplateOption = TemplateOption.extend({
  feature_notes: z.array(z.string().min(1)).min(1).max(3),
  dials: DesignDials,
  rec_defaults: RecDefaults,
  recommended_bucket_ids: z.array(z.string()).default([]),
  question_count: z.number().int().min(3).max(20).default(6),
});
export type RichTemplateOption = z.infer<typeof RichTemplateOption>;

// The merchant's editable working copy of the chosen template (autosaved). Holds
// every battle-card edit; the build consumes THIS, not the AI's pristine option.
export const PickedTemplate = z.object({
  template_id: z.string().min(1),
  quiz_name: z.string().min(1), // auto-named, editable, never blank
  design_dials: DesignDials,
  rec_defaults: RecDefaults,
  recommended_groups: z.array(RecommendedGroup).default([]),
  feature_notes: z.array(z.string()).default([]),
  question_count: z.number().int().min(3).max(20).default(6),
  goal_line: z.string().default(""),
  saved_as_template: z.boolean().default(false),
});
export type PickedTemplate = z.infer<typeof PickedTemplate>;

// Transient multi-stage session state for the Step-1 funnel, parked on the DRAFT
// doc (resumes on refresh, quiz-scoped, discardable). NEVER published — stripped
// at publish (quizPublish.ts) since publishedJson spreads ...doc.
export const BuildSession = z.object({
  stage: z
    .enum([
      "grouping",
      "goal",
      // Re-sequenced funnel stages (the structured flow: Buckets → Shape →
      // Question Builder → Rec Page → Design → Overview → Generate). Additive;
      // the legacy stages below stay so in-flight drafts still render + resume
      // (app/lib/funnelStages.ts maps every stage to its visible step).
      "shape",
      "question_builder",
      "rec_page",
      "design",
      "overview",
      "generate",
      // Step-1 legacy stages — kept so any in-flight Step-1 draft still renders.
      "generating",
      "templates",
      // Step-2 stages: typing/templating are transient "AI in flight" (polled).
      "typing",
      "types",
      "templating",
      "configuring",
      "done",
    ])
    .default("grouping"),
  grouping: z
    .object({
      dimension: z.enum(["collection", "tag", "product_type", "metafield", "all"]),
      confirmed_category_ids: z.array(z.string()).default([]),
      detected_rationale: z.string().default(""),
    })
    .optional(),
  goal: z
    .object({
      goal_text: z.string().default(""),
      struggle_text: z.string().default(""), // feeds the identity's pain_points
    })
    .optional(),
  // Step-1 lightweight directions (superseded by Step 2's two-tier flow; retained
  // for back-compat of drafts mid-flight when Step 2 ships).
  template_options: z.array(TemplateOption).default([]),
  picked_option_id: z.string().optional(),
  // ── Step 2 — enhanced template creation ──
  quiz_types: z.array(QuizType).default([]), // tier-1 cards
  picked_type_id: z.string().optional(),
  rich_templates: z.array(RichTemplateOption).default([]), // tier-2 battle cards (pristine)
  picked_template: PickedTemplate.optional(), // the merchant's editable working copy
  web_research_summary: z.string().optional(),
  // Set when a detached AI generation job (types/templates) fails, so the funnel
  // can surface an honest banner + template fallback instead of silently reverting
  // the stage. Cleared on the next successful generation.
  gen_error: z.string().optional(),
  // True once the question build has run (re-architected flow: build happens
  // EARLY, at the Question Builder step). The Generate step reads this to decide
  // whether to OPEN the already-built draft (non-AI finalize) or run a real build
  // for a legacy in-flight draft that reached Overview the old way (no build yet).
  // Skipping the rebuild is critical — re-running applyQuestionFlow strips the
  // sb_ question nodes + reassigns answer ids, destroying every editing-step edit.
  built: z.boolean().optional(),
  // Recommendation Buckets (Step 1 rework) — the 3-tab catalog browser's UI state
  // that must survive a reload: which tab is active (the bucket type the quiz is
  // locked to) and whether the AI-suggestion banner has been dismissed this draft.
  // The actual buckets live as Category rows, not here.
  bucket_browser: z
    .object({
      active_tab: z.enum(["product", "tag", "collection"]).optional(),
      banner_dismissed: z.boolean().default(false),
    })
    .optional(),
});
export type BuildSession = z.infer<typeof BuildSession>;

export const Quiz = z.object({
  quiz_id: z.string().min(1),
  status: QuizStatus.default("draft"),
  scope: z.object({
    collection_ids: z.array(z.string()),
  }),
  // Optional collection ID for the mid-quiz preview cold-start. Used when
  // accumulated answer tags score zero against the candidate pool.
  featured_collection_id: z.string().optional(),
  // ISO 4217 currency code (e.g. "USD", "JPY") baked into publishedJson at
  // publish time from the synced catalog (see quizPublish.ts). The shopper
  // runtime formats every price/discount amount with it. Additive/optional:
  // pre-existing quizzes published before this field existed have no currency,
  // so the runtime falls back to USD until they are re-published.
  currency: z.string().optional(),
  // Dev Spec Phase 4 — how the published quiz appears on the storefront. The
  // standalone /q/:id is always a full page; this drives the Theme App Extension
  // embed mode + the publish embed hint. Optional (absent = "page") to stay
  // additive without forcing the field onto every existing Quiz literal.
  placement: z.enum(["page", "popup", "inline", "product_widget"]).optional(),
  // When true, the result page shows an inline email-capture block (Dev Spec
  // §5) that posts to /captures + fires email_captured. Additive/optional.
  collect_email_on_result: z.boolean().optional(),
  // Experiences E4 — shopper theater flags (all additive, default off):
  // show_recap: an answer-review screen before the first result render
  // ("Just making sure we're on the right track" + per-answer edit).
  show_recap: z.boolean().optional(),
  // results_reveal "computing": a ~4s staged reveal fed by the REAL explained
  // engine output (top tag-bag entries, pool size) — visible computation.
  results_reveal: z.enum(["instant", "computing"]).optional(),
  // show_match_reasons: ≤2 "Because you chose: <answer>" chips per product
  // card, mapped from each product's matched_tags back to the answer text.
  show_match_reasons: z.boolean().optional(),
  // Experiences E1 — what this quiz IS FOR. Drives type-aware guard rails
  // (validation), the creation flow, KPI emphasis, and (later) build shaping.
  // Absent = product_match, so every existing quiz keeps today's behavior.
  experience_type: z
    .enum(["product_match", "personality", "lead_capture", "survey"])
    .optional(),
  // Step 3 "Shape Your Quiz" — the scoring model the merchant picks for this
  // quiz. Both map onto the existing per-answer `points` engine:
  //   direct   — each answer awards points to exactly ONE bucket (weight 1);
  //              the winning bucket is the per-answer plurality (argmax).
  //   weighted — answers award points across MULTIPLE buckets with weights;
  //              same argmax tally, but overlapping attributes accumulate.
  // Absent = legacy/unset: the runtime keeps today's match-ladder behavior, so
  // every in-flight draft is unchanged until a merchant chooses on the Shape
  // step (the spec requires a conscious choice — no default is pre-selected).
  scoring_model: z.enum(["direct", "weighted"]).optional(),
  // Builder Re-work Step 1 — the creation funnel's transient scratch state
  // (grouping/goal/template-options). Additive/optional, lives only on DRAFTs,
  // and is STRIPPED at publish (see quizPublish.ts).
  build_session: BuildSession.optional(),
  // Phase K — per-locale translation overlays. Keyed by normalized locale
  // ("fr", "pt-br"); `strings` is a FLAT map over the stable key grammar
  // (node.<id>.<field>, answer.<nodeId>.<answerId>.<field>, stage/bullets/
  // suggested/placeholder/block keys, chrome.<token>, launcher.label — see
  // quizTranslate.ts). `source_hash` fingerprints the extracted English at
  // generation time so the editor can flag stale locales after copy edits.
  // Additive/optional (NEVER default {} — that would inject the field into
  // every doc on the next parse→write). The /q loader APPLIES the requested
  // locale server-side and STRIPS this field from the served payload.
  translations: z
    .record(
      z.string(),
      z.object({
        generated_at: z.string(),
        source_hash: z.string().optional(),
        strings: z.record(z.string(), z.string()),
      }),
    )
    .optional(),
  // Phase J — opt-in conversion-weighted scoring. When true, publish computes
  // per-answer conversion lift from QuizSession history and bakes it into
  // publishedJson.answer_weights (a publish-time field, like product_index);
  // the engine then lets converting answers count more in tag scoring.
  // Additive/optional, default off — existing quizzes are untouched.
  data_weighting: z.boolean().optional(),
  // BIC P7 — the review/FAQ source last used by the enrich-reviews intent, so
  // the merchant's paste survives reload and can be re-run. EDITOR-ONLY: the
  // public /q loader strips this before serving (review text must never ship
  // to shoppers). Additive/optional.
  review_enrichment_sources: z
    .object({
      text: z.string(),
      url: z.string().optional(),
      enriched_at: z.string(),
    })
    .optional(),
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
  // Rec-Page spec §7 — quiz-level no-bucket-match fallback. Defaults to disabled.
  // Parsed for back-compat only. The product goal is "no fit → no products", so
  // this is intentionally never resolved or rendered — no builder control and no
  // runtime fallback grid. See recommendationEngine.ts / QuizRuntime.tsx.
  global_fallback: GlobalFallback.default({}),
  // Rec-Page spec §5 — optional custom back-in-stock webhook. When set, "Notify
  // Me" captures are POSTed here in addition to being stored. Absent = store only.
  back_in_stock_webhook_url: z.string().url().optional(),
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
              "For type=branch: { label?, mode ('rules'|'ab_split'|'points'), slots: [{id, label, weight?}] (≥2 slots) }. Branch nodes auto-advance; outgoing edges must carry source_handle = slot id and an EdgeCondition (answer_id|tag|ab_slot|points_category). In 'points' mode the slot whose points_category wins the per-answer points tally fires (plurality routing). " +
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

// Experiences E1 — the effective experience type (absent = product_match,
// the historical default every pre-E1 quiz was implicitly built as).
export type ExperienceType = NonNullable<Quiz["experience_type"]>;
export function experienceTypeOf(doc: Pick<Quiz, "experience_type">): ExperienceType {
  return doc.experience_type ?? "product_match";
}
