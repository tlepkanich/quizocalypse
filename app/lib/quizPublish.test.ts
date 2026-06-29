import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { Quiz } from "./quizSchema";
import {
  collectReferencedCategoryIds,
  bakeResultPages,
  collectRecommendableProductIds,
  publishQuiz,
  shortDescription,
  stripPublicJsonPayload,
  type PublishedQuiz,
} from "./quizPublish";
import { recommendForResult, type IndexedProduct } from "./recommendationEngine";

// publishQuiz bakes "why this product" bullets (Call 3) and per-answer tooltips
// (Call 4) via Claude. Stub both to no-ops so the byte-stability roundtrip below
// neither hits the network nor adds tooltip_text/why_bullets to the doc — the
// guard asserts those fields stay ABSENT when the merchant never set them.
vi.mock("./claude", () => ({
  translateFeaturesToBenefits: vi.fn(async () => [] as string[]),
  generateAnswerTooltips: vi.fn(async () => ({}) as Record<string, string>),
}));

describe("stripPublicJsonPayload", () => {
  it("drops editor-only maps but preserves the public doc", () => {
    const payload = {
      quiz_id: "q1",
      nodes: [{ id: "intro" }],
      product_index: [{ product_id: "p1" }],
      review_enrichment_sources: { text: "secret pasted reviews", url: "x" },
      translations: { fr: { strings: { a: "Bonjour" } } },
    };
    const out = stripPublicJsonPayload(payload);
    expect(out).not.toHaveProperty("review_enrichment_sources");
    expect(out).not.toHaveProperty("translations");
    expect(out.quiz_id).toBe("q1");
    expect(out.nodes).toEqual([{ id: "intro" }]);
    expect(out.product_index).toEqual([{ product_id: "p1" }]);
  });

  it("is a no-op shape for a doc without the editor-only fields", () => {
    const out = stripPublicJsonPayload({ quiz_id: "q2", nodes: [] });
    expect(out).toEqual({ quiz_id: "q2", nodes: [] });
  });

  it("returns an empty object for non-object input", () => {
    expect(stripPublicJsonPayload(null)).toEqual({});
    expect(stripPublicJsonPayload("nope")).toEqual({});
  });
});

