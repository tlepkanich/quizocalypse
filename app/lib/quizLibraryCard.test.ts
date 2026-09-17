import { describe, it, expect } from "vitest";
import { quizCardFacts, quizCardProducts } from "./quizLibraryCard";

describe("§R-7 quizCardFacts", () => {
  it("counts questions and distinct persona targets, reads the intro thumb", () => {
    const doc = {
      nodes: [
        { type: "intro", data: { headline: "Find your match", button_label: "Begin" } },
        { type: "question", data: { answers: [{ target_id: "g1" }, { target_id: "g2" }] } },
        { type: "question", data: { answers: [{ target_id: "g1" }, { target_id: "g3" }] } },
      ],
      design_tokens: { colors: { primary: "#123456", background: "#ffffff", text: "#000000" } },
    };
    const f = quizCardFacts(doc);
    expect(f.questions).toBe(2);
    expect(f.personas).toBe(3); // g1,g2,g3 deduped
    expect(f.thumb.headline).toBe("Find your match");
    expect(f.thumb.buttonLabel).toBe("Begin");
    expect(f.thumb.primary).toBe("#123456");
  });

  it("falls back to result-node count when no answer targets exist", () => {
    const doc = {
      nodes: [
        { type: "intro", data: {} },
        { type: "question", data: { answers: [{}, {}] } },
        { type: "result", data: {} },
        { type: "result", data: {} },
      ],
    };
    const f = quizCardFacts(doc);
    expect(f.questions).toBe(1);
    expect(f.personas).toBe(2);
    expect(f.thumb.headline).toBe("New quiz");
    expect(f.thumb.buttonLabel).toBe("Start");
  });

  it("never throws on a junk/empty doc (defensive — cosmetic facts)", () => {
    expect(quizCardFacts(null).questions).toBe(0);
    expect(quizCardFacts(undefined).personas).toBe(0);
    expect(quizCardFacts({ nodes: "not-an-array" }).questions).toBe(0);
    expect(quizCardFacts(42).thumb.headline).toBe("New quiz");
  });

  it("reads results settings and independent results branding without modifying the doc", () => {
    const doc = {
      logic_model: "decider", nodes: [], design_linked: false,
      design_tokens: { colors: { primary: "#111111" } },
      rec_page_design: { colors: { primary: "#005544", background: "#ffffff" } },
      rec_page_settings: { global: { headline: "Your winter essentials", layout: "grid", imgFit: "cover" } },
    };
    const before = JSON.stringify(doc);
    const { thumb } = quizCardFacts(doc);
    expect(thumb.results).toEqual({ headline: "Your winter essentials", layout: "grid", imgFit: "cover" });
    expect(thumb.primary).toBe("#005544");
    expect(JSON.stringify(doc)).toBe(before);
    expect(quizCardFacts({ ...doc, design_linked: true }).thumb.primary).toBe("#111111");
    expect(quizCardFacts({ ...doc, logic_model: undefined }).thumb.results).toBeUndefined();
    expect(quizCardFacts({ ...doc, logic_model: undefined }).thumb.primary).toBe("#111111");
  });

  it("uses results defaults for an unfinished decider draft without reading questions", () => {
    const { thumb } = quizCardFacts({ logic_model: "decider", nodes: [{ type: "question", data: { text: "Never show this" } }] });
    expect(thumb.results).toEqual({ headline: "Your perfect match", layout: "hero_grid", imgFit: "contain" });
    expect(JSON.stringify(thumb)).not.toContain("Never show this");
  });

  it("bounds product samples, deduplicates them, and prefers safe real photography", () => {
    const products = [
      { id: "1", title: "One", imageUrl: null },
      { id: "2", title: "Two", imageUrl: "file:///private/photo.jpg" },
      { id: "3", title: "Three", imageUrl: "https://example.com/three.jpg" },
      { id: "3", title: "Three", imageUrl: "https://example.com/three.jpg" },
      { id: "4", title: "Four", imageUrl: "/four.jpg" },
    ];
    const before = JSON.stringify(products);
    expect(quizCardProducts(products).map((p) => p.id)).toEqual(["3", "4", "1"]);
    expect(quizCardProducts([products[1]!])[0]?.imageUrl).toBeNull();
    expect(JSON.stringify(products)).toBe(before);
  });
});
