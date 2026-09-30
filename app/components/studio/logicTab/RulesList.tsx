import { Fragment, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, KeyboardEvent, MouseEvent, ReactNode } from "react";
import type { DecisionRule, Quiz } from "../../../lib/quizSchema";
import type { LogicStyle } from "../../../lib/logicStyle";
import type { BuilderCategory } from "../../builder/stepProps";
import { describeRuleTokens, type RuleTokens } from "../../../lib/ruleSummary";
import { neverRunsTag, type RuleStatus } from "../../../lib/ruleStatus";
import { moveDecisionRule, removeDecisionRule, restoreDecisionRules } from "../../../lib/quizMutations";
import { RULE_COPY, VERBS } from "./logicCopy";

// ════════════════════════════════════════════════════════════════════════════
// Logic step redesign — THE rules list (D11, D17, D19; handoff "Rules only ·
// Edit" §2). One component, two variants, so B15/B18/B19/B48 are fixed once:
//
//   variant "row"    — Rules only: ol.rlist2 of .rr rows. Grip ⠿ (drag to
//                      reorder, the drop line on the TRUE landing edge, B18),
//                      number, sentence + tags, ↑/↓ and trash revealed on
//                      hover and focus-within.
//   variant "column" — the Filter Results + Rules rules column: .rrow rows,
//                      .rnum, no grip, no drag.
//
// Row body = ONE real <button> (B48): click / Enter / Space opens the rule
// window, bound to the rule ID. ↑, ↓ and trash are sibling buttons. Alt+Arrow
// on a focused row moves it. Delete and move commit at once (no confirm) and
// raise an Undo toast whose inverse is a mutation against the LATEST doc
// (D7): delete → restoreDecisionRules at the ORIGINAL index; move → move the
// rule back. Deletes inside one toast accumulate ("2 rules deleted").
// Focus: after a delete the trash is gone, so the toast's Undo takes focus
// and, when the toast leaves, focus lands on the row that took its place
// (B30/B32); after a move focus follows the rule.
// Read-only hosts (no commit) get rows without drag, arrows or trash.
// ════════════════════════════════════════════════════════════════════════════

type QuizDoc = Quiz;

/** The subset of useLogicUndo the list needs (the card owns ONE undo run
 *  for the whole Logic view, so a row delete and a rule-window delete
 *  accumulate into the same toast). */
export type RulesUndo = {
  push: (p: {
    message: string;
    inverse: (doc: QuizDoc) => QuizDoc;
    isDelete?: boolean;
    focusAfter?: () => void;
    focusAction?: boolean;
    returnFocus?: () => void;
  }) => void;
  isLive: () => boolean;
};

export type RulesListProps = {
  variant: "row" | "column";
  doc: QuizDoc;
  /** The SCREEN style the rules are drawn in (verb chip, Hide flag). */
  style: LogicStyle;
  /** Every category the view knows (quiz-scoped + shop-global), for names. */
  catById: ReadonlyMap<string, BuilderCategory>;
  /** ruleStatuses(doc, knownIds) — computed ONCE per doc by the host. */
  statuses: ReadonlyMap<string, RuleStatus>;
  /** Rows lit from a hovered / focused recommendation pill (B49). */
  litRuleIds?: ReadonlySet<string>;
  /** Rows flashing after a create or a check-popover jump. */
  flashRuleIds?: ReadonlySet<string>;
  /** Opens the rule window for this rule id. */
  onEdit?: (ruleId: string) => void;
  /** Absent = read-only. */
  commit?: (doc: QuizDoc) => void;
  getLatestDoc: () => QuizDoc;
  undo?: RulesUndo;
  /** Rendered instead of the list when there are no rules. */
  empty?: ReactNode;
};

const short = (t: string) => (t.length > 30 ? `${t.slice(0, 28).trimEnd()}…` : t);

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

/** Tag texts for a rule, blocking reasons first (D19, the mock's tag
 *  style): the never-runs reason, then every other flag, then the Rules-only
 *  Hide note. */
export function ruleTags(
  rule: Pick<DecisionRule, "action">,
  status: RuleStatus | undefined,
  style: LogicStyle,
): string[] {
  const tags: string[] = [];
  const nr = neverRunsTag(status);
  if (nr) tags.push(nr);
  for (const f of status?.flags ?? []) tags.push(f.text);
  if (style === "rules" && rule.action === "hide") tags.push(RULE_COPY.hidesTag);
  return tags;
}

