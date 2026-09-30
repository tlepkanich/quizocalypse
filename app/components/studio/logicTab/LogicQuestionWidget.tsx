import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  RefObject,
} from "react";
import type { Quiz, Answer } from "../../../lib/quizSchema";
import type { BuilderCategory } from "../../builder/stepProps";
import type { IndexedProduct } from "../../../lib/recommendationEngine";
import type { OrderedQuestion } from "../../../lib/questionOrder";
import type { AttributeReadout } from "../../../lib/attributeClustering";
import {
  addAnswerTarget,
  removeAnswerTarget,
  setAnswerFilterValues,
  setAnswerText,
  setQuestionText,
  ANSWER_TEXT_MAX,
  QUESTION_TEXT_MAX,
} from "../../../lib/quizMutations";
import { answerTargets } from "../../../lib/recommendDecider";
import { routingConflicts } from "../../../lib/routeTrace";
import { filterAnswerMatchCount } from "../../../lib/filterMatching";
import { QzPopover } from "../../qz-overlays";
import type { SaveToken } from "../saveTracker";
import {
  ProductCountButton,
  QuestionRoleControl,
  RouteMenuButton,
  type PaneUndo,
} from "./LogicTabMenus";
import { ValuePickerPopover, type FilterValueSet } from "./ValuePickerPopover";
import { QuestionTypePopover } from "./QuestionTypePopover";
import { InlineText } from "./InlineText";
import { useRowFit } from "./useRowFit";
import { answerHasSelection, baseValueSet } from "./logicTabFields";
import {
  CHOOSE_A_RESULT,
  PANE_COPY,
  PICKER_COPY,
  RAIL_COPY,
  ROLE_BUTTON,
  ROLE_TAG,
  TRAY_COPY,
  letterKey,
} from "./logicCopy";

// ════════════════════════════════════════════════════════════════════════════
// Logic step redesign — Filter Results + Rules, Edit: the question RAIL and
// the question PANE (mock railItems, pane, picker, trayMoreHTML, fitRow,
// ACT.sel/arm/cell/toggletarget/untarget; handoff "Filter Results + Rules ·
// Edit", "Inline text editing"). LogicTabCard supplies the third column
// (the rules column, D22) through `aside`.
//
//   rail   QUESTIONS n · rows (number, 2-line text, Picks/Narrows/Info tag)
//          · "+ Add question" · the role counts pinned at the foot
//   pane   title (inline editor, 150) + type line (Question type popover)
//          · the role control on the right ("Question N does")
//          · the RECOMMENDATIONS tray (the picking question only) or a
//            hairline · the answer rows: key · text (inline, 60) · cell ·
//            route
//
// The CELL is the control (div role="button", Enter/Space): the chip, its
// count and its × are real buttons that stop propagation. The picks picker
// writes on every click and stays open; the value picker stages and writes
// on Done. Arm and place: a tray chip arms (violet), every cell of the
// question turns into a drop target, one click adds it (addAnswerTarget) and
// disarms; Esc, another question, a role change or a style change disarm.
// Colours (D14): green = on no answer of this question, black = placed,
// violet = armed. Tray ORDER is the open half of D14: catalogue order, in
// ONE comparator (`trayOrder`).
// ════════════════════════════════════════════════════════════════════════════

type QuizDoc = Quiz;
type Commit = (doc: QuizDoc) => void;
type DisplayRole = "decides" | "filter" | "info";
type RulesByAnswer = Map<
  string,
  Array<{ index: number; rule: NonNullable<QuizDoc["decision_rules"]>[number] }>
>;

/** A host's request to focus one control of a question (check popover rows). */
export type PaneFocusRequest = {
  nonce: number;
  questionId: string;
  control?: "role" | "route" | "picks" | "values" | "required";
  answerId?: string;
};

/** The recommendation kinds the picks picker filters by (D18: "Tags"). */
type RecKind = keyof typeof PICKER_COPY.kinds;
const REC_KINDS: RecKind[] = ["collection", "product", "tag", "group"];
function recKindOf(cat: BuilderCategory): RecKind {
  if (cat.source === "collection" || cat.source === "smart_collection")
    return "collection";
  if (cat.source === "product") return "product";
  if (cat.source === "tag") return "tag";
  return "group";
}

// The rail only has to make a question recognisable: the trailing instruction
// ("Select all that apply.") repeats across questions, so it is dropped before
// the two-line clamp. Full text stays on hover.
function shortQ(t: string): string {
  const i = t.indexOf("?");
  if (i > 0 && i < t.length - 1) return t.slice(0, i + 1);
  const j = t.indexOf(". ");
  return j > 0 ? t.slice(0, j + 1) : t;
}

function displayRole(
  role: "decides" | "qualifier" | "filter" | undefined,
  rulesOnly: boolean,
): DisplayRole {
  if (rulesOnly) return "info";
  if (role === "decides") return "decides";
  if (role === "filter") return "filter";
  return "info";
}

/** One recommendation as the pane (and the Table's picker) sees it. */
export interface RecCard {
  cat: BuilderCategory;
  kind: RecKind;
  count: number;
}

/** This quiz's own recommendations as picker cards (D15: quizId set). */
export function recCards(categories: readonly BuilderCategory[]): RecCard[] {
  return categories
    .filter((c) => c.quizId != null)
    .map((c) => ({ cat: c, kind: recKindOf(c), count: c.productIds.length }));
}

/** D14 (open half): the tray's order lives HERE and nowhere else. Catalogue
 *  order today; "used last" would be a one-line change. */
function trayOrder(
  recs: readonly RecCard[],
  _usedBy: ReadonlyMap<string, number>,
): RecCard[] {
  return [...recs];
}

/** The newest document this widget knows: the host's `doc` prop, or a
 *  commit made here that the host has not rendered back yet (a blur commit
 *  and a click in the same event must never overwrite each other). */
