import { Fragment } from "react";
import type { Quiz as QuizDoc } from "../../../lib/quizSchema";
import { isFreeformType } from "../../../lib/quizSchema";
import type { BuilderCategory } from "../../builder/stepProps";
import {
  setAnswerBucketDirect,
  setAnswerRoute,
  routeAnswerToEnd,
} from "../../../lib/quizMutations";
import { updateNodeData } from "../../studio/studioDoc";
import {
  orderedQuestions,
  answerBucketId,
  answerSkipValue,
  isAnswerMapped,
} from "./questionOrder";
import { answerPassesFilter, GAP_FILTER, type TableFilter } from "./tableFilters";
import { bucketColor, answerLetter, answerLetterColor } from "./bucketPalette";
import type { SkipOption } from "./AnswerRow";

const ANSWER_MAX = 60;

// Questions & Logic spec §4 — the Table view. All questions + answers as one
// scrollable spreadsheet, bidirectionally synced with the Builder view because
// every cell writes through the SAME mutations over the SAME doc (no separate
// state). A shaded, non-editable question header row spans each question; answer
// rows carry the inline "Maps to bucket" + "Then go to" controls. The filter bar
// narrows to a bucket or to "Gaps only" (the shared unmapped predicate).
export function TableView({
  doc,
  categories,
  skipOptions,
  filter,
  onFilterChange,
  activeId,
  onActivate,
  onCommit,
}: {
  doc: QuizDoc;
  categories: BuilderCategory[];
  skipOptions: SkipOption[];
  filter: TableFilter;
  onFilterChange: (f: TableFilter) => void;
  activeId: string | null;
  onActivate: (id: string) => void;
  onCommit: (doc: QuizDoc) => void;
}) {
  const weighted = (doc.scoring_model ?? "direct") === "weighted";
  const questions = orderedQuestions(doc);

  // A question is visible when no filter is set, or (card questions only) at
  // least one of its answers passes. Freeform questions have nothing to map, so
  // they only show under the "all" filter.
  const visible = questions
    .map(({ node, qIndex }) => {
      const freeform = isFreeformType(node.data.question_type);
      const rows = node.data.answers
        .map((a, i) => ({ a, i }))
        .filter(({ a }) => (freeform ? true : answerPassesFilter(a, filter)));
      return { node, qIndex, freeform, rows };
    })
    .filter(({ freeform, rows }) => {
      if (!filter) return true;
      if (freeform) return false; // freeform never matches gap/bucket filters
      return rows.length > 0;
    });

  const setText = (node: (typeof questions)[number]["node"], answerId: string, text: string) => {
    const answers = node.data.answers.map((a) =>
      a.id === answerId ? { ...a, text: text.slice(0, ANSWER_MAX) } : a,
    );
    onCommit(updateNodeData(doc, node.id, { answers }));
  };

  return (
    <div className="qz-qlt-wrap">
      <div className="qz-qlt-filterbar">
        <label className="qz-ql-label" htmlFor="qlt-filter">
          Filter
        </label>
        <select
          id="qlt-filter"
          className="qz-qlt-filter"
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
        >
          <option value="">All answers</option>
          <option value={GAP_FILTER}>⚠ Gaps only (unmapped)</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="qz-qlt-scroll">
        <table className="qz-qlt">
          <thead>
            <tr>
              <th className="qz-qlt-c-q">Q</th>
              <th className="qz-qlt-c-question">Question</th>
              <th className="qz-qlt-c-answer">Answer</th>
              <th className="qz-qlt-c-bucket">Maps to recommendation</th>
              <th className="qz-qlt-c-skip">Then go to</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(({ node, qIndex, freeform, rows }) => {
              const skipForThis = skipOptions.filter((o) => o.value !== node.id);
              return (
                <Fragment key={node.id}>
                  <tr
                    id={`qlt-${node.id}`}
                    className={`qz-qlt-qrow ${activeId === node.id ? "is-active" : ""}`}
                    onMouseDown={() => onActivate(node.id)}
                  >
                    <td className="qz-qlt-qbadge-cell">
                      <span className="qz-ql-qbadge">Q{qIndex}</span>
                    </td>
                    <td colSpan={4} className="qz-qlt-qtext-cell">
                      {node.data.text || "Untitled question"}
                      {freeform ? <em className="qz-qlt-freeform"> · open text (not scored)</em> : null}
                    </td>
                  </tr>

                  {freeform ? (
                    <tr className="qz-qlt-arow">
                      <td />
                      <td />
                      <td colSpan={3} className="qz-qlt-note">
                        Open-text responses are stored as customer data — not scored.
                      </td>
                    </tr>
                  ) : (
                    rows.map(({ a, i }) => {
                      const bucketId = answerBucketId(a);
                      const bucketIdx = bucketId ? categories.findIndex((c) => c.id === bucketId) : -1;
                      const color = bucketIdx >= 0 ? bucketColor(bucketIdx) : null;
                      const skipValue = answerSkipValue(doc, node.id, a);
                      return (
                        <tr key={a.id} className="qz-qlt-arow">
                          <td />
                          <td />
                          <td className="qz-qlt-answercell">
                            <span
                              className="qz-ql-bullet"
                              style={{ background: answerLetterColor(i) }}
                              aria-hidden
                            >
                              {answerLetter(i)}
                            </span>
                            <input
                              className="qz-ql-atext"
                              value={a.text}
                              maxLength={ANSWER_MAX}
                              placeholder="Answer option…"
                              onChange={(e) => setText(node, a.id, e.target.value)}
                              aria-label={`Q${qIndex} answer ${answerLetter(i)} text`}
                            />
                          </td>
                          <td>
                            <div className="qz-qlt-bucketcell">
                              {!isAnswerMapped(a) ? (
                                <span className="qz-qlt-gap" title="No recommendation mapped" aria-label="Gap">
                                  ⚠
                                </span>
                              ) : null}
                              <select
                                className={`qz-ql-bucket ${color ? "is-mapped" : "is-unset"}`}
                                value={bucketId ?? ""}
                                disabled={weighted}
                                title={
                                  weighted
                                    ? "Weighted scoring is active — switch to Direct mapping in the top bar to edit recommendations here"
                                    : undefined
                                }
                                style={
                                  color
                                    ? { color: color.solid, background: color.bg, borderColor: color.mid }
                                    : undefined
                                }
                                onChange={(e) =>
                                  onCommit(setAnswerBucketDirect(doc, node.id, a.id, e.target.value || null))
                                }
                                aria-label={`Q${qIndex} answer ${answerLetter(i)} maps to recommendation`}
                              >
                                <option value="">— Map to recommendation</option>
                                {categories.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </td>
                          <td>
                            <select
                              className={`qz-ql-skip ${skipValue ? "is-active" : ""}`}
                              value={skipValue}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (v === "__end__") onCommit(routeAnswerToEnd(doc, node.id, a.id));
                                else onCommit(setAnswerRoute(doc, node.id, a.id, v || null));
                              }}
                              aria-label={`Q${qIndex} answer ${answerLetter(i)} skip-to`}
                            >
                              <option value="">Next question</option>
                              {skipForThis.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {visible.length === 0 ? (
          <p className="qz-dim" style={{ padding: 24, textAlign: "center" }}>
            No answers match this filter.
          </p>
        ) : null}
      </div>
    </div>
  );
}
