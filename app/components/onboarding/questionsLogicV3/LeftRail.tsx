import { useRef, useState } from "react";
import type { DragEvent, MouseEvent, ReactNode } from "react";
import type { OrderedFlowStep } from "../../../lib/questionOrder";
import { EditableText } from "./content/EditableText";
import { TYPE_CHIP_LABEL } from "./content/TypeChipSelector";
import { IconGrip, IconMail, IconTarget, IconTrash } from "./icons";
import type { RegenApi } from "./Step3Shell";

/** questions-full-page §3 — the mock's cMeta vocabulary for content steps.
    QRTZ-OA: the ◆ prefix is dropped (GAPS §A.1 — the glyph is retired);
    downstream `.replace("◆ ", "")` strippers become harmless no-ops. */
export const CONTENT_META: Record<string, string> = {
  message: "Message",
  product_cards: "Product cards",
  ask_ai: "Ask AI",
  integration: "Integration",
};

/* questions-full-page.html — the Questions tab's NAV RAIL (mock .navcol):
   header "Flow · N questions · N extra steps", one compact row per question
   (mono number — CLICK TO RENUMBER via an inline number input ·
   2-line-clamped editable wording · mono uppercase type line · hover tools:
   ⠿ drag / trash — QRTZ-S5 retired the stacked ↑/↓ per the mock; the grip
   is the one reorder affordance and carries arrow-key reorder for keyboard
   users), "+ Add question" foot, then the quiet termini rows (✉ Email
   capture · ◎ Result reveal). Answers are edited ON THE PHONE now (mock
   model: the rail is structure, the phone is content) — the AUDIT-22 inline
   answer expansion is retired.

   Functionality-preserving deviations (each keeps an existing capability,
   housed in the nearest affordance):
   — rows are draggable only while the pointer is DOWN on the ⠿ grip (the
     mock's always-draggable rows would fight inline text editing);
   — the per-question AI regenerate / undo / error bracket renders as a slim
     strip under the ACTIVE row (the mock has no regenerate);
   — the termini stay clickable (they are real phone-canvas positions here);
     the ✉ row ALWAYS renders (QRTZ-G3 — it is the capture CONFIG surface
     now, so it must stay reachable while capture is off to switch it back
     on; its sub-label reads "Off" then) and hosts the relocated capture
     config panel while selected;
   — the decider row keeps its accent number + disabled delete (deleting the
     deciding question would orphan every mapping — move the role first). */

/** Canvas position sentinels for the two termini (not real node ids). */
export const CAPTURE_ID = "__capture__";
export const REVEAL_ID = "__reveal__";

const TEXT_MAX = 150; // the shared question-text cap

/** questions-artifact — types whose answers are real CHOICES, where the
    "N answers" meta line is honest. Input/scale types (rating carries its
    scale points as answers) keep their type label instead. */
const ANSWER_META_TYPES = new Set([
  "single_select",
  "multi_select",
  "image_tile",
  "searchable",
  "image_picker",
  "dropdown",
  "swatch",
]);

