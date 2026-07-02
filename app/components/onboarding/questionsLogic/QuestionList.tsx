import {
  type OrderedQuestion,
  questionHasUnmappedAnswer,
  questionHasUnmappedTarget,
} from "./questionOrder";

// Friendly one-word-ish labels for the left-panel meta line.
const TYPE_LABEL: Record<string, string> = {
  single_select: "Single select",
  multi_select: "Multi-select",
  image_tile: "Image select",
  image_picker: "Image grid",
  searchable: "Searchable",
  dropdown: "Dropdown",
  rating: "Scale",
  swatch: "Swatch",
  slider: "Slider",
  numeric: "Number",
  date: "Date",
  text: "Open text",
  email: "Email",
};

export type RowAction = "up" | "down" | "above" | "below" | "duplicate";

// Questions & Logic spec §2.3 — the left-panel question list. Q badge, truncated
// text, type label + ✦ AI glyph + ! amber unmapped glyph. Active item highlights;
// clicking the row scrolls the main area to that card. Each row reveals a compact
// action cluster on hover/focus: move up/down (reorder), add above/below, duplicate.
export function QuestionList({
  questions,
  activeId,
  onSelect,
  onRowAction,
  deciderMode = false,
}: {
  questions: OrderedQuestion[];
  activeId: string | null;
  onSelect: (nodeId: string) => void;
  onRowAction: (nodeId: string, action: RowAction) => void;
  /** LOGIC v2 — rows gain a gold ◆ on the decider; "!" means unmapped TARGETS
   *  (decider only — qualifiers assign nothing, so they can never be unmapped). */
  deciderMode?: boolean;
}) {
  const last = questions.length - 1;
  return (
    <div className="qz-ql-qlist" role="list">
      {questions.map(({ node, qIndex }, i) => {
        const unmapped = deciderMode
          ? questionHasUnmappedTarget(node)
          : questionHasUnmappedAnswer(node);
        const decides = deciderMode && node.data.role === "decides";
        return (
          <div
            key={node.id}
            role="listitem"
            className={`qz-ql-qitem ${activeId === node.id ? "is-active" : ""}`}
          >
            <button
              type="button"
              className="qz-ql-qitem-select"
              onClick={() => onSelect(node.id)}
              title={node.data.text}
            >
              <span className="qz-ql-qitem-badge">Q{qIndex}</span>
              <span className="qz-ql-qitem-main">
                <span className="qz-ql-qitem-text">
                  {node.data.text || "Untitled question"}
                </span>
                <span className="qz-ql-qitem-meta">
                  {TYPE_LABEL[node.data.question_type] ?? node.data.question_type}
                  {decides ? (
                    <span
                      className="qz-ql-dot is-decider"
                      title="Decides the result"
                      aria-label="Decides the result"
                    >
                      ◆
                    </span>
                  ) : null}
                  {node.data.ai_generated ? (
                    <span className="qz-ql-dot is-ai" title="AI-generated" aria-label="AI-generated">
                      ✦
                    </span>
                  ) : null}
                  {unmapped ? (
                    <span
                      className="qz-ql-dot is-warn"
                      title={
                        deciderMode
                          ? "A deciding answer doesn't point at a result yet"
                          : "An answer has no bucket mapped"
                      }
                      aria-label="Has an unmapped answer"
                    >
                      !
                    </span>
                  ) : null}
                </span>
              </span>
            </button>
            <div className="qz-ql-qitem-actions">
              <button
                type="button"
                disabled={i === 0}
                title="Move up"
                aria-label={`Move question ${qIndex} up`}
                onClick={() => onRowAction(node.id, "up")}
              >
                ↑
              </button>
              <button
                type="button"
                disabled={i === last}
                title="Move down"
                aria-label={`Move question ${qIndex} down`}
                onClick={() => onRowAction(node.id, "down")}
              >
                ↓
              </button>
              <button
                type="button"
                title="Add a question above"
                aria-label={`Add a question above question ${qIndex}`}
                onClick={() => onRowAction(node.id, "above")}
              >
                ＋↑
              </button>
              <button
                type="button"
                title="Add a question below"
                aria-label={`Add a question below question ${qIndex}`}
                onClick={() => onRowAction(node.id, "below")}
              >
                ＋↓
              </button>
              <button
                type="button"
                title="Duplicate this question"
                aria-label={`Duplicate question ${qIndex}`}
                onClick={() => onRowAction(node.id, "duplicate")}
              >
                ⧉
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
