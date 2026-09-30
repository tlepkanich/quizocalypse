import { describe, it, expect } from "vitest";

import { logicDoc, rule } from "./logicStep.fixtures";
import {
  ANSWER_TEXT_MAX,
  QUESTION_TEXT_MAX,
  changeQuestionRole,
  normalizeDecisionRule,
  removeDecisionRule,
  restoreDecisionRules,
  restoreQuestionLogic,
  setAnswerText,
  setLogicStyle,
  setQuestionText,
  setScaleEndLabels,
  setSelectionBounds,
  snapshotQuestionLogic,
  splitCrossQuestionOr,
} from "./quizMutations";
import { Quiz } from "./quizSchema";
import type { DecisionRule } from "./quizSchema";

type Doc = ReturnType<typeof logicDoc>;
const qData = (doc: Doc, id: string) => {
  const n = doc.nodes.find((x) => x.id === id);
  if (!n || n.type !== "question") throw new Error(`no question ${id}`);
  return n.data;
};
const answer = (doc: Doc, qid: string, aid: string) =>
  qData(doc, qid).answers.find((a) => a.id === aid)!;
const roundTrips = (doc: Doc) =>
  expect(Quiz.parse(JSON.parse(JSON.stringify(doc)))).toEqual(doc);

describe("legacy docs come back as the same object (every new mutation)", () => {
  const legacy = logicDoc({ legacy: true, rules: [] });
  it.each([
    ["setLogicStyle", () => setLogicStyle(legacy, "rules")],
    ["restoreDecisionRules", () => restoreDecisionRules(legacy, [{ rule: rule("x", [["q1", "a1"]], "c"), index: 0 }])],
    ["restoreQuestionLogic", () => restoreQuestionLogic(legacy, snapshotQuestionLogic(logicDoc(), ["q1"]))],
    ["changeQuestionRole", () => changeQuestionRole(legacy, "q2", "decides").doc],
    ["setQuestionText", () => setQuestionText(legacy, "q1", "New")],
    ["setAnswerText", () => setAnswerText(legacy, "q1", "a1", "New")],
    ["setSelectionBounds", () => setSelectionBounds(legacy, "q3", 1, 1)],
    ["setScaleEndLabels", () => setScaleEndLabels(legacy, "q4", "Low", "High")],
  ])("%s", (_name, run) => {
    const out = run();
    expect(out).toBe(legacy);
    expect("logic_style" in out).toBe(false);
  });
});

describe("setLogicStyle", () => {
  it("writes the top-level field and nothing else", () => {
    const doc = logicDoc();
    const next = setLogicStyle(doc, "rules");
    expect(next.logic_style).toBe("rules");
    expect(next.nodes).toBe(doc.nodes);
    expect(next.decision_rules).toBe(doc.decision_rules);
    roundTrips(next);
  });
  it("returns the input when unchanged", () => {
    const doc = logicDoc({ logic_style: "attributes" });
    expect(setLogicStyle(doc, "attributes")).toBe(doc);
  });
  it("writes attributes explicitly even though absent already means it", () => {
    const next = setLogicStyle(logicDoc(), "attributes");
    expect(next.logic_style).toBe("attributes");
  });
});

