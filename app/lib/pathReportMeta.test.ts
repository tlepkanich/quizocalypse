import { describe, expect, it } from "vitest";
import { Quiz } from "./quizSchema";
import { pathReportHash, isPathReportStale } from "./pathReportMeta";

// A minimal decider doc: intro → decider question (2 mapped answers) → result,
// plus one rule. Enough for outcomeTable to produce mapping + rule rows.
function deciderDoc(overrides?: {
  a1Target?: string;
  a1Text?: string;
  answers?: { id: string; text: string; target_id?: string }[];
  rules?: { id: string; target: string }[];
}) {
  const answers = overrides?.answers ?? [
    { id: "a1", text: overrides?.a1Text ?? "Dry", target_id: overrides?.a1Target ?? "cat_dry" },
    { id: "a2", text: "Oily", target_id: "cat_oily" },
  ];
  const rules = (overrides?.rules ?? [{ id: "r1", target: "cat_dry" }]).map((r) => ({
    id: r.id,
    conditions: [{ question_id: "q1", answer_id: "a1", op: "is" as const }],
    target_id: r.target,
  }));
  return Quiz.parse({
    quiz_id: "q1",
    logic_model: "decider",
    scope: { collection_ids: [] },
    decision_rules: rules,
    nodes: [
      { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
      {
        id: "q1",
        type: "question",
        position: { x: 1, y: 0 },
        data: {
          text: "Skin?",
          question_type: "single_select",
          role: "decides",
          required: true,
          answers: answers.map((a) => ({
            id: a.id,
            text: a.text,
            tags: [],
            edge_handle_id: `h_${a.id}`,
            ...(a.target_id ? { target_id: a.target_id } : {}),
          })),
        },
      },
      {
        id: "res",
        type: "result",
        position: { x: 2, y: 0 },
        data: { headline: "Match", fallback_collection_id: "gid://shopify/Collection/1" },
      },
    ],
    edges: [
      { id: "e1", source: "intro", target: "q1" },
      { id: "e2", source: "q1", target: "res" },
    ],
  });
}

describe("pathReportHash", () => {
  it("is a deterministic 8-hex string", () => {
    const h = pathReportHash(deciderDoc());
    expect(h).toMatch(/^[0-9a-f]{8}$/);
    expect(pathReportHash(deciderDoc())).toBe(h);
  });

  it("does NOT change on a cosmetic answer-text edit (label excluded)", () => {
    const before = pathReportHash(deciderDoc({ a1Text: "Dry skin" }));
    const after = pathReportHash(deciderDoc({ a1Text: "Very dry skin" }));
    expect(after).toBe(before);
  });

  it("flips when a deciding answer is REMAPPED to a different target", () => {
    const before = pathReportHash(deciderDoc({ a1Target: "cat_dry" }));
    const after = pathReportHash(deciderDoc({ a1Target: "cat_combo" }));
    expect(after).not.toBe(before);
  });

  it("flips when an answer is added / removed", () => {
    const base = pathReportHash(deciderDoc());
    const more = pathReportHash(
      deciderDoc({
        answers: [
          { id: "a1", text: "Dry", target_id: "cat_dry" },
          { id: "a2", text: "Oily", target_id: "cat_oily" },
          { id: "a3", text: "Combo", target_id: "cat_combo" },
        ],
      }),
    );
    expect(more).not.toBe(base);
  });

  it("flips when a rule is added / retargeted", () => {
    const base = pathReportHash(deciderDoc({ rules: [{ id: "r1", target: "cat_dry" }] }));
    const two = pathReportHash(
      deciderDoc({ rules: [{ id: "r1", target: "cat_dry" }, { id: "r2", target: "cat_oily" }] }),
    );
    expect(two).not.toBe(base);
  });
});

describe("isPathReportStale", () => {
  it("a never-generated report is never stale", () => {
    expect(isPathReportStale(undefined, "abc12345")).toBe(false);
  });
  it("stale iff the stored hash differs from the current hash", () => {
    expect(isPathReportStale({ hash: "aaaaaaaa" }, "bbbbbbbb")).toBe(true);
    expect(isPathReportStale({ hash: "aaaaaaaa" }, "aaaaaaaa")).toBe(false);
  });
});
