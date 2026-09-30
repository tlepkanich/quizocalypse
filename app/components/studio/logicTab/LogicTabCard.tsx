import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Quiz } from "../../../lib/quizSchema";
import type { BuilderCategory, BuilderCollection } from "../../builder/stepProps";
import type { IndexedProduct } from "../../../lib/recommendationEngine";
import type { OrderedQuestion } from "../../../lib/questionOrder";
import type { LogicStyle } from "../../../lib/logicStyle";
import { appendBankQuestion } from "../../../lib/quizMutations";
import { ruleTargets } from "../../../lib/recommendDecider";
import { ruleStatuses } from "../../../lib/ruleStatus";
import { buildAttributeReadout } from "../../../lib/attributeClustering";
import { useQzToast } from "../../qz-toast";
import type { SaveOutcome, SaveToken } from "../saveTracker";
import { CreateRuleModal, type CreateRuleFlow } from "./CreateRuleModal";
import { LogicQuestionWidget } from "./LogicQuestionWidget";
import { PasteRulesModal } from "./PasteRulesModal";
import { AddQuestionDialog } from "../AddQuestionDialog";
import { QuestionWindow } from "./QuestionWindow";
import { narrowFieldOptions } from "./logicTabFields";
import { LogicHeader, type LogicView } from "./LogicHeader";
import { RulesList } from "./RulesList";
import { RecommendationsStrip } from "./RecommendationsStrip";
import { LogicTableView } from "./LogicTableView";
import { LogicImportExport } from "./LogicImportExport";
import { AddRecommendationsDialog, type LogicCatalog } from "./AddRecommendationsDialog";
import { useLogicUndo } from "./useLogicUndo";
import { QUESTION_COPY, RULE_COPY, RULES_ONLY_EMPTY, filterRulesEmpty } from "./logicCopy";

// ════════════════════════════════════════════════════════════════════════════
// Logic step redesign — the Logic workspace card, the ORCHESTRATOR (mock
// rules-row/index.html: statusHead, renderFilter, rulesBand, vizRecs;
// handoff "Screen shell", "Filter Results + Rules · Edit", "Rules only ·
// Edit"). Supersedes the August layout comment (ledger above/below the
// widget, D22/D23) and the "KEPT AGAINST THE MOCK" list (D11, D19).
//
//   header      LogicHeader: title switch · description · actions · Edit|Table
//   Filter Results + Rules, Edit (D22): 3 columns 262 / 1fr / 304 — the
//               question widget's rail + pane, then the RULES COLUMN
//               (RulesList "column", "+ Add", "Paste rules").
//   Rules only, Edit (D23): the rules band (RulesList "row", or the empty
//               state) over the "Your recommendations" strip.
//   Table (either style): LogicTableView (agent F), Import | Export in the
//               header's slot.
//
// Both styles are first-class; neither is a lens on the other.
// Every new feature sits behind a prop only the funnel passes (D6, builder
// parity parked): BuilderLogicView passes none of them, so the builder keeps
// the Filter layout (rules column included) with no header.
// The wrapper keeps data-testid="logic-tab-card"; rail rows and the pane keep
// data-node-id; rule rows carry data-rule-id (check-popover jumps, probes).
// Decider docs only — legacy docs never reach this component.
// ════════════════════════════════════════════════════════════════════════════

type QuizDoc = Quiz;

/** A host's request to show something (check popover rows, B38): the card
 *  switches to Edit first, then acts. Bump `nonce` to re-fire the same target. */
export type LogicFocusRequest = { nonce: number } & (
  | {
      kind: "question";
      id: string;
      /** Which control the question pane should focus (agent D wires the
       *  pane side; the card selects and scrolls the question). */
      control?: "role" | "route" | "picks" | "values" | "required";
      answerId?: string;
    }
  | { kind: "rule"; id: string; /** open the rule window (default true) */ open?: boolean }
  | { kind: "rules" }
  | { kind: "create" }
  | { kind: "recommendation"; id: string; questionId?: string }
  | { kind: "style" }
);

