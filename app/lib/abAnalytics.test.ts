import { describe, expect, it } from "vitest";
import { Quiz } from "./quizSchema";
import {
  findAbBranches,
  aggregateVariantFunnel,
  aggregateAllAbFunnels,
  readAssignment,
  pickAbWinner,
  type VariantEvent,
  type FunnelCounts,
} from "./abAnalytics";

function docWithBranch(mode: "rules" | "ab_split") {
  return Quiz.parse({
    quiz_id: "q1",
    scope: { collection_ids: [] },
    nodes: [
      { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
      {
        id: "br1",
        type: "branch",
        position: { x: 1, y: 0 },
        data: {
          label: "Test",
          mode,
          slots: [
            { id: "sl_a", label: "A", weight: 30 },
            { id: "sl_b", label: "B", weight: 70 },
          ],
        },
      },
      {
        id: "r1",
        type: "result",
        position: { x: 2, y: 0 },
        data: { headline: "Done", fallback_collection_id: "gid://c/fb" },
      },
    ],
    edges: [{ id: "e1", source: "intro", target: "br1" }],
  });
}

function ev(
  sessionId: string,
  eventType: string,
  ab?: Record<string, string>,
): VariantEvent {
  return { sessionId, eventType, payload: ab ? { ab } : {} };
}

describe("findAbBranches", () => {
  it("returns only ab_split branches", () => {
    expect(findAbBranches(docWithBranch("ab_split")).map((b) => b.id)).toEqual(["br1"]);
    expect(findAbBranches(docWithBranch("rules"))).toEqual([]);
  });
});

describe("readAssignment", () => {
  it("extracts the slot for a branch, else null", () => {
    expect(readAssignment({ ab: { br1: "sl_a" } }, "br1")).toBe("sl_a");
    expect(readAssignment({ ab: { br1: "sl_a" } }, "other")).toBeNull();
    expect(readAssignment({}, "br1")).toBeNull();
    expect(readAssignment(null, "br1")).toBeNull();
  });
});

describe("aggregateVariantFunnel", () => {
  const slots = [
    { id: "sl_a", label: "A", weight: 30 },
    { id: "sl_b", label: "B", weight: 70 },
  ];

  it("buckets distinct sessions per slot by stage", () => {
    const events: VariantEvent[] = [
      ev("s1", "quiz_started", { br1: "sl_a" }),
      ev("s1", "quiz_completed", { br1: "sl_a" }),
      ev("s2", "quiz_started", { br1: "sl_a" }),
      ev("s3", "quiz_started", { br1: "sl_b" }),
      ev("s3", "recommendation_clicked", { br1: "sl_b" }),
    ];
    const f = aggregateVariantFunnel(events, "br1", slots);
    expect(f.sl_a).toMatchObject({ entered: 2, started: 2, completed: 1, clicked: 0 });
    expect(f.sl_b).toMatchObject({ entered: 1, started: 1, completed: 0, clicked: 1 });
  });

  it("counts a session once per stage even with duplicate events", () => {
    const events: VariantEvent[] = [
      ev("s1", "quiz_started", { br1: "sl_a" }),
      ev("s1", "quiz_started", { br1: "sl_a" }),
    ];
    expect(aggregateVariantFunnel(events, "br1", slots).sl_a!.started).toBe(1);
  });

  it("skips events with no assignment or an unknown slot", () => {
    const events: VariantEvent[] = [
      ev("s1", "quiz_started"), // untagged (legacy)
      ev("s2", "quiz_started", { br1: "sl_gone" }), // stale slot
      ev("s3", "quiz_started", { other: "x" }), // different branch
    ];
    const f = aggregateVariantFunnel(events, "br1", slots);
    expect(f.sl_a!.started).toBe(0);
    expect(f.sl_b!.started).toBe(0);
  });

  it("returns a zeroed funnel per slot when there are no events", () => {
    const f = aggregateVariantFunnel([], "br1", slots);
    expect(f.sl_a!).toEqual({ entered: 0, started: 0, answered: 0, completed: 0, viewed: 0, clicked: 0 });
  });
});

describe("aggregateAllAbFunnels", () => {
  it("keys by branch id then slot id for every ab_split branch", () => {
    const doc = docWithBranch("ab_split");
    const all = aggregateAllAbFunnels(doc, [ev("s1", "quiz_started", { br1: "sl_b" })]);
    expect(Object.keys(all)).toEqual(["br1"]);
    expect(all.br1!.sl_b!.started).toBe(1);
  });

  it("is empty for a quiz with no ab_split branch", () => {
    expect(aggregateAllAbFunnels(docWithBranch("rules"), [])).toEqual({});
  });
});

describe("pickAbWinner", () => {
  const mk = (entered: number, clicked: number): FunnelCounts => ({
    entered,
    started: entered,
    answered: entered,
    completed: clicked,
    viewed: entered,
    clicked,
  });

  it("returns the strict leader once ≥2 variants clear the min sample", () => {
    const w = pickAbWinner({ a: mk(100, 40), b: mk(100, 25) }, { minSample: 30 });
    expect(w?.slotId).toBe("a");
    expect(w?.rate).toBeCloseTo(0.4, 5);
  });

  it("returns null when fewer than 2 variants have enough samples", () => {
    expect(pickAbWinner({ a: mk(100, 40), b: mk(5, 4) }, { minSample: 30 })).toBeNull();
  });

  it("returns null on a tie (no clear winner)", () => {
    expect(pickAbWinner({ a: mk(100, 30), b: mk(100, 30) }, { minSample: 30 })).toBeNull();
  });

  it("can optimize for completion instead of clicks", () => {
    const w = pickAbWinner(
      { a: mk(100, 10), b: mk(100, 50) },
      { minSample: 30, metric: "completed" },
    );
    expect(w?.slotId).toBe("b");
    expect(w?.metric).toBe("completed");
  });
});