export function LeftRail({
  steps,
  deciderId,
  activeId,
  captureOn,
  regen,
  onSelect,
  onRename,
  onReorder,
  onDelete,
  onAdd,
  onAddContent,
  onOpenLibrary,
  capturePanel,
}: {
  /** §2 — the FULL flow, content steps included, numbered 1..N. */
  steps: OrderedFlowStep[];
  deciderId: string | null;
  activeId: string;
  /** Whether the capture step is switched on — drives the row's sub-label. */
  captureOn: boolean;
  /** The stage's per-question AI-regenerate bracket (active-row strip). */
  regen: RegenApi;
  onSelect: (id: string) => void;
  /** Mock inline wording edit (contenteditable ncq); message titles too. */
  onRename: (id: string, text: string) => void;
  /** Mock reorder — drag, the grip's arrow keys, and the number's renumber
   *  input all land here: move the step to the 0-based position in the FULL
   *  flow. */
  onReorder: (id: string, toIndex: number) => void;
  /** Mock hover-trash delete (shell confirms + deletes via deleteNode). */
  onDelete: (id: string) => void;
  /** Mock .navadd — insert a question at the end of the flow. */
  onAdd: () => void;
  /** §3 — insert a content page (message step) at the end of the flow. */
  onAddContent: () => void;
  /** questions-artifact (2026-08-18) — the Question library moved from the
   *  retired sub-head into the rail's sticky foot (mock .fq-foot). */
  onOpenLibrary: () => void;
  /** QRTZ-G3 — the capture config (the relocated CaptureModule), rendered
   *  under the Email-capture row while that row is the selection. */
  capturePanel?: ReactNode;
}) {
  // Whole-question drag-to-reorder (mock dnd on #navbody) — armed on the grip.
  const [armed, setArmed] = useState<string | null>(null);
  const from = useRef<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  const endDrag = () => {
    from.current = null;
    setArmed(null);
    setDropIdx(null);
  };

  // §2 — click the number → inline <input type=number> → renumber (move to
  // that overall position). Enter commits, Escape cancels, blur commits.
  const [renumbering, setRenumbering] = useState<string | null>(null);
  const commitRenumber = (id: string, raw: string, ok: boolean) => {
    setRenumbering(null);
    if (!ok) return;
    const v = parseInt(raw, 10);
    if (!Number.isNaN(v)) onReorder(id, v - 1);
  };

  const onCellMouseDown = (e: MouseEvent<HTMLDivElement>, id: string) => {
    const t = e.target as HTMLElement;
    if (!e.currentTarget.contains(t)) return;
    // Edits/tools/renumber work without switching the selection first.
    if (t.closest(".qz-qf-ncq, .qz-qf-tools, .qz-qf-ncn, .qz-qf-regenrow")) return;
    if (activeId !== id) onSelect(id);
  };

  return (
    <div className="qz-qf-navcol">
      {/* questions-artifact — the "Flow · N questions" head is retired: with
          the ✎/▦ toggle gone the list starts at the top of the card. */}
      <div className="qz-qf-navbody" aria-label="Quiz flow">
        {steps.map((s, i) => {
          const q = s;
          const isContent = s.kind === "content";
          const isDecider = q.node.id === deciderId;
          const active = activeId === q.node.id;
          const canDelete = isContent || (steps.filter((x) => x.kind === "question").length > 1 && !isDecider);
          // questions-artifact — the row meta is "N answers" (the type/role
          // description left the rail; the decider is marked on the number).
          // Only choice types count answers; input/scale types keep their
          // type label (rating carries its scale points as answers).
          const questionType = isContent
            ? ""
            : (q.node as { data: { question_type: string } }).data.question_type;
          const answerCount = isContent
            ? 0
            : ((q.node.data as { answers?: unknown[] }).answers ?? []).length;
          const typeLabel = isContent
            ? CONTENT_META[q.node.type] ?? q.node.type
            : ANSWER_META_TYPES.has(questionType) && answerCount > 0
              ? `${answerCount} answer${answerCount === 1 ? "" : "s"}`
              : TYPE_CHIP_LABEL[questionType] ?? "";
          const title = isContent
            ? q.node.type === "message"
              ? ((q.node.data as { text?: string }).text ?? "Message")
              : CONTENT_META[q.node.type] ?? q.node.type
            : (q.node.data as { text: string }).text;
          const regenHere =
            !isContent &&
            (regen.regeneratingId === q.node.id ||
              regen.undoNodeId === q.node.id ||
              regen.regenError?.nodeId === q.node.id);
          return (
            <div
              key={q.node.id}
              className={`qz-qf-navrow${active ? " is-on" : ""}${isDecider ? " is-dec" : ""}${isContent ? " is-content" : ""}${dropIdx === i ? " is-drophi" : ""}`}
              draggable={armed === q.node.id}
              onDragStart={(e: DragEvent<HTMLDivElement>) => {
                from.current = i;
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={endDrag}
              onDragOver={(e: DragEvent<HTMLDivElement>) => {
                if (from.current === null) return;
                e.preventDefault();
                setDropIdx(i);
              }}
              onDragLeave={() => setDropIdx((d) => (d === i ? null : d))}
              onDrop={(e: DragEvent<HTMLDivElement>) => {
                e.preventDefault();
                const f = from.current;
                if (f !== null && f !== i) {
                  const moving = steps[f];
                  if (moving) onReorder(moving.node.id, i);
                }
                endDrag();
              }}
            >
              <div
                className="qz-qf-cell"
                role="button"
                tabIndex={0}
                title={title}
                onMouseDown={(e) => onCellMouseDown(e, q.node.id)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key !== "Enter" && e.key !== " ") return;
                  e.preventDefault();
                  onSelect(q.node.id);
                }}
              >
                {/* §2 — content shows its number in the muted style and is
                    identified by the content meta line, not by a missing
                    number; only question numbers are click-to-renumber. */}
                {isContent ? (
                  <span className="qz-qf-ncn is-c">{i + 1}</span>
                ) : renumbering === q.node.id ? (
                  <span className="qz-qf-ncn">
                    <input
                      className="qz-qf-ncninput"
                      type="number"
                      min={1}
                      defaultValue={i + 1}
                      autoFocus
                      aria-label={`Move step ${i + 1} to position`}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitRenumber(q.node.id, (e.target as HTMLInputElement).value, true);
                        } else if (e.key === "Escape") {
                          commitRenumber(q.node.id, "", false);
                        }
                      }}
                      onBlur={(e) => commitRenumber(q.node.id, e.target.value, true)}
                    />
                  </span>
                ) : (
                  <button
                    type="button"
                    className="qz-qf-ncn is-edit"
                    title="Click to renumber — moves this step to that spot"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenumbering(q.node.id);
                    }}
                  >
                    {i + 1}
                  </button>
                )}
                <span className="qz-qf-ncmid">
                  <span
                    className="qz-qf-ncqwrap"
                    onFocus={() => {
                      if (!active) onSelect(q.node.id);
                    }}
                  >
                    {isContent && q.node.type !== "message" ? (
                      <span className="qz-qf-ncq is-ro">{title}</span>
                    ) : (
                      <EditableText
                        value={title}
                        onCommit={(text) => onRename(q.node.id, text)}
                        maxLength={TEXT_MAX}
                        ariaLabel={`Step ${i + 1} wording`}
                        className="qz-qf-ncq"
                      />
                    )}
                  </span>
                  <span className="qz-qf-nct">{typeLabel}</span>
                </span>
                <span className="qz-qf-tools">
                  {/* QRTZ-S5 — the grip is the ONE reorder affordance (the
                      mock retires the stacked ↑/↓). Keyboard: the grip is
                      focusable (hover/focus reveals the tools) and ArrowUp/
                      ArrowDown move the step; focus is restored after React
                      re-inserts the moved row. */}
                  <button
                    type="button"
                    className="qz-qf-tool is-drag"
                    data-grip-for={q.node.id}
                    title="Drag to reorder — or focus and use the arrow keys"
                    aria-label={`Reorder step ${i + 1} of ${steps.length} — use the arrow keys to move it`}
                    onPointerDown={() => setArmed(q.node.id)}
                    onPointerUp={() => setArmed(null)}
                    onKeyDown={(e) => {
                      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
                      e.preventDefault();
                      e.stopPropagation();
                      const to = e.key === "ArrowUp" ? i - 1 : i + 1;
                      if (to < 0 || to > steps.length - 1) return;
                      onReorder(q.node.id, to);
                      const id = q.node.id;
                      requestAnimationFrame(() => {
                        document
                          .querySelector<HTMLButtonElement>(`[data-grip-for="${CSS.escape(id)}"]`)
                          ?.focus();
                      });
                    }}
                  >
                    <IconGrip />
                  </button>
                  <button
                    type="button"
                    className="qz-qf-tool"
                    disabled={!canDelete}
                    aria-label={isContent ? "Delete content page" : "Delete question"}
                    title={
                      canDelete
                        ? isContent
                          ? "Delete this content page"
                          : "Delete this question"
                        : isDecider
                          ? "This question decides the result — make another question the decider first"
                          : "A quiz needs at least one question"
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(q.node.id);
                    }}
                  >
                    <IconTrash />
                  </button>
                </span>
              </div>
              {active && regenHere ? (
                <div className="qz-qf-regenrow">
                  {regen.regeneratingId === q.node.id ? (
                    <span className="qz-qf-regenbusy">
                      <span className="qz-ql-spin" aria-hidden /> Regenerating…
                    </span>
                  ) : null}
                  {regen.undoNodeId === q.node.id ? (
                    <button
                      type="button"
                      className="qz-qs-regenundo"
                      onClick={regen.onUndoRegenerate}
                      title="Undo the regeneration"
                    >
                      ↺ Undo
                    </button>
                  ) : null}
                  {regen.regenError?.nodeId === q.node.id ? (
                    <span className="qz-qs-regenerr" role="alert">
                      {regen.regenError.message}{" "}
                      <button
                        type="button"
                        className="qz-qs-regenretry"
                        onClick={() => regen.onRegenerate(q.node.id)}
                      >
                        Retry
                      </button>
                      <button
                        type="button"
                        className="qz-qs-regendismiss"
                        onClick={regen.onDismissRegenError}
                        aria-label="Dismiss"
                      >
                        ✕
                      </button>
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {/* QRTZ-G3 — the row always renders: it is the capture CONFIG surface
          (the relocated CaptureModule opens beneath it while selected). */}
      <button
        type="button"
        className={`qz-qf-navterm${activeId === CAPTURE_ID ? " is-on" : ""}${captureOn ? "" : " is-off"}`}
        title={
          captureOn
            ? "Email capture — edit its heading, description, SMS and terms on the phone; settings below"
            : "Email capture is off — open to switch it back on"
        }
        onClick={() => onSelect(CAPTURE_ID)}
      >
        <span className="qz-qf-tc" aria-hidden>
          <IconMail />
        </span>
        <span className="qz-qf-tlabel">Email capture</span>
        {/* questions-artifact — the termini are quiet icon+label rows; only
            the functional Off state keeps a sub-label. */}
        {captureOn ? null : <span className="qz-qf-ts">Off</span>}
      </button>
      {capturePanel ? <div className="qz-qf-cappanel">{capturePanel}</div> : null}
      <button
        type="button"
        className={`qz-qf-navterm${activeId === REVEAL_ID ? " is-on" : ""}`}
        title="Configured in Step 4 · Results"
        onClick={() => onSelect(REVEAL_ID)}
      >
        <span className="qz-qf-tc" aria-hidden>
          <IconTarget />
        </span>
        <span className="qz-qf-tlabel">Result reveal</span>
      </button>
      {/* questions-artifact (mock .fq-foot) — the sticky foot carries both
          inserts plus the relocated Question library (right, muted). */}
      <div className="qz-qf-navaddrow">
        <button type="button" className="qz-qf-navadd" onClick={onAdd}>
          + Add question
        </button>
        <button type="button" className="qz-qf-navadd is-content" onClick={onAddContent}>
          + Add content
        </button>
        <button type="button" className="qz-qf-navadd is-library" onClick={onOpenLibrary}>
          Question library
        </button>
      </div>
    </div>
  );
}
