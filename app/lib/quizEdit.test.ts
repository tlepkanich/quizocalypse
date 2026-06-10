import { describe, it, expect } from "vitest";
import { Quiz } from "./quizSchema";
import { applyEditOps, outlineQuiz, EditOp } from "./quizEdit";
import { getPreset } from "./themePresets";

// Minimal valid quiz: intro → q1 → q2 → result. Parsed fresh each call so the
// purity test can compare against an untouched baseline.
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
      id: "q2",
      type: "question",
      position: { x: 2, y: 0 },
      data: {
        text: "Q2?",
        question_type: "single_select",
        answers: [
          { id: "a3", text: "C", tags: [], edge_handle_id: "h3" },
          { id: "a4", text: "D", tags: [], edge_handle_id: "h4" },
        ],
      },
    },
    { id: "r1", type: "result", position: { x: 3, y: 0 }, data: { headline: "Result", fallback_collection_id: "gid://c/1" } },
  ],
  edges: [
    { id: "e1", source: "intro", target: "q1" },
    { id: "e2", source: "q1", target: "q2" },
    { id: "e3", source: "q2", target: "r1" },
  ],
};

const base = () => Quiz.parse(structuredClone(RAW));
// Every op the engine applies must leave a doc that still parses.
const expectValid = (doc: unknown) => expect(Quiz.safeParse(doc).success).toBe(true);

