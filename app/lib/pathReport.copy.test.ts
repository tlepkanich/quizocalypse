import { describe, expect, it } from "vitest";
import { buildTier1Report, type Tier1Report } from "./pathReport";
import { Quiz } from "./quizSchema";
import type { IndexedProduct } from "./recommendationEngine";
import { BANNED_REPORT_WORDS, REPORT_COPY } from "./reportCopy";

// Logic step (handoff §13, D18) — the report's copy and its grouping. Every
// finding message and check title the report can produce is plain merchant
// copy: no em dash, never decider/bucket/branch/boost/weight/score.

type Raw = Record<string, unknown>;
type RawNode = { id: string; type: string; data: Raw; position?: unknown };

const pos = { x: 0, y: 0 };
const BUCKETS = [
  { id: "cat_park", name: "Park Boards", quizId: "qz", productIds: ["p1"] },
  { id: "cat_pow", name: "Powder Boards", quizId: "qz", productIds: ["p1"] },
  { id: "cat_spare", name: "Spare", quizId: "qz", productIds: [] },
];

const qNode = (id: string, role: string, answers: Raw[], extra: Raw = {}): RawNode => ({
  id,
  type: "question",
  position: pos,
  data: { text: `Question ${id}`, question_type: "single_select", role, required: true, answers, ...extra },
});
const ans = (id: string, extra: Raw = {}): Raw => ({ id, text: id.toUpperCase(), tags: [], edge_handle_id: `h_${id}`, ...extra });

// intro → q1 (qualifier) → q2 (picks) → r1, plus a spare end screen.
function base(): { nodes: RawNode[]; edges: Raw[] } {
  return {
    nodes: [
      { id: "intro", type: "intro", position: pos, data: { headline: "Hi" } },
      qNode("q1", "qualifier", [ans("a_beg"), ans("a_adv")]),
      qNode("q2", "decides", [ans("a_park", { target_id: "cat_park" }), ans("a_pow", { target_id: "cat_pow" })]),
      { id: "r1", type: "result", position: pos, data: { headline: "Match", fallback_collection_id: "c" } },
      { id: "end1", type: "end", position: pos, data: { headline: "Bye" } },
    ],
    edges: [
      { id: "e1", source: "intro", target: "q1" },
      { id: "e2", source: "q1", target: "q2" },
      { id: "e3", source: "q2", target: "r1" },
    ],
  };
}

function doc(patch: (d: { nodes: RawNode[]; edges: Raw[] }) => void = () => {}, top: Raw = {}) {
  const d = base();
  patch(d);
  // The spare end screen only exists when a route uses it.
  if (!d.edges.some((e) => e.target === "end1")) d.nodes = d.nodes.filter((n) => n.id !== "end1");
  return Quiz.parse({ quiz_id: "qz", scope: { collection_ids: [] }, logic_model: "decider", ...d, ...top });
}
const node = (d: { nodes: RawNode[] }, id: string) => d.nodes.find((n) => n.id === id)!;
const cond = (question_id: string, answer_id: string, op: "is" | "is_not" = "is") => ({ question_id, answer_id, op });

const IDX: IndexedProduct[] = [
  ...Array.from({ length: 6 }, (_, i) => ({
    product_id: `p${i}`,
    title: `P${i}`,
    handle: `p${i}`,
    price: "10",
    image_url: null,
    tags: ["soft"],
    collection_ids: [],
    inventory_in_stock: true,
  })),
  { product_id: "px", title: "PX", handle: "px", price: "10", image_url: null, tags: ["soft"], collection_ids: [], inventory_in_stock: true, status: "draft" },
];

const RULES_MIX = [
  { id: "rGone", conditions: [cond("q1", "a_beg")], target_id: "GONE" }, // V5 all deleted
  { id: "rPart", conditions: [cond("q1", "a_adv")], target_id: "cat_park", target_ids: ["cat_park", "GONE"] }, // V5 some
  { id: "rIs", conditions: [cond("q1", "a_x")], target_id: "cat_park" }, // V6 is
  { id: "rNot", conditions: [cond("q1", "a_x", "is_not")], target_id: "cat_park" }, // V6 is not
  { id: "rEmpty", conditions: [], target_id: "cat_park" }, // V9 / R3
  { id: "rBoth", conditions: [cond("q1", "a_beg"), cond("q1", "a_adv")], target_id: "cat_pow" }, // R4
  { id: "rA", conditions: [cond("q2", "a_park")], target_id: "cat_pow" },
  { id: "rB", conditions: [cond("q2", "a_park")], target_id: "cat_park" }, // V8 shadowed by rA
];

