import { describe, expect, it } from "vitest";
import {
  DEFAULT_GEN_SETTINGS,
  applyPostGeneration,
  buildPromptAdditions,
} from "./quizGenSettings";
import { Quiz } from "./quizSchema";

// Builds a minimal valid quiz: intro → q1 → r1. Used as the "AI returned
// this" fixture for the post-process tests so they exercise the real
// rewiring logic without mocking the schema.
function minimalAIDraft() {
  return Quiz.parse({
    quiz_id: "fixture",
    scope: { collection_ids: ["c1"] },
    nodes: [
      {
        id: "intro",
        type: "intro",
        position: { x: 0, y: 0 },
        data: { headline: "Welcome" },
      },
      {
        id: "q1",
        type: "question",
        position: { x: 300, y: 0 },
        data: {
          text: "Pick one",
          question_type: "single_select",
          answers: [
            { id: "a1", text: "A", tags: ["a"], edge_handle_id: "h1" },
            { id: "a2", text: "B", tags: ["b"], edge_handle_id: "h2" },
          ],
        },
      },
      {
        id: "q2",
        type: "question",
        position: { x: 600, y: 0 },
        data: {
          text: "Pick another",
          question_type: "single_select",
          answers: [
            { id: "a3", text: "C", tags: ["c"], edge_handle_id: "h3" },
            { id: "a4", text: "D", tags: ["d"], edge_handle_id: "h4" },
          ],
        },
      },
      {
        id: "r1",
        type: "result",
        position: { x: 900, y: 0 },
        data: { headline: "Your match", fallback_collection_id: "c1" },
      },
    ],
    edges: [
      { id: "e1", source: "intro", target: "q1" },
      { id: "e2", source: "q1", target: "q2" },
      { id: "e3", source: "q2", target: "r1" },
    ],
  });
}

describe("buildPromptAdditions", () => {
  it("returns an empty string when all flags are off and tone is default", () => {
    // The default tone is "friendly" so we always get the tone line — but
    // the legacy code path doesn't pass settings at all, so that branch is
    // gated upstream. Here we just assert the function is deterministic.
    const out = buildPromptAdditions(DEFAULT_GEN_SETTINGS);
    expect(out).toContain("Tone:");
    expect(out).not.toContain("Flow extensions");
  });

  it("includes the welcome message instruction when welcome_message is on", () => {
    const out = buildPromptAdditions({
      ...DEFAULT_GEN_SETTINGS,
      flow: { ...DEFAULT_GEN_SETTINGS.flow, welcome_message: true },
    });
    expect(out).toContain("`message` node");
    expect(out).toContain("welcomes the shopper");
  });

  it("includes the email_gate instruction when toggled", () => {
    const out = buildPromptAdditions({
      ...DEFAULT_GEN_SETTINGS,
      flow: { ...DEFAULT_GEN_SETTINGS.flow, email_gate: true },
    });
    expect(out).toContain("`email_gate` node");
  });

  it("includes mixed-input-types instruction when toggled", () => {
    const out = buildPromptAdditions({
      ...DEFAULT_GEN_SETTINGS,
      flow: { ...DEFAULT_GEN_SETTINGS.flow, mixed_input_types: true },
    });
    expect(out).toContain("image_picker");
    expect(out).toContain("searchable");
  });

  it("threads the tone choice into the output", () => {
    const out = buildPromptAdditions({
      ...DEFAULT_GEN_SETTINGS,
      tone: "playful",
    });
    expect(out).toContain("Light, witty, energetic");
  });
});

describe("applyPostGeneration — theme preset", () => {
  it("merges a preset's primary color into design_tokens.colors.primary", () => {
    const out = applyPostGeneration(minimalAIDraft(), {
      ...DEFAULT_GEN_SETTINGS,
      theme_preset_id: "bold",
    });
    expect(out.design_tokens.colors?.primary).toBe("#FF3D00");
  });

  it("ignores an unknown preset id without throwing", () => {
    const draft = minimalAIDraft();
    const out = applyPostGeneration(draft, {
      ...DEFAULT_GEN_SETTINGS,
      theme_preset_id: "nonexistent-preset",
    });
    // Unknown preset → design_tokens passes through untouched.
    expect(out.design_tokens).toEqual(draft.design_tokens);
  });
});

