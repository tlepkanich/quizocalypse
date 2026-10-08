import { describe, expect, it } from "vitest";
import { Quiz, type Quiz as QuizDoc } from "./quizSchema";
import { buildFlowPaths } from "./flowPaths";
import {
  allLedgerPaths,
  buildStepLedger,
  ledgerPathById,
  questionPath,
  type LedgerEvent,
  type LedgerFork,
  type LedgerStep,
  type StepLedger,
} from "./stepLedger";
import { buildQuizInsights } from "./quizInsights";

// ANALYTICS-HANDOFF Data work 5b — branching paths in the step ledger. The
// fixtures follow the mock: Question 1 splits (Path A: Dry or Sensitive → Q2
// and Q4; Path B: everyone else → Q3), the paths join at Q5, then a result.

type Ans = { id: string; text: string };
const question = (id: string, text: string, answers: Ans[]) => ({
  id,
  type: "question" as const,
  position: { x: 0, y: 0 },
  data: {
    text,
    question_type: "single_select" as const,
    answers: answers.map((a) => ({ id: a.id, text: a.text, tags: [], edge_handle_id: `h_${a.id}` })),
  },
});
const yesNo = (id: string, text: string) =>
  question(id, text, [
    { id: `${id}_y`, text: "Yes" },
    { id: `${id}_n`, text: "No" },
  ]);
const intro = { id: "i", type: "intro" as const, position: { x: 0, y: 0 }, data: { headline: "Hi" } };
const result = (id: string) => ({
  id,
  type: "result" as const,
  position: { x: 0, y: 0 },
  data: { headline: `Result ${id}`, fallback_collection_id: "c" },
});
let edgeN = 0;
const edge = (source: string, target: string, answerId?: string) => ({
  id: `e${(edgeN += 1)}`,
  source,
  target,
  ...(answerId ? { source_handle: `h_${answerId}` } : {}),
});
const quiz = (nodes: unknown[], edges: unknown[]): QuizDoc =>
  Quiz.parse({ quiz_id: "qz", status: "published", scope: { collection_ids: [] }, nodes, edges });

// ── The mock's quiz ──────────────────────────────────────────────────────
const SKIN: Ans[] = [
  { id: "dry", text: "Dry" },
  { id: "oily", text: "Oily" },
  { id: "sens", text: "Sensitive" },
  { id: "combo", text: "Combination" },
  { id: "unsure", text: "Not sure" },
];
const MOCK = quiz(
  [
    intro,
    question("q1", "What's your skin type?", SKIN),
    yesNo("q2", "Does it feel tight?"),
    yesNo("q3", "Do you see shine by noon?"),
    yesNo("q4", "Does it sting?"),
    yesNo("q5", "What's your budget?"),
    { id: "gate", type: "email_gate", position: { x: 0, y: 0 }, data: { headline: "Get your results" } },
    result("r"),
  ],
  [
    edge("i", "q1"),
    // Edge order deliberately NOT answer order: letters follow the answers.
    edge("q1", "q3", "oily"),
    edge("q1", "q2", "dry"),
    edge("q1", "q2", "sens"),
    edge("q1", "q3", "combo"),
    edge("q1", "q3", "unsure"),
    edge("q2", "q4"),
    edge("q4", "q5"),
    edge("q3", "q5"),
    edge("q5", "gate"),
    edge("gate", "r"),
  ],
);

const ans = (sessionId: string, qid: string, ids: string[], ts = 0): LedgerEvent => ({
  sessionId,
  eventType: "question_answered",
  payload: { question_id: qid, answer_ids: ids },
  ts,
});
const done = (sessionId: string): LedgerEvent => ({ sessionId, eventType: "quiz_completed", payload: {}, ts: 99 });

/**
 * Build a cohort from per-shopper scripts: the questions answered in order
 * (answer id, or [] for a skip), and whether they finished.
 */
