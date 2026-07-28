// BIC-2 C2 — shared types + constants for the Step-1 funnel stages. Everything
// here is a PURE MOVE out of Step1Funnel.tsx (the funnel shell): the FunnelData
// loader shape, the fetcher ActionResult, the visible step order, and the small
// cross-stage helpers/labels. No behavior lives here.
import { useState } from "react";
import type {
  Quiz,
  TemplateOption,
  BuildSession,
  QuizType,
  RichTemplateOption,
  PickedTemplate,
  RecDefaults,
  DesignTokens,
} from "../../../lib/quizSchema";
import type { BuilderCategory } from "../../builder/stepProps";
import type { IndexedProduct } from "../../../lib/recommendationEngine";
import type { BucketSuggestion } from "../../../lib/bucketDetect";

// Recommendation Buckets (RB Step 1) — the three browser tabs / bucket kinds.
export type BucketType = "product" | "tag" | "collection";

// The loader's serialized shape (kept local to avoid a route⇄component type cycle).
export interface FunnelData {
  quizId: string;
  name: string;
  stage: BuildSession["stage"]; // sourced from the schema so it can't drift
  // LOGIC v2 (L2-10d) — the creation stamp. "decider" drafts get the
  // direct-only Shape (Manual card hidden); null = legacy in-flight drafts,
  // which render today's four-card UI byte-identically.
  logicModel: "decider" | null;
  minGoalChars: number;
  productCount: number;
  identitySummary: string | null;
  suggestedGoal: string;
  detection: {
    dimension: string;
    rationale: string;
    groups: Array<{ key: string; name: string; count: number }>;
  };
  confirmed: {
    dimension: string;
    confirmed_category_ids: string[];
    detected_rationale: string;
  } | null;
  goal: { goal_text: string; struggle_text: string } | null;
  templateOptions: TemplateOption[];
  pickedOptionId: string | null;
  // ── Step 2 ──
  quizTypes: QuizType[];
  pickedTypeId: string | null;
  richTemplates: RichTemplateOption[];
  pickedTemplate: PickedTemplate | null;
  webResearchSummary: string | null;
  genError: string | null;
  genStalled: boolean;
  // FAST F3 — the detached generation jobs' REAL checkpoint (written at pass
  // boundaries); null = absent (old in-flight session) → timed-beat fallback.
  genProgress: "research" | "types" | "templates" | "questions" | "products" | null;
  // FLOW-1 — the goal-first flow marker + the product pre-pick's state. null
  // for every other flow; presence changes the recs surface (pre-pick banner,
  // Continue → flow1-confirm, no start pop-up).
  goalFirst: {
    prepick: "picking" | "ready" | "failed";
    error?: string;
    rationale?: string;
    question_length?: number;
  } | null;
  // FLOW-3 — the template-first pick marker (+ the picked card's name). null
  // until a card is picked on /studio/templates; presence changes the recs
  // surface (template banner, Continue → flow3-confirm, no start pop-up).
  templateFirst: { picked: "candidate" | "template"; name: string } | null;
  productGroups: Array<{ id: string; name: string; products: Array<{ id: string; title: string }> }>;
  collections: Array<{ collectionId: string; title: string }>;
  // PORT-10 — shop-saved templates first, then the global industry "starter"
  // templates (scope "starter", with a vertical category label).
  savedTemplates: Array<{
    id: string;
    name: string;
    template: RichTemplateOption;
    scope: "shop" | "starter";
    category: string | null;
  }>;
  // ── Recommendation Buckets (RB Step 1) ──
  catalog: {
    products: Array<{
      id: string;
      title: string;
      imageUrl: string | null;
      price: number | null;
      description: string | null;
      tagKeys: string[];
      collectionIds: string[];
    }>;
    tags: Array<{ key: string; label: string; count: number }>;
    collections: Array<{ key: string; label: string; count: number }>;
  };
  suggestion: BucketSuggestion;
  buckets: Array<{
    key: string;
    type: BucketType;
    name: string;
    count: number;
    thumbnailUrl: string | null;
  }>;
  activeTab: BucketType;
  bannerDismissed: boolean;
  // Step-1 spec §6 — "type:key" ids of selections the draft's questions/rules
  // already reference; removing one warns before orphaning Step-3 mappings.
  referencedKeys: string[];
  backHref: string;
  // Question Builder (the pre-config editing step) — emitted ONLY when
  // stage === "question_builder": the built draft + the builder's category /
  // productIndex shapes, so QuestionBuilderStage composes FlowRail + ContextPanel
  // over the SAME draftJson the main builder edits.
  questionBuilder: {
    doc: Quiz;
    categories: BuilderCategory[];
    productIndex: IndexedProduct[];
  } | null;
  // Rec Page on the BUILT draft — the current result-node rec settings. Present
  // only at stage "rec_page" once the quiz is built; RecPageStage edits the nodes
  // directly (via set-result-rec). Null → legacy draft → edit picked_template.
  recNodeDefaults: { max_products: number; oos_behavior: RecDefaults["oos_behavior"] } | null;
  // Recommendation step on the BUILT draft — the full doc + catalog shapes so
  // RecommendationStage mounts the per-bucket ResultSettingsPanel + RecPageDiagram.
  // Present only at stage "rec_page" with ≥1 result node; null → legacy draft
  // (RecPageStage edits picked_template instead).
  recPage: {
    doc: Quiz;
    categories: BuilderCategory[];
    productIndex: IndexedProduct[];
  } | null;
  // Design step (Drive 1_p1V) — the draft's current design tokens, so the Design
  // stage can show the selected vibe template + the "modified" indicator.
  designTokens: DesignTokens;
  designLinked: boolean;
  recPageDesign: DesignTokens | null;
  // DGN-1 — the shop's brand-derived token pack, offered as a "Your brand" card
  // in the Design stage. null when there's no usable brand design.
  brandDerivedTokens: DesignTokens | null;
}

