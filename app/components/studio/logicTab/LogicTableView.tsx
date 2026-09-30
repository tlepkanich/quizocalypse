import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import type { Answer, Quiz } from "../../../lib/quizSchema";
import type { LogicStyle } from "../../../lib/logicStyle";
import type { OrderedQuestion } from "../../../lib/questionOrder";
import type { RuleStatus } from "../../../lib/ruleStatus";
import type { IndexedProduct } from "../../../lib/recommendationEngine";
import type { AttributeReadout } from "../../../lib/attributeClustering";
import {
  addAnswerTarget,
  moveDecisionRule,
  removeAnswerTarget,
  removeDecisionRule,
  restoreDecisionRules,
  setAnswerFilterValues,
  setQuestionText,
  QUESTION_TEXT_MAX,
} from "../../../lib/quizMutations";
import {
  logicSheets,
  type AnswerSheetRow,
  type AnySheet,
  type RecSheetRow,
  type RuleSheetRow,
  type WhenParts,
} from "../../../lib/logicSheets";
import { answerTargets } from "../../../lib/recommendDecider";
import type { BuilderCategory } from "../../builder/stepProps";
import type { SaveToken } from "../saveTracker";
import type { RulesUndo } from "./RulesList";
import { ruleTags } from "./RulesList";
import { InlineText } from "./InlineText";
import { ValuePickerPopover, type FilterValueSet } from "./ValuePickerPopover";
import { QuestionRoleControl, RouteMenuButton } from "./LogicTabMenus";
import { QuestionTypePopover } from "./QuestionTypePopover";
import { AnswerTextField, PicksPicker, recCards, useDocStore, type DocStore } from "./LogicQuestionWidget";
import { CHOOSE_A_RESULT, RULE_COPY, SHEET_COPY } from "./logicCopy";

// ════════════════════════════════════════════════════════════════════════════
// Logic step redesign — the Table view (mock tableHTML / sheets; handoff
// "Table view, Export and Import", D16, D17, B40, B48, B64). It renders the
// SAME rows logicSheets serializes, so the Table and the exported file
// cannot diverge. Either style; the header's slot shows Import | Export.
//
//   Rules sheet      "#" is a real button ("Edit rule N"); the row click
//                    calls the same action (never role=button on the tr,
//                    B48). Verb, recommendations, the When cell with bold
//                    joins, the rule's tags from the one status (D3). The
//                    last cell holds ↑/↓ (revealed on hover and focus, like
//                    the Edit rows; Alt+Arrow on a focused row) and a faint
//                    trash. Moves and deletes join the card's ONE Undo run
//                    (D7), which counts the deletes whichever surface made
//                    them; focus follows the RulesList rules.
//   Answers sheet    (Filter Results + Rules) the Edit pane's OWN controls,
//                    in the Table's dress: the question and answer texts
//                    (InlineText, keystroke draft + commit on Enter/blur),
//                    QuestionTypePopover, QuestionRoleControl, the "Choose a
//                    result" picker / the value picker, and the route menu.
//                    Every write is the Edit view's mutation against the
//                    latest doc. Popovers take the row's question as data:
//                    nothing here moves the Edit view's selection (B40).
//   Recommendations  (Rules only) read-only status; a "Needs a rule" row's
//                    name opens "Create a rule" with it picked.
// ════════════════════════════════════════════════════════════════════════════

export type LogicTableViewProps = {
  doc: Quiz;
  style: LogicStyle;
  questions: OrderedQuestion[];
  categories: readonly BuilderCategory[];
  recommendations: readonly BuilderCategory[];
  statuses: ReadonlyMap<string, RuleStatus>;
  commit?: (doc: Quiz) => void;
  commitTracked?: (doc: Quiz) => SaveToken;
  getLatestDoc: () => Quiz;
  undo?: RulesUndo;
  onEditRule?: (ruleId: string) => void;
  onCreateFor?: (categoryId: string) => void;
  onSelectQuestion?: (nodeId: string) => void;
  // ── optional (agent F) ──
  /** Collection id → title (Narrows "Collection: …" values). */
  collectionTitles?: ReadonlyMap<string, string>;
  /** The value picker and the Narrows attribute dialog need the catalogue. */
  productIndex?: IndexedProduct[];
  readout?: AttributeReadout;
  hasNarrowFields?: boolean;
};

type SheetProps = LogicTableViewProps & { store: DocStore };