function cohort(groups: Array<{ n: number; steps: Array<[string, string[]]>; finish: boolean }>): {
  events: LedgerEvent[];
  finished: number;
} {
  const events: LedgerEvent[] = [];
  let sid = 0;
  let finished = 0;
  for (const g of groups) {
    for (let i = 0; i < g.n; i += 1) {
      const s = `s${(sid += 1)}`;
      g.steps.forEach(([q, ids], t) => events.push(ans(s, q, ids, t)));
      if (g.finish) {
        events.push(done(s));
        finished += 1;
      }
    }
  }
  return { events, finished };
}

// 100 start; 10 never answer; 5 answer Q1 and leave. Path A: 40 (Dry 25,
// Sensitive 15) — 4 leave at Q2, 6 at Q4, one skips Q2 and goes on. Path B:
// 45 (Oily 20, Combination 15, Not sure 10) — 3 leave at Q3. At Q5: 72, 2
// leave, 70 finish.
const MOCK_COHORT = cohort([
  { n: 5, steps: [["q1", ["dry"]]], finish: false },
  { n: 4, steps: [["q1", ["dry"]], ["q2", ["q2_y"]]], finish: false },
  { n: 6, steps: [["q1", ["sens"]], ["q2", ["q2_n"]], ["q4", ["q4_y"]]], finish: false },
  { n: 1, steps: [["q1", ["dry"]], ["q2", []], ["q4", ["q4_y"]], ["q5", ["q5_y"]]], finish: true },
  { n: 15, steps: [["q1", ["dry"]], ["q2", ["q2_y"]], ["q4", ["q4_y"]], ["q5", ["q5_y"]]], finish: true },
  { n: 9, steps: [["q1", ["sens"]], ["q2", ["q2_y"]], ["q4", ["q4_n"]], ["q5", ["q5_y"]]], finish: true },
  { n: 5, steps: [["q1", ["dry"]], ["q2", ["q2_y"]], ["q4", ["q4_n"]], ["q5", ["q5_n"]]], finish: true },
  { n: 3, steps: [["q1", ["oily"]], ["q3", ["q3_y"]]], finish: false },
  { n: 2, steps: [["q1", ["combo"]], ["q3", ["q3_y"]], ["q5", ["q5_y"]]], finish: false },
  { n: 17, steps: [["q1", ["oily"]], ["q3", ["q3_y"]], ["q5", ["q5_y"]]], finish: true },
  { n: 13, steps: [["q1", ["combo"]], ["q3", ["q3_n"]], ["q5", ["q5_y"]]], finish: true },
  { n: 10, steps: [["q1", ["unsure"]], ["q3", ["q3_n"]], ["q5", ["q5_n"]]], finish: true },
]);

const row = (ledger: StepLedger, id: string): LedgerStep => {
  const r = ledger.steps.find((s) => s.nodeId === id);
  if (!r) throw new Error(`no row ${id}`);
  return r;
};

/**
 * The handoff's tie-outs, checked generically on every fork (nested too):
 * Σ path starts = shoppers who continued from the split; Σ continue = joined;
 * within a path, each counted step's reached − left = the next one's reached,
 * the first = the path's shoppers, the last's reached − left = continue.
 */
function assertTieOuts(forks: LedgerFork[]): void {
  for (const f of forks) {
    expect(f.paths.reduce((a, p) => a + p.shoppers, 0)).toBe(f.started);
    expect(f.paths.reduce((a, p) => a + p.continue, 0)).toBe(f.joined);
    for (const p of f.paths) {
      const counted = p.steps.filter((s) => s.kind === "question");
      for (const s of counted) expect(s.pathId).toBe(p.pathId);
      if (p.forks.length === 0) {
        if (counted.length === 0) expect(p.continue).toBe(p.shoppers);
        else {
          expect(counted[0]!.reached).toBe(p.shoppers);
          for (let i = 0; i + 1 < counted.length; i += 1) {
            expect(counted[i]!.reached! - counted[i]!.left!).toBe(counted[i + 1]!.reached);
          }
          const lastStep = counted[counted.length - 1]!;
          expect(lastStep.reached! - lastStep.left!).toBe(p.continue);
        }
      }
      for (const s of counted) expect(s.reached).toBe(s.continued! + s.skipped! + s.left!);
      assertTieOuts(p.forks);
    }
  }
}

