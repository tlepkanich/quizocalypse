// Logic step D3 — the style-aware Tier-1 report, validateQuiz and the
// publish gate agree; publish carries logic_style exactly as stored.
import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { logicDoc, rule } from "./logicStep.fixtures";
import { buildBuilderHealthReport, buildTier1Report } from "./pathReport";
import { collectPublishTargetIds, publishQuiz, type PublishedQuiz } from "./quizPublish";
import { validateQuiz } from "./quizValidation";
import { countUnpublishedChanges } from "./unpublishedChanges";
import type { DecisionRule } from "./quizSchema";

vi.mock("./claude", () => ({
  translateFeaturesToBenefits: vi.fn(async () => [] as string[]),
  generateAnswerTooltips: vi.fn(async () => ({}) as Record<string, string>),
}));

const BUCKETS = ["cat1", "cat2", "cat3", "catX", "catY"].map((id) => ({
  id,
  name: id,
  quizId: "quiz",
}));

type Report = ReturnType<typeof buildTier1Report>;
const ids = (r: Report) => r.checks.map((c) => c.id);
const failing = (r: Report) =>
  r.checks.filter((c) => c.status === "fail").map((c) => [c.id, c.severity, c.findings.map((f) => f.message)]);
const byId = (r: Report, id: string) => r.checks.find((c) => c.id === id);

describe("buildTier1Report — style matrix", () => {
  const rules: DecisionRule[] = [rule("r1", [["q2", "b1"]], "catX", { action: "show" })];

  it("absent logic_style and 'attributes' produce the same report", () => {
    const a = buildTier1Report(logicDoc({ rules }), BUCKETS);
    const b = buildTier1Report(logicDoc({ rules, logic_style: "attributes" }), BUCKETS);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(ids(a)).toEqual(expect.arrayContaining(["V1", "V2", "V3", "V4", "V13", "V9"]));
  });

  it("Rules only skips every picking-question and filter-value check", () => {
    const r = buildTier1Report(logicDoc({ rules, logic_style: "rules" }), BUCKETS, []);
    for (const gone of ["V1", "V2", "V3", "V4", "V9", "V11", "V13", "V15"]) {
      expect(ids(r)).not.toContain(gone);
    }
    expect(ids(r)).toEqual(expect.arrayContaining(["R1", "R2", "R3", "R4", "R5", "V5", "V6", "V8", "S1"]));
    expect(r.verdict.blocking).toBe(0);
  });

  it("a Rules-only doc with unmapped / stale picking answers is not blocked by them", () => {
    const doc = logicDoc({ rules, logic_style: "rules" });
    const stale = {
      ...doc,
      nodes: doc.nodes.map((n) =>
        n.id === "q1" && n.type === "question"
          ? {
              ...n,
              data: {
                ...n.data,
                answers: n.data.answers.map((a, i) =>
                  i === 0 ? { ...a, target_id: "GONE" } : { id: a.id, text: a.text, tags: a.tags, edge_handle_id: a.edge_handle_id },
                ),
              },
            }
          : n,
      ),
    };
    expect(buildTier1Report(stale, BUCKETS).verdict.blocking).toBe(0);
    expect(validateQuiz(stale)).toEqual([]);
    // …but the same doc in Filter Results + Rules blocks on V4.
    const filter = { ...stale, logic_style: undefined };
    expect(byId(buildTier1Report(filter, BUCKETS), "V4")!.status).toBe("fail");
  });
});

describe("Rules only blocks (D3) — report and validateQuiz agree", () => {
  it("no rules", () => {
    const doc = logicDoc({ logic_style: "rules" });
    const r = buildTier1Report(doc, BUCKETS);
    expect(failing(r)).toContainEqual(["R1", "block", ["Rules only needs at least one rule to show anything."]]);
    expect(byId(r, "R1")!.findings[0]!.link).toEqual({ kind: "rules" });
    expect(validateQuiz(doc).map((i) => i.kind)).toEqual(["rules_only_no_rules"]);
    expect(r.verdict.blocking).toBe(1); // S1 does not count it twice
  });

  it("a rule with no answers blocks; the only rule means none can run", () => {
    const doc = logicDoc({ logic_style: "rules", rules: [rule("r1", [], "catX")] });
    const r = buildTier1Report(doc, BUCKETS);
    expect(byId(r, "R3")!.findings.map((f) => f.message)).toEqual([
      "Rule 1 has no answers left, so it never runs",
    ]);
    expect(byId(r, "R2")!.findings.map((f) => f.message)).toEqual(["None of your rules can ever run."]);
    expect(validateQuiz(doc).map((i) => i.kind)).toEqual([
      "rules_only_incomplete_rule",
      "rules_only_nothing_shows",
    ]);
    expect(r.verdict.blocking).toBe(2);
  });

  it("a rule whose recommendations are all deleted blocks once (R3, not V5 too)", () => {
    const doc = logicDoc({ logic_style: "rules", rules: [rule("r1", [["q2", "b1"]], ["GONE1", "GONE2"])] });
    const r = buildTier1Report(doc, BUCKETS);
    expect(byId(r, "R3")!.findings[0]!.message).toBe("Rule 1 has no recommendation left, so it never runs");
    expect(byId(r, "V5")!.status).toBe("pass");
    // partly deleted still blocks through V5
    const partial = logicDoc({ logic_style: "rules", rules: [rule("r1", [["q2", "b1"]], ["catX", "GONE"])] });
    expect(byId(buildTier1Report(partial, BUCKETS), "V5")!.status).toBe("fail");
  });

  it("only hide rules: nothing shows", () => {
    const doc = logicDoc({ logic_style: "rules", rules: [rule("r1", [["q2", "b1"]], "catX", { action: "hide" })] });
    expect(byId(buildTier1Report(doc, BUCKETS), "R2")!.findings[0]!.message).toBe(
      "No rule shows anything yet. Add a Show rule.",
    );
    expect(validateQuiz(doc).map((i) => i.kind)).toEqual(["rules_only_nothing_shows"]);
  });

  it("a legacy doc never gets a Rules-only issue, whatever it carries", () => {
    const legacy = { ...logicDoc({ legacy: true }), logic_style: "rules" as const };
    expect(validateQuiz(legacy).some((i) => i.kind.startsWith("rules_only"))).toBe(false);
  });
});

