import { describe, expect, it } from "vitest";
import { Quiz } from "./quizSchema";
import {
  chapterFills,
  chaptersForRender,
  currentChapterIndex,
  progressPct,
  reachableQuestionCount,
} from "./progress";

describe("progressPct", () => {
  it("computes the percentage and clamps to [0,100]", () => {
    expect(progressPct(4, 0)).toBe(0);
    expect(progressPct(4, 2)).toBe(50);
    expect(progressPct(4, 4)).toBe(100);
    expect(progressPct(4, 9)).toBe(100); // clamp over
    expect(progressPct(3, 1)).toBe(33);
  });
  it("is 0 when there are no questions", () => {
    expect(progressPct(0, 0)).toBe(0);
  });
});

describe("reachableQuestionCount", () => {
  it("counts the question steps on the spine", () => {
    const doc = Quiz.parse({
      quiz_id: "q1",
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
            question_type: "single_select",
            answers: [
              { id: "b1", text: "A", edge_handle_id: "h3" },
              { id: "b2", text: "B", edge_handle_id: "h4" },
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
      edges: [
        { id: "e1", source: "intro", target: "q1" },
        { id: "e2", source: "q1", target: "q2" },
        { id: "e3", source: "q2", target: "r1" },
      ],
    });
    expect(reachableQuestionCount(doc)).toBe(2);
  });
});

// ── QRTZ-O5 — Chapters gating + fill math ───────────────────────────────────
describe("chaptersForRender (the gating chain)", () => {
  const CHAPTERS = [
    { label: "Your skin", question_ids: ["q1", "q2"] },
    { label: "Routine", question_ids: ["q3"] },
  ];
  // A minimal parsed doc shell — gating reads only logic_model + chapters.
  function docWith(fields: Record<string, unknown>) {
    return Quiz.parse({
      quiz_id: "g1",
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
          id: "r1",
          type: "result",
          position: { x: 2, y: 0 },
          data: { headline: "Done", fallback_collection_id: "gid://c/fb" },
        },
      ],
      edges: [
        { id: "e1", source: "intro", target: "q1" },
        { id: "e2", source: "q1", target: "r1" },
      ],
      ...fields,
    });
  }

  it("renders chapters only for a decider doc with ≥2 baked chapters and the default bar style", () => {
    const doc = docWith({ logic_model: "decider", chapters: CHAPTERS });
    expect(chaptersForRender(doc, "bar")).toEqual(CHAPTERS);
  });

  it("falls back for a LEGACY doc even if chapters were somehow present", () => {
    const doc = docWith({ chapters: CHAPTERS });
    expect(chaptersForRender(doc, "bar")).toBeNull();
  });

  it("falls back for a chapterless decider doc", () => {
    const doc = docWith({ logic_model: "decider" });
    expect(chaptersForRender(doc, "bar")).toBeNull();
  });

  it("falls back below 2 chapters", () => {
    const doc = docWith({
      logic_model: "decider",
      chapters: [{ label: "Only", question_ids: ["q1"] }],
    });
    expect(chaptersForRender(doc, "bar")).toBeNull();
  });

  it("lets an explicit merchant dots/steps pick win", () => {
    const doc = docWith({ logic_model: "decider", chapters: CHAPTERS });
    expect(chaptersForRender(doc, "dots")).toBeNull();
    expect(chaptersForRender(doc, "steps")).toBeNull();
  });
});

describe("chapterFills + currentChapterIndex", () => {
  const CHAPTERS = [
    { label: "Your skin", question_ids: ["q1", "q2", "q3"] },
    { label: "Routine", question_ids: ["q4", "q5"] },
    { label: "Your match", question_ids: ["q6"] },
  ];

  it("counts the in-progress question (classic-bar numerator convention)", () => {
    // On q1, nothing answered yet → chapter 1 shows 1/3.
    expect(chapterFills(CHAPTERS, [], "q1", false)).toEqual([1 / 3, 0, 0]);
  });

  it("fills per chapter as its own fraction", () => {
    // q1+q2 answered, on q4 → chapter 1 at 2/3, chapter 2 at 1/2.
    expect(chapterFills(CHAPTERS, ["q1", "q2"], "q4", false)).toEqual([2 / 3, 1 / 2, 0]);
  });

  it("ignores answered ids outside every chapter (branch-lane questions)", () => {
    expect(chapterFills(CHAPTERS, ["zz"], "q1", false)).toEqual([1 / 3, 0, 0]);
  });

  it("fills everything on the result step", () => {
    expect(chapterFills(CHAPTERS, ["q1"], null, true)).toEqual([1, 1, 1]);
  });

  it("marks the chapter holding the current question", () => {
    const fills = chapterFills(CHAPTERS, ["q1", "q2"], "q4", false);
    expect(currentChapterIndex(CHAPTERS, "q4", fills, false)).toBe(1);
  });

  it("between chapters (email gate) marks the last chapter with any fill", () => {
    const fills = chapterFills(CHAPTERS, ["q1", "q2", "q3"], null, false);
    expect(currentChapterIndex(CHAPTERS, null, fills, false)).toBe(0);
    const fills2 = chapterFills(CHAPTERS, ["q1", "q2", "q3", "q4"], null, false);
    expect(currentChapterIndex(CHAPTERS, null, fills2, false)).toBe(1);
  });

  it("marks the final chapter on the result step", () => {
    expect(currentChapterIndex(CHAPTERS, null, [1, 1, 1], true)).toBe(2);
  });
});