const TRASH = (
  <svg
    viewBox="0 0 16 16"
    width="13"
    height="13"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M2.5 4.5h11M6.5 4.5V3h3v1.5M4 4.5l.6 8.2c.05.7.6 1.3 1.3 1.3h4.2c.7 0 1.25-.6 1.3-1.3L12 4.5" />
  </svg>
);

const Caret = () => (
  <span className="qz-lg-cv" aria-hidden="true">
    ▾
  </span>
);

const NO_PRODUCTS: IndexedProduct[] = [];

/** The sheet's scroll wrapper: a keyboard stop only when it scrolls. */
function SheetWrap({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setScrolls(el.scrollWidth > el.clientWidth + 1);
    check();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className="qz-lg-twrap"
      {...(scrolls ? { tabIndex: 0, role: "region", "aria-label": label } : {})}
    >
      {children}
    </div>
  );
}

/** The When cell: the file's text, with bold joins (mock whenHTML). */
function WhenCell({ parts }: { parts: WhenParts }) {
  if (!parts.groups.length) return <>{SHEET_COPY.noAnswers}</>;
  const cj = (w: string) => (
    <>
      {" "}
      <b className="qz-lg-cj">{w}</b>{" "}
    </>
  );
  return (
    <>
      {parts.groups.map((g, gi) => {
        const answers = g.answers.map((a, ai) => (
          <Fragment key={ai}>
            {ai > 0 ? cj(g.join) : null}
            <span className={a.missing ? "qz-lg-tmiss" : undefined}>{a.text}</span>
          </Fragment>
        ));
        const wrapped = g.answers.length > 1 || g.not;
        return (
          <Fragment key={gi}>
            {gi > 0 ? cj(parts.across) : null}
            {g.not ? (
              <>
                <b className="qz-lg-cj">NOT</b>{" "}
              </>
            ) : null}
            {wrapped ? <>({answers})</> : answers}
          </Fragment>
        );
      })}
    </>
  );
}

export function LogicTableView(props: LogicTableViewProps) {
  const { doc, style, categories, recommendations, statuses, collectionTitles } = props;
  // The newest doc this view knows (a keystroke commit and a click in the
  // same event must never overwrite each other), shared with the Edit pane.
  const store = useDocStore(doc, props.commit, props.commitTracked);
  const sheets = useMemo(
    () =>
      logicSheets(doc, {
        style,
        categories,
        recommendations,
        statuses,
        ...(collectionTitles ? { collectionTitles } : {}),
      }),
    [doc, style, categories, recommendations, statuses, collectionTitles],
  );
  return (
    <div className="qz-lg-tview" data-testid="logic-table-view">
      {sheets.map((sh) => (
        <section key={sh.kind} className="qz-lg-tsheet" data-sheet={sh.kind}>
          <SheetWrap label={sh.name}>
            <SheetTable sheet={sh} {...props} store={store} />
          </SheetWrap>
        </section>
      ))}
    </div>
  );
}

function SheetTable(props: SheetProps & { sheet: AnySheet }) {
  const { sheet } = props;
  if (sheet.kind === "rules") return <RulesTable {...props} rows={sheet.rows} cols={sheet.cols} />;
  if (sheet.kind === "recommendations") return <RecsTable {...props} rows={sheet.rows} cols={sheet.cols} />;
  return <AnswersTable {...props} rows={sheet.rows} cols={sheet.cols} />;
}

function Head({ cols, tail }: { cols: readonly string[]; tail?: ReactNode }) {
  return (
    <thead>
      <tr>
        {cols.map((c) => (
          <th key={c} scope="col">
            {c}
          </th>
        ))}
        {tail}
      </tr>
    </thead>
  );
}

function Empty({ span }: { span: number }) {
  return (
    <tr>
      <td colSpan={span} className="is-dim">
        {SHEET_COPY.nothingYet}
      </td>
    </tr>
  );
}

// ── Rules sheet ─────────────────────────────────────────────────────────────

type PendingFocus = { ruleId: string; control: "up" | "down" | "body" } | null;

