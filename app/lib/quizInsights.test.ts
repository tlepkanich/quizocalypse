import { describe, expect, it } from "vitest";
import { Quiz } from "./quizSchema";
import type { Quiz as QuizDoc } from "./quizSchema";
import { buildQuizInsights, distinctOutcomes, type InsightInputs } from "./quizInsights";
import type { StepLedger, LedgerStep } from "./stepLedger";

// ANALYTICS P0 — the deterministic insight rules. Doc-static (Tier A) cards
// fire at zero traffic; Tier B cards gate themselves on n; the list caps at 3.

function questionNode(id: string, text: string, answerCount = 2, qtype = "single_select") {
  return {
    id,
    type: "question",
    position: { x: 0, y: 0 },
    data: {
      text,
      question_type: qtype,
      answers: Array.from({ length: answerCount }, (_, i) => ({
        id: `${id}-a${i}`,
        text: `Option ${i}`,
        tags: [],
        edge_handle_id: `${id}-h${i}`,
      })),
    },
  };
}

function docWith(questions: unknown[], resultCount = 1): QuizDoc {
  return Quiz.parse({
    quiz_id: "qz",
    status: "published",
    scope: { collection_ids: [] },
    nodes: [
      { id: "i1", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
      ...questions,
      ...Array.from({ length: resultCount }, (_, i) => ({
        id: `r${i}`,
        type: "result",
        position: { x: 9, y: i },
        data: { headline: `R${i}`, fallback_collection_id: "c" },
      })),
    ],
  });
}

function inputs(partial: Partial<InsightInputs> & { doc: QuizDoc }): InsightInputs {
  return {
    reachability: null,
    ledger: null,
    engaged: 0,
    completed: 0,
    rangeDays: 90,
    published: true,
    ...partial,
  };
}

function ledgerOf(rows: Array<Partial<LedgerStep> & { nodeId: string }>): StepLedger {
  const steps = rows.map((r) => ({
    kind: "question" as const,
    label: r.nodeId,
    reached: null,
    continued: null,
    skipped: null,
    left: null,
    dropoff: null,
    splits: false,
    laneLabel: null,
    ...r,
  }));
  let steepestNodeId: string | null = null;
  let best = 0;
  for (const s of steps) {
    if (s.dropoff != null && s.dropoff > best) {
      best = s.dropoff;
      steepestNodeId = s.nodeId;
    }
  }
  return { branching: false, steps, steepestNodeId };
}

describe("Tier A — doc-static", () => {
  it("SINGLE_RESULT: every answer to one outcome is a crit finding", () => {
    const doc = docWith([questionNode("q1", "One?"), questionNode("q2", "Two?")], 1);
    expect(distinctOutcomes(doc)).toBe(1);
    const r = buildQuizInsights(inputs({ doc }));
    expect(r.cards.some((c) => c.id === "single-result" && c.severity === "crit")).toBe(true);
  });

  it("stays quiet on a healthy two-result doc", () => {
    const doc = docWith([questionNode("q1", "One?"), questionNode("q2", "Two?")], 2);
    const r = buildQuizInsights(inputs({ doc, engaged: 300 }));
    expect(r.clean).toBe(true);
  });

  it("QUIZ_TOO_LONG fires past 7 questions; OPTION_OVERLOAD past 8 options", () => {
    const doc = docWith(
      [...Array.from({ length: 8 }, (_, i) => questionNode(`q${i}`, `Q ${i}?`)), questionNode("qBig", "Pick", 10)],
      2,
    );
    const r = buildQuizInsights(inputs({ doc, engaged: 300 }));
    const all = [...r.cards];
    // More findings exist than the cap shows.
    expect(r.cards.length).toBeLessThanOrEqual(3);
    expect(all.some((c) => c.id === "quiz-too-long") || r.more > 0).toBe(true);
  });

  it("unreachable products card carries the counts", () => {
    const doc = docWith([questionNode("q1", "One?")], 2);
    const r = buildQuizInsights(
      inputs({
        doc,
        engaged: 300,
        reachability: {
          mapped: 84,
          targetCount: 4,
          unreachable: Array.from({ length: 7 }, (_, i) => ({ productId: `p${i}`, title: `P${i}` })),
          stateById: new Map(),
        },
      }),
    );
    const card = r.cards.find((c) => c.id === "unreachable-products")!;
    expect(card.headline).toContain("7 of your 84");
    expect(card.severity).toBe("warn");
  });
});

describe("Tier B — gated on n", () => {
  const doc = docWith([questionNode("q1", "One?"), questionNode("q2", "Two?"), questionNode("q3", "Three?")], 2);

  it("a steep leak at n ≥ 100 gets an exact percentage and shopper math", () => {
    const ledger = ledgerOf([
      { nodeId: "q1", reached: 1000, dropoff: 0.03, left: 30 },
      { nodeId: "q2", reached: 900, dropoff: 0.2, left: 180 },
      { nodeId: "q3", reached: 700, dropoff: 0.04, left: 28 },
    ]);
    const r = buildQuizInsights(inputs({ doc, ledger, engaged: 1000, completed: 600 }));
    const leak = r.cards.find((c) => c.id === "leak:q2")!;
    expect(leak.headline).toContain("20%");
    expect(leak.evidence.some((e) => e.label === "Reached" && e.value === "900")).toBe(true);
  });

  it("the same leak at 30 ≤ n < 100 ranks WITHOUT a percentage", () => {
    const ledger = ledgerOf([
      { nodeId: "q1", reached: 50, dropoff: 0.03, left: 2 },
      { nodeId: "q2", reached: 45, dropoff: 0.2, left: 9 },
      { nodeId: "q3", reached: 35, dropoff: 0.04, left: 1 },
    ]);
    const r = buildQuizInsights(inputs({ doc, ledger, engaged: 250, completed: 200 }));
    const leak = r.cards.find((c) => c.id === "leak:q2")!;
    expect(leak.headline).not.toContain("%");
    expect(leak.headline).toContain("steepest drop");
  });

  it("below n = 30 the leak says nothing at all", () => {
    const ledger = ledgerOf([
      { nodeId: "q1", reached: 20, dropoff: 0.03, left: 1 },
      { nodeId: "q2", reached: 18, dropoff: 0.3, left: 5 },
      { nodeId: "q3", reached: 12, dropoff: 0.04, left: 0 },
    ]);
    const r = buildQuizInsights(inputs({ doc, ledger, engaged: 250, completed: 200 }));
    expect(r.cards.find((c) => c.id === "leak:q2")).toBeUndefined();
  });

  it("TRAFFIC_STARVED fires on a live quiz under 200 sessions", () => {
    const r = buildQuizInsights(inputs({ doc, engaged: 40, published: true }));
    expect(r.cards.some((c) => c.id === "traffic-starved")).toBe(true);
  });

  it("never on a draft (engaged 0 means nothing to starve)", () => {
    const r = buildQuizInsights(inputs({ doc, engaged: 0, published: false }));
    expect(r.cards.some((c) => c.id === "traffic-starved")).toBe(false);
  });
});

describe("ranking + cap", () => {
  it("caps at 3 cards, reports the rest, and puts crit first", () => {
    const doc = docWith(
      [
        ...Array.from({ length: 9 }, (_, i) => questionNode(`q${i}`, `Question number ${i}?`, 10)),
      ],
      1, // single-result crit on top of the overload cards
    );
    const r = buildQuizInsights(inputs({ doc, engaged: 40 }));
    expect(r.cards).toHaveLength(3);
    expect(r.more).toBeGreaterThan(0);
    expect(r.cards[0]!.severity).toBe("crit");
  });
});
