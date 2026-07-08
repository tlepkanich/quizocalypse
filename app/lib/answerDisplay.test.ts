import { describe, expect, it } from "vitest";
import {
  copyOptionMediaToAll,
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

// ── R5a (build-tab §3.2) — apply one option's media to all ───────────────────
describe("copyOptionMediaToAll", () => {
  it("pushes the source option's icon + image to every other option", () => {
    const answers = [
      { id: "a", icon: "🔥", image_url: "https://x/a.png" },
      { id: "b", icon: "💧" },
      { id: "c", image_url: "https://x/c.png" },
    ];
    const out = copyOptionMediaToAll(answers, "a");
    expect(out[0]).toEqual(answers[0]); // source untouched
    expect(out[1]).toEqual({ id: "b", icon: "🔥", image_url: "https://x/a.png" });
    expect(out[2]).toEqual({ id: "c", icon: "🔥", image_url: "https://x/a.png" });
  });

  it("clears media on others when the source has none", () => {
    const answers = [
      { id: "a" },
      { id: "b", icon: "💧", image_url: "https://x/b.png" },
    ];
    const out = copyOptionMediaToAll(answers, "a");
    expect(out[1]).toEqual({ id: "b" }); // both cleared to match the source
  });

  it("returns a copy unchanged when the source id is missing", () => {
    const answers = [{ id: "a", icon: "🔥" }];
    expect(copyOptionMediaToAll(answers, "zzz")).toEqual(answers);
  });
});

// ── R5b (build-tab §3.1/§3.3) — new answer-display fields are optional & byte-safe
describe("answer_display R5b fields", () => {
  const docWith = (ad: Record<string, unknown>) => ({
    quiz_id: "qz_ad",
    scope: { collection_ids: [] },
    nodes: [
      { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
      {
        id: "q1",
        type: "question",
        position: { x: 1, y: 0 },
        data: {
          text: "Pick",
          question_type: "single_select",
          answers: [
            { id: "a1", text: "A", tags: [], edge_handle_id: "h1" },
            { id: "a2", text: "B", tags: [], edge_handle_id: "h2" },
          ],
          answer_display: ad,
        },
      },
    ],
    edges: [{ id: "e0", source: "intro", target: "q1" }],
  });

  it("parses show_media / content_align / image_size / icon_position:right", () => {
    const parsed = Quiz.parse(
      docWith({ mode: "list", show_media: true, content_align: "center", image_size: 48, icon_position: "right" }),
    );
    const ad = (parsed.nodes[1] as { data: { answer_display?: Record<string, unknown> } }).data
      .answer_display;
    expect(ad).toMatchObject({ show_media: true, content_align: "center", image_size: 48, icon_position: "right" });
  });

  it("a display config WITHOUT the new fields serializes without them (byte-safe)", () => {
    const once = Quiz.parse(docWith({ mode: "list", label_size: 16, selected_style: "check" }));
    const json = JSON.stringify(once);
    for (const k of [
      "show_media",
      "content_align",
      "image_size",
      "selected_fill",
      "selected_indicator",
      "selected_border_color",
      "hover_bg",
      "motion",
      "effect",
    ]) {
      expect(json).not.toContain(k);
    }
  });

  it("R5c-2/3 §6.1/§6.2 — parses hover + motion + effect", () => {
    const parsed = Quiz.parse(
      docWith({ mode: "list", hover_bg: "#eef", hover_border: "#99f", motion: "lift", effect: "pulse" }),
    );
    const ad = (parsed.nodes[1] as { data: { answer_display?: Record<string, unknown> } }).data
      .answer_display;
    expect(ad).toMatchObject({ hover_bg: "#eef", motion: "lift", effect: "pulse" });
  });

  it("R5c-1 §6.1 — parses the granular selected-state fields", () => {
    const parsed = Quiz.parse(
      docWith({
        mode: "list",
        selected_indicator: "dot",
        selected_fill: "#eef",
        selected_border_color: "#123456",
        selected_border_width: 3,
        selected_text_color: "#900",
      }),
    );
    const ad = (parsed.nodes[1] as { data: { answer_display?: Record<string, unknown> } }).data
      .answer_display;
    expect(ad).toMatchObject({
      selected_indicator: "dot",
      selected_fill: "#eef",
      selected_border_width: 3,
    });
  });
});
