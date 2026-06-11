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
