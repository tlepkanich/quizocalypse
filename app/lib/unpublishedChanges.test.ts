import { describe, it, expect } from "vitest";
import { Quiz } from "./quizSchema";
import { resolveDesignTokens } from "./designTokens";
import { countUnpublishedChanges } from "./unpublishedChanges";

// ════════════════════════════════════════════════════════════════════════════
// QRTZ-F4 — countUnpublishedChanges: the honest doc-diff behind the top bar's
// "Draft · N unpublished" pill. The load-bearing invariants:
//   • identical docs → 0;
//   • a FRESH PUBLISH reads 0 (strip list + bake fields + AI copy fills +
//     resolved design tokens are all tolerated);
//   • one merchant-recognizable unit = one count (per node; design /
//     rec_page_settings / edges / settings groups are one unit each).
// ════════════════════════════════════════════════════════════════════════════

type QuizDoc = Quiz;

function makeDoc(): QuizDoc {
  const q = (id: string) => ({
    id,
    type: "question" as const,
    position: { x: 0, y: 0 },
    data: {
      text: `Question ${id}`,
      question_type: "single_select" as const,
      required: true,
      show_preview_after: false,
      answers: [
        { id: `${id}_a1`, text: "o1", tags: [], edge_handle_id: `${id}_h1` },
        { id: `${id}_a2`, text: "o2", tags: [], edge_handle_id: `${id}_h2` },
      ],
    },
  });
  return Quiz.parse({
    quiz_id: "q1",
    scope: { collection_ids: [] },
    nodes: [
      { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
      q("q1"),
      q("q2"),
      {
        id: "r1",
        type: "result",
        position: { x: 0, y: 0 },
        data: { headline: "Done", fallback_collection_id: "gid://c/fb" },
      },
    ],
    edges: [
      { id: "e0", source: "intro", target: "q1" },
      { id: "e1", source: "q1", target: "q2" },
      { id: "e2", source: "q2", target: "r1" },
    ],
  });
}

// Simulate quizPublish's bake on a draft: strip the draft-only scratch,
// override the publish-owned fields, resolve the token cascade, fill the AI
// copy where the draft's is empty, and add the bake-only (non-schema) fields.
// Mirrors quizPublish.ts's publishedJson assembly closely enough to prove the
// fresh-publish-reads-0 tolerance.
function simulatePublish(draft: QuizDoc): QuizDoc {
  const {
    build_session: _bs,
    review_enrichment_sources: _res,
    why_copy_meta: _wcm,
    path_report_ai: _pra,
    chapters: _ch,
    ...rest
  } = draft;
  void _bs;
  void _res;
  void _wcm;
  void _pra;
  void _ch;
  const bakedNodes = draft.nodes.map((n) => {
    if (n.type === "result" && n.data.why_bullets.length === 0) {
      return { ...n, data: { ...n.data, why_bullets: ["AI benefit one", "AI benefit two"] } };
    }
    if (n.type === "question") {
      return {
        ...n,
        data: {
          ...n.data,
          answers: n.data.answers.map((a) =>
            a.tooltip_text ? a : { ...a, tooltip_text: `AI tip for ${a.id}` },
          ),
        },
      };
    }
    return n;
  });
  const published = {
    ...rest,
    nodes: bakedNodes,
    // publish injects category maps / synthesizes node entries here — any
    // shape must be tolerated (results_pages is publish-owned).
    results_pages: [
      {
        id: "r1",
        headline: "Done",
        product_ids: [],
        match_strategy: "top_n",
        category_product_ids_map: { cat_1: ["p1", "p2"] },
      },
    ],
    status: "published",
    design_tokens: resolveDesignTokens(null, draft.design_tokens),
    currency: "USD",
    // bake-only additions (not Quiz-schema fields; Quiz.parse strips them,
    // matching the loader's safeParse of publishedJson)
    product_index: [{ product_id: "p1", title: "P1" }],
    published_at: new Date().toISOString(),
    version: 3,
    shop_domain: "test.myshopify.com",
    platform: "shopify",
    answer_weights: { a1: 1.2 },
    target_product_ids_map: { t1: ["p1"] },
    target_index: { t1: { type: "collection", name: "T1" } },
  };
  return Quiz.parse(published);
}

describe("countUnpublishedChanges", () => {
  it("identical docs → 0", () => {
    expect(countUnpublishedChanges(makeDoc(), makeDoc())).toBe(0);
  });

  it("a fresh publish reads 0 (strip list, bake fields, AI fills, resolved tokens)", () => {
    const draft = makeDoc();
    draft.build_session = { stage: "grouping" } as QuizDoc["build_session"];
    draft.why_copy_meta = { __global__: { at: "2026-01-01", members: "x" } };
    const published = simulatePublish(draft);
    expect(countUnpublishedChanges(draft, published)).toBe(0);
  });

  it("one node text edit → 1", () => {
    const draft = makeDoc();
    const published = simulatePublish(makeDoc());
    const q1 = draft.nodes.find((n) => n.id === "q1");
    if (q1?.type !== "question") throw new Error("fixture");
    q1.data.text = "Edited question";
    expect(countUnpublishedChanges(draft, published)).toBe(1);
  });

  it("node added + tokens changed → 2", () => {
    const draft = makeDoc();
    const published = simulatePublish(makeDoc());
    draft.nodes.push({
      id: "q3",
      type: "question",
      position: { x: 0, y: 0 },
      data: {
        text: "New question",
        question_type: "single_select",
        required: true,
        show_preview_after: false,
        answers: [
          { id: "q3_a1", text: "o1", tags: [], edge_handle_id: "q3_h1" },
        ],
      },
    } as QuizDoc["nodes"][number]);
    draft.design_tokens = { colors: { primary: "#ff0000" } };
    expect(countUnpublishedChanges(draft, published)).toBe(2);
  });

  it("node removed → 1", () => {
    const draft = makeDoc();
    const published = simulatePublish(makeDoc());
    draft.nodes = draft.nodes.filter((n) => n.id !== "q2");
    draft.edges = draft.edges.filter((e) => e.source !== "q2" && e.target !== "q2");
    draft.edges.push({ id: "e9", source: "q1", target: "r1" });
    // removed node (1) + rerouted edges (1)
    expect(countUnpublishedChanges(draft, published)).toBe(2);
  });

  it("a node edit + the same node's layout/style satellite → still 1 unit", () => {
    const draft = makeDoc();
    const published = simulatePublish(makeDoc());
    const q1 = draft.nodes.find((n) => n.id === "q1");
    if (q1?.type !== "question") throw new Error("fixture");
    q1.data.text = "Edited";
    draft.design_overrides = { q1: { colors: { primary: "#00ff00" } } };
    expect(countUnpublishedChanges(draft, published)).toBe(1);
  });

  it("a satellite-only change (node_css) counts that node once", () => {
    const draft = makeDoc();
    const published = simulatePublish(makeDoc());
    draft.node_css = { q2: ".x { color: red }" };
    expect(countUnpublishedChanges(draft, published)).toBe(1);
  });

  it("the shared-result design template counts as the design unit", () => {
    const draft = makeDoc();
    const published = simulatePublish(makeDoc());
    draft.design_overrides = { __shared_result__: { radius: "square" } };
    expect(countUnpublishedChanges(draft, published)).toBe(1);
  });

  it("edges change → 1; a settings change (placement) → 1 more", () => {
    const draft = makeDoc();
    const published = simulatePublish(makeDoc());
    draft.edges = draft.edges.map((e) =>
      e.id === "e2" ? { ...e, target: "q1" } : e,
    );
    expect(countUnpublishedChanges(draft, published)).toBe(1);
    draft.placement = "popup";
    expect(countUnpublishedChanges(draft, published)).toBe(2);
  });

  it("many settings edits still count as ONE settings unit", () => {
    const draft = makeDoc();
    const published = simulatePublish(makeDoc());
    draft.placement = "popup";
    draft.show_recap = true;
    draft.data_weighting = true;
    expect(countUnpublishedChanges(draft, published)).toBe(1);
  });

  it("merchant-authored why_bullets that differ from the published copy DO count", () => {
    const draft = makeDoc();
    const published = simulatePublish(makeDoc());
    const r1 = draft.nodes.find((n) => n.id === "r1");
    if (r1?.type !== "result") throw new Error("fixture");
    r1.data.why_bullets = ["Hand-written bullet"];
    expect(countUnpublishedChanges(draft, published)).toBe(1);
  });

  it("respects the shop brand layer when provided (fresh publish with brand → 0)", () => {
    const draft = makeDoc();
    const shopBrandTokens = { colors: { primary: "#123456" } };
    const published = {
      ...simulatePublish(draft),
      design_tokens: resolveDesignTokens(shopBrandTokens, draft.design_tokens),
    };
    expect(
      countUnpublishedChanges(draft, Quiz.parse(published), { shopBrandTokens }),
    ).toBe(0);
    // …and a brand change since publish honestly reads as one design change.
    expect(
      countUnpublishedChanges(draft, Quiz.parse(published), {
        shopBrandTokens: { colors: { primary: "#654321" } },
      }),
    ).toBe(1);
  });

  it("decider chrome default is mirrored (fresh decider publish → 0)", () => {
    const draft = makeDoc();
    draft.logic_model = "decider";
    const resolved = resolveDesignTokens(null, draft.design_tokens);
    resolved.chrome = "minimal";
    const published = { ...simulatePublish(draft), design_tokens: resolved };
    expect(countUnpublishedChanges(draft, Quiz.parse(published))).toBe(0);
  });
});