export type LogicTabCardProps = {
  doc: QuizDoc;
  questions: OrderedQuestion[];
  categories: BuilderCategory[];
  collections: BuilderCollection[];
  productIndex: IndexedProduct[];
  /** The editing seam. Absent = read-only (previews, tests). */
  commit?: (doc: QuizDoc) => void;
  /** Enables create / paste / add (the ensure-targets endpoint needs it). */
  quizId?: string;
  /** Shop.lastSyncAt (ISO) for the products popover's sync line. */
  lastSyncAt?: string | null;
  /** The Shopify ADMIN domain for the popover's Open-in-Shopify link. */
  shopifyAdminDomain?: string | null;
  /** Which band the rule window renders ("onboarding" in the funnel). */
  ruleFlow?: CreateRuleFlow;
  // ── Logic step redesign (all optional; the builder passes none, D6) ──
  /** The resolved SCREEN style (resolveLogicStyle). Absent = Filter layout. */
  style?: LogicStyle;
  /** The title switch. Absent = static title. The host commits
   *  setLogicStyle; the card lands on Edit when the style changed. */
  onStyleChange?: (style: LogicStyle) => void;
  /** Controlled view; absent = uncontrolled (starts on Edit). */
  view?: LogicView;
  onViewChange?: (view: LogicView) => void;
  /** Render the status header (title switch, Edit | Table, the Rules-only
   *  screen's actions). Funnel-only while D6 is parked. */
  showHeader?: boolean;
  /** Heading level for the title (the funnel step's only heading → "h1"). */
  headingLevel?: "h1" | "h2";
  /** Switch to Edit and select / open something (check popover, B38). */
  focusRequest?: LogicFocusRequest | null;
  /** The funnel loader's catalogue, passed through untouched to the Add
   *  recommendations window (agent E). */
  catalog?: LogicCatalog;
  /** useQuizDraft.commitTracked — a SaveToken per commit for the field
   *  save pill (D8). Threaded to the Table view (and, by agent D, the pane). */
  commitTracked?: (doc: QuizDoc) => SaveToken;
  /** useQuizDraft.flush — awaitable save (hosts that leave the view). */
  flush?: () => Promise<SaveOutcome>;
};

