import { useMemo, useState } from "react";
import { QuizRuntime } from "../runtime/QuizRuntime";
import { bakeResultPages } from "../../lib/quizPublish";
import { draftDeciderBake } from "../../lib/draftDeciderBake";
import type { Quiz, QuizNode } from "../../lib/quizSchema";
import type { IndexedProduct } from "../../lib/recommendationEngine";
import type { BuilderCategory } from "../builder/stepProps";
import { DeviceFrame } from "../builder/preview/DeviceFrame";
import { QzSegmented } from "../qz";
import {
  DEFAULT_TIER,
  DEVICE_TIERS,
  TIER_BREAKPOINT,
  TIER_LABEL,
  type DeviceTier,
} from "../builder/preview/previewWidth";

// ───────────────────────────────────────────────────────────────────────────
// RecPagePreview — the funnel Rec Page's LIVE preview: a real, focused render
// of the selected result page exactly as shoppers see it (headline · "why we
// recommend" copy · ⭐ hero card · product grid), inside the fixed device frame.
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
  const [tier, setTier] = useState<DeviceTier>(DEFAULT_TIER);

  // Bake category_product_ids_map from the live buckets (identical to
  // Step5Preview / RecPageDiagram) so category-bound sections resolve real
  // membership without a re-publish.
  const previewDoc = useMemo(() => {
    const byId = new Map(categories.map((c) => [c.id, c.productIds]));
    return { ...doc, results_pages: bakeResultPages(doc, byId) };
  }, [doc, categories]);

  // LOGIC v2 (L2-10a) — the decider analog: derive the publish-time target map
  // from the live buckets so a decider draft's reveal resolves real products.
  // Legacy docs derive nothing → props stay null → engine inputs unchanged.
  const deciderBake = useMemo(
    () => (doc.logic_model === "decider" ? draftDeciderBake(categories) : null),
    [doc, categories],
  );

  // A1 — the tier prop, not the frame's pixel width, drives the quiz layout.
  const breakpoint = TIER_BREAKPOINT[tier];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="qz-row" style={{ justifyContent: "flex-end" }}>
        <QzSegmented<DeviceTier>
          ariaLabel="Device"
          value={tier}
          onChange={setTier}
          options={DEVICE_TIERS.map((t) => ({ value: t, label: TIER_LABEL[t] }))}
        />
      </div>
      {/* This column is auto-height, so the frame needs an explicit pane. */}
      <DeviceFrame tier={tier} paneHeight="min(760px, calc(100vh - 260px))">
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
        targetProductIdsMap={deciderBake?.targetProductIdsMap ?? null}
        targetIndex={deciderBake?.targetIndex ?? null}
        breakpoint={breakpoint}
        focusNodeId={node.id}
      />
      </DeviceFrame>
    </div>
  );
}