describe("flow paths (structure)", () => {
  it("finds the split at Q1, the join at Q5, and letters the paths by answer order", () => {
    const tree = buildFlowPaths(MOCK);
    expect(tree.hasFork).toBe(true);
    const fork = tree.items.find((it) => it.kind === "fork");
    expect(fork?.kind).toBe("fork");
    if (fork?.kind !== "fork") return;
    expect(fork.fork).toMatchObject({ splitNodeId: "q1", branchNodeId: null, joinNodeId: "q5" });
    expect(fork.fork.paths.map((p) => [p.letter, p.entryAnswerIds, p.firstNodeId])).toEqual([
      ["A", ["dry", "sens"], "q2"],
      ["B", ["oily", "combo", "unsure"], "q3"],
    ]);
  });

  it("a last question whose answers only pick the result page is NOT a split", () => {
    const doc = quiz(
      [intro, yesNo("q1", "One?"), yesNo("q2", "Two?"), result("r1"), result("r2")],
      [edge("i", "q1"), edge("q1", "q2"), edge("q2", "r1", "q2_y"), edge("q2", "r2", "q2_n")],
    );
    expect(buildFlowPaths(doc).hasFork).toBe(false);
    const ledger = buildStepLedger(doc, [], 0, 0);
    expect(ledger.branching).toBe(false);
    expect("paths" in ledger).toBe(false);
  });
});

describe("branching ledger — the mock's two paths", () => {
  const ledger = buildStepLedger(MOCK, MOCK_COHORT.events, 100, MOCK_COHORT.finished);
  const fork = ledger.paths![0]!;
  const [A, B] = fork.paths;

  it("names the paths by their entry answers, in the merchant's words", () => {
    expect(ledger.branching).toBe(true);
    expect(ledger.paths).toHaveLength(1);
    expect(fork).toMatchObject({ splitNodeId: "q1", joinNodeId: "q5", branchNodeId: null });
    expect(A).toMatchObject({ letter: "A", pathId: "q1:A", entryAnswerTexts: ["Dry", "Sensitive"], slotLabel: null });
    expect(B).toMatchObject({
      letter: "B",
      pathId: "q1:B",
      entryAnswerTexts: ["Oily", "Combination", "Not sure"],
    });
    expect(A!.steps.map((s) => s.nodeId)).toEqual(["q2", "q4"]);
    expect(B!.steps.map((s) => s.nodeId)).toEqual(["q3"]);
  });

  it("counts each path's steps against that path's own shoppers", () => {
    expect(A!.shoppers).toBe(40);
    expect(B!.shoppers).toBe(45);
    expect(row(ledger, "q2")).toMatchObject({ reached: 40, left: 4, skipped: 1, continued: 35, pathLetter: "A" });
    expect(row(ledger, "q2").dropoff).toBeCloseTo(0.1);
    expect(row(ledger, "q4")).toMatchObject({ reached: 36, left: 6, pathId: "q1:A" });
    expect(row(ledger, "q3")).toMatchObject({ reached: 45, left: 3, pathId: "q1:B" });
    expect(A!.continue).toBe(30);
    expect(B!.continue).toBe(42);
  });

  it("keeps shared steps as spine rows with full reached / left / drop-off", () => {
    expect(row(ledger, "i")).toMatchObject({ kind: "intro", reached: 100, left: 10, pathId: null });
    expect(row(ledger, "q1")).toMatchObject({ reached: 90, left: 5, continued: 85, pathId: null, pathLetter: null });
    expect(row(ledger, "q5")).toMatchObject({ reached: 72, left: 2, pathId: null });
    expect(row(ledger, "gate")).toMatchObject({ kind: "email_gate", reached: null, pathId: null });
    expect(row(ledger, "r")).toMatchObject({ kind: "result", reached: 70 });
  });

  it("ties out: split continuers = Σ path starts; Σ continue = reached at the join; first = started, result = finished", () => {
    const q1 = row(ledger, "q1");
    const q5 = row(ledger, "q5");
    expect(q1.reached! - q1.left!).toBe(fork.started);
    expect(fork.started).toBe(A!.shoppers + B!.shoppers);
    expect(A!.continue + B!.continue).toBe(q5.reached);
    expect(fork.joined).toBe(q5.reached);
    expect(q5.reached! - q5.left!).toBe(MOCK_COHORT.finished);
    expect(row(ledger, "i").reached).toBe(100);
    expect(row(ledger, "i").reached! - row(ledger, "i").left!).toBe(q1.reached);
    expect(row(ledger, "r").reached).toBe(MOCK_COHORT.finished);
    assertTieOuts(ledger.paths!);
  });

  it("lists every step once, in flow order, path by path", () => {
    expect(ledger.steps.map((s) => s.nodeId)).toEqual(["i", "q1", "q2", "q4", "q3", "q5", "gate", "r"]);
  });

  it("steepest and typical consider every step, path steps included", () => {
    // intro .1, q1 5/90, q2 4/40, q4 6/36, q3 3/45, q5 2/72.
    expect(ledger.steepestNodeId).toBe("q4");
    // Sorted: 2/72, 5/90, 3/45, .1, .1, 6/36 → lower middle = 3/45.
    expect(ledger.typicalDropoff).toBeCloseTo(3 / 45, 10);
  });

  it("tells which path a question belongs to, with that path's shoppers", () => {
    expect(questionPath(ledger, "q2")).toEqual({
      pathId: "q1:A",
      letter: "A",
      shoppers: 40,
      entryAnswerTexts: ["Dry", "Sensitive"],
      slotLabel: null,
    });
    expect(questionPath(ledger, "q3")).toMatchObject({ letter: "B", shoppers: 45 });
    expect(questionPath(ledger, "q1")).toBeNull();
    expect(questionPath(ledger, "q5")).toBeNull();
    expect(ledgerPathById(ledger, "q1:B")?.shoppers).toBe(45);
    expect(ledgerPathById(ledger, "nope")).toBeNull();
  });
});