const FRESH_MS = 1800;

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
  ruleFlow,
  style: styleProp,
  onStyleChange,
  view: viewProp,
  onViewChange,
  showHeader = false,
  headingLevel,
  focusRequest,
  catalog,
  commitTracked,
}: LogicTabCardProps) {
  const toast = useQzToast();
  const style: LogicStyle = styleProp ?? "attributes";
  const rulesOnly = style === "rules";
  const editable = !!commit && !!quizId;

  // ── view (controlled with an uncontrolled fallback) ──────────────────────
  const [viewState, setViewState] = useState<LogicView>("edit");
  const view: LogicView = showHeader ? (viewProp ?? viewState) : "edit";
  const setView = useCallback(
    (next: LogicView) => {
      onViewChange?.(next);
      if (viewProp === undefined) setViewState(next);
    },
    [onViewChange, viewProp],
  );

  // Categories materialized this session (rule window / Add recommendations),
  // merged until the route loader's next pass returns them.
  const [extraCats, setExtraCats] = useState<BuilderCategory[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [editRuleId, setEditRuleId] = useState<string | null>(null);
  const [createTargets, setCreateTargets] = useState<string[] | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addRecsOpen, setAddRecsOpen] = useState(false);
  const [styleMenuOpen, setStyleMenuOpen] = useState(false);
  // The question window stays mounted but inert (no door opens it now).
  const [qwin, setQwin] = useState<{ nodeId: string; answerId: string | null } | null>(null);
  const docRef = useRef(doc);
  docRef.current = doc;
  const getLatestDoc = useCallback(() => docRef.current, []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = questions.find((q) => q.node.id === selectedId) ?? questions[0] ?? null;

  const allCategories = useMemo(() => {
    const seen = new Set(categories.map((c) => c.id));
    return [...categories, ...extraCats.filter((c) => !seen.has(c.id))];
  }, [categories, extraCats]);
  const catById = useMemo(() => new Map(allCategories.map((c) => [c.id, c])), [allCategories]);
  const colTitleById = useMemo(
    () => new Map(collections.map((c) => [c.collectionId, c.title])),
    [collections],
  );
  const qIndexByNodeId = useMemo(
    () => new Map(questions.map((q) => [q.node.id, q.qIndex])),
    [questions],
  );
  const rules = useMemo(() => doc.decision_rules ?? [], [doc.decision_rules]);
  // This quiz's recommendations — the same pool the tray and the rule
  // window use (quizId set), in the loader's order.
  const recommendations = useMemo(() => allCategories.filter((c) => c.quizId != null), [allCategories]);
  // THE per-rule status, once per doc (rows, strip, Table all read it).
  const statuses = useMemo(
    () => ruleStatuses(doc, allCategories.map((c) => c.id)),
    [doc, allCategories],
  );
  const readout = useMemo(() => buildAttributeReadout(productIndex), [productIndex]);
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
  const hasNarrowFields = useMemo(() => narrowFieldOptions(productIndex).length > 0, [productIndex]);
  const deciderQIndex = questions.find((q) => q.node.data.role === "decides")?.qIndex ?? null;

  // ONE Undo run for the whole view (rows, the rule window, the Table).
  const noopCommit = useCallback(() => {}, []);
  const undo = useLogicUndo<QuizDoc>({ getLatestDoc, commit: commit ?? noopCommit });

  // A freshly created rule (and a check-popover jump target) flashes briefly
  // with an accent OUTLINE — never the lit fill (handoff 2.1).
  const [flashIds, setFlashIds] = useState<ReadonlySet<string>>(new Set());
  const flashTimer = useRef<number | null>(null);
  const flash = useCallback((ids: string[]) => {
    setFlashIds(new Set(ids));
    if (flashTimer.current != null) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlashIds(new Set()), FRESH_MS);
  }, []);
  useEffect(
    () => () => {
      if (flashTimer.current != null) window.clearTimeout(flashTimer.current);
    },
    [],
  );
  const knownRuleIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = new Set(rules.map((r) => r.id));
    const prev = knownRuleIds.current;
    knownRuleIds.current = ids;
    if (!prev) return;
    const added = rules.filter((r) => !prev.has(r.id)).map((r) => r.id);
    if (added.length > 0 && added.length < rules.length) flash(added);
  }, [rules, flash]);

  // Pill lighting (B49): one lit recommendation → the rules that list it.
  const [litRec, setLitRec] = useState<string | null>(null);
  const litRuleIds = useMemo(() => {
    if (!litRec) return new Set<string>();
    return new Set(rules.filter((r) => ruleTargets(r).includes(litRec)).map((r) => r.id));
  }, [litRec, rules]);

  // ── doors ────────────────────────────────────────────────────────────────
  const openCreate = useCallback((targetIds?: string[]) => {
    setQwin(null);
    setEditRuleId(null);
    setCreateTargets(targetIds && targetIds.length ? targetIds : null);
    setCreateOpen(true);
  }, []);
  const openEdit = useCallback((ruleId: string) => {
    setQwin(null);
    setCreateTargets(null);
    setEditRuleId(ruleId);
    setCreateOpen(true);
  }, []);
  const openPaste = useCallback(() => {
    setQwin(null);
    setCreateOpen(false);
    setPasteOpen(true);
  }, []);

  const handleStyleChange = useCallback(
    (next: LogicStyle) => {
      const changed = next !== style;
      onStyleChange?.(next);
      setStyleMenuOpen(false);
      setLitRec(null);
      if (changed) setView("edit");
    },
    [onStyleChange, style, setView],
  );

  // ── focus requests (check popover rows, B38) ──────────────────────────────
  const cardRef = useRef<HTMLDivElement>(null);
  const pendingScroll = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    const run = pendingScroll.current;
    if (!run) return;
    pendingScroll.current = null;
    run();
  });
  // A request whose state is already current re-renders nothing, so the
  // queued scroll would never run: bump a counter to force one pass.
  const [, forceRender] = useReducer((x: number) => x + 1, 0);
  const lastNonce = useRef<number | null>(null);
  useEffect(() => {
    if (!focusRequest || focusRequest.nonce === lastNonce.current) return;
    lastNonce.current = focusRequest.nonce;
    setView("edit");
    const card = () => cardRef.current;
    const scrollTo = (sel: string, focusSel?: string) => {
      const el = card()?.querySelector<HTMLElement>(sel);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      (focusSel ? el.querySelector<HTMLElement>(focusSel) : el)?.focus({ preventScroll: true });
    };
    const req = focusRequest;
    switch (req.kind) {
      case "question":
        setSelectedId(req.id);
        pendingScroll.current = () =>
          scrollTo(`.qz-lw-rail [data-node-id="${CSS.escape(req.id)}"]`);
        break;
      case "rule":
        flash([req.id]);
        pendingScroll.current = () =>
          scrollTo(`[data-rule-id="${CSS.escape(req.id)}"]`, ".qz-lg-rbody");
        if (req.open !== false && editable && rules.some((r) => r.id === req.id)) openEdit(req.id);
        break;
      case "rules":
        pendingScroll.current = () =>
          scrollTo(".qz-lg-rlist2, .qz-lg-rlist, [data-rules-empty-focus]");
        break;
      case "create":
        if (editable) openCreate();
        break;
      case "recommendation":
        if (rulesOnly) {
          if (editable) openCreate([req.id]);
        } else if (req.questionId) {
          const qid = req.questionId;
          setSelectedId(qid);
          pendingScroll.current = () => scrollTo(`.qz-lw-rail [data-node-id="${CSS.escape(qid)}"]`);
        }
        break;
      case "style":
        if (showHeader && onStyleChange) setStyleMenuOpen(true);
        break;
    }
    forceRender();
    // Only a new nonce re-fires a request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest?.nonce]);

  // ── the Filter rules column's scroll fade (B62) ───────────────────────────
  const rlistWrapRef = useRef<HTMLDivElement>(null);
  const [rlistMore, setRlistMore] = useState(false);
  const markRules = useCallback(() => {
    const l = rlistWrapRef.current?.querySelector<HTMLElement>(".qz-lg-rlist");
    setRlistMore(!!l && l.scrollHeight - l.clientHeight - l.scrollTop > 4);
  }, []);
  useLayoutEffect(() => {
    markRules();
  });
  useEffect(() => {
    const w = rlistWrapRef.current;
    if (!w || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => markRules());
    ro.observe(w);
    return () => ro.disconnect();
  }, [markRules, view, rulesOnly]);

  // ── blocks ─────────────────────────────────────────────────────────────
  const switchedOn = questions.filter(
    (q) => q.node.data.role === "decides" || q.node.data.role === "filter",
  ).length;
  const hasPicking = questions.some((q) => q.node.data.role === "decides");
  const filterEmpty = filterRulesEmpty(hasPicking, switchedOn);

  const rulesColumn = (
    <div className="qz-lg-rcol">
      <div className="qz-lg-rcol-in">
        <div className="qz-lg-rcol-h">
          <h4>
            {RULE_COPY.columnTitle}
            <span className="qz-lg-rcount">{rules.length}</span>
          </h4>
          {editable ? (
            <button type="button" className="qz-lg-btn is-pri" onClick={() => openCreate()}>
              {RULE_COPY.add}
            </button>
          ) : null}
        </div>
        <p>{RULE_COPY.columnSub}</p>
        <div
          ref={rlistWrapRef}
          className={`qz-lg-rlistw${rlistMore ? " is-more" : ""}`}
          onScrollCapture={markRules}
        >
          <RulesList
            variant="column"
            doc={doc}
            style={style}
            catById={catById}
            statuses={statuses}
            flashRuleIds={flashIds}
            onEdit={editable ? openEdit : undefined}
            commit={commit}
            getLatestDoc={getLatestDoc}
            undo={undo}
            empty={
              <div className="qz-lg-rlist">
                <div className="qz-lg-rempty" data-rules-empty-focus tabIndex={-1}>
                  {filterEmpty.lead} {filterEmpty.body}
                  <b>{filterEmpty.strong}</b>
                  {filterEmpty.tail}
                </div>
              </div>
            }
          />
        </div>
        {editable ? (
          <div className="qz-lg-rcol-f">
            <button type="button" className="qz-lg-link" onClick={openPaste}>
              {RULE_COPY.pasteRules}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );

  const filterEdit = (
    <LogicQuestionWidget
      doc={doc}
      questions={questions}
      categories={allCategories}
      colTitleById={colTitleById}
      productIndex={productIndex}
      readout={readout}
      qIndexByNodeId={qIndexByNodeId}
      commit={commit}
      rulesOnly={false}
      deciderQIndex={deciderQIndex}
      hasNarrowFields={hasNarrowFields}
      lastSyncAt={lastSyncAt}
      shopifyAdminDomain={shopifyAdminDomain}
      rulesByAnswer={rulesByAnswer}
      selectedId={selected?.node.id ?? null}
      onSelect={setSelectedId}
      onAddQuestion={editable ? () => setAddOpen(true) : undefined}
      aside={rulesColumn}
    />
  );

  const rulesOnlyEdit = (
    <>
      <div className="qz-lg-rband">
        <h3 className="qz-lg-sr">{RULE_COPY.columnTitle}</h3>
        <RulesList
          variant="row"
          doc={doc}
          style={style}
          catById={catById}
          statuses={statuses}
          litRuleIds={litRuleIds}
          flashRuleIds={flashIds}
          onEdit={editable ? openEdit : undefined}
          commit={commit}
          getLatestDoc={getLatestDoc}
          undo={undo}
          empty={
            <div className="qz-lg-rempty2">
              <span>
                <b>{RULES_ONLY_EMPTY.lead}</b> {RULES_ONLY_EMPTY.body}
              </span>
              {editable ? (
                <button
                  type="button"
                  className="qz-lg-btn is-pri"
                  data-rules-empty-focus
                  onClick={() => openCreate()}
                >
                  {RULE_COPY.createFirst}
                </button>
              ) : null}
            </div>
          }
        />
      </div>
      <RecommendationsStrip
        doc={doc}
        style={style}
        recommendations={recommendations}
        statuses={statuses}
        onCreateFor={editable ? (id) => openCreate([id]) : undefined}
        onAddRecommendations={editable ? () => setAddRecsOpen(true) : undefined}
        onLitChange={setLitRec}
      />
    </>
  );

  const importExport = (
    <LogicImportExport
      doc={doc}
      style={style}
      questions={questions}
      categories={allCategories}
      recommendations={recommendations}
      commit={editable ? commit : undefined}
      getLatestDoc={getLatestDoc}
      undo={undo}
    />
  );

  return (
    <div
      ref={cardRef}
      className={`qz-lg-card${showHeader ? "" : " is-bare"}`}
      data-testid="logic-tab-card"
      data-logic-style={style}
      data-logic-view={view}
    >
      {showHeader ? (
        <LogicHeader
          style={style}
          onStyleChange={onStyleChange ? handleStyleChange : undefined}
          view={view}
          onViewChange={(v) => {
            setLitRec(null);
            setView(v);
          }}
          onPasteRules={editable ? openPaste : undefined}
          onCreateRule={editable ? () => openCreate() : undefined}
          importExport={importExport}
          styleMenuOpen={styleMenuOpen}
          onStyleMenuOpenChange={setStyleMenuOpen}
          headingLevel={headingLevel}
        />
      ) : null}
      {view === "table" ? (
        <LogicTableView
          doc={doc}
          style={style}
          questions={questions}
          categories={allCategories}
          recommendations={recommendations}
          statuses={statuses}
          commit={editable ? commit : undefined}
          commitTracked={editable ? commitTracked : undefined}
          getLatestDoc={getLatestDoc}
          undo={undo}
          onEditRule={editable ? openEdit : undefined}
          onCreateFor={editable ? (id) => openCreate([id]) : undefined}
          onSelectQuestion={(id) => {
            setSelectedId(id);
            setView("edit");
          }}
        />
      ) : rulesOnly ? (
        rulesOnlyEdit
      ) : (
        filterEdit
      )}
      {commit && quizId ? (
        <CreateRuleModal
          doc={doc}
          questions={questions}
          categories={allCategories}
          collections={collections}
          productIndex={productIndex}
          quizId={quizId}
          open={createOpen}
          editRuleId={editRuleId}
          flow={ruleFlow}
          {...(catalog ? { catalog } : {})}
          style={style}
          {...(createTargets ? { initialTargetIds: createTargets } : {})}
          undo={undo}
          onClose={() => {
            setCreateOpen(false);
            setEditRuleId(null);
            setCreateTargets(null);
          }}
          commit={commit}
          onCategoriesCreated={(cats) => setExtraCats((prev) => [...prev, ...cats])}
          getLatestDoc={getLatestDoc}
        />
      ) : null}
      {commit && quizId && pasteOpen ? (
        <PasteRulesModal
          questions={questions}
          categories={allCategories}
          productIndex={productIndex}
          onClose={() => setPasteOpen(false)}
          commit={commit}
          getLatestDoc={getLatestDoc}
        />
      ) : null}
      {commit && quizId && addOpen ? (
        <AddQuestionDialog
          nextNumber={questions.length + 1}
          onClose={() => setAddOpen(false)}
          onSubmit={(payload) => {
            // The ONE append path (straightThroughRun add-anchor rule); the
            // new question lands role-less (Info only until promoted). The
            // host selects it and says so.
            const latest = getLatestDoc();
            const before = new Set(latest.nodes.map((n) => n.id));
            const next = appendBankQuestion(latest, payload);
            const added = next.nodes.find((n) => !before.has(n.id) && n.type === "question");
            commit(next);
            setAddOpen(false);
            if (added) {
              setSelectedId(added.id);
              toast(QUESTION_COPY.added(questions.length + 1));
            }
          }}
        />
      ) : null}
      {commit && quizId && addRecsOpen ? (
        <AddRecommendationsDialog
          open
          quizId={quizId}
          {...(catalog ? { catalog } : {})}
          categories={allCategories}
          productIndex={productIndex}
          onCategoriesCreated={(cats) => setExtraCats((prev) => [...prev, ...cats])}
          onClose={() => setAddRecsOpen(false)}
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
