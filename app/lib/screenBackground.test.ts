import { describe, expect, it } from "vitest";
import { Quiz } from "./quizSchema";
import {
  applyBackgroundToAll,
  hasBackgroundOverride,
  screenBackgroundCss,
  screenOverlayBg,
  screensWithBackgroundOverride,
} from "./screenBackground";

// A minimal decider doc with 3 screens (intro + 2 questions).
const RAW = {
  quiz_id: "qz_bg",
  logic_model: "decider",
  scope: { collection_ids: [] },
  nodes: [
    { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
    {
      id: "q1",
      type: "question",
      position: { x: 1, y: 0 },
      data: {
        text: "One?",
        question_type: "single_select",
        answers: [
          { id: "a1", text: "A", tags: [], edge_handle_id: "h1" },
          { id: "a2", text: "B", tags: [], edge_handle_id: "h2" },
        ],
      },
    },
    {
      id: "q2",
      type: "question",
      position: { x: 2, y: 0 },
      data: {
        text: "Two?",
        question_type: "single_select",
        answers: [
          { id: "a3", text: "C", tags: [], edge_handle_id: "h3" },
          { id: "a4", text: "D", tags: [], edge_handle_id: "h4" },
        ],
      },
    },
  ],
  edges: [{ id: "e0", source: "intro", target: "q1" }],
} as const;

const withBg = (overrides: Record<string, unknown>) =>
  Quiz.parse({ ...structuredClone(RAW), node_backgrounds: overrides });

describe("screensWithBackgroundOverride / hasBackgroundOverride", () => {
  it("lists only screens with a non-empty override", () => {
    const doc = withBg({ q1: { type: "color", color: "#112233" }, q2: {} });
    expect(screensWithBackgroundOverride(doc)).toEqual(["q1"]);
    expect(hasBackgroundOverride(doc, "q1")).toBe(true);
    expect(hasBackgroundOverride(doc, "q2")).toBe(false);
    expect(hasBackgroundOverride(doc, "intro")).toBe(false);
  });

  it("no node_backgrounds → no overrides (legacy-safe)", () => {
    const doc = Quiz.parse(structuredClone(RAW));
    expect(screensWithBackgroundOverride(doc)).toEqual([]);
  });
});

describe("applyBackgroundToAll — §9 respects overrides", () => {
  const bg = { type: "gradient", color: "#000000", color2: "#ffffff" } as const;

  it("by default keeps customized screens and reports the skip count", () => {
    // q2 is customized (not the source); intro has none.
    const doc = withBg({ q1: { type: "color", color: "#aa0000" }, q2: { type: "color", color: "#00bb00" } });
    const { doc: next, skipped } = applyBackgroundToAll(doc, bg, {
      sourceNodeId: "q1",
      includeCustomized: false,
    });
    expect(skipped).toBe(1); // q2 kept
    expect(next.node_backgrounds?.q2?.color).toBe("#00bb00"); // untouched
    expect(next.node_backgrounds?.intro?.type).toBe("gradient"); // got the bg
    expect(next.node_backgrounds?.q1?.type).toBe("gradient"); // source normalized to bg
  });

  it("includeCustomized overwrites every screen and skips nothing", () => {
    const doc = withBg({ q1: { type: "color", color: "#aa0000" }, q2: { type: "color", color: "#00bb00" } });
    const { doc: next, skipped } = applyBackgroundToAll(doc, bg, {
      sourceNodeId: "q1",
      includeCustomized: true,
    });
    expect(skipped).toBe(0);
    expect(next.node_backgrounds?.q2?.type).toBe("gradient"); // stomped, as chosen
    expect(next.node_backgrounds?.intro?.type).toBe("gradient");
  });

  it("no other customized screens → applies everywhere, skip 0", () => {
    const doc = withBg({ q1: { type: "color", color: "#aa0000" } });
    const { skipped, doc: next } = applyBackgroundToAll(doc, bg, {
      sourceNodeId: "q1",
      includeCustomized: false,
    });
    expect(skipped).toBe(0);
    expect(Object.keys(next.node_backgrounds ?? {}).sort()).toEqual(["intro", "q1", "q2"]);
  });
});

// ── R6-1 (build-tab §4) — radial / 3-stop gradient + partial-image renderer ──
describe("screenBackgroundCss — R6-1 additions", () => {
  it("a 2-stop gradient without the new fields is byte-identical (linear)", () => {
    const css = screenBackgroundCss({ type: "gradient", color: "#000", color2: "#fff" });
    expect(css.background).toBe("linear-gradient(135deg, #000, #fff)");
  });

  it("renders a 3-stop radial gradient", () => {
    const css = screenBackgroundCss({
      type: "gradient",
      gradient_type: "radial",
      color: "#000",
      color2: "#888",
      color3: "#fff",
    });
    expect(css.background).toBe("radial-gradient(circle, #000, #888, #fff)");
  });

  it("renders a partial-image band + fill colour", () => {
    const left = screenBackgroundCss({
      type: "partial",
      image_url: "https://x/i.png",
      band: "left",
      coverage: 40,
      fill_color: "#eee",
    });
    expect(left.backgroundColor).toBe("#eee");
    expect(left.backgroundImage).toBe('url("https://x/i.png")');
    expect(left.backgroundSize).toBe("40% 100%");
    expect(left.backgroundPosition).toBe("left");
    const top = screenBackgroundCss({ type: "partial", image_url: "https://x/i.png", band: "top" });
    expect(top.backgroundSize).toBe("100% 50%");
    expect(top.backgroundPosition).toBe("top");
  });

  it("R6-2 §4 — overlay tint + zoom (absent → byte-identical)", () => {
    // Overlay: no tint → the exact black rgba; with tint → color-mix.
    expect(screenOverlayBg({ type: "image", overlay: 40 })).toBe("rgba(0,0,0,0.4)");
    expect(screenOverlayBg({ type: "image", overlay: 40, overlay_color: "#123456" })).toBe(
      "color-mix(in srgb, #123456 40%, transparent)",
    );
    // Zoom: overrides cover; absent → cover exactly.
    expect(screenBackgroundCss({ type: "image", image_url: "https://x/i.png" }).backgroundSize).toBe("cover");
    expect(
      screenBackgroundCss({ type: "image", image_url: "https://x/i.png", zoom: 150 }).backgroundSize,
    ).toBe("150% auto");
  });

  it("schema: partial + radial fields parse; absent → no keys (byte-safe)", () => {
    const base = {
      quiz_id: "qz_bg2",
      scope: { collection_ids: [] },
      nodes: [
        { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
        {
          id: "q1",
          type: "question",
          position: { x: 1, y: 0 },
          data: {
            text: "Q",
            question_type: "single_select",
            answers: [
              { id: "a1", text: "A", tags: [], edge_handle_id: "h1" },
              { id: "a2", text: "B", tags: [], edge_handle_id: "h2" },
            ],
          },
        },
      ],
      edges: [{ id: "e0", source: "intro", target: "q1" }],
    };
    const clean = Quiz.parse({ ...base, node_backgrounds: { intro: { type: "color", color: "#111" } } });
    const bgJson = JSON.stringify(clean.node_backgrounds);
    for (const k of ["color3", "gradient_type", "band", "coverage", "fill_color"])
      expect(bgJson).not.toContain(k);
    const withPartial = Quiz.parse({
      ...base,
      node_backgrounds: { intro: { type: "partial", image_url: "https://x/i.png", band: "right", coverage: 60, fill_color: "#eee" } },
    });
    expect(withPartial.node_backgrounds?.intro?.type).toBe("partial");
  });
});