describe("branching ledger — routing edge cases", () => {
  it("a back-nav that switched paths counts on the LATEST path only", () => {
    const events = [
      ans("s1", "q1", ["dry"], 1),
      ans("s1", "q2", ["q2_y"], 2),
      ans("s1", "q1", ["oily"], 3), // went back and changed the split answer
      ans("s1", "q3", ["q3_y"], 4),
      ans("s1", "q5", ["q5_y"], 5),
      done("s1"),
    ];
    const ledger = buildStepLedger(MOCK, events, 1, 1);
    const [A, B] = ledger.paths![0]!.paths;
    expect(A!.shoppers).toBe(0);
    expect(B!.shoppers).toBe(1);
    expect(row(ledger, "q2").reached).toBe(0);
    assertTieOuts(ledger.paths!);
  });

  it("a shopper who finishes without answering is routed like the runtime (the fallback path) and still ties out", () => {
    const ledger = buildStepLedger(MOCK, [done("s1"), ans("s2", "q1", ["sens"]), done("s2")], 2, 2);
    const fork = ledger.paths![0]!;
    expect(fork.started).toBe(2);
    // s2 picked Sensitive → Path A; s1 has no answer → q1's fallback edge
    // (the first edge out of q1, which leads to q3) → Path B.
    expect(fork.paths.map((p) => p.shoppers)).toEqual([1, 1]);
    assertTieOuts(ledger.paths!);
  });
});

