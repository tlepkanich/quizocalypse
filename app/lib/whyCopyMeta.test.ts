import { describe, expect, it } from "vitest";
import { WHY_COPY_CONSTRAINT } from "./claude";
import {
  GLOBAL_WHY_COPY_KEY,
  isWhyCopyStale,
  membershipHash,
  whyCopyMemberIds,
} from "./whyCopyMeta";

describe("membershipHash", () => {
  it("is deterministic and ORDER-INSENSITIVE over the product-id set", () => {
    const a = membershipHash(["p1", "p2", "p3"]);
    expect(membershipHash(["p3", "p1", "p2"])).toBe(a);
    expect(membershipHash(["p1", "p2", "p3"])).toBe(a);
  });

  it("changes when membership changes", () => {
    const before = membershipHash(["p1", "p2"]);
    expect(membershipHash(["p1", "p2", "p3"])).not.toBe(before);
    expect(membershipHash(["p1"])).not.toBe(before);
    expect(membershipHash([])).not.toBe(before);
  });
});

describe("whyCopyMemberIds", () => {
  const cats = [
    { id: "c1", productIds: ["p1", "p2"] },
    { id: "c2", productIds: ["p3"] },
  ];
  it("scopes to the target's members, or every bucket for the global slot", () => {
    expect(whyCopyMemberIds(cats, "c2")).toEqual(["p3"]);
    expect(whyCopyMemberIds(cats, null)).toEqual(["p1", "p2", "p3"]);
    expect(whyCopyMemberIds(cats, "gone")).toEqual([]);
  });
});

describe("isWhyCopyStale", () => {
  it("flags only PROVENANCED copy whose membership hash drifted", () => {
    const current = membershipHash(["p1", "p2"]);
    expect(isWhyCopyStale({ members: current }, current)).toBe(false);
    expect(isWhyCopyStale({ members: membershipHash(["p1"]) }, current)).toBe(true);
    // Hand-written / never-generated copy carries no provenance → never stale.
    expect(isWhyCopyStale(undefined, current)).toBe(false);
  });
});

describe("schema round-trip (strip-mode regression guard)", () => {
  it("why_copy_meta + nested whyCopyLocked survive Quiz.parse (the L2-8 strip lesson)", async () => {
    const { Quiz } = await import("./quizSchema");
    const baseNodes = [
      { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
      {
        id: "q1",
        type: "question",
        position: { x: 1, y: 0 },
        data: {
          text: "Pick",
          question_type: "single_select",
          answers: [
            { id: "a1", text: "A", edge_handle_id: "h1" },
            { id: "a2", text: "B", edge_handle_id: "h2" },
          ],
        },
      },
    ];
    const doc = Quiz.parse({
      quiz_id: "wc1",
      scope: { collection_ids: [] },
      nodes: baseNodes,
      edges: [{ id: "e1", source: "intro", target: "q1" }],
      rec_page_settings: {
        global: { whyCopyLocked: true },
        overrides: { cat1: { whyCopy: "kept", whyCopyLocked: false } },
      },
      why_copy_meta: { __global__: { at: "2026-01-01T00:00:00.000Z", members: "abcd1234" } },
    });
    expect(doc.rec_page_settings?.global.whyCopyLocked).toBe(true);
    expect(doc.rec_page_settings?.overrides.cat1?.whyCopyLocked).toBe(false);
    expect(doc.why_copy_meta?.__global__?.members).toBe("abcd1234");
    // And a legacy doc gains NONE of them on parse (absent-when-unset).
    const legacy = Quiz.parse({
      quiz_id: "wc2",
      scope: { collection_ids: [] },
      nodes: baseNodes,
      edges: [{ id: "e1", source: "intro", target: "q1" }],
    });
    expect("why_copy_meta" in legacy).toBe(false);
    expect("rec_page_settings" in legacy).toBe(false);
  });
});

describe("§8.2 grounding constraint", () => {
  it("pins the spec's prompt constraint VERBATIM (a safety requirement, not style)", () => {
    expect(WHY_COPY_CONSTRAINT).toBe(
      "Reason only from the supplied product attributes. Never assert efficacy, ingredients, or " +
        "outcomes not present in the product data. If the data doesn't support a specific reason, " +
        "give a general benefit statement.",
    );
  });

  it("the global meta key is stable (persisted in docs — renaming would orphan provenance)", () => {
    expect(GLOBAL_WHY_COPY_KEY).toBe("__global__");
  });
});
