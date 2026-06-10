import { useEffect, useRef, useState } from "react";
import type { Quiz } from "../../lib/quizSchema";
import type { InspectTarget } from "../runtime/QuizRuntime";
import { addAnswer, removeAnswer } from "../../lib/quizMutations";
import { QzButton } from "../qz";
import { EmojiIconPicker } from "./EmojiIconPicker";
import { ImagePicker, type PickerProduct } from "./ImagePicker";

// Question types whose answers render an image — only these get the image
// affordance (an image on e.g. a plain single_select would never render).
const IMAGE_ANSWER_TYPES = new Set(["image_tile", "image_picker", "swatch"]);

// Contextual editor for a click-to-inspect target (editor revamp P2). The
// merchant clicks an element in the live preview; this panel edits exactly that
// node — text fields commit through the same useQuizDraft seam the AI chat
// uses, so the preview re-renders instantly and the 700ms autosave persists.
// Answer add/remove reuses the quizMutations helpers (same edge re-stitching
// the AI's add_answer/remove_answer ops rely on), so routing stays sound.

type QuizDoc = Quiz;
type AnyNode = QuizDoc["nodes"][number];

const PART_LABEL: Record<InspectTarget["part"], string> = {
  headline: "Intro",
  subtext: "Intro",
  cta: "Intro button",
  question_text: "Question",
  answer: "Answer",
  education_card: "Education card",
  result_headline: "Result page",
  result_subtext: "Result page",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  font: "inherit",
  fontSize: 13,
  padding: "8px 10px",
  borderRadius: "var(--qz-radius)",
  border: "1px solid #00000022",
  background: "#fff",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span className="qz-label" style={{ fontSize: 11 }}>{label}</span>
      {children}
    </label>
  );
}

