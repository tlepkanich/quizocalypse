import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Quiz } from "../../../lib/quizSchema";
import type { OrderedQuestion } from "../../../lib/questionOrder";
import type { BuilderCategory } from "../../builder/stepProps";
import { createDecisionRule } from "../../../lib/quizMutations";
import { parsePastedRules, type PasteVocab } from "../../../lib/rulePaste";
import { useFocusTrap } from "../../qz-overlays";
import { useQzToast } from "../../qz-toast";

// ════════════════════════════════════════════════════════════════════════════
// Logic-step handoff §6 — written rules (paste). Its own entry point beside
// "+ Add rule" (never a tab inside the builder). The textarea parses LIVE
// through app/lib/rulePaste.ts; every recognised part echoes back tinted by
// what it resolved to, so the merchant sees the parse rather than trusting
// it. Unmatched lines are listed with a reason and SKIPPED — nothing is
// snapped to a near-miss. Confirm writes the same decision_rules the builder
// writes (createDecisionRule per parsed line, one commit), so a pasted rule
// can be reopened in the builder for editing.
// ════════════════════════════════════════════════════════════════════════════

const PLACEHOLDER = `when A necklace then pin Gift cards
when A ring or A bracelet then pin Gift cards
when Warm golds and A necklace then show Necklace`;

export function PasteRulesModal({
  questions,
  categories,
  onClose,
  commit,
  getLatestDoc,
}: {
  questions: OrderedQuestion[];
  categories: BuilderCategory[];
  onClose: () => void;
  commit: (doc: Quiz) => void;
  getLatestDoc: () => Quiz;
}) {
  const toast = useQzToast();
  const boxRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(boxRef, true);
  const [text, setText] = useState("");

  // Esc closes (document-level, same contract as the builder modal — the
  // scrim deliberately does not close a draft).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const vocab = useMemo<PasteVocab>(
    () => ({
      questions: questions.map((q) => ({
        id: q.node.id,
        text: q.node.data.text,
        multiSelect: q.node.data.question_type === "multi_select",
        answers: q.node.data.answers.map((a) => ({ id: a.id, text: a.text })),
      })),
      targets: categories.map((c) => ({ id: c.id, label: c.name })),
    }),
    [questions, categories],
  );

  const lines = useMemo(() => parsePastedRules(text, vocab), [text, vocab]);
  const okLines = lines.filter((l) => l.ok);
  const badLines = lines.filter((l) => !l.ok);

  const handleCreate = () => {
    if (okLines.length === 0) return;
    // One commit over the LATEST doc (the autosave seam's post-await rule).
    let next = getLatestDoc();
    for (const line of okLines) {
      if (!line.ok) continue;
      next = createDecisionRule(next, {
        conditions: line.conditions,
        target_ids: [line.targetId],
        action: line.action,
        ...(line.match ? { match: line.match } : {}),
        ...(line.any_of ? { any_of: line.any_of } : {}),
      });
    }
    commit(next);
    toast(
      okLines.length === 1
        ? "✓ 1 rule created — checked top down, first match applies"
        : `✓ ${okLines.length} rules created — checked top down, first match applies`,
    );
    onClose();
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="qz-modal-scrim">
      <div
        ref={boxRef}
        className="qz-crm qz-prm"
        role="dialog"
        aria-modal="true"
        aria-label="Paste rules"
      >
        <header className="qz-crm-hd">
          <h2>Paste rules</h2>
          <span className="qz-crm-hint">
            One rule per line — when answers then show / pin / hide a result
          </span>
          <button
            type="button"
            className="qz-btn qz-btn-primary"
            disabled={okLines.length === 0}
            onClick={handleCreate}
          >
            {okLines.length === 0
              ? "Create rules"
              : `Create ${okLines.length} rule${okLines.length === 1 ? "" : "s"}`}
          </button>
          <button type="button" className="qz-prm-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="qz-prm-body">
          <textarea
            className="qz-prm-input"
            value={text}
            placeholder={PLACEHOLDER}
            rows={6}
            onChange={(e) => setText(e.target.value)}
            aria-label="Rules, one per line"
          />
          {lines.length > 0 ? (
            <div className="qz-prm-parse" aria-live="polite">
              {okLines.length > 0 ? (
                <ul className="qz-prm-oklist">
                  {okLines.map((l) =>
                    l.ok ? (
                      <li key={l.lineNumber} className="qz-prm-okline">
                        {l.segments.map((s, i) => (
                          <span key={i} className={`qz-prm-seg is-${s.kind}`}>
                            {s.text}
                          </span>
                        ))}
                      </li>
                    ) : null,
                  )}
                </ul>
              ) : null}
              {badLines.length > 0 ? (
                <div className="qz-prm-bad">
                  <p className="qz-prm-badhd">
                    {badLines.length === 1
                      ? "1 line could not be matched — it will be skipped:"
                      : `${badLines.length} lines could not be matched — they will be skipped:`}
                  </p>
                  <ul>
                    {badLines.map((l) =>
                      !l.ok ? (
                        <li key={l.lineNumber} className="qz-prm-badline">
                          <span className="qz-prm-badno">line {l.lineNumber}</span>
                          <span className="qz-prm-badtext">{l.line}</span>
                          <span className="qz-prm-badwhy">{l.reason}</span>
                        </li>
                      ) : null,
                    )}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="qz-prm-empty">
              Answers resolve against this quiz&rsquo;s answer text, results against
              your result sets. Nothing is guessed — a line that doesn&rsquo;t fully
              match is listed and skipped, never snapped to the closest answer.
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
