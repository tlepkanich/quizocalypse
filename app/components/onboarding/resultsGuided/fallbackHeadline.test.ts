import { describe, it, expect } from "vitest";

import { Quiz } from "../../../lib/quizSchema";
import { patchGuided, resolveGuided } from "./state";

// Owner 2026-09-30 — the guided Results step writes the fallback page's
// headline through the same sparse seam as every other guided field.

const doc = (global: Record<string, unknown> = {}) =>
  Quiz.parse({
    quiz_id: "qz",
    scope: { collection_ids: [] },
    logic_model: "decider",
    nodes: [
      { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
      { id: "r1", type: "result", position: { x: 0, y: 0 }, data: { headline: "Match", fallback_collection_id: "c1" } },
    ],
    edges: [{ id: "e1", source: "intro", target: "r1" }],
    ...(Object.keys(global).length ? { rec_page_settings: { global, overrides: {} } } : {}),
  });

describe("guided Results — fallbackHeadline", () => {
  it("is absent by default (the runtime then shows the translatable default)", () => {
    expect(resolveGuided(doc()).fallbackHeadline).toBeUndefined();
  });

  it("stores the merchant text on global and clears back to absent", () => {
    const set = patchGuided(doc(), { fallbackHeadline: "Staff favourites" });
    expect(set.rec_page_settings?.global).toEqual({ fallbackHeadline: "Staff favourites" });
    expect(resolveGuided(set).fallbackHeadline).toBe("Staff favourites");
    const cleared = patchGuided(set, { fallbackHeadline: undefined });
    expect(cleared.rec_page_settings).toBeUndefined();
  });
});
