import type { ReactNode } from "react";
import { StepPreview } from "../../runtime/StepPreview";
import { QzBadge } from "../../qz";
import type { Quiz as QuizDoc } from "../../../lib/quizSchema";
import type { IndexedProduct } from "../../../lib/recommendationEngine";
import type { BuilderCategory } from "../stepProps";
import type { ResultFlowContext } from "./resultFlowContext";

// Shared result-page card — the single source of truth for "a recommendation
// page tile". Used by the Optimize view's RecommendationMap (layout="grid") and
// Step 3's master-detail rail (layout="rail", with flow context). Renders a
// scaled live StepPreview, headline, bound bucket + count, match-ladder chips,
// multi-stage sub-lines, and — when `flow` is supplied — how the page is
// reached (answers / tags) plus an A/B-variant badge.

type ResultNode = Extract<QuizDoc["nodes"][number], { type: "result" }>;

const THUMB = {
  rail: { height: 120, pad: 16, base: 280 },
  grid: { height: 116, pad: 14, base: 260 },
} as const;
const SCALE = 0.42;

export function ResultPageCard({
  node,
  doc,
  productIndex,
  categories,
  active,
  onClick,
  layout = "grid",
  flow,
  headerBadge,
  footerBadge,
}: {
  node: ResultNode;
  doc: QuizDoc;
  productIndex: IndexedProduct[];
  categories: BuilderCategory[];
  active: boolean;
  onClick: () => void;
  layout?: "rail" | "grid";
  flow?: ResultFlowContext;
  // Top-right badge (e.g. Step 3's Customized / On-template status).
  headerBadge?: ReactNode;
  // Bottom badge (e.g. RecommendationMap's "Mapped in table →").
  footerBadge?: ReactNode;
}) {
  const cat = node.data.category_id
    ? categories.find((c) => c.id === node.data.category_id)
    : undefined;
  const stages = node.data.stages ?? [];
  const t = THUMB[layout];

  return (
    <button
      type="button"
      onClick={onClick}
      className="qz-card"
      style={{
        padding: 0,
        overflow: "hidden",
        textAlign: "left",
        cursor: "pointer",
        width: layout === "rail" ? "100%" : undefined,
        border: active ? "2px solid var(--qz-accent)" : "1px solid var(--qz-rule)",
        boxShadow: active ? "var(--qz-shadow-md)" : "var(--qz-shadow-sm)",
      }}
    >
      <div
        style={{
          height: t.height,
          overflow: "hidden",
          background: "#FAFAFA",
          borderBottom: "1px solid var(--qz-rule)",
        }}
      >
        <div
          style={{
            width: t.base / SCALE,
            transform: `scale(${SCALE})`,
            transformOrigin: "top left",
            padding: t.pad,
            pointerEvents: "none",
          }}
        >
          <StepPreview doc={doc} node={node} productIndex={productIndex} categories={categories} />
        </div>
      </div>

      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
        {headerBadge ? (
          <div className="qz-row qz-row-between" style={{ alignItems: "center", gap: 8 }}>
            <strong style={{ fontSize: 14 }}>{node.data.headline}</strong>
            {headerBadge}
          </div>
        ) : (
          <strong style={{ fontSize: 14 }}>{node.data.headline}</strong>
        )}

        <div className="qz-dim" style={{ fontSize: 12 }}>
          {cat ? `${cat.name} · ${cat.productIds.length} products` : "Tag / collection based"}
        </div>

        <div className="qz-row" style={{ gap: 4, flexWrap: "wrap" }}>
          {node.data.match_ladder.map((s) => (
            <span
              key={s}
              className="qz-mono"
              style={{
                fontSize: 10.5,
                border: "1px solid var(--qz-rule)",
                borderRadius: 999,
                padding: "1px 7px",
              }}
            >
              {s}
            </span>
          ))}
        </div>

        {stages.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 2 }}>
            <span className="qz-label" style={{ fontSize: 10 }}>
              {stages.length} stages
            </span>
            {stages.map((st, i) => (
              <div
                key={st.id}
                className="qz-dim"
                style={{ fontSize: 11, display: "flex", gap: 6, alignItems: "baseline" }}
              >
                <span className="qz-mono" style={{ opacity: 0.6 }}>
                  {i + 1}.
                </span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {st.headline || "Section"} · {st.match_ladder.join(" → ")}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {flow ? <FlowBlock flow={flow} /> : null}

        {footerBadge ?? null}
      </div>
    </button>
  );
}

// Compact "how is this page reached" block: an A/B variant badge (if behind an
// ab_split branch) + up to two reached-from lines (the answers / tags / default
// path), and an unreachable warning when the page is orphaned.
function FlowBlock({ flow }: { flow: ResultFlowContext }) {
  const hasFlow = flow.abVariant || flow.reachedFrom.length > 0 || !flow.reachable;
  if (!hasFlow) return null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        marginTop: 2,
        paddingTop: 8,
        borderTop: "1px dashed var(--qz-rule)",
      }}
    >
      {flow.abVariant ? (
        <QzBadge tone="draft">
          A/B · {flow.abVariant.slotLabel} · {flow.abVariant.weightPct}%
        </QzBadge>
      ) : null}

      {flow.reachedFrom.slice(0, 2).map((r, i) => (
        <div
          key={i}
          className="qz-dim"
          style={{ fontSize: 11, display: "flex", gap: 5, alignItems: "baseline", minWidth: 0 }}
        >
          <span style={{ opacity: 0.55, flex: "0 0 auto" }}>↳</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {r.kind === "default"
              ? "Everyone else"
              : r.answerLabels.length > 0
                ? r.answerLabels.join(", ")
                : r.questionLabel}
            {(r.kind === "tag" || r.kind === "answer") && r.answerLabels.length > 0 ? (
              <span style={{ opacity: 0.55 }}> · {r.questionLabel}</span>
            ) : null}
          </span>
        </div>
      ))}

      {flow.reachedFrom.length > 2 ? (
        <span className="qz-dim" style={{ fontSize: 10.5 }}>
          +{flow.reachedFrom.length - 2} more path{flow.reachedFrom.length - 2 > 1 ? "s" : ""}
        </span>
      ) : null}

      {!flow.reachable ? <QzBadge tone="warn">Unreachable</QzBadge> : null}
    </div>
  );
}
