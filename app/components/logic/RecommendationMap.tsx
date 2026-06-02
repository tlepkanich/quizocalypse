import { StepPreview } from "../runtime/StepPreview";
import { QzBadge, QzButton } from "../qz";
import type { Quiz as QuizDoc } from "../../lib/quizSchema";
import type { IndexedProduct } from "../../lib/recommendationEngine";
import type { BuilderCategory } from "../builder/stepProps";
import { findAbBranches, type FunnelCounts } from "../../lib/abAnalytics";
import { AbTestCard, type SlotTarget } from "./AbTestCard";

// FOCUS #2, HALF 1 — a Klaviyo-style visualization of the recommendation pages
// and their variations: a scaled live preview per result page (showing its
// bucket's real products), its bound bucket + match ladder, multi-stage stages,
// and an A/B-test section for every ab_split branch (editable split + analytics
// on both variants). Selecting a page highlights its column in the table half.

type BranchNode = Extract<QuizDoc["nodes"][number], { type: "branch" }>;
type ResultNode = Extract<QuizDoc["nodes"][number], { type: "result" }>;

function shortLabel(node: QuizDoc["nodes"][number]): string {
  switch (node.type) {
    case "result":
      return node.data.headline || "Result";
    case "question":
      return node.data.text || "Question";
    case "intro":
      return node.data.headline || "Intro";
    case "end":
      return node.data.headline || "End";
    default:
      return node.type.replace(/_/g, " ");
  }
}

function slotTargetsFor(doc: QuizDoc, branch: BranchNode): Record<string, SlotTarget> {
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const out: Record<string, SlotTarget> = {};
  for (const slot of branch.data.slots) {
    const edge = doc.edges.find(
      (e) => e.source === branch.id && e.source_handle === slot.id,
    );
    const target = edge ? byId.get(edge.target) : undefined;
    out[slot.id] = {
      label: target ? shortLabel(target) : "Not wired",
      nodeId: target?.id ?? null,
    };
  }
  return out;
}

export function RecommendationMap({
  doc,
  productIndex,
  categories,
  abAnalytics,
  selectedNodeId,
  onSelectNode,
  onSetWeight,
  onConvertToAb,
}: {
  doc: QuizDoc;
  productIndex: IndexedProduct[];
  categories: BuilderCategory[];
  abAnalytics: Record<string, Record<string, FunnelCounts>>;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onSetWeight: (branchId: string, slotId: string, weight: number) => void;
  onConvertToAb: (branchId: string) => void;
}) {
  const catById = new Map(categories.map((c) => [c.id, c]));
  const resultNodes = doc.nodes.filter((n): n is ResultNode => n.type === "result");
  const abBranches = findAbBranches(doc);
  const rulesBranches = doc.nodes.filter(
    (n): n is BranchNode => n.type === "branch" && n.data.mode === "rules",
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
      {/* ── A/B tests ─────────────────────────────────────────────────── */}
      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="qz-label">A/B tests</div>
        {abBranches.length === 0 && rulesBranches.length === 0 ? (
          <div className="qz-dim" style={{ fontSize: 12.5 }}>
            Add a Branch step in the Page builder, then split its traffic here to A/B test flows.
          </div>
        ) : null}
        {abBranches.map((branch) => (
          <AbTestCard
            key={branch.id}
            branch={branch}
            funnel={abAnalytics[branch.id]}
            slotTargets={slotTargetsFor(doc, branch)}
            onSetWeight={(slotId, weight) => onSetWeight(branch.id, slotId, weight)}
          />
        ))}
        {rulesBranches.map((branch) => (
          <div
            key={branch.id}
            className="qz-card"
            style={{ padding: 12 }}
          >
            <div className="qz-row qz-row-between" style={{ alignItems: "center", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <strong style={{ fontSize: 13 }}>{branch.data.label || "Branch"}</strong>
                <div className="qz-dim" style={{ fontSize: 11.5 }}>
                  Rules-based routing · {branch.data.slots.length} paths
                </div>
              </div>
              <QzButton size="sm" variant="ghost" onClick={() => onConvertToAb(branch.id)}>
                Make A/B test
              </QzButton>
            </div>
          </div>
        ))}
      </section>

      {/* ── Recommendation pages ──────────────────────────────────────── */}
      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="qz-label">Recommendation pages</div>
        {resultNodes.length === 0 ? (
          <div className="qz-dim" style={{ fontSize: 12.5 }}>
            No result pages yet — group products into buckets in Step 1.
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))",
              gap: 14,
            }}
          >
            {resultNodes.map((node) => {
              const cat = node.data.category_id ? catById.get(node.data.category_id) : undefined;
              const active = node.id === selectedNodeId;
              const stages = node.data.stages ?? [];
              return (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => onSelectNode(node.id)}
                  className="qz-card"
                  style={{
                    padding: 0,
                    overflow: "hidden",
                    textAlign: "left",
                    cursor: "pointer",
                    border: active ? "2px solid var(--qz-accent)" : "1px solid var(--qz-rule)",
                    boxShadow: active ? "var(--qz-shadow-md)" : "var(--qz-shadow-sm)",
                  }}
                >
                  <div
                    style={{
                      height: 116,
                      overflow: "hidden",
                      background: "#FAFAFA",
                      borderBottom: "1px solid var(--qz-rule)",
                    }}
                  >
                    <div
                      style={{
                        width: 260 / 0.42,
                        transform: "scale(0.42)",
                        transformOrigin: "top left",
                        padding: 14,
                        pointerEvents: "none",
                      }}
                    >
                      <StepPreview doc={doc} node={node} productIndex={productIndex} categories={categories} />
                    </div>
                  </div>
                  <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                    <strong style={{ fontSize: 14 }}>{node.data.headline}</strong>
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
                            style={{
                              fontSize: 11,
                              display: "flex",
                              gap: 6,
                              alignItems: "baseline",
                            }}
                          >
                            <span className="qz-mono" style={{ opacity: 0.6 }}>{i + 1}.</span>
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {st.headline || "Section"} · {st.match_ladder.join(" → ")}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {active ? <QzBadge tone="ok">Mapped in table →</QzBadge> : null}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
