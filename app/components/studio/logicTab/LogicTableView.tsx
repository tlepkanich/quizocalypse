import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import type { Answer, Quiz } from "../../../lib/quizSchema";
import { isFreeformType } from "../../../lib/quizSchema";
import type { LogicStyle } from "../../../lib/logicStyle";
import type { OrderedQuestion } from "../../../lib/questionOrder";
import type { RuleStatus } from "../../../lib/ruleStatus";
import type { IndexedProduct } from "../../../lib/recommendationEngine";
import type { AttributeReadout } from "../../../lib/attributeClustering";
import {
  addAnswerTarget,
  changeQuestionRole,
  removeAnswerTarget,
  removeDecisionRule,
  restoreDecisionRules,
  setAnswerFilterValues,
  setAnswerRoute,
  setAnswerText,
  setQuestionText,
  setScaleEndLabels,
  ANSWER_TEXT_MAX,
  QUESTION_TEXT_MAX,
  SCALE_LABEL_MAX,
} from "../../../lib/quizMutations";
import {
  answerDestination,
  applyQuestionType,
  logicPartsInverse,
  logicSheets,
  type AnswerSheetRow,
  type AnySheet,
  type ParsedType,
  type RecSheetRow,
  type RuleSheetRow,
  type WhenParts,
} from "../../../lib/logicSheets";
import { answerTargets } from "../../../lib/recommendDecider";
import type { BuilderCategory } from "../../builder/stepProps";
import { QzMenu, QzPopover, type QzMenuItem } from "../../qz-overlays";
import { useQzToast } from "../../qz-toast";
import type { SaveToken } from "../saveTracker";
import type { RulesUndo } from "./RulesList";
import { ruleTags } from "./RulesList";
import { InlineText } from "./InlineText";
import { ValuePickerPopover, type FilterValueSet } from "./ValuePickerPopover";
import { AttributePickerDialog } from "./AttributePickerDialog";
import { answerHasSelection, applyNarrowField, narrowAppliedToast } from "./logicTabFields";
import { CHOOSE_A_RESULT, ROLE_MENU, RULE_COPY, SHEET_COPY } from "./logicCopy";

// ════════════════════════════════════════════════════════════════════════════
// Logic step redesign — the Table view (mock tableHTML / sheets; handoff
// "Table view, Export and Import", D16, D17, B40, B48, B64). It renders the
// SAME rows logicSheets serializes, so the Table and the exported file
// cannot diverge. Either style; the header's slot shows Import | Export.
//
//   Rules sheet      "#" is a real button ("Edit rule N"); the row click
//                    calls the same action (never role=button on the tr,
//                    B48). Verb, recommendations, the When cell with bold
//                    joins, the rule's tags from the one status (D3), and a
//                    faint trash that deletes with the card's Undo (D7;
//                    deletes inside one toast accumulate).
//   Answers sheet    (Filter Results + Rules) Q, question and answer as
//                    InlineText, Type / What it does / Shows / keeps / Then
//                    as .tbtn popover triggers. Every write is the Edit
//                    view's mutation, against the latest doc. Popovers take
//                    the row's question as data: nothing here moves the
//                    Edit view's selection (B40).
//   Recommendations  (Rules only) read-only status; a "Needs a rule" row's
//                    name opens "Create a rule" with it picked.
//
// Integration notes: the Type cell uses a small type menu built on the same
// write the Question type popover uses (applyQuestionType: answers kept,
// Five-point stamps the preset, leaving multi-select converts all-of); swap
// in agent D's QuestionTypePopover once both land. The role menu runs the
// one D9 path (changeQuestionRole) with a named toast and Undo.
// ════════════════════════════════════════════════════════════════════════════

type QuizDoc = Quiz;

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

const truncate = (s: string, n = 34) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

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
            <SheetTable sheet={sh} {...props} />
          </SheetWrap>
        </section>
      ))}
    </div>
  );
}

