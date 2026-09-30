import { useEffect, useId, useRef, useState } from "react";
import type { Quiz } from "../../../lib/quizSchema";
import type { OrderedQuestion } from "../../../lib/questionOrder";
import { setScaleEndLabels, setSelectionBounds } from "../../../lib/quizMutations";
import { QzPopover } from "../../qz-overlays";
import { useQzToast } from "../../qz-toast";
import { TYPE_CHIP_LABEL } from "../../onboarding/questionsLogicV3/content/TypeChipSelector";
import type { PaneUndo } from "./LogicTabMenus";
import { TYPE_COPY } from "./logicCopy";
import {
  SCALE_MAX_POINTS,
  SCALE_MIN_POINTS,
  changeQuestionType,
  isFivePointScale,
  multiBounds,
  overMaxRules,
  restoreQuestionType,
  restoreScalePoint,
  setScalePoints,
  snapshotType,
  type TypePick,
} from "./questionTypeChange";

// ════════════════════════════════════════════════════════════════════════════
// The pane's type line and its "Question type" popover (mock typeMeta,
// typeMenu, ACT.settype/tmin/tmax/tpts; handoff "Type line" and "'Question
// type' popover"). 240px, left-aligned, a radiogroup with arrow keys (B29),
// then the per-type settings: Multi-select Min / Max, Scale points plus the
// two end labels. The popover stays open after a pick so the settings can be
// set. Type changes run the ONE shared implementation (questionTypeChange,
// the live TypeChipSelector semantics while D10 is open): answers are never
// trimmed by a type change; only the points stepper removes a point, and
// that removal is announced with an Undo.
// ════════════════════════════════════════════════════════════════════════════

type QuizDoc = Quiz;
type QuestionNodeDoc = OrderedQuestion["node"];

const OPTIONS: Array<{ pick: TypePick; label: string }> = [
  { pick: "single_select", label: TYPE_COPY.single },
  { pick: "multi_select", label: TYPE_COPY.multi },
  { pick: "rating5", label: TYPE_COPY.five },
  { pick: "rating", label: TYPE_COPY.scale },
];

/** The type line (mock typeMeta): "Single select", "Multi-select · pick
 *  1–3", "Five-point scale", "Scale · 1–N", else the stored type's label. */
export function typeLineLabel(data: QuestionNodeDoc["data"]): string {
  const t = data.question_type;
  if (t === "multi_select") {
    const { min, max } = multiBounds(data);
    return TYPE_COPY.multiLine(min, max);
  }
  if (t === "rating") {
    return isFivePointScale(data) ? TYPE_COPY.five : TYPE_COPY.scaleLine(data.answers.length);
  }
  if (t === "single_select") return TYPE_COPY.single;
  if (t === "image_tile") return TYPE_COPY.image;
  return TYPE_CHIP_LABEL[t] ?? t;
}

function currentPick(data: QuestionNodeDoc["data"]): TypePick {
  return isFivePointScale(data) ? "rating5" : data.question_type;
}

function Stepper({
  value,
  min,
  max,
  label,
  onChange,
  decreaseTip,
}: {
  value: number;
  min: number;
  max: number;
  label: string;
  onChange: (next: number) => void;
  decreaseTip?: string;
}) {
  const wrap = useRef<HTMLSpanElement>(null);
  // A step that reaches an end disables the button that holds focus: hand
  // focus to its twin so it never falls to <body> (B30).
  const step = (d: -1 | 1) => {
    onChange(value + d);
    requestAnimationFrame(() => {
      const el = wrap.current;
      if (!el) return;
      const active = document.activeElement;
      if (active && active !== document.body && el.contains(active) && !(active as HTMLButtonElement).disabled) return;
      if (active && active !== document.body && !el.contains(active)) return;
      el.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    });
  };
  return (
    <span className="qz-lg-stp" ref={wrap}>
      <button
        type="button"
        aria-label={`Decrease ${label}`}
        title={decreaseTip}
        disabled={value <= min}
        onClick={() => step(-1)}
      >
        −
      </button>
      <span className="qz-lg-stv" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        aria-label={`Increase ${label}`}
        disabled={value >= max}
        onClick={() => step(1)}
      >
        +
      </button>
    </span>
  );
}

