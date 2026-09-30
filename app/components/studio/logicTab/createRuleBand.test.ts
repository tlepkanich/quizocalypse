import { describe, expect, it } from "vitest";
import type { DecisionRule, Quiz } from "../../../lib/quizSchema";
import type { BuilderCategory } from "../../builder/stepProps";
import { normalizeDecisionRule } from "../../../lib/quizMutations";
import { impossibleAllOf } from "../../../lib/pathAnalyzer";
import {
  batches,
  blankDraft,
  catalogCounts,
  catalogRows,
  draftAction,
  draftConditions,
  draftFromRule,
  draftToRule,
  inQuizKeySet,
  mapEnsureResponse,
  productsWord,
  questionTypeTag,
  quizUsedRefs,
  removeDraftQuestion,
  rulesWord,
  ruleTargetIds,
  sameStoredRule,
  splitRecommendationGroups,
  stylesVerbs,
  toggleDraftAll,
  toggleDraftAnswer,
  toggleDraftNot,
} from "./createRuleBand";

function cat(id: string, extra: Partial<BuilderCategory> = {}): BuilderCategory {
  return {
    id,
    name: id,
    description: "",
    tags: [],
    productIds: [],
    source: "ai",
    sourceRef: null,
    quizId: "q",
    ...extra,
  };
}

type QNode = Extract<Quiz["nodes"][number], { type: "question" }>;
function qnode(id: string, type: string, answers: string[], extra: Record<string, unknown> = {}): QNode {
  return {
    id,
    type: "question",
    position: { x: 0, y: 0 },
    data: {
      text: `${id}?`,
      question_type: type,
      answers: answers.map((t, i) => ({ id: `${id}a${i}`, text: t, tags: [] })),
      ...extra,
    },
  } as unknown as QNode;
}

const Q1 = qnode("q1", "single_select", ["Shiny", "Blotchy", "Tight"]);
const Q2 = qnode("q2", "multi_select", ["Forehead", "Cheeks", "Chin"], { max_selections: 2 });
const Q3 = qnode("q3", "rating", ["1", "2", "3", "4", "5"], { scale_config: { min: 1, max: 5 } });
const DOC = {
  logic_model: "decider",
  nodes: [Q1, Q2, Q3],
  edges: [],
  decision_rules: [],
} as unknown as Quiz;
const ROWS = [
  { id: "q1", multi: false },
  { id: "q2", multi: true },
  { id: "q3", multi: false },
];

describe("ruleTargetIds", () => {
  it("prefers target_ids and falls back to the single target_id byte-form", () => {
    expect(ruleTargetIds({ target_id: "a", target_ids: ["a", "b"] })).toEqual(["a", "b"]);
    expect(ruleTargetIds({ target_id: "a" })).toEqual(["a"]);
    expect(ruleTargetIds({ target_id: "a", target_ids: [] as unknown as [string] })).toEqual(["a"]);
  });
});

describe("splitRecommendationGroups", () => {
  it("puts uncovered recommendations first, each half in category order", () => {
    const cats = [cat("acne"), cat("firming"), cat("barrier"), cat("glow")];
    const covered = new Set(["acne", "barrier"]);
    const { needs, done } = splitRecommendationGroups(cats, (id) => covered.has(id));
    expect(needs.map((c) => c.id)).toEqual(["firming", "glow"]);
    expect(done.map((c) => c.id)).toEqual(["acne", "barrier"]);
  });
});