// Every doc here triggers at least one finding; together they reach every
// check the report has, in both styles.
const DOCS = {
  noPicker: doc((d) => (node(d, "q2").data.role = "qualifier")),
  twoPickers: doc((d) => (node(d, "q1").data.role = "decides")),
  v2Straight: doc((d) => d.edges.push({ id: "s", source: "q1", target: "end1", source_handle: "h_a_adv" })),
  v2SkipsTo: doc((d) => {
    d.nodes.push(qNode("q3", "qualifier", [ans("c1"), ans("c2")]));
    d.edges.splice(2, 1, { id: "e3", source: "q2", target: "q3" }, { id: "e4", source: "q3", target: "r1" });
    d.edges.push({ id: "s", source: "q1", target: "q3", source_handle: "h_a_adv" });
  }),
  v2Split: doc((d) => {
    d.nodes.push({ id: "b1", type: "branch", position: pos, data: { label: "AB", slots: [{ id: "s1", label: "A" }, { id: "s2", label: "B" }] } });
    d.edges.splice(1, 1, { id: "e2", source: "q1", target: "b1" }, { id: "eA", source: "b1", target: "q2", source_handle: "s1" }, { id: "eB", source: "b1", target: "end1", source_handle: "s2" });
  }),
  v2Gate: doc((d) => d.edges.push({ id: "x", source: "intro", target: "end1" })),
  optional: doc((d) => (node(d, "q2").data.required = false)),
  v4: doc((d) => {
    node(d, "q2").data.answers = [ans("a_park"), ans("a_pow", { target_id: "GONE" }), ans("a_third")];
  }),
  rules: doc(() => {}, { decision_rules: RULES_MIX }),
  orphanRule: doc(
    (d) => d.nodes.push(qNode("q9", "qualifier", [ans("z1"), ans("z2")])),
    { decision_rules: [{ id: "rO", conditions: [cond("q9", "z1")], target_id: "cat_park" }] },
  ),
  exclusive: doc(
    (d) => {
      d.nodes.push(qNode("q3", "qualifier", [ans("c1"), ans("c2")]));
      d.nodes.push({ id: "b1", type: "branch", position: pos, data: { label: "AB", slots: [{ id: "s1", label: "A" }, { id: "s2", label: "B" }] } });
      d.edges.splice(1, 1, { id: "e2", source: "q1", target: "b1" }, { id: "eA", source: "b1", target: "q2", source_handle: "s1" }, { id: "eB", source: "b1", target: "q3", source_handle: "s2" }, { id: "e5", source: "q3", target: "r1" });
    },
    { decision_rules: [{ id: "rX", conditions: [cond("q2", "a_park"), cond("q3", "c1")], target_id: "cat_park" }] },
  ),
  longAnswer: doc((d) => (node(d, "q1").data.answers = [ans("a_beg", { text: "x".repeat(70) }), ans("a_adv")])),
  filters: doc((d) => {
    node(d, "q1").data.role = "filter";
    node(d, "q1").data.answers = [ans("a_beg", { tags: ["velvet"] }), ans("a_adv", { tags: ["velvet"] }), ans("a_soft", { tags: ["soft"] }), ans("a_unset")];
  }),
  oneEmptyFilter: doc((d) => {
    node(d, "q1").data.role = "filter";
    node(d, "q1").data.answers = [ans("a_beg", { tags: ["velvet"] }), ans("a_adv", { tags: ["soft"] })];
  }),
  slider: doc((d) => {
    d.nodes.push(
      qNode("qs", "qualifier", [ans("lo", { range: { min: 0, max: 3 } }), ans("mid", { range: { min: 2, max: 5 } })], {
        question_type: "slider",
        scale_config: { min: 0, max: 10, step: 1 },
      }),
    );
    d.edges.splice(0, 1, { id: "e0", source: "intro", target: "qs" }, { id: "e1", source: "qs", target: "q1" });
  }),
  structure: doc((d) => {
    d.nodes.push(qNode("qDead", "qualifier", [ans("d1"), ans("d2")]));
    d.nodes.push({ id: "b9", type: "branch", position: pos, data: { label: "S", slots: [{ id: "t1", label: "T" }, { id: "t2", label: "U" }] } });
    d.edges.push({ id: "x5", source: "b9", target: "r1", source_handle: "t2" });
    d.nodes.push({ id: "eg", type: "email_gate", position: pos, data: { headline: "Email" } });
    d.edges.push({ id: "x1", source: "q1", target: "qDead", source_handle: "h_a_adv" });
    d.edges.push({ id: "x2", source: "q1", target: "b9", source_handle: "h_a_beg" });
    d.edges.push({ id: "x3", source: "q2", target: "eg", source_handle: "h_a_pow" });
    d.edges.push({ id: "x4", source: "eg", target: "r1" });
  }),
  introNoOut: doc((d) => d.edges.splice(0, 1)),
  rulesOnlyEmpty: doc(() => {}, { logic_style: "rules" }),
  rulesOnlyMix: doc(() => {}, { logic_style: "rules", decision_rules: RULES_MIX }),
  rulesOnlyHide: doc(() => {}, {
    logic_style: "rules",
    decision_rules: [{ id: "rH", conditions: [cond("q1", "a_beg")], target_id: "cat_park", action: "hide" }],
  }),
  styleNote: doc(
    (d) => {
      node(d, "q2").data.role = "qualifier";
    },
    { decision_rules: [{ id: "r1", conditions: [cond("q1", "a_beg")], target_id: "cat_park" }] },
  ),
};

