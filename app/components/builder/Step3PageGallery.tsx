import { useEffect, useState } from "react";
import { StepPreview } from "../runtime/StepPreview";
import { QzBadge, QzBanner, QzButton } from "../qz";
import { SHARED_RESULT_KEY } from "../../lib/resultLayout";
import { ResultSettingsPanel } from "./ResultSettingsPanel";
import type { StepProps } from "./stepProps";

// Step 3 — "Recommendations page logic SETTINGS". A two-pane workspace: a
// gallery of result pages (one card per bucket) on the left, and the selected
// page's per-page recommendation settings + a live StepPreview on the right.
// "Skip — use best-practice logic" jumps to Step 4; defaults are already
// best-practice. On-template vs Customized badges are preserved.

function isCustomized(
  doc: StepProps["doc"],
  nodeId: string,
  shared: boolean,
): boolean {
  return Boolean(
    doc.node_layouts[nodeId]?.length ||
      (shared
        ? doc.design_overrides[nodeId] && nodeId !== SHARED_RESULT_KEY
        : doc.design_overrides[nodeId]),
  );
}

export function Step3PageGallery({
  doc,
  onCommit,
  productIndex,
  categories,
  collections,
  goToStep,
}: StepProps) {
  const resultNodes = doc.nodes.filter((n) => n.type === "result");
  const catById = new Map(categories.map((c) => [c.id, c]));
  const shared = doc.result_layout_mode === "shared";

  const [selectedId, setSelectedId] = useState<string | null>(
    resultNodes[0]?.id ?? null,
  );

  // Keep the selection valid as buckets/result nodes change (e.g. Step 1 edits
  // that add or remove pages). Fall back to the first available page.
  useEffect(() => {
    if (resultNodes.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    if (!selectedId || !resultNodes.some((n) => n.id === selectedId)) {
      setSelectedId(resultNodes[0]!.id);
    }
  }, [resultNodes, selectedId]);

  const selectedNode = selectedId
    ? resultNodes.find((n) => n.id === selectedId) ?? null
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="qz-row qz-row-between" style={{ alignItems: "flex-end" }}>
        <div>
          <h2 className="qz-h1" style={{ margin: 0 }}>
            Recommendations page logic
          </h2>
          <p className="qz-dim" style={{ marginTop: 6 }}>
            Pick a result page to tune how it picks products — source ladder,
            bound bucket, ranking, stock, and pricing. Sensible best-practice
            defaults are already applied.
          </p>
        </div>
        <QzButton size="sm" variant="ghost" onClick={() => goToStep(4)}>
          Skip — use best-practice logic →
        </QzButton>
      </div>

      {resultNodes.length === 0 ? (
        <QzBanner tone="warn" title="No result pages yet">
          Group products into buckets in Step 1 to create result pages.
        </QzBanner>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(240px, 320px) 1fr",
            gap: 20,
            alignItems: "start",
          }}
        >
          {/* ── Gallery (left) ─────────────────────────────────────────── */}
          <div className="qz-col qz-gap-12">
            {resultNodes.map((node) => {
              if (node.type !== "result") return null;
              const cat = node.data.category_id
                ? catById.get(node.data.category_id)
                : undefined;
              const customized = isCustomized(doc, node.id, shared);
              const active = node.id === selectedId;
              return (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => setSelectedId(node.id)}
                  className="qz-card"
                  style={{
                    padding: 0,
                    overflow: "hidden",
                    textAlign: "left",
                    cursor: "pointer",
                    border: active
                      ? "2px solid var(--qz-accent, #2a6df4)"
                      : "1px solid #00000014",
                  }}
                >
                  <div
                    style={{
                      height: 120,
                      overflow: "hidden",
                      background: "#FAFAFA",
                      borderBottom: "1px solid #00000010",
                    }}
                  >
                    <div
                      style={{
                        width: 280 / 0.42,
                        transform: "scale(0.42)",
                        transformOrigin: "top left",
                        padding: 16,
                        pointerEvents: "none",
                      }}
                    >
                      <StepPreview doc={doc} node={node} productIndex={productIndex} />
                    </div>
                  </div>
                  <div
                    style={{
                      padding: 12,
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    <div
                      className="qz-row qz-row-between"
                      style={{ alignItems: "center", gap: 8 }}
                    >
                      <strong style={{ fontSize: 14 }}>{node.data.headline}</strong>
                      {customized ? (
                        <QzBadge tone="warn">Customized</QzBadge>
                      ) : (
                        <QzBadge tone="ok">On template</QzBadge>
                      )}
                    </div>
                    <div className="qz-dim" style={{ fontSize: 12 }}>
                      {cat
                        ? `${cat.name} · ${cat.productIds.length} products`
                        : "Tag / collection based"}
                    </div>
                    <div
                      className="qz-mono qz-dim"
                      style={{ fontSize: 11, lineHeight: 1.4 }}
                    >
                      {node.data.match_ladder.join(" → ")}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* ── Settings + preview (right) ─────────────────────────────── */}
          <div className="qz-col qz-gap-16" style={{ minWidth: 0 }}>
            {selectedNode && selectedNode.type === "result" ? (
              <>
                <div
                  className="qz-row qz-row-between"
                  style={{ alignItems: "center", gap: 12 }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>
                      {selectedNode.data.headline}
                    </div>
                    <div className="qz-dim" style={{ fontSize: 12 }}>
                      {isCustomized(doc, selectedNode.id, shared)
                        ? "Customized layout"
                        : "On template"}
                    </div>
                  </div>
                  <div className="qz-row qz-gap-8">
                    {isCustomized(doc, selectedNode.id, shared) ? (
                      <QzButton
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          const { [selectedNode.id]: _drop, ...rest } =
                            doc.design_overrides;
                          const layouts = { ...doc.node_layouts };
                          delete layouts[selectedNode.id];
                          onCommit({
                            ...doc,
                            design_overrides: rest,
                            node_layouts: layouts,
                          });
                        }}
                      >
                        Snap to template
                      </QzButton>
                    ) : null}
                    <QzButton size="sm" variant="ghost" onClick={() => goToStep(4)}>
                      Open in builder →
                    </QzButton>
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 320px)",
                    gap: 16,
                    alignItems: "start",
                  }}
                >
                  <div className="qz-card" style={{ padding: 16 }}>
                    <ResultSettingsPanel
                      doc={doc}
                      node={selectedNode}
                      categories={categories}
                      collections={collections}
                      onCommit={onCommit}
                    />
                  </div>

                  <div
                    className="qz-card"
                    style={{
                      padding: 0,
                      overflow: "hidden",
                      position: "sticky",
                      top: 12,
                    }}
                  >
                    <div
                      className="qz-label"
                      style={{
                        padding: "10px 12px",
                        borderBottom: "1px solid #00000010",
                      }}
                    >
                      Live preview
                    </div>
                    <div style={{ padding: 16, background: "#FAFAFA" }}>
                      <StepPreview
                        doc={doc}
                        node={selectedNode}
                        productIndex={productIndex}
                      />
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <QzBanner tone="default" title="Select a result page">
                Choose a page on the left to edit its recommendation settings.
              </QzBanner>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
