import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Quiz } from "../../../lib/quizSchema";
import { deleteNode } from "../../../lib/quizMutations";
import { QzModal } from "../../qz-overlays";
import {
  useFunnelBar,
  FunnelSaveChip,
  type FunnelBarOverride,
} from "../funnelChrome";
import type { RegenApi } from "../questionsLogicV3/Step3Shell";
import {
  COVER_SCREEN,
  EMAIL_SCREEN,
  OVERVIEW_SCREEN,
  walkSteps,
  unreadCopy,
} from "./walkModel";
import { WalkQuestion } from "./WalkQuestion";
import { QuestionComposer } from "./QuestionComposer";
import { EmailScreen, emailSummary } from "./EmailScreen";

type Props = {
  doc: Quiz;
  commit: (doc: Quiz) => void;
  isSaving: boolean;
  savedAt: string | null;
  saveError: string | null;
  onRetry: () => void;
  navigating: boolean;
  onContinue: () => void;
  regen: RegenApi;
};
export function QuestionsWalkthrough({
  doc,
  commit,
  isSaving,
  savedAt,
  saveError,
  onRetry,
  navigating,
  onContinue,
  regen,
}: Props) {
  const steps = useMemo(() => walkSteps(doc), [doc]);
  const ids = useMemo(
    () => [...steps.map((s) => s.node.id), EMAIL_SCREEN],
    [steps],
  );
  const [selected, setSelected] = useState(COVER_SCREEN);
  const [covered, setCovered] = useState<Set<string>>(() => new Set());
  const [modal, setModal] = useState<
    "gate" | "overview" | "delete" | "regenerate" | "composer" | null
  >(null);
  const [peek, setPeek] = useState<{ id: string; x: number; y: number } | null>(
    null,
  );
  const peekTimer = useRef<ReturnType<typeof setTimeout>>();
  const strip = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  const cancel = useRef<HTMLButtonElement>(null);
  const active =
    selected === COVER_SCREEN ||
    selected === OVERVIEW_SCREEN ||
    ids.includes(selected)
      ? selected
      : ids[0]!;
  const unread = useMemo(
    () => ids.filter((id) => !covered.has(id)),
    [ids, covered],
  );
  const busy = Boolean(regen.regeneratingId) || navigating;
  const current = steps.find((s) => s.node.id === active);
  const visit = useCallback((id: string) => {
    setSelected(id);
    if (id !== COVER_SCREEN && id !== OVERVIEW_SCREEN)
      setCovered((old) => new Set([...old, id]));
    setPeek(null);
  }, []);
  const openGate = useCallback(() => setModal("gate"), []);
  const bar = useMemo<FunnelBarOverride>(
    () => ({
      saveChip: (
        <FunnelSaveChip
          isSaving={isSaving}
          savedAt={savedAt}
          saveError={saveError}
          onRetry={onRetry}
          isAiPaused={Boolean(regen.regeneratingId)}
        />
      ),
      continueSpec: {
        label: "Continue →",
        blocked: unread.length > 0,
        disabled: busy,
        title: unread.length
          ? `${unread.length} screens still to review`
          : undefined,
        onClick: unread.length ? openGate : onContinue,
      },
    }),
    [
      isSaving,
      savedAt,
      saveError,
      onRetry,
      regen.regeneratingId,
      unread.length,
      busy,
      openGate,
      onContinue,
    ],
  );
  useFunnelBar(bar);
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const sync = () => {
      setOverflow(el.scrollWidth > el.clientWidth + 1);
      const chip = el.querySelector<HTMLElement>('[aria-current="step"]');
      if (chip)
        el.scrollLeft =
          chip.offsetLeft -
          el.offsetLeft -
          (el.clientWidth - chip.offsetWidth) / 2;
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => observer.disconnect();
  }, [active, ids]);
  useEffect(
    () => () => {
      if (peekTimer.current) clearTimeout(peekTimer.current);
    },
    [],
  );
  const stopPeek = () => {
    if (peekTimer.current) clearTimeout(peekTimer.current);
    setPeek(null);
  };
  const titleFor = (id: string) => {
    const s = steps.find((s) => s.node.id === id);
    return s?.node.type === "question" || s?.node.type === "message"
      ? s.node.data.text
      : id === EMAIL_SCREEN
        ? "Email capture"
        : "Content screen";
  };
  const peekNode = steps.find((s) => s.node.id === peek?.id)?.node;
  const navigate = (direction: number) => {
    const order = [COVER_SCREEN, ...ids, OVERVIEW_SCREEN];
    const idx = order.indexOf(active);
    visit(order[Math.max(0, Math.min(order.length - 1, idx + direction))]!);
  };
  const ledger = (mode: "read" | "edit") => (
    <div className="qz-walk-ledger" data-mode={mode}>
      {steps.map((s) => (
        <section key={s.node.id}>
          <div className="qz-walk-ledger-heading">
            <h3>
              {s.qIndex ? `Q${s.qIndex} · ` : ""}
              {titleFor(s.node.id)}
            </h3>
            {s.node.type === "question" && (
              <span>{s.node.data.answers.length} answers</span>
            )}
            {mode === "edit" && (
              <button
                type="button"
                className="qz-btn qz-btn-ghost qz-btn-sm"
                onClick={() => visit(s.node.id)}
              >
                Open
              </button>
            )}
          </div>
          {s.node.type === "question" ? (
            <ol>
              {s.node.data.answers.map((a) => (
                <li key={a.id}>{a.text}</li>
              ))}
            </ol>
          ) : (
            <p>Content screen</p>
          )}
        </section>
      ))}
      <section>
        <div className="qz-walk-ledger-heading">
          <h3>Email capture</h3>
          {mode === "edit" && (
            <button
              type="button"
              className="qz-btn qz-btn-ghost qz-btn-sm"
              onClick={() => visit(EMAIL_SCREEN)}
            >
              Open
            </button>
          )}
        </div>
        <p>{emailSummary(doc)}</p>
      </section>
      {mode === "edit" && (
        <button
          type="button"
          className="qz-walk-add"
          onClick={() => setModal("composer")}
        >
          + Add a question
        </button>
      )}
    </div>
  );
  const qLabels = unread.flatMap((id) => {
    const s = steps.find((s) => s.node.id === id);
    return s?.qIndex ? [String(s.qIndex)] : [];
  });
  const otherLabels = unread
    .filter((id) => !steps.find((s) => s.node.id === id)?.qIndex)
    .map(titleFor);
  return (
    <div className="qz-walk" data-testid="questions-walkthrough">
      {active !== COVER_SCREEN && (
        <div className="qz-walk-strip">
          <div
            ref={strip}
            className={`qz-walk-chiprun${overflow ? " is-overflow" : ""}`}
          >
            {steps.map((s) => (
              <button
                type="button"
                key={s.node.id}
                disabled={busy}
                aria-label={
                  s.qIndex ? `Question ${s.qIndex}` : titleFor(s.node.id)
                }
                aria-current={active === s.node.id ? "step" : undefined}
                className={`qz-walk-chip${covered.has(s.node.id) ? " is-covered" : ""}`}
                onClick={() => visit(s.node.id)}
                onMouseEnter={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  peekTimer.current = setTimeout(
                    () =>
                      setPeek({
                        id: s.node.id,
                        x: Math.min(
                          window.innerWidth - 310,
                          Math.max(8, r.left),
                        ),
                        y: r.bottom + 8,
                      }),
                    400,
                  );
                }}
                onMouseLeave={stopPeek}
                onFocus={() => setPeek(null)}
              >
                {s.qIndex ? `Q${s.qIndex}` : "◇"}
                {covered.has(s.node.id) && (
                  <span className="qz-walk-tick" aria-label="Reviewed">
                    ✓
                  </span>
                )}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="qz-walk-chip qz-walk-addchip"
            aria-label="Add question"
            disabled={busy}
            onClick={() => setModal("composer")}
          >
            +
          </button>
          <button
            type="button"
            className={`qz-walk-chip${covered.has(EMAIL_SCREEN) ? " is-covered" : ""}`}
            aria-label="Email capture"
            disabled={busy}
            aria-current={active === EMAIL_SCREEN ? "step" : undefined}
            onClick={() => visit(EMAIL_SCREEN)}
          >
            ✉
          </button>
          <span
            className={`qz-walk-connector${unread.length === 0 ? " is-covered" : ""}`}
          />
          <button
            type="button"
            className="qz-btn qz-btn-sm"
            disabled={busy}
            onClick={() =>
              unread.length ? setModal("overview") : visit(OVERVIEW_SCREEN)
            }
          >
            Overview
          </button>
        </div>
      )}
      {active === COVER_SCREEN ? (
        <div className="qz-walk-cover">
          <h1>Review and edit your questions and answers</h1>
          <p>
            {steps.filter((s) => s.kind === "question").length} questions and{" "}
            {steps.reduce(
              (n, s) =>
                n +
                (s.node.type === "question" ? s.node.data.answers.length : 0),
              0,
            )}{" "}
            answers, written from your catalog. Read them the way a shopper will
            and change anything that doesn’t sound like you. They’re what your
            recommendations get built from.
          </p>
          <button
            type="button"
            className="qz-btn qz-btn-primary"
            onClick={() => visit(ids[0]!)}
          >
            Start →
          </button>
        </div>
      ) : (
        <>
          <div className="qz-walk-body">
            {active === OVERVIEW_SCREEN ? (
              <>
                <h2 className="qz-walk-email-title">
                  Your questions, ready to review
                </h2>
                {ledger("edit")}
                <p className="qz-walk-description">
                  End of questions · Email wording and results are edited later.
                </p>
              </>
            ) : active === EMAIL_SCREEN ? (
              <EmailScreen doc={doc} commit={commit} />
            ) : current ? (
              <WalkQuestion
                doc={doc}
                node={current.node}
                commit={commit}
                busy={busy}
                onDelete={() => setModal("delete")}
                onRegenerate={() => setModal("regenerate")}
              />
            ) : null}
            {regen.regeneratingId && (
              <p role="status">Regenerating this question…</p>
            )}
            {regen.undoNodeId && (
              <div role="status">
                Question regenerated.{" "}
                <button
                  type="button"
                  className="qz-btn qz-btn-sm"
                  onClick={regen.onUndoRegenerate}
                >
                  Undo
                </button>
              </div>
            )}
            {regen.regenError && (
              <div role="alert">
                {regen.regenError.message}{" "}
                <button
                  type="button"
                  className="qz-btn qz-btn-sm"
                  onClick={() => {
                    if (regen.regenError) {
                      visit(regen.regenError.nodeId);
                      setModal("regenerate");
                    }
                  }}
                >
                  Retry
                </button>
                <button
                  type="button"
                  className="qz-btn qz-btn-ghost"
                  onClick={regen.onDismissRegenError}
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>
          <footer className="qz-walk-footer">
            <button
              type="button"
              className="qz-btn"
              disabled={busy}
              onClick={() => navigate(-1)}
            >
              ‹ Previous
            </button>
            <button
              type="button"
              className="qz-btn qz-btn-primary"
              disabled={busy}
              onClick={() =>
                active === OVERVIEW_SCREEN
                  ? unread.length
                    ? openGate()
                    : onContinue()
                  : navigate(1)
              }
            >
              {active === OVERVIEW_SCREEN
                ? "Continue →"
                : active === EMAIL_SCREEN
                  ? "Finish ›"
                  : "Next ›"}
            </button>
          </footer>
        </>
      )}
      <QzModal
        open={modal === "gate"}
        onClose={() => setModal(null)}
        size="sm"
        title={
          otherLabels.length
            ? "Some screens are still unread"
            : "Some questions are still unread"
        }
        initialFocusRef={cancel}
        footer={
          <>
            <button
              ref={cancel}
              type="button"
              className="qz-btn qz-btn-primary"
              onClick={() => {
                setModal(null);
                visit(unread[0] ?? EMAIL_SCREEN);
              }}
            >
              Review them
            </button>
            <button
              type="button"
              className="qz-btn"
              onClick={() => {
                setModal(null);
                onContinue();
              }}
            >
              Continue anyway
            </button>
          </>
        }
      >
        You haven’t opened{" "}
        {qLabels.length ? `questions ${unreadCopy(qLabels)}` : ""}
        {qLabels.length && otherLabels.length ? " and " : ""}
        {otherLabels.join(" and ")}. Review them before continuing.
      </QzModal>
      <QzModal
        open={modal === "overview"}
        onClose={() => setModal(null)}
        size="lg"
        title="Overview"
      >
        {ledger("read")}
      </QzModal>
      <QzModal
        open={modal === "delete"}
        onClose={() => setModal(null)}
        destructive
        size="sm"
        title={
          current?.node.type === "question"
            ? "Delete this question?"
            : "Delete this message screen?"
        }
        initialFocusRef={cancel}
        footer={
          <>
            <button
              type="button"
              ref={cancel}
              className="qz-btn"
              onClick={() => setModal(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="qz-btn qz-btn-danger"
              onClick={() => {
                if (!current) return;
                const index = ids.indexOf(current.node.id);
                commit(deleteNode(doc, current.node.id));
                setModal(null);
                visit(ids[index + 1] ?? ids[index - 1] ?? EMAIL_SCREEN);
              }}
            >
              Delete
            </button>
          </>
        }
      >
        This removes{" "}
        {current?.node.type === "question"
          ? `the question and its ${current.node.data.answers.length} answers`
          : "the message screen"}
        , including references to them in Logic.
      </QzModal>
      <QzModal
        open={modal === "regenerate"}
        onClose={() => setModal(null)}
        destructive
        size="sm"
        title="Regenerate this question?"
        initialFocusRef={cancel}
        footer={
          <>
            <button
              type="button"
              ref={cancel}
              className="qz-btn"
              onClick={() => setModal(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="qz-btn qz-btn-primary"
              disabled={!current || busy}
              onClick={() => {
                if (current) {
                  regen.onRegenerate(current.node.id);
                  setModal(null);
                }
              }}
            >
              Regenerate
            </button>
          </>
        }
      >
        This replaces the wording, question type, selection settings and
        answers. Answer mappings are retained only where wording is unchanged.
        You will have 10 seconds to undo.
      </QzModal>
      {modal === "composer" && (
        <QuestionComposer
          doc={doc}
          onClose={() => setModal(null)}
          onAdd={(next, id) => {
            commit(next);
            setModal(null);
            visit(id);
          }}
        />
      )}
      {peek &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="qz-walk-peek"
            role="tooltip"
            style={{ left: peek.x, top: peek.y }}
          >
            <strong>{titleFor(peek.id)}</strong>
            {peekNode?.type === "question" && (
              <ol>
                {peekNode.data.answers.map((a) => (
                  <li key={a.id}>{a.text}</li>
                ))}
              </ol>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