function allReports(): Array<[string, Tier1Report]> {
  const out: Array<[string, Tier1Report]> = [];
  for (const [name, d] of Object.entries(DOCS)) {
    out.push([name, buildTier1Report(d, BUCKETS, IDX, { styleNote: true })]);
    out.push([`${name}·noindex`, buildTier1Report(d, BUCKETS.slice(0, 2))]);
  }
  return out;
}

describe("report copy (D18)", () => {
  it("no finding message or check title uses an em dash or an internal word", () => {
    const offenders: string[] = [];
    const failing = new Set<string>();
    for (const [name, r] of allReports()) {
      for (const c of r.checks) {
        if (BANNED_REPORT_WORDS.test(c.title)) offenders.push(`${name} ${c.id} title: ${c.title}`);
        if (c.status === "fail") failing.add(c.id);
        for (const f of c.findings) {
          if (BANNED_REPORT_WORDS.test(f.message)) offenders.push(`${name} ${c.id}: ${f.message}`);
        }
      }
    }
    expect(offenders).toEqual([]);
    // The sweep really reached every check.
    const expected = ["R0", "R1", "R2", "R3", "R4", "R5", "R6", "S1", ...Array.from({ length: 16 }, (_, i) => `V${i + 1}`)];
    expect([...failing].sort()).toEqual(expected.sort());
  });

  it("every REPORT_COPY string and title is clean too", () => {
    const strings: string[] = [];
    const walk = (v: unknown): void => {
      if (typeof v === "string") strings.push(v);
      else if (typeof v === "function") strings.push(String(v(...["Q1", "“A”", 2, 3].slice(0, v.length))));
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(REPORT_COPY);
    expect(strings.filter((s) => BANNED_REPORT_WORDS.test(s))).toEqual([]);
  });
});

describe("report grouping and wording (handoff §13)", () => {
  const find = (r: Tier1Report, id: string) => r.checks.find((c) => c.id === id);

  it("V4 groups per question per case, and N counts each group once", () => {
    const r = buildTier1Report(DOCS.v4, BUCKETS);
    expect(find(r, "V4")!.findings.map((f) => f.message)).toEqual([
      REPORT_COPY.answersNoRec("Q2", 2),
      REPORT_COPY.answersDeletedRec("Q2", 1),
    ]);
    expect(r.verdict.blocking).toBe(2);
  });

  it("V1 wording: none, and a second picking question", () => {
    expect(find(buildTier1Report(DOCS.noPicker, BUCKETS), "V1")!.findings[0]!.message).toBe(REPORT_COPY.noPicker);
    expect(find(buildTier1Report(DOCS.twoPickers, BUCKETS), "V1")!.findings[0]!.message).toBe(
      REPORT_COPY.alsoPicks("Q2"),
    );
  });

  it("V2 reports the route, not every answer upstream of it", () => {
    // Q1 → Q2 → Q3 (picks); only Q2 “B2” routes to the results.
    const d = Quiz.parse({
      quiz_id: "qz",
      scope: { collection_ids: [] },
      logic_model: "decider",
      nodes: [
        { id: "intro", type: "intro", position: pos, data: { headline: "Hi" } },
        qNode("q1", "qualifier", [ans("a1"), ans("a2")]),
        qNode("q2", "qualifier", [ans("b1"), ans("b2")]),
        qNode("q3", "decides", [ans("c1", { target_id: "cat_park" }), ans("c2", { target_id: "cat_pow" })]),
        { id: "r1", type: "result", position: pos, data: { headline: "Match", fallback_collection_id: "c" } },
      ],
      edges: [
        { id: "e1", source: "intro", target: "q1" },
        { id: "e2", source: "q1", target: "q2" },
        { id: "e3", source: "q2", target: "q3" },
        { id: "e4", source: "q3", target: "r1" },
        { id: "s", source: "q2", target: "r1", source_handle: "h_b2" },
      ],
    });
    const v2 = find(buildTier1Report(d, BUCKETS), "V2")!;
    expect(v2.findings.map((f) => f.message)).toEqual([REPORT_COPY.straightToResults("Q2", "B2")]);
    expect(find(buildTier1Report(DOCS.v2SkipsTo, BUCKETS), "V2")!.findings.map((f) => f.message)).toEqual([
      REPORT_COPY.skipsTo("Q1", "A_ADV", "Q3"),
    ]);
  });

  it("V13 is one row per question counting only unset answers; V11 groups too", () => {
    const r = buildTier1Report(DOCS.filters, BUCKETS, IDX);
    expect(find(r, "V13")!.findings.map((f) => f.message)).toEqual([REPORT_COPY.keepsEverything("Q1", 1)]);
    expect(find(r, "V11")!.findings.map((f) => f.message)).toEqual([REPORT_COPY.answersKeepNoProducts("Q1", 2)]);
    expect(find(r, "V14")!.findings.map((f) => f.message)).toEqual([REPORT_COPY.notLive(1, 7)]);
  });

  it("V6 says which way a deleted answer breaks the rule", () => {
    const v6 = find(buildTier1Report(DOCS.rules, BUCKETS), "V6")!.findings.map((f) => f.message);
    expect(v6).toEqual([REPORT_COPY.ruleDeletedAnswer(3), REPORT_COPY.ruleDeletedAnswerMatchesAll(4)]);
  });

  it("V5 tells all-deleted from some-deleted", () => {
    const v5 = find(buildTier1Report(DOCS.rules, BUCKETS), "V5")!.findings.map((f) => f.message);
    expect(v5).toEqual([REPORT_COPY.ruleNoRec(1), REPORT_COPY.ruleDeletedRec(2)]);
  });

  it("P1-3: Rules only with zero rules lists no “never recommended” rows", () => {
    const r = buildTier1Report(DOCS.rulesOnlyEmpty, BUCKETS);
    expect(find(r, "R1")!.findings.map((f) => f.message)).toEqual([REPORT_COPY.rulesOnlyNeedsRule]);
    expect(find(r, "R5")!.findings).toEqual([]);
    // With a rule, the uncovered recommendations are listed again.
    const withRule = buildTier1Report(DOCS.rulesOnlyHide, BUCKETS);
    expect(find(withRule, "R5")!.findings.length).toBeGreaterThan(0);
  });

  it("R0 fires with the Filter blocks, which carry the same sentence", () => {
    const r = buildTier1Report(DOCS.styleNote, BUCKETS, undefined, { styleNote: true });
    expect(find(r, "R0")!.findings[0]!.message).toBe(REPORT_COPY.styleNotSaved);
    const v1 = find(r, "V1")!.findings[0]!.message;
    expect(v1).toBe(`${REPORT_COPY.noPicker} ${REPORT_COPY.styleNotSaved}`);
    // A finding without a closing period gets one before the sentence.
    const v4 = buildTier1Report(
      Quiz.parse({ ...DOCS.styleNote, nodes: DOCS.v4.nodes }),
      BUCKETS,
      undefined,
      { styleNote: true },
    );
    expect(find(v4, "V4")?.findings[0]?.message).toBe(
      `${REPORT_COPY.answersNoRec("Q2", 2)}. ${REPORT_COPY.styleNotSaved}`,
    );
    // Without the host opting in, nothing is appended.
    const plain = buildTier1Report(DOCS.styleNote, BUCKETS);
    expect(find(plain, "V1")!.findings[0]!.message).toBe(REPORT_COPY.noPicker);
  });

  it("S1 maps the gate's structural messages to plain copy", () => {
    const s1 = find(buildTier1Report(DOCS.structure, BUCKETS), "S1")!.findings.map((f) => f.message);
    expect(s1).toContain(REPORT_COPY.structure.deadEnd("Q3"));
    expect(s1).toContain(REPORT_COPY.structure.splitDeadEnd);
    expect(s1).toContain(REPORT_COPY.structure.oldEmailStep);
    expect(find(buildTier1Report(DOCS.introNoOut, BUCKETS), "S1")!.findings.map((f) => f.message)).toContain(
      REPORT_COPY.structure.introNoOut,
    );
  });
});
