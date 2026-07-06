import { useEffect, useState } from "react";
import type { Quiz } from "../../../lib/quizSchema";
import type { PathStep } from "../../../lib/mergeTags";
import type { stylesFor } from "../runtimeStyles";
import { useChrome } from "../chromeStrings";

type QuizDoc = Quiz;

// Experiences E4 — "Just making sure we're on the right track": the answer
// recap before the first result render. Edit buttons reuse the trail's jump
// (which resets the path from that point, so the theater replays after).
export function RecapView({
  doc,
  path,
  styles,
  onJump,
  onConfirm,
}: {
  doc: QuizDoc;
  path: PathStep[];
  styles: ReturnType<typeof stylesFor>;
  onJump: (i: number) => void;
  onConfirm: () => void;
}) {
  const tc = useChrome();
  const answerText = (step: PathStep): string => {
    const q = doc.nodes.find((n) => n.id === step.questionNodeId);
    if (!q || q.type !== "question") return "";
    return step.answerIds
      .map((id) => q.data.answers.find((a) => a.id === id)?.text ?? "")
      .filter(Boolean)
      .join(", ");
  };
  const questionText = (step: PathStep): string => {
    const q = doc.nodes.find((n) => n.id === step.questionNodeId);
    return q && q.type === "question" ? q.data.text : "";
  };
  return (
    <div style={styles.card}>
      <h2 style={styles.h2}>{tc("recap_heading")}</h2>
      <p style={{ ...styles.muted, marginTop: 4 }}>{tc("recap_subtext")}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, margin: "18px 0" }}>
        {path.map((step, i) => (
          <div
            key={`${step.questionNodeId}-${i}`}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: 12,
              borderBottom: "1px solid color-mix(in srgb, var(--qz-color-muted, #aaa) 30%, transparent)",
              paddingBottom: 8,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ ...styles.muted, fontSize: "0.78em" }}>{questionText(step)}</div>
              <div style={{ fontFamily: "var(--qz-font-body)", fontWeight: 600 }}>{answerText(step)}</div>
            </div>
            <button
              type="button"
              onClick={() => onJump(i)}
              style={{
                font: "inherit",
                fontSize: "0.8em",
                background: "transparent",
                border: "none",
                color: "var(--qz-color-accent, var(--qz-color-primary))",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {tc("recap_edit")}
            </button>
          </div>
        ))}
      </div>
      <button type="button" style={styles.primaryBtn} onClick={onConfirm}>
        {tc("recap_confirm")}
      </button>
    </div>
  );
}

// Experiences E4 — the visible-computation reveal: three timed beats fed by
// the REAL explained-engine output (the path's tag bag + candidate pool size),
// not theater copy. Reduced-motion paths skip this entirely (gated upstream).
export function RevealView({
  tagBag,
  poolSize,
  onDone,
}: {
  tagBag: Record<string, number>;
  poolSize: number;
  onDone: () => void;
}) {
  const tc = useChrome();
  const [beat, setBeat] = useState(0);
  useEffect(() => {
    const beats = [1100, 1500, 1100];
    if (beat >= beats.length) {
      onDone();
      return;
    }
    const t = setTimeout(() => setBeat((b) => b + 1), beats[beat]);
    return () => clearTimeout(t);
  }, [beat, onDone]);
  const factors = Object.entries(tagBag)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([tag, w]) => (w !== 1 ? `${tag} ×${w}` : tag))
    .join(" · ");
  const lines = [
    tc("reveal_weighing"),
    factors ? tc("reveal_factors", { factors }) : tc("reveal_weighing"),
    tc("reveal_matching", { n: poolSize }),
  ];
  return (
    <div
      role="status"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 14,
        padding: "56px 24px",
        fontFamily: "var(--qz-font-body)",
        color: "var(--qz-color-text)",
        textAlign: "center",
      }}
    >
      <div
        aria-hidden
        style={{
          width: 34,
          height: 34,
          borderRadius: 999,
          border: "3px solid color-mix(in srgb, var(--qz-color-primary) 25%, transparent)",
          borderTopColor: "var(--qz-color-primary)",
          animation: "qz-spin 0.9s linear infinite",
        }}
      />
      <div style={{ fontSize: "1.05em", fontWeight: 600 }}>{lines[Math.min(beat, lines.length - 1)]}</div>
      <style>{`@keyframes qz-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
