import { describe, expect, it } from "vitest";
import { Quiz } from "./quizSchema";
import { seedPointsFromCategories } from "./categoryScoring";

// A neutral 2nd answer so single_select's ≥2-answer rule is satisfied; it carries
// no tags, so it's always left untouched and never affects the answers[0] assertion.
const FILLER = { id: "a_filler", text: "—", tags: [], edge_handle_id: "h_filler" };

// Build a valid quiz with one question carrying the given answers, so we exercise
// seedPointsFromCategories over real (Zod-parsed) QuizNodes.
function quizWith(answers: Array<Record<string, unknown>>) {
  return Quiz.parse({
    quiz_id: "q",
    scope: { collection_ids: [] },
    nodes: [
      { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
      {
        id: "q1",
        type: "question",
        position: { x: 1, y: 0 },
        data: { text: "?", question_type: "single_select", answers },
      },
      {
        id: "r1",
        type: "result",
        position: { x: 2, y: 0 },
        data: { headline: "R", fallback_collection_id: "gid://shopify/Collection/c" },
      },
    ],
    edges: [
      { id: "e1", source: "intro", target: "q1" },
      { id: "e2", source: "q1", target: "r1" },
    ],
  });
}

function questionAnswers(nodes: ReturnType<typeof quizWith>["nodes"]) {
  const q = nodes.find((n) => n.type === "question");
  if (!q || q.type !== "question") throw new Error("no question node");
  return q.data.answers;
}

describe("seedPointsFromCategories", () => {
  it("counts tag overlap per category (points[catId] = number of shared tags)", () => {
    const quiz = quizWith([
      { id: "a1", text: "A", tags: ["oily", "dry"], edge_handle_id: "h1" },
      { id: "a2", text: "B", tags: ["balanced"], edge_handle_id: "h2" },
    ]);
    const seeded = seedPointsFromCategories(quiz.nodes, [
      { id: "c-oily", tags: ["oily"] },
      { id: "c-both", tags: ["dry", "oily"] },
    ]);
    const answers = questionAnswers(seeded);
    // a1 shares "oily" with c-oily (1) and "oily"+"dry" with c-both (2).
    expect(answers[0]!.points).toEqual({ "c-oily": 1, "c-both": 2 });
    // a2 ("balanced") overlaps neither → untouched, no points.
    expect(answers[1]!.points).toBeUndefined();
  });

  it("matches tags case-insensitively (both sides lowercased)", () => {
    const quiz = quizWith([{ id: "a1", text: "A", tags: ["OiLy"], edge_handle_id: "h1" }, FILLER]);
    const answers = questionAnswers(seedPointsFromCategories(quiz.nodes, [{ id: "c", tags: ["OILY"] }]));
    expect(answers[0]!.points).toEqual({ c: 1 });
  });

  it("leaves a tag-less answer untouched (no points key)", () => {
    const quiz = quizWith([{ id: "a1", text: "A", tags: [], edge_handle_id: "h1" }, FILLER]);
    const answers = questionAnswers(seedPointsFromCategories(quiz.nodes, [{ id: "c", tags: ["oily"] }]));
    expect(answers[0]!.points).toBeUndefined();
  });

  it("returns non-question nodes unchanged + the result re-parses against the schema", () => {
    const quiz = quizWith([{ id: "a1", text: "A", tags: ["oily"], edge_handle_id: "h1" }, FILLER]);
    const seeded = seedPointsFromCategories(quiz.nodes, [{ id: "c", tags: ["oily"] }]);
    expect(seeded.find((n) => n.type === "intro")).toEqual(quiz.nodes.find((n) => n.type === "intro"));
    expect(() => Quiz.parse({ ...quiz, nodes: seeded })).not.toThrow();
  });

  it("no categories → every answer untouched", () => {
    const quiz = quizWith([{ id: "a1", text: "A", tags: ["oily"], edge_handle_id: "h1" }, FILLER]);
    const answers = questionAnswers(seedPointsFromCategories(quiz.nodes, []));
    expect(answers[0]!.points).toBeUndefined();
  });
});
