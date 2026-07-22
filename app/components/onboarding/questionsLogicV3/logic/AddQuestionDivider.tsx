/* quiz-step3 v3 §5.7 — the slim add-question divider between section cards
   (and after the LAST one). The parent anchors the insert with
   insertQuestionRelative(questions[i].id, "below") — always a MOVABLE
   question, never the ordered spine's last element, so the new question can
   never land after the result (the add-anchor terminal trap). */

export function AddQuestionDivider({ onAdd }: { onAdd: () => void }) {
  // questions-full-page mock — a circular ＋ inserter centered on the hairline.
  return (
    <div className="qz-s3-divider">
      <button
        type="button"
        className="qz-s3-divider-btn"
        onClick={onAdd}
        aria-label="Add a question here"
        title="Add a question here"
      >
        ＋
      </button>
    </div>
  );
}
