import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { Quiz } from "../../../lib/quizSchema";
import type { BuilderCategory, BuilderCollection } from "../../builder/stepProps";
import type { IndexedProduct } from "../../../lib/recommendationEngine";
import type { OrderedQuestion } from "../../../lib/questionOrder";
import {
  deadRules,
  halfBuiltRules,
  overbroadRules,
  shadowedRules,
} from "../../../lib/pathAnalyzer";
import {
  duplicateDecisionRule,
  moveDecisionRule,
  removeDecisionRule,
} from "../../../lib/quizMutations";
import { ruleTargets } from "../../../lib/recommendDecider";
import { buildAttributeReadout } from "../../../lib/attributeClustering";
import { useQzToast } from "../../qz-toast";
import { CreateRuleModal, type CreateRuleFlow } from "./CreateRuleModal";
import { LogicQuestionWidget } from "./LogicQuestionWidget";
import { PasteRulesModal } from "./PasteRulesModal";
import { AddQuestionModal } from "./AddQuestionModal";
import { QuestionWindow } from "./QuestionWindow";
import { ExplainerSheet, type ExplainerKind } from "./Explainers";
import { narrowFieldOptions } from "./logicTabFields";
import { RulesSetupScaffold } from "./RulesSetupScaffold";
import { CoverageSidebar } from "./CoverageSidebar";

// ════════════════════════════════════════════════════════════════════════════
// Logic tab — the Live artifact's workspace (mock-live screenWorkspace, owner
// order): a questions RAIL beside ONE detail panel, with the rules LEDGER
// (.rzone) above it in Rules-only style and below it in Attributes + Rules —
// "reading order follows resolution order in both". Replaces the QRTZ-G3/H3
// two-stacked-cards + five-column table era.
//
// The wrapper keeps the historical `data-testid="logic-tab-card"` so
// health/publish deep links and probes (`[data-testid="logic-tab-card"]
// [data-node-id]`) resolve unchanged — every rail row AND the open detail
// panel carry data-node-id.
//
// KEPT AGAINST THE MOCK (owner-resolved surfaces the Live drops):
//   - the fifth "Then go to" column — the skip-logic routing surface
//     (RouteMenuButton, forward-only) survives on every answer row;
//   - the rule flag line, drag-reorder + a11y ↑/↓, Edit ✎ / Duplicate ⧉,
//     the fresh-rule highlight and the won't-work banner — restyled into
//     the rzone rather than dropped.
// Decider docs only — legacy docs never reach this component
// (BuilderLogicView dispatch).
// ════════════════════════════════════════════════════════════════════════════

type QuizDoc = Quiz;

// Vocabulary — logic-step handoff §4: Show = action "show" · Pin = action
// "prioritize" · Hide = action "hide". Absent action = the legacy REPLACE
// rule: parsed forever, never written by new UI — it reads as "show".
function ruleVerb(action: "show" | "hide" | "prioritize" | undefined): string {
  if (!action) return "show"; // legacy replace — reads as show
  if (action === "prioritize") return "pin";
  return action;
}


// §3.3 — a target that is not a product gets a trailing muted kind.
function targetKind(cat: BuilderCategory | undefined): string | null {
  if (!cat) return null;
  if (cat.source === "collection") return "collection";
  if (cat.source === "tag") return "tag";
  if (cat.source === "metafield") return "metafield";
  return null;
}