describe("warnings in both styles: never runs, impossible all-of, never recommended", () => {
  const rules: DecisionRule[] = [
    rule("r1", [["q2", "b1"]], "catX", { action: "show" }),
    rule("r2", [["q2", "b1"], ["q1", "a1"]], "catY", { action: "show" }), // shadowed
    rule("r3", [["q3", "m1"], ["q3", "m2"], ["q3", "m3"]], "catY", { action: "show" }), // max 2
    rule("r4", [["q2", "b2"]], "cat2", { action: "prioritize" }),
  ];

  it.each(["rules", "attributes"] as const)("%s", (style) => {
    const r = buildTier1Report(logicDoc({ rules, logic_style: style }), BUCKETS);
    expect(byId(r, "V8")!.severity).toBe("warn");
    expect(byId(r, "V8")!.findings).toEqual([
      { message: "Rule 2 never runs: rule 1 catches them first", link: { kind: "rule", ruleId: "r2" } },
    ]);
    expect(byId(r, "R4")!.findings.map((f) => f.message)).toEqual([
      "Rule 3 never runs: it needs all 3 of its Q3 answers and they can pick 2",
    ]);
    const never = byId(r, "R5")!.findings.map((f) => f.message);
    if (style === "rules") {
      // pin counts in Rules only; mappings never do
      expect(never).toEqual(["“cat1” is never recommended", "“cat3” is never recommended", "“catY” is never recommended"]);
    } else {
      // mappings count; pin does not
      expect(never).toEqual(["“catY” is never recommended"]);
      expect(byId(r, "R5")!.findings[0]!.link).toEqual({ kind: "recommendation", categoryId: "catY", nodeId: "q1" });
    }
    expect(r.verdict.blocking).toBe(0);
  });

  it("R5 is omitted when no bucket says which rows are quiz-scoped", () => {
    const r = buildTier1Report(logicDoc({ rules }), BUCKETS.map(({ id, name }) => ({ id, name })));
    expect(ids(r)).not.toContain("R5");
  });
});

describe("R0 — the style shown but not saved (opt-in)", () => {
  const noFilterRulesDoc = () => {
    const d = logicDoc({ rules: [rule("r1", [["q2", "b1"]], "catX", { action: "show" })] });
    return {
      ...d,
      nodes: d.nodes.map((n) =>
        n.type === "question" && n.data.role === "filter" ? { ...n, data: { ...n.data, role: "qualifier" as const } } : n,
      ),
    };
  };
  it("fires only when asked, for an inferred-rules draft with no saved field", () => {
    const doc = noFilterRulesDoc();
    expect(ids(buildTier1Report(doc, BUCKETS))).not.toContain("R0");
    const r = buildTier1Report(doc, BUCKETS, undefined, { styleNote: true });
    expect(byId(r, "R0")).toMatchObject({ severity: "warn", findings: [{ link: { kind: "style" } }] });
    expect(ids(buildTier1Report({ ...doc, logic_style: "attributes" }, BUCKETS, undefined, { styleNote: true }))).not.toContain("R0");
  });
});

describe("buildBuilderHealthReport forwards the product index", () => {
  it("runs V11 when given one", () => {
    const doc = logicDoc();
    expect(ids(buildBuilderHealthReport(doc, BUCKETS))).not.toContain("V11");
    expect(ids(buildBuilderHealthReport(doc, BUCKETS, []))).toContain("V11");
  });
});

// ── publish ─────────────────────────────────────────────────────────────────

const CATEGORY_ROWS = ["cat1", "cat2", "cat3", "catX"].map((id) => ({
  id,
  productIds: [`${id}_p`],
  source: "tag",
  sourceRef: id,
  name: id,
}));

