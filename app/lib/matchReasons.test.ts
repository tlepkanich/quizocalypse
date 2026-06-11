import { describe, expect, it } from "vitest";
import { Quiz } from "./quizSchema";
import { tagToAnswerText, reasonsForProduct } from "./matchReasons";

const doc = () =>
  Quiz.parse({
    quiz_id: "mr",
    scope: { collection_ids: [] },
    nodes: [
      { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
      {
        id: "q1",
        type: "question",
        position: { x: 200, y: 0 },
        data: {
          text: "Terrain?",
          question_type: "single_select",
          answers: [
            { id: "a1", text: "Fresh powder days", tags: ["powder", "deep"], edge_handle_id: "h1" },
            { id: "a2", text: "Park laps", tags: ["park"], edge_handle_id: "h2" },
          ],
        },
      },
      {
        id: "q2",
        type: "question",
        position: { x: 400, y: 0 },
        data: {
          text: "Level?",
          question_type: "single_select",
          answers: [
            { id: "b1", text: "Still learning", tags: ["beginner", "powder"], edge_handle_id: "h3" },
            { id: "b2", text: "Confident", tags: ["advanced"], edge_handle_id: "h4" },
          ],
        },
      },
    ],
    edges: [
      { id: "e1", source: "intro", target: "q1" },
      { id: "e2", source: "q1", target: "q2" },
    ],
  });

describe("matchReasons", () => {
  it("maps tags to the FIRST selected answer's text carrying them", () => {
    const m = tagToAnswerText(doc(), ["a1", "b1"]);
    expect(m.get("powder")).toBe("Fresh powder days"); // a1 first, b1 also carries it
    expect(m.get("beginner")).toBe("Still learning");
    expect(m.get("park")).toBeUndefined(); // not selected
  });

  it("reasonsForProduct: ≤max distinct answers, ordered by matched tags, deduped", () => {
    const m = tagToAnswerText(doc(), ["a1", "b1"]);
    // 'powder' and 'deep' both map to a1 → collapse to one reason.
    expect(reasonsForProduct(["powder", "deep", "beginner"], m)).toEqual([
      "Fresh powder days",
      "Still learning",
    ]);
    expect(reasonsForProduct(["powder", "deep", "beginner"], m, 1)).toEqual([
      "Fresh powder days",
    ]);
    expect(reasonsForProduct(["unknown"], m)).toEqual([]);
  });
});