describe("branching ledger — a branch node with an 'everyone else' slot", () => {
  const BRANCHY = quiz(
    [
      intro,
      question("q1", "What's your skin type?", SKIN),
      {
        id: "br",
        type: "branch",
        position: { x: 0, y: 0 },
        data: {
          label: "Skin split",
          mode: "rules",
          slots: [
            { id: "s_dry", label: "Dry" },
            { id: "s_sens", label: "Sensitive" },
            { id: "s_else", label: "Everyone else" },
          ],
        },
      },
      yesNo("q2", "Tight?"),
      yesNo("q3", "Shine?"),
      yesNo("q5", "Budget?"),
      result("r"),
    ],
    [
      edge("i", "q1"),
      edge("q1", "br"),
      { id: "b1", source: "br", source_handle: "s_dry", target: "q2", condition: { answer_id: "dry" } },
      { id: "b2", source: "br", source_handle: "s_sens", target: "q2", condition: { answer_id: "sens" } },
      { id: "b3", source: "br", source_handle: "s_else", target: "q3" },
      edge("q2", "q5"),
      edge("q3", "q5"),
      edge("q5", "r"),
    ],
  );

  it("merges slots that lead to the same step and names the catch-all by its answers", () => {
    const c = cohort([
      { n: 3, steps: [["q1", ["sens"]], ["q2", ["q2_y"]], ["q5", ["q5_y"]]], finish: true },
      { n: 2, steps: [["q1", ["combo"]], ["q3", ["q3_y"]], ["q5", ["q5_y"]]], finish: true },
      // Answered q1 (Dry) and went straight to q5 without a q2 event: routed
      // by the branch's own rule → Path A.
      { n: 1, steps: [["q1", ["dry"]], ["q5", ["q5_y"]]], finish: true },
    ]);
    const ledger = buildStepLedger(BRANCHY, c.events, 6, c.finished);
    const fork = ledger.paths![0]!;
    expect(fork).toMatchObject({ splitNodeId: "q1", branchNodeId: "br", joinNodeId: "q5", started: 6, joined: 6 });
    expect(fork.paths.map((p) => [p.letter, p.entryAnswerTexts, p.slotLabel, p.shoppers])).toEqual([
      ["A", ["Dry", "Sensitive"], "Dry", 4],
      ["B", ["Oily", "Combination", "Not sure"], "Everyone else", 2],
    ]);
    expect(row(ledger, "br")).toMatchObject({ kind: "branch", splits: true, pathId: null });
    assertTieOuts(ledger.paths!);
  });
});

describe("branching ledger — three paths", () => {
  const THREE = quiz(
    [
      intro,
      question("q1", "Goal?", [
        { id: "glow", text: "Glow" },
        { id: "calm", text: "Calm" },
        { id: "clear", text: "Clear" },
        { id: "firm", text: "Firm" },
      ]),
      yesNo("qa", "A?"),
      yesNo("qb", "B?"),
      yesNo("qc", "C?"),
      yesNo("qc2", "C2?"),
      yesNo("q5", "Join?"),
      result("r"),
    ],
    [
      edge("i", "q1"),
      edge("q1", "qc", "clear"),
      edge("q1", "qa", "glow"),
      edge("q1", "qb", "calm"),
      edge("q1", "qa", "firm"),
      edge("qa", "q5"),
      edge("qb", "q5"),
      edge("qc", "qc2"),
      edge("qc2", "q5"),
      edge("q5", "r"),
    ],
  );
  const c = cohort([
    { n: 3, steps: [["q1", ["glow"]]], finish: false },
    { n: 10, steps: [["q1", ["glow"]], ["qa", ["qa_y"]], ["q5", ["q5_y"]]], finish: true },
    { n: 2, steps: [["q1", ["firm"]], ["qa", ["qa_y"]]], finish: false },
    { n: 7, steps: [["q1", ["calm"]], ["qb", ["qb_y"]], ["q5", ["q5_y"]]], finish: true },
    { n: 4, steps: [["q1", ["clear"]], ["qc", ["qc_y"]]], finish: false },
    { n: 6, steps: [["q1", ["clear"]], ["qc", ["qc_y"]], ["qc2", ["qc2_y"]], ["q5", ["q5_n"]]], finish: true },
    { n: 1, steps: [["q1", ["clear"]], ["qc", ["qc_y"]], ["qc2", ["qc2_y"]], ["q5", ["q5_n"]]], finish: false },
  ]);
  const ledger = buildStepLedger(THREE, c.events, 33, c.finished);

  it("letters three paths in answer order and keeps every number tied", () => {
    const fork = ledger.paths![0]!;
    expect(fork.joinNodeId).toBe("q5");
    expect(fork.paths.map((p) => [p.letter, p.entryAnswerTexts, p.shoppers, p.continue])).toEqual([
      ["A", ["Glow", "Firm"], 12, 10],
      ["B", ["Calm"], 7, 7],
      ["C", ["Clear"], 11, 7],
    ]);
    expect(row(ledger, "q1")).toMatchObject({ reached: 33, left: 3 });
    expect(row(ledger, "q5")).toMatchObject({ reached: 24, left: 1 });
    expect(row(ledger, "qc")).toMatchObject({ reached: 11, left: 4, pathLetter: "C" });
    assertTieOuts(ledger.paths!);
    expect(row(ledger, "r").reached).toBe(c.finished);
  });
});

