import { type OrderedQuestion, questionHasUnmappedAnswer } from "./questionOrder";

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

// Questions & Logic spec §2.3 — the left-panel question list. Q badge, truncated
// text, type label + purple AI dot (AI-generated) + amber dot (an answer with no
// bucket). Active item highlights; clicking scrolls the main area to that card.
export function QuestionList({
  questions,
  activeId,
  onSelect,
}: {
  questions: OrderedQuestion[];
  activeId: string | null;
  onSelect: (nodeId: string) => void;
}) {
  return (
    <div className="qz-ql-qlist" role="list">
      {questions.map(({ node, qIndex }) => {
        const unmapped = questionHasUnmappedAnswer(node);
        return (
          <button
            key={node.id}
            type="button"
            role="listitem"
            className={`qz-ql-qitem ${activeId === node.id ? "is-active" : ""}`}
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
                {node.data.ai_generated ? (
                  <span className="qz-ql-dot is-ai" title="AI-generated" aria-label="AI-generated">
                    ✦
                  </span>
                ) : null}
                {unmapped ? (
                  <span
                    className="qz-ql-dot is-warn"
                    title="An answer has no bucket mapped"
                    aria-label="Has an unmapped answer"
                  >
                    !
                  </span>
                ) : null}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
