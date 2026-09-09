import { describe, expect, it } from "vitest";
import { Quiz, DesignTokens } from "./quizSchema";
import { findContrastIssues, resolveDesignTokens } from "./designTokens";
import { THEME_PRESETS } from "./themePresets";
import { QUIZ_DESIGN_TEMPLATES, builderThemePresets } from "./quizDesignTemplates";
import { applyBuilderTheme } from "./quizMutations";

const fixture = (decider: boolean) => Quiz.parse({
  quiz_id: "themes", scope: { collection_ids: [] },
  nodes: [
    { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Welcome" } },
    { id: "end", type: "end", position: { x: 0, y: 0 }, data: { headline: "Done" } },
  ],
  edges: [{ id: "intro-end", source: "intro", target: "end" }],
  ...(decider ? { logic_model: "decider" } : {}),
});

describe("live-quiz design templates", () => {
  it("keeps the original legacy registry and refuses the new IDs on legacy docs", () => {
    expect(builderThemePresets(undefined)).toBe(THEME_PRESETS);
    const doc = fixture(false);
    const before = JSON.stringify(doc);
    for (const template of QUIZ_DESIGN_TEMPLATES) expect(applyBuilderTheme(doc, template.id)).toBe(doc);
    expect(JSON.stringify(doc)).toBe(before);
  });
  it("offers the additional templates only on decider docs", () => {
    expect(builderThemePresets("decider")).toEqual([...THEME_PRESETS, ...QUIZ_DESIGN_TEMPLATES]);
    expect(THEME_PRESETS.some(item => item.id === "discovery")).toBe(false);
  });
  it.each(THEME_PRESETS)("preserves the legacy $name application result", preset => {
    const doc = fixture(false);
    expect(applyBuilderTheme(doc, preset.id)).toEqual({
      ...doc, design_tokens: resolveDesignTokens(preset.tokens),
    });
  });
  it.each(QUIZ_DESIGN_TEMPLATES)("$name applies valid accessible tokens without changing content", template => {
    expect(DesignTokens.safeParse(template.tokens).success).toBe(true);
    expect(findContrastIssues(template.tokens)).toEqual([]);
    const doc = fixture(true);
    const before = JSON.stringify(doc);
    const applied = applyBuilderTheme(doc, template.id);
    expect(applied.design_tokens.colors?.primary).toBe(template.tokens.colors?.primary);
    expect({...applied, design_tokens: doc.design_tokens}).toEqual(doc);
    expect(applied.nodes).toBe(doc.nodes);
    expect(applied.edges).toBe(doc.edges);
    expect(JSON.stringify(doc)).toBe(before);
    expect(Quiz.safeParse(applied).success).toBe(true);
  });
  it("unknown IDs do not commit a change", () => {
    const doc = fixture(true);
    expect(applyBuilderTheme(doc, "missing")).toBe(doc);
  });
});
