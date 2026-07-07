import { describe, expect, it } from "vitest";
import { buildTier1Report } from "./pathReport";
import { Quiz } from "./quizSchema";

// ── QZY-1 — V11 filter dead ends + the cycle guard ───────────────────────────

import { wouldCreateRevisit } from "./pathAnalyzer";
import type { IndexedProduct } from "./recommendationEngine";

const BUCKETS = [
  { id: "cat_park", name: "Park Boards" },
  { id: "cat_pow", name: "Powder Boards" },
];

// intro → q1 (qualifier) → q2 (DECIDES, both answers mapped) → r1. Clean doc.
function cleanDoc(patch: Record<string, unknown> = {}) {
  return Quiz.parse({
    quiz_id: "qa",
    scope: { collection_ids: [] },
    logic_model: "decider",
    nodes: [
      { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
      {
        id: "q1",
        type: "question",
        position: { x: 1, y: 0 },
        data: {
          text: "Level?",
          question_type: "single_select",
          role: "qualifier",
          answers: [
            { id: "a_beg", text: "Beginner", tags: [], edge_handle_id: "h_beg" },
            { id: "a_adv", text: "Advanced", tags: [], edge_handle_id: "h_adv" },
          ],
        },
      },
      {
        id: "q2",
        type: "question",
        position: { x: 2, y: 0 },
        data: {
          text: "Terrain?",
          question_type: "single_select",
          role: "decides",
          required: true,
          answers: [
            { id: "a_park", text: "Park", tags: [], edge_handle_id: "h_park", target_id: "cat_park" },
            { id: "a_pow", text: "Powder", tags: [], edge_handle_id: "h_pow", target_id: "cat_pow" },
          ],
        },
      },
      { id: "r1", type: "result", position: { x: 3, y: 0 }, data: { headline: "Match", fallback_collection_id: "c" } },
    ],
    edges: [
      { id: "e1", source: "intro", target: "q1" },
      { id: "e2", source: "q1", target: "q2" },
      { id: "e3", source: "q2", target: "r1" },
    ],
    ...patch,
  });
}

// The same doc + a dangling `end1` terminal for bypass fixtures.
function withEnd(patch: Record<string, unknown> = {}) {
  const base = cleanDoc();
  return Quiz.parse({
    ...base,
    nodes: [
      ...base.nodes,
      { id: "end1", type: "end", position: { x: 3, y: 1 }, data: { headline: "Bye" } },
    ],
    ...patch,
  });
}

const byId = (r: ReturnType<typeof buildTier1Report>, id: string) =>
  r.checks.find((c) => c.id === id)!;

describe("buildTier1Report (§7.1 Tier-1)", () => {
  it("clean doc → all 11 checks pass (incl. S1 structure), verdict safe, outcomes named", () => {
    const r = buildTier1Report(cleanDoc(), BUCKETS);
    expect(r.checks).toHaveLength(11);
    expect(r.checks.every((c) => c.status === "pass")).toBe(true);
    expect(r.verdict).toMatchObject({ blocking: 0, warnings: 0, safe: true });
    expect(r.verdict.label).toBe("0 to review · 0 blocking · safe to publish");
    expect(r.outcomes.map((o) => o.targetName)).toEqual(["Park Boards", "Powder Boards"]);
  });

  it("REGRESSION (review blocker 1): a qualifier AFTER the decider is NOT a V2 bypass", () => {
    // intro → q2 (decides, mapped) → q1 (qualifier) → r1 — decider first.
    const doc = cleanDoc({
      edges: [
        { id: "e1", source: "intro", target: "q2" },
        { id: "e2", source: "q2", target: "q1" },
        { id: "e3", source: "q1", target: "r1" },
      ],
    });
    const r = buildTier1Report(doc, BUCKETS);
    expect(byId(r, "V2").status).toBe("pass"); // the shopper already answered the decider
    expect(byId(r, "S1").status).toBe("pass");
    expect(r.verdict.safe).toBe(true); // and the gate agrees (validateQuiz = [])
  });

  it("REGRESSION (review blocker 2a): a branch-lane bypass is caught at the feeding answer", () => {
    // q1's answers route through a branch whose 2nd lane ends WITHOUT the decider.
    const doc = withEnd({
      nodes: [
        ...withEnd().nodes,
        {
          id: "b1",
          type: "branch",
          position: { x: 1.5, y: 0 },
          data: { label: "AB", slots: [{ id: "s1", label: "A" }, { id: "s2", label: "B" }] },
        },
      ],
      edges: [
        { id: "e1", source: "intro", target: "q1" },
        { id: "e2", source: "q1", target: "b1" },
        { id: "eA", source: "b1", target: "q2", source_handle: "s1" },
        { id: "eB", source: "b1", target: "end1", source_handle: "s2" }, // bypass lane
        { id: "e3", source: "q2", target: "r1" },
      ],
    });
    const r = buildTier1Report(doc, BUCKETS);
    expect(byId(r, "V2").status).toBe("fail");
    // BOTH of q1's answers feed the branch → both flagged.
    expect(byId(r, "V2").findings).toHaveLength(2);
    expect(r.verdict.safe).toBe(false);
  });

  it("REGRESSION (review blocker 2b): gate fold-in — an orphan question means NOT safe", () => {
    // q1 unreachable (intro wired straight to the decider) → the publish gate
    // blocks on `orphan`; the report's S1 row must agree.
    const doc = cleanDoc({
      edges: [
        { id: "e1", source: "intro", target: "q2" },
        { id: "e3", source: "q2", target: "r1" },
      ],
    });
    const r = buildTier1Report(doc, BUCKETS);
    expect(byId(r, "S1").status).toBe("fail");
    expect(byId(r, "S1").findings[0]!.link).toEqual({ kind: "question", nodeId: "q1" });
    expect(r.verdict.safe).toBe(false);
  });

  it("V2 gate-fallback: a no-answer bypass (intro wired straight to a terminal) still fails V2", () => {
    const doc = withEnd({
      edges: [
        { id: "e1", source: "intro", target: "q1" },
        { id: "e1b", source: "intro", target: "end1" }, // no answer to pin this on
        { id: "e2", source: "q1", target: "q2" },
        { id: "e3", source: "q2", target: "r1" },
      ],
    });
    const r = buildTier1Report(doc, BUCKETS);
    expect(byId(r, "V2").status).toBe("fail"); // the gate's decider_bypass surfaced
    expect(r.verdict.safe).toBe(false);
  });

  it("V1 fails on zero deciders AND on two deciders", () => {
    const none = cleanDoc();
    const noDecider = Quiz.parse({
      ...none,
      nodes: none.nodes.map((n) =>
        n.type === "question" ? { ...n, data: { ...n.data, role: "qualifier" as const } } : n,
      ),
    });
    expect(byId(buildTier1Report(noDecider, BUCKETS), "V1").status).toBe("fail");

    const two = Quiz.parse({
      ...none,
      nodes: none.nodes.map((n) =>
        n.type === "question" ? { ...n, data: { ...n.data, role: "decides" as const } } : n,
      ),
    });
    const v1 = byId(buildTier1Report(two, BUCKETS), "V1");
    expect(v1.status).toBe("fail");
    // Each EXTRA decider gets its own deep-linked finding (§7.3).
    expect(v1.findings).toHaveLength(1);
    expect(v1.findings[0]!.link).toEqual({ kind: "question", nodeId: "q2" });
  });

  it("V2 flags the ANSWER whose skip route bypasses the decider (answer-level)", () => {
    const doc = withEnd({
      edges: [
        { id: "e1", source: "intro", target: "q1" },
        { id: "e2", source: "q1", target: "q2" },
        { id: "eSkip", source: "q1", target: "end1", source_handle: "h_adv" }, // bypass!
        { id: "e3", source: "q2", target: "r1" },
      ],
    });
    const v2 = byId(buildTier1Report(doc, BUCKETS), "V2");
    expect(v2.status).toBe("fail");
    expect(v2.findings).toHaveLength(1); // ONLY the bypassing answer, not its sibling
    expect(v2.findings[0]!.message).toMatch(/Advanced/);
    expect(v2.findings[0]!.link).toEqual({ kind: "question", nodeId: "q1" });
    expect(byId(buildTier1Report(doc, BUCKETS), "V1").status).toBe("pass");
  });

  it("V3 fails on an optional decider; V4 on unmapped + deleted-bucket targets", () => {
    const base = cleanDoc();
    const optional = Quiz.parse({
      ...base,
      nodes: base.nodes.map((n) =>
        n.id === "q2" && n.type === "question" ? { ...n, data: { ...n.data, required: false } } : n,
      ),
    });
    expect(byId(buildTier1Report(optional, BUCKETS), "V3").status).toBe("fail");

    // One bucket vanishes → the answer targeting it is a V4 finding.
    const v4 = byId(buildTier1Report(base, [BUCKETS[0]!]), "V4");
    expect(v4.status).toBe("fail");
    expect(v4.findings[0]!.message).toMatch(/deleted bucket/);
  });

  it("V5/V6 block on rule refs to deleted buckets/answers; V9 warns on half-built; verdict counts", () => {
    const doc = cleanDoc({
      decision_rules: [
        { id: "r1", conditions: [{ question_id: "q1", answer_id: "a_adv", op: "is" }], target_id: "cat_GONE" }, // V5
        { id: "r2", conditions: [{ question_id: "q1", answer_id: "a_GONE", op: "is" }], target_id: "cat_park" }, // V6
        { id: "r3", conditions: [], target_id: "cat_park" }, // V9
      ],
    });
    const r = buildTier1Report(doc, BUCKETS);
    expect(byId(r, "V5").findings[0]!.link).toEqual({ kind: "rule", ruleId: "r1" });
    expect(byId(r, "V6").findings[0]!.message).toMatch(/Rule 2/);
    expect(byId(r, "V9").status).toBe("fail");
    expect(r.verdict.safe).toBe(false);
    expect(r.verdict.blocking).toBe(2); // V5 + V6 (V9 is a warning)
    expect(r.verdict.warnings).toBe(1);
    expect(r.verdict.label).toBe("1 to review · 2 blocking · not safe to publish");
    // The rule outcomes name their targets ("(deleted result)" — the merchant
    // DID pick one; distinguishing it from never-picked matches the V5 wording).
    expect(r.outcomes.find((o) => o.label === "Rule 1")?.targetName).toBe("(deleted result)");
  });

  it("V10 is INFO-only: a 60+-char answer is reported but never blocks", () => {
    const base = cleanDoc();
    const long = Quiz.parse({
      ...base,
      nodes: base.nodes.map((n) =>
        n.id === "q1" && n.type === "question"
          ? {
              ...n,
              data: {
                ...n.data,
                answers: n.data.answers.map((a, i) =>
                  i === 0 ? { ...a, text: "x".repeat(60) } : a,
                ),
              },
            }
          : n,
      ),
    });
    const r = buildTier1Report(long, BUCKETS);
    expect(byId(r, "V10").status).toBe("fail");
    expect(byId(r, "V10").severity).toBe("info");
    expect(r.verdict.safe).toBe(true); // info never blocks (§10)
    expect(r.verdict.blocking).toBe(0);
    expect(r.verdict.warnings).toBe(0); // …and never counts as a warning either
  });
});

const IDX: IndexedProduct[] = [
  { product_id: "p1", title: "P1", handle: "p1", price: "10", image_url: null, tags: ["Soft"], collection_ids: [], inventory_in_stock: true },
  { product_id: "p2", title: "P2", handle: "p2", price: "0", image_url: null, tags: ["velvet"], collection_ids: [], inventory_in_stock: false },
];

function withFilterQ(tags: string[], extra: Record<string, unknown> = {}) {
  const base = cleanDoc();
  return Quiz.parse({
    ...base,
    nodes: base.nodes.map((n) =>
      n.id === "q1"
        ? {
            ...n,
            data: {
              ...(n as { data: Record<string, unknown> }).data,
              role: "filter",
              answers: [
                { id: "a_beg", text: "Beginner", tags, edge_handle_id: "h_beg", ...extra },
                { id: "a_adv", text: "Advanced", tags: ["soft"], edge_handle_id: "h_adv" },
              ],
            },
          }
        : n,
    ),
  });
}

describe("QZY-1 V11 — filter answers must match products", () => {
  it("omits the check entirely without a product index (never a hollow pass)", () => {
    const r = buildTier1Report(cleanDoc(), BUCKETS);
    expect(r.checks.find((c) => c.id === "V11")).toBeUndefined();
  });

  it("flags a filter answer matching 0 SELLABLE products as blocking", () => {
    // "velvet" only matches p2, which is $0 + OOS → not sellable → dead end.
    const r = buildTier1Report(withFilterQ(["velvet"]), BUCKETS, IDX);
    const v11 = r.checks.find((c) => c.id === "V11")!;
    expect(v11.status).toBe("fail");
    expect(v11.severity).toBe("block");
    expect(v11.findings[0]!.message).toContain("matches 0 products");
    expect(r.verdict.blocking).toBeGreaterThan(0);
  });

  it("passes when every filter answer matches (case-insensitive)", () => {
    const r = buildTier1Report(withFilterQ(["soft"]), BUCKETS, IDX);
    expect(r.checks.find((c) => c.id === "V11")!.status).toBe("pass");
  });

  it("no_preference answers are pass-throughs, never dead ends", () => {
    const r = buildTier1Report(withFilterQ(["velvet"], { no_preference: true }), BUCKETS, IDX);
    // a_beg passes through; a_adv (soft) matches → clean.
    expect(r.checks.find((c) => c.id === "V11")!.status).toBe("pass");
  });
});

describe("QZY-1 wouldCreateRevisit — THEN GO TO cycle guard", () => {
  it("routing forward is fine", () => {
    expect(wouldCreateRevisit(cleanDoc() as never, "q1", "q2")).toBe(false);
    expect(wouldCreateRevisit(cleanDoc() as never, "q1", "r1")).toBe(false);
  });
  it("routing to itself is a revisit", () => {
    expect(wouldCreateRevisit(cleanDoc() as never, "q1", "q1")).toBe(true);
  });
  it("routing BACK to an earlier question is a revisit", () => {
    expect(wouldCreateRevisit(cleanDoc() as never, "q2", "q1")).toBe(true);
  });
});