/** The plain-text form of a rule sentence (accessible names, titles). */
export function ruleSentenceText(tokens: RuleTokens, catById: ReadonlyMap<string, BuilderCategory>): string {
  const verb = VERBS[tokens.verb].name;
  const recs = tokens.targetIds.length
    ? tokens.targetIds.map((id) => catById.get(id)?.name ?? RULE_COPY.missingRecommendation).join(" ")
    : "…";
  if (tokens.groups.length === 0) return `${verb} ${recs} when …`;
  const groups = tokens.groups.map((g) => {
    const ans = g.answers.map((a) => a.text);
    const body = ans.length > 1 || g.not ? `(${ans.join(` ${g.join} `)})` : ans[0]!;
    return `${g.not ? "not " : ""}${g.qLabel && g.qIndex !== null ? `Q${g.qIndex} ` : ""}${body}`;
  });
  return `${verb} ${recs} when ${groups.join(` ${tokens.across} `)}`;
}

/** D17 — the rule sentence, exactly the mock's sentence(r, true): verb chip,
 *  recommendation chips, " when ", groups in question order, "(A or B)" for a
 *  multi-answer group, bold joins, "not (…)", the question label only when
 *  the answer text repeats on another question. Chips never wrap (B47); a
 *  chip cut at 30 characters carries its full text as a title (B20).
 *  Exported for the rule window's footer sentence. */
export function RuleSentence({
  tokens,
  catById,
}: {
  tokens: RuleTokens;
  catById: ReadonlyMap<string, BuilderCategory>;
}) {
  const cj = (w: string) => (
    <>
      {" "}
      <b className="qz-lg-cj">{w}</b>{" "}
    </>
  );
  return (
    <>
      <span className="qz-lg-cchip is-v">{VERBS[tokens.verb].name}</span>{" "}
      {tokens.targetIds.length
        ? tokens.targetIds.map((id, i) => {
            const cat = catById.get(id);
            return (
              <Fragment key={`${id}:${i}`}>
                {i > 0 ? " " : null}
                <span className={`qz-lg-cchip is-res${cat ? "" : " is-missing"}`}>
                  {cat ? cat.name : RULE_COPY.missingRecommendation}
                </span>
              </Fragment>
            );
          })
        : "…"}
      {tokens.groups.length === 0 ? " when …" : " when "}
      {tokens.groups.map((g, gi) => {
        const prefix = g.qIndex !== null ? `Q${g.qIndex} = ` : null;
        const chips = g.answers.map((a, x) => {
          // A scale group reads "Q3 = 4" once, then bare points (mock data-ns).
          const full = x > 0 && prefix && a.text.startsWith(prefix) ? a.text.slice(prefix.length) : a.text;
          const t = short(full);
          return (
            <Fragment key={`${a.answerId}:${x}`}>
              {x > 0 ? cj(g.join) : null}
              <span
                className={`qz-lg-cchip${a.missing ? " is-missing" : ""}`}
                title={t === full ? undefined : full}
              >
                {t}
              </span>
            </Fragment>
          );
        });
        const wrapped = g.answers.length > 1 || g.not;
        return (
          <Fragment key={`${g.questionId}:${g.not ? "n" : "i"}:${gi}`}>
            {gi > 0 ? cj(tokens.across) : null}
            {g.not ? (
              <>
                <b className="qz-lg-cj">not</b>{" "}
              </>
            ) : null}
            {g.qLabel && g.qIndex !== null ? <i className="qz-lg-qlab">Q{g.qIndex}</i> : null}
            {wrapped ? <>({chips})</> : chips}
          </Fragment>
        );
      })}
    </>
  );
}

type PendingFocus =
  | { ruleId: string; control: "up" | "down" | "body" }
  | null;

