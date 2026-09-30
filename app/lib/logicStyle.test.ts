import { describe, it, expect } from "vitest";

import { logicDoc, rule } from "./logicStep.fixtures";
import {
  engineLogicStyle,
  inferLogicStyle,
  isRulesOnly,
  resolveLogicStyle,
} from "./logicStyle";
import { Quiz } from "./quizSchema";

const noFilter = (doc: ReturnType<typeof logicDoc>) => ({
  ...doc,
  nodes: doc.nodes.map((n) =>
    n.type === "question" && n.data.role === "filter"
      ? { ...n, data: { ...n.data, role: "qualifier" as const } }
      : n,
  ),
});

describe("resolveLogicStyle — the screen style (D5)", () => {
  it("1. the saved doc field wins over everything", () => {
    const doc = { ...logicDoc({ logic_style: "rules" }) };
    // Has a filter role (inference would say attributes) — the field wins.
    expect(resolveLogicStyle(doc)).toBe("rules");
    expect(
      resolveLogicStyle({
        ...doc,
        logic_style: "attributes",
        build_session: { logic_style: "rules" } as never,
      }),
    ).toBe("attributes");
  });

  it("2. else the legacy build_session key (migration read)", () => {
    const doc = logicDoc();
    const withSession = Quiz.parse({ ...doc, build_session: { logic_style: "rules" } });
    expect(withSession.logic_style).toBeUndefined();
    expect(resolveLogicStyle(withSession)).toBe("rules");
  });

  it("3a. else inference: any filter role → attributes", () => {
    const doc = logicDoc({ rules: [rule("r1", [["q1", "a1"]], "catX")] });
    expect(inferLogicStyle(doc)).toBe("attributes");
    expect(resolveLogicStyle(doc)).toBe("attributes");
  });

  it("3b. else inference: rules and no filter role → rules", () => {
    const doc = noFilter(logicDoc({ rules: [rule("r1", [["q1", "a1"]], "catX")] }));
    expect(inferLogicStyle(doc)).toBe("rules");
    expect(resolveLogicStyle(doc)).toBe("rules");
  });

  it("4. else the default: attributes (never null)", () => {
    const doc = noFilter(logicDoc());
    expect(inferLogicStyle(doc)).toBeNull();
    expect(resolveLogicStyle(doc)).toBe("attributes");
  });

  it("writes nothing", () => {
    const doc = noFilter(logicDoc({ rules: [rule("r1", [["q1", "a1"]], "catX")] }));
    const before = JSON.stringify(doc);
    resolveLogicStyle(doc);
    expect(JSON.stringify(doc)).toBe(before);
    expect("logic_style" in doc).toBe(false);
  });
});

describe("engineLogicStyle — the engine style (D1)", () => {
  it("absent field → attributes, even when the screen infers rules", () => {
    const doc = noFilter(logicDoc({ rules: [rule("r1", [["q1", "a1"]], "catX")] }));
    expect(resolveLogicStyle(doc)).toBe("rules");
    expect(engineLogicStyle(doc)).toBe("attributes");
    expect(isRulesOnly(doc)).toBe(false);
  });

  it("never reads build_session", () => {
    const doc = Quiz.parse({ ...logicDoc(), build_session: { logic_style: "rules" } });
    expect(engineLogicStyle(doc)).toBe("attributes");
  });

  it("reads the stored field on a decider doc", () => {
    expect(engineLogicStyle(logicDoc({ logic_style: "rules" }))).toBe("rules");
    expect(isRulesOnly(logicDoc({ logic_style: "rules" }))).toBe(true);
    expect(engineLogicStyle(logicDoc({ logic_style: "attributes" }))).toBe("attributes");
  });

  it("a legacy doc is always attributes, whatever it carries", () => {
    const legacy = { ...logicDoc({ legacy: true }), logic_style: "rules" as const };
    expect(engineLogicStyle(legacy)).toBe("attributes");
    expect(isRulesOnly(legacy)).toBe(false);
  });

  it("the schema keeps the field optional (absent round-trips absent)", () => {
    const parsed = Quiz.parse(JSON.parse(JSON.stringify(logicDoc())));
    expect("logic_style" in parsed).toBe(false);
    const legacy = Quiz.parse(JSON.parse(JSON.stringify(logicDoc({ legacy: true }))));
    expect("logic_style" in legacy).toBe(false);
    expect(Quiz.parse({ ...logicDoc(), logic_style: "rules" }).logic_style).toBe("rules");
    expect(Quiz.safeParse({ ...logicDoc(), logic_style: "points" }).success).toBe(false);
  });
});
