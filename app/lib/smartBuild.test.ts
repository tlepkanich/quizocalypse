import { describe, expect, it } from "vitest";
import { Quiz } from "./quizSchema";
import { resolveNextStep, pickPointsWinner, type BranchContext } from "./recommendationEngine";
import { orderFlow } from "./flowOrder";
import { buildSeedQuiz } from "./seedQuiz";
import { validateQuiz } from "./quizValidation";
import {
  applyQuestionFlow,
  applyDeciderQuestionFlow,
  applyManualDeciderSkeleton,
  normalizeQuestionSpec,
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

// Points routing keys off the SELECTED answers (the points tally), not the
// accumulated-tag union — so build the context from picked answer ids.
const ctx = (selectedIds: string[]): BranchContext => ({
  accumulatedTags: new Set<string>(),
  selectedAnswerIds: new Set(selectedIds),
  abAssignments: {},
});

// The answer id on question `qid` whose tags include `tag`.
const answerIdByTag = (
  doc: ReturnType<typeof baseDoc>,
  qid: string,
  tag: string,
): string => {
  const q = doc.nodes.find((n) => n.id === qid);
  if (!q || q.type !== "question") throw new Error(`no question ${qid}`);
  const a = q.data.answers.find((x) => x.tags.includes(tag));
  if (!a) throw new Error(`no "${tag}" answer on ${qid}`);
  return a.id;
};

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

  it("routes shoppers to the winning bucket page via the real engine (plurality)", () => {
    const next = applyQuestionFlow(baseDoc(), gen, buckets);
    const dry = answerIdByTag(next, "sb_q_1", "dry");
    const oily = answerIdByTag(next, "sb_q_1", "oily");
    // The picked answer makes its bucket the points winner → that bucket's page.
    expect(resolveNextStep(next, "sb_q_2", null, ctx([dry]))).toBe("r_dry");
    expect(resolveNextStep(next, "sb_q_2", null, ctx([oily]))).toBe("r_oily");
    // nothing picked → no points winner → unconditioned default slot → first bucket
    expect(resolveNextStep(next, "sb_q_2", null, ctx([]))).toBe("r_dry");
  });

  it("builds a points branch: one points-conditioned edge per bucket + an unconditioned default", () => {
    const next = applyQuestionFlow(baseDoc(), gen, buckets);
    const branch = next.nodes.find((n) => n.id === "sb_br");
    expect(branch?.type === "branch" && branch.data.mode).toBe("points");
    const branchEdges = next.edges.filter((e) => e.source === "sb_br");
    expect(branchEdges).toHaveLength(3); // 2 buckets + default
    expect(
      branchEdges.find((e) => e.target === "r_dry" && e.condition?.points_category === "cat_dry"),
    ).toBeDefined();
    expect(
      branchEdges.find((e) => e.target === "r_oily" && e.condition?.points_category === "cat_oily"),
    ).toBeDefined();
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

  it("routes by the points floor when answers carry no tags", () => {
    const next = applyQuestionFlow(baseDoc(), noTagGen, noTagBuckets);

    // The first question's answers, in order, map to the bucket slots.
    const q1 = next.nodes.find((n) => n.id === "sb_q_1");
    if (!q1 || q1.type !== "question") throw new Error("no sb_q_1");
    const [a0, a1] = q1.data.answers;

    // The branch routes by points-winner plurality, not a tag union or answer_id.
    const branch = next.nodes.find((n) => n.id === "sb_br");
    expect(branch?.type === "branch" && branch.data.mode).toBe("points");
    const dryEdge = next.edges.find((e) => e.source === "sb_br" && e.target === "r_dry");
    const oilyEdge = next.edges.find((e) => e.source === "sb_br" && e.target === "r_oily");
    expect(dryEdge?.condition?.points_category).toBe("cat_dry");
    expect(oilyEdge?.condition?.points_category).toBe("cat_oily");
    expect(dryEdge?.condition?.tag).toBeUndefined();
    expect(dryEdge?.condition?.answer_id).toBeUndefined();

    // Points floor: each answer carries points toward a distinct bucket, so
    // `pickPointsWinner` (and therefore the route + products) discriminates by
    // answer even with empty tags.
    expect(Object.keys(a0!.points ?? {})).toEqual(["cat_dry"]);
    expect(Object.keys(a1!.points ?? {})).toEqual(["cat_oily"]);
    expect(pickPointsWinner(next, [a0!.id])).toBe("cat_dry");
    expect(pickPointsWinner(next, [a1!.id])).toBe("cat_oily");

    // End-to-end: the engine routes the picked answer to its bucket page.
    expect(resolveNextStep(next, "sb_q_1", null, ctx([a0!.id]))).toBe("r_dry");
    expect(resolveNextStep(next, "sb_q_1", null, ctx([a1!.id]))).toBe("r_oily");
  });

  it("seeds points from tags when the answers carry them (tag-rich → argmax)", () => {
    const next = applyQuestionFlow(baseDoc(), gen, buckets); // gen + buckets HAVE tags
    const dryEdge = next.edges.find((e) => e.source === "sb_br" && e.target === "r_dry");
    // Routing condition is still the bucket's points category…
    expect(dryEdge?.condition?.points_category).toBe("cat_dry");
    expect(dryEdge?.condition?.tag).toBeUndefined();
    // …but the dry answer's points come from tag overlap, not the floor.
    const q1 = next.nodes.find((n) => n.id === "sb_q_1");
    if (!q1 || q1.type !== "question") throw new Error("no sb_q_1");
    const dryAns = q1.data.answers.find((a) => a.tags.includes("dry"))!;
    expect(dryAns.points?.cat_dry).toBeGreaterThanOrEqual(1);
    expect(pickPointsWinner(next, [dryAns.id])).toBe("cat_dry");
  });
});

// Regression for the archetype-reachability collapse: a 6-question quiz where
// every question offers one answer per archetype used to route a first-match
// rules branch over the accumulated-tag UNION, so slot 1 won ~73.8% of the
// 5^6 paths and slot 5 won 1 path (0.006%). `points` plurality routing makes
// every archetype page reachable in rough proportion. See app/lib/smartBuild.ts.
describe("archetype reachability — 5^6 landing-page distribution", () => {
  const ARCH = ["beauty", "acne", "blush", "dry-skin", "foundation"];
  function archetypeDoc() {
    const doc = Quiz.parse({
      quiz_id: "skin",
      scope: { collection_ids: [] },
      nodes: [
        { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
        ...ARCH.map((a, i) => ({
          id: `r_${a}`,
          type: "result" as const,
          position: { x: 900, y: i * 100 },
          data: { headline: a, fallback_collection_id: FB, category_id: `cat_${a}`, match_ladder: ["category"] },
        })),
      ],
      edges: [],
    });
    const archBuckets: SmartBuildBucket[] = ARCH.map((a) => ({
      id: `cat_${a}`,
      name: a,
      tags: [a],
      resultNodeId: `r_${a}`,
    }));
    const archGen: GeneratedQuestionFlow = {
      questions: Array.from({ length: 6 }, (_, qi) => ({
        text: `Q${qi + 1}`,
        question_type: "single_select",
        answers: ARCH.map((a) => ({ text: a, tags: [a] })),
      })),
    };
    return applyQuestionFlow(doc, archGen, archBuckets);
  }

  it("reaches every archetype page in rough proportion (≈ even, none dead)", () => {
    const doc = archetypeDoc();
    const qNodes = doc.nodes
      .filter((n) => n.id.startsWith("sb_q_"))
      .sort((a, b) => a.id.localeCompare(b.id));
    const answersPerQ = qNodes.map((n) => (n.type === "question" ? n.data.answers : []));
    const N = ARCH.length; // 5
    const Q = qNodes.length; // 6
    const total = N ** Q; // 15625
    const tally = new Map<string, number>();
    for (let combo = 0; combo < total; combo++) {
      const c: BranchContext = {
        accumulatedTags: new Set<string>(),
        selectedAnswerIds: new Set<string>(),
        abAssignments: {},
      };
      let rest = combo;
      let current: string | null = qNodes[0]!.id;
      let qi = 0;
      while (current) {
        const cur: string = current;
        const node = doc.nodes.find((n) => n.id === cur);
        if (!node) break;
        if (node.type === "question") {
          const ans = answersPerQ[qi]![rest % N]!;
          rest = Math.floor(rest / N);
          c.selectedAnswerIds.add(ans.id);
          for (const t of ans.tags) c.accumulatedTags.add(t);
          current = resolveNextStep(doc, node.id, ans.edge_handle_id ?? null, c);
          qi++;
          continue;
        }
        if (node.type === "result") {
          tally.set(cur, (tally.get(cur) ?? 0) + 1);
          break;
        }
        current = resolveNextStep(doc, node.id, null, c);
      }
    }

    // Every archetype page is reached…
    for (const a of ARCH) expect(tally.get(`r_${a}`) ?? 0).toBeGreaterThan(0);
    const counts = ARCH.map((a) => tally.get(`r_${a}`) ?? 0);
    expect(counts.reduce((s, n) => s + n, 0)).toBe(total);
    // …in a tight, near-even band (the old branch was 73.8% vs 0.006%).
    const lo = total * 0.15;
    const hi = total * 0.25;
    for (const n of counts) {
      expect(n).toBeGreaterThanOrEqual(lo);
      expect(n).toBeLessThanOrEqual(hi);
    }
    // The formerly-dead slot-5 page (foundation) is now fully reachable.
    expect(tally.get("r_foundation") ?? 0).toBeGreaterThan(total * 0.15);
  });
});

describe("normalizeQuestionSpec (BIC P3)", () => {
  it("downgrades rating-with-categorical/money answers to single_select", () => {
    const out = normalizeQuestionSpec({
      text: "What are you shopping for today?",
      question_type: "rating",
      answers: [
        { text: "Snow sports gear", tags: [] },
        { text: "Beauty & skincare", tags: [] },
      ],
    });
    expect(out.question_type).toBe("single_select");
    const money = normalizeQuestionSpec({
      text: "Budget?",
      question_type: "rating",
      answers: [
        { text: "$0–25", tags: [] },
        { text: "$25–50", tags: [] },
      ],
    });
    expect(money.question_type).toBe("single_select");
  });

  it("keeps a genuine Likert scale as rating", () => {
    const out = normalizeQuestionSpec({
      text: "How experienced are you?",
      question_type: "rating",
      answers: [
        { text: "1", tags: [] },
        { text: "2", tags: [] },
        { text: "3", tags: [] },
      ],
    });
    expect(out.question_type).toBe("rating");
  });

  it("downgrades swatch when any answer lacks an image", () => {
    const out = normalizeQuestionSpec({
      text: "Pick a shade",
      question_type: "swatch",
      answers: [
        { text: "Rose", tags: [], image_url: "https://x/r.png" },
        { text: "Sand", tags: [] },
      ],
    });
    expect(out.question_type).toBe("single_select");
  });
});

// Experiences E2 — bucket-less wiring (survey / lead-capture builds).
describe("applyQuestionFlow with no buckets (E2)", () => {
  it("skips the branch and terminates at an end node", () => {
    const seed = buildSeedQuiz("Survey", "survey");
    const generated = {
      questions: [
        {
          text: "How did we do?",
          question_type: "single_select" as const,
          answers: [
            { text: "Great", tags: [] },
            { text: "Fine", tags: [] },
          ],
        },
      ],
    };
    const out = applyQuestionFlow(seed, generated as never, []);
    expect(out.nodes.some((n) => n.type === "branch")).toBe(false);
    expect(out.nodes.some((n) => n.type === "result")).toBe(false);
    const end = out.nodes.find((n) => n.type === "end");
    expect(end).toBeTruthy();
    // The chain reaches the end node (validateQuiz finds no dead ends).
    expect(validateQuiz(out)).toEqual([]);
  });
});

// LOGIC v2 (L2-10c) — the decider sibling merge.
describe("applyDeciderQuestionFlow", () => {
  const deciderBuckets = [
    { id: "cat_dry", tags: ["dry"] },
    { id: "cat_oily", tags: ["oily"] },
  ];
  const generatedDecider = {
    questions: [
      {
        text: "What's your skin type?",
        question_type: "single_select" as const,
        answers: [
          { text: "Dry", tags: ["dry"] },
          { text: "Oily", tags: ["oily"] },
        ],
      },
      {
        text: "How often do you moisturize?",
        question_type: "single_select" as const,
        answers: [
          { text: "Daily", tags: [] },
          { text: "Rarely", tags: [] },
        ],
      },
    ],
    email_gate: { headline: "Get your results", subtext: "Email first" },
  };

  function build() {
    const seed = Quiz.parse({ ...buildSeedQuiz("Decider"), logic_model: "decider" });
    return applyDeciderQuestionFlow(seed, generatedDecider as never, deciderBuckets, FB);
  }

  it("builds a valid decider doc: one decider (required + mapped), qualifiers, ONE result", () => {
    const out = build();
    expect(() => Quiz.parse(out)).not.toThrow();
    expect(out.logic_model).toBe("decider");

    const questions = out.nodes.filter((n) => n.type === "question");
    const deciders = questions.filter((n) => n.type === "question" && n.data.role === "decides");
    expect(deciders).toHaveLength(1); // V1
    const decider = deciders[0]!;
    if (decider.type !== "question") throw new Error("unreachable");
    expect(decider.data.required).toBe(true); // V3
    expect(decider.data.text).toBe("What's your skin type?"); // 2 distinct targets beats 0
    // EVERY deciding answer carries a target (V4 by construction).
    expect(decider.data.answers.every((a) => Boolean(a.target_id))).toBe(true);
    expect(decider.data.answers.map((a) => a.target_id)).toEqual(["cat_dry", "cat_oily"]);
    // Qualifiers assign nothing.
    const qualifier = questions.find((n) => n.type === "question" && n.data.role === "qualifier");
    expect(qualifier).toBeTruthy();
    if (qualifier?.type === "question") {
      expect(qualifier.data.answers.every((a) => !a.target_id)).toBe(true);
    }
    // NO points anywhere (decider docs are free of legacy scoring).
    expect(
      questions.every(
        (n) => n.type === "question" && n.data.answers.every((a) => !a.points),
      ),
    ).toBe(true);

    // ONE result node, seeded with the required fallback; no branch; no end.
    const results = out.nodes.filter((n) => n.type === "result");
    expect(results).toHaveLength(1);
    if (results[0]!.type === "result") {
      expect(results[0]!.data.fallback_collection_id).toBe(FB);
    }
    expect(out.nodes.some((n) => n.type === "branch")).toBe(false);

    // The generated email gate is DROPPED (§7 capture owns contact).
    expect(out.nodes.some((n) => n.type === "email_gate")).toBe(false);

    // Sparse rec_page_settings seeded with the §6 fallback.
    expect(out.rec_page_settings?.global).toEqual({ emptyFallbackCol: FB });

    // The whole doc passes validation (V1–V4 + structure).
    expect(validateQuiz(out)).toEqual([]);
  });

  it("is idempotent — re-running rebuilds the same shape without duplicates", () => {
    const once = build();
    const twice = applyDeciderQuestionFlow(once, generatedDecider as never, deciderBuckets, FB);
    expect(twice.nodes.filter((n) => n.type === "result")).toHaveLength(1);
    expect(twice.nodes.filter((n) => n.type === "question")).toHaveLength(2);
    expect(validateQuiz(twice)).toEqual([]);
  });
});

// L2-10c review fixes — the coercion + threaded-settings guarantees.
describe("applyDeciderQuestionFlow — review-hardened edges", () => {
  const deciderBuckets = [
    { id: "cat_dry", tags: ["dry"] },
    { id: "cat_oily", tags: ["oily"] },
  ];

  it("no eligible decider → COERCES the first non-freeform question to single_select", () => {
    const seed = Quiz.parse({ ...buildSeedQuiz("Decider"), logic_model: "decider" });
    const allMulti = {
      questions: [
        {
          text: "Pick all that apply",
          question_type: "multi_select" as const,
          answers: [
            { text: "Dry", tags: ["dry"] },
            { text: "Oily", tags: ["oily"] },
          ],
        },
      ],
    };
    const out = applyDeciderQuestionFlow(seed, allMulti as never, deciderBuckets, FB);
    const q = out.nodes.find((n) => n.type === "question");
    if (q?.type !== "question") throw new Error("question missing");
    expect(q.data.question_type).toBe("single_select"); // coerced
    expect(q.data.role).toBe("decides"); // elected
    expect(q.data.answers.every((a) => Boolean(a.target_id))).toBe(true);
    expect(validateQuiz(out)).toEqual([]); // V1 satisfied — never a silent publish failure
  });

  it("respects settings the caller threaded onto the seed (never overwrites merchant config)", () => {
    const seed = Quiz.parse({
      ...buildSeedQuiz("Decider"),
      logic_model: "decider",
      rec_page_settings: { global: { capturePhone: true }, overrides: {} },
    });
    const generated = {
      questions: [
        {
          text: "Skin type?",
          question_type: "single_select" as const,
          answers: [
            { text: "Dry", tags: ["dry"] },
            { text: "Oily", tags: ["oily"] },
          ],
        },
      ],
    };
    const out = applyDeciderQuestionFlow(seed, generated as never, deciderBuckets, FB);
    expect(out.rec_page_settings?.global).toEqual({ capturePhone: true });
  });
});

describe("applyManualDeciderSkeleton (SR — blank/failed-goal decider drafts)", () => {

  it("stamps decider + appends one result (with the required fallback) wired from the last question", () => {
    const seed = Quiz.parse(buildSeedQuiz("Manual"));
    const out = applyManualDeciderSkeleton(seed, FB);
    expect(() => Quiz.parse(out)).not.toThrow();
    expect(out.logic_model).toBe("decider");

    const results = out.nodes.filter((n) => n.type === "result");
    expect(results).toHaveLength(1);
    expect(results[0]?.type === "result" && results[0].data.fallback_collection_id).toBe(FB);

    const lastQuestion = [...seed.nodes].reverse().find((n) => n.type === "question");
    const edge = out.edges.find((e) => e.target === "sb_result");
    expect(edge?.source).toBe(lastQuestion?.id);
  });

  it("seeds sparse rec_page_settings only when absent (never clobbers a merchant config)", () => {
    const seed = Quiz.parse(buildSeedQuiz("Manual"));
    const fresh = applyManualDeciderSkeleton(seed, FB);
    expect(fresh.rec_page_settings).toEqual({ global: { emptyFallbackCol: FB }, overrides: {} });

    const configured = Quiz.parse({
      ...buildSeedQuiz("Manual"),
      rec_page_settings: { global: { capturePhone: true }, overrides: {} },
    });
    const out = applyManualDeciderSkeleton(configured, FB);
    expect(out.rec_page_settings?.global).toEqual({ capturePhone: true });
  });

  it("is a stamp-only no-op on a doc that already has a result node (idempotent)", () => {
    const seed = Quiz.parse(buildSeedQuiz("Manual"));
    const once = applyManualDeciderSkeleton(seed, FB);
    const twice = applyManualDeciderSkeleton(once, FB);
    expect(twice.nodes).toEqual(once.nodes);
    expect(twice.edges).toEqual(once.edges);
  });
});
