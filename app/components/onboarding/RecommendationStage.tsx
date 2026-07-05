import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { useFetcher } from "@remix-run/react";
import type { Quiz, QuizNode } from "../../lib/quizSchema";
import { stepNumber, TOTAL_STEPS } from "../../lib/funnelStages";
import type { IndexedProduct } from "../../lib/recommendationEngine";
import type { BuilderCategory, BuilderCollection } from "../builder/stepProps";
import { useQuizDraft } from "../studio/useQuizDraft";
import { ResultSettingsPanel } from "../builder/ResultSettingsPanel";
import { RecPageDiagram } from "../studio/RecPageDiagram";
import { RecPagePreview } from "./RecPagePreview";
import { RecPageV2Panel } from "./RecPageV2Panel";
import { RecPageV2Preview } from "./RecPageV2Preview";
import { QzCard } from "../qz";

// ════════════════════════════════════════════════════════════════════════════
// RecommendationStage — the funnel's Recommendation step (per the Drive spec).
// The quiz is ALREADY built (the early question build ran after Shape), so this
// mounts the SAME per-bucket config surface the main builder uses —
// ResultSettingsPanel (Section Structure · Product Display · Why copy · Discount ·
// OOS · Global Fallback) + the live RecPageDiagram — over the funnel-held draft,
// with a per-bucket switcher across the result nodes. Edits autosave through
// useQuizDraft's JSON-PUT (the funnel route's stage-preserving autosave branch),
// exactly like QuestionBuilderStage. Client-only (wrapped in ClientOnly by the
// caller) so the editor never SSRs.
// ════════════════════════════════════════════════════════════════════════════

type ResultNode = Extract<QuizNode, { type: "result" }>;

const bucketPill = (active: boolean): CSSProperties => ({
  padding: "5px 12px",
  borderRadius: 999,
  border: `1px solid ${active ? "var(--qz-accent)" : "var(--qz-rule)"}`,
  background: active ? "var(--qz-accent)" : "var(--qz-paper)",
  color: active ? "#fff" : "var(--qz-ink-2)",
  fontSize: 12,
  fontWeight: active ? 600 : 400,
  cursor: "pointer",
});

