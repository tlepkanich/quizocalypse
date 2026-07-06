import { describe, expect, it } from "vitest";
import { Quiz } from "./quizSchema";
import { collectNextStepImages, NEXT_STEP_IMAGE_CAP } from "./nextStepImages";

// BIC-2 B2e — the pure "which images should we preload next" helper.

const img = (n: number) => `https://cdn.example.com/img-${n}.jpg`;

function doc(overrides?: {
  q2Answers?: Array<{ id: string; text: string; image_url?: string; edge_handle_id: string }>;
  q2Image?: string;
  edges?: Array<{ id: string; source: string; target: string; source_handle?: string }>;
}) {
  return Quiz.parse({
    quiz_id: "quiz-1",
    scope: { collection_ids: [] },
    nodes: [
      { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
      {
        id: "q1",
        type: "question",
        position: { x: 1, y: 0 },
        data: {
          text: "A?",
          question_type: "single_select",
          answers: [
            { id: "a1", text: "A", edge_handle_id: "h1" },
            { id: "a2", text: "B", edge_handle_id: "h2" },
          ],
        },
      },
      {
        id: "q2",
        type: "question",
        position: { x: 2, y: 0 },
        data: {
          text: "B?",
          question_type: "image_tile",
          ...(overrides?.q2Image ? { image_url: overrides.q2Image } : {}),
          answers: overrides?.q2Answers ?? [
            { id: "b1", text: "A", image_url: img(1), edge_handle_id: "h3" },
            { id: "b2", text: "B", image_url: img(2), edge_handle_id: "h4" },
          ],
        },
      },
      {
        id: "r1",
        type: "result",
        position: { x: 3, y: 0 },
        data: { headline: "Done", fallback_collection_id: "gid://c/fb" },
      },
    ],
    edges: overrides?.edges ?? [
      { id: "e1", source: "intro", target: "q1" },
      { id: "e2", source: "q1", target: "q2" },
      { id: "e3", source: "q2", target: "r1" },
    ],
  });
}

describe("collectNextStepImages", () => {
  it("collects the next question's header image then answer images, in order", () => {
    const d = doc({ q2Image: img(9) });
    expect(collectNextStepImages(d, "q1")).toEqual([img(9), img(1), img(2)]);
  });

  it("collects only answer images when the next question has no header image", () => {
    expect(collectNextStepImages(doc(), "q1")).toEqual([img(1), img(2)]);
  });

  it("returns [] when the next step is not a question (result / end of flow)", () => {
    const d = doc();
    expect(collectNextStepImages(d, "q2")).toEqual([]); // next is the result
    expect(collectNextStepImages(d, "r1")).toEqual([]); // terminal — no outbound edge
    expect(collectNextStepImages(d, "missing-node")).toEqual([]);
  });

  it("follows the straight-through default target from the intro", () => {
    // intro → q1 (image-less answers) → []
    expect(collectNextStepImages(doc(), "intro")).toEqual([]);
  });

  it("caps at NEXT_STEP_IMAGE_CAP (4) even with more answer images", () => {
    const answers = [1, 2, 3, 4, 5, 6].map((n) => ({
      id: `b${n}`,
      text: `A${n}`,
      image_url: img(n),
      edge_handle_id: `h${n}`,
    }));
    const d = doc({ q2Answers: answers, q2Image: img(0) });
    const urls = collectNextStepImages(d, "q1");
    expect(urls).toHaveLength(NEXT_STEP_IMAGE_CAP);
    expect(urls).toEqual([img(0), img(1), img(2), img(3)]);
  });

  it("respects an explicit smaller/zero cap", () => {
    const d = doc({ q2Image: img(0) });
    expect(collectNextStepImages(d, "q1", 1)).toEqual([img(0)]);
    expect(collectNextStepImages(d, "q1", 0)).toEqual([]);
  });

  it("dedupes repeated URLs and skips non-https ones", () => {
    const answers = [
      { id: "b1", text: "A", image_url: img(1), edge_handle_id: "h1" },
      { id: "b2", text: "B", image_url: img(1), edge_handle_id: "h2" }, // duplicate
      { id: "b3", text: "C", image_url: "http://insecure.example.com/x.jpg", edge_handle_id: "h3" },
      { id: "b4", text: "D", edge_handle_id: "h4" }, // no image
    ];
    const d = doc({ q2Answers: answers });
    expect(collectNextStepImages(d, "q1")).toEqual([img(1)]);
  });

  it("prefers the unconditional edge over per-answer handles (gotoNextFrom default)", () => {
    // q1 routes handle h1 → r1 (divergent) but its unconditional edge → q2.
    const d = doc({
      edges: [
        { id: "e1", source: "intro", target: "q1" },
        { id: "e2", source: "q1", target: "r1", source_handle: "h1" },
        { id: "e3", source: "q1", target: "q2" },
        { id: "e4", source: "q2", target: "r1" },
      ],
    });
    expect(collectNextStepImages(d, "q1")).toEqual([img(1), img(2)]);
  });
});
