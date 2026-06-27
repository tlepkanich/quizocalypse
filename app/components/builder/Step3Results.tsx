import { useEffect, useMemo, useState } from "react";
import { QzBadge, QzBanner, QzButton, QzCard, QzPageHeader, QzSegmented, QzTooltip } from "../qz";
import { SHARED_RESULT_KEY } from "../../lib/resultLayout";
import { THEME_PRESETS } from "../../lib/themePresets";
import { resolveDesignTokens } from "../../lib/designTokens";
import { ReskinSwitcher } from "./preview/ReskinSwitcher";
import { ResultsFlowMap } from "./results/ResultsFlowMap";
import { ResultPageCard } from "./results/ResultPageCard";
import { ResultPageEditor, isResultCustomized } from "./results/ResultPageEditor";
import { resultPageFlowContext } from "./results/resultFlowContext";
import { DiscountCard } from "./DiscountCard";
import type { StepProps } from "./stepProps";

// Step 3 — "Results". A flow-aware, navigation-friendly workspace (matches the
// Step-4 polish): a QzPageHeader, a consolidated global toolbar (layout posture
// + theme + discount), a collapsible flow map showing how answers route to each
// page, then a master-detail body — a sticky rail of result-page cards (with
// per-card flow context) beside a focused editor (collapsible settings + a
// co-located framed live preview). Runs AFTER Questions (Step 2) so per-page
// conditional rules can reference real answers.
export function Step3Results(props: StepProps) {
  const { doc, onCommit, productIndex, categories, collections, ordered, goToStep } = props;
  const mode = doc.result_layout_mode;
  const resultNodes = doc.nodes.filter((n) => n.type === "result");

  const [selectedId, setSelectedId] = useState<string | null>(resultNodes[0]?.id ?? null);
  // Keep the selection valid as buckets/result nodes change (Step 1 edits).
  useEffect(() => {
    if (resultNodes.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    if (!selectedId || !resultNodes.some((n) => n.id === selectedId)) {
      setSelectedId(resultNodes[0]!.id);
    }
  }, [resultNodes, selectedId]);

  const selectedNode = selectedId ? resultNodes.find((n) => n.id === selectedId) ?? null : null;
  const flowCtx = useMemo(() => resultPageFlowContext(doc, ordered), [doc, ordered]);

  const choose = (next: "shared" | "custom") => {
    let nextDoc = { ...doc, result_layout_mode: next };
    // Seed the shared template layer on first "shared" pick so the cascade has
    // something to apply.
    if (next === "shared" && !doc.design_overrides[SHARED_RESULT_KEY]) {
      nextDoc = {
        ...nextDoc,
        design_overrides: { ...nextDoc.design_overrides, [SHARED_RESULT_KEY]: doc.design_tokens ?? {} },
      };
    }
    onCommit(nextDoc);
  };

  const applyTheme = (presetId: string) => {
    const preset = THEME_PRESETS.find((p) => p.id === presetId);
    if (preset) {
      onCommit({ ...doc, design_tokens: resolveDesignTokens(preset.tokens) as typeof doc.design_tokens });
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <QzPageHeader
        eyebrow="Results"
        title="Recommendations"
        subtitle="Tune what each outcome shows — source ladder, bound bucket, ranking, stock, and rewards — and see how shoppers reach each page."
        actions={
          <QzButton size="sm" variant="ghost" onClick={() => goToStep(2)}>
            Edit question flow →
          </QzButton>
        }
      />

      {/* Global controls: layout posture + theme */}
      <QzCard style={{ padding: 16 }}>
        <div
          className="qz-row qz-row-between"
          style={{ gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}
        >
          <div>
            <div className="qz-row" style={{ gap: 6, alignItems: "center", marginBottom: 6 }}>
              <span className="qz-label">Layout</span>
              <QzTooltip
                content={
                  <span>
                    <strong>Shared</strong> = every result page looks identical and just swaps
                    products. <strong>Custom</strong> = each page is independently editable.
                  </span>
                }
              >
                <span
                  className="qz-dim"
                  style={{
                    fontSize: 11,
                    cursor: "help",
                    border: "1px solid var(--qz-rule)",
                    borderRadius: 999,
                    width: 15,
                    height: 15,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    lineHeight: 1,
                  }}
                >
                  ?
                </span>
              </QzTooltip>
            </div>
            <QzSegmented<"shared" | "custom">
              ariaLabel="Result layout"
              value={mode}
              onChange={choose}
              options={[
                { value: "shared", label: "Shared template" },
                { value: "custom", label: "Custom per page" },
              ]}
            />
          </div>
          <div>
            <div className="qz-label" style={{ marginBottom: 6 }}>
              Theme
            </div>
            <ReskinSwitcher value={null} onSelect={applyTheme} />
          </div>
        </div>
      </QzCard>

      <DiscountCard doc={doc} onCommit={onCommit} collections={collections} />

      {resultNodes.length === 0 ? (
        <QzBanner tone="warn" title="No result pages yet">
          Group products into buckets in Step 1 to create result pages.
        </QzBanner>
      ) : (
        <>
          <ResultsFlowMap
            doc={doc}
            ordered={ordered}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />

          <div className="qz-results-grid">
            <div className="qz-results-rail">
              {resultNodes.map((node) => {
                if (node.type !== "result") return null;
                const customized = isResultCustomized(doc, node.id);
                return (
                  <ResultPageCard
                    key={node.id}
                    node={node}
                    doc={doc}
                    productIndex={productIndex}
                    categories={categories}
                    active={node.id === selectedId}
                    onClick={() => setSelectedId(node.id)}
                    layout="rail"
                    flow={flowCtx.get(node.id)}
                    headerBadge={
                      customized ? (
                        <QzBadge tone="warn">Customized</QzBadge>
                      ) : (
                        <QzBadge tone="ok">On template</QzBadge>
                      )
                    }
                  />
                );
              })}
            </div>

            <div style={{ minWidth: 0 }}>
              {selectedNode && selectedNode.type === "result" ? (
                <ResultPageEditor
                  doc={doc}
                  node={selectedNode}
                  onCommit={onCommit}
                  productIndex={productIndex}
                  categories={categories}
                  collections={collections}
                  goToStep={goToStep}
                />
              ) : (
                <QzBanner tone="default" title="Select a result page">
                  Choose a page on the left to edit its recommendation settings.
                </QzBanner>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