describe("branching ledger — paths that never rejoin", () => {
  const SPLIT_END = quiz(
    [intro, question("q1", "Who?", [{ id: "me", text: "Me" }, { id: "gift", text: "A gift" }]), yesNo("q2", "Skin?"), yesNo("q3", "Budget?"), result("r1"), result("r2")],
    [edge("i", "q1"), edge("q1", "q2", "me"), edge("q1", "q3", "gift"), edge("q2", "r1"), edge("q3", "r2")],
  );
  const c = cohort([
    { n: 8, steps: [["q1", ["me"]], ["q2", ["q2_y"]]], finish: true },
    { n: 2, steps: [["q1", ["me"]], ["q2", ["q2_y"]]], finish: false },
    { n: 5, steps: [["q1", ["gift"]], ["q3", ["q3_y"]]], finish: true },
    { n: 1, steps: [["q1", ["gift"]]], finish: false },
  ]);
  const ledger = buildStepLedger(SPLIT_END, c.events, 16, c.finished);

  it("has a null join, and each path's continue is the shoppers it finished", () => {
    const fork = ledger.paths![0]!;
    expect(fork.joinNodeId).toBeNull();
    expect(fork.paths.map((p) => [p.letter, p.shoppers, p.continue])).toEqual([
      ["A", 10, 8],
      ["B", 5, 5],
    ]);
    expect(fork.joined).toBe(c.finished);
    assertTieOuts(ledger.paths!);
    // Two results: completion is quiz-wide, so neither result row claims it.
    expect(ledger.steps.filter((s) => s.kind === "result").map((s) => [s.nodeId, s.reached])).toEqual([
      ["r1", null],
      ["r2", null],
    ]);
  });
});