describe("quizUsedRefs", () => {
  const doc = {
    nodes: [
      {
        type: "question",
        data: {
          answers: [
            {
              tags: [" retinoid ", "peptide", ""],
              collection_filter: "col-1",
              collection_filters: ["col-2"],
              metafield_filters: [{ key: "custom.texture", value: "rich" }],
            },
            { tags: ["peptide"] },
          ],
        },
      },
      { type: "intro", data: {} },
    ],
  } as unknown as Quiz;

  it("collects trimmed tags, both collection fields and metafields as key: value", () => {
    const used = quizUsedRefs(doc, []);
    expect([...used.tags]).toEqual(["retinoid", "peptide"]);
    expect([...used.collections]).toEqual(["col-1", "col-2"]);
    expect([...used.metafields]).toEqual(["custom.texture: rich"]);
    expect(used.products.size).toBe(0);
  });

  it("adds the groups' products and the refs of materialised tag/collection groups", () => {
    const used = quizUsedRefs(doc, [
      cat("g1", { productIds: ["p1", "p2"] }),
      cat("g2", { source: "tag", sourceRef: "fragrance-free", productIds: ["p2"] }),
      cat("g3", { source: "collection", sourceRef: "col-9" }),
    ]);
    expect([...used.products]).toEqual(["p1", "p2"]);
    expect(used.tags.has("fragrance-free")).toBe(true);
    expect(used.collections.has("col-9")).toBe(true);
  });
});

describe("words", () => {
  it("pluralise", () => {
    expect(rulesWord(1)).toBe("1 rule");
    expect(rulesWord(3)).toBe("3 rules");
    expect(productsWord(1)).toBe("1 product");
    expect(productsWord(0)).toBe("0 products");
  });
});

describe("questionTypeTag (mock typeMeta)", () => {
  it("tags every non-single type", () => {
    expect(questionTypeTag(Q1)).toBeNull();
    expect(questionTypeTag(Q2)).toBe("Multi-select · pick 1–2");
    expect(questionTypeTag(qnode("m", "multi_select", ["a", "b"], { min_selections: 2, max_selections: 2 }))).toBe(
      "Multi-select · pick 2",
    );
    expect(questionTypeTag(Q3)).toBe("Five-point scale");
    expect(questionTypeTag(qnode("s", "rating", ["1", "2", "3", "4", "5", "6", "7"]))).toBe("Scale · 1–7");
    expect(questionTypeTag(qnode("i", "image_tile", ["a"]))).toBe("Image select");
  });
});

describe("the style's verbs (D2)", () => {
  it("Rules only offers Show alone; Filter offers Show, Pin, Hide", () => {
    expect(stylesVerbs("rules")).toEqual(["show"]);
    expect(stylesVerbs("attributes")).toEqual(["show", "pin", "hide"]);
  });
});

describe("draftFromRule (mock fitDraft)", () => {
  const rule: DecisionRule = {
    id: "r1",
    conditions: [
      { question_id: "q2", answer_id: "q2a0", op: "is_not" },
      { question_id: "q2", answer_id: "q2a1", op: "is_not" },
    ],
    target_id: "t1",
    action: "hide",
  };

  it("a stored is-not group with no any_of opens as none-of, never all-of (D12)", () => {
    const d = draftFromRule(rule, "attributes");
    expect(d.not.q2).toBe(true);
    expect(d.all.q2).toBeUndefined();
    expect(d.verb).toBe("hide");
  });

  it("in Rules only a stored Hide reads as Show and remembers what it was (D2)", () => {
    const d = draftFromRule(rule, "rules");
    expect(d.verb).toBe("show");
    expect(d.was).toBe("hide");
    expect(draftAction(d, true)).toBe("show");
  });

  it("a multi-pick is row without any_of opens as all-of", () => {
    const d = draftFromRule(
      {
        id: "r",
        conditions: [
          { question_id: "q2", answer_id: "q2a0", op: "is" },
          { question_id: "q2", answer_id: "q2a1", op: "is" },
        ],
        target_id: "t",
      },
      "attributes",
    );
    expect(d.all.q2).toBe(true);
    expect(d.legacyReplace).toBe(true);
    // A legacy replace rule left on Show keeps its action absent.
    expect(draftAction(d, true)).toBeUndefined();
  });
});

