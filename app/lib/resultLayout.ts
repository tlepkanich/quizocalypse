import type { DesignTokensT } from "./designTokens";

// Shared design override key for the "one shared template" page-model
// posture (Quiz.result_layout_mode === "shared"). All result nodes inherit
// this layer unless they've been individually broken out (which writes a
// per-node entry in design_overrides[nodeId]).
export const SHARED_RESULT_KEY = "__shared_result__";

// Resolve the design-override layer that applies to a node, honoring the
// shared result-layout posture. For a `result` node in "shared" mode with
// no per-node override, fall back to the shared template. Everything else
// uses the node's own override (or null). Pure — used by both the
// storefront runtime (q.$id.tsx) and the builder preview (NodePreview).
export function resolveNodeOverride(
  nodeId: string,
  nodeType: string,
  resultLayoutMode: "shared" | "custom",
  designOverrides: Record<string, DesignTokensT>,
): DesignTokensT | null {
  const own = designOverrides[nodeId] ?? null;
  if (nodeType === "result" && resultLayoutMode === "shared" && !own) {
    return designOverrides[SHARED_RESULT_KEY] ?? null;
  }
  return own;
}
