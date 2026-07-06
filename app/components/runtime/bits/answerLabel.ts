// Answer label with the optional emoji icon prefix (editor revamp P3 —
// Answer.icon, set via the InspectorPanel's icon picker or the AI's
// set_answer_icon op). Absent icon → just the text, unchanged.
export function answerLabel(a: { icon?: string; text: string }): string {
  return a.icon ? `${a.icon} ${a.text}` : a.text;
}
