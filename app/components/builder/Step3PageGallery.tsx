import { StepPreview } from "../runtime/StepPreview";
import { QzBadge, QzBanner, QzButton } from "../qz";
import { SHARED_RESULT_KEY } from "../../lib/resultLayout";
import type { StepProps } from "./stepProps";

// Step 3 — "Snap or fully build". A gallery of result pages (one per bucket).
// Each shows on-template vs customized + product count. (Phase 1 enriches with
// the full per-page recommendation settings panel + skip/best-practice.)

export function Step3PageGallery({ doc, onCommit, productIndex, categories, goToStep }: StepProps) {
  const resultNodes = doc.nodes.filter((n) => n.type === "result");
  const catById = new Map(categories.map((c) => [c.id, c]));
  const shared = doc.result_layout_mode === "shared";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="qz-row qz-row-between" style={{ alignItems: "flex-end" }}>
        <div>
          <h2 className="qz-h1" style={{ margin: 0 }}>
            Your result pages
          </h2>
          <p className="qz-dim" style={{ marginTop: 6 }}>
            Snap each page to the template, or open the builder to fully customize. Sensible
            best-practice recommendation logic is already applied.
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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
          {resultNodes.map((node) => {
            if (node.type !== "result") return null;
            const cat = node.data.category_id ? catById.get(node.data.category_id) : undefined;
            const customized = Boolean(
              doc.node_layouts[node.id]?.length ||
                (shared
                  ? doc.design_overrides[node.id] && node.id !== SHARED_RESULT_KEY
                  : doc.design_overrides[node.id]),
            );
            return (
              <div key={node.id} className="qz-card" style={{ padding: 0, overflow: "hidden" }}>
                <div
                  style={{ height: 150, overflow: "hidden", background: "#FAFAFA", borderBottom: "1px solid #00000010" }}
                >
                  <div
                    style={{
                      width: 260 / 0.44,
                      transform: "scale(0.44)",
                      transformOrigin: "top left",
                      padding: 16,
                      pointerEvents: "none",
                    }}
                  >
                    <StepPreview doc={doc} node={node} productIndex={productIndex} />
                  </div>
                </div>
                <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                  <div className="qz-row qz-row-between" style={{ alignItems: "center" }}>
                    <strong style={{ fontSize: 14 }}>{node.data.headline}</strong>
                    {customized ? (
                      <QzBadge tone="warn">Customized</QzBadge>
                    ) : (
                      <QzBadge tone="ok">On template</QzBadge>
                    )}
                  </div>
                  <div className="qz-dim" style={{ fontSize: 12 }}>
                    {cat ? `${cat.name} · ${cat.productIds.length} products` : "Tag / collection based"}
                    {" · "}
                    {node.data.match_ladder.join(" → ")}
                  </div>
                  <div className="qz-row" style={{ gap: 6 }}>
                    <QzButton size="sm" variant="ghost" onClick={() => goToStep(4)}>
                      Open in builder
                    </QzButton>
                    {customized ? (
                      <QzButton
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          const { [node.id]: _drop, ...rest } = doc.design_overrides;
                          const layouts = { ...doc.node_layouts };
                          delete layouts[node.id];
                          onCommit({ ...doc, design_overrides: rest, node_layouts: layouts });
                        }}
                      >
                        Snap to template
                      </QzButton>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