export function RulesList({
  variant,
  doc,
  style,
  catById,
  statuses,
  litRuleIds,
  flashRuleIds,
  onEdit,
  commit,
  getLatestDoc,
  undo,
  empty,
}: RulesListProps) {
  const rules = useMemo(() => doc.decision_rules ?? [], [doc.decision_rules]);
  const editable = !!commit;
  const listRef = useRef<HTMLOListElement>(null);
  // Deletes counted inside the live Undo run ("2 rules deleted").
  const runDeletes = useRef(0);
  // Focus follows a moved rule once the re-render lands.
  const pendingFocus = useRef<PendingFocus>(null);
  const [drag, setDrag] = useState<{ from: number; over: { index: number; after: boolean } | null } | null>(
    null,
  );

  const tokensById = useMemo(
    () => new Map(rules.map((r) => [r.id, describeRuleTokens(r, doc, style)])),
    [rules, doc, style],
  );

  useLayoutEffect(() => {
    const want = pendingFocus.current;
    if (!want) return;
    pendingFocus.current = null;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-rule-id="${CSS.escape(want.ruleId)}"]`);
    if (!row) return;
    const pick = (sel: string) => row.querySelector<HTMLButtonElement>(sel);
    let target: HTMLButtonElement | null = null;
    if (want.control === "body") target = pick(".qz-lg-rbody");
    else {
      const same = pick(`[data-move="${want.control}"]`);
      const other = pick(`[data-move="${want.control === "up" ? "down" : "up"}"]`);
      target = same && !same.disabled ? same : other && !other.disabled ? other : pick(".qz-lg-rbody");
    }
    target?.focus();
  }, [rules]);

  const focusRuleBody = (ruleId: string) => {
    window.requestAnimationFrame(() => {
      const el = listRef.current?.querySelector<HTMLElement>(
        `[data-rule-id="${CSS.escape(ruleId)}"] .qz-lg-rbody`,
      );
      el?.focus();
    });
  };

  // After a delete: the row that took its place, else the new last row, else
  // the empty state's own control (the card marks it data-rules-empty-focus).
  const focusAfterDelete = (index: number) => () => {
    const list = listRef.current;
    const card = list?.closest('[data-testid="logic-tab-card"]') ?? document;
    const bodies = list ? Array.from(list.querySelectorAll<HTMLElement>(".qz-lg-rbody")) : [];
    const target =
      bodies[index] ??
      bodies[bodies.length - 1] ??
      card.querySelector<HTMLElement>("[data-rules-empty-focus]");
    target?.focus();
  };

  const deleteRule = (rule: DecisionRule, index: number) => {
    if (!commit) return;
    const latest = getLatestDoc();
    const next = removeDecisionRule(latest, rule.id);
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
      focusAfter: () => focusRuleBody(rule.id),
    });
  };

  const moveRule = (ruleId: string, from: number, to: number, control: "up" | "down" | "body") => {
    if (!commit || to < 0 || to >= rules.length || to === from) return;
    const latest = getLatestDoc();
    const next = moveDecisionRule(latest, ruleId, to);
    if (next === latest) return;
    pendingFocus.current = { ruleId, control };
    commit(next);
    if (!undo) return;
    if (!undo.isLive()) runDeletes.current = 0;
    undo.push({
      message: RULE_COPY.moved(from + 1, to + 1),
      inverse: (d) => {
        const at = (d.decision_rules ?? []).findIndex((r) => r.id === ruleId);
        return at < 0 ? d : moveDecisionRule(d, ruleId, from);
      },
      focusAfter: () => focusRuleBody(ruleId),
    });
  };

  if (rules.length === 0) return <>{empty ?? null}</>;

  const isRow = variant === "row";
  // B18 — ONE calculation yields the drop index AND the edge the line sits on.
  const dropAt = (e: DragEvent<HTMLElement>, index: number, from: number) => {
    const b = e.currentTarget.getBoundingClientRect();
    const after = e.clientY > b.top + b.height / 2;
    let at = index + (after ? 1 : 0);
    if (at > from) at--;
    return { at, after };
  };

  return (
    <ol
      ref={listRef}
      className={isRow ? "qz-lg-rlist2" : "qz-lg-rlist"}
      aria-label={RULE_COPY.listLabel}
      onDragLeave={(e) => {
        if (!drag) return;
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDrag((d) => (d ? { ...d, over: null } : d));
      }}
    >
      {rules.map((rule, i) => {
        const status = statuses.get(rule.id);
        const tokens = tokensById.get(rule.id)!;
        const tags = ruleTags(rule, status, style);
        const dead = status ? !status.canRun : false;
        const n = i + 1;
        const plain = ruleSentenceText(tokens, catById);
        const lit = litRuleIds?.has(rule.id) ?? false;
        const flash = flashRuleIds?.has(rule.id) ?? false;
        const overHere = drag?.over && drag.over.index === i ? drag.over : null;
        const rowClass = [
          isRow ? "qz-lg-rr" : "qz-lg-rrow",
          dead ? "is-dead" : "",
          lit ? "is-lit" : "",
          flash ? "is-flash" : "",
          drag?.from === i ? "is-dragging" : "",
          overHere ? (overHere.after ? "is-under" : "is-over") : "",
        ]
          .filter(Boolean)
          .join(" ");
        const onRowClick = (e: MouseEvent<HTMLLIElement>) => {
          // The row's padding and the grip also open the rule; the row's own
          // buttons handle their own clicks.
          if ((e.target as HTMLElement).closest("button")) return;
          onEdit?.(rule.id);
        };
        const onRowKey = (e: KeyboardEvent<HTMLLIElement>) => {
          if (!editable || !e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
          e.preventDefault();
          moveRule(rule.id, i, i + (e.key === "ArrowUp" ? -1 : 1), "body");
        };
        const dragProps =
          isRow && editable
            ? {
                draggable: true,
                onDragStart: (e: DragEvent<HTMLLIElement>) => {
                  setDrag({ from: i, over: null });
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", "rule");
                },
                onDragOver: (e: DragEvent<HTMLLIElement>) => {
                  if (!drag) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  const d = dropAt(e, i, drag.from);
                  const over = d.at !== drag.from ? { index: i, after: d.after } : null;
                  if (over?.index !== drag.over?.index || over?.after !== drag.over?.after) {
                    setDrag({ ...drag, over });
                  }
                },
                onDrop: (e: DragEvent<HTMLLIElement>) => {
                  if (!drag) return;
                  e.preventDefault();
                  const to = dropAt(e, i, drag.from).at;
                  const from = drag.from;
                  setDrag(null);
                  if (to !== from) moveRule(rules[from]!.id, from, to, "body");
                },
                onDragEnd: () => setDrag(null),
              }
            : {};
        return (
          <li
            key={rule.id}
            className={rowClass}
            data-rule-id={rule.id}
            data-ri={i}
            title={isRow ? RULE_COPY.rowTip : RULE_COPY.columnRowTip}
            onClick={onRowClick}
            onKeyDown={onRowKey}
            {...dragProps}
          >
            {isRow ? (
              <span className="qz-lg-grip" aria-hidden>
                ⠿
              </span>
            ) : null}
            <button
              type="button"
              className="qz-lg-rbody"
              title={isRow ? RULE_COPY.rowTip : RULE_COPY.columnRowTip}
              aria-label={RULE_COPY.editLabel(n, [plain, ...tags].join(". "))}
              onClick={() => onEdit?.(rule.id)}
            >
              <span className={isRow ? "qz-lg-rn" : "qz-lg-rnum"}>{n}</span>
              <span className={isRow ? "qz-lg-rs" : "qz-lg-rsay"}>
                <span className="qz-lg-rsent">
                  <RuleSentence tokens={tokens} catById={catById} />
                </span>
                {tags.map((t) => (
                  <span key={t} className="qz-lg-rtag">
                    {t}
                  </span>
                ))}
              </span>
            </button>
            {editable ? (
              <>
                <span className="qz-lg-mv">
                  <button
                    type="button"
                    className="qz-lg-xone"
                    data-move="up"
                    aria-label={RULE_COPY.moveUp(n)}
                    title="Move up"
                    disabled={i === 0}
                    onClick={() => moveRule(rule.id, i, i - 1, "up")}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="qz-lg-xone"
                    data-move="down"
                    aria-label={RULE_COPY.moveDown(n)}
                    title="Move down"
                    disabled={i === rules.length - 1}
                    onClick={() => moveRule(rule.id, i, i + 1, "down")}
                  >
                    ↓
                  </button>
                </span>
                <button
                  type="button"
                  className="qz-lg-xone qz-lg-xdel"
                  title={RULE_COPY.deleteTip}
                  aria-label={RULE_COPY.deleteLabel(n)}
                  onClick={() => deleteRule(rule, i)}
                >
                  {TRASH}
                </button>
              </>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
