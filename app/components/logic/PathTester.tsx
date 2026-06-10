import { useMemo, useState } from "react";
import type { Quiz } from "../../lib/quizSchema";
import { tracePath } from "../../lib/routeTrace";
import {
  recommendForResult,
  type IndexedProduct,
} from "../../lib/recommendationEngine";
import { bakeResultPages } from "../../lib/quizPublish";
import type { BuilderCategory } from "../builder/stepProps";

// "Try a path" (editor revamp P4) — the missing end-to-end routing answer:
// pick an answer per question and SEE which result page lands and which
// products it recommends, computed by the same resolveNextStep +
// recommendForResult the storefront uses. The question list adapts to the
// traced path (branch-skipped questions disappear), so what you see is exactly
// one shopper journey.

type QuizDoc = Quiz;

export function PathTester({
  doc,
  productIndex,
  categories,
}: {
  doc: QuizDoc;
  productIndex: IndexedProduct[];
  categories: BuilderCategory[];
}) {
  const [selections, setSelections] = useState<Record<string, string>>({});

  // Drafts lack the publish-time category_product_ids_map — bake it from the
  // live buckets exactly like Step5Preview does, so recommendations are real.
  const previewDoc = useMemo(() => {
    const byId = new Map(categories.map((c) => [c.id, c.productIds] as const));
    return { ...doc, results_pages: bakeResultPages(doc, byId) } as QuizDoc;
  }, [doc, categories]);

  const trace = useMemo(() => tracePath(previewDoc, selections), [previewDoc, selections]);
  const questionSteps = trace.steps.filter((s) => s.type === "question");
  const landing = trace.resultNodeId
    ? previewDoc.nodes.find((n) => n.id === trace.resultNodeId)
    : null;

  const recs = useMemo(() => {
    if (!trace.resultNodeId) return [];
    const selectedAnswerIds = trace.steps
      .map((s) => s.pickedAnswerId)
      .filter((x): x is string => !!x);
    try {
      return recommendForResult(
        {
          quiz: previewDoc,
          productIndex,
          selectedAnswerIds,
          resultNodeId: trace.resultNodeId,
        },
        4,
      );
    } catch {
      return [];
    }
  }, [previewDoc, productIndex, trace]);

  return (
    <section
      className="qz-card"
      style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}
    >
      <div>
        <div className="qz-label">Try a path</div>
        <p className="qz-dim" style={{ fontSize: 12, margin: "4px 0 0" }}>
          Pick answers to see exactly where a shopper lands and what gets recommended.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {questionSteps.map((step, i) => {
          const node = previewDoc.nodes.find((n) => n.id === step.nodeId);
          if (!node || node.type !== "question") return null;
          return (
            <label
              key={step.nodeId}
              className="qz-row"
              style={{ gap: 8, alignItems: "center", fontSize: 12.5 }}
            >
              <span
                className="qz-dim"
                style={{ flex: "0 0 44%", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                title={node.data.text}
              >
                {i + 1}. {node.data.text}
              </span>
              <select
                value={selections[step.nodeId] ?? node.data.answers[0]?.id ?? ""}
                onChange={(e) =>
                  setSelections((prev) => ({ ...prev, [step.nodeId]: e.target.value }))
                }
                style={{
                  flex: 1,
                  font: "inherit",
                  fontSize: 12.5,
                  padding: "5px 8px",
                  borderRadius: 6,
                  border: "1px solid #00000022",
                  background: "#fff",
                  minWidth: 0,
                }}
              >
                {node.data.answers.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.text}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
      </div>

      <div
        style={{
          borderTop: "1px solid var(--qz-rule, #eee)",
          paddingTop: 10,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {landing && landing.type === "result" ? (
          <>
            <div style={{ fontSize: 13 }}>
              <span className="qz-dim">Lands on:</span>{" "}
              <strong>{landing.data.headline || "Result"}</strong>
            </div>
            {recs.length > 0 ? (
              <div className="qz-row" style={{ gap: 8, flexWrap: "wrap" }}>
                {recs.map((r) => (
                  <div
                    key={r.product_id}
                    className="qz-row"
                    style={{
                      gap: 6,
                      alignItems: "center",
                      border: "1px solid #00000014",
                      borderRadius: 8,
                      padding: "4px 8px 4px 4px",
                      background: "#fff",
                      maxWidth: 220,
                    }}
                    title={r.title}
                  >
                    {r.image_url ? (
                      <img
                        src={r.image_url}
                        alt=""
                        style={{ width: 26, height: 26, objectFit: "cover", borderRadius: 5 }}
                      />
                    ) : null}
                    <span
                      style={{
                        fontSize: 11.5,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {r.title}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="qz-dim" style={{ fontSize: 12, margin: 0 }}>
                No products resolve for this path yet — check the page&rsquo;s bucket mapping.
              </p>
            )}
          </>
        ) : (
          <p className="qz-dim" style={{ fontSize: 12, margin: 0 }}>
            This path doesn&rsquo;t reach a result page.
          </p>
        )}
      </div>
    </section>
  );
}