describe("draftConditions (mock tidy)", () => {
  it("writes question order, any_of for is rows, forced any on single-select, never on is-not", () => {
    let d = blankDraft();
    d = toggleDraftAnswer(d, "q2", "q2a1");
    d = toggleDraftAnswer(d, "q2", "q2a0");
    d = toggleDraftAnswer(d, "q1", "q1a0");
    d = toggleDraftAnswer(d, "q1", "q1a1");
    d = toggleDraftAnswer(d, "q3", "q3a0");
    d = toggleDraftAnswer(d, "q3", "q3a1");
    d = toggleDraftNot(d, "q3");
    const { conditions, any_of } = draftConditions(d, ROWS);
    expect(conditions.map((c) => `${c.question_id}:${c.op}`)).toEqual([
      "q1:is",
      "q1:is",
      "q2:is",
      "q2:is",
      "q3:is_not",
      "q3:is_not",
    ]);
    expect(any_of).toEqual(["q1", "q2"]);
  });

  it("all of on a multi-select drops the question from any_of; is-not takes all-of with it (D12)", () => {
    let d = blankDraft();
    d = toggleDraftAnswer(d, "q2", "q2a0");
    d = toggleDraftAnswer(d, "q2", "q2a1");
    d = toggleDraftAll(d, "q2");
    expect(draftConditions(d, ROWS).any_of).toEqual([]);
    d = toggleDraftNot(d, "q2");
    expect(d.all.q2).toBeUndefined();
    // No all-of can be switched on while the row is is-not.
    expect(toggleDraftAll(d, "q2")).toBe(d);
  });

  it("dropping below two picks resets all-of", () => {
    let d = blankDraft();
    d = toggleDraftAnswer(d, "q2", "q2a0");
    d = toggleDraftAnswer(d, "q2", "q2a1");
    d = toggleDraftAll(d, "q2");
    d = toggleDraftAnswer(d, "q2", "q2a1");
    expect(d.all.q2).toBeUndefined();
  });

  it("an untouched edited row keeps mixed per-condition ops byte for byte", () => {
    const stored: DecisionRule = {
      id: "r",
      conditions: [
        { question_id: "q2", answer_id: "q2a0", op: "is" },
        { question_id: "q2", answer_id: "q2a1", op: "is_not" },
      ],
      target_id: "t",
      action: "show",
    };
    const d = draftFromRule(stored, "attributes");
    expect(draftConditions(d, ROWS).conditions).toEqual(stored.conditions);
    // Touching the row rewrites every condition to one op.
    const touched = toggleDraftNot(d, "q2");
    expect(draftConditions(touched, ROWS).conditions.every((c) => c.op === "is")).toBe(true);
  });

  it("keeps a deleted question's conditions until the row is removed", () => {
    const stored: DecisionRule = {
      id: "r",
      conditions: [
        { question_id: "gone", answer_id: "x", op: "is" },
        { question_id: "q1", answer_id: "q1a0", op: "is" },
      ],
      target_id: "t",
      action: "show",
    };
    const d = draftFromRule(stored, "attributes");
    expect(draftConditions(d, ROWS).conditions.map((c) => c.question_id)).toEqual(["q1", "gone"]);
    expect(draftConditions(removeDraftQuestion(d, "gone"), ROWS).conditions.map((c) => c.question_id)).toEqual([
      "q1",
    ]);
  });
});