export function LogicTabCard({
  doc,
  questions,
  categories,
  collections,
  productIndex,
  commit,
  quizId,
  lastSyncAt,
  shopifyAdminDomain,
  logicStyle,
  ruleFlow,
}: {
  doc: QuizDoc;
  questions: OrderedQuestion[];
  categories: BuilderCategory[];
  collections: BuilderCollection[];
  productIndex: IndexedProduct[];
  /** P3+ — the editing seam. Absent = read-only (previews, tests). */
  commit?: (doc: QuizDoc) => void;
  /** P5 — enables + Add rule (the ensure-targets endpoint needs it). */
  quizId?: string;
  /** QRTZ-B2 — Shop.lastSyncAt (ISO) for the products popover's sync line. */
  lastSyncAt?: string | null;
  /** QRTZ-B2 — the Shopify ADMIN domain for the popover's Open-in-Shopify
   *  link (null on an unconnected standalone workspace → no link). */
  shopifyAdminDomain?: string | null;
  /** Live B/K — which workspace variant: "rules" leads with the ledger and
   *  retires the role column; null/undefined behaves as "attributes". */
  logicStyle?: "rules" | "attributes" | null;
  /** Create-rule handoff — which products band the rule modal renders.
   *  The funnel passes "onboarding"; the standalone Logic tab passes
   *  nothing (builder). Changes the band only. */
  ruleFlow?: CreateRuleFlow;
}) {
  const toast = useQzToast();
  const rulesOnly = logicStyle === "rules";
  // P5 — categories materialized by the create-rule modal, merged until the
  // route loader's next pass returns them (autosave revalidation).
  const [extraCats, setExtraCats] = useState<BuilderCategory[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  // Logic-step §12 — Edit opens the SAME builder pre-filled against the
  // existing rule id (same modal, same storage, no second code path).
  const [editRuleId, setEditRuleId] = useState<string | null>(null);
  // Logic-step §6 — "+ Paste rules" beside "+ Add rule" (its own entry point).
  const [pasteOpen, setPasteOpen] = useState(false);
  // Live C — the rail's "+ Add question" foot opens the three-band modal.
  const [addOpen, setAddOpen] = useState(false);
  // UNIFIED one-window — the question window: ONE window element, two
  // contents (unified/_v.js render): opening one closes the other.
  const [qwin, setQwin] = useState<{ nodeId: string; answerId: string | null } | null>(null);
  // Latest-doc seam for the modal's post-await commit (review L2-5).
  const docRef = useRef(doc);
  docRef.current = doc;
  // §7 — the stepped explainer sheets; null = closed.
  const [explainer, setExplainer] = useState<ExplainerKind | null>(null);
  // Live B — the rail's selection (client state only; default = first).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    questions.find((q) => q.node.id === selectedId) ?? questions[0] ?? null;
  const allCategories = useMemo(() => {
    const seen = new Set(categories.map((c) => c.id));
    return [...categories, ...extraCats.filter((c) => !seen.has(c.id))];
  }, [categories, extraCats]);
  const catById = useMemo(
    () => new Map(allCategories.map((c) => [c.id, c])),
    [allCategories],
  );
  const colTitleById = useMemo(
    () => new Map(collections.map((c) => [c.collectionId, c.title])),
    [collections],
  );
  const qIndexByNodeId = useMemo(
    () => new Map(questions.map((q) => [q.node.id, q.qIndex])),
    [questions],
  );
  const rules = useMemo(() => doc.decision_rules ?? [], [doc.decision_rules]);
  // Live I — the §10 attribute read-out, memoized ONCE for the whole
  // workspace (rail statuses, value pickers, footer unions all read it).
  const readout = useMemo(() => buildAttributeReadout(productIndex), [productIndex]);
  // Info rows — which rules READ each answer (conditions referencing a.id),
  // 1-based rule index preserved for the λN chip.
  const rulesByAnswer = useMemo(() => {
    const m = new Map<string, Array<{ index: number; rule: (typeof rules)[number] }>>();
    rules.forEach((rule, i) => {
      const seen = new Set<string>();
      for (const c of rule.conditions) {
        if (seen.has(c.answer_id)) continue;
        seen.add(c.answer_id);
        const arr = m.get(c.answer_id) ?? [];
        arr.push({ index: i + 1, rule });
        m.set(c.answer_id, arr);
      }
    });
    return m;
  }, [rules]);
  // §3.3 — a freshly created rule gets a brief highlight for 1800 ms.
  const [freshRuleId, setFreshRuleId] = useState<string | null>(null);
  const knownRuleIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = new Set(rules.map((r) => r.id));
    const prev = knownRuleIds.current;
    knownRuleIds.current = ids;
    if (!prev) return;
    const added = rules.find((r) => !prev.has(r.id));
    if (!added) return;
    setFreshRuleId(added.id);
    const t = setTimeout(() => setFreshRuleId(null), 1800);
    return () => clearTimeout(t);
  }, [rules]);
  // §3.2 — "switched on" = role is not Asked only (Picks-the-result counts).
  const switchedOn = questions.filter(
    (q) => q.node.data.role === "decides" || q.node.data.role === "filter",
  ).length;
  // QRTZ-H5 — one inventory sweep for the whole workspace (the role control
  // only needs the boolean) + the decider's question number for the role menu.
  const hasNarrowFields = useMemo(
    () => narrowFieldOptions(productIndex).length > 0,
    [productIndex],
  );
  const deciderQIndex =
    questions.find((q) => q.node.data.role === "decides")?.qIndex ?? null;
  // QRTZ-S6 — rule drag-reorder (dragId + hover index, drop-line class). The
  // ↑/↓ buttons stay as the keyboard/a11y path; both end in moveDecisionRule.
  const [dragRuleId, setDragRuleId] = useState<string | null>(null);
  const [overRuleIx, setOverRuleIx] = useState<number | null>(null);
  // Logic-step §11/mock 09 — per-rule flags (checked top down, first match
  // wins): shadowing, dead conditions, half-built rules (all "never fires"),
  // a DELETED target (publish-blocking) and the overbroad shape. Same
  // analyzers the Tier-1 report runs, memoized per doc.
  const ruleFlags = useMemo(() => {
    const flags = new Map<string, { chip: string; message: string }>();
    const put = (ruleId: string, chip: string, message: string) => {
      if (!flags.has(ruleId)) flags.set(ruleId, { chip, message });
    };
    for (const f of halfBuiltRules(doc)) put(f.ruleId, "never fires", f.message);
    for (const f of deadRules(doc)) put(f.ruleId, "never fires", f.message);
    for (const f of shadowedRules(doc)) put(f.ruleId, "never fires", f.message);
    for (const r of doc.decision_rules ?? []) {
      if (ruleTargets(r).some((tid) => !catById.has(tid))) {
        put(
          r.id,
          "target deleted",
          "A result this rule points at was deleted — fix the target before publishing (publish is blocked).",
        );
      }
    }
    for (const f of overbroadRules(doc)) put(f.ruleId, "fires for everyone", f.message);
    return flags;
  }, [doc, catById]);
  const neverFireCount = rules.filter((r) => ruleFlags.has(r.id)).length;

  // ── the ledger (Live rulesLedger — the .rzone card) ────────────────────────
  const ledger = (
    <section className="qz-lw-rzone">
      <header className="qz-lw-rhead">
        <h4>Rules</h4>
        <span className="qz-lw-rsub">
          {rulesOnly
            ? "This quiz decides everything through rules — no attributes involved"
            : "Exceptions that run on top of the mapping above"}
        </span>
        <span className="qz-lw-rright">
          <button
            type="button"
            className="qz-ltab-how"
            onClick={() => setExplainer("rules")}
          >
            <span className="qz-ltab-how-ico" aria-hidden>
              ✦
            </span>
            How rules work
          </button>
          {commit && quizId ? (
            <>
              {/* Logic-step §6 — paste is its own entry point, beside Add
                  rule, never a tab inside the modal. */}
              <button
                type="button"
                className="qz-btn qz-btn-sm qz-ltab-paste"
                onClick={() => {
                  setQwin(null);
                  setCreateOpen(false);
                  setPasteOpen(true);
                }}
              >
                + Paste rules
              </button>
              <button
                type="button"
                className="qz-btn qz-btn-primary qz-btn-sm qz-ltab-create"
                onClick={() => {
                  setQwin(null);
                  setEditRuleId(null);
                  setCreateOpen(true);
                }}
              >
                + Add rule
              </button>
            </>
          ) : null}
        </span>
      </header>
      {/* Mock module 09 — the banner counting flagged rules, directly under
          the rhead. */}
      {neverFireCount > 0 ? (
        <p className="qz-ltab-rulebanner" role="status">
          {neverFireCount === 1
            ? "1 rule below won't work as written"
            : `${neverFireCount} rules below won't work as written`}{" "}
          — each one says why on its row.
        </p>
      ) : null}
      {rules.length === 0 ? (
        rulesOnly && commit && quizId ? (
          /* Module 12 — the Rules-only setup scaffold replaces the empty
             state (rules-only, editable surfaces only). */
          <RulesSetupScaffold
            questions={questions}
            categories={allCategories}
            commit={commit}
            getLatestDoc={() => docRef.current}
            onWriteByHand={() => {
              setQwin(null);
              setEditRuleId(null);
              setCreateOpen(true);
            }}
          />
        ) : (
        <p className="qz-ltab-empty">
          <span className="qz-ltab-muted">—</span>{" "}
          {switchedOn === 0 ? (
            <>
              No rules yet. And no question is switched on — so every shopper
              sees the same products.
            </>
          ) : (
            <>
              No rules yet. Your <b>{switchedOn}</b> switched-on{" "}
              {switchedOn === 1 ? "question is" : "questions are"} deciding
              everything.
            </>
          )}
        </p>
        )
      ) : (
        <ol className="qz-lw-rlist">
          {rules.map((rule, i) => (
            <li
              key={rule.id}
              className={`qz-lw-rcard${rule.id === freshRuleId ? " is-fresh" : ""}${
                dragRuleId === rule.id ? " is-dragging" : ""
              }${
                overRuleIx === i && dragRuleId && dragRuleId !== rule.id
                  ? " is-drop-target"
                  : ""
              }`}
              draggable={commit ? true : undefined}
              onDragStart={
                commit
                  ? (e) => {
                      setDragRuleId(rule.id);
                      e.dataTransfer.effectAllowed = "move";
                    }
                  : undefined
              }
              onDragOver={
                commit
                  ? (e) => {
                      if (!dragRuleId) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      if (overRuleIx !== i) setOverRuleIx(i);
                    }
                  : undefined
              }
              onDrop={
                commit
                  ? (e) => {
                      e.preventDefault();
                      if (dragRuleId && dragRuleId !== rule.id)
                        commit(moveDecisionRule(doc, dragRuleId, i));
                      setDragRuleId(null);
                      setOverRuleIx(null);
                    }
                  : undefined
              }
              onDragEnd={
                commit
                  ? () => {
                      setDragRuleId(null);
                      setOverRuleIx(null);
                    }
                  : undefined
              }
            >
              {/* Live .rn — λN as a warn-wash pill (rule identity, distinct
                  from the questions' Q numbers). Drag rides the row; the
                  number is the natural handle. */}
              <span
                className="qz-lw-rn"
                title={commit ? "Drag to reorder" : undefined}
              >
                λ{i + 1}
              </span>
              <span className="qz-lw-rline">
                <span className="qz-lw-rsent">
                  <RuleSentence
                    rule={rule}
                    questions={questions}
                    qIndexByNodeId={qIndexByNodeId}
                    catById={catById}
                  />
                </span>
                {/* §11 — "flags a rule that can never be reached" (+ the
                    deleted-target and overbroad flags). */}
                {ruleFlags.has(rule.id) ? (
                  <span className="qz-ltab-rflag">
                    <span className="qz-ltab-rflagchip">
                      {ruleFlags.get(rule.id)!.chip}
                    </span>{" "}
                    {ruleFlags.get(rule.id)!.message}
                  </span>
                ) : null}
              </span>
              {commit ? (
                <span className="qz-ltab-ractions">
                  {/* §3.3 — order IS priority; keyboard reorder (DECISIONS). */}
                  <button
                    type="button"
                    className="qz-ltab-rmove"
                    aria-label="Move rule up"
                    disabled={i === 0}
                    onClick={() => commit(moveDecisionRule(doc, rule.id, i - 1))}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="qz-ltab-rmove"
                    aria-label="Move rule down"
                    disabled={i === rules.length - 1}
                    onClick={() => commit(moveDecisionRule(doc, rule.id, i + 1))}
                  >
                    ↓
                  </button>
                  {/* Logic-step §12 — Edit opens the same builder pre-filled
                      (same modal, same storage, no second code path). */}
                  {quizId ? (
                    <button
                      type="button"
                      className="qz-ltab-ricon"
                      aria-label={`Edit rule ${i + 1}`}
                      title="Edit"
                      onClick={() => {
                        setQwin(null);
                        setEditRuleId(rule.id);
                        setCreateOpen(true);
                      }}
                    >
                      ✎
                    </button>
                  ) : null}
                  {/* §12 — Duplicate inserts the copy DIRECTLY BELOW (position
                      is priority), THEN opens it in the builder. */}
                  <button
                    type="button"
                    className="qz-ltab-ricon"
                    aria-label={`Duplicate rule ${i + 1}`}
                    title="Duplicate"
                    onClick={() => {
                      const before = new Set(rules.map((r) => r.id));
                      const next = duplicateDecisionRule(doc, rule.id);
                      const copy = (next.decision_rules ?? []).find(
                        (r) => !before.has(r.id),
                      );
                      commit(next);
                      toast("Rule duplicated — the copy sits directly below");
                      if (copy && quizId) {
                        setQwin(null);
                        setEditRuleId(copy.id);
                        setCreateOpen(true);
                      }
                    }}
                  >
                    ⧉
                  </button>
                  {/* Delete looks the rule up BY ID, never by row index. */}
                  <button
                    type="button"
                    className="qz-ltab-ricon"
                    aria-label={`Delete rule ${i + 1}`}
                    onClick={() => {
                      commit(removeDecisionRule(doc, rule.id));
                      toast("Rule deleted");
                    }}
                  >
                    ×
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );

  // ── the QUESTION widget (QWIDGET) — rail + ONE pane, its own file ────────
  const grid = (
    <LogicQuestionWidget
      doc={doc}
      questions={questions}
      categories={allCategories}
      colTitleById={colTitleById}
      productIndex={productIndex}
      readout={readout}
      qIndexByNodeId={qIndexByNodeId}
      commit={commit}
      rulesOnly={rulesOnly}
      deciderQIndex={deciderQIndex}
      hasNarrowFields={hasNarrowFields}
      lastSyncAt={lastSyncAt}
      shopifyAdminDomain={shopifyAdminDomain}
      rulesByAnswer={rulesByAnswer}
      selectedId={selected?.node.id ?? null}
      onSelect={setSelectedId}
      onAddQuestion={commit && quizId ? () => setAddOpen(true) : undefined}
      onExplain={() => setExplainer("questions")}
    />
  );

  return (
    // Live B/K — rules-only leads with the ledger; attributes leads with the
    // mapping ("reading order follows resolution order in both").
    <div className="qz-ltab-stack" data-testid="logic-tab-card">
      {rulesOnly ? (
        <>
          {/* Module 14 — the Coverage sidebar rides RIGHT of the ledger in a
              two-column row (single column under 900px); the questions grid
              keeps the full width below. Attributes style renders none of
              this. */}
          <div className="qz-lcov-row">
            {ledger}
            <CoverageSidebar questions={questions} rules={rules} />
          </div>
          {grid}
        </>
      ) : (
        <>
          {grid}
          {ledger}
        </>
      )}
      <ExplainerSheet
        kind={explainer ?? "rules"}
        open={explainer !== null}
        onClose={() => setExplainer(null)}
        onSwap={setExplainer}
      />
      {commit && quizId ? (
        <CreateRuleModal
          doc={doc}
          questions={questions}
          categories={allCategories}
          collections={collections}
          productIndex={productIndex}
          quizId={quizId}
          open={createOpen}
          editRule={
            editRuleId ? rules.find((r) => r.id === editRuleId) ?? null : null
          }
          flow={ruleFlow}
          onClose={() => {
            setCreateOpen(false);
            setEditRuleId(null);
          }}
          commit={commit}
          onCategoriesCreated={(cats) => setExtraCats((prev) => [...prev, ...cats])}
          getLatestDoc={() => docRef.current}
        />
      ) : null}
      {commit && quizId && pasteOpen ? (
        <PasteRulesModal
          questions={questions}
          categories={allCategories}
          productIndex={productIndex}
          onClose={() => setPasteOpen(false)}
          commit={commit}
          getLatestDoc={() => docRef.current}
        />
      ) : null}
      {commit && quizId && addOpen ? (
        <AddQuestionModal
          doc={doc}
          questions={questions}
          onClose={() => setAddOpen(false)}
          commit={commit}
        />
      ) : null}
      {commit && qwin
        ? (() => {
            const wq = questions.find((x) => x.node.id === qwin.nodeId);
            return wq ? (
              <QuestionWindow
                key={`${qwin.nodeId}:${qwin.answerId ?? ""}`}
                doc={doc}
                q={wq}
                questions={questions}
                categories={allCategories}
                collections={collections}
                productIndex={productIndex}
                initialAnswerId={qwin.answerId}
                onClose={() => setQwin(null)}
                commit={commit}
              />
            ) : null;
          })()
        : null}
    </div>
  );
}

// Logic-step mock module 09 sentence grammar — "When" (Live rulesLedger's
// lead-in) · condition chips ([Qn] answer) · join words mirroring the rule's
// OWN operators · the → arrow · the coloured verb (show / pin / hide, §4) ·
// the targets as Live .tchip chips · one trailing muted kind. is_not renders
// as a "not" prefix inside the chip.
function RuleSentence({
  rule,
  questions,
  qIndexByNodeId,
  catById,
}: {
  rule: NonNullable<QuizDoc["decision_rules"]>[number];
  questions: OrderedQuestion[];
  qIndexByNodeId: Map<string, number>;
  catById: Map<string, BuilderCategory>;
}) {
  const answerLabel = (questionId: string, answerId: string) => {
    const q = questions.find((x) => x.node.id === questionId);
    const a = q?.node.data.answers.find((x) => x.id === answerId);
    return a?.text ?? null;
  };
  const targets = ruleTargets(rule);
  const verb = ruleVerb(rule.action);
  // ONE trailing kind, only when every target agrees on it.
  const kinds = targets.map((tid) => targetKind(catById.get(tid)));
  const kind =
    kinds.length > 0 && kinds[0] !== null && kinds.every((k) => k === kinds[0])
      ? kinds[0]
      : null;
  // Group conditions by question (first-appearance order) so the join words
  // can mirror the engine's grouped semantics.
  const groups: { questionId: string; conds: typeof rule.conditions }[] = [];
  for (const c of rule.conditions) {
    const g = groups.find((x) => x.questionId === c.question_id);
    if (g) g.conds.push(c);
    else groups.push({ questionId: c.question_id, conds: [c] });
  }
  const anyOf = new Set(rule.any_of ?? []);
  const acrossOp = rule.match === "any" ? "or" : "and";
  return (
    <>
      <span className="qz-ltab-rwhen">When</span>{" "}
      {groups.map((g, gi) => {
        const withinOp = anyOf.has(g.questionId) ? "or" : "and";
        const qn = qIndexByNodeId.get(g.questionId);
        return (
          <Fragment key={g.questionId}>
            {gi > 0 ? (
              <>
                {" "}
                <span className="qz-ltab-op">{acrossOp}</span>{" "}
              </>
            ) : null}
            {g.conds.map((c, i) => {
              const label = answerLabel(c.question_id, c.answer_id);
              return (
                <Fragment key={`${c.answer_id}:${i}`}>
                  {i > 0 ? (
                    <>
                      {" "}
                      <span className="qz-ltab-op">{withinOp}</span>{" "}
                    </>
                  ) : null}
                  <span className="qz-ltab-cchip">
                    {qn != null ? (
                      <span className="qz-ltab-qn" aria-hidden>
                        Q{qn}
                      </span>
                    ) : null}
                    {c.op === "is_not" ? <span className="qz-ltab-op">not</span> : null}
                    {label ? (
                      <b className="qz-ltab-ans">{label}</b>
                    ) : (
                      // Dangling reference (DECISIONS "additions") — flagged,
                      // never silently dropped.
                      <b className="qz-ltab-bad">(deleted answer)</b>
                    )}
                  </span>
                </Fragment>
              );
            })}
          </Fragment>
        );
      })}{" "}
      <span className="qz-ltab-arrow" aria-hidden>
        →
      </span>{" "}
      <span className={`qz-ltab-verb is-${verb}`}>{verb}</span>{" "}
      {targets.map((tid, i) => {
        const cat = catById.get(tid);
        return (
          <Fragment key={tid}>
            {i > 0 ? " " : ""}
            {cat ? (
              <span className="qz-lw-tchip">{cat.name}</span>
            ) : (
              <b className="qz-ltab-bad">(deleted target)</b>
            )}
          </Fragment>
        );
      })}
      {kind ? (
        <>
          {" "}
          <span className="qz-ltab-rkind">{kind}</span>
        </>
      ) : null}
    </>
  );
}
