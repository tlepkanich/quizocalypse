import { describe, expect, it } from "vitest";
import { Quiz } from "./quizSchema";
import { buildPathQualityOutcomes } from "./pathQuality.server";

function doc(opts?: { withRule?: boolean; unmappedA2?: boolean }) {
  return Quiz.parse({
    quiz_id: "q1",
    logic_model: "decider",
    scope: { collection_ids: [] },
    rec_page_settings: {
      global: { whyCopy: "Global why." },
      overrides: { cat_dry: { whyCopy: "Dry-specific why." } },
    },
    decision_rules: opts?.withRule
      ? [
          {
            id: "r1",
            conditions: [{ question_id: "q1", answer_id: "a1", op: "is" }],
            target_id: "cat_oily",
          },
        ]
      : [],
    nodes: [
      { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
      {
        id: "q1",
        type: "question",
        position: { x: 1, y: 0 },
        data: {
          text: "How is your skin?",
          question_type: "single_select",
          role: "decides",
          required: true,
          answers: [
            { id: "a1", text: "Dry", tags: [], edge_handle_id: "h1", target_id: "cat_dry" },
            {
              id: "a2",
              text: "Oily",
              tags: [],
              edge_handle_id: "h2",
              ...(opts?.unmappedA2 ? {} : { target_id: "cat_oily" }),
            },
          ],
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

const categories = [
  { id: "cat_dry", name: "Dry Skin", productIds: ["p1", "p2", "p3"] },
  { id: "cat_oily", name: "Oily Skin", productIds: ["p4"] },
];
const titles = new Map([
  ["p1", "Gentle Cleanser"],
  ["p2", "Rich Cream"],
  ["p4", "Oil Control Gel"],
]);

describe("buildPathQualityOutcomes", () => {
  it("emits one outcome per reachable mapped deciding answer, with resolved grounding", () => {
    const out = buildPathQualityOutcomes(doc(), categories, titles);
    expect(out.map((o) => o.outcome_id).sort()).toEqual(["a1", "a2"]);
    const dry = out.find((o) => o.outcome_id === "a1")!;
    expect(dry.path).toBe("Dry"); // the answer text
    expect(dry.target).toBe("Dry Skin");
    expect(dry.whyCopy).toBe("Dry-specific why."); // override wins
    expect(dry.products).toEqual(["Gentle Cleanser", "Rich Cream"]); // p3 has no title → dropped
  });

  it("uses the GLOBAL why-copy for a target with no override", () => {
    const oily = buildPathQualityOutcomes(doc(), categories, titles).find((o) => o.outcome_id === "a2")!;
    expect(oily.whyCopy).toBe("Global why.");
  });

  it("skips an UNMAPPED deciding answer (nothing to judge)", () => {
    const out = buildPathQualityOutcomes(doc({ unmappedA2: true }), categories, titles);
    expect(out.map((o) => o.outcome_id)).toEqual(["a1"]);
  });

  it("resolves a rule's conditions to question/answer TEXT", () => {
    const out = buildPathQualityOutcomes(doc({ withRule: true }), categories, titles);
    const rule = out.find((o) => o.outcome_id === "r1")!;
    expect(rule.path).toBe('How is your skin? is “Dry”');
    expect(rule.target).toBe("Oily Skin");
  });

  it("caps the product sample at 8", () => {
    const big = [{ id: "cat_dry", name: "Dry", productIds: Array.from({ length: 20 }, (_, i) => `p${i}`) }];
    const bigTitles = new Map(big[0]!.productIds.map((id) => [id, `T${id}`]));
    const out = buildPathQualityOutcomes(doc(), big, bigTitles);
    expect(out.find((o) => o.outcome_id === "a1")!.products).toHaveLength(8);
  });
});