export function RecommendationStage({
  quizId,
  initialDoc,
  categories,
  productIndex,
  collections,
  fetcher,
  pendingIntent,
}: {
  quizId: string;
  initialDoc: Quiz;
  categories: BuilderCategory[];
  productIndex: IndexedProduct[];
  collections: BuilderCollection[];
  fetcher: ReturnType<typeof useFetcher>;
  pendingIntent: string | null;
}) {
  const { doc, commit, isSaving, savedAt } = useQuizDraft(initialDoc);

  // LOGIC v2 — decider docs get the target-based Step-4 surface (ONE global
  // config + sparse per-target overrides, rec-page-spec-V2 §2/§3) instead of
  // the legacy per-result-node panel. Legacy docs render exactly as before.
  const deciderMode = doc.logic_model === "decider";
  const [targetId, setTargetId] = useState<string | null>(null);

  const resultNodes = useMemo(
    () => doc.nodes.filter((n): n is ResultNode => n.type === "result"),
    [doc],
  );
  const [selectedId, setSelectedId] = useState<string | null>(() => resultNodes[0]?.id ?? null);
  const selected = resultNodes.find((n) => n.id === selectedId) ?? resultNodes[0] ?? null;

  // Right pane: live shopper preview (default, matches the published rec page)
  // or the schematic "page map" (pool counts + feature flags). Left config panel
  // collapses so the preview can take the full real estate.
  const [viewMode, setViewMode] = useState<"preview" | "map">("preview");
  const [leftOpen, setLeftOpen] = useState(true);

  const bucketName = (node: ResultNode) =>
    (node.data.category_id && categories.find((c) => c.id === node.data.category_id)?.name) ||
    node.data.headline ||
    "Result";

  const navigating = pendingIntent === "to-design" || pendingIntent === "to-question-builder";

  return (
    <div className="qz-qb-stage">
      <header className="qz-row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <div className="qz-label" style={{ fontSize: 11, marginBottom: 2 }}>
            Step {stepNumber("rec_page")} of {TOTAL_STEPS} — Results page
          </div>
          <h2 style={{ margin: 0, fontSize: 20 }}>Tune your recommendations</h2>
          <p className="qz-dim" style={{ margin: "4px 0 0", fontSize: 13 }}>
            For each recommendation, set how results show — sections, sort, sub-filters, “why we recommend”
            copy, discount, and out-of-stock behaviour. The live preview on the right updates as you
            edit. Collapse the settings to see the full page.
          </p>
        </div>
        <span className="qz-save-status" aria-live="polite">
          {isSaving ? (
            <span className="qz-save-chip is-saving">
              <span className="qz-save-dot" aria-hidden /> Saving…
            </span>
          ) : savedAt ? (
            <span key={savedAt} className="qz-save-chip is-saved">
              <span aria-hidden>✓</span> Saved
            </span>
          ) : null}
        </span>
      </header>

      {deciderMode ? (
        // LOGIC v2: target selector + global/override config + the §11.1
        // live preview (both target shapes, real engine, no runtime needed).
        <div className={`qz-qb-split${leftOpen ? "" : " is-collapsed"}`}>
          <div className="qz-qb-config">
            <QzCard style={{ padding: 14 }}>
              <RecPageV2Panel
                doc={doc}
                quizId={quizId}
                categories={categories}
                collections={collections}
                onCommit={commit}
                selectedTargetId={targetId}
                onSelectTarget={setTargetId}
              />
            </QzCard>
          </div>
          <div className="qz-qb-preview">
            <button
              type="button"
              className="qz-btn qz-btn-ghost qz-btn-sm"
              aria-expanded={leftOpen}
              aria-label={leftOpen ? "Collapse settings" : "Show settings"}
              style={{ marginBottom: 10 }}
              onClick={() => setLeftOpen((v) => !v)}
            >
              {leftOpen ? "◀ Hide settings" : "▶ Show settings"}
            </button>
            <QzCard style={{ padding: 18 }}>
              <RecPageV2Preview
                doc={doc}
                categories={categories}
                productIndex={productIndex}
                targetId={targetId}
              />
            </QzCard>
          </div>
        </div>
      ) : resultNodes.length === 0 ? (
        <QzCard style={{ padding: 16 }}>
          <p className="qz-dim" style={{ margin: 0 }}>
            No recommendations yet — pick your recommendations in Step 1 first.
          </p>
        </QzCard>
      ) : (
        <>
          {resultNodes.length > 1 ? (
            <div
              className="qz-row qz-gap-4"
              role="group"
              aria-label="Pick a recommendation"
              style={{ flexWrap: "wrap", marginBottom: 12 }}
            >
              {resultNodes.map((node) => (
                <button
                  key={node.id}
                  type="button"
                  aria-pressed={node.id === selected?.id}
                  style={bucketPill(node.id === selected?.id)}
                  onClick={() => setSelectedId(node.id)}
                >
                  {bucketName(node)}
                </button>
              ))}
            </div>
          ) : null}

          {selected ? (
            <div className={`qz-qb-split${leftOpen ? "" : " is-collapsed"}`}>
              <div className="qz-qb-config">
                <QzCard style={{ padding: 14 }}>
                  <ResultSettingsPanel
                    doc={doc}
                    node={selected}
                    categories={categories}
                    collections={collections}
                    productIndex={productIndex}
                    onCommit={commit}
                  />
                </QzCard>
              </div>

              <div className="qz-qb-preview">
                <div
                  className="qz-row qz-row-between"
                  style={{ alignItems: "center", gap: 8, marginBottom: 10 }}
                >
                  <button
                    type="button"
                    className="qz-btn qz-btn-ghost qz-btn-sm"
                    aria-expanded={leftOpen}
                    aria-label={leftOpen ? "Collapse settings" : "Show settings"}
                    onClick={() => setLeftOpen((v) => !v)}
                  >
                    {leftOpen ? "◀ Hide settings" : "▶ Show settings"}
                  </button>
                  <div
                    className="qz-row qz-gap-4"
                    role="group"
                    aria-label="Preview mode"
                    style={{ flexWrap: "wrap" }}
                  >
                    <button
                      type="button"
                      aria-pressed={viewMode === "preview"}
                      style={bucketPill(viewMode === "preview")}
                      onClick={() => setViewMode("preview")}
                    >
                      Live preview
                    </button>
                    <button
                      type="button"
                      aria-pressed={viewMode === "map"}
                      style={bucketPill(viewMode === "map")}
                      onClick={() => setViewMode("map")}
                    >
                      Page map
                    </button>
                  </div>
                </div>

                {viewMode === "preview" ? (
                  <RecPagePreview
                    doc={doc}
                    node={selected}
                    productIndex={productIndex}
                    categories={categories}
                    quizId={quizId}
                  />
                ) : (
                  <RecPageDiagram
                    doc={doc}
                    node={selected}
                    productIndex={productIndex}
                    categories={categories}
                  />
                )}
              </div>
            </div>
          ) : null}
        </>
      )}

      <div className="qz-row" style={{ gap: 8, marginTop: 16 }}>
        <button
          type="button"
          className="qz-btn qz-btn-ghost"
          disabled={navigating}
          onClick={() => fetcher.submit({ intent: "to-question-builder" }, { method: "post" })}
        >
          ← Back
        </button>
        <button
          type="button"
          className="qz-btn qz-btn-accent"
          disabled={navigating}
          onClick={() => fetcher.submit({ intent: "to-design" }, { method: "post" })}
        >
          Continue →
        </button>
      </div>
    </div>
  );
}
