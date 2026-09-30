// Logic step D1 — Rules only is a real engine mode. Golden pins that the
// absent / "attributes" style resolves exactly as before, and the Rules-only
// branch: first match wins, roles + mappings + filters change nothing, a
// first-matching hide (or no match) resolves null.
import { describe, expect, it } from "vitest";

import { logicDoc, rule } from "./logicStep.fixtures";
import { resolveTarget } from "./recommendDecider";
import {
  recommendForResultExplained,
  type IndexedProduct,
} from "./recommendationEngine";
import type { DecisionRule } from "./quizSchema";

const P = (id: string, tags: string[] = []): IndexedProduct => ({
  product_id: id,
  title: id,
  handle: id,
  price: "10",
  image_url: null,
  tags,
  collection_ids: [],
  inventory_in_stock: true,
});

const index = [P("p1", ["cheeks"]), P("p2", ["nose"]), P("p3"), P("x1", ["nose"]), P("x2")];
const targetProductIdsMap = {
  cat1: ["p1", "p2", "p3"],
  cat2: ["p2"],
  cat3: ["p3"],
  catX: ["x1", "x2"],
  catY: ["p3"],
};

const run = (doc: ReturnType<typeof logicDoc>, selected: string[]) =>
  recommendForResultExplained({
    quiz: doc,
    productIndex: index,
    selectedAnswerIds: selected,
    resultNodeId: "res",
    targetProductIdsMap,
  });

const rulesFixture: DecisionRule[] = [
  rule("show", [["q2", "b1"]], "catX", { action: "show" }),
  rule("hide", [["q2", "b2"]], "cat2", { action: "hide" }),
  rule("pin", [["q2", "b3"]], "catY", { action: "prioritize" }),
  rule("replace", [["q4", "r5"]], ["catX", "catY"]),
  rule("later", [["q2", "b1"], ["q1", "a1"]], "catY", { action: "show" }),
];

const cases: string[][] = [
  ["a1"],
  ["a1", "b1"],
  ["a2", "b2"],
  ["a3", "b3"],
  ["a1", "b1", "m1"],
  ["a2", "m2", "r5"],
  ["b1", "m2"],
  [],
];

describe("golden — no logic_style / attributes resolve exactly as before", () => {
  const absent = logicDoc({ rules: rulesFixture });
  const attributes = logicDoc({ rules: rulesFixture, logic_style: "attributes" });

  it("absent and 'attributes' are byte-identical on every case", () => {
    for (const sel of cases) {
      expect(JSON.stringify(resolveTarget(sel, attributes))).toBe(
        JSON.stringify(resolveTarget(sel, absent)),
      );
      expect(JSON.stringify(run(attributes, sel))).toBe(JSON.stringify(run(absent, sel)));
    }
  });

  it("pins today's Filter Results + Rules resolution", () => {
    expect(resolveTarget(["a1"], absent)).toEqual({ targetId: "cat1", matchedRuleId: null });
    // a show rule acts on top of the base
    expect(resolveTarget(["a1", "b1"], absent)).toEqual({
      targetId: "cat1",
      matchedRuleId: "show",
      ruleAction: "show",
      ruleTargetId: "catX",
    });
    // replace rule (no action) returns its targets
    expect(resolveTarget(["a2", "r5"], absent)).toEqual({
      targetId: "catX",
      targetIds: ["catX", "catY"],
      matchedRuleId: "replace",
    });
    // no base + hide → null; no base + show → the rule's targets
    expect(resolveTarget(["b2"], absent)).toBeNull();
    expect(resolveTarget(["b1"], absent)).toEqual({ targetId: "catX", matchedRuleId: "show" });
    // filter narrowing still runs (m2 keeps nose) — p2 only from cat1
    expect(run(absent, ["a1", "m2"]).products.map((p) => p.product_id)).toEqual(["p2"]);
  });

  it("a legacy doc ignores a stray logic_style entirely", () => {
    const legacy = logicDoc({ legacy: true });
    const withStyle = { ...legacy, logic_style: "rules" as const };
    for (const sel of cases) {
      expect(JSON.stringify(run(withStyle, sel))).toBe(JSON.stringify(run(legacy, sel)));
    }
  });
});

describe("Rules only (logic_style 'rules') — the first matching rule IS the result", () => {
  const doc = logicDoc({ rules: rulesFixture, logic_style: "rules" });

  it("a show rule's own targets are the result (no base, even with a mapped answer)", () => {
    expect(resolveTarget(["a1", "b1"], doc)).toEqual({ targetId: "catX", matchedRuleId: "show" });
  });

  it("a prioritize rule's own targets are the result", () => {
    expect(resolveTarget(["a3", "b3"], doc)).toEqual({ targetId: "catY", matchedRuleId: "pin" });
  });

  it("a legacy action-less rule's targets are the result", () => {
    expect(resolveTarget(["a2", "r5"], doc)).toEqual({
      targetId: "catX",
      targetIds: ["catX", "catY"],
      matchedRuleId: "replace",
    });
  });

  it("a first-matching hide resolves null even when a later rule matches", () => {
    const d = logicDoc({
      logic_style: "rules",
      rules: [
        rule("h", [["q2", "b1"]], "cat2", { action: "hide" }),
        rule("s", [["q2", "b1"]], "catX", { action: "show" }),
      ],
    });
    expect(resolveTarget(["a1", "b1"], d)).toBeNull();
  });

  it("no match resolves null — the mapped picking answer is never read", () => {
    expect(resolveTarget(["a1"], doc)).toBeNull();
    expect(resolveTarget([], doc)).toBeNull();
  });

  it("later matching rules never contribute (first match wins)", () => {
    // "show" (rule 1) and "later" (rule 5) both match a1+b1.
    const out = resolveTarget(["a1", "b1"], doc);
    expect(out?.matchedRuleId).toBe("show");
    expect(out?.targetIds).toBeUndefined();
  });

  it("roles and answer mappings change nothing", () => {
    const stripped = {
      ...doc,
      nodes: doc.nodes.map((n) =>
        n.type === "question"
          ? {
              ...n,
              data: {
                ...n.data,
                role: "qualifier" as const,
                answers: n.data.answers.map(({ target_id: _t, target_ids: _ts, ...a }) => a),
              },
            }
          : n,
      ),
    };
    for (const sel of cases) {
      expect(resolveTarget(sel, stripped)).toEqual(resolveTarget(sel, doc));
      expect(run(stripped, sel)).toEqual(run(doc, sel));
    }
  });

  it("filter narrowing is skipped (stored filter values are inert)", () => {
    // m1 keeps only 'cheeks' in attributes mode; x1/x2 carry none of it.
    const out = run(doc, ["b1", "m1"]);
    expect(out.products.map((p) => p.product_id)).toEqual(["x1", "x2"]);
    expect(out.decider?.filters).toBeUndefined();
    const attr = run(logicDoc({ rules: rulesFixture }), ["b1", "m1"]);
    // attributes: no base (no picking answer), show rule's targets, narrowed.
    expect(attr.products.map((p) => p.product_id)).toEqual([]);
  });

  it("an unresolved shopper gets the empty decider-less result (unchanged runtime contract)", () => {
    const out = run(doc, ["a1"]);
    expect(out.products).toEqual([]);
    expect(out.decider).toBeUndefined();
  });
});