export function useDocStore(
  doc: QuizDoc,
  commit: Commit | undefined,
  commitTracked: ((doc: QuizDoc) => SaveToken) | undefined,
) {
  const ref = useRef(doc);
  const lastProp = useRef(doc);
  if (lastProp.current !== doc) {
    lastProp.current = doc;
    ref.current = doc;
  }
  const latest = useCallback(() => ref.current, []);
  const put = useCallback(
    (next: QuizDoc) => {
      if (!commit || next === ref.current) return;
      ref.current = next;
      commit(next);
    },
    [commit],
  );
  const putTracked = useCallback(
    (next: QuizDoc): SaveToken | void => {
      if (!commit) return;
      ref.current = next;
      if (commitTracked) return commitTracked(next);
      commit(next);
    },
    [commit, commitTracked],
  );
  return { latest, put, putTracked };
}
export type DocStore = ReturnType<typeof useDocStore>;

export function LogicQuestionWidget({
  doc,
  questions,
  categories,
  colTitleById,
  productIndex,
  readout,
  qIndexByNodeId: _qIndexByNodeId,
  commit,
  commitTracked,
  undo,
  rulesOnly,
  deciderQIndex,
  hasNarrowFields,
  lastSyncAt,
  shopifyAdminDomain,
  rulesByAnswer: _rulesByAnswer,
  selectedId,
  onSelect,
  onAddQuestion,
  aside,
  focusRequest,
}: {
  doc: QuizDoc;
  questions: OrderedQuestion[];
  /** Every category the workspace knows (quiz-scoped + shop-global groups). */
  categories: BuilderCategory[];
  colTitleById: Map<string, string>;
  productIndex: IndexedProduct[];
  readout: AttributeReadout;
  qIndexByNodeId: Map<string, number>;
  commit?: Commit;
  /** useQuizDraft.commitTracked: the inline editors' save pill (D8). */
  commitTracked?: (doc: QuizDoc) => SaveToken;
  /** The card's ONE Undo run (D7/D9). */
  undo?: PaneUndo;
  rulesOnly: boolean;
  deciderQIndex: number | null;
  hasNarrowFields: boolean;
  lastSyncAt?: string | null;
  shopifyAdminDomain?: string | null;
  rulesByAnswer: RulesByAnswer;
  selectedId: string | null;
  onSelect: (nodeId: string) => void;
  onAddQuestion?: () => void;
  /** Logic step redesign (D22): a THIRD grid column after the pane (the
   *  rules column in Filter Results + Rules). LogicTabCard supplies it. */
  aside?: ReactNode;
  /** Focus one control of the selected question (check popover rows). */
  focusRequest?: PaneFocusRequest | null;
}) {
  const selected =
    questions.find((q) => q.node.id === selectedId) ?? questions[0] ?? null;
  const store = useDocStore(doc, commit, commitTracked);
  const catById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );
  const productById = useMemo(
    () => new Map(productIndex.map((p) => [p.product_id, p])),
    [productIndex],
  );
  // The pool is this quiz's own Category rows (quizId set): the
  // recommendations step 1 picked, the groups it created, the rule targets it
  // materialised (D15). Shop-global groups stay out.
  const recs = useMemo<RecCard[]>(() => recCards(categories), [categories]);

  // Arm and place — one armed chip per widget. Disarmed by another question,
  // a role change, a style change (the card remounts on it) and Esc.
  const [armed, setArmed] = useState<string | null>(null);
  useEffect(() => setArmed(null), [selected?.node.id]);
  useEffect(() => {
    if (!armed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // Esc closes the innermost thing first: an open popover or window.
      if (document.querySelector(".qz-popover, .qz-modal-scrim")) return;
      setArmed(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [armed]);
  // The cell you changed flashes briefly so the eye lands on what moved.
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<number | null>(null);
  const markChanged = useCallback((answerId: string) => {
    setFlash(answerId);
    if (flashTimer.current != null) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 2600);
  }, []);
  useEffect(
    () => () => {
      if (flashTimer.current != null) window.clearTimeout(flashTimer.current);
    },
    [],
  );

  const counts = useMemo(() => {
    const c = { decides: 0, filter: 0, info: 0 };
    for (const q of questions) c[displayRole(q.node.data.role, rulesOnly)]++;
    return c;
  }, [questions, rulesOnly]);

  // A focus request (check popover rows): select is the card's job; the pane
  // focuses the control it names once the question's pane is on screen.
  const paneRef = useRef<HTMLDivElement>(null);
  const lastNonce = useRef<number | null>(null);
  useEffect(() => {
    const req = focusRequest;
    if (!req || req.nonce === lastNonce.current || !req.control) return;
    if (selected?.node.id !== req.questionId) return;
    lastNonce.current = req.nonce;
    setArmed(null);
    const id = window.requestAnimationFrame(() => {
      const pane = paneRef.current;
      if (!pane) return;
      const row = req.answerId
        ? pane.querySelector<HTMLElement>(
            `[data-answer-row="${CSS.escape(req.answerId)}"]`,
          )
        : null;
      const scope = row ?? pane;
      let el: HTMLElement | null = null;
      if (req.control === "role" || req.control === "required")
        el = pane.querySelector<HTMLElement>('[data-pane-control="role"]');
      else if (req.control === "route")
        el = scope.querySelector<HTMLElement>('[data-pane-control="route"]');
      else el = scope.querySelector<HTMLElement>("[data-pane-cell]");
      if (!el) return;
      el.scrollIntoView({ block: "nearest" });
      el.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(id);
  }, [focusRequest, selected?.node.id]);

  return (
    <div className={`qz-lw-grid qz-lg-grid${aside ? " qz-lw-grid--3" : ""}`}>
      <div className="qz-lw-rail qz-lg-rail">
        <div className="qz-lg-railhead">
          <span className="qz-lg-kick">{RAIL_COPY.kicker}</span>
          <span className="qz-lg-railn">{questions.length}</span>
        </div>
        {questions.map((q) => {
          const role = displayRole(q.node.data.role, rulesOnly);
          const on = selected?.node.id === q.node.id;
          return (
            <button
              key={q.node.id}
              type="button"
              className={`qz-lg-qi${on ? " is-on" : ""}`}
              data-node-id={q.node.id}
              aria-pressed={on}
              title={q.node.data.text}
              onClick={() => {
                setArmed(null);
                onSelect(q.node.id);
              }}
            >
              <span className="qz-lg-qn">{q.qIndex}</span>
              <span className="qz-lg-qtxt">{shortQ(q.node.data.text)}</span>
              {!rulesOnly ? (
                <span className={`qz-lg-qtag is-${role}`}>
                  {ROLE_TAG[role]}
                </span>
              ) : null}
            </button>
          );
        })}
        {onAddQuestion ? (
          <button
            type="button"
            className="qz-lg-qadd"
            data-testid="logic-add-question"
            onClick={onAddQuestion}
          >
            {RAIL_COPY.addQuestion}
          </button>
        ) : null}
        {!rulesOnly ? (
          <div
            className="qz-lg-railcount"
            aria-label={RAIL_COPY.countsLabel}
            role="group"
          >
            <span>
              <i className="qz-lg-dot is-decides" aria-hidden />
              {ROLE_TAG.decides} {counts.decides}
            </span>
            <span>
              <i className="qz-lg-dot is-filter" aria-hidden />
              {ROLE_TAG.filter} {counts.filter}
            </span>
            <span>
              <i className="qz-lg-dot is-info" aria-hidden />
              {ROLE_TAG.info} {counts.info}
            </span>
          </div>
        ) : null}
      </div>
      <div className="qz-lg-detail" ref={paneRef}>
        {selected ? (
          <QuestionPane
            key={selected.node.id}
            doc={doc}
            store={store}
            q={selected}
            questions={questions}
            rulesOnly={rulesOnly}
            catById={catById}
            colTitleById={colTitleById}
            productIndex={productIndex}
            productById={productById}
            readout={readout}
            editable={Boolean(commit)}
            undo={undo}
            deciderQIndex={deciderQIndex}
            hasNarrowFields={hasNarrowFields}
            lastSyncAt={lastSyncAt}
            shopifyAdminDomain={shopifyAdminDomain}
            recs={recs}
            armed={armed}
            setArmed={setArmed}
            flash={flash}
            markChanged={markChanged}
          />
        ) : (
          <p className="qz-lg-empty">{PANE_COPY.noQuestions}</p>
        )}
      </div>
      {aside ?? null}
    </div>
  );
}

// ── the ONE pane ────────────────────────────────────────────────────────────
function QuestionPane({
  doc,
  store,
  q,
  questions,
  rulesOnly,
  catById,
  colTitleById,
  productIndex,
  productById,
  readout,
  editable,
  undo,
  deciderQIndex,
  hasNarrowFields,
  lastSyncAt,
  shopifyAdminDomain,
  recs,
  armed,
  setArmed,
  flash,
  markChanged,
}: {
  doc: QuizDoc;
  store: DocStore;
  q: OrderedQuestion;
  questions: OrderedQuestion[];
  rulesOnly: boolean;
  catById: Map<string, BuilderCategory>;
  colTitleById: Map<string, string>;
  productIndex: IndexedProduct[];
  productById: Map<string, IndexedProduct>;
  readout: AttributeReadout;
  editable: boolean;
  undo?: PaneUndo;
  deciderQIndex: number | null;
  hasNarrowFields: boolean;
  lastSyncAt?: string | null;
  shopifyAdminDomain?: string | null;
  recs: RecCard[];
  armed: string | null;
  setArmed: (id: string | null) => void;
  flash: string | null;
  markChanged: (answerId: string) => void;
}) {
  const role = displayRole(q.node.data.role, rulesOnly);
  const answers = q.node.data.answers;
  const isScale = q.node.data.question_type === "rating";
  const titleColRef = useRef<HTMLDivElement>(null);
  // Which recommendations this question's answers already hold: green in the
  // tray and the picker when on none of them (D14).
  const usedBy = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of answers)
      for (const t of answerTargets(a)) m.set(t, (m.get(t) ?? 0) + 1);
    return m;
  }, [answers]);
  // §6 routing (option A) — the multi-select first-authored-wins rule stays
  // implicit at runtime but stops being invisible.
  const conflicts = useMemo(
    () =>
      role === "decides" && q.node.data.question_type === "multi_select"
        ? routingConflicts(doc, q.node.id)
        : [],
    [doc, q.node.id, q.node.data.question_type, role],
  );

  const place = (answer: Answer, catId: string) => {
    store.put(addAnswerTarget(store.latest(), q.node.id, answer.id, catId));
    markChanged(answer.id);
  };
  const removeTarget = (answer: Answer, catId: string) => {
    store.put(removeAnswerTarget(store.latest(), q.node.id, answer.id, catId));
    markChanged(answer.id);
  };
  const writeValues = (answer: Answer, values: FilterValueSet) => {
    store.put(
      setAnswerFilterValues(store.latest(), q.node.id, answer.id, values),
    );
    markChanged(answer.id);
  };

  // The title: every keystroke writes (the rail and the rule sentences
  // follow), the end of the edit commits tracked so the save pill shows.
  const titleDraft = (text: string) => {
    const next = setQuestionText(store.latest(), q.node.id, text);
    store.put(next);
  };
  const titleCommit = (text: string) =>
    store.putTracked(setQuestionText(store.latest(), q.node.id, text));

  const lo = q.node.data.scale_config?.endpoint_label_min ?? "";
  const hi = q.node.data.scale_config?.endpoint_label_max ?? "";

  return (
    <div
      className="qz-lg-pane"
      data-node-id={q.node.id}
      data-testid="logic-question-pane"
    >
      <div className="qz-lg-paneh">
        <div className="qz-lg-phl" ref={titleColRef}>
          <h3 className="qz-lg-panet">
            <InlineText
              value={q.node.data.text}
              maxLength={QUESTION_TEXT_MAX}
              ariaLabel={PANE_COPY.questionLabel(q.qIndex)}
              inline
              columnRef={titleColRef}
              {...(editable
                ? { onDraftChange: titleDraft, onCommit: titleCommit }
                : {})}
            />
          </h3>
          <QuestionTypePopover
            doc={doc}
            q={q}
            {...(editable ? { commit: store.put } : {})}
            getLatestDoc={store.latest}
            {...(undo ? { undo } : {})}
          />
        </div>
        {!rulesOnly ? (
          editable ? (
            <QuestionRoleControl
              variant="pane"
              doc={doc}
              node={q.node}
              qIndex={q.qIndex}
              deciderQIndex={deciderQIndex}
              productIndex={productIndex}
              hasNarrowFields={hasNarrowFields}
              onCommit={store.put}
              getLatestDoc={store.latest}
              {...(undo ? { undo } : {})}
              onRoleChanged={() => setArmed(null)}
            />
          ) : (
            <span className="qz-lg-rolebtn is-static">{ROLE_BUTTON[role]}</span>
          )
        ) : null}
      </div>

      {role === "decides" ? (
        <RecTray
          recs={recs}
          usedBy={usedBy}
          armed={armed}
          setArmed={setArmed}
          editable={editable}
        />
      ) : (
        // Where there is no tray a hairline stands in, so the answer list
        // always has a top edge.
        <div className="qz-lg-prule" />
      )}

      {answers.length === 0 ? (
        <p className="qz-lg-empty">
          <span className="qz-lg-dash">—</span> {PANE_COPY.noAnswers}
        </p>
      ) : (
        <div className="qz-lg-arows">
          {answers.map((a, i) => (
            <AnswerRow
              key={a.id}
              doc={doc}
              store={store}
              q={q}
              answer={a}
              index={i}
              answerKey={isScale ? String(i + 1) : letterKey(i)}
              isScale={isScale}
              endLabel={
                isScale
                  ? i === 0
                    ? lo
                    : i === answers.length - 1
                      ? hi
                      : ""
                  : ""
              }
              role={role}
              questions={questions}
              catById={catById}
              colTitleById={colTitleById}
              productIndex={productIndex}
              productById={productById}
              readout={readout}
              editable={editable}
              lastSyncAt={lastSyncAt}
              shopifyAdminDomain={shopifyAdminDomain}
              recs={recs}
              usedBy={usedBy}
              armed={armed ? (catById.get(armed) ?? null) : null}
              onDisarm={() => setArmed(null)}
              onPlace={(catId) => place(a, catId)}
              onRemove={(catId) => removeTarget(a, catId)}
              onWriteValues={(v) => writeValues(a, v)}
              flashing={flash === a.id}
            />
          ))}
        </div>
      )}
      {conflicts.length > 0 ? (
        <div className="qz-lg-routewarn" role="status">
          {conflicts.map((c, i) => (
            <p key={i} className={c.severity === "error" ? "is-error" : ""}>
              {c.message}
              {i === conflicts.length - 1 &&
              q.node.data.question_type === "multi_select"
                ? ` ${PANE_COPY.routeNote}`
                : ""}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ── the tray: RECOMMENDATIONS, one row (mock .tray, fitRow, trayMoreHTML) ──
function RecTray({
  recs,
  usedBy,
  armed,
  setArmed,
  editable,
}: {
  recs: RecCard[];
  usedBy: Map<string, number>;
  armed: string | null;
  setArmed: (id: string | null) => void;
  editable: boolean;
}) {
  const ordered = useMemo(() => trayOrder(recs, usedBy), [recs, usedBy]);
  const rowRef = useRef<HTMLDivElement>(null);
  const fit = useRowFit(rowRef, {
    mode: "one",
    deps: [
      ordered.map((r) => `${r.cat.id}:${r.cat.name}`).join("|"),
      armed,
      usedBy.size,
    ],
  });
  const [moreOpen, setMoreOpen] = useState(false);
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!moreOpen) setQuery("");
  }, [moreOpen]);
  const qs = query.trim().toLowerCase();
  const list = ordered.filter(
    (r) => !qs || r.cat.name.toLowerCase().includes(qs),
  );
  const arm = (id: string) => {
    if (!editable) return;
    setArmed(armed === id ? null : id);
  };

  return (
    <div className="qz-lg-tray" data-testid="logic-tray">
      <span className="qz-lg-tray-lb">{TRAY_COPY.label}</span>
      <div
        className="qz-lg-tray-c"
        ref={rowRef}
        role="group"
        aria-label={TRAY_COPY.label}
      >
        {ordered.length === 0 ? (
          <span className="qz-lg-tray-empty">{TRAY_COPY.empty}</span>
        ) : null}
        {ordered.map((r) => {
          const isArmed = armed === r.cat.id;
          const placed = usedBy.has(r.cat.id);
          return (
            <button
              key={r.cat.id}
              type="button"
              className={`qz-lg-tchip${placed ? "" : " is-fresh"}${isArmed ? " is-armed" : ""}`}
              data-fit-id={r.cat.id}
              data-rec-id={r.cat.id}
              {...(isArmed ? { "data-fit-armed": "" } : {})}
              hidden={fit.hidden.has(r.cat.id)}
              aria-pressed={isArmed}
              title={TRAY_COPY.chipTip(r.cat.name, r.count, placed)}
              disabled={!editable}
              onClick={() => arm(r.cat.id)}
            >
              {r.cat.name}
            </button>
          );
        })}
        {ordered.length > 0 ? (
          <QzPopover
            open={moreOpen}
            onOpenChange={setMoreOpen}
            width={300}
            maxWidth={300}
            align="end"
            manageFocus
            closeOnAnchorHidden
            ariaLabel={TRAY_COPY.all(ordered.length)}
            className="qz-lg-pop"
            offset={6}
            trigger={
              <button
                type="button"
                className="qz-lg-tchip is-more"
                data-fit-more
                hidden={!fit.showMore}
                aria-label={TRAY_COPY.moreLabel(fit.moreCount)}
              >
                {fit.moreLabel}
              </button>
            }
            content={
              <>
                <div className="qz-lg-pt">{TRAY_COPY.all(ordered.length)}</div>
                <div className="qz-lg-vptools">
                  <input
                    type="search"
                    className="qz-lg-vpsearch"
                    placeholder={TRAY_COPY.search}
                    aria-label={TRAY_COPY.search}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <div className="qz-lg-vplist" data-qz-pop-list>
                  {list.length === 0 ? (
                    <div className="qz-lg-vpnone">
                      {TRAY_COPY.nothingMatches}
                    </div>
                  ) : (
                    list.map((r) => {
                      const placed = usedBy.has(r.cat.id);
                      const on = armed === r.cat.id;
                      return (
                        <button
                          key={r.cat.id}
                          type="button"
                          aria-pressed={on}
                          disabled={!editable}
                          className={`qz-lg-mi is-tl${on ? " is-on" : ""}${placed ? "" : " is-fresh"}`}
                          onClick={() => {
                            arm(r.cat.id);
                            setMoreOpen(false);
                          }}
                        >
                          <span className="qz-lg-mi-n">{r.cat.name}</span>
                          <span className="qz-lg-mi-h">
                            {TRAY_COPY.rowNote(r.count, placed)}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </>
            }
          />
        ) : null}
      </div>
    </div>
  );
}

// ── the picks picker (mock picker): checkbox rows, writes on every click ────
// Shared with the Table's Picks cells (mock tval → the same picker).
export function PicksPicker({
  open,
  onOpenChange,
  anchorRef,
  trigger,
  recs,
  usedBy,
  currentIds,
  productById,
  onToggle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRef: RefObject<HTMLElement | null>;
  trigger: ReactNode;
  recs: RecCard[];
  usedBy: Map<string, number>;
  /** The answer's WHOLE mapping. */
  currentIds: string[];
  productById: Map<string, IndexedProduct>;
  /** on=true adds, on=false removes; the picker stays open for more. */
  onToggle: (catId: string, on: boolean) => void;
}) {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<RecKind | "">("");
  const [drill, setDrill] = useState<RecCard | null>(null);
  useEffect(() => {
    if (!open) return;
    setSearch("");
    setKind("");
    setDrill(null);
  }, [open]);
  const qs = search.trim().toLowerCase();
  const kinds = REC_KINDS.filter((k) => recs.some((r) => r.kind === k));
  const pool = recs.filter((r) => {
    if (kind && r.kind !== kind) return false;
    if (!qs) return true;
    if (r.cat.name.toLowerCase().includes(qs)) return true;
    return r.cat.productIds.some((id) =>
      (productById.get(id)?.title ?? "").toLowerCase().includes(qs),
    );
  });
  return (
    <QzPopover
      open={open}
      onOpenChange={onOpenChange}
      width={300}
      maxWidth={300}
      manageFocus
      closeOnAnchorHidden
      ariaLabel={PICKER_COPY.title}
      className="qz-lg-pop"
      offset={6}
      anchorRef={anchorRef}
      trigger={trigger}
      content={
        drill ? (
          <div className="qz-lg-vp">
            <div className="qz-lg-pt">
              {drill.cat.name}{" "}
              <span className="qz-lg-pt-sub">
                · {PICKER_COPY.products(drill.count)}
              </span>
            </div>
            <div className="qz-lg-vplist" data-qz-pop-list>
              {drill.cat.productIds
                .map((id) => productById.get(id))
                .filter((p): p is IndexedProduct => Boolean(p))
                .slice(0, 14)
                .map((p) => (
                  <div key={p.product_id} className="qz-lg-pp">
                    {p.image_url ? (
                      <img
                        className="qz-lg-pp-sw"
                        src={p.image_url}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <span className="qz-lg-pp-sw" aria-hidden />
                    )}
                    <span className="qz-lg-pp-nm">{p.title}</span>
                    {p.product_type ? (
                      <span className="qz-lg-pp-ty">{p.product_type}</span>
                    ) : null}
                  </div>
                ))}
              {drill.count > 14 ? (
                <p className="qz-lg-vpnone">
                  {PICKER_COPY.showing(14, drill.count)}
                </p>
              ) : null}
            </div>
            <div className="qz-lg-vpfoot">
              <span />
              <button
                type="button"
                className="qz-lg-btn is-ghost"
                onClick={() => setDrill(null)}
              >
                {PICKER_COPY.back}
              </button>
              <button
                type="button"
                className="qz-lg-btn is-pri"
                onClick={() => {
                  onToggle(drill.cat.id, !currentIds.includes(drill.cat.id));
                  setDrill(null);
                }}
              >
                {currentIds.includes(drill.cat.id)
                  ? PICKER_COPY.removeThis
                  : PICKER_COPY.addThis}
              </button>
            </div>
          </div>
        ) : (
          <div className="qz-lg-vp" data-testid="picks-picker">
            <div className="qz-lg-pt">{PICKER_COPY.title}</div>
            {recs.length > 8 ? (
              <div className="qz-lg-vptools">
                <input
                  className="qz-lg-vpsearch"
                  type="search"
                  placeholder={PICKER_COPY.search}
                  aria-label={PICKER_COPY.search}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            ) : null}
            {kinds.length > 1 ? (
              <div className="qz-lg-vptools">
                <div className="qz-lg-vptabs" role="group" aria-label="Kind">
                  <button
                    type="button"
                    aria-pressed={kind === ""}
                    onClick={() => setKind("")}
                  >
                    {PICKER_COPY.all}
                    <span className="qz-lg-vptab-c">{recs.length}</span>
                  </button>
                  {kinds.map((k) => (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={kind === k}
                      onClick={() => setKind(k)}
                    >
                      {PICKER_COPY.kinds[k]}
                      <span className="qz-lg-vptab-c">
                        {recs.filter((r) => r.kind === k).length}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="qz-lg-vplist" data-qz-pop-list>
              {pool.map((r) => {
                const on = currentIds.includes(r.cat.id);
                const fresh = !usedBy.has(r.cat.id);
                return (
                  <div key={r.cat.id} className="qz-lg-vprow">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      className={`qz-lg-mi is-pk${on ? " is-on" : ""}${fresh ? " is-fresh" : ""}`}
                      title={
                        fresh
                          ? PICKER_COPY.fresh(r.count)
                          : PICKER_COPY.used(r.count)
                      }
                      onClick={() => onToggle(r.cat.id, !on)}
                    >
                      <span className="qz-lg-ck" aria-hidden>
                        {on ? "✓" : ""}
                      </span>
                      <span className="qz-lg-mi-n">{r.cat.name}</span>
                    </button>
                    {r.count > 0 ? (
                      <button
                        type="button"
                        className="qz-lg-vpdrill"
                        aria-label={PICKER_COPY.drill(r.count, r.cat.name)}
                        onClick={() => setDrill(r)}
                      >
                        {r.count}
                        <span aria-hidden> ›</span>
                      </button>
                    ) : (
                      <span className="qz-lg-vpdrill is-flat">0</span>
                    )}
                  </div>
                );
              })}
              {pool.length === 0 ? (
                <p className="qz-lg-vpnone">
                  {recs.length === 0
                    ? PICKER_COPY.empty
                    : PICKER_COPY.nothingMatches}
                </p>
              ) : null}
            </div>
          </div>
        )
      }
    />
  );
}

// ── an answer's text (mock ptEd + endCap), shared with the Table ──────────
// Inline, 60. A scale point stores its NUMBER as its text: it shows empty,
// with its end label (or "Add label") as the placeholder, and emptying a
// named point stores the number again. A named end point keeps the scale's
// end label as a quiet caption after it (read-only here: the end labels are
// edited in the Question type popover). Every keystroke writes (the rule
// sentences follow); the end of the edit commits tracked (D8 pill).
export function AnswerTextField({
  store,
  q,
  answer,
  index,
  endLabel,
  editable,
  ariaLabel,
  className,
}: {
  store: DocStore;
  q: OrderedQuestion;
  answer: Answer;
  index: number;
  /** The scale's end label on the first / last point ("" elsewhere). */
  endLabel: string;
  editable: boolean;
  ariaLabel: string;
  className: string;
}) {
  const colRef = useRef<HTMLSpanElement>(null);
  const isScale = q.node.data.question_type === "rating";
  const point = String(index + 1);
  const isPoint = isScale && answer.text === point;
  const writeText = (text: string, tracked: boolean) => {
    const next = setAnswerText(store.latest(), q.node.id, answer.id, text || point);
    return tracked ? store.putTracked(next) : store.put(next);
  };
  return (
    <span className={className} ref={colRef}>
      <InlineText
        value={isPoint ? "" : answer.text}
        maxLength={ANSWER_TEXT_MAX}
        ariaLabel={ariaLabel}
        inline
        columnRef={colRef}
        {...(isScale ? { allowEmpty: true, placeholder: endLabel || PANE_COPY.addLabel } : {})}
        {...(editable
          ? {
              onDraftChange: (t: string) => {
                if (t || isScale) writeText(t, false);
              },
              onCommit: (t: string) => writeText(t, true),
            }
          : {})}
      />
      {isScale && !isPoint && endLabel ? <span className="qz-lg-ptlab"> · {endLabel}</span> : null}
    </span>
  );
}

// ── one answer row: key · answer · cell · route (mock .arow) ───────────────
function AnswerRow({
  doc,
  store,
  q,
  answer,
  index,
  answerKey,
  isScale,
  endLabel,
  role,
  questions,
  catById,
  colTitleById,
  productIndex,
  productById,
  readout,
  editable,
  lastSyncAt,
  shopifyAdminDomain,
  recs,
  usedBy,
  armed,
  onDisarm,
  onPlace,
  onRemove,
  onWriteValues,
  flashing,
}: {
  doc: QuizDoc;
  store: DocStore;
  q: OrderedQuestion;
  answer: Answer;
  index: number;
  answerKey: string;
  isScale: boolean;
  endLabel: string;
  role: DisplayRole;
  questions: OrderedQuestion[];
  catById: Map<string, BuilderCategory>;
  colTitleById: Map<string, string>;
  productIndex: IndexedProduct[];
  productById: Map<string, IndexedProduct>;
  readout: AttributeReadout;
  editable: boolean;
  lastSyncAt?: string | null;
  shopifyAdminDomain?: string | null;
  recs: RecCard[];
  usedBy: Map<string, number>;
  armed: BuilderCategory | null;
  onDisarm: () => void;
  onPlace: (catId: string) => void;
  onRemove: (targetId: string) => void;
  onWriteValues: (values: FilterValueSet) => void;
  flashing: boolean;
}) {
  const cellRef = useRef<HTMLDivElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const total = productIndex.length;

  // ── the answer text (inline, 60; a scale point stores its number) ─────
  const textCell = (
    <AnswerTextField
      store={store}
      q={q}
      answer={answer}
      index={index}
      endLabel={endLabel}
      editable={editable}
      ariaLabel={isScale ? PANE_COPY.pointLabel(index + 1) : PANE_COPY.answerLabel(answerKey)}
      className="qz-lg-atext"
    />
  );

  // ── the cell ───────────────────────────────────────────────────────────
  let cell: ReactNode;
  const targets = answerTargets(answer);
  const cellKeys = (open: () => void) => ({
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      open();
    },
    onKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      if (e.target !== e.currentTarget) return;
      e.preventDefault();
      e.stopPropagation();
      open();
    },
  });

  if (role === "info") {
    // Inert: values or targets stored under an earlier role stay in the doc
    // and come back with the role.
    cell = (
      <div className="qz-lg-cell is-inert">
        <span className="qz-lg-dash">—</span>
      </div>
    );
  } else if (role === "decides") {
    const armedHere = armed && editable;
    const armedPresent = armedHere ? targets.includes(armed.id) : false;
    const act = () => {
      if (!editable) return;
      if (armedHere) {
        // One shot: a cell that already holds it adds nothing, still disarms.
        if (!armedPresent) onPlace(armed.id);
        onDisarm();
        return;
      }
      setPickerOpen((o) => !o);
    };
    const armedSay = armedHere
      ? armedPresent
        ? PANE_COPY.alreadyHere(armed.name)
        : targets.length
          ? PANE_COPY.add(armed.name)
          : PANE_COPY.place(armed.name)
      : null;
    const inner = (
      <div
        ref={cellRef}
        className={`qz-lg-cell${targets.length ? "" : " is-blank"}${armedHere ? " is-drop" : ""}${
          pickerOpen ? " is-open" : ""
        }${flashing ? " is-flash" : ""}`}
        role="button"
        tabIndex={editable ? 0 : -1}
        data-pane-cell
        aria-label={armedSay ?? PANE_COPY.cellPicks(answer.text)}
        title={armedSay ?? undefined}
        {...cellKeys(act)}
      >
        {targets.length ? (
          targets.map((tid) => {
            const c = catById.get(tid);
            return (
              <span key={tid} className="qz-lg-chipw">
                {c ? (
                  <span className="qz-lg-chip" title={c.name}>
                    {c.name}
                  </span>
                ) : (
                  <span className="qz-lg-chip is-bad">
                    {PANE_COPY.deletedTarget}
                  </span>
                )}
                {c ? (
                  editable ? (
                    // The count opens the products popover, never the picker.
                    <span
                      className="qz-lg-cnw"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ProductCountButton
                        answer={answer}
                        targetId={tid}
                        role="decides"
                        catById={catById}
                        productIndex={productIndex}
                        label={
                          <span className="qz-lg-cn">
                            {c.productIds.length}
                          </span>
                        }
                        answerKey={answerKey}
                        lastSyncAt={lastSyncAt}
                        shopifyAdminDomain={shopifyAdminDomain}
                      />
                    </span>
                  ) : (
                    <span className="qz-lg-cn">{c.productIds.length}</span>
                  )
                ) : null}
                {editable ? (
                  <button
                    type="button"
                    className="qz-lg-xone"
                    aria-label={PANE_COPY.removeTarget(
                      c ? c.name : PANE_COPY.deletedTarget,
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(tid);
                    }}
                  >
                    ×
                  </button>
                ) : null}
              </span>
            );
          })
        ) : (
          <span className="qz-lg-vbtn">
            {armedHere && !armedPresent
              ? PANE_COPY.place(armed.name)
              : CHOOSE_A_RESULT}
            <span className="qz-lg-cv" aria-hidden>
              ▾
            </span>
          </span>
        )}
      </div>
    );
    cell = editable ? (
      <PicksPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        anchorRef={cellRef}
        trigger={inner}
        recs={recs}
        usedBy={usedBy}
        currentIds={targets}
        productById={productById}
        onToggle={(id, on) => (on ? onPlace(id) : onRemove(id))}
      />
    ) : (
      inner
    );
  } else {
    // Narrows — per-value chips (label, count, ×), the answer's match count
    // after them (D19: the products popover survives there), the staged
    // value picker.
    const chips = narrowChips(answer, colTitleById, productIndex);
    const hasMapping =
      answer.no_preference === true || answerHasSelection(answer);
    const count = answer.no_preference
      ? total
      : filterAnswerMatchCount(answer, productIndex);
    const inner = (
      <div
        ref={cellRef}
        className={`qz-lg-cell${hasMapping ? "" : " is-blank"}${pickerOpen ? " is-open" : ""}${
          flashing ? " is-flash" : ""
        }`}
        role="button"
        tabIndex={editable ? 0 : -1}
        data-pane-cell
        aria-label={PANE_COPY.cellValues(answer.text)}
        {...cellKeys(() => {
          if (editable) setPickerOpen((o) => !o);
        })}
      >
        {answer.no_preference ? (
          <span className="qz-lg-chipw">
            <span className="qz-lg-chip is-all">
              {PANE_COPY.keepsEverything}
            </span>
            {editable ? (
              <button
                type="button"
                className="qz-lg-xone"
                aria-label={PANE_COPY.stopKeeping}
                onClick={(e) => {
                  e.stopPropagation();
                  onWriteValues({ tags: [] });
                }}
              >
                ×
              </button>
            ) : null}
          </span>
        ) : chips.length ? (
          <>
            {chips.map((c) => (
              <span key={c.key} className="qz-lg-chipw" title={c.source}>
                <span className="qz-lg-chip">{c.label}</span>
                {chips.length === 1 && count !== null && editable ? (
                  // One value: its count IS the answer's count, and it opens
                  // the products popover (D19), never the value picker.
                  <span
                    className="qz-lg-cnw"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ProductCountButton
                      answer={answer}
                      role="filter"
                      catById={catById}
                      productIndex={productIndex}
                      label={
                        <span
                          className={`qz-lg-cn${count === 0 ? " is-zero" : ""}`}
                        >
                          {count}
                        </span>
                      }
                      answerKey={answerKey}
                      lastSyncAt={lastSyncAt}
                      shopifyAdminDomain={shopifyAdminDomain}
                    />
                  </span>
                ) : c.count !== null ? (
                  <span className="qz-lg-cn">{c.count}</span>
                ) : null}
                {editable ? (
                  <button
                    type="button"
                    className="qz-lg-xone"
                    aria-label={PANE_COPY.removeValue(c.label)}
                    onClick={(e) => {
                      e.stopPropagation();
                      onWriteValues(c.removed);
                    }}
                  >
                    ×
                  </button>
                ) : null}
              </span>
            ))}
            {count !== null && editable && chips.length > 1 ? (
              <span
                className="qz-lg-chipw is-total"
                onClick={(e) => e.stopPropagation()}
              >
                <ProductCountButton
                  answer={answer}
                  role="filter"
                  catById={catById}
                  productIndex={productIndex}
                  label={
                    <span
                      className={`qz-lg-cn${count === 0 ? " is-zero" : ""}`}
                    >
                      {count} of {total}
                    </span>
                  }
                  answerKey={answerKey}
                  lastSyncAt={lastSyncAt}
                  shopifyAdminDomain={shopifyAdminDomain}
                />
              </span>
            ) : null}
          </>
        ) : (
          <span className="qz-lg-vbtn">
            {PANE_COPY.chooseValue}
            <span className="qz-lg-cv" aria-hidden>
              ▾
            </span>
          </span>
        )}
      </div>
    );
    cell = editable ? (
      <ValuePickerPopover
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        anchorRef={cellRef}
        trigger={inner}
        answer={answer}
        siblingAnswers={q.node.data.answers}
        readout={readout}
        productIndex={productIndex}
        onApply={onWriteValues}
      />
    ) : (
      inner
    );
  }

  return (
    <div className="qz-lg-arow" data-answer-row={answer.id}>
      <span className={`qz-lg-akey${isScale ? " is-num" : ""}`}>
        {answerKey}
      </span>
      {textCell}
      <div className="qz-lg-acell">{cell}</div>
      <div className="qz-lg-aroute">
        <RouteMenuButton
          doc={doc}
          q={q}
          answer={answer}
          questions={questions}
          {...(editable ? { commit: store.put } : {})}
          getLatestDoc={store.latest}
        />
      </div>
    </div>
  );
}

const capWord = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const prettyKey = (k: string) =>
  capWord((k.split(".").pop() ?? k).replace(/[_-]+/g, " "));

/** An answer holding ONLY the given values, for one chip's product count. */
function onlyValues(
  answer: Answer,
  v: Partial<FilterValueSet> & { collection_filters?: string[] },
): Answer {
  const {
    collection_filter: _cf,
    collection_filters: _cfs,
    metafield_filters: _mf,
    variant_filters: _vf,
    product_type_filters: _pt,
    no_preference: _np,
    ...rest
  } = answer;
  return { ...rest, tags: v.tags ?? [], ...v } as Answer;
}

// One chip per stored value (handoff "Narrows cell"): the value for bare tags
// and product types; "Attribute · value" for tag families, metafields and
// variant options; the collection title for collection filters. The tooltip
// names the source. × writes the full set minus that value.
function narrowChips(
  answer: Answer,
  colTitleById: Map<string, string>,
  productIndex: readonly IndexedProduct[],
): Array<{
  key: string;
  label: string;
  source: string;
  count: number | null;
  removed: FilterValueSet;
}> {
  const out: Array<{
    key: string;
    label: string;
    source: string;
    count: number | null;
    removed: FilterValueSet;
  }> = [];
  const count = (only: Parameters<typeof onlyValues>[1]) =>
    filterAnswerMatchCount(onlyValues(answer, only), productIndex);
  answer.tags.forEach((t, ti) => {
    const ci = t.indexOf(":");
    const fam = ci > 0 && ci < t.length - 1 ? t.slice(0, ci) : null;
    const val = fam ? t.slice(ci + 1) : t;
    const removed = baseValueSet(answer);
    removed.tags = answer.tags.filter((_, j) => j !== ti);
    out.push({
      key: `t:${t}:${ti}`,
      label: fam ? `${capWord(fam)} · ${val}` : t,
      source: fam ? `Tag · ${capWord(fam)}` : "Tag",
      count: count({ tags: [t] }),
      removed,
    });
  });
  const cols = [
    ...(answer.collection_filter ? [answer.collection_filter] : []),
    ...(answer.collection_filters ?? []),
  ].filter((c, i, all) => Boolean(c) && all.indexOf(c) === i);
  cols.forEach((cid) => {
    const removed = baseValueSet(answer);
    removed.collection_filters = cols.filter((c) => c !== cid);
    if (!removed.collection_filters.length) delete removed.collection_filters;
    out.push({
      key: `c:${cid}`,
      label: colTitleById.get(cid) ?? cid,
      source: "Collection",
      count: count({ collection_filters: [cid] }),
      removed,
    });
  });
  (answer.metafield_filters ?? []).forEach((m, mi) => {
    const removed = baseValueSet(answer);
    removed.metafield_filters = (answer.metafield_filters ?? []).filter(
      (_, j) => j !== mi,
    );
    out.push({
      key: `m:${m.key}:${m.value}:${mi}`,
      label: `${prettyKey(m.key)} · ${m.value}`,
      source: `Metafield · ${prettyKey(m.key)}`,
      count: count({ metafield_filters: [m] }),
      removed,
    });
  });
  (answer.variant_filters ?? []).forEach((v, vi) => {
    const removed = baseValueSet(answer);
    removed.variant_filters = (answer.variant_filters ?? []).filter(
      (_, j) => j !== vi,
    );
    out.push({
      key: `v:${v.name}:${v.value}:${vi}`,
      label: `${v.name} · ${v.value}`,
      source: `Variant · ${v.name}`,
      count: count({ variant_filters: [v] }),
      removed,
    });
  });
  (answer.product_type_filters ?? []).forEach((p, pi) => {
    const removed = baseValueSet(answer);
    removed.product_type_filters = (answer.product_type_filters ?? []).filter(
      (_, j) => j !== pi,
    );
    out.push({
      key: `p:${p}:${pi}`,
      label: p,
      source: "Product type",
      count: count({ product_type_filters: [p] }),
      removed,
    });
  });
  return out;
}