export type ActionResult =
  | { intent: string; ok: boolean; error?: string }
  | { intent: "resync"; ok: boolean; error?: string };

export const XTYPE_LABEL: Record<string, string> = {
  product_match: "Product match",
  personality: "Personality",
  lead_capture: "Lead capture",
  survey: "Survey",
};

export const OOS_LABEL: Record<RecDefaults["oos_behavior"], string> = {
  show_with_badge: "Show + badge",
  hide: "Hide",
  notify_me: "Notify me",
  fallback: "Fallback",
};

// The funnel's visible step order — shared by the top-bar step pills AND the
// Step-N-of-M stepper inside each stage, so the "of N" count can't drift.
// FLOW-3 (funnel-reconfig) — Shape is RETIRED from the visible map: every flow
// resolves "what type of quiz" BEFORE the builder (the goal/template front
// doors), so the rail is the 4-step Recommendations → Questions → Results →
// Design. Drafts still parked at a shape-family stage (legacy in-flight + the
// transient typing/templating AI passes) fold FORWARD onto Questions — see
// visibleStageKey in Step1Funnel.tsx and app/lib/funnelStages.ts.
// Step-1 spec §1 — "bucket" is dead in merchant UI: Step 1 is "Recommendations"
// and the Results step keeps its canonical short label.
export const FUNNEL_STAGES: Array<{ key: string; label: string }> = [
  { key: "grouping", label: "Recommendations" },
  { key: "question_builder", label: "Questions" },
  { key: "rec_page", label: "Results" },
  { key: "design", label: "Design" },
];

// The shared write-a-goal form (the intercept modal's second screen + Shape's
// escape-link card). Prefilled with the store-derived suggestion so it's an
// approval, not a blank box; the merchant's own words always win.
export function GoalPromptBody({
  suggestedGoal,
  minGoalChars,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  suggestedGoal: string;
  minGoalChars: number;
  submitLabel: string;
  onSubmit: (goal: string) => void;
  onCancel: () => void;
}) {
  const [goal, setGoal] = useState(suggestedGoal);
  const met = goal.trim().length >= minGoalChars;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <textarea
        className="qz-input"
        rows={3}
        autoFocus
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        placeholder={'e.g. "Help shoppers find the right board for how and where they ride"'}
        style={{ resize: "vertical", fontSize: 13 }}
      />
      <div className="qz-row" style={{ gap: 10 }}>
        <button
          type="button"
          className="qz-btn qz-btn-accent qz-btn-sm"
          disabled={!met}
          onClick={() => onSubmit(goal.trim())}
        >
          {submitLabel}
        </button>
        <button type="button" className="qz-btn qz-btn-ghost qz-btn-sm" onClick={onCancel}>
          ← Back
        </button>
      </div>
      {!met ? (
        <span className="qz-dim" style={{ fontSize: 11.5 }}>
          Add a little more detail (at least {minGoalChars} characters).
        </span>
      ) : null}
    </div>
  );
}
