import { DesignTokens, type Quiz } from "../quizSchema";
import { resolveDesignTokens } from "../designTokens";
import { builderThemePresets } from "../quizDesignTemplates";

export function applyBuilderTheme(doc: Quiz, presetId: string): Quiz {
  const preset = builderThemePresets(doc.logic_model).find(item => item.id === presetId);
  if (!preset) return doc;
  const tokens = DesignTokens.parse(resolveDesignTokens(preset.tokens));
  return { ...doc, design_tokens: tokens };
}