describe("the saved rule", () => {
  it("an untouched edit round-trips to the same stored rule (no commit)", () => {
    const stored: DecisionRule = normalizeDecisionRule(
      {
        id: "r1",
        conditions: [
          { question_id: "q1", answer_id: "q1a0", op: "is" },
          { question_id: "q2", answer_id: "q2a0", op: "is" },
          { question_id: "q2", answer_id: "q2a1", op: "is" },
        ],
        target_id: "t1",
        target_ids: ["t1", "t2"],
        action: "prioritize",
        match: "any",
      },
      DOC,
    );
    const d = draftFromRule(stored, "attributes");
    const saved = normalizeDecisionRule(draftToRule(d, ROWS, ["t1", "t2"], "r1", true), DOC);
    expect(sameStoredRule(saved, stored)).toBe(true);
    // D13: a stored match "any" survives the edit.
    expect(saved.match).toBe("any");
  });

  it("an is-not row never saves an all-of (D12) and the impossible all-of is the analyzer's", () => {
    let d = blankDraft();
    for (const a of ["q2a0", "q2a1", "q2a2"]) d = toggleDraftAnswer(d, "q2", a);
    d = toggleDraftAll(d, "q2");
    const rule = draftToRule(d, ROWS, ["t"], "x", false);
    expect(impossibleAllOf(rule, DOC)).toMatchObject({ questionId: "q2", needs: 3, canPick: 2 });
    d = toggleDraftNot(d, "q2");
    const notRule = draftToRule(d, ROWS, ["t"], "x", false);
    expect(notRule.any_of).toBeUndefined();
    expect(impossibleAllOf(notRule, DOC)).toBeNull();
  });

  it("stable equality ignores key order", () => {
    const a = { id: "r", conditions: [], target_id: "t", action: "show" } as DecisionRule;
    const b = { action: "show", target_id: "t", conditions: [], id: "r" } as DecisionRule;
    expect(sameStoredRule(a, b)).toBe(true);
  });
});

describe("ensure-targets batching (D15)", () => {
  it("13 picks go out as batches of 12 and 1, in order", () => {
    const list = Array.from({ length: 13 }, (_, i) => i);
    const out = batches(list);
    expect(out.map((b) => b.length)).toEqual([12, 1]);
    expect(out.flat()).toEqual(list);
  });

  it("a skipped resource in the middle leaves the survivors on their own keys", () => {
    const sent = [
      { kind: "tag" as const, ref: "a" },
      { kind: "tag" as const, ref: "b" },
      { kind: "tag" as const, ref: "c" },
    ];
    const results = mapEnsureResponse(sent, {
      results: [
        { kind: "tag", ref: "a", category: cat("A") },
        { kind: "tag", ref: "b", skipped: "empty" },
        { kind: "tag", ref: "c", category: cat("C") },
      ],
      categories: [cat("A"), cat("C")],
    });
    expect(results.map((r) => ("category" in r ? r.category.id : r.skipped))).toEqual(["A", "empty", "C"]);
  });
});

describe("the Add recommendations catalogue", () => {
  const catalog = {
    products: [
      { id: "p1", title: "Balm", tagKeys: ["dry-skin"], collectionIds: ["c1"] },
      { id: "p2", title: "Serum", tagKeys: ["dry-skin"], collectionIds: [] },
    ],
    tags: [{ key: "dry-skin", label: "Dry Skin", count: 2 }],
    collections: [{ key: "c1", label: "Face care", count: 1 }],
    groups: [{ key: "g1", label: "Winter kit", count: 0, productIds: [] }],
  };

  it("lists collections, tags, products, groups with their members", () => {
    const rows = catalogRows(catalog);
    expect(rows.map((r) => `${r.kind}:${r.key}`)).toEqual([
      "collection:c1",
      "tag:dry-skin",
      "product:p1",
      "product:p2",
      "group:g1",
    ]);
    expect(rows[1]!.productIds).toEqual(["p1", "p2"]);
  });

  it("counts come from the same query-filtered set as the list", () => {
    const rows = catalogRows(catalog);
    expect(catalogCounts(rows, "")).toEqual({ all: 5, collection: 1, tag: 1, product: 2, group: 1 });
    expect(catalogCounts(rows, "SER")).toEqual({ all: 1, collection: 0, tag: 0, product: 1, group: 0 });
  });

  it("in-quiz keys match identity (server slugs plus lifted rows), never names", () => {
    const keys = inQuizKeySet(
      ["tag:dry-skin"],
      [
        cat("x", { source: "smart_collection", sourceRef: "c1" }),
        cat("y", { source: "product", sourceRef: "p9", quizId: null }),
        cat("Balm", { source: "ai", sourceRef: null }),
      ],
    );
    expect([...keys].sort()).toEqual(["collection:c1", "tag:dry-skin"]);
  });
});