export function InspectorPanel({
  doc,
  target,
  onCommit,
  onClose,
  products = [],
}: {
  doc: QuizDoc;
  target: InspectTarget;
  onCommit: (doc: QuizDoc) => void;
  onClose: () => void;
  products?: PickerProduct[];
}) {
  const node = doc.nodes.find((n) => n.id === target.nodeId);
  const focusRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const [picker, setPicker] = useState<{ answerId: string; kind: "icon" | "image" } | null>(null);

  // Esc closes; if the node vanishes (e.g. the AI chat removed it), auto-close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    if (!node) onClose();
  }, [node, onClose]);

  // Focus the field the merchant actually clicked, once per target.
  useEffect(() => {
    focusRef.current?.focus();
    focusRef.current?.select?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.nodeId, target.part, target.answerId]);

  if (!node) return null;

  const patchData = (patch: Record<string, unknown>) =>
    onCommit({
      ...doc,
      nodes: doc.nodes.map((n) =>
        n.id === node.id ? ({ ...n, data: { ...n.data, ...patch } } as AnyNode) : n,
      ),
    });

  let body: React.ReactNode = null;

  if (node.type === "intro") {
    body = (
      <>
        <Field label="Headline">
          <input
            ref={target.part === "headline" ? (focusRef as React.Ref<HTMLInputElement>) : undefined}
            style={inputStyle}
            value={node.data.headline}
            onChange={(e) => patchData({ headline: e.target.value })}
          />
        </Field>
        <Field label="Subtext">
          <textarea
            ref={target.part === "subtext" ? (focusRef as React.Ref<HTMLTextAreaElement>) : undefined}
            style={{ ...inputStyle, resize: "vertical" }}
            rows={2}
            value={node.data.subtext ?? ""}
            onChange={(e) => patchData({ subtext: e.target.value })}
          />
        </Field>
        <Field label="Button label">
          <input
            ref={target.part === "cta" ? (focusRef as React.Ref<HTMLInputElement>) : undefined}
            style={inputStyle}
            value={node.data.button_label}
            onChange={(e) => patchData({ button_label: e.target.value })}
          />
        </Field>
      </>
    );
  } else if (node.type === "question") {
    const patchAnswer = (answerId: string, patch: Record<string, unknown>) =>
      patchData({
        answers: node.data.answers.map((a) => (a.id === answerId ? { ...a, ...patch } : a)),
      });
    const setAnswerText = (answerId: string, text: string) => patchAnswer(answerId, { text });
    const supportsImages = IMAGE_ANSWER_TYPES.has(node.data.question_type);
    const columns = node.data.answer_columns;
    body = (
      <>
        <Field label="Question">
          <textarea
            ref={
              target.part === "question_text"
                ? (focusRef as React.Ref<HTMLTextAreaElement>)
                : undefined
            }
            style={{ ...inputStyle, resize: "vertical" }}
            rows={2}
            value={node.data.text}
            onChange={(e) => patchData({ text: e.target.value })}
          />
        </Field>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="qz-label" style={{ fontSize: 11 }}>Answers</span>
          {node.data.answers.map((a) => (
            <div key={a.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div className="qz-row" style={{ gap: 6, alignItems: "center" }}>
                <input
                  ref={
                    target.part === "answer" && target.answerId === a.id
                      ? (focusRef as React.Ref<HTMLInputElement>)
                      : undefined
                  }
                  style={{ ...inputStyle, flex: 1 }}
                  value={a.text}
                  onChange={(e) => setAnswerText(a.id, e.target.value)}
                />
                <button
                  type="button"
                  title={a.icon ? `Icon: ${a.icon} — change` : "Add an emoji icon"}
                  aria-label={`Icon for answer: ${a.text}`}
                  onClick={() =>
                    setPicker((p) =>
                      p?.answerId === a.id && p.kind === "icon" ? null : { answerId: a.id, kind: "icon" },
                    )
                  }
                  style={{
                    border:
                      picker?.answerId === a.id && picker.kind === "icon"
                        ? "1px solid var(--qz-accent, #2a6df4)"
                        : "1px solid #00000022",
                    background: "#fff",
                    borderRadius: 6,
                    width: 26,
                    height: 26,
                    cursor: "pointer",
                    flex: "0 0 auto",
                    fontSize: 13,
                    lineHeight: 1,
                  }}
                >
                  {a.icon ?? "☺"}
                </button>
                {supportsImages ? (
                  <button
                    type="button"
                    title={a.image_url ? "Change image" : "Pick an image"}
                    aria-label={`Image for answer: ${a.text}`}
                    onClick={() =>
                      setPicker((p) =>
                        p?.answerId === a.id && p.kind === "image"
                          ? null
                          : { answerId: a.id, kind: "image" },
                      )
                    }
                    style={{
                      border:
                        picker?.answerId === a.id && picker.kind === "image"
                          ? "1px solid var(--qz-accent, #2a6df4)"
                          : "1px solid #00000022",
                      background: a.image_url ? `center/cover url(${a.image_url})` : "#fff",
                      color: a.image_url ? "transparent" : undefined,
                      borderRadius: 6,
                      width: 26,
                      height: 26,
                      cursor: "pointer",
                      flex: "0 0 auto",
                      fontSize: 12,
                      lineHeight: 1,
                    }}
                  >
                    🖼
                  </button>
                ) : null}
                <button
                  type="button"
                  title="Remove answer"
                  aria-label={`Remove answer: ${a.text}`}
                  onClick={() => onCommit(removeAnswer(doc, node.id, a.id))}
                  disabled={node.data.answers.length <= 2}
                  style={{
                    border: "1px solid #00000022",
                    background: "#fff",
                    borderRadius: 6,
                    width: 26,
                    height: 26,
                    cursor: node.data.answers.length <= 2 ? "not-allowed" : "pointer",
                    opacity: node.data.answers.length <= 2 ? 0.4 : 1,
                    flex: "0 0 auto",
                  }}
                >
                  ✕
                </button>
              </div>
              {picker?.answerId === a.id && picker.kind === "icon" ? (
                <EmojiIconPicker
                  value={a.icon}
                  onPick={(icon) => {
                    patchAnswer(a.id, { icon });
                    setPicker(null);
                  }}
                />
              ) : null}
              {picker?.answerId === a.id && picker.kind === "image" ? (
                <ImagePicker
                  products={products}
                  value={a.image_url}
                  onPick={(image_url) => {
                    patchAnswer(a.id, { image_url });
                    setPicker(null);
                  }}
                />
              ) : null}
            </div>
          ))}
          <div className="qz-row" style={{ gap: 8, alignItems: "center" }}>
            <button
              type="button"
              className="qz-btn qz-btn-ghost qz-btn-sm"
              onClick={() => onCommit(addAnswer(doc, node.id))}
            >
              + Add answer
            </button>
            <span className="qz-dim" style={{ fontSize: 11 }}>Columns:</span>
            <div className="qz-segmented" role="group" aria-label="Answer columns">
              <button
                type="button"
                aria-pressed={columns === undefined}
                onClick={() => patchData({ answer_columns: undefined })}
              >
                Auto
              </button>
              <button
                type="button"
                aria-pressed={columns === 1}
                onClick={() => patchData({ answer_columns: 1 })}
              >
                1
              </button>
              <button
                type="button"
                aria-pressed={columns === 2}
                onClick={() => patchData({ answer_columns: 2 })}
              >
                2
              </button>
            </div>
          </div>
        </div>
        <Field label="Education card (optional, shown before the question)">
          <textarea
            ref={
              target.part === "education_card"
                ? (focusRef as React.Ref<HTMLTextAreaElement>)
                : undefined
            }
            style={{ ...inputStyle, resize: "vertical" }}
            rows={2}
            placeholder="💡 A one-line teaching note…"
            value={node.data.education_card_before ?? ""}
            onChange={(e) =>
              patchData({ education_card_before: e.target.value || undefined })
            }
          />
        </Field>
      </>
    );
  } else if (node.type === "result") {
    body = (
      <>
        <Field label="Headline">
          <input
            ref={
              target.part === "result_headline"
                ? (focusRef as React.Ref<HTMLInputElement>)
                : undefined
            }
            style={inputStyle}
            value={node.data.headline}
            onChange={(e) => patchData({ headline: e.target.value })}
          />
        </Field>
        <Field label="Subtext">
          <textarea
            ref={
              target.part === "result_subtext"
                ? (focusRef as React.Ref<HTMLTextAreaElement>)
                : undefined
            }
            style={{ ...inputStyle, resize: "vertical" }}
            rows={2}
            value={node.data.subtext ?? ""}
            onChange={(e) => patchData({ subtext: e.target.value })}
          />
        </Field>
        <Field label="Button label (on product cards)">
          <input
            style={inputStyle}
            value={node.data.cta_label ?? ""}
            placeholder="Shop now"
            onChange={(e) => patchData({ cta_label: e.target.value || undefined })}
          />
        </Field>
      </>
    );
  } else {
    body = (
      <p className="qz-dim" style={{ fontSize: 12, margin: 0 }}>
        This element isn&rsquo;t editable here yet — use the Advanced builder.
      </p>
    );
  }

  return (
    <div
      className="qz-card"
      style={{
        padding: 14,
        marginBottom: 16,
        borderColor: "var(--qz-accent, #2a6df4)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div className="qz-row qz-row-between" style={{ alignItems: "center" }}>
        <strong style={{ fontSize: 13 }}>
          ✏️ {PART_LABEL[target.part]}
          <span className="qz-dim" style={{ fontWeight: 400 }}> — click anything in the preview to edit it</span>
        </strong>
        <QzButton size="sm" variant="ghost" onClick={onClose} aria-label="Close editor (Esc)">
          Done
        </QzButton>
      </div>
      {body}
    </div>
  );
}
