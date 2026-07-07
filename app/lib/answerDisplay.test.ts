import { describe, expect, it } from "vitest";
import {
  displayAspect,
  displayBackground,
  displayContainer,
  displayRadius,
} from "./answerDisplay";
import { Quiz } from "./quizSchema";

// ── QZY-9 (build-tab §5/§5.2) — answer display resolution ────────────────────

describe("displayRadius — presets set defined values; custom radius overrides", () => {
  it("shape presets", () => {
    expect(displayRadius({ shape: "pill" })).toBe(999);
    expect(displayRadius({ shape: "rounded" })).toBe(12);
    expect(displayRadius({ shape: "square" })).toBe(0);
  });
  it("custom radius wins over the preset; absent both = theme", () => {
    expect(displayRadius({ shape: "pill", radius: 6 })).toBe(6);
    expect(displayRadius({})).toBe("var(--qz-radius)");
  });
});

describe("displayContainer — layout per mode", () => {
  it("cards/tiles = grid with columns; pills = wrapping flex; list/icon = stacked", () => {
    expect(displayContainer({ mode: "cards", columns: 3 }).gridTemplateColumns).toBe(
      "repeat(3, minmax(0, 1fr))",
    );
    expect(displayContainer({ mode: "tiles" }).gridTemplateColumns).toBe(
      "repeat(2, minmax(0, 1fr))",
    );
    expect(displayContainer({ mode: "pills" }).flexWrap).toBe("wrap");
    expect(displayContainer({ mode: "list" }).gridTemplateColumns).toBe("1fr");
    expect(displayContainer({ mode: "icon", spacing: 4 }).gap).toBe(4);
  });
});

describe("displayBackground / displayAspect", () => {
  it("solid, 2-stop gradient, none", () => {
    expect(displayBackground({ bg: "#fff" })).toBe("#fff");
    expect(displayBackground({ bg: "#fff", bg2: "#000" })).toBe(
      "linear-gradient(135deg, #fff, #000)",
    );
    expect(displayBackground({})).toBeUndefined();
  });
  it("aspect ratios", () => {
    expect(displayAspect({})).toBe("1 / 1");
    expect(displayAspect({ aspect: "4:3" })).toBe("4 / 3");
    expect(displayAspect({ aspect: "16:9" })).toBe("16 / 9");
  });
});

describe("QZY-9 schema — answer_display parses and stays absent-by-default", () => {
  const base = {
    quiz_id: "qz",
    scope: { collection_ids: [] },
    nodes: [
      { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
      {
        id: "q1",
        type: "question",
        position: { x: 0, y: 0 },
        data: {
          text: "Pick",
          question_type: "single_select",
          answers: [
            { id: "a1", text: "A", tags: [], edge_handle_id: "h1" },
            { id: "a2", text: "B", tags: [], edge_handle_id: "h2" },
          ],
        },
      },
      { id: "end", type: "end", position: { x: 0, y: 0 }, data: { headline: "Bye" } },
    ],
    edges: [
      { id: "e1", source: "intro", target: "q1" },
      { id: "e2", source: "q1", target: "end" },
    ],
    results_pages: [],
  };

  it("accepts the full display object", () => {
    const doc = Quiz.parse({
      ...base,
      nodes: base.nodes.map((n) =>
        n.id === "q1"
          ? {
              ...n,
              data: {
                ...n.data,
                answer_display: {
                  mode: "tiles",
                  columns: 3,
                  shape: "rounded",
                  label_position: "overlay",
                  overlay_tint: 60,
                  selected_style: "check",
                },
              },
            }
          : n,
      ),
    });
    const q = doc.nodes.find((n) => n.id === "q1");
    expect(q?.type === "question" && q.data.answer_display?.mode).toBe("tiles");
  });

  it("a doc without answer_display round-trips with NO injected keys (lossless gate)", () => {
    const once = Quiz.parse(base);
    const twice = Quiz.parse(JSON.parse(JSON.stringify(once)));
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
    expect(JSON.stringify(once)).not.toContain("answer_display");
  });

  it("rejects unknown modes and out-of-range knobs", () => {
    const bad = (display: Record<string, unknown>) => ({
      ...base,
      nodes: base.nodes.map((n) =>
        n.id === "q1" ? { ...n, data: { ...n.data, answer_display: display } } : n,
      ),
    });
    expect(() => Quiz.parse(bad({ mode: "carousel" }))).toThrow();
    expect(() => Quiz.parse(bad({ columns: 5 }))).toThrow();
    expect(() => Quiz.parse(bad({ overlay_tint: 90 }))).toThrow();
  });
});
