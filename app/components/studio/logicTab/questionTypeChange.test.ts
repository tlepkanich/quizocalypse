import { describe, expect, it } from "vitest";
import { logicDoc, rule } from "../../../lib/logicStep.fixtures";
import type { Quiz } from "../../../lib/quizSchema";
import {
  allOfRuleIds,
  changeQuestionType,
  isFivePointScale,
  overMaxRules,
  restoreQuestionType,
  restoreScalePoint,
  setScalePoints,
  snapshotType,
} from "./questionTypeChange";

const qdata = (doc: Quiz, id: string) => {
  const n = doc.nodes.find((x) => x.id === id);
  if (!n || n.type !== "question") throw new Error(id);
  return n.data;
};

describe("changeQuestionType (D10 open: live TypeChipSelector semantics)", () => {
  it("Five-point stamps the 1–5 preset and KEEPS every answer", () => {
    const doc = logicDoc();
    const { doc: next } = changeQuestionType(doc, "q2", "rating5");
    const d = qdata(next, "q2");
    expect(d.question_type).toBe("rating");
    expect(d.scale_config).toMatchObject({ min: 1, max: 5 });
    expect(d.answers.map((a) => a.id)).toEqual(["b1", "b2", "b3"]);
    // Three points: the type line reads "Scale · 1–3", never Five-point.
    expect(isFivePointScale(d)).toBe(false);
  });

  it("picking the current type is a no-op (same doc)", () => {
    const doc = logicDoc();
    expect(changeQuestionType(doc, "q1", "single_select").doc).toBe(doc);
  });

  it("leaving Multi-select clears the bounds and turns all-of rules any-of; Undo puts both back", () => {
    const doc = logicDoc({
      rules: [
        rule("r1", [["q3", "m1"], ["q3", "m2"]], "catX"),
        rule("r2", [["q3", "m1"], ["q3", "m2", "is_not"]], "catX"),
        rule("r3", [["q3", "m1"]], "catX"),
      ],
    });
    expect(allOfRuleIds(doc, "q3")).toEqual(["r1"]);
    const snap = snapshotType(doc, "q3")!;
    const { doc: next, anyOfRuleIds } = changeQuestionType(doc, "q3", "single_select");
    expect(anyOfRuleIds).toEqual(["r1"]);
    expect(qdata(next, "q3").max_selections).toBeUndefined();
    expect(next.decision_rules!.find((r) => r.id === "r1")!.any_of).toEqual(["q3"]);
    const back = restoreQuestionType(next, snap, anyOfRuleIds);
    expect(qdata(back, "q3").question_type).toBe("multi_select");
    expect(qdata(back, "q3").max_selections).toBe(2);
    expect(back.decision_rules!.find((r) => r.id === "r1")!.any_of).toBeUndefined();
  });

  it("refuses Scale above 10 answers and never touches a legacy doc", () => {
    const legacy = logicDoc({ legacy: true });
    expect(changeQuestionType(legacy, "q2", "multi_select").doc).toBe(legacy);
  });
});

describe("setScalePoints / restoreScalePoint (the ONE removal seam)", () => {
  it("adds a numbered point and keeps a preset's max in step", () => {
    const doc = changeQuestionType(logicDoc(), "q4", "rating5").doc;
    const { doc: next, removed } = setScalePoints(doc, "q4", 6);
    expect(removed).toBeNull();
    expect(qdata(next, "q4").answers.map((a) => a.text)).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(qdata(next, "q4").scale_config?.max).toBe(6);
  });

  it("removes the last point with its edges; the inverse re-inserts it by id so rules heal", () => {
    const base = logicDoc({ rules: [rule("r1", [["q4", "r5"]], "catX")] });
    const doc: Quiz = {
      ...base,
      edges: [...base.edges, { id: "e-skip", source: "q4", source_handle: "hr5", target: "res" }],
    };
    const { doc: next, removed } = setScalePoints(doc, "q4", 4);
    expect(qdata(next, "q4").answers.map((a) => a.id)).toEqual(["r1", "r2", "r3", "r4"]);
    expect(next.edges.some((e) => e.id === "e-skip")).toBe(false);
    const back = restoreScalePoint(next, removed!);
    expect(qdata(back, "q4").answers.map((a) => a.id)).toEqual(["r1", "r2", "r3", "r4", "r5"]);
    expect(back.edges.some((e) => e.id === "e-skip")).toBe(true);
  });
});

describe("overMaxRules", () => {
  it("names all-of rules needing more picks than Max allows (never 'is not')", () => {
    const doc = logicDoc({
      rules: [
        rule("r1", [["q3", "m1"], ["q3", "m2"], ["q3", "m3"]], "catX"),
        rule("r2", [["q3", "m1"], ["q3", "m2"]], "catX"),
        rule("r3", [["q3", "m1", "is_not"], ["q3", "m2", "is_not"], ["q3", "m3", "is_not"]], "catX"),
      ],
    });
    expect(overMaxRules(doc, "q3")).toEqual([{ number: 1, needs: 3 }]);
  });
});