function SheetTable(props: LogicTableViewProps & { sheet: AnySheet }) {
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

function RulesTable({
  rows,
  cols,
  doc,
  style,
  statuses,
  commit,
  getLatestDoc,
  undo,
  onEditRule,
}: LogicTableViewProps & { rows: RuleSheetRow[]; cols: readonly string[] }) {
  const tbodyRef = useRef<HTMLTableSectionElement>(null);
  const runDeletes = useRef(0);
  const editable = !!commit;
  const rulesById = useMemo(() => new Map((doc.decision_rules ?? []).map((r) => [r.id, r])), [doc.decision_rules]);

  const focusAfterDelete = (index: number) => () => {
    const btns = tbodyRef.current ? Array.from(tbodyRef.current.querySelectorAll<HTMLElement>(".qz-lg-tgob")) : [];
    (btns[index] ?? btns[btns.length - 1])?.focus();
  };

  const deleteRule = (ruleId: string) => {
    if (!commit) return;
    const latest = getLatestDoc();
    const index = (latest.decision_rules ?? []).findIndex((r) => r.id === ruleId);
    if (index < 0) return;
    const rule = latest.decision_rules![index]!;
    const next = removeDecisionRule(latest, ruleId);
    if (next === latest) return;
    commit(next);
    if (!undo) return;
    if (!undo.isLive()) runDeletes.current = 0;
    runDeletes.current += 1;
    undo.push({
      message: runDeletes.current > 1 ? RULE_COPY.deletedMany(runDeletes.current) : RULE_COPY.deleted(index + 1),
      inverse: (d) => restoreDecisionRules(d, [{ rule, index }]),
      isDelete: true,
      focusAction: true,
      returnFocus: focusAfterDelete(index),
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
          rows.map((row) => {
            const status = statuses.get(row.ruleId);
            const rule = rulesById.get(row.ruleId);
            const tags = rule ? ruleTags(rule, status, style) : [];
            const muted = status ? !status.canRun : false;
            const open = () => onEditRule?.(row.ruleId);
            const onRowClick = (e: MouseEvent<HTMLTableRowElement>) => {
              if ((e.target as HTMLElement).closest("button")) return;
              open();
            };
            return (
              <tr
                key={row.ruleId}
                className={`${onEditRule ? "is-go" : ""}${muted ? " is-muted" : ""}`}
                data-rule-id={row.ruleId}
                onClick={onEditRule ? onRowClick : undefined}
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
                    ? row.targets.map((t, i) => (
                        <Fragment key={`${t.id}:${i}`}>
                          {i > 0 ? ", " : null}
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
}: LogicTableViewProps & { rows: RecSheetRow[]; cols: readonly string[] }) {
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

type CellCtx = LogicTableViewProps & {
  q: OrderedQuestion;
  answer: Answer;
  row: AnswerSheetRow;
};

function useWrite(props: LogicTableViewProps) {
  const toast = useQzToast();
  const { commit, commitTracked, getLatestDoc, undo } = props;
  /** One commit of `fn(latest)`; returns the save token when tracked. */
  const write = (fn: (d: QuizDoc) => QuizDoc): { before: QuizDoc; after: QuizDoc; token?: SaveToken } | null => {
    if (!commit) return null;
    const before = getLatestDoc();
    const after = fn(before);
    if (after === before) return null;
    if (commitTracked) return { before, after, token: commitTracked(after) };
    commit(after);
    return { before, after };
  };
  /** A write announced with Undo (inverse restores only what it changed). */
  const announce = (message: string, before: QuizDoc, after: QuizDoc) => {
    const inverse = logicPartsInverse(before, after);
    if (undo && inverse) undo.push({ message, inverse });
    else toast(message);
  };
  return { write, announce, toast };
}

function AnswersTable(props: LogicTableViewProps & { rows: AnswerSheetRow[]; cols: readonly string[] }) {
  const { rows, cols, questions } = props;
  const nodes = useMemo(() => new Map(questions.map((q) => [q.node.id, q])), [questions]);
  const [narrowFor, setNarrowFor] = useState<string | null>(null);
  const { write, toast } = useWrite(props);
  const narrowQ = narrowFor ? nodes.get(narrowFor) : undefined;
  return (
    <>
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
              const c: CellCtx = { ...props, q, answer, row };
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
                    <AnswerText {...c} />
                  </td>
                  <td>{row.first ? <RoleCell {...c} onNarrowPick={() => setNarrowFor(q.node.id)} /> : null}</td>
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
      {narrowQ && props.productIndex ? (
        <AttributePickerDialog
          qIndex={narrowQ.qIndex}
          productIndex={props.productIndex}
          currentField={null}
          onCancel={() => setNarrowFor(null)}
          onUse={(field) => {
            setNarrowFor(null);
            let applied: ReturnType<typeof applyNarrowField> = null;
            const res = write((d) => {
              applied = applyNarrowField(d, narrowQ.node.id, props.productIndex ?? [], field);
              return applied ? applied.doc : d;
            });
            const a = applied as ReturnType<typeof applyNarrowField>;
            if (res && a) toast(narrowAppliedToast(narrowQ.node.data.text, field, a.mapped, a.unmatched));
          }}
        />
      ) : null}
    </>
  );
}

function QuestionText(c: CellCtx) {
  const { write } = useWrite(c);
  return (
    <InlineText
      value={c.q.node.data.text}
      maxLength={QUESTION_TEXT_MAX}
      ariaLabel={SHEET_COPY.questionLabel(c.q.qIndex)}
      {...(c.commit
        ? { onCommit: (next: string) => write((d) => setQuestionText(d, c.q.node.id, next))?.token }
        : {})}
    />
  );
}

function AnswerText(c: CellCtx) {
  const { write } = useWrite(c);
  const node = c.q.node;
  const i = c.row.answerIndex;
  const isScale = node.data.question_type === "rating";
  const isPoint = isScale && c.answer.text === String(i + 1);
  if (isPoint) {
    // B45: a numbered point shows its number; the two ends carry the
    // scale's end labels, editable here.
    const last = i === node.data.answers.length - 1;
    const end = i === 0 ? "lo" : last ? "hi" : null;
    const label =
      end === "lo"
        ? node.data.scale_config?.endpoint_label_min
        : end === "hi"
          ? node.data.scale_config?.endpoint_label_max
          : undefined;
    return (
      <span className="qz-lg-tpt">
        <b>{i + 1}</b>
        {end ? (
          <>
            {" "}
            <InlineText
              value={label ?? ""}
              maxLength={SCALE_LABEL_MAX}
              allowEmpty
              placeholder="Add label"
              ariaLabel={SHEET_COPY.answerLabel(c.q.qIndex, i + 1)}
              {...(c.commit
                ? {
                    onCommit: (next: string) =>
                      write((d) =>
                        setScaleEndLabels(d, node.id, end === "lo" ? next : undefined, end === "hi" ? next : undefined),
                      )?.token,
                  }
                : {})}
            />
          </>
        ) : null}
      </span>
    );
  }
  return (
    <InlineText
      value={c.answer.text}
      maxLength={ANSWER_TEXT_MAX}
      ariaLabel={SHEET_COPY.answerLabel(c.q.qIndex, i + 1)}
      {...(c.commit
        ? { onCommit: (next: string) => write((d) => setAnswerText(d, node.id, c.answer.id, next))?.token }
        : {})}
    />
  );
}

type TypePick = "single" | "multi" | "five" | "scale";

function TypeCell(c: CellCtx) {
  const { write, announce } = useWrite(c);
  const node = c.q.node;
  const t = node.data.question_type;
  const five = t === "rating" && node.data.scale_config?.min === 1 && node.data.scale_config?.max === 5;
  const current: TypePick | null =
    t === "single_select" ? "single" : t === "multi_select" ? "multi" : t === "rating" ? (five ? "five" : "scale") : null;
  const label = c.row.type;
  if (!c.commit || isFreeformType(t)) return <span className="qz-lg-tdim">{label}</span>;
  const count = node.data.answers.length;
  const pick = (k: TypePick) => {
    if (k === current) return;
    const p: ParsedType =
      k === "single"
        ? { type: "single_select" }
        : k === "multi"
          ? { type: "multi_select", min: 1, max: count }
          : k === "five"
            ? { type: "rating", five: true, n: 5 }
            : { type: "rating", five: false, n: count };
    let converted = 0;
    const res = write((d) => {
      const r = applyQuestionType(d, node.id, p);
      converted = r.converted;
      return r.doc;
    });
    if (!res) return;
    const names: Record<TypePick, string> = {
      single: SHEET_COPY.type.single,
      multi: "Multi-select",
      five: SHEET_COPY.type.five,
      scale: "Scale",
    };
    const msg = SHEET_COPY.typeChanged(c.q.qIndex, names[k]);
    announce(converted ? `${msg}. ${SHEET_COPY.anyOfNow(c.q.qIndex)}` : msg, res.before, res.after);
  };
  const items: QzMenuItem[] = [
    ...(current === null ? [{ label, onSelect: () => {}, checked: true }] : []),
    { label: SHEET_COPY.type.single, onSelect: () => pick("single"), checked: current === "single" },
    { label: "Multi-select", onSelect: () => pick("multi"), checked: current === "multi" },
    { label: SHEET_COPY.type.five, onSelect: () => pick("five"), checked: current === "five" },
    { label: "Scale", onSelect: () => pick("scale"), checked: current === "scale" },
  ];
  return (
    <QzMenu
      title={SHEET_COPY.typeMenuTitle}
      ariaLabel={SHEET_COPY.typeMenuTitle}
      width={220}
      items={items}
      trigger={
        <button type="button" className="qz-lg-tbtn is-dim" aria-label={SHEET_COPY.typeLabel(c.q.qIndex, label)}>
          {label}
          <Caret />
        </button>
      }
    />
  );
}

function RoleCell(c: CellCtx & { onNarrowPick: () => void }) {
  const { write, announce } = useWrite(c);
  const node = c.q.node;
  const role = c.row.role;
  const label = c.row.does;
  if (!c.commit) return <span className={`qz-lg-tdoes is-${role}`}>{label}</span>;
  const cannotDecide = isFreeformType(node.data.question_type);
  const decider = c.questions.find((x) => x.node.data.role === "decides");
  const qn = (id: string) => c.questions.find((x) => x.node.id === id)?.qIndex ?? 0;
  const set = (k: "decides" | "filter" | "info") => {
    if (k === role) return;
    if (
      k === "filter" &&
      c.hasNarrowFields &&
      c.productIndex &&
      !node.data.answers.some((a) => a.no_preference === true || answerHasSelection(a))
    ) {
      // D19 kept: a Narrows flip with no values opens the attribute dialog.
      c.onNarrowPick();
      return;
    }
    let lost: ReturnType<typeof changeQuestionRole>["lost"] = {};
    const res = write((d) => {
      const r = changeQuestionRole(d, node.id, k === "info" ? "qualifier" : k);
      lost = r.lost;
      return r.doc;
    });
    if (!res) return;
    const l = lost as ReturnType<typeof changeQuestionRole>["lost"];
    const parts = [
      k === "decides" ? SHEET_COPY.roleMoved(c.q.qIndex) : SHEET_COPY.roleChanged(c.q.qIndex, SHEET_COPY.does[k]),
    ];
    if (l.targets) parts.push(SHEET_COPY.roleLost(qn(l.targets.nodeId), l.targets.count));
    if (l.values) parts.push(SHEET_COPY.valuesLost(qn(l.values.nodeId), l.values.count));
    announce(parts.join(". "), res.before, res.after);
  };
  const items: QzMenuItem[] = ROLE_MENU.map((j) => ({
    label: j.n,
    hint:
      j.k === "decides" && cannotDecide
        ? "needs answers to choose from"
        : j.k === "decides" && decider && decider.node.id !== node.id
          ? `now on Q${decider.qIndex}`
          : j.hint,
    checked: j.k === role,
    disabled: j.k === "decides" && cannotDecide,
    onSelect: () => set(j.k),
  }));
  return (
    <QzMenu
      title={SHEET_COPY.roleMenuTitle(c.q.qIndex)}
      ariaLabel={SHEET_COPY.roleMenuTitle(c.q.qIndex)}
      width={300}
      items={items}
      trigger={
        <button
          type="button"
          className={`qz-lg-tbtn is-does is-${role}`}
          aria-label={SHEET_COPY.roleLabel(c.q.qIndex, label)}
        >
          {label}
          <Caret />
        </button>
      }
    />
  );
}

function ShowsCellView(c: CellCtx) {
  const { write } = useWrite(c);
  const [open, setOpen] = useState(false);
  const shows = c.row.shows;
  const node = c.q.node;
  if (shows.kind === "info") return <span className="qz-lg-dim2">{SHEET_COPY.empty}</span>;
  const aLabel = c.answer.text;
  if (shows.kind === "picks") {
    const unset = shows.targets.length === 0;
    const text = unset ? CHOOSE_A_RESULT : shows.targets.map((t) => t.name).join(", ");
    const trigger = (
      <button
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
    if (!c.commit) return <span className={`qz-lg-tres${unset ? " is-unset" : ""}`}>{text}</span>;
    const picked = new Set(answerTargets(c.answer));
    return (
      <QzPopover
        open={open}
        onOpenChange={setOpen}
        ariaHaspopup="dialog"
        ariaLabel={CHOOSE_A_RESULT}
        manageFocus
        width={280}
        trigger={trigger}
        content={
          <div className="qz-lg-tpick">
            <div className="qz-lg-tpick-h">{CHOOSE_A_RESULT}</div>
            <div className="qz-lg-tpick-l" data-qz-pop-list>
              {c.recommendations.map((r) => {
                const on = picked.has(r.id);
                return (
                  <button
                    key={r.id}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    className={`qz-lg-tpick-i${on ? " is-on" : ""}`}
                    onClick={() =>
                      write((d) =>
                        on ? removeAnswerTarget(d, node.id, c.answer.id, r.id) : addAnswerTarget(d, node.id, c.answer.id, r.id),
                      )
                    }
                  >
                    <span className="qz-lg-tpick-ck" aria-hidden="true">
                      {on ? "✓" : ""}
                    </span>
                    <span className="qz-lg-tpick-n">{r.name}</span>
                    <span className="qz-lg-tpick-c">{r.productIds.length}</span>
                  </button>
                );
              })}
            </div>
            <div className="qz-lg-tpick-f">
              <button type="button" className="qz-lg-btn is-pri" onClick={() => setOpen(false)}>
                {SHEET_COPY.pickerDone}
              </button>
            </div>
          </div>
        }
      />
    );
  }
  // Narrows.
  const unset = !shows.keepsAll && shows.values.length === 0;
  const text = c.row.showsText;
  const trigger = (
    <button
      type="button"
      className={`qz-lg-tbtn is-val${unset ? " is-unset" : ""}`}
      aria-label={SHEET_COPY.showsLabel(c.q.qIndex, aLabel, text)}
    >
      {text}
      <Caret />
    </button>
  );
  if (!c.commit || !c.readout || !c.productIndex) {
    return <span className={`qz-lg-tval${unset ? " is-unset" : ""}`}>{text}</span>;
  }
  return (
    <ValuePickerPopover
      open={open}
      onOpenChange={setOpen}
      trigger={trigger}
      answer={c.answer}
      siblingAnswers={node.data.answers}
      readout={c.readout}
      productIndex={c.productIndex}
      onApply={(values: FilterValueSet) => {
        write((d) => setAnswerFilterValues(d, node.id, c.answer.id, values));
        setOpen(false);
      }}
    />
  );
}

function ThenCell(c: CellCtx) {
  const { write } = useWrite(c);
  const label = c.row.then;
  const aLabel = c.answer.text;
  if (!c.commit) return <span className="qz-lg-tdim">{label}</span>;
  const q = c.q;
  const qIndexByNode = new Map(c.questions.map((x) => [x.node.id, x.qIndex]));
  const dest = answerDestination(c.doc, q, c.answer, qIndexByNode, c.questions.length);
  const nextQ = c.questions.find((x) => x.qIndex === q.qIndex + 1);
  const later = c.questions.filter((x) => x.qIndex > q.qIndex + 1);
  const resultNode = c.doc.nodes.find((n) => n.type === "result") ?? c.doc.nodes.find((n) => n.type === "end");
  const go = (target: string | null) => write((d) => setAnswerRoute(d, q.node.id, c.answer.id, target));
  const items: QzMenuItem[] = [
    ...(nextQ
      ? [
          {
            label: SHEET_COPY.then.next,
            hint: truncate(nextQ.node.data.text, 28),
            checked: dest.kind === "next",
            onSelect: () => go(null),
          },
        ]
      : []),
    ...later.map((x) => ({
      label: SHEET_COPY.then.skip(x.qIndex),
      hint: truncate(x.node.data.text, 28),
      checked: dest.kind === "skip" && dest.nodeId === x.node.id,
      onSelect: () => go(x.node.id),
    })),
    ...(resultNode
      ? [
          {
            label: SHEET_COPY.then.results,
            checked: dest.kind === "results",
            onSelect: () => (dest.kind === "results" ? undefined : go(resultNode.id)),
          },
        ]
      : []),
  ];
  return (
    <QzMenu
      title={SHEET_COPY.routeMenuTitle(truncate(aLabel, 28))}
      ariaLabel={SHEET_COPY.routeMenuTitle(aLabel)}
      width={300}
      items={items}
      trigger={
        <button type="button" className="qz-lg-tbtn is-dim" aria-label={SHEET_COPY.thenLabel(q.qIndex, aLabel, label)}>
          {label}
          <Caret />
        </button>
      }
    />
  );
}