// A v3 quiz: result data lives on result NODES, results_pages is empty. This is
// what reconcile / Smart Build / templates / AI onboarding all produce.
function v3Doc(ladder: string[] = ["category"]) {
  return Quiz.parse({
    quiz_id: "q1",
    scope: { collection_ids: [] },
    nodes: [
      { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
      {
        id: "q1",
        type: "question",
        position: { x: 1, y: 0 },
        data: {
          text: "Pick",
          question_type: "single_select",
          answers: [
            { id: "a1", text: "A", tags: [], edge_handle_id: "h1" },
            { id: "a2", text: "B", tags: [], edge_handle_id: "h2" },
          ],
        },
      },
      {
        id: "r_dry",
        type: "result",
        position: { x: 2, y: 0 },
        data: {
          headline: "Dry skin picks",
          fallback_collection_id: "gid://shopify/Collection/fallback",
          category_id: "cat_dry",
          match_ladder: ladder,
        },
      },
    ],
    edges: [{ id: "e1", source: "intro", target: "q1" }],
  });
}

function product(id: string, collection: string): IndexedProduct {
  return {
    product_id: id,
    title: id,
    handle: id,
    price: "10.00",
    image_url: null,
    tags: [],
    collection_ids: [collection],
    inventory_in_stock: true,
  };
}

// The bucket's products live in a different collection from the fallback. The
// fallback collection is the "all snowboards" pool.
const INDEX: IndexedProduct[] = [
  product("p_cream", "gid://shopify/Collection/skincare"),
  product("p_serum", "gid://shopify/Collection/skincare"),
  product("snowboard_1", "gid://shopify/Collection/fallback"),
  product("snowboard_2", "gid://shopify/Collection/fallback"),
];

describe("shortDescription (result-card description bake)", () => {
  it("collapses whitespace and leaves short text intact", () => {
    expect(shortDescription("  Gentle   daily\n cleanser  ")).toBe("Gentle daily cleanser");
  });
  it("truncates at a word boundary with an ellipsis", () => {
    const long = "word ".repeat(80).trim(); // 400 chars
    const out = shortDescription(long, 50);
    expect(out.length).toBeLessThanOrEqual(51); // ≤ cap + ellipsis
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toContain("  ");
  });
  it("does not add an ellipsis when exactly at the cap", () => {
    const exact = "a".repeat(20);
    expect(shortDescription(exact, 20)).toBe(exact);
  });
});

describe("collectReferencedCategoryIds", () => {
  it("collects category ids from v3 result NODES (not just results_pages)", () => {
    expect([...collectReferencedCategoryIds(v3Doc())]).toContain("cat_dry");
  });

  it("includes points categories when a node ladder uses points", () => {
    const doc = Quiz.parse({
      ...v3Doc(["points"]),
      nodes: v3Doc(["points"]).nodes.map((n) =>
        n.id === "q1" && n.type === "question"
          ? {
              ...n,
              data: {
                ...n.data,
                answers: n.data.answers.map((a) =>
                  a.id === "a1" ? { ...a, points: { cat_points: 3 } } : a,
                ),
              },
            }
          : n,
      ),
    });
    const ids = collectReferencedCategoryIds(doc);
    expect(ids.has("cat_points")).toBe(true);
  });
});

describe("collectRecommendableProductIds (product_index must contain bucket products)", () => {
  it("unions bucket members so the index isn't starved (the snowboards root cause)", () => {
    // A quiz scoped to nothing, with a bucket pointing at skincare products that
    // are NOT in any scoped collection. Pre-fix, these never entered the index.
    const map = new Map([["cat_dry", ["p_cream", "p_serum"]]]);
    const ids = collectRecommendableProductIds(v3Doc(["category"]), map);
    expect(ids.has("p_cream")).toBe(true);
    expect(ids.has("p_serum")).toBe(true);
  });

  it("includes explicit conditional-rule product ids", () => {
    const base = v3Doc(["conditional"]);
    const doc = Quiz.parse({
      ...base,
      nodes: base.nodes.map((n) =>
        n.id === "r_dry" && n.type === "result"
          ? {
              ...n,
              data: {
                ...n.data,
                conditional_rules: [{ all_of: ["a1"], any_of: [], product_ids: ["p_special"] }],
              },
            }
          : n,
      ),
    });
    const ids = collectRecommendableProductIds(doc, new Map());
    expect(ids.has("p_special")).toBe(true);
  });

  it("is empty when nothing is bound", () => {
    expect(collectRecommendableProductIds(v3Doc(["tag"]), new Map()).size).toBe(0);
  });
});

describe("bakeResultPages", () => {
  it("synthesizes a results_pages entry per v3 result node carrying the category map", () => {
    const map = new Map([["cat_dry", ["p_cream", "p_serum"]]]);
    const baked = bakeResultPages(v3Doc(), map);
    const page = baked.find((p) => p.id === "r_dry");
    expect(page).toBeDefined();
    expect(page!.category_id).toBe("cat_dry");
    expect(page!.match_strategy).toBe("archetype");
    expect(page!.category_product_ids_map).toEqual({ cat_dry: ["p_cream", "p_serum"] });
  });
});

describe("recommendation actually listens to the rules (regression for 'always snowboards')", () => {
  it("category strategy returns the bucket's products, not the fallback collection", () => {
    const doc = v3Doc(["category"]);
    const map = new Map([["cat_dry", ["p_cream", "p_serum"]]]);
    // Bake results_pages the way publish now does, then run the engine.
    const published = Quiz.parse({ ...doc, results_pages: bakeResultPages(doc, map) });
    const recs = recommendForResult({
      quiz: published,
      productIndex: INDEX,
      selectedAnswerIds: ["a1"],
      resultNodeId: "r_dry",
    });
    expect(recs.map((r) => r.product_id).sort()).toEqual(["p_cream", "p_serum"]);
    // critically: NOT the fallback snowboards
    expect(recs.some((r) => r.product_id.startsWith("snowboard"))).toBe(false);
  });

  it("WITHOUT the baked map (the old bug) it falls through to the snowboard fallback", () => {
    // Simulate the pre-fix published doc: empty results_pages.
    const published = Quiz.parse({ ...v3Doc(["category"]), results_pages: [] });
    const recs = recommendForResult({
      quiz: published,
      productIndex: INDEX,
      selectedAnswerIds: ["a1"],
      resultNodeId: "r_dry",
    });
    // category resolves nothing → fallback collection (snowboards).
    expect(recs.every((r) => r.product_id.startsWith("snowboard"))).toBe(true);
  });
});

// Experiences E1 — a SURVEY (no result nodes, no products) must sail through
// the pure publish layers: result-page baking yields [] and never throws.
describe("survey publish tolerance (E1)", () => {
  it("bakeResultPages on a result-less doc returns [] cleanly", () => {
    const doc = Quiz.parse({
      quiz_id: "survey",
      scope: { collection_ids: [] },
      experience_type: "survey",
      nodes: [
        { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
        { id: "end", type: "end", position: { x: 200, y: 0 }, data: { headline: "Thanks" } },
      ],
      edges: [{ id: "e1", source: "intro", target: "end" }],
    });
    expect(bakeResultPages(doc, new Map())).toEqual([]);
  });
});

// H3 (production hardening) — the create-funnel programs (Design Settings,
// Experiences, Questions & Logic) added a wide spread of NET-NEW OPTIONAL fields.
// The whole program's invariant is: published `/q` stays BYTE-IDENTICAL for a
// quiz that leaves those fields unset. This is the cheapest durable guard: build
// a minimal product_match quiz with ALL of them unset, publish it for real, and
// assert every unset optional key is ABSENT from the wire payload (and that the
// draft-only scratch fields are stripped). A field that regresses to serializing
// when unset — e.g. a `.default()` slipped in where `.optional()` was meant —
// trips this test instead of silently re-bytes-ing every live quiz on deploy.
describe("publishQuiz — byte-stability when net-new optional fields are unset", () => {
  // intro → question → result; the result carries ONLY its required fallback.
  // No design tokens, no flags, no per-answer scoring/visuals — the leanest doc
  // that still passes validateQuiz for a product_match experience.
  function minimalDraft() {
    return {
      quiz_id: "q_stable",
      scope: { collection_ids: [] },
      // Draft-only scratch that MUST be stripped at publish (never egresses /q):
      build_session: {},
      review_enrichment_sources: {
        text: "merchant's pasted reviews — must never ship to shoppers",
        enriched_at: "2026-01-01T00:00:00.000Z",
      },
      nodes: [
        { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
        {
          id: "q1",
          type: "question",
          position: { x: 1, y: 0 },
          data: {
            text: "Pick one",
            question_type: "single_select",
            answers: [
              { id: "a1", text: "A", tags: [], edge_handle_id: "h1" },
              { id: "a2", text: "B", tags: [], edge_handle_id: "h2" },
            ],
          },
        },
        {
          id: "r1",
          type: "result",
          position: { x: 2, y: 0 },
          data: {
            headline: "Your match",
            fallback_collection_id: "gid://shopify/Collection/fallback",
          },
        },
      ],
      edges: [
        { id: "e1", source: "intro", target: "q1" },
        { id: "e2", source: "q1", target: "r1" },
      ],
    };
  }

  // A hand-rolled Prisma double that captures the publishedJson publishQuiz
  // writes, so we can inspect the EXACT wire payload with no DB. The empty
  // catalog + null shop tokens keep the bake side-effect-free.
  function mockPrisma(draftJson: unknown) {
    let captured: unknown;
    const prisma = {
      quiz: {
        findFirst: async () => ({ id: "q1row", version: 3, draftJson }),
        update: (args: { data: { publishedJson: unknown } }) => {
          captured = args.data.publishedJson;
          return { __op: "quiz.update" };
        },
      },
      category: { findMany: async () => [] },
      product: { findMany: async () => [] },
      shop: {
        findUnique: async () => ({
          brandTokens: null,
          shopDomain: "test.myshopify.com",
          brandGuidelines: null,
          source: "shopify",
        }),
      },
      quizSession: { findMany: async () => [] },
      quizVersion: {
        create: () => ({ __op: "quizVersion.create" }),
        findMany: async () => [],
      },
      $transaction: (ops: ReadonlyArray<unknown>) => Promise.all(ops),
    };
    return { prisma: prisma as unknown as PrismaClient, getCaptured: () => captured };
  }

  it("strips draft scratch + omits every unset net-new optional key from publishedJson", async () => {
    const { prisma, getCaptured } = mockPrisma(minimalDraft());
    const result = await publishQuiz(prisma, { quizId: "q1row", shopId: "shop1" });
    expect(result.ok).toBe(true);

    // The wire form is what /q actually serves — the JSON round-trip drops every
    // `undefined` key, so asserting on `wire` is a true byte-stability check
    // (immune to whether Zod retains an absent-optional as an `undefined` key).
    const wire = JSON.parse(JSON.stringify(getCaptured())) as PublishedQuiz;

    // (1) Draft-only scratch is stripped — must never reach a published quiz.
    expect(wire).not.toHaveProperty("build_session");
    expect(wire).not.toHaveProperty("review_enrichment_sources");

    // (2) Every UNSET net-new root-level optional is absent → byte-identical /q.
    for (const key of [
      "placement",
      "collect_email_on_result",
      "scoring_model",
      "data_weighting",
      "rec_page_design",
      "show_recap",
      "results_reveal",
      "show_match_reasons",
      "experience_type",
      "featured_collection_id",
      "translations",
      "currency",
      "answer_weights",
      "star_ratings_enabled",
    ]) {
      expect(wire, `root.${key} must be absent when unset`).not.toHaveProperty(key);
    }

    // (3) design_linked ALWAYS serializes — `z.boolean().default(true)`, in
    // publishedJson since D0; the de-link runtime reads it on result nodes. This
    // is INTENTIONAL, not a byte-stability bug, so the guard pins its presence.
    expect(wire.design_linked).toBe(true);
    // result_split is a DesignTokens field with no default → absent on the
    // resolved tokens unless a layer set it (it didn't here).
    expect(wire.design_tokens).not.toHaveProperty("result_split");

    // (4) Result-node data: the unset E4 optional stays absent.
    const resultNode = wire.nodes.find((n) => n.type === "result");
    expect(resultNode).toBeDefined();
    expect(resultNode!.data).not.toHaveProperty("escape_hatch");

    // (5) Question-node data: unset Design/Experiences/QL optionals stay absent.
    const qNode = wire.nodes.find((n) => n.type === "question");
    expect(qNode).toBeDefined();
    for (const key of [
      "education_card_before",
      "section_label",
      "helper_text",
      "answer_columns",
      "scale_config",
      "ai_generated",
      "image_url",
    ]) {
      expect(qNode!.data, `question.data.${key} must be absent when unset`).not.toHaveProperty(key);
    }

    // (6) Answers: unset per-answer visuals + scoring sidecars stay absent (the
    // regenerate-merge carries these only when present — see regenerateMerge.ts).
    const answers = qNode!.type === "question" ? qNode!.data.answers : [];
    expect(answers.length).toBe(2);
    for (const a of answers) {
      for (const key of [
        "tooltip_text",
        "icon",
        "image_url",
        "collection_filter",
        "video_url",
        "points",
        "points_alt",
      ]) {
        expect(a, `answer.${key} must be absent when unset`).not.toHaveProperty(key);
      }
    }
  });
});
