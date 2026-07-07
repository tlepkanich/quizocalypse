import { describe, expect, it } from "vitest";
import {
  displayAspect,
  displayBackground,
  displayContainer,
  displayRadius,
} from "./answerDisplay";
import { Quiz } from "./quizSchema";
import {
  readabilityHint,
  screenBackgroundCss,
  screenOverlayAlpha,
  videoLayer,
} from "./screenBackground";

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

// ── QZY-10 (build-tab §7) — the v1 block inventory parses; docs without the
// new blocks are untouched (the discriminated union only grew) ──────────────

describe("QZY-10 schema — new block types", () => {
  const docWith = (blocks: unknown[]) =>
    Quiz.parse({
      quiz_id: "qz",
      scope: { collection_ids: [] },
      nodes: [
        { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
        { id: "end", type: "end", position: { x: 0, y: 0 }, data: { headline: "Bye" } },
      ],
      edges: [{ id: "e1", source: "intro", target: "end" }],
      results_pages: [],
      node_layouts: { intro: blocks },
    });

  it("video / progress / logo / content blocks parse with defaults", () => {
    const doc = docWith([
      { id: "b1", type: "video", url: "https://cdn.example.com/v.mp4", autoplay: true },
      { id: "b2", type: "progress", bar_style: "dots" },
      { id: "b3", type: "logo", url: "https://cdn.example.com/l.png", size: 64 },
      { id: "b4", type: "content", text: "Hello\n\n- one\n- [two](https://x.com)" },
    ]);
    const blocks = doc.node_layouts["intro"]!;
    expect(blocks.map((b) => b.type)).toEqual(["video", "progress", "logo", "content"]);
    const video = blocks[0]!;
    expect(video.type === "video" && video.controls).toBe(true);
    const progress = blocks[1]!;
    expect(progress.type === "progress" && progress.thickness).toBe(6);
  });

  it("button action + image extras + letter spacing parse", () => {
    const doc = docWith([
      {
        id: "b1",
        type: "button",
        label: "Shop",
        action: "link",
        href: "https://shop.example.com",
        full_width: true,
        icon: "→",
      },
      { id: "b2", type: "image", url: "https://cdn.example.com/i.png", height: 240, radius: 8, link: "https://x.com" },
      { id: "b3", type: "text", text: "T", style: { letter_spacing: 1.5 } },
    ]);
    const btn = doc.node_layouts["intro"]![0]!;
    expect(btn.type === "button" && btn.action).toBe("link");
    const txt = doc.node_layouts["intro"]![2]!;
    expect(txt.style.letter_spacing).toBe(1.5);
  });

  it("rejects bad actions and out-of-range values", () => {
    expect(() => docWith([{ id: "b", type: "button", action: "explode" }])).toThrow();
    expect(() => docWith([{ id: "b", type: "progress", thickness: 40 }])).toThrow();
    expect(() => docWith([{ id: "b", type: "logo", size: 4 }])).toThrow();
  });
});

// ── QZY-11 (build-tab §8) — per-screen backgrounds ───────────────────────────

describe("QZY-11 screenBackground — resolution + guards", () => {
  it("color / gradient / image css", () => {
    expect(screenBackgroundCss({ type: "color", color: "#123456" }).background).toBe("#123456");
    expect(
      screenBackgroundCss({ type: "gradient", color: "#000", color2: "#fff", angle: 90 }).background,
    ).toBe("linear-gradient(90deg, #000, #fff)");
    const img = screenBackgroundCss({
      type: "image",
      image_url: "https://cdn.example.com/x.jpg",
      fit: "tile",
      focal_x: 20,
      focal_y: 80,
    });
    expect(img.backgroundRepeat).toBe("repeat");
    expect(img.backgroundPosition).toBe("20% 80%");
  });

  it("video layer: always muted semantics, poster fallback default on mobile", () => {
    const v = videoLayer({ type: "video", video_url: "https://cdn.example.com/v.mp4", poster_url: "https://cdn.example.com/p.jpg" });
    expect(v?.mobilePlays).toBe(false);
    expect(videoLayer({ type: "video", video_url: "https://cdn.example.com/v.mp4", mobile_video: "play" })?.mobilePlays).toBe(true);
    expect(videoLayer({ type: "image" })).toBeNull();
  });

  it("overlay alpha + readability hint (non-blocking)", () => {
    expect(screenOverlayAlpha({ overlay: 45 })).toBe(0.45);
    expect(readabilityHint({ type: "image", image_url: "https://x.com/i.jpg", overlay: 10 })).toBeTruthy();
    expect(readabilityHint({ type: "image", image_url: "https://x.com/i.jpg", overlay: 40 })).toBeNull();
    expect(readabilityHint({ type: "color", color: "#fff" })).toBeNull();
  });

  it("schema: node_backgrounds parses; docs without it gain no key", () => {
    const base = {
      quiz_id: "qz",
      scope: { collection_ids: [] },
      nodes: [
        { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
        { id: "end", type: "end", position: { x: 0, y: 0 }, data: { headline: "Bye" } },
      ],
      edges: [{ id: "e1", source: "intro", target: "end" }],
      results_pages: [],
    };
    const withBg = Quiz.parse({
      ...base,
      node_backgrounds: {
        intro: { type: "video", video_url: "https://cdn.example.com/v.mp4", overlay: 40 },
      },
    });
    expect(withBg.node_backgrounds?.["intro"]?.type).toBe("video");
    const once = Quiz.parse(base);
    expect(JSON.stringify(once)).not.toContain("node_backgrounds");
    expect(() => Quiz.parse({ ...base, node_backgrounds: { intro: { overlay: 90 } } })).toThrow();
  });
});
