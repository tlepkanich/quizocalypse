import { useMemo, useState } from "react";
import { QuizRuntime } from "../runtime/QuizRuntime";
import { bakeResultPages } from "../../lib/quizPublish";
import type { Quiz, QuizNode } from "../../lib/quizSchema";
import type { IndexedProduct } from "../../lib/recommendationEngine";
import type { BuilderCategory } from "../builder/stepProps";
import { DeviceFrame } from "../builder/preview/DeviceFrame";
import { DEVICE_PRESETS, breakpointForWidth } from "../builder/preview/previewWidth";

// ───────────────────────────────────────────────────────────────────────────
// RecPagePreview — the funnel Rec Page's LIVE preview: a real, focused render
// of the selected result page exactly as shoppers see it (headline · "why we
// recommend" copy · ⭐ hero card · product grid), inside a faux-browser frame.
//
// It reuses the main builder's proven recipe (Step5Preview): bake the draft's
// `category_product_ids_map` from the live buckets — a PUBLISH-time field a
// draft lacks — so the recommendation engine resolves REAL products, then run
// the runtime in preview mode (no side-effects) focused on the result node.
//
// PREVIEW-ONLY / byte-stable: the baked doc lives in a memo and is NEVER
// persisted (RecommendationStage's autosave commits the raw doc, not this), so
// published `/q` bytes are untouched. Publishing bakes fresh via publishQuiz().
// ───────────────────────────────────────────────────────────────────────────

type ResultNode = Extract<QuizNode, { type: "result" }>;

export function RecPagePreview({
  doc,
  node,
  productIndex,
  categories,
  quizId,
}: {
  doc: Quiz;
  node: ResultNode;
  productIndex: IndexedProduct[];
  categories: BuilderCategory[];
  quizId: string;
}) {
  const [frameW, setFrameW] = useState<number>(DEVICE_PRESETS.desktop);

  // Bake category_product_ids_map from the live buckets (identical to
  // Step5Preview / RecPageDiagram) so category-bound sections resolve real
  // membership without a re-publish.
  const previewDoc = useMemo(() => {
    const byId = new Map(categories.map((c) => [c.id, c.productIds]));
    return { ...doc, results_pages: bakeResultPages(doc, byId) };
  }, [doc, categories]);

  const breakpoint = breakpointForWidth(frameW);

  return (
    <DeviceFrame width={frameW} onWidthChange={setFrameW} urlLabel="yourstore.com/quiz/results">
      <QuizRuntime
        // Remount when the selected bucket changes so the runtime jumps cleanly
        // to that result node (no stale path state).
        key={node.id}
        mode="preview"
        doc={previewDoc}
        productIndex={productIndex}
        designTokens={previewDoc.design_tokens ?? null}
        designOverrides={previewDoc.design_overrides}
        breakpointOverrides={previewDoc.breakpoint_overrides}
        resultLayoutMode={previewDoc.result_layout_mode}
        designLinked={previewDoc.design_linked ?? true}
        recPageDesign={previewDoc.rec_page_design ?? null}
        quizId={quizId}
        version={0}
        shopDomain=""
        breakpoint={breakpoint}
        focusNodeId={node.id}
      />
    </DeviceFrame>
  );
}
