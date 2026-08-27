import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Quiz } from "../../../lib/quizSchema";
import type { OrderedQuestion } from "../../../lib/questionOrder";
import type { BuilderCategory } from "../../builder/stepProps";
import type { IndexedProduct } from "../../../lib/recommendationEngine";
import { createDecisionRule } from "../../../lib/quizMutations";
import { parsePastedRules, type PasteVocab } from "../../../lib/rulePaste";
import { useFocusTrap } from "../../qz-overlays";
import { useQzToast } from "../../qz-toast";

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

  const hasText = lines.length > 0;

  return createPortal(
    <div className="qz-modal-scrim">
      <div
        ref={boxRef}
        className="qz-lm qz-lm-paste"
        role="dialog"
        aria-modal="true"
        aria-label="Paste rules"
      >
        <header className="qz-lm-h">
          <h2>Paste rules</h2>
          <button type="button" className="qz-lm-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="qz-lm-b">
          <div className="qz-lm-pastegrid">
            {/* ── left: the box ── */}
            <div>
              <div className="qz-lm-plabel">Your rules</div>
              <div className="qz-lm-ptawrap">
                <textarea
                  className="qz-lm-pta"
                  value={text}
                  rows={6}
                  onChange={(e) => setText(e.target.value)}
                  aria-label="Rules, one per line"
                />
                {text.length === 0 ? (
                  // A bare textarea teaches nothing — the ghost carries the
                  // grammar's shape until something is typed.
                  <div className="qz-lm-ghost" aria-hidden>
                    <div className="qz-lm-gline">
                      <span className="qz-lm-pk">when</span>{" "}
                      <span className="qz-lm-pa">answer</span>{" "}
                      <span className="qz-lm-pk">then</span>{" "}
                      <span className="qz-lm-pv">what happens</span>{" "}
                      <span className="qz-lm-pr">result</span>
                    </div>
                    <div className="qz-lm-gline">
                      <span className="qz-lm-pk">when</span>{" "}
                      <span className="qz-lm-pa">answer</span>{" "}
                      <span className="qz-lm-pk">and</span>{" "}
                      <span className="qz-lm-pa">answer</span>{" "}
                      <span className="qz-lm-pk">then</span>{" "}
                      <span className="qz-lm-pv">what happens</span>{" "}
                      <span className="qz-lm-pr">result</span>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="qz-lm-pkey">
                <span>
                  <span className="qz-lm-pa">answer</span> what the shopper picked
                </span>
                <span>
                  <span className="qz-lm-pv">what happens</span> show · pin · hide
                </span>
                <span>
                  <span className="qz-lm-pr">result</span> from your recommendations
                </span>
              </div>
            </div>

            {/* ── right: the format (empty) / what we understood (typed) ── */}
            {!hasText ? (
              <div>
                <div className="qz-lm-plabel">The format</div>
                <div className="qz-lm-fmtcard">
                  <div className="qz-lm-fmtline">One rule per line</div>
                  <div className="qz-lm-exline">
                    <span className="qz-lm-pk">when</span>{" "}
                    <span className="qz-lm-pa">A necklace</span>{" "}
                    <span className="qz-lm-pk">then</span>{" "}
                    <span className="qz-lm-pv">pin</span>{" "}
                    <span className="qz-lm-pr">Gift cards</span>
                  </div>
                  <div className="qz-lm-exline">
                    <span className="qz-lm-pk">when</span>{" "}
                    <span className="qz-lm-pa">A ring</span>{" "}
                    <span className="qz-lm-pk">or</span>{" "}
                    <span className="qz-lm-pa">A bracelet</span>{" "}
                    <span className="qz-lm-pk">then</span>{" "}
                    <span className="qz-lm-pv">pin</span>{" "}
                    <span className="qz-lm-pr">Gift cards</span>
                  </div>
                  <div className="qz-lm-exline">
                    <span className="qz-lm-pk">when</span>{" "}
                    <span className="qz-lm-pa">Warm golds</span>{" "}
                    <span className="qz-lm-pk">and</span>{" "}
                    <span className="qz-lm-pa">A necklace</span>{" "}
                    <span className="qz-lm-pk">then</span>{" "}
                    <span className="qz-lm-pv">show</span>{" "}
                    <span className="qz-lm-pr">Necklace</span>
                  </div>
                  <div className="qz-lm-exline">
                    <span className="qz-lm-pk">when</span>{" "}
                    <span className="qz-lm-pa">A necklace</span>{" "}
                    <span className="qz-lm-pk">or</span>{" "}
                    <span className="qz-lm-pa">A ring</span>{" "}
                    <span className="qz-lm-pk">and</span>{" "}
                    <span className="qz-lm-pa">Warm golds</span>{" "}
                    <span className="qz-lm-pk">or</span>{" "}
                    <span className="qz-lm-pa">Silver tones</span>{" "}
                    <span className="qz-lm-pk">then</span>{" "}
                    <span className="qz-lm-pv">pin</span>{" "}
                    <span className="qz-lm-pr">Gift cards</span>
                  </div>
                </div>
                {seeds.length > 0 ? (
                  <div className="qz-lm-fmtcard">
                    <div className="qz-lm-fmtline">From this quiz, to copy:</div>
                    {seeds.map((s) => (
                      <div key={s.line} className="qz-lm-fmtex">
                        when{" "}
                        {s.answers.map((a, i) => (
                          <span key={i}>
                            {i > 0 ? " and " : ""}
                            <b>{a}</b>
                          </span>
                        ))}{" "}
                        then <b>{s.verb}</b> {s.target}
                      </div>
                    ))}
                    <button
                      type="button"
                      className="qz-btn qz-lm-seedbtn"
                      onClick={() => setText(seeds.map((s) => s.line).join("\n"))}
                    >
                      Use these as a starting point
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <div>
                <div className="qz-lm-plabel">What we understood</div>
                <div
                  className={`qz-lm-psum ${badLines.length === 0 ? "is-ok" : "is-warn"}`}
                  aria-live="polite"
                >
                  {badLines.length === 0 ? "✓ " : ""}
                  <b>
                    {okLines.length} of {lines.length}
                  </b>{" "}
                  {lines.length === 1 ? "line" : "lines"} matched your quiz.
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
                            When{" "}
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
                            Acts on {catById.get(l.targetId)?.productIds.length ?? 0} of{" "}
                            {totalProducts} products
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
                  Capitalisation and spacing are forgiven — names must match your
                  answers word for word.{" "}
                  <b>
                    Anything we cannot match is listed here and skipped, never
                    guessed.
                  </b>
                </div>
              </div>
            )}
          </div>
        </div>

        <footer className="qz-lm-f">
          <span>Pasted rules are created in order and edit like any other.</span>
          <span className="qz-lm-fright">
            <button type="button" className="qz-btn" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="qz-btn qz-btn-primary"
              disabled={okLines.length === 0}
              onClick={handleCreate}
            >
              {!hasText
                ? "Check rules"
                : `Create ${okLines.length} ${okLines.length === 1 ? "rule" : "rules"}`}
            </button>
          </span>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