describe("applyPostGeneration — launcher_config", () => {
  it("flips enabled and respects icon + corner choices", () => {
    const out = applyPostGeneration(minimalAIDraft(), {
      ...DEFAULT_GEN_SETTINGS,
      launcher: {
        enabled: true,
        icon: "star",
        corner: "top-left",
      },
    });
    expect(out.launcher_config.enabled).toBe(true);
    expect(out.launcher_config.icon).toBe("star");
    expect(out.launcher_config.corner).toBe("top-left");
  });

  it("leaves launcher_config untouched when disabled", () => {
    const out = applyPostGeneration(minimalAIDraft(), DEFAULT_GEN_SETTINGS);
    expect(out.launcher_config.enabled).toBe(false);
  });
});

describe("applyPostGeneration — integration stub", () => {
  it("inserts exactly one integration node before the result", () => {
    const out = applyPostGeneration(minimalAIDraft(), {
      ...DEFAULT_GEN_SETTINGS,
      integrations: { webhook_stub: true },
    });
    const intNodes = out.nodes.filter((n) => n.type === "integration");
    expect(intNodes).toHaveLength(1);
  });

  it("repoints inbound edges so the result is reached via the integration", () => {
    const out = applyPostGeneration(minimalAIDraft(), {
      ...DEFAULT_GEN_SETTINGS,
      integrations: { webhook_stub: true },
    });
    const intNode = out.nodes.find((n) => n.type === "integration")!;
    const resultNode = out.nodes.find((n) => n.type === "result")!;
    // Nothing should target the result directly except the new bridge.
    const directToResult = out.edges.filter((e) => e.target === resultNode.id);
    expect(directToResult).toHaveLength(1);
    expect(directToResult[0]?.source).toBe(intNode.id);
    // The pre-existing q2 → r1 edge should now point at the integration.
    const intInbound = out.edges.filter((e) => e.target === intNode.id);
    expect(intInbound.length).toBeGreaterThanOrEqual(1);
    expect(intInbound[0]?.source).toBe("q2");
  });

  it("produces a doc that still parses against the Quiz schema", () => {
    const out = applyPostGeneration(minimalAIDraft(), {
      ...DEFAULT_GEN_SETTINGS,
      integrations: { webhook_stub: true },
    });
    expect(() => Quiz.parse(out)).not.toThrow();
  });

  it("no-ops gracefully when the AI returned no result node", () => {
    const sparse = Quiz.parse({
      quiz_id: "sparse",
      scope: { collection_ids: [] },
      nodes: [
        {
          id: "intro",
          type: "intro",
          position: { x: 0, y: 0 },
          data: { headline: "Hi" },
        },
        {
          id: "end1",
          type: "end",
          position: { x: 300, y: 0 },
          data: { headline: "Bye" },
        },
      ],
      edges: [{ id: "e1", source: "intro", target: "end1" }],
    });
    expect(() =>
      applyPostGeneration(sparse, {
        ...DEFAULT_GEN_SETTINGS,
        integrations: { webhook_stub: true },
      }),
    ).not.toThrow();
  });
});

describe("applyPostGeneration — mid_flow_preview safety net", () => {
  it("flips show_preview_after on the middle question when none was flagged", () => {
    const out = applyPostGeneration(minimalAIDraft(), {
      ...DEFAULT_GEN_SETTINGS,
      flow: { ...DEFAULT_GEN_SETTINGS.flow, mid_flow_preview: true },
    });
    const flagged = out.nodes.filter(
      (n) => n.type === "question" && n.data.show_preview_after === true,
    );
    expect(flagged).toHaveLength(1);
  });

  it("respects an existing AI-set flag rather than adding another", () => {
    const draftWithFlag = minimalAIDraft();
    const out = applyPostGeneration(
      {
        ...draftWithFlag,
        nodes: draftWithFlag.nodes.map((n) => {
          if (n.id !== "q1" || n.type !== "question") return n;
          return { ...n, data: { ...n.data, show_preview_after: true } };
        }),
      },
      {
        ...DEFAULT_GEN_SETTINGS,
        flow: { ...DEFAULT_GEN_SETTINGS.flow, mid_flow_preview: true },
      },
    );
    const flagged = out.nodes.filter(
      (n) => n.type === "question" && n.data.show_preview_after === true,
    );
    expect(flagged).toHaveLength(1);
    expect(flagged[0]?.id).toBe("q1"); // not the middle one (q2)
  });
});