function mockPrisma(draftJson: unknown, categories: unknown[] = CATEGORY_ROWS) {
  let captured: unknown;
  let fetched: string[] = [];
  const prisma = {
    quiz: {
      findFirst: async () => ({ id: "qrow", version: 1, draftJson }),
      update: (args: { data: { publishedJson: unknown } }) => {
        captured = args.data.publishedJson;
        return { __op: "quiz.update" };
      },
    },
    category: {
      findMany: async (args: { where: { id: { in: string[] } } }) => {
        fetched = args.where.id.in;
        return (categories as Array<{ id: string }>).filter((c) => fetched.includes(c.id));
      },
    },
    product: { findMany: async () => [] },
    shop: {
      findUnique: async () => ({ brandTokens: null, shopDomain: "t.myshopify.com", brandGuidelines: null, source: "shopify" }),
    },
    quizSession: { findMany: async () => [] },
    quizVersion: { create: () => ({ __op: "v" }), findMany: async () => [] },
    $transaction: (ops: ReadonlyArray<unknown>) => Promise.all(ops),
  };
  return {
    prisma: prisma as unknown as PrismaClient,
    wire: () => JSON.parse(JSON.stringify(captured)) as PublishedQuiz,
    fetched: () => fetched,
  };
}

/** A Rules-only draft whose picking question is unmapped and whose filter
 *  question matches 0 products (empty index) — neither may block. */
function rulesOnlyDraft(rules: DecisionRule[]) {
  const doc = logicDoc({ logic_style: "rules", rules });
  return {
    ...doc,
    nodes: doc.nodes.map((n) =>
      n.id === "q1" && n.type === "question"
        ? {
            ...n,
            data: {
              ...n.data,
              answers: n.data.answers.map(({ target_id: _t, ...a }, i) => (i === 0 ? { ...a, target_id: "STALE" } : a)),
            },
          }
        : n,
    ),
  };
}

describe("publishQuiz — Rules only (D1/D3)", () => {
  it("publishes one complete rule with no picking mapping; carries logic_style; bakes rule targets only", async () => {
    const m = mockPrisma(rulesOnlyDraft([rule("r1", [["q2", "b1"]], "catX", { action: "show" })]));
    const result = await publishQuiz(m.prisma, { quizId: "qrow", shopId: "s1" });
    expect(result.ok).toBe(true);
    const wire = m.wire();
    expect(wire.logic_style).toBe("rules");
    expect(Object.keys(wire.target_product_ids_map ?? {})).toEqual(["catX"]);
    expect(m.fetched()).not.toContain("STALE");
  });

  it("blocks when the rule's recommendation row is gone", async () => {
    const m = mockPrisma(rulesOnlyDraft([rule("r1", [["q2", "b1"]], "catGONE", { action: "show" })]));
    await expect(publishQuiz(m.prisma, { quizId: "qrow", shopId: "s1" })).rejects.toThrow(/no longer exists/);
  });

  it("blocks with no rules (validateQuiz)", async () => {
    const m = mockPrisma(rulesOnlyDraft([]));
    await expect(publishQuiz(m.prisma, { quizId: "qrow", shopId: "s1" })).rejects.toThrow(/validation issues/);
  });

  it("an absent logic_style stays absent; 'attributes' is carried as stored", async () => {
    // The fixture's filter answers match 0 products on an empty index (the
    // Filter-style zero-match gate would block), so use a doc without them.
    const plain = logicDoc({ rules: [] });
    const noFilter = {
      ...plain,
      nodes: plain.nodes.map((n) =>
        n.type === "question" && n.data.role === "filter" ? { ...n, data: { ...n.data, role: "qualifier" as const } } : n,
      ),
    };
    const m1 = mockPrisma(noFilter);
    expect((await publishQuiz(m1.prisma, { quizId: "qrow", shopId: "s1" })).ok).toBe(true);
    expect("logic_style" in m1.wire()).toBe(false);
    const m2 = mockPrisma({ ...noFilter, logic_style: "attributes" });
    expect((await publishQuiz(m2.prisma, { quizId: "qrow", shopId: "s1" })).ok).toBe(true);
    expect(m2.wire().logic_style).toBe("attributes");
  });

  it("the Filter-style gates still apply without the field", async () => {
    // Same draft minus logic_style: the stale / unmapped picking answers block.
    const draft = { ...rulesOnlyDraft([rule("r1", [["q2", "b1"]], "catX", { action: "show" })]), logic_style: undefined };
    const m = mockPrisma(draft);
    await expect(publishQuiz(m.prisma, { quizId: "qrow", shopId: "s1" })).rejects.toThrow();
  });

  it("collectPublishTargetIds: rule targets only in Rules only", () => {
    const rules = [rule("r1", [["q2", "b1"]], ["catX", "catY"])];
    expect([...collectPublishTargetIds(logicDoc({ rules, logic_style: "rules" }))]).toEqual(["catX", "catY"]);
    expect([...collectPublishTargetIds(logicDoc({ rules }))]).toEqual(["cat1", "cat2", "cat3", "catX", "catY"]);
  });
});

describe("unpublishedChanges — a style switch counts", () => {
  it("switching logic_style is one unpublished change", () => {
    const published = logicDoc();
    expect(countUnpublishedChanges(published, published)).toBe(0);
    expect(countUnpublishedChanges({ ...published, logic_style: "rules" }, published)).toBe(1);
  });
});