export function QuestionTypePopover({
  doc,
  q,
  commit,
  getLatestDoc,
  undo,
}: {
  doc: QuizDoc;
  q: OrderedQuestion;
  /** Absent = read-only: the type line renders as text. */
  commit?: (doc: QuizDoc) => void;
  getLatestDoc: () => QuizDoc;
  undo?: PaneUndo;
}) {
  const toast = useQzToast();
  const [open, setOpen] = useState(false);
  const labId = useId();
  const node = q.node;
  const data = node.data;
  const line = typeLineLabel(data);
  const cur = currentPick(data);
  const count = data.answers.length;
  const [lo, setLo] = useState(data.scale_config?.endpoint_label_min ?? "");
  const [hi, setHi] = useState(data.scale_config?.endpoint_label_max ?? "");
  useEffect(() => {
    if (!open) return;
    setLo(data.scale_config?.endpoint_label_min ?? "");
    setHi(data.scale_config?.endpoint_label_max ?? "");
    // Seed on open only: the inputs own their text while it is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!commit) {
    return <span className="qz-lg-qtype is-static">{line}</span>;
  }

  const options = OPTIONS.some((o) => o.pick === cur)
    ? OPTIONS
    : [{ pick: cur, label: typeLineLabel(data) }, ...OPTIONS];

  const pick = (p: TypePick) => {
    if (p === cur) return;
    const base = getLatestDoc();
    const snap = snapshotType(base, node.id);
    const { doc: next, anyOfRuleIds } = changeQuestionType(base, node.id, p);
    if (next === base || !snap) return;
    commit(next);
    if (anyOfRuleIds.length) {
      const message = TYPE_COPY.anyOf(q.qIndex);
      const inverse = (d: QuizDoc) => restoreQuestionType(d, snap, anyOfRuleIds);
      if (undo) undo.push({ message, inverse });
      else toast(message);
    }
  };

  const bounds = multiBounds(data);
  const setMin = (v: number) => {
    const base = getLatestDoc();
    const next = setSelectionBounds(base, node.id, v, bounds.max);
    if (next !== base) commit(next);
  };
  const setMax = (v: number) => {
    const base = getLatestDoc();
    const next = setSelectionBounds(base, node.id, bounds.min, v);
    if (next === base) return;
    commit(next);
    // A lower Max can leave an all-of rule needing more picks than shoppers
    // get: say which (re-made on every step, one keyed toast).
    const hit = overMaxRules(next, node.id);
    if (hit.length) {
      toast(
        TYPE_COPY.overMax(
          q.qIndex,
          hit.map((h) => h.number),
          multiBounds(
            (next.nodes.find((n) => n.id === node.id) as QuestionNodeDoc | undefined)?.data ?? data,
          ).max,
          hit[0]!.needs,
        ),
        { key: `qz-lg-overmax-${node.id}` },
      );
    }
  };

  const lastIndex = count - 1;
  const last = data.answers[lastIndex];
  const lastIsPoint = last ? last.text === String(count) : false;
  const lastMapped = last
    ? !!(last.target_id || last.target_ids?.length || last.tags.length || last.no_preference ||
        last.metafield_filters?.length || last.variant_filters?.length ||
        last.product_type_filters?.length || last.collection_filters?.length)
    : false;
  const setPoints = (n: number) => {
    const base = getLatestDoc();
    const { doc: next, removed } = setScalePoints(base, node.id, n);
    if (next === base) return;
    commit(next);
    if (removed) {
      const a = removed.answer;
      const mapped = !!(a.target_id || a.target_ids?.length || a.tags.length || a.no_preference ||
        a.metafield_filters?.length || a.variant_filters?.length ||
        a.product_type_filters?.length || a.collection_filters?.length);
      const message = TYPE_COPY.pointRemoved(removed.index + 1, q.qIndex, mapped);
      const inverse = (d: QuizDoc) => restoreScalePoint(d, removed);
      if (undo) undo.push({ message, inverse, isDelete: true });
      else toast(message);
    }
  };

  const writeLabel = (which: "lo" | "hi", v: string) => {
    if (which === "lo") setLo(v);
    else setHi(v);
    const base = getLatestDoc();
    const next = setScaleEndLabels(
      base,
      node.id,
      which === "lo" ? v : undefined,
      which === "hi" ? v : undefined,
    );
    if (next !== base) commit(next);
  };

  let settings = null;
  if (data.question_type === "multi_select") {
    settings = (
      <div className="qz-lg-tpset">
        <div className="qz-lg-tprow">
          <span className="qz-lg-tplb">{TYPE_COPY.min}</span>
          <Stepper value={bounds.min} min={1} max={bounds.max} label={TYPE_COPY.minLabel} onChange={setMin} />
        </div>
        <div className="qz-lg-tprow">
          <span className="qz-lg-tplb">{TYPE_COPY.max}</span>
          <Stepper value={bounds.max} min={bounds.min} max={count} label={TYPE_COPY.maxLabel} onChange={setMax} />
        </div>
      </div>
    );
  } else if (data.question_type === "rating") {
    settings = (
      <div className="qz-lg-tpset">
        <div className="qz-lg-tprow">
          <span className="qz-lg-tplb">{TYPE_COPY.points}</span>
          <Stepper
            value={count}
            min={SCALE_MIN_POINTS}
            max={SCALE_MAX_POINTS}
            label={TYPE_COPY.pointsLabel}
            onChange={setPoints}
            decreaseTip={
              count > SCALE_MIN_POINTS
                ? TYPE_COPY.removePointTip(count, lastIsPoint || !last ? null : last.text, lastMapped)
                : undefined
            }
          />
        </div>
        <input
          className="qz-lg-tplab"
          value={lo}
          placeholder={TYPE_COPY.lowPlaceholder}
          aria-label={TYPE_COPY.lowLabel}
          maxLength={40}
          onChange={(e) => writeLabel("lo", e.target.value)}
        />
        <input
          className="qz-lg-tplab"
          value={hi}
          placeholder={TYPE_COPY.highPlaceholder(count)}
          aria-label={TYPE_COPY.highLabel}
          maxLength={40}
          onChange={(e) => writeLabel("hi", e.target.value)}
        />
        <div className="qz-lg-tpnote">{TYPE_COPY.note(count)}</div>
      </div>
    );
  }

  return (
    <QzPopover
      open={open}
      onOpenChange={setOpen}
      width={240}
      maxWidth={240}
      align="start"
      manageFocus
      closeOnAnchorHidden
      ariaLabel={TYPE_COPY.title}
      className="qz-lg-pop"
      offset={6}
      trigger={
        <button type="button" className="qz-lg-qtype" title={TYPE_COPY.tip} data-pane-control="type">
          {line}
          <span className="qz-lg-cv" aria-hidden>
            ▾
          </span>
        </button>
      }
      content={
        <div data-testid="type-popover">
          <div className="qz-lg-pt" id={labId}>
            {TYPE_COPY.title}
          </div>
          <div role="radiogroup" aria-labelledby={labId}>
            {options.map((o) => {
              const on = o.pick === cur;
              const tooMany =
                !on && (o.pick === "rating" || o.pick === "rating5") && count > SCALE_MAX_POINTS;
              return (
                <button
                  key={o.pick}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  tabIndex={on ? 0 : -1}
                  disabled={tooMany}
                  title={tooMany ? TYPE_COPY.scaleCap : undefined}
                  className={`qz-lg-mi qz-lg-tpt${on ? " is-on" : ""}`}
                  onClick={() => pick(o.pick)}
                >
                  <span className="qz-lg-rd" aria-hidden />
                  <span className="qz-lg-mi-n">{o.label}</span>
                  {tooMany ? <span className="qz-lg-mi-h">{TYPE_COPY.scaleCap}</span> : null}
                </button>
              );
            })}
          </div>
          {settings}
        </div>
      }
    />
  );
}
