import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { DecisionRule, Quiz } from "../../../lib/quizSchema";
import type { OrderedQuestion } from "../../../lib/questionOrder";
import type { BuilderCategory } from "../../builder/stepProps";
import type { IndexedProduct } from "../../../lib/recommendationEngine";
import { createDecisionRule, splitCrossQuestionOr } from "../../../lib/quizMutations";
import { parsePastedRules, type PasteVocab } from "../../../lib/rulePaste";
import { useFocusTrap } from "../../qz-overlays";
import { useQzToast } from "../../qz-toast";
import { PASTE_COPY } from "./logicCopy";

// ════════════════════════════════════════════════════════════════════════════
// Logic-step handoff §6 — written rules (paste), rendered to the Live · Made
// By Mary artifact (L): a two-column .pastegrid. LEFT is the box — ghost
// grammar lines while empty, plus the answer / what-happens / result legend.
// RIGHT teaches while empty (the format card + two seed lines built from
// THIS quiz's own vocabulary, one click to copy in) and echoes the parse
// once text is present — every recognised part tinted by what it resolved
// to, so the merchant sees the parse rather than trusting it. Unmatched
// lines are listed with a reason and SKIPPED — nothing is snapped to a
// near-miss. Confirm writes the same decision_rules the builder writes
// (createDecisionRule per parsed line, one commit), so a pasted rule can be
// reopened in the builder for editing. Parser: app/lib/rulePaste.ts (FROZEN).
// ════════════════════════════════════════════════════════════════════════════

