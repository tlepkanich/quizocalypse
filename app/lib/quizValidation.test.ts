import { describe, expect, it } from "vitest";
import { validateQuiz, validateQuizWarnings } from "./quizValidation";
import { Quiz } from "./quizSchema";

function makeQuiz(extra: Partial<Parameters<typeof Quiz.parse>[0]> = {}) {
  return Quiz.parse({
    quiz_id: "q1",
    scope: { collection_ids: ["c1"] },
    nodes: [
      {
        id: "intro",
        type: "intro",
        position: { x: 0, y: 0 },
        data: { headline: "Welcome" },
      },
      {
        id: "q1",
        type: "question",
        position: { x: 200, y: 0 },
        data: {
          text: "Q?",
          question_type: "single_select",
          answers: [
            { id: "a1", text: "A", tags: [], edge_handle_id: "h1" },
            { id: "a2", text: "B", tags: [], edge_handle_id: "h2" },
          ],
        },
      },
      {
        id: "r1",
        type: "result",
        position: { x: 400, y: 0 },
        data: { headline: "R", fallback_collection_id: "c1" },
      },
    ],
    edges: [
      { id: "e1", source: "intro", target: "q1" },
      { id: "e2", source: "q1", target: "r1" },
    ],
    ...extra,
  });
}

describe("validateQuiz", () => {
  it("returns no issues for a well-formed linear quiz", () => {
    expect(validateQuiz(makeQuiz())).toEqual([]);
  });

  it("flags intro without outbound edges", () => {
    const issues = validateQuiz(makeQuiz({ edges: [] }));
    expect(
      issues.some(
        (i) => i.nodeId === "intro" && i.kind === "intro_missing_outbound",
      ),
    ).toBe(true);
  });

  it("flags orphan nodes unreachable from intro", () => {
    const quiz = makeQuiz({
      // Drop the intro→q1 edge — now q1 is unreachable.
      edges: [{ id: "e2", source: "q1", target: "r1" }],
    });
    const issues = validateQuiz(quiz);
    expect(issues.some((i) => i.nodeId === "q1" && i.kind === "orphan")).toBe(
      true,
    );
  });

  it("flags questions with no outbound edges as dead-ends", () => {
    const quiz = makeQuiz({
      edges: [{ id: "e1", source: "intro", target: "q1" }],
    });
    const issues = validateQuiz(quiz);
    expect(issues.some((i) => i.nodeId === "q1" && i.kind === "dead_end")).toBe(
      true,
    );
  });

  it("flags result nodes missing a fallback_collection_id", () => {
    // Build manually to skip Zod's hard min(1) on fallback_collection_id.
    const issues = validateQuiz({
      ...makeQuiz(),
      nodes: makeQuiz().nodes.map((n) =>
        n.id === "r1" && n.type === "result"
          ? { ...n, data: { ...n.data, fallback_collection_id: "" } }
          : n,
      ),
    });
    expect(
      issues.some(
        (i) => i.nodeId === "r1" && i.kind === "missing_fallback",
      ),
    ).toBe(true);
  });

  it("does not flag a result node as dead-end (results are terminals)", () => {
    const issues = validateQuiz(makeQuiz());
    expect(
      issues.some((i) => i.nodeId === "r1" && i.kind === "dead_end"),
    ).toBe(false);
  });
});

