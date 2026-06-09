import { describe, expect, it } from "vitest";
import { Quiz } from "./quizSchema";
import { applyReviewEnrichment, clampReviewText, ReviewEnrichment } from "./reviewEnrichment";

const RAW = {
  quiz_id: "qz_test",
  scope: { collection_ids: [] },
  nodes: [
    { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Welcome" } },
    {
      id: "q1",
      type: "question",
      position: { x: 1, y: 0 },
      data: {
        text: "Q1?",
        question_type: "single_select",
        answers: [
          { id: "a1", text: "A", tags: ["x"], edge_handle_id: "h1" },
          { id: "a2", text: "B", tags: ["y"], edge_handle_id: "h2" },
        ],
      },
    },
    {
      id: "r1",
      type: "result",
      position: { x: 2, y: 0 },
      data: { headline: "Result", fallback_collection_id: "gid://c/1" },
    },
  ],
  edges: [
    { id: "e1", source: "intro", target: "q1" },
    { id: "e2", source: "q1", target: "r1" },
  ],
};
const base = () => Quiz.parse(structuredClone(RAW));

describe("clampReviewText", () => {
  it("collapses whitespace, trims, and caps length", () => {
    expect(clampReviewText("  a\n\n  b   c ")).toBe("a b c");
    expect(clampReviewText("x".repeat(50_000)).length).toBe(24_000);
  });
});

describe("applyReviewEnrichment", () => {
  it("rewrites answer text + tooltip by id and result why-bullets, preserving the rest", () => {
    const doc = base();
    const enr = ReviewEnrichment.parse({
      questions: [
        {
          id: "q1",
          answers: [
            { id: "a1", text: "How customers actually say it", tooltip_text: "Answers a real objection" },
          ],
        },
      ],
      results: [{ id: "r1", why_bullets: ["Benefit one", "Benefit two", "", "Benefit four"] }],
      summary: "reworded from reviews",
    });
    const { doc: out, changed } = applyReviewEnrichment(doc, enr);

    const q = out.nodes.find((n) => n.id === "q1");
    const r = out.nodes.find((n) => n.id === "r1");
    if (q?.type !== "question" || r?.type !== "result") throw new Error("nodes missing");

    expect(q.data.answers[0]!.text).toBe("How customers actually say it");
    expect(q.data.answers[0]!.tooltip_text).toBe("Answers a real objection");
    expect(q.data.answers[1]!.text).toBe("B"); // untouched answer preserved
    expect(r.data.why_bullets).toEqual(["Benefit one", "Benefit two", "Benefit four"]); // empty dropped, capped 3
    expect(changed).toBe(3); // text + tooltip + bullets
    expect(Quiz.safeParse(out).success).toBe(true);
  });

  it("ignores unknown ids and empty values (no-op, doc preserved)", () => {
    const doc = base();
    const { doc: out, changed } = applyReviewEnrichment(
      doc,
      ReviewEnrichment.parse({
        questions: [{ id: "nope", answers: [{ id: "x", text: "y" }] }],
        results: [{ id: "nope", why_bullets: ["z"] }],
      }),
    );
    expect(changed).toBe(0);
    expect(out).toEqual(doc);
  });
});