export function PasteRulesModal({
  questions,
  categories,
  productIndex,
  onClose,
  commit,
  getLatestDoc,
}: {
  questions: OrderedQuestion[];
  categories: BuilderCategory[];
  productIndex: readonly IndexedProduct[];
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

  // Live L — two seed lines built from THIS quiz's own vocabulary. Only
  // seeds that actually resolve through the frozen parser are offered.
  const seeds = useMemo(() => {
    const candidates: Array<{
      line: string;
      answers: string[];
      verb: string;
      target: string;
    }> = [];
    const a0 = questions[0]?.node.data.answers[0]?.text.trim();
    const cat0 = categories[0]?.name.trim();
    if (a0 && cat0)
      candidates.push({
        line: `when ${a0} then show ${cat0}`,
        answers: [a0],
        verb: "show",
        target: cat0,
      });
    const b0 = questions[1]?.node.data.answers[0]?.text.trim();
    const cat1 = (categories[1] ?? categories[0])?.name.trim();
    if (a0 && b0 && cat1)
      candidates.push({
        line: `when ${a0} and ${b0} then hide ${cat1}`,
        answers: [a0, b0],
        verb: "hide",
        target: cat1,
      });
    return candidates.filter((c) => {
      const parsed = parsePastedRules(c.line, vocab);
      return parsed.length === 1 && parsed[0]!.ok;
    });
  }, [questions, categories, vocab]);

  const totalProducts = productIndex.length;
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const handleCreate = () => {
    if (okLines.length === 0) return;
    // One commit over the LATEST doc (the autosave seam's post-await rule).
    // D13: the frozen parser still emits match "any" for a line whose
    // across-question connectors include "or"; the write splits such a line
    // into adjacent rules, one per question group, with the same verb and
    // recommendations and no `match` (identical under first-match-wins, and
    // every result is expressible in the rule window).
    let next = getLatestDoc();
    let created = 0;
    for (const line of okLines) {
      if (!line.ok) continue;
      const parsed: DecisionRule = {
        id: "paste",
        conditions: line.conditions,
        target_id: line.targetId,
        action: line.action,
        ...(line.match ? { match: line.match } : {}),
        ...(line.any_of ? { any_of: line.any_of } : {}),
      };
      for (const part of splitCrossQuestionOr(parsed, () => "paste")) {
        const before = next;
        next = createDecisionRule(next, {
          conditions: part.conditions,
          target_ids: [part.target_id],
          ...(part.action ? { action: part.action } : {}),
          ...(part.match ? { match: part.match } : {}),
          ...(part.any_of?.length ? { any_of: part.any_of } : {}),
        });
        if (next !== before) created++;
      }
    }
    commit(next);
    toast(PASTE_COPY.created(created));
    onClose();
  };

  if (typeof document === "undefined") return null;

  const hasText = lines.length > 0;

  return createPortal(
    <div className="qz-modal-scrim">
      <div
        ref={boxRef}
        className="qz-lm qz-lm-paste"
        role="dialog"
        aria-modal="true"
        aria-label={PASTE_COPY.title}
      >
        <header className="qz-lm-h">
          <h2>{PASTE_COPY.title}</h2>
          <button type="button" className="qz-lm-close" aria-label={PASTE_COPY.close} onClick={onClose}>
            ×
          </button>
        </header>

        <div className="qz-lm-b">
          <p id="paste-rules-help" className="qz-lm-pintro">
            {PASTE_COPY.intro}
          </p>
          <div className="qz-lm-pastegrid">
            {/* ── left: the box ── */}
            <div>
              <div className="qz-lm-plabel">{PASTE_COPY.yourRules}</div>
              <div className="qz-lm-ptawrap">
                <textarea
                  className="qz-lm-pta"
                  value={text}
                  rows={6}
                  onChange={(e) => setText(e.target.value)}
                  aria-label={PASTE_COPY.boxLabel}
                  aria-describedby="paste-rules-help"
                />
                {text.length === 0 ? (
                  // A bare textarea teaches nothing — the ghost carries the
                  // grammar's shape until something is typed.
                  <div className="qz-lm-ghost" aria-hidden>
                    <div className="qz-lm-gline">
                      <span className="qz-lm-pk">{PASTE_COPY.when}</span>{" "}
                      <span className="qz-lm-pa">{PASTE_COPY.answer}</span>{" "}
                      <span className="qz-lm-pk">{PASTE_COPY.then}</span>{" "}
                      <span className="qz-lm-pv">{PASTE_COPY.whatHappens}</span>{" "}
                      <span className="qz-lm-pr">{PASTE_COPY.result}</span>
                    </div>
                    <div className="qz-lm-gline">
                      <span className="qz-lm-pk">{PASTE_COPY.when}</span>{" "}
                      <span className="qz-lm-pa">{PASTE_COPY.answer}</span>{" "}
                      <span className="qz-lm-pk">{PASTE_COPY.and}</span>{" "}
                      <span className="qz-lm-pa">{PASTE_COPY.answer}</span>{" "}
                      <span className="qz-lm-pk">{PASTE_COPY.then}</span>{" "}
                      <span className="qz-lm-pv">{PASTE_COPY.whatHappens}</span>{" "}
                      <span className="qz-lm-pr">{PASTE_COPY.result}</span>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="qz-lm-pkey">
                <span>
                  <span className="qz-lm-pa">{PASTE_COPY.answer}</span> {PASTE_COPY.keyAnswer}
                </span>
                <span>
                  <span className="qz-lm-pv">{PASTE_COPY.whatHappens}</span> {PASTE_COPY.keyVerb}
                </span>
                <span>
                  <span className="qz-lm-pr">{PASTE_COPY.result}</span> {PASTE_COPY.keyResult}
                </span>
              </div>
            </div>

            {/* ── right: the format (empty) / what we understood (typed) ── */}
            {!hasText ? (
              <div>
                <div className="qz-lm-plabel">{PASTE_COPY.howTo}</div>
                <div className="qz-lm-fmtcard">
                  <div className="qz-lm-fmtline">{PASTE_COPY.onePerLine}</div>
                  {PASTE_COPY.examples.map((ex, i) => (
                    <div key={i} className="qz-lm-exline">
                      {ex.map(([kind, word], j) => (
                        <Fragment key={j}>
                          {j > 0 ? " " : null}
                          <span className={`qz-lm-${kind}`}>{word}</span>
                        </Fragment>
                      ))}
                    </div>
                  ))}
                </div>
                {seeds.length > 0 ? (
                  <div className="qz-lm-fmtcard">
                    <div className="qz-lm-fmtline">{PASTE_COPY.seedsTitle}</div>
                    {seeds.map((s) => (
                      <div key={s.line} className="qz-lm-fmtex">
                        {PASTE_COPY.when}{" "}
                        {s.answers.map((a, i) => (
                          <span key={i}>
                            {i > 0 ? ` ${PASTE_COPY.and} ` : ""}
                            <b>{a}</b>
                          </span>
                        ))}{" "}
                        {PASTE_COPY.then} <b>{s.verb}</b> {s.target}
                      </div>
                    ))}
                    <button
                      type="button"
                      className="qz-btn qz-lm-seedbtn"
                      onClick={() => setText(seeds.map((s) => s.line).join("\n"))}
                    >
                      {PASTE_COPY.tryExamples}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <div>
                <div className="qz-lm-plabel">{PASTE_COPY.review}</div>
                <div
                  className={`qz-lm-psum ${badLines.length === 0 ? "is-ok" : "is-warn"}`}
                  aria-live="polite"
                >
                  {badLines.length === 0 ? "✓ " : ""}
                  <b>{PASTE_COPY.matchedCount(okLines.length, lines.length)}</b>{" "}
                  {PASTE_COPY.matchedTail(lines.length)}
                </div>
                <div className="qz-lm-presults">
                  {lines.map((l) =>
                    l.ok ? (
                      <div key={l.lineNumber} className="qz-lm-pres is-ok">
                        <span className="qz-lm-ic" aria-hidden>
                          ✓
                        </span>
                        <span className="qz-lm-pb">
                          <span className="qz-lm-pl2">
                            {PASTE_COPY.whenCap}{" "}
                            {l.segments
                              .filter((s) => s.kind === "answer" || s.kind === "connector")
                              .map((s, i) =>
                                s.kind === "answer" ? (
                                  <b key={i}>{s.text}</b>
                                ) : (
                                  <span key={i}> {s.text} </span>
                                ),
                              )}{" "}
                            → <b>{l.segments.find((s) => s.kind === "verb")?.text}</b>{" "}
                            {l.segments.find((s) => s.kind === "target")?.text}
                          </span>
                          <span className="qz-lm-pe">
                            {PASTE_COPY.actsOn(catById.get(l.targetId)?.productIds.length ?? 0, totalProducts)}
                          </span>
                        </span>
                      </div>
                    ) : (
                      <div key={l.lineNumber} className="qz-lm-pres is-bad">
                        <span className="qz-lm-ic" aria-hidden>
                          ×
                        </span>
                        <span className="qz-lm-pb">
                          <span className="qz-lm-pl2">{l.line}</span>
                          <span className="qz-lm-pe">{l.reason}</span>
                        </span>
                      </div>
                    ),
                  )}
                </div>
                {/* Honesty line — states what the parser ACTUALLY forgives
                    (case + spacing), never the partial-text matching it
                    doesn't do. */}
                <div className="qz-lm-pguar">
                  {PASTE_COPY.guarantee} <b>{PASTE_COPY.guaranteeBold}</b>
                </div>
              </div>
            )}
          </div>
        </div>

        <footer className="qz-lm-f">
          <span>{PASTE_COPY.footer}</span>
          <span className="qz-lm-fright">
            <button type="button" className="qz-btn" onClick={onClose}>
              {PASTE_COPY.cancel}
            </button>
            <button
              type="button"
              className="qz-btn qz-btn-primary"
              disabled={okLines.length === 0}
              onClick={handleCreate}
            >
              {!hasText ? PASTE_COPY.addNone : PASTE_COPY.add(okLines.length)}
            </button>
          </span>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