describe("branching ledger — a path that splits again", () => {
  const NESTED = quiz(
    [
      intro,
      question("q1", "One?", [{ id: "a", text: "Left" }, { id: "b", text: "Right" }]),
      question("q2", "Two?", [{ id: "c", text: "Up" }, { id: "d", text: "Down" }]),
      yesNo("q3", "Three?"),
      yesNo("q4", "Four?"),
      yesNo("q6", "Six?"),
      yesNo("q5", "Five?"),
      result("r"),
    ],
    [
      edge("i", "q1"),
      edge("q1", "q2", "a"),
      edge("q1", "q3", "b"),
      edge("q2", "q4", "c"),
      edge("q2", "q6", "d"),
      edge("q4", "q5"),
      edge("q6", "q5"),
      edge("q3", "q5"),
      edge("q5", "r"),
    ],
  );
  const c = cohort([
    { n: 6, steps: [["q1", ["a"]], ["q2", ["c"]], ["q4", ["q4_y"]], ["q5", ["q5_y"]]], finish: true },
    { n: 2, steps: [["q1", ["a"]], ["q2", ["c"]]], finish: false },
    { n: 4, steps: [["q1", ["a"]], ["q2", ["d"]], ["q6", ["q6_y"]], ["q5", ["q5_y"]]], finish: true },
    { n: 1, steps: [["q1", ["a"]]], finish: false },
    { n: 1, steps: [["q1", ["a"]], ["q2", ["d"]]], finish: false },
    { n: 5, steps: [["q1", ["b"]], ["q3", ["q3_y"]], ["q5", ["q5_y"]]], finish: true },
  ]);
  const ledger = buildStepLedger(NESTED, c.events, 19, c.finished);

  it("nests the inner split inside its path and counts every step exactly once", () => {
    const ids = ledger.steps.map((s) => s.nodeId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(["i", "q1", "q2", "q4", "q6", "q3", "q5", "r"]);
    const [A, B] = ledger.paths![0]!.paths;
    expect(A!.steps.map((s) => s.nodeId)).toEqual(["q2"]);
    expect(A!.forks).toHaveLength(1);
    const inner = A!.forks[0]!;
    expect(inner).toMatchObject({ splitNodeId: "q2", joinNodeId: "q5" });
    expect(inner.paths.map((p) => [p.letter, p.entryAnswerTexts, p.shoppers, p.continue])).toEqual([
      ["A1", ["Up"], 6, 6],
      ["A2", ["Down"], 4, 4],
    ]);
    expect(A).toMatchObject({ shoppers: 13, continue: 10 });
    expect(B).toMatchObject({ shoppers: 5, continue: 5 });
    // The 3 who answered q2 and nothing after left AT q2 (worst case: reach
    // is inferred from answering), so the inner split starts with 10.
    expect(row(ledger, "q1")).toMatchObject({ reached: 19, left: 1 });
    expect(row(ledger, "q2")).toMatchObject({ reached: 13, left: 3, pathLetter: "A" });
    expect(inner.started).toBe(10);
    expect(row(ledger, "q2").reached! - row(ledger, "q2").left!).toBe(inner.started);
    expect(row(ledger, "q6")).toMatchObject({ reached: 4, left: 0, pathLetter: "A2" });
    expect(questionPath(ledger, "q6")).toMatchObject({ letter: "A2", shoppers: 4 });
    expect(questionPath(ledger, "q2")).toMatchObject({ letter: "A", shoppers: 13 });
    expect(allLedgerPaths(ledger).map((p) => p.letter)).toEqual(["A", "A1", "A2", "B"]);
    expect(row(ledger, "q5").reached).toBe(A!.continue + B!.continue);
    assertTieOuts(ledger.paths!);
  });
});

describe("drop-off insight on branching docs", () => {
  // Scale the mock's cohort ×10 so the leak clears the exact-number gate.
  const big: LedgerEvent[] = [];
  for (let k = 0; k < 10; k += 1) {
    for (const e of MOCK_COHORT.events) big.push({ ...e, sessionId: `${e.sessionId}_${k}` });
  }
  // Make Path B's Q3 the leak: 120 more on Path B leave at Q3.
  for (let i = 0; i < 120; i += 1) {
    big.push(ans(`leak${i}`, "q1", ["oily"]), ans(`leak${i}`, "q3", ["q3_y"]));
  }
  const ledger = buildStepLedger(MOCK, big, 1120, 700);

  it("runs across path steps and names the path", () => {
    expect(ledger.steepestNodeId).toBe("q3");
    const q3 = row(ledger, "q3");
    // 450 + 120 reached q3; 30 + 120 left.
    expect(q3).toMatchObject({ reached: 570, left: 150, pathLetter: "B" });
    const r = buildQuizInsights({
      doc: MOCK,
      reachability: null,
      ledger,
      engaged: 1120,
      completed: 700,
      rangeDays: 30,
      published: true,
    });
    const leak = r.cards.find((c) => c.id === "leak:q3");
    expect(leak).toBeDefined();
    expect(leak!.headline).toBe(`26.3% of shoppers on Path B leave at "Do you see shine by noon?"`);
    expect(leak!.body).toContain("Path B is the shoppers who pick Oily, Combination or Not sure.");
    expect(leak!.body).toContain(`${Math.round(ledger.typicalDropoff! * 100)}% typical step drop-off`);
    expect(leak!.math).toContain("570 shoppers on Path B reached this step.");
  });
});