function RulesTable({
  rows,
  cols,
  doc,
  style,
  statuses,
  commit,
  store,
  undo,
  onEditRule,
}: SheetProps & { rows: RuleSheetRow[]; cols: readonly string[] }) {
  const tbodyRef = useRef<HTMLTableSectionElement>(null);
  const pendingFocus = useRef<PendingFocus>(null);
  const editable = !!commit;
  const rulesById = useMemo(() => new Map((doc.decision_rules ?? []).map((r) => [r.id, r])), [doc.decision_rules]);

  const rowEl = (ruleId: string) =>
    tbodyRef.current?.querySelector<HTMLElement>(`[data-rule-id="${CSS.escape(ruleId)}"]`) ?? null;

  // Focus follows a moved rule once the re-render lands (RulesList rules).
  useLayoutEffect(() => {
    const want = pendingFocus.current;
    if (!want) return;
    pendingFocus.current = null;
    const row = rowEl(want.ruleId);
    if (!row) return;
    const pick = (sel: string) => row.querySelector<HTMLButtonElement>(sel);
    let target: HTMLButtonElement | null = null;
    if (want.control === "body") target = pick(".qz-lg-tgob");
    else {
      const same = pick(`[data-move="${want.control}"]`);
      const other = pick(`[data-move="${want.control === "up" ? "down" : "up"}"]`);
      target = same && !same.disabled ? same : other && !other.disabled ? other : pick(".qz-lg-tgob");
    }
    target?.focus();
  }, [rows]);

  const focusRuleBody = (ruleId: string) => {
    window.requestAnimationFrame(() => rowEl(ruleId)?.querySelector<HTMLElement>(".qz-lg-tgob")?.focus());
  };

  // After a delete (mock toastBack): the trash of the row that took its
  // place, else the new last row's, else the header's first control — never
  // <body>.
  const focusAfterDelete = (index: number) => () => {
    const body = tbodyRef.current;
    const trashes = body ? Array.from(body.querySelectorAll<HTMLElement>(".qz-lg-tdel")) : [];
    const card = body?.closest('[data-testid="logic-tab-card"]') ?? document;
    const target =
      trashes[index] ??
      trashes[trashes.length - 1] ??
      card.querySelector<HTMLElement>(".qz-lg-iox button:not(:disabled), [data-testid='logic-style-title']");
    target?.focus();
  };

  const deleteRule = (ruleId: string) => {
    if (!commit) return;
    const latest = store.latest();
    const index = (latest.decision_rules ?? []).findIndex((r) => r.id === ruleId);
    if (index < 0) return;
    const rule = latest.decision_rules![index]!;
    const next = removeDecisionRule(latest, ruleId);
    if (next === latest) return;
    store.put(next);
    if (!undo) return;
    undo.push({
      message: RULE_COPY.deletedRun(index + 1),
      inverse: (d) => restoreDecisionRules(d, [{ rule, index }]),
      isDelete: true,
      focusAction: true,
      returnFocus: focusAfterDelete(index),
      focusAfter: () => focusRuleBody(rule.id),
    });
  };

  // The ONE move (RulesList moveRule): ↑/↓ or Alt+Arrow, RULE_COPY.moved
  // with an Undo that moves the rule back.
  const moveRule = (ruleId: string, shownFrom: number, to: number, control: "up" | "down" | "body") => {
    if (!commit) return;
    const latest = store.latest();
    const latestRules = latest.decision_rules ?? [];
    const from = latestRules.findIndex((r) => r.id === ruleId);
    if (from < 0 || from !== shownFrom || to < 0 || to >= latestRules.length || to === from) return;
    const next = moveDecisionRule(latest, ruleId, to);
    if (next === latest) return;
    pendingFocus.current = { ruleId, control };
    store.put(next);
    if (!undo) return;
    undo.push({
      message: RULE_COPY.moved(from + 1, to + 1),
      inverse: (d) => {
        const at = (d.decision_rules ?? []).findIndex((r) => r.id === ruleId);
        return at < 0 ? d : moveDecisionRule(d, ruleId, from);
      },
      focusAfter: () => focusRuleBody(ruleId),
    });
  };

  const span = cols.length + (editable ? 1 : 0);
  return (
    <table className="qz-lg-xl" aria-label={SHEET_COPY.rules}>
      <Head
        cols={cols}
        tail={
          editable ? (
            <th scope="col" className="is-tact">
              <span className="qz-lg-sr">{SHEET_COPY.rowActions}</span>
            </th>
          ) : null
        }
      />
      <tbody ref={tbodyRef}>
        {rows.length === 0 ? (
          <Empty span={span} />
        ) : (
          rows.map((row, i) => {
            const status = statuses.get(row.ruleId);
            const rule = rulesById.get(row.ruleId);
            const tags = rule ? ruleTags(rule, status, style) : [];
            const muted = status ? !status.canRun : false;
            const open = () => onEditRule?.(row.ruleId);
            const onRowClick = (e: MouseEvent<HTMLTableRowElement>) => {
              if ((e.target as HTMLElement).closest("button")) return;
              open();
            };
            const onRowKey = (e: KeyboardEvent<HTMLTableRowElement>) => {
              if (!editable || !e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
              e.preventDefault();
              moveRule(row.ruleId, i, i + (e.key === "ArrowUp" ? -1 : 1), "body");
            };
            return (
              <tr
                key={row.ruleId}
                className={`${onEditRule ? "is-go" : ""}${muted ? " is-muted" : ""}`}
                data-rule-id={row.ruleId}
                onClick={onEditRule ? onRowClick : undefined}
                onKeyDown={editable ? onRowKey : undefined}
              >
                <td className="is-k">
                  {onEditRule ? (
                    <button type="button" className="qz-lg-tgob" aria-label={SHEET_COPY.editRule(row.number)} onClick={open}>
                      {row.number}
                    </button>
                  ) : (
                    row.number
                  )}
                </td>
                <td className="is-verb">{row.verb}</td>
                <td className="is-res">
                  {row.targets.length
                    ? row.targets.map((t, ti) => (
                        <Fragment key={`${t.id}:${ti}`}>
                          {ti > 0 ? ", " : null}
                          <span className={t.missing ? "qz-lg-tmiss" : undefined}>{t.name}</span>
                        </Fragment>
                      ))
                    : SHEET_COPY.none}
                </td>
                <td className="is-when">
                  <span className="qz-lg-twhen">
                    <WhenCell parts={row.whenParts} />
                  </span>
                  {tags.map((t) => (
                    <span key={t} className="qz-lg-rtag">
                      {t}
                    </span>
                  ))}
                </td>
                {editable ? (
                  <td className="is-tact">
                    <span className="qz-lg-mv qz-lg-tmv">
                      <button
                        type="button"
                        className="qz-lg-xone"
                        data-move="up"
                        aria-label={RULE_COPY.moveUp(row.number)}
                        title={RULE_COPY.moveUpTip}
                        disabled={i === 0}
                        onClick={() => moveRule(row.ruleId, i, i - 1, "up")}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="qz-lg-xone"
                        data-move="down"
                        aria-label={RULE_COPY.moveDown(row.number)}
                        title={RULE_COPY.moveDownTip}
                        disabled={i === rows.length - 1}
                        onClick={() => moveRule(row.ruleId, i, i + 1, "down")}
                      >
                        ↓
                      </button>
                    </span>
                    <button
                      type="button"
                      className="qz-lg-tdel"
                      title={RULE_COPY.deleteTip}
                      aria-label={RULE_COPY.deleteLabel(row.number)}
                      onClick={() => deleteRule(row.ruleId)}
                    >
                      {TRASH}
                    </button>
                  </td>
                ) : null}
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );
}

// ── Recommendations sheet (Rules only) ─────────────────────────────────────

function RecsTable({
  rows,
  cols,
  onCreateFor,
}: SheetProps & { rows: RecSheetRow[]; cols: readonly string[] }) {
  return (
    <table className="qz-lg-xl" aria-label={SHEET_COPY.recommendations}>
      <Head cols={cols} />
      <tbody>
        {rows.length === 0 ? (
          <Empty span={cols.length} />
        ) : (
          rows.map((row) => {
            const go = !row.has && onCreateFor ? () => onCreateFor(row.categoryId) : null;
            return (
              <tr
                key={row.categoryId}
                className={go ? "is-go" : undefined}
                data-category-id={row.categoryId}
                onClick={
                  go
                    ? (e) => {
                        if ((e.target as HTMLElement).closest("button")) return;
                        go();
                      }
                    : undefined
                }
              >
                <td className="is-res">
                  {go ? (
                    <button type="button" className="qz-lg-tgob" aria-label={SHEET_COPY.createFor(row.name)} onClick={go}>
                      {row.name}
                    </button>
                  ) : (
                    row.name
                  )}
                </td>
                <td className="is-num">{row.products}</td>
                <td>{row.shownBy.length ? row.shownBy.join(", ") : SHEET_COPY.empty}</td>
                <td className={row.has ? "is-ok" : "is-unset"}>{row.has ? SHEET_COPY.hasRule : SHEET_COPY.needsRule}</td>
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );
}

// ── Answers sheet (Filter Results + Rules) ─────────────────────────────────

type CellCtx = SheetProps & {
  q: OrderedQuestion;
  answer: Answer;
  row: AnswerSheetRow;
  deciderQIndex: number | null;
};

function AnswersTable(props: SheetProps & { rows: AnswerSheetRow[]; cols: readonly string[] }) {
  const { rows, cols, questions } = props;
  const nodes = useMemo(() => new Map(questions.map((q) => [q.node.id, q])), [questions]);
  const deciderQIndex = questions.find((q) => q.node.data.role === "decides")?.qIndex ?? null;
  return (
    <table className="qz-lg-xl" aria-label={SHEET_COPY.answers}>
      <Head cols={cols} />
      <tbody>
        {rows.length === 0 ? (
          <Empty span={cols.length} />
        ) : (
          rows.map((row, ri) => {
            const q = nodes.get(row.questionId);
            const answer = q?.node.data.answers.find((a) => a.id === row.answerId);
            if (!q || !answer) return null;
            const c: CellCtx = { ...props, q, answer, row, deciderQIndex };
            return (
              <tr
                key={row.answerId}
                className={row.first && ri > 0 ? "is-grp" : undefined}
                data-node-id={row.questionId}
                data-answer-id={row.answerId}
              >
                <td className="is-k">{row.first ? `Q${row.qIndex}` : ""}</td>
                <td className="is-qt">{row.first ? <QuestionText {...c} /> : null}</td>
                <td>{row.first ? <TypeCell {...c} /> : null}</td>
                <td>
                  <AnswerCell {...c} />
                </td>
                <td>{row.first ? <RoleCell {...c} /> : null}</td>
                <td>
                  <ShowsCellView {...c} />
                </td>
                <td>
                  <ThenCell {...c} />
                </td>
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );
}

/** The question text, as the pane's title: every keystroke writes, the end
 *  of the edit commits tracked (save pill). */
function QuestionText(c: CellCtx) {
  const { store } = c;
  const id = c.q.node.id;
  return (
    <InlineText
      value={c.q.node.data.text}
      maxLength={QUESTION_TEXT_MAX}
      ariaLabel={SHEET_COPY.questionLabel(c.q.qIndex)}
      {...(c.commit
        ? {
            onDraftChange: (text: string) => store.put(setQuestionText(store.latest(), id, text)),
            onCommit: (text: string) => store.putTracked(setQuestionText(store.latest(), id, text)),
          }
        : {})}
    />
  );
}

/** The answer text: the pane's own field (mock ptEd + endCap), with the
 *  point number in bold before a numbered scale point. */
function AnswerCell(c: CellCtx) {
  const node = c.q.node;
  const i = c.row.answerIndex;
  const isScale = node.data.question_type === "rating";
  const isPoint = isScale && c.answer.text === String(i + 1);
  const last = node.data.answers.length - 1;
  const endLabel = !isScale
    ? ""
    : i === 0
      ? (node.data.scale_config?.endpoint_label_min ?? "")
      : i === last
        ? (node.data.scale_config?.endpoint_label_max ?? "")
        : "";
  return (
    <>
      {isPoint ? (
        <>
          <b>{i + 1}</b>{" "}
        </>
      ) : null}
      <AnswerTextField
        store={c.store}
        q={c.q}
        answer={c.answer}
        index={i}
        endLabel={endLabel}
        editable={!!c.commit}
        ariaLabel={SHEET_COPY.answerLabel(c.q.qIndex, i + 1)}
        className="qz-lg-tatext"
      />
    </>
  );
}

/** The Question type popover the pane uses (changeQuestionType, its Undo). */
function TypeCell(c: CellCtx) {
  const { store } = c;
  return (
    <QuestionTypePopover
      doc={c.doc}
      q={c.q}
      {...(c.commit ? { commit: store.put } : {})}
      getLatestDoc={store.latest}
      {...(c.undo ? { undo: c.undo } : {})}
      table={{ ariaLabel: SHEET_COPY.typeLabel(c.q.qIndex, c.row.type) }}
    />
  );
}

/** The ONE role control (D9), in the Table's dress. */
function RoleCell(c: CellCtx) {
  const { store } = c;
  if (!c.commit) return <span className={`qz-lg-tdoes is-${c.row.role}`}>{c.row.does}</span>;
  return (
    <QuestionRoleControl
      variant="table"
      doc={c.doc}
      node={c.q.node}
      qIndex={c.q.qIndex}
      deciderQIndex={c.deciderQIndex}
      productIndex={c.productIndex ?? NO_PRODUCTS}
      hasNarrowFields={!!c.hasNarrowFields && !!c.productIndex}
      onCommit={store.put}
      getLatestDoc={store.latest}
      {...(c.undo ? { undo: c.undo } : {})}
    />
  );
}

function ShowsCellView(c: CellCtx) {
  const { store } = c;
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const recs = useMemo(() => recCards(c.recommendations), [c.recommendations]);
  const productById = useMemo(
    () => new Map((c.productIndex ?? NO_PRODUCTS).map((p) => [p.product_id, p])),
    [c.productIndex],
  );
  const shows = c.row.shows;
  const node = c.q.node;
  if (shows.kind === "info") return <span className="qz-lg-dim2">{SHEET_COPY.empty}</span>;
  const aLabel = c.answer.text;
  if (shows.kind === "picks") {
    const unset = shows.targets.length === 0;
    const text = unset ? CHOOSE_A_RESULT : shows.targets.map((t) => t.name).join(", ");
    if (!c.commit) return <span className={`qz-lg-tres${unset ? " is-unset" : ""}`}>{text}</span>;
    const usedBy = new Map<string, number>();
    for (const a of node.data.answers) for (const t of answerTargets(a)) usedBy.set(t, (usedBy.get(t) ?? 0) + 1);
    const trigger = (
      <button
        ref={btnRef}
        type="button"
        className={`qz-lg-tbtn is-res${unset ? " is-unset" : ""}`}
        aria-label={SHEET_COPY.showsLabel(c.q.qIndex, aLabel, text)}
      >
        {unset
          ? text
          : shows.targets.map((t, i) => (
              <Fragment key={`${t.id}:${i}`}>
                {i > 0 ? ", " : null}
                <span className={t.missing ? "qz-lg-tmiss" : undefined}>{t.name}</span>
              </Fragment>
            ))}
        <Caret />
      </button>
    );
    return (
      <PicksPicker
        open={open}
        onOpenChange={setOpen}
        anchorRef={btnRef}
        trigger={trigger}
        recs={recs}
        usedBy={usedBy}
        currentIds={answerTargets(c.answer)}
        productById={productById}
        onToggle={(id, on) =>
          store.put(
            on
              ? addAnswerTarget(store.latest(), node.id, c.answer.id, id)
              : removeAnswerTarget(store.latest(), node.id, c.answer.id, id),
          )
        }
      />
    );
  }
  // Narrows.
  const unset = !shows.keepsAll && shows.values.length === 0;
  const text = c.row.showsText;
  if (!c.commit || !c.readout || !c.productIndex) {
    return <span className={`qz-lg-tval${unset ? " is-unset" : ""}`}>{text}</span>;
  }
  const trigger = (
    <button
      ref={btnRef}
      type="button"
      className={`qz-lg-tbtn is-val${unset ? " is-unset" : ""}`}
      aria-label={SHEET_COPY.showsLabel(c.q.qIndex, aLabel, text)}
    >
      {text}
      <Caret />
    </button>
  );
  return (
    <ValuePickerPopover
      open={open}
      onOpenChange={setOpen}
      anchorRef={btnRef}
      trigger={trigger}
      answer={c.answer}
      siblingAnswers={node.data.answers}
      readout={c.readout}
      productIndex={c.productIndex}
      onApply={(values: FilterValueSet) => {
        store.put(setAnswerFilterValues(store.latest(), node.id, c.answer.id, values));
        setOpen(false);
      }}
    />
  );
}

/** The pane's route menu (mock troute: the same routeMenu). */
function ThenCell(c: CellCtx) {
  const { store } = c;
  return (
    <RouteMenuButton
      doc={c.doc}
      q={c.q}
      answer={c.answer}
      questions={c.questions}
      {...(c.commit ? { commit: store.put } : {})}
      getLatestDoc={store.latest}
      table={{ label: c.row.then, ariaLabel: SHEET_COPY.thenLabel(c.q.qIndex, c.answer.text, c.row.then) }}
    />
  );
}
