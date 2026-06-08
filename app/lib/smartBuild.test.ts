import { describe, expect, it } from "vitest";
import { Quiz } from "./quizSchema";
import { resolveNextStep, pickPointsWinner, type BranchContext } from "./recommendationEngine";
import { orderFlow } from "./flowOrder";
import {
  applyQuestionFlow,
  type GeneratedQuestionFlow,
  type SmartBuildBucket,
} from "./smartBuild";

const FB = "gid://shopify/Collection/1";

function baseDoc(extraNodes: unknown[] = [], extraEdges: unknown[] = []) {
  return Quiz.parse({
    quiz_id: "q1",
    scope: { collection_ids: [] },
    nodes: [
      { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
      {
        id: "r_dry",
        type: "result",
        position: { x: 900, y: 0 },
        data: { headline: "Dry", fallback_collection_id: FB, category_id: "cat_dry", match_ladder: ["category"] },
      },
      {
        id: "r_oily",
        type: "result",
        position: { x: 900, y: 200 },
        data: { headline: "Oily", fallback_collection_id: FB, category_id: "cat_oily", match_ladder: ["category"] },
      },
      ...extraNodes,
    ],
    edges: [...extraEdges],
  });
}

const buckets: SmartBuildBucket[] = [
  { id: "cat_dry", name: "Dry", tags: ["dry", "dehydrated"], resultNodeId: "r_dry" },
  { id: "cat_oily", name: "Oily", tags: ["oily", "acne"], resultNodeId: "r_oily" },
];

const gen: GeneratedQuestionFlow = {
  questions: [
    {
      text: "How does your skin feel?",
      question_type: "single_select",
      answers: [
        { text: "Tight & flaky", tags: ["dry"] },
        { text: "Shiny & breakouts", tags: ["oily"] },
      ],
    },
    {
      text: "Main concern?",
      question_type: "single_select",
      answers: [
        { text: "Hydration", tags: ["dehydrated"] },
        { text: "Blemishes", tags: ["acne"] },
      ],
    },
  ],
};

const ctx = (tags: string[]): BranchContext => ({
  accumulatedTags: new Set(tags),
  selectedAnswerIds: new Set<string>(),
  abAssignments: {},
});

const sbNodes = (doc: ReturnType<typeof baseDoc>) =>
  doc.nodes.filter((n) => n.id.startsWith("sb_"));

describe("applyQuestionFlow", () => {
  it("inserts questions + a routing branch and re-validates", () => {
    const next = applyQuestionFlow(baseDoc(), gen, buckets);
    expect(next.nodes.filter((n) => n.id.startsWith("sb_q_"))).toHaveLength(2);
    expect(next.nodes.some((n) => n.type === "branch" && n.id === "sb_br")).toBe(true);
    expect(() => Quiz.parse(next)).not.toThrow();
  });

  it("places at most one AI education card (Dev Spec §6) — first non-empty wins, trimmed", () => {
    const genCards: GeneratedQuestionFlow = {
      questions: [
        { ...gen.questions[0]!, education_card_before: "  Retinol is a vitamin-A derivative.  " },
        { ...gen.questions[1]!, education_card_before: "This second card must be ignored." },
      ],
    };
    const next = applyQuestionFlow(baseDoc(), genCards, buckets);
    const q1 = next.nodes.find((n) => n.id === "sb_q_1");
    const q2 = next.nodes.find((n) => n.id === "sb_q_2");
    expect(
      q1?.type === "question" && (q1.data as { education_card_before?: string }).education_card_before,
    ).toBe("Retinol is a vitamin-A derivative.");
    expect(
      q2?.type === "question" && (q2.data as { education_card_before?: string }).education_card_before,
    ).toBeUndefined();
    expect(() => Quiz.parse(next)).not.toThrow();
  });

  it("places no education card when none is supplied", () => {
    const next = applyQuestionFlow(baseDoc(), gen, buckets);
    const q1 = next.nodes.find((n) => n.id === "sb_q_1");
    expect(
      q1?.type === "question" && (q1.data as { education_card_before?: string }).education_card_before,
    ).toBeUndefined();
  });

  it("routes shoppers to the right bucket page via the real engine", () => {
    const next = applyQuestionFlow(baseDoc(), gen, buckets);
    expect(resolveNextStep(next, "sb_q_2", null, ctx(["dry"]))).toBe("r_dry");
    expect(resolveNextStep(next, "sb_q_2", null, ctx(["oily"]))).toBe("r_oily");
    // no tags accumulated → unconditioned default slot → first bucket
    expect(resolveNextStep(next, "sb_q_2", null, ctx([]))).toBe("r_dry");
  });

  it("builds one conditioned edge per bucket + an unconditioned default", () => {
    const next = applyQuestionFlow(baseDoc(), gen, buckets);
    const branchEdges = next.edges.filter((e) => e.source === "sb_br");
    expect(branchEdges).toHaveLength(3); // 2 buckets + default
    expect(branchEdges.find((e) => e.target === "r_dry" && e.condition?.tag === "dry")).toBeDefined();
    expect(branchEdges.find((e) => e.target === "r_oily" && e.condition?.tag === "oily")).toBeDefined();
    const def = branchEdges.find((e) => e.source_handle === "sb_sl_default");
    expect(def?.condition).toBeUndefined();
  });

  it("seeds answer points so pickPointsWinner resolves the bucket", () => {
    const next = applyQuestionFlow(baseDoc(), gen, buckets);
    const q1 = next.nodes.find((n) => n.id === "sb_q_1");
    expect(q1 && q1.type === "question").toBe(true);
    if (!q1 || q1.type !== "question") return;
    const dryAns = q1.data.answers.find((a) => a.tags.includes("dry"));
    expect(dryAns?.points?.["cat_dry"]).toBeGreaterThanOrEqual(1);
    expect(pickPointsWinner(next, [dryAns!.id])).toBe("cat_dry");
  });

  it("sets each bucket result ladder to category then points", () => {
    const next = applyQuestionFlow(baseDoc(), gen, buckets);
    const r = next.nodes.find((n) => n.id === "r_dry");
    expect(r && r.type === "result" && r.data.match_ladder).toEqual(["category", "points"]);
  });

  it("is idempotent — re-run keeps the same sb_ node count + leaves intro/results identical", () => {
    const once = applyQuestionFlow(baseDoc(), gen, buckets);
    const twice = applyQuestionFlow(once, gen, buckets);
    expect(sbNodes(twice)).toHaveLength(sbNodes(once).length);
    expect(twice.nodes.find((n) => n.id === "intro")).toEqual(once.nodes.find((n) => n.id === "intro"));
    expect(twice.nodes.find((n) => n.id === "r_dry")).toEqual(once.nodes.find((n) => n.id === "r_dry"));
    expect(() => Quiz.parse(twice)).not.toThrow();
  });

  it("rebuilds cleanly when the bucket set changes", () => {
    const doc3 = baseDoc([
      {
        id: "r_comb",
        type: "result",
        position: { x: 900, y: 400 },
        data: { headline: "Combination", fallback_collection_id: FB, category_id: "cat_comb", match_ladder: ["category"] },
      },
    ]);
    const once = applyQuestionFlow(doc3, gen, buckets); // 2 buckets
    const buckets3: SmartBuildBucket[] = [
      ...buckets,
      { id: "cat_comb", name: "Combination", tags: ["combination"], resultNodeId: "r_comb" },
    ];
    const twice = applyQuestionFlow(once, gen, buckets3); // 3 buckets
    const br = twice.nodes.find((n) => n.id === "sb_br");
    expect(br && br.type === "branch" && br.data.slots).toHaveLength(4); // 3 buckets + default
  });

  it("replaces manual/template question nodes (Smart Build owns the flow)", () => {
    const docM = baseDoc(
      [
        {
          id: "q_manual",
          type: "question",
          position: { x: 320, y: 300 },
          data: {
            text: "Manual",
            question_type: "single_select",
            answers: [
              { id: "a_m1", text: "X", edge_handle_id: "h_m1" },
              { id: "a_m2", text: "Y", edge_handle_id: "h_m2" },
            ],
          },
        },
      ],
      [{ id: "e_m", source: "intro", target: "q_manual" }],
    );
    const next = applyQuestionFlow(docM, gen, buckets);
    expect(next.nodes.some((n) => n.id === "q_manual")).toBe(false);
  });

  it("keeps manual CONTENT steps (e.g. a message) reachable", () => {
    const docM = baseDoc(
      [
        {
          id: "m_manual",
          type: "message",
          position: { x: 320, y: 300 },
          data: { text: "Welcome!", supports_merge_tags: true },
        },
      ],
      [{ id: "e_m", source: "intro", target: "m_manual" }],
    );
    const next = applyQuestionFlow(docM, gen, buckets);
    expect(next.nodes.some((n) => n.id === "m_manual")).toBe(true);
    expect(orderFlow(next).orphans).not.toContain("m_manual");
  });

  it("leaves NO unreachable steps — even with an unbound extra result page", () => {
    const docExtra = baseDoc([
      {
        id: "r_extra",
        type: "result",
        position: { x: 900, y: 600 },
        data: { headline: "Spare", fallback_collection_id: FB }, // no category_id → not a bucket
      },
      {
        id: "ai_manual",
        type: "ask_ai",
        position: { x: 320, y: 500 },
        data: { persona_name: "Aria", opening_message: "Hi", system_prompt: "Be helpful" },
      },
    ]);
    const next = applyQuestionFlow(docExtra, gen, buckets);
    expect(orderFlow(next).orphans).toEqual([]);
    // the spare result is reachable but inert (never-matching condition)
    const extraEdge = next.edges.find((e) => e.source === "sb_br" && e.target === "r_extra");
    expect(extraEdge?.condition?.tag).toBe("__sb_unrouted__");
  });
});

describe("tag-independent routing (tag-poor catalog → no more 'same products every path')", () => {
  // Buckets + answers with EMPTY tags — exactly the live failure mode.
  const noTagBuckets: SmartBuildBucket[] = [
    { id: "cat_dry", name: "Dry", tags: [], resultNodeId: "r_dry" },
    { id: "cat_oily", name: "Oily", tags: [], resultNodeId: "r_oily" },
  ];
  const noTagGen: GeneratedQuestionFlow = {
    questions: [
      {
        text: "How does your skin feel?",
        question_type: "single_select",
        answers: [{ text: "Tight" }, { text: "Shiny" }].map((a) => ({ ...a, tags: [] })),
      },
    ],
  };

  it("routes by answer_id when there are no tags, and seeds a points floor", () => {
    const next = applyQuestionFlow(baseDoc(), noTagGen, noTagBuckets);

    // The first question's answers, in order, map to the bucket slots.
    const q1 = next.nodes.find((n) => n.id === "sb_q_1");
    if (!q1 || q1.type !== "question") throw new Error("no sb_q_1");
    const [a0, a1] = q1.data.answers;

    const dryEdge = next.edges.find((e) => e.source === "sb_br" && e.target === "r_dry");
    const oilyEdge = next.edges.find((e) => e.source === "sb_br" && e.target === "r_oily");
    // Tag-independent: routing rides on the selected answer, not a tag.
    expect(dryEdge?.condition?.answer_id).toBe(a0!.id);
    expect(oilyEdge?.condition?.answer_id).toBe(a1!.id);
    expect(dryEdge?.condition?.tag).toBeUndefined();

    // Points floor: each answer now carries points toward a distinct bucket, so
    // `pickPointsWinner` discriminates by answer even with empty tags.
    expect(Object.keys(a0!.points ?? {})).toEqual(["cat_dry"]);
    expect(Object.keys(a1!.points ?? {})).toEqual(["cat_oily"]);
    expect(pickPointsWinner(next, [a0!.id])).toBe("cat_dry");
    expect(pickPointsWinner(next, [a1!.id])).toBe("cat_oily");
  });

  it("still prefers a real tag condition when the answers carry one", () => {
    const next = applyQuestionFlow(baseDoc(), gen, buckets); // gen + buckets HAVE tags
    const dryEdge = next.edges.find((e) => e.source === "sb_br" && e.target === "r_dry");
    expect(dryEdge?.condition?.tag).toBe("dry");
    expect(dryEdge?.condition?.answer_id).toBeUndefined();
  });
});