describe("applyEditOps", () => {
  it("set_text updates an existing field and stays valid", () => {
    const { doc, warnings } = applyEditOps(base(), [
      EditOp.parse({ op: "set_text", node_id: "r1", field: "headline", value: "Your match" }),
    ]);
    const r1 = doc.nodes.find((n) => n.id === "r1")!;
    expect((r1.data as { headline: string }).headline).toBe("Your match");
    expect(warnings).toHaveLength(0);
    expectValid(doc);
  });

  it("set_text on a field the node lacks is skipped with a warning (no invalid key)", () => {
    const { doc, warnings } = applyEditOps(base(), [
      // intro has no cta_label
      EditOp.parse({ op: "set_text", node_id: "intro", field: "cta_label", value: "x" }),
    ]);
    expect(warnings.join()).toMatch(/no "cta_label"/);
    expectValid(doc);
  });

  it("set_education_card sets (trimmed) then clears the card on a question", () => {
    const set = applyEditOps(base(), [
      EditOp.parse({ op: "set_education_card", node_id: "q1", value: "  Quick note: these differ.  " }),
    ]);
    const q1 = set.doc.nodes.find((n) => n.id === "q1")!;
    expect((q1.data as { education_card_before?: string }).education_card_before).toBe(
      "Quick note: these differ.",
    );
    expect(set.warnings).toHaveLength(0);
    expectValid(set.doc);
    const cleared = applyEditOps(set.doc, [
      EditOp.parse({ op: "set_education_card", node_id: "q1", value: "" }),
    ]);
    const q1b = cleared.doc.nodes.find((n) => n.id === "q1")!;
    expect((q1b.data as { education_card_before?: string }).education_card_before).toBeUndefined();
  });

  it("set_education_card on a non-question is skipped with a warning", () => {
    const { doc, warnings } = applyEditOps(base(), [
      EditOp.parse({ op: "set_education_card", node_id: "intro", value: "x" }),
    ]);
    expect(warnings.join()).toMatch(/not a question/);
    expectValid(doc);
  });

  it("set_theme applies a vetted preset's design tokens and stays valid", () => {
    const darkBg = getPreset("dark")?.tokens.colors?.background;
    const { doc, warnings } = applyEditOps(base(), [
      EditOp.parse({ op: "set_theme", preset: "dark" }),
    ]);
    expect(warnings).toEqual([]);
    expect(doc.design_tokens?.colors?.background).toBe(darkBg);
    expectValid(doc);
  });

  it("set_theme with an unknown preset is skipped with a warning", () => {
    const { doc, warnings } = applyEditOps(base(), [
      EditOp.parse({ op: "set_theme", preset: "nope" }),
    ]);
    expect(warnings.join()).toMatch(/unknown theme/);
    expectValid(doc);
  });

  it("edit_question re-merges answers preserving the first id + edge handle", () => {
    const { doc } = applyEditOps(base(), [
      EditOp.parse({
        op: "edit_question",
        node_id: "q1",
        text: "Simpler Q1?",
        answers: [
          { text: "New A", tags: ["x"] },
          { text: "New B", tags: ["y"] },
        ],
      }),
    ]);
    const q1 = doc.nodes.find((n) => n.id === "q1")!;
    const ans = (q1.data as { answers: Array<{ id: string; text: string; edge_handle_id: string }> }).answers;
    expect((q1.data as { text: string }).text).toBe("Simpler Q1?");
    expect(ans[0]!.id).toBe("a1"); // id preserved by order
    expect(ans[0]!.edge_handle_id).toBe("h1"); // edges survive
    expect(ans[0]!.text).toBe("New A");
    expectValid(doc);
  });

  it("edit_question with fewer answers prunes the dropped answer's edges", () => {
    // q1 with a THIRD answer (handle h3x) that sources a branch-style edge;
    // shrinking to 2 answers drops the 3rd → its edge must be pruned.
    const seed = Quiz.parse({
      quiz_id: "qz3",
      scope: { collection_ids: [] },
      nodes: [
        { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "W" } },
        {
          id: "q1",
          type: "question",
          position: { x: 1, y: 0 },
          data: {
            text: "Q1?",
            question_type: "single_select",
            answers: [
              { id: "a1", text: "A", tags: [], edge_handle_id: "h1" },
              { id: "a2", text: "B", tags: [], edge_handle_id: "h2" },
              { id: "a3x", text: "C", tags: [], edge_handle_id: "h3x" },
            ],
          },
        },
        { id: "r1", type: "result", position: { x: 2, y: 0 }, data: { headline: "R", fallback_collection_id: "gid://c/1" } },
      ],
      edges: [
        { id: "e1", source: "intro", target: "q1" },
        { id: "e2", source: "q1", target: "r1" },
        { id: "ex", source: "q1", target: "r1", source_handle: "h3x" },
      ],
    });
    const { doc } = applyEditOps(seed, [
      EditOp.parse({ op: "edit_question", node_id: "q1", answers: [{ text: "only A", tags: [] }, { text: "only B", tags: [] }] }),
    ]);
    // old 3rd answer (handle h3x) dropped → its edge pruned
    expect(doc.edges.find((e) => e.source_handle === "h3x")).toBeUndefined();
    expectValid(doc);
  });

  it("add_question splices into the chain (anchor → new → next), not a fork", () => {
    const beforeIds = new Set(base().nodes.map((n) => n.id));
    const { doc } = applyEditOps(base(), [
      EditOp.parse({
        op: "add_question",
        after_node_id: "q1",
        text: "What's your budget?",
        answers: [{ text: "Low", tags: ["budget-low"] }, { text: "High", tags: ["budget-high"] }],
      }),
    ]);
    const newId = doc.nodes.find((n) => !beforeIds.has(n.id))!.id;
    expect(doc.edges.find((e) => e.source === "q1" && e.target === newId)).toBeTruthy();
    expect(doc.edges.find((e) => e.source === newId && e.target === "q2")).toBeTruthy();
    expect(doc.edges.find((e) => e.source === "q1" && e.target === "q2")).toBeUndefined(); // spliced, not forked
    expectValid(doc);
  });

  it("add_question with a nonexistent after_node_id appends to the chain (no dangling edge)", () => {
    const beforeIds = new Set(base().nodes.map((n) => n.id));
    const { doc, warnings } = applyEditOps(base(), [
      EditOp.parse({
        op: "add_question",
        after_node_id: "ghost-id",
        text: "Tacked on?",
        answers: [{ text: "Y", tags: [] }, { text: "N", tags: [] }],
      }),
    ]);
    const newId = doc.nodes.find((n) => !beforeIds.has(n.id))!.id;
    const ids = new Set(doc.nodes.map((n) => n.id));
    // No edge points at a missing node — the bad anchor did NOT create a dangling edge.
    expect(doc.edges.every((e) => ids.has(e.source) && ids.has(e.target))).toBe(true);
    // The new question is wired off the run tail (q2 → new), reachable from intro.
    expect(doc.edges.some((e) => e.source === "q2" && e.target === newId)).toBe(true);
    expect(warnings.join()).toMatch(/not found/);
    expectValid(doc);
  });

  it("remove_node deletes a middle question and re-stitches prev → next", () => {
    const { doc } = applyEditOps(base(), [EditOp.parse({ op: "remove_node", node_id: "q2" })]);
    expect(doc.nodes.find((n) => n.id === "q2")).toBeUndefined();
    expect(doc.edges.find((e) => e.source === "q1" && e.target === "r1")).toBeTruthy(); // re-stitched
    expectValid(doc);
  });

  it("remove_node refuses the intro and the only result", () => {
    const a = applyEditOps(base(), [EditOp.parse({ op: "remove_node", node_id: "intro" })]);
    expect(a.warnings.join()).toMatch(/intro/);
    expect(a.doc.nodes.find((n) => n.id === "intro")).toBeTruthy();
    const b = applyEditOps(base(), [EditOp.parse({ op: "remove_node", node_id: "r1" })]);
    expect(b.warnings.join()).toMatch(/only result/);
    expect(b.doc.nodes.find((n) => n.id === "r1")).toBeTruthy();
  });

  it("add_answer appends with the AI's text + tags", () => {
    const { doc } = applyEditOps(base(), [
      EditOp.parse({ op: "add_answer", node_id: "q1", text: "Maybe", tags: ["z"] }),
    ]);
    const q1 = doc.nodes.find((n) => n.id === "q1")!;
    const ans = (q1.data as { answers: Array<{ text: string; tags: string[] }> }).answers;
    expect(ans).toHaveLength(3);
    expect(ans[2]!.text).toBe("Maybe");
    expect(ans[2]!.tags).toEqual(["z"]);
    expectValid(doc);
  });

  it("unknown ids are skipped with warnings, never throw", () => {
    const { doc, warnings } = applyEditOps(base(), [
      EditOp.parse({ op: "set_text", node_id: "nope", field: "headline", value: "x" }),
      EditOp.parse({ op: "edit_question", node_id: "intro", text: "x" }), // intro is not a question
    ]);
    expect(warnings.length).toBe(2);
    expectValid(doc);
  });

  it("is pure — the input doc is not mutated", () => {
    const input = base();
    const snapshot = JSON.stringify(input);
    applyEditOps(input, [EditOp.parse({ op: "set_text", node_id: "r1", field: "headline", value: "changed" })]);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("outlineQuiz lists node ids + answer ids in flow order", () => {
    const outline = outlineQuiz(base());
    expect(outline).toMatch(/id=intro/);
    expect(outline).toMatch(/id=q1/);
    expect(outline).toMatch(/id=a1/);
    expect(outline.indexOf("id=q1")).toBeLessThan(outline.indexOf("id=q2"));
  });
});

describe("editor revamp P6 — set_answer_icon / set_answer_image / set_answer_columns", () => {
  const q1 = (doc: ReturnType<typeof base>) => {
    const n = doc.nodes.find((x) => x.id === "q1");
    if (n?.type !== "question") throw new Error("q1 missing");
    return n;
  };

  it("sets and clears an answer icon", () => {
    const set = applyEditOps(base(), [
      { op: "set_answer_icon", node_id: "q1", answer_id: "a1", icon: "🏔️" },
    ]);
    expect(q1(set.doc).data.answers[0]!.icon).toBe("🏔️");
    expect(set.warnings).toEqual([]);
    const cleared = applyEditOps(set.doc, [
      { op: "set_answer_icon", node_id: "q1", answer_id: "a1", icon: "" },
    ]);
    expect(q1(cleared.doc).data.answers[0]!.icon).toBeUndefined();
    expect(Quiz.safeParse(cleared.doc).success).toBe(true);
  });

  it("sets an https answer image and rejects http with a warning (no write)", () => {
    const ok = applyEditOps(base(), [
      { op: "set_answer_image", node_id: "q1", answer_id: "a2", image_url: "https://cdn.x/y.png" },
    ]);
    expect(q1(ok.doc).data.answers[1]!.image_url).toBe("https://cdn.x/y.png");
    const bad = applyEditOps(base(), [
      { op: "set_answer_image", node_id: "q1", answer_id: "a2", image_url: "http://cdn.x/y.png" },
    ]);
    expect(q1(bad.doc).data.answers[1]!.image_url).toBeUndefined();
    expect(bad.warnings.some((w) => w.includes("https"))).toBe(true);
  });

  it("sets answer columns and 0 restores auto; unknown answer warns", () => {
    const two = applyEditOps(base(), [
      { op: "set_answer_columns", node_id: "q1", columns: 2 },
    ]);
    expect(q1(two.doc).data.answer_columns).toBe(2);
    const auto = applyEditOps(two.doc, [
      { op: "set_answer_columns", node_id: "q1", columns: 0 },
    ]);
    expect(q1(auto.doc).data.answer_columns).toBeUndefined();
    const missing = applyEditOps(base(), [
      { op: "set_answer_icon", node_id: "q1", answer_id: "nope", icon: "✨" },
    ]);
    expect(missing.warnings.length).toBe(1);
  });
});
