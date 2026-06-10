import type { DesignTokens, Quiz } from "./quizSchema";

// ════════════════════════════════════════════════════════════════════════════
// Design-token layer writes (Unified P0 — extracted from StudioBuilder so the
// StyleTab panel, the coming ContextPanel, and AI design ops share ONE write
// path). "synced" writes design_overrides[nodeId] (applies to both
// breakpoints); "desktop"/"mobile" write breakpoint_overrides[nodeId][bp],
// which layers on top of synced at render time (resolveForBreakpoint).
// ════════════════════════════════════════════════════════════════════════════

export type DesignLayerMode = "synced" | "desktop" | "mobile";

type Tokens = DesignTokens;

export function mergeTokens(cur: Tokens, patch: Tokens): Tokens {
  return {
    ...cur,
    ...patch,
    ...(patch.colors ? { colors: { ...cur.colors, ...patch.colors } } : {}),
  };
}

export function setDesignLayer(
  doc: Quiz,
  nodeId: string,
  mode: DesignLayerMode,
  patch: Tokens,
): Quiz {
  if (mode === "synced") {
    const cur = doc.design_overrides[nodeId] ?? {};
    return {
      ...doc,
      design_overrides: { ...doc.design_overrides, [nodeId]: mergeTokens(cur, patch) },
    };
  }
  const rec = doc.breakpoint_overrides[nodeId] ?? {};
  const cur = rec[mode] ?? {};
  return {
    ...doc,
    breakpoint_overrides: {
      ...doc.breakpoint_overrides,
      [nodeId]: { ...rec, [mode]: mergeTokens(cur, patch) },
    },
  };
}