describe("validateQuizWarnings (BIC P3) — suggestions never block publishing", () => {
  const warnDoc = () =>
    Quiz.parse({
      quiz_id: "qz_warn",
      scope: { collection_ids: [] },
      nodes: [
        { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
        {
          id: "q1",
          type: "question",
          position: { x: 1, y: 0 },
          data: {
            text: "What's your budget?",
            question_type: "rating", // mismatch: categorical money answers
            answers: [
              { id: "a1", text: "$0–25", tags: [], edge_handle_id: "h1" },
              { id: "a2", text: "$25–50", tags: [], edge_handle_id: "h2" },
            ],
          },
        },
        {
          id: "q2",
          type: "question",
          position: { x: 2, y: 0 },
          data: {
            text: "What's your budget?", // duplicate text
            question_type: "single_select",
            answers: [
              { id: "a3", text: "Low", tags: [], edge_handle_id: "h3" },
              { id: "a4", text: "High", tags: [], edge_handle_id: "h4" },
            ],
          },
        },
        {
          id: "r1",
          type: "result",
          position: { x: 3, y: 0 },
          data: { headline: "Done", fallback_collection_id: "gid://c/1" },
        },
      ],
      edges: [
        { id: "e1", source: "intro", target: "q1" },
        { id: "e2", source: "q1", target: "q2" },
        { id: "e3", source: "q2", target: "r1" },
      ],
    });

  it("flags duplicate question text and rating/content mismatch", () => {
    const s = validateQuizWarnings(warnDoc());
    expect(s.some((x) => x.kind === "duplicate_question_text")).toBe(true);
    expect(s.some((x) => x.kind === "type_content_mismatch")).toBe(true);
  });

  it("a genuine rating scale produces no mismatch", () => {
    const doc = warnDoc();
    const q1 = doc.nodes.find((n) => n.id === "q1");
    if (q1?.type === "question") {
      q1.data.answers = [
        { id: "a1", text: "Poor", tags: [], edge_handle_id: "h1" },
        { id: "a2", text: "Excellent", tags: [], edge_handle_id: "h2" },
      ];
    }
    expect(validateQuizWarnings(doc).some((x) => x.kind === "type_content_mismatch")).toBe(false);
  });

  it("THE PUBLISH-GATE CONTRACT: validateQuiz output is unchanged by warnings", () => {
    // warnDoc has suggestions but a clean graph — validateQuiz must stay [].
    expect(validateQuiz(warnDoc())).toEqual([]);
  });
});

// ─── Experiences E1: type-aware guard rails ─────────────────────────────────
describe("experience-type guard rails (E1)", () => {
  const surveyDoc = (extra: Record<string, unknown> = {}) =>
    Quiz.parse({
      quiz_id: "xp",
      scope: { collection_ids: [] },
      experience_type: "survey",
      nodes: [
        { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
        {
          id: "q1",
          type: "question",
          position: { x: 200, y: 0 },
          data: {
            text: "How did we do?",
            question_type: "single_select",
            answers: [
              { id: "a1", text: "Great", tags: [], edge_handle_id: "h1" },
              { id: "a2", text: "Fine", tags: [], edge_handle_id: "h2" },
            ],
          },
        },
        { id: "end", type: "end", position: { x: 400, y: 0 }, data: { headline: "Thanks!" } },
      ],
      edges: [
        { id: "e1", source: "intro", target: "q1" },
        { id: "e2", source: "q1", target: "end" },
      ],
      ...extra,
    });

  it("a survey with NO result pages is VALID (questions → end)", () => {
    expect(validateQuiz(surveyDoc())).toEqual([]);
  });

  it("absent experience_type = product_match: zero results now BLOCKS", () => {
    const doc = surveyDoc({ experience_type: undefined });
    const issues = validateQuiz(doc);
    expect(issues.some((i) => i.kind === "missing_result")).toBe(true);
  });

  it("personality with zero results blocks; survey missing ALL terminals blocks", () => {
    const p = surveyDoc({ experience_type: "personality" });
    expect(validateQuiz(p).some((i) => i.kind === "missing_result")).toBe(true);

    const noEnd = Quiz.parse({
      ...surveyDoc(),
      nodes: surveyDoc().nodes.filter((n) => n.id !== "end"),
      edges: [{ id: "e1", source: "intro", target: "q1" }],
    });
    const issues = validateQuiz(noEnd);
    expect(issues.some((i) => i.kind === "missing_terminal")).toBe(true);
  });

  it("lead_capture without a gate/integration gets a SUGGESTION, never a blocker", () => {
    const lc = surveyDoc({ experience_type: "lead_capture" });
    expect(validateQuiz(lc)).toEqual([]); // publishes fine
    expect(validateQuizWarnings(lc).some((s) => s.kind === "missing_capture")).toBe(true);
  });
});

// ─── Routing: the "Your Skin Concern Report" dead-branch defect ──────────────
// A question authored to branch per-answer to result pages, but the answer
// destinations were never written onto the outbound edges as source_handle. The
// runtime (nextNodeFor) matches no answer handle and collapses every pick onto
// its unconditional fallback; when that fallback reaches no result, 100% of
// shoppers exit with ZERO recommendations and every wired result is dead.
describe("validateQuiz — dead per-answer result routing", () => {
  // Shared node set: a final question fanning out to an email gate + two result
  // pages, plus a gate→end tail. Only the EDGES vary per test — which is exactly
  // what the live defect came down to (handles never written onto the edges).
  const skinReportDoc = (edges: Array<Record<string, unknown>>) =>
    Quiz.parse({
      quiz_id: "qz_skin",
      scope: { collection_ids: ["c1"] },
      nodes: [
        { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Skin quiz" } },
        {
          id: "q7",
          type: "question",
          position: { x: 200, y: 0 },
          data: {
            text: "What's your main skin concern?",
            question_type: "single_select",
            answers: [
              { id: "a1", text: "Acne", tags: [], edge_handle_id: "h1" },
              { id: "a2", text: "Aging", tags: [], edge_handle_id: "h2" },
              { id: "a3", text: "Dryness", tags: [], edge_handle_id: "h3" },
              { id: "a4", text: "Dullness", tags: [], edge_handle_id: "h4" },
            ],
          },
        },
        { id: "gate", type: "email_gate", position: { x: 400, y: 0 }, data: { headline: "Get your report" } },
        { id: "r1", type: "result", position: { x: 600, y: -50 }, data: { headline: "Acne plan", fallback_collection_id: "c1" } },
        { id: "r2", type: "result", position: { x: 600, y: 50 }, data: { headline: "Aging plan", fallback_collection_id: "c1" } },
        { id: "end", type: "end", position: { x: 800, y: 0 }, data: { headline: "Thanks!" } },
      ],
      edges,
    });

  it("BLOCKS publish: no answer handle is wired and the fallback reaches no result", () => {
    // The exact shipped shape — every outbound edge from q7 is unconditional, so
    // nextNodeFor sends all four answers to the gate → end and r1/r2 are dead.
    const issues = validateQuiz(
      skinReportDoc([
        { id: "e0", source: "intro", target: "q7" },
        { id: "e1", source: "q7", target: "gate" }, // first unconditional → the fallback
        { id: "e2", source: "q7", target: "r1" },
        { id: "e3", source: "q7", target: "r2" },
        { id: "e4", source: "gate", target: "end" },
      ]),
    );
    expect(
      issues.some((i) => i.nodeId === "q7" && i.kind === "dead_answer_routing"),
    ).toBe(true);
    // The intro-reachability check can't catch this (the result edges exist, so
    // r1/r2 look "reachable") — prove THIS rule is the one that fires, and that
    // it blocks publish (quizPublish throws on any validateQuiz issue).
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.kind === "dead_answer_routing")).toBe(true);
  });

  it("PASSES once each answer's handle is wired onto an edge (the data fix)", () => {
    const issues = validateQuiz(
      skinReportDoc([
        { id: "e0", source: "intro", target: "q7" },
        { id: "e1", source: "q7", target: "r1", source_handle: "h1" },
        { id: "e2", source: "q7", target: "r2", source_handle: "h2" },
        { id: "e3", source: "q7", target: "gate", source_handle: "h3" },
        { id: "e4", source: "q7", target: "gate", source_handle: "h4" },
        { id: "e5", source: "gate", target: "end" },
      ]),
    );
    expect(issues.some((i) => i.kind === "dead_answer_routing")).toBe(false);
  });

  it("does NOT flag when the unconditional fallback still lands on a result", () => {
    // q7's first unconditional edge goes to a result, so no shopper ends
    // result-less. Sloppy per-answer routing, but not the zero-recs catastrophe.
    const issues = validateQuiz(
      skinReportDoc([
        { id: "e0", source: "intro", target: "q7" },
        { id: "e1", source: "q7", target: "r1" }, // first unconditional → a result
        { id: "e2", source: "q7", target: "r2" },
        { id: "e3", source: "q7", target: "gate" },
        { id: "e4", source: "gate", target: "end" },
      ]),
    );
    expect(issues.some((i) => i.kind === "dead_answer_routing")).toBe(false);
  });

  it("does NOT flag a plain linear quiz (single unconditional edge to the result)", () => {
    expect(
      validateQuiz(makeQuiz()).some((i) => i.kind === "dead_answer_routing"),
    ).toBe(false);
  });

  it("does NOT flag a question that routes through a branch node", () => {
    const doc = Quiz.parse({
      quiz_id: "qz_branch",
      scope: { collection_ids: ["c1"] },
      nodes: [
        { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
        {
          id: "q1",
          type: "question",
          position: { x: 200, y: 0 },
          data: {
            text: "Pick one",
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
          position: { x: 400, y: 0 },
          data: { mode: "rules", slots: [{ id: "s1", label: "A" }, { id: "s2", label: "B" }] },
        },
        { id: "r1", type: "result", position: { x: 600, y: -50 }, data: { headline: "RA", fallback_collection_id: "c1" } },
        { id: "r2", type: "result", position: { x: 600, y: 50 }, data: { headline: "RB", fallback_collection_id: "c1" } },
      ],
      edges: [
        { id: "e0", source: "intro", target: "q1" },
        { id: "e1", source: "q1", target: "br" }, // routes to the branch, not a result
        { id: "e2", source: "br", target: "r1", source_handle: "s1", condition: { answer_id: "a1" } },
        { id: "e3", source: "br", target: "r2", source_handle: "s2", condition: { answer_id: "a2" } },
      ],
    });
    expect(
      validateQuiz(doc).some((i) => i.kind === "dead_answer_routing"),
    ).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// LOGIC v2 (L2-3) — decider-model BLOCK rules (spec §6 V1/V2/V3 + the doc
// halves of V4/V6). All gated on logic_model="decider" — the last test pins
// that a legacy doc's validation output is unchanged.
// ════════════════════════════════════════════════════════════════════════════
describe("validateQuiz — decider-model rules (V1–V6)", () => {
  const deciderQuiz = (patch: Record<string, unknown> = {}) =>
    Quiz.parse({
      quiz_id: "qd",
      scope: { collection_ids: [] },
      logic_model: "decider",
      nodes: [
        { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
        {
          id: "q1",
          type: "question",
          position: { x: 1, y: 0 },
          data: {
            text: "Terrain?",
            question_type: "single_select",
            role: "decides",
            answers: [
              { id: "a1", text: "Park", tags: [], edge_handle_id: "h1", target_id: "cat_park" },
              { id: "a2", text: "Powder", tags: [], edge_handle_id: "h2", target_id: "cat_powder" },
            ],
          },
        },
        {
          id: "r1",
          type: "result",
          position: { x: 2, y: 0 },
          data: { headline: "Match", fallback_collection_id: "c_fb" },
        },
      ],
      edges: [
        { id: "e1", source: "intro", target: "q1" },
        { id: "e2", source: "q1", target: "r1" },
      ],
      ...patch,
    });

  const kinds = (doc: ReturnType<typeof deciderQuiz>) => validateQuiz(doc).map((i) => i.kind);

  it("a healthy decider doc has zero decider issues", () => {
    const decKinds = kinds(deciderQuiz()).filter((k) =>
      ["missing_decider", "decider_bypass", "decider_optional", "unmapped_decider_answer", "broken_rule_reference"].includes(k),
    );
    expect(decKinds).toEqual([]);
  });

  it("V1 — blocks when NO question decides", () => {
    const doc = deciderQuiz();
    for (const n of doc.nodes) if (n.type === "question") n.data.role = "qualifier";
    expect(kinds(doc)).toContain("missing_decider");
  });

  it("V1 — blocks when TWO questions decide", () => {
    const doc = deciderQuiz();
    const q2 = JSON.parse(JSON.stringify(doc.nodes.find((n) => n.id === "q1")));
    q2.id = "q2";
    q2.data.answers = q2.data.answers.map((a: { id: string; edge_handle_id: string }, i: number) => ({
      ...a, id: `b${i}`, edge_handle_id: `hh${i}`,
    }));
    const withTwo = Quiz.parse({
      ...JSON.parse(JSON.stringify(doc)),
      nodes: [...doc.nodes.slice(0, 2), q2, ...doc.nodes.slice(2)],
      edges: [
        { id: "e1", source: "intro", target: "q1" },
        { id: "e2", source: "q1", target: "q2" },
        { id: "e3", source: "q2", target: "r1" },
      ],
    });
    expect(kinds(withTwo)).toContain("missing_decider");
  });

  it("V2 — blocks when a path can reach a terminal without passing the decider", () => {
    // intro routes BOTH to q1 and directly to r1 → the direct edge bypasses.
    const doc = deciderQuiz({
      edges: [
        { id: "e1", source: "intro", target: "q1" },
        { id: "e2", source: "q1", target: "r1" },
        { id: "e3", source: "intro", target: "r1" },
      ],
    });
    const issues = validateQuiz(doc);
    expect(issues.map((i) => i.kind)).toContain("decider_bypass");
    expect(issues.find((i) => i.kind === "decider_bypass")?.nodeId).toBe("r1");
  });

  it("V3 — blocks when the decider is Optional", () => {
    const doc = deciderQuiz();
    for (const n of doc.nodes) {
      if (n.type === "question" && n.id === "q1") n.data.required = false;
    }
    expect(kinds(doc)).toContain("decider_optional");
  });

  it("V4 (doc half) — blocks an unmapped deciding answer", () => {
    const doc = deciderQuiz();
    for (const n of doc.nodes) {
      if (n.type === "question" && n.id === "q1") {
        delete (n.data.answers[1] as { target_id?: string }).target_id;
      }
    }
    expect(kinds(doc)).toContain("unmapped_decider_answer");
  });

  it("V6 (doc half) — blocks a rule referencing a deleted question or answer", () => {
    const missingAnswer = deciderQuiz({
      decision_rules: [
        { id: "r1", conditions: [{ question_id: "q1", answer_id: "gone", op: "is" }], target_id: "t" },
      ],
    });
    expect(kinds(missingAnswer)).toContain("broken_rule_reference");
    const missingQuestion = deciderQuiz({
      decision_rules: [
        { id: "r1", conditions: [{ question_id: "q_gone", answer_id: "a1", op: "is" }], target_id: "t" },
      ],
    });
    expect(kinds(missingQuestion)).toContain("broken_rule_reference");
  });

  it("LEGACY docs (no logic_model) never emit decider issues — output unchanged", () => {
    const legacy = deciderQuiz();
    const stripped = Quiz.parse({
      ...JSON.parse(JSON.stringify(legacy)),
      logic_model: undefined,
    });
    // Force the exact hazard: roles/targets present but the model flag absent.
    const decKinds = validateQuiz(stripped).filter((i) =>
      ["missing_decider", "decider_bypass", "decider_optional", "unmapped_decider_answer", "broken_rule_reference"].includes(i.kind),
    );
    expect(decKinds).toEqual([]);
  });
});
