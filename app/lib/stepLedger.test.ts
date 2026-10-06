import { describe, expect, it } from "vitest";
import { Quiz } from "./quizSchema";
import { STEEPEST_MIN_REACHED, buildStepLedger, lastAnswers, typicalStepDropoff } from "./stepLedger";

// ANALYTICS P0 — the merged step ledger. Reconciliation (reached = continued +
// skipped + left) is the whole point; it's asserted here on hand-computable
// fixtures, plus the branch rendering (counts only, no cross-lane claims).

const LINEAR = Quiz.parse({
  quiz_id: "qz",
  status: "published",
  scope: { collection_ids: [] },
  nodes: [
    { id: "i1", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
    {
      id: "q1",
      type: "question",
      position: { x: 1, y: 0 },
      data: {
        text: "One?",
        question_type: "single_select",
        answers: [
          { id: "a1", text: "A", tags: [], edge_handle_id: "h1" },
          { id: "a2", text: "B", tags: [], edge_handle_id: "h2" },
        ],
      },
    },
    {
      id: "q2",
      type: "question",
      position: { x: 2, y: 0 },
      data: {
        text: "Two?",
        question_type: "single_select",
        answers: [
          { id: "b1", text: "A", tags: [], edge_handle_id: "h3" },
          { id: "b2", text: "B", tags: [], edge_handle_id: "h4" },
        ],
      },
    },
    { id: "r1", type: "result", position: { x: 3, y: 0 }, data: { headline: "Done", fallback_collection_id: "c" } },
  ],
  edges: [
    { id: "e1", source: "i1", target: "q1" },
    { id: "e2", source: "q1", target: "q2" },
    { id: "e3", source: "q2", target: "r1" },
  ],
});

const ans = (sessionId: string, qid: string, ids: string[], ts = 0) => ({
  sessionId,
  eventType: "question_answered",
  payload: { question_id: qid, answer_ids: ids },
  ts,
});
const done = (sessionId: string) => ({ sessionId, eventType: "quiz_completed", payload: {}, ts: 99 });

describe("linear ledger", () => {
  it("reconciles every question row: reached = continued + skipped + left", () => {
    // s1 answers all + completes; s2 skips q2 + completes; s3 leaves after q1.
    const events = [
      ans("s1", "q1", ["a1"]),
      ans("s2", "q1", ["a2"]),
      ans("s3", "q1", ["a1"]),
      ans("s1", "q2", ["b1"]),
      ans("s2", "q2", []),
      done("s1"),
      done("s2"),
    ];
    const ledger = buildStepLedger(LINEAR, events, 3, 2);
    expect(ledger.branching).toBe(false);
    const q1 = ledger.steps.find((s) => s.nodeId === "q1")!;
    const q2 = ledger.steps.find((s) => s.nodeId === "q2")!;
    expect(q1).toMatchObject({ reached: 3, continued: 2, skipped: 0, left: 1 });
    expect(q2).toMatchObject({ reached: 2, continued: 1, skipped: 1, left: 0 });
    for (const row of [q1, q2]) {
      expect(row.reached).toBe(row.continued! + row.skipped! + row.left!);
    }
    // Three shoppers cannot name a steepest step: that needs 30 at the step.
    expect(ledger.steepestNodeId).toBeNull();
    // Typical = the middle drop-off of the steps that have one (intro 0,
    // q1 1/3, q2 0): the lower middle of [0, 0, 1/3].
    expect(ledger.typicalDropoff).toBe(0);
    // Intro carries engaged; the single result carries completed.
    expect(ledger.steps[0]).toMatchObject({ kind: "intro", reached: 3 });
    expect(ledger.steps.at(-1)).toMatchObject({ kind: "result", reached: 2 });
  });

  it("a session that completes without answering still counts as having reached every step (reach is a union, not a straight count)", () => {
    const events = [ans("s1", "q1", ["a1"]), done("s1"), done("s2")];
    const ledger = buildStepLedger(LINEAR, events, 2, 2);
    const q2 = ledger.steps.find((s) => s.nodeId === "q2")!;
    // s2 completed with no answers → inferred to have passed through q2.
    expect(q2.reached).toBe(2);
  });

  it("drop-off is RELATIVE to the step's own pool, not total starts", () => {
    // 10 reach q1, 5 continue; q2 keeps all 5. q1 drop = 50%.
    const events = [
      ...Array.from({ length: 10 }, (_, i) => ans(`s${i}`, "q1", ["a1"])),
      ...Array.from({ length: 5 }, (_, i) => ans(`s${i}`, "q2", ["b1"])),
      ...Array.from({ length: 5 }, (_, i) => done(`s${i}`)),
    ];
    const ledger = buildStepLedger(LINEAR, events, 10, 5);
    const q1 = ledger.steps.find((s) => s.nodeId === "q1")!;
    expect(q1.dropoff).toBeCloseTo(0.5);
  });
});

describe("last-write-wins", () => {
  it("a back-nav re-answer replaces the earlier one", () => {
    const map = lastAnswers([
      ans("s1", "q1", ["a1"], 1),
      ans("s1", "q1", [], 2), // later skip wins
    ]);
    expect(map.get("q1")!.get("s1")!.skipped).toBe(true);
  });
});

describe("branching docs", () => {
  const BRANCHED = Quiz.parse({
    quiz_id: "qz2",
    status: "published",
    scope: { collection_ids: [] },
    nodes: [
      { id: "i1", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
      {
        id: "q1",
        type: "question",
        position: { x: 1, y: 0 },
        data: {
          text: "Pick",
          question_type: "single_select",
          answers: [
            { id: "a1", text: "A", tags: [], edge_handle_id: "h1" },
            { id: "a2", text: "B", tags: [], edge_handle_id: "h2" },
          ],
        },
      },
      {
        id: "br",
        type: "branch",
        position: { x: 2, y: 0 },
        data: {
          label: "Split",
          mode: "rules",
          slots: [
            { id: "sl1", label: "Yes" },
            { id: "sl2", label: "No" },
          ],
        },
      },
      {
        id: "q2",
        type: "question",
        position: { x: 3, y: 0 },
        data: {
          text: "Lane Q",
          question_type: "single_select",
          answers: [
            { id: "b1", text: "A", tags: [], edge_handle_id: "h3" },
            { id: "b2", text: "B", tags: [], edge_handle_id: "h4" },
          ],
        },
      },
      { id: "r1", type: "result", position: { x: 4, y: 0 }, data: { headline: "Done", fallback_collection_id: "c" } },
    ],
    edges: [
      { id: "e1", source: "i1", target: "q1" },
      { id: "e2", source: "q1", target: "br" },
      { id: "e3", source: "br", source_handle: "sl1", target: "q2", condition: { answer_id: "a1" } },
      { id: "e4", source: "br", source_handle: "sl2", target: "r1", condition: { answer_id: "a2" } },
      { id: "e5", source: "q2", target: "r1" },
    ],
  });

  it("a branch does NOT disable drop-off for the spine questions before it", () => {
    // 10 answer q1; 6 go on into the lane; the rest leave at q1.
    const events = [
      ...Array.from({ length: 10 }, (_, i) => ans(`s${i}`, "q1", ["a1"])),
      ...Array.from({ length: 6 }, (_, i) => ans(`s${i}`, "q2", ["b1"])),
      ...Array.from({ length: 6 }, (_, i) => done(`s${i}`)),
    ];
    const ledger = buildStepLedger(BRANCHED, events, 10, 6);
    const q1 = ledger.steps.find((s) => s.nodeId === "q1")!;
    // q1 is on the shared spine, so its drop-off is real and reconciles.
    expect(q1.reached).toBe(10);
    expect(q1.left).toBe(4);
    expect(q1.dropoff).toBeCloseTo(0.4);
    expect(q1.reached).toBe(q1.continued! + q1.skipped! + q1.left!);
    // The lane question still refuses a drop-off claim.
    expect(ledger.steps.find((s) => s.nodeId === "q2")!.dropoff).toBeNull();
  });

  it("the intro row carries the shoppers who start and never answer", () => {
    const events = [ans("s1", "q1", ["a1"]), done("s1")];
    const ledger = buildStepLedger(BRANCHED, events, 4, 1);
    const intro = ledger.steps[0]!;
    expect(intro.kind).toBe("intro");
    expect(intro.reached).toBe(4);
    expect(intro.left).toBe(3); // 4 engaged, only 1 ever answered
    expect(intro.dropoff).toBeCloseTo(0.75);
  });

  it("renders per-lane counts with NO drop-off claims, and flags the split", () => {
    const events = [ans("s1", "q1", ["a1"]), ans("s1", "q2", ["b1"]), done("s1")];
    const ledger = buildStepLedger(BRANCHED, events, 1, 1);
    expect(ledger.branching).toBe(true);
    const branchRow = ledger.steps.find((s) => s.kind === "branch")!;
    expect(branchRow.splits).toBe(true);
    const laneQ = ledger.steps.find((s) => s.nodeId === "q2")!;
    expect(laneQ.laneLabel).toBe("Yes");
    expect(laneQ.reached).toBe(1);
    expect(laneQ.dropoff).toBeNull(); // never a cross-lane drop-off claim
    expect(ledger.steepestNodeId).toBeNull();
  });
});

describe("steepest and typical drop-off", () => {
  // 40 shoppers start; 10 leave at q1, 3 leave at q2, 27 finish.
  const cohort = () => {
    const events = [];
    for (let i = 0; i < 40; i += 1) {
      const sid = `s${i}`;
      events.push(ans(sid, "q1", ["a1"]));
      if (i >= 10) events.push(ans(sid, "q2", ["b1"]));
      if (i >= 13) events.push(done(sid));
    }
    return events;
  };

  it("names the steepest step once 30 shoppers reached it", () => {
    const ledger = buildStepLedger(LINEAR, cohort(), 40, 27);
    const q1 = ledger.steps.find((s) => s.nodeId === "q1")!;
    expect(q1.reached).toBeGreaterThanOrEqual(STEEPEST_MIN_REACHED);
    expect(q1).toMatchObject({ reached: 40, left: 10, dropoff: 0.25 });
    expect(ledger.steepestNodeId).toBe("q1");
  });

  it("typical drop-off is the middle of the steps' drop-offs; an even count takes the lower middle", () => {
    const ledger = buildStepLedger(LINEAR, cohort(), 40, 27);
    // intro 0, q1 10/40, q2 3/30 → sorted [0, 0.1, 0.25] → 0.1
    expect(ledger.typicalDropoff).toBeCloseTo(0.1, 10);
    const step = (dropoff: number | null) => ({ ...ledger.steps[0]!, dropoff });
    expect(typicalStepDropoff([step(0.4), step(0.1), step(0.2), step(0.3)])).toBe(0.2);
    expect(typicalStepDropoff([step(null)])).toBeNull();
  });
});
