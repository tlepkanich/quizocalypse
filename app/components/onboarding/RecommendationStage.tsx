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

  const resultNodes = useMemo(
    () => doc.nodes.filter((n): n is ResultNode => n.type === "result"),
    [doc],
  );
  const [selectedId, setSelectedId] = useState<string | null>(() => resultNodes[0]?.id ?? null);
  const selected = resultNodes.find((n) => n.id === selectedId) ?? resultNodes[0] ?? null;

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
            Step {stepNumber("rec_page")} of {TOTAL_STEPS} — Recommendation
          </div>
          <h2 style={{ margin: 0, fontSize: 20 }}>Tune your recommendations</h2>
          <p className="qz-dim" style={{ margin: "4px 0 0", fontSize: 13 }}>
            For each bucket, set how results show — sections, sort, sub-filters, “why we recommend”
            copy, discount, and out-of-stock behaviour. The page map on the right updates live.
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

      {resultNodes.length === 0 ? (
        <QzCard style={{ padding: 16 }}>
          <p className="qz-dim" style={{ margin: 0 }}>
            No recommendations yet — add product buckets first.
          </p>
        </QzCard>
      ) : (
        <>
          {resultNodes.length > 1 ? (
            <div
              className="qz-row qz-gap-4"
              role="group"
              aria-label="Pick a bucket"
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
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) minmax(0, 320px)",
                gap: 16,
                alignItems: "start",
              }}
            >
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
              <RecPageDiagram
                doc={doc}
                node={selected}
                productIndex={productIndex}
                categories={categories}
              />
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
