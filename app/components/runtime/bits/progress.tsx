import { useContext, useMemo } from "react";
import type { PublishedChapter, Quiz } from "../../../lib/quizSchema";
import type { PathStep } from "../../../lib/mergeTags";
import {
  chapterFills,
  chaptersForRender,
  currentChapterIndex,
  progressPct,
  reachableQuestionCount,
} from "../../../lib/progress";
import { useChrome } from "../chromeStrings";
import { RuntimeChromeContext } from "../runtimeContexts";

type QuizDoc = Quiz;

// Thin percent-complete bar above the step trail (Phase 5). Denominator =
// reachable question steps; numerator = answered + the one in progress.
export function ProgressBar({
  doc,
  path,
  currentNodeId,
  barStyle = "bar",
}: {
  doc: QuizDoc;
  path: PathStep[];
  currentNodeId: string | null;
  // §4 progress style. "bar" (default) is today's thin %-fill bar — byte-stable.
  barStyle?: "bar" | "dots" | "steps";
}) {
  const minimal = useContext(RuntimeChromeContext) === "minimal";
  const total = useMemo(() => reachableQuestionCount(doc), [doc]);
  if (total <= 0) return null;
  const node = currentNodeId ? doc.nodes.find((n) => n.id === currentNodeId) : null;
  // An empty 0% track on the intro reads as broken chrome — progress starts
  // rendering once the shopper is actually in the flow.
  if (node?.type === "intro") return null;
  const onResult = node?.type === "result" || node?.type === "end";
  const onQuestion = node?.type === "question";
  const answered = path.length + (onQuestion ? 1 : 0);
  const pct = onResult ? 100 : progressPct(total, answered);

  // QRTZ-O5 (GAPS §A.4, owner call 2026-08-12) — Chapters. Gated hard:
  // decider doc AND publish-baked chapters (≥2) AND the default "bar" style
  // (an explicit merchant dots/steps pick wins). Legacy docs and chapterless
  // decider docs fall through to the exact code paths below, unchanged.
  const chapters = chaptersForRender(doc, barStyle);
  if (chapters) {
    return (
      <ChaptersBar
        chapters={chapters}
        answeredIds={path.map((s) => s.questionNodeId)}
        currentQuestionId={onQuestion ? currentNodeId : null}
        onResult={onResult}
        minimal={minimal}
      />
    );
  }

  // §4 dots / steps — N markers, filled up to the current question. Caps at a
  // reasonable count so a long quiz doesn't overflow (falls back to the bar).
  if ((barStyle === "dots" || barStyle === "steps") && total <= 12) {
    const filled = onResult ? total : Math.min(answered, total);
    // Brand primary in both chromes — the minimal chrome's old text-color fill
    // read as a black bar on every palette (pre-redesign Quizell leftover).
    const on = "var(--qz-color-primary)";
    const off = minimal ? "var(--qz-color-surface)" : "#00000010";
    const isSteps = barStyle === "steps";
    return (
      <div
        aria-hidden
        style={{
          display: "flex",
          gap: isSteps ? 6 : 8,
          width: isSteps ? "100%" : undefined,
          justifyContent: "center",
          marginBottom: minimal ? 26 : 12,
        }}
      >
        {Array.from({ length: total }).map((_, i) => (
          <div
            key={i}
            style={{
              ...(isSteps ? { flex: 1, height: minimal ? 8 : 6 } : { width: 9, height: 9 }),
              borderRadius: 999,
              background: i < filled ? on : off,
              transition: "background var(--qz-dur, 170ms) var(--qz-ease, ease)",
            }}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      style={
        minimal
          ? {
              // Quizell: a thick black bar pinned across the top of the quiz.
              height: 9,
              borderRadius: 999,
              background: "var(--qz-color-surface)",
              overflow: "hidden",
              marginBottom: 26,
              width: "100%",
            }
          : {
              height: 6,
              borderRadius: 999,
              background: "#00000010",
              overflow: "hidden",
              marginBottom: 12,
            }
      }
      aria-hidden
    >
      <div
        style={{
          // scaleX instead of width: compositor-only, no layout thrash on every
          // step change (the track's overflow:hidden clips the cap identically).
          width: "100%",
          transform: `scaleX(${pct / 100})`,
          transformOrigin: "left center",
          height: "100%",
          ...(minimal ? { borderRadius: 999 } : {}),
          background: "var(--qz-color-primary)",
          transition: "transform var(--qz-dur, 170ms) var(--qz-ease, ease)",
        }}
      />
    </div>
  );
}

// QRTZ-O5 — the Chapters bar (mock base.mjs .pg-phases): one column per
// chapter — a tiny uppercase label over a 5px track with a per-chapter fill.
// THE COLOR RULE: the fill is the merchant's own CTA color
// (--qz-color-primary), NEVER the Wiskr accent — progress is a shopper
// feeling. Styled by the .qz-chapters section of quiz-runtime.css. Visible
// labels + aria-current beat the classic bar's aria-hidden div.
function ChaptersBar({
  chapters,
  answeredIds,
  currentQuestionId,
  onResult,
  minimal,
}: {
  chapters: readonly PublishedChapter[];
  answeredIds: readonly string[];
  currentQuestionId: string | null;
  onResult: boolean;
  minimal: boolean;
}) {
  const tc = useChrome();
  const fills = chapterFills(chapters, answeredIds, currentQuestionId, onResult);
  const now = currentChapterIndex(chapters, currentQuestionId, fills, onResult);
  return (
    <ol
      className="qz-chapters"
      aria-label={tc("aria_quiz_progress")}
      style={{ marginBottom: minimal ? 26 : 12 }}
    >
      {chapters.map((c, i) => (
        <li
          key={`${c.label}-${i}`}
          className={i === now ? "is-now" : undefined}
          aria-current={i === now ? "step" : undefined}
        >
          <span>{c.label}</span>
          <i>
            {/* scaleX over width: compositor-only, matching the classic bar
                (the track's overflow:hidden clips the cap identically). */}
            <b style={{ transform: `scaleX(${fills[i] ?? 0})` }} />
          </i>
        </li>
      ))}
    </ol>
  );
}

// MQ — the Quizell "Question # N" eyebrow shown above the question under the
// minimal chrome (replaces the classic pill trail). N = 1-indexed position among
// the answered questions + the current one.
export function MinimalQuestionLabel({
  doc,
  path,
  currentNodeId,
}: {
  doc: QuizDoc;
  path: PathStep[];
  currentNodeId: string | null;
}) {
  const tc = useChrome();
  const total = useMemo(() => reachableQuestionCount(doc), [doc]);
  const node = currentNodeId ? doc.nodes.find((n) => n.id === currentNodeId) : null;
  if (node?.type !== "question") return null;
  return (
    <div
      style={{
        width: "100%",
        maxWidth: 640,
        textAlign: "left",
        // Recede below the question headline: the counter is orientation, not
        // content — muted + smaller keeps the visual hierarchy on the question.
        fontSize: "0.85em",
        fontWeight: 600,
        color: "var(--qz-color-muted, var(--qz-color-text))",
        marginBottom: 18,
        fontFamily: "var(--qz-font-body)",
      }}
    >
      {tc("question_counter", { n: path.length + 1, total })}
    </div>
  );
}

// Clickable progress trail — one pill per answered question (jump back to
// re-answer) + the current question. Lets the shopper move around the quiz
// instead of only going forward; resume restores it on re-open.
export function ProgressTrail({
  doc,
  path,
  currentNodeId,
  onJump,
}: {
  doc: QuizDoc;
  path: PathStep[];
  currentNodeId: string | null;
  onJump: (i: number) => void;
}) {
  const tc = useChrome();
  const current = currentNodeId ? doc.nodes.find((n) => n.id === currentNodeId) : null;
  const currentIsQuestion = current?.type === "question";
  if (path.length === 0 && !currentIsQuestion) return null;

  const label = (qid: string, i: number): string => {
    const node = doc.nodes.find((n) => n.id === qid);
    const text = node && node.type === "question" ? node.data.text : `Step ${i + 1}`;
    return text.length > 22 ? `${text.slice(0, 21)}…` : text;
  };
  // E3 chapters: the CURRENT question's section_label renders as a chapter
  // eyebrow over the trail ("SKIN PROFILE · step 4 of 9" feel). Pills keep
  // their exact DOM (e2e contract); absent labels = no eyebrow.
  const sectionOf = (qid: string | null): string | null => {
    if (!qid) return null;
    const node = doc.nodes.find((n) => n.id === qid);
    return node && node.type === "question" ? (node.data.section_label ?? null) : null;
  };
  const currentSection = sectionOf(currentNodeId);
  const pill = (active: boolean, clickable: boolean): React.CSSProperties => ({
    border: "1px solid var(--qz-color-muted, #aaa)",
    background: active ? "var(--qz-color-text)" : "transparent",
    color: active ? "var(--qz-color-bg)" : "var(--qz-color-text)",
    borderRadius: 999,
    padding: "4px 10px",
    fontSize: "0.8em",
    fontFamily: "var(--qz-font-body)",
    cursor: clickable ? "pointer" : "default",
    whiteSpace: "nowrap",
  });

  return (
    <>
    {currentSection ? (
      <div
        style={{
          fontSize: "0.7em",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--qz-color-muted, #888)",
          fontFamily: "var(--qz-font-body)",
          marginBottom: 6,
          maxWidth: 560,
          width: "100%",
        }}
      >
        {currentSection}
      </div>
    ) : null}
    <div
      aria-label={tc("aria_quiz_progress")}
      style={{
        display: "flex",
        gap: 6,
        flexWrap: "wrap",
        // Pin wrapped rows to the top so a pill can never stretch vertically
        // (which, in a stretched flex parent, turned them into tall ovals).
        alignContent: "flex-start",
        marginBottom: 16,
        maxWidth: 560,
        width: "100%",
      }}
    >
      {path.map((s, i) => (
        <button
          key={`${s.questionNodeId}-${i}`}
          onClick={() => onJump(i)}
          title="Jump back to this question"
          aria-label={tc("aria_go_back_to", { n: i + 1, label: label(s.questionNodeId, i) })}
          style={pill(false, true)}
        >
          {i + 1}. {label(s.questionNodeId, i)}
        </button>
      ))}
      {currentIsQuestion && current ? (
        <span style={pill(true, false)} aria-current="step">
          {path.length + 1}. {label(current.id, path.length)}
        </span>
      ) : null}
    </div>
    </>
  );
}