describe("restoreDecisionRules (D7)", () => {
  const r1 = rule("r1", [["q1", "a1"]], "c1");
  const r2 = rule("r2", [["q1", "a2"]], "c2");
  const r3 = rule("r3", [["q1", "a3"]], "c3");
  const r4 = rule("r4", [["q2", "b1"]], "c4");
  const base = () => logicDoc({ rules: [r1, r2, r3, r4] });

  it("restores one delete at its index", () => {
    const doc = base();
    const deleted = removeDecisionRule(doc, "r2");
    const back = restoreDecisionRules(deleted, [{ rule: r2, index: 1 }]);
    expect(back.decision_rules!.map((r) => r.id)).toEqual(["r1", "r2", "r3", "r4"]);
  });

  it("restores several deletes, lowest original index first", () => {
    let doc = base();
    doc = removeDecisionRule(doc, "r3");
    doc = removeDecisionRule(doc, "r1");
    // Entries carry ORIGINAL positions; given out of order on purpose.
    const back = restoreDecisionRules(doc, [
      { rule: r3, index: 2 },
      { rule: r1, index: 0 },
    ]);
    expect(back.decision_rules!.map((r) => r.id)).toEqual(["r1", "r2", "r3", "r4"]);
  });

  it("clamps the index and skips ids that already exist", () => {
    const doc = logicDoc({ rules: [r1] });
    const back = restoreDecisionRules(doc, [
      { rule: r2, index: 99 },
      { rule: r1, index: 0 },
    ]);
    expect(back.decision_rules!.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(restoreDecisionRules(doc, [{ rule: r1, index: 0 }])).toBe(doc);
  });

  it("works on a doc with no decision_rules key", () => {
    const back = restoreDecisionRules(logicDoc(), [{ rule: r1, index: -5 }]);
    expect(back.decision_rules).toEqual([r1]);
    roundTrips(back);
  });
});

describe("snapshotQuestionLogic / restoreQuestionLogic", () => {
  it("restores role, required, targets and values after a role move", () => {
    const doc = logicDoc();
    const snap = snapshotQuestionLogic(doc, ["q1", "q3"]);
    const { doc: moved } = changeQuestionRole(doc, "q3", "decides");
    expect(qData(moved, "q1").role).toBe("qualifier");
    expect(answer(moved, "q1", "a1").target_id).toBeUndefined();
    expect(answer(moved, "q3", "m1").tags).toEqual([]);
    const back = restoreQuestionLogic(moved, snap);
    expect(back.nodes).toEqual(doc.nodes);
    roundTrips(back);
  });

  it("restores multi-target lists and absent roles exactly", () => {
    let doc = logicDoc();
    doc = {
      ...doc,
      nodes: doc.nodes.map((n) =>
        n.id === "q1" && n.type === "question"
          ? {
              ...n,
              data: {
                ...n.data,
                answers: n.data.answers.map((a) =>
                  a.id === "a1" ? { ...a, target_id: "cat1", target_ids: ["cat1", "cat9"] } : a,
                ),
              },
            }
          : n.id === "q4" && n.type === "question"
            ? { ...n, data: { ...n.data } }
            : n,
      ),
    };
    const snap = snapshotQuestionLogic(doc, ["q1", "q4"]);
    expect(snap.questions.find((q) => q.nodeId === "q4")!.role).toBeUndefined();
    const { doc: cleared } = changeQuestionRole(doc, "q4", "decides");
    expect(qData(cleared, "q4").role).toBe("decides");
    const back = restoreQuestionLogic(cleared, snap);
    expect("role" in qData(back, "q4")).toBe(false);
    expect(answer(back, "q1", "a1").target_ids).toEqual(["cat1", "cat9"]);
    expect(back.nodes).toEqual(doc.nodes);
  });

  it("returns the input doc when nothing differs, and skips deleted answers", () => {
    const doc = logicDoc();
    expect(restoreQuestionLogic(doc, snapshotQuestionLogic(doc, ["q1"]))).toBe(doc);
    const snap = snapshotQuestionLogic(doc, ["q1", "gone"]);
    expect(snap.questions).toHaveLength(1);
  });
});

describe("changeQuestionRole (D9 one path)", () => {
  it("→ decides: moveDecider's locked clear, loss names the OLD picker", () => {
    const doc = logicDoc({ rules: [rule("r1", [["q1", "a1"]], "cat1")] });
    const { doc: next, lost } = changeQuestionRole(doc, "q2", "decides");
    expect(qData(next, "q2").role).toBe("decides");
    expect(qData(next, "q2").required).toBe(true);
    expect(qData(next, "q1").role).toBe("qualifier");
    expect(lost.targets).toEqual({ nodeId: "q1", count: 3 });
    expect(lost.values).toBeUndefined();
    expect(next.decision_rules).toBe(doc.decision_rules); // rules untouched
  });

  it("leaving Narrows clears that question's values (and Keeps everything)", () => {
    const doc = logicDoc();
    const { doc: next, lost } = changeQuestionRole(doc, "q3", "qualifier");
    expect(qData(next, "q3").role).toBe("qualifier");
    expect(answer(next, "q3", "m1").tags).toEqual([]);
    expect(answer(next, "q3", "m3").no_preference).toBeUndefined();
    expect(lost.values).toEqual({ nodeId: "q3", count: 3 });
    expect(lost.targets).toBeUndefined();
    roundTrips(next);
  });

  it("filter → decides reports both losses", () => {
    const { lost } = changeQuestionRole(logicDoc(), "q3", "decides");
    expect(lost).toEqual({
      targets: { nodeId: "q1", count: 3 },
      values: { nodeId: "q3", count: 3 },
    });
  });

  it("the picking question leaving the job gives up its own targets", () => {
    const { doc: next, lost } = changeQuestionRole(logicDoc(), "q1", "filter");
    expect(qData(next, "q1").role).toBe("filter");
    expect(answer(next, "q1", "a1").target_id).toBeUndefined();
    expect(lost.targets).toEqual({ nodeId: "q1", count: 3 });
  });

  it("qualifier → filter clears nothing", () => {
    const doc = logicDoc();
    const { doc: next, lost } = changeQuestionRole(doc, "q2", "filter");
    expect(qData(next, "q2").role).toBe("filter");
    expect(lost).toEqual({});
  });

  it("refusals return the input doc", () => {
    const doc = logicDoc();
    expect(changeQuestionRole(doc, "q1", "decides").doc).toBe(doc);
    expect(changeQuestionRole(doc, "nope", "filter").doc).toBe(doc);
    // absent role = Info
    expect(changeQuestionRole(doc, "q4", "qualifier").doc).toBe(doc);
  });
});

describe("text and shape mutations", () => {
  it("setQuestionText collapses, trims, clamps; empty/unchanged refuse", () => {
    const doc = logicDoc();
    const next = setQuestionText(doc, "q1", "  How   does\nit feel?  ");
    expect(qData(next, "q1").text).toBe("How does it feel?");
    expect(qData(setQuestionText(doc, "q1", "x".repeat(200)), "q1").text).toHaveLength(QUESTION_TEXT_MAX);
    expect(setQuestionText(doc, "q1", "   ")).toBe(doc);
    expect(setQuestionText(doc, "q1", " Skin  feel ")).toBe(doc);
    expect(setQuestionText(doc, "res", "x")).toBe(doc);
    roundTrips(next);
  });

  it("setAnswerText clamps to 60 and refuses unknown answers", () => {
    const doc = logicDoc();
    const next = setAnswerText(doc, "q1", "a1", "y".repeat(80));
    expect(answer(next, "q1", "a1").text).toHaveLength(ANSWER_TEXT_MAX);
    expect(answer(next, "q1", "a2")).toBe(answer(doc, "q1", "a2"));
    expect(setAnswerText(doc, "q1", "zz", "Hi")).toBe(doc);
    expect(setAnswerText(doc, "q1", "a1", "")).toBe(doc);
  });

  it("setSelectionBounds clamps and stores sparse", () => {
    const doc = logicDoc(); // q3: 3 answers, max 2
    const a = setSelectionBounds(doc, "q3", 2, 3);
    expect(qData(a, "q3").min_selections).toBe(2);
    expect("max_selections" in qData(a, "q3")).toBe(false);
    const b = setSelectionBounds(doc, "q3", 0, 9);
    expect("min_selections" in qData(b, "q3")).toBe(false);
    expect("max_selections" in qData(b, "q3")).toBe(false);
    const c = setSelectionBounds(doc, "q3", 3, 1); // max raised to min
    expect(qData(c, "q3").min_selections).toBe(3);
    expect(setSelectionBounds(doc, "q3", 1, 2)).toBe(doc); // unchanged
    expect(setSelectionBounds(doc, "q1", 1, 2)).toBe(doc); // not multi
    roundTrips(a);
  });

  it("setScaleEndLabels writes, clamps, deletes and drops an empty config", () => {
    const doc = logicDoc();
    const a = setScaleEndLabels(doc, "q4", "  Not   at all ", "z".repeat(50));
    expect(qData(a, "q4").scale_config).toEqual({
      endpoint_label_min: "Not at all",
      endpoint_label_max: "z".repeat(40),
    });
    const b = setScaleEndLabels(a, "q4", "", undefined);
    expect(qData(b, "q4").scale_config).toEqual({ endpoint_label_max: "z".repeat(40) });
    const c = setScaleEndLabels(b, "q4", undefined, " ");
    expect("scale_config" in qData(c, "q4")).toBe(false);
    expect(setScaleEndLabels(doc, "q1", "a", "b")).toBe(doc);
    expect(setScaleEndLabels(doc, "q4", undefined, undefined)).toBe(doc);
    roundTrips(a);
  });
});

describe("normalizeDecisionRule (D12 / G1 / D13)", () => {
  const doc = logicDoc();

  it("drops an all-is_not group from any_of", () => {
    const r = rule("r", [["q2", "b1", "is_not"], ["q2", "b2", "is_not"]], "c", { any_of: ["q2"] });
    expect("any_of" in normalizeDecisionRule(r, doc)).toBe(false);
  });

  it("forces any-of on a single-select with 2+ is answers", () => {
    const r = rule("r", [["q1", "a1"], ["q1", "a2"]], "c");
    expect(normalizeDecisionRule(r, doc).any_of).toEqual(["q1"]);
  });

  it("keeps all-of on a multi-select with 2+ picks, and any-of when stored", () => {
    const all = rule("r", [["q3", "m1"], ["q3", "m2"]], "c");
    expect("any_of" in normalizeDecisionRule(all, doc)).toBe(false);
    const any = rule("r", [["q3", "m1"], ["q3", "m2"]], "c", { any_of: ["q3"] });
    expect(normalizeDecisionRule(any, doc).any_of).toEqual(["q3"]);
  });

  it("drops any_of on a one-answer group", () => {
    const r = rule("r", [["q3", "m1"]], "c", { any_of: ["q3", "q9"] });
    expect("any_of" in normalizeDecisionRule(r, doc)).toBe(false);
  });

  it("sorts conditions by flow order then answer order, dedupes, keeps unknowns", () => {
    const r = rule(
      "r",
      [["q2", "b2"], ["zz", "x1"], ["q1", "a3"], ["q1", "a1"], ["q1", "a1"]],
      "c",
    );
    const out = normalizeDecisionRule(r, doc);
    expect(out.conditions.map((c) => c.answer_id)).toEqual(["a1", "a3", "b2", "x1"]);
  });

  it("G1 mirror: a length-1 list collapses; duplicates removed", () => {
    const one = normalizeDecisionRule({ ...rule("r", [["q1", "a1"]], "c"), target_ids: ["c", "c"] }, doc);
    expect(one.target_id).toBe("c");
    expect("target_ids" in one).toBe(false);
    const two = normalizeDecisionRule(rule("r", [["q1", "a1"]], ["c2", "c1", "c2"]), doc);
    expect(two.target_ids).toEqual(["c2", "c1"]);
    expect(two.target_id).toBe("c2");
  });

  it("preserves match any and action; drops match all", () => {
    const r = rule("r", [["q1", "a1"], ["q2", "b1"]], "c", { match: "any", action: "hide" });
    const out = normalizeDecisionRule(r, doc);
    expect(out.match).toBe("any");
    expect(out.action).toBe("hide");
    expect("match" in normalizeDecisionRule({ ...r, match: "all" }, doc)).toBe(false);
  });

  it("keeps a mixed is / is-not group's stored any_of membership", () => {
    const r = rule("r", [["q3", "m1"], ["q3", "m2"], ["q3", "m3", "is_not"]], "c", { any_of: ["q3"] });
    expect(normalizeDecisionRule(r, doc).any_of).toEqual(["q3"]);
    const r2 = { ...r, any_of: undefined };
    expect("any_of" in normalizeDecisionRule(r2 as DecisionRule, doc)).toBe(false);
  });
});

describe("splitCrossQuestionOr (D13)", () => {
  let n = 0;
  const makeId = () => `new_${++n}`;

  it("splits a match-any rule into one rule per question group", () => {
    const r = rule(
      "r",
      [["q1", "a1"], ["q1", "a2"], ["q2", "b1", "is_not"]],
      ["c1", "c2"],
      { match: "any", any_of: ["q1"], action: "show" },
    );
    const out = splitCrossQuestionOr(r, makeId);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      id: out[0]!.id,
      conditions: [
        { question_id: "q1", answer_id: "a1", op: "is" },
        { question_id: "q1", answer_id: "a2", op: "is" },
      ],
      target_id: "c1",
      target_ids: ["c1", "c2"],
      action: "show",
      any_of: ["q1"],
    });
    expect(out[1]!.conditions).toEqual([{ question_id: "q2", answer_id: "b1", op: "is_not" }]);
    expect("match" in out[1]!).toBe(false);
    expect("any_of" in out[1]!).toBe(false);
    expect(new Set(out.map((x) => x.id)).size).toBe(2);
    expect(out.every((x) => x.id !== "r")).toBe(true);
  });

  it("returns [rule] for an AND rule or a single-group any rule", () => {
    const and = rule("r", [["q1", "a1"], ["q2", "b1"]], "c");
    expect(splitCrossQuestionOr(and, makeId)[0]).toBe(and);
    const single = rule("r", [["q1", "a1"]], "c", { match: "any" });
    expect(splitCrossQuestionOr(single, makeId)[0]).toBe(single);
  });
});
