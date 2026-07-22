import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Quiz as QuizDoc, DecisionRuleCondition } from "../../../../lib/quizSchema";
import type { BuilderCategory, BuilderCollection } from "../../../builder/stepProps";
import type { IndexedProduct } from "../../../../lib/recommendationEngine";
import { insertQuestionRelative } from "../../../../lib/quizMutations";
import { wouldCreateRevisit } from "../../../../lib/pathAnalyzer";
import { createRuleWithCondition } from "./draftRule";
import type { OrderedQuestion, SkipOption } from "../../../../lib/questionOrder";
import { assignSectionColors } from "../sectionPalette";
import { computeRuleLayout } from "../ruleHomes";
import { QuestionSection } from "./QuestionSection";
import { AddQuestionDivider } from "./AddQuestionDivider";
import { RulesWidget } from "./RulesWidget";
import { FallbackSection } from "./FallbackSection";
import { CaptureModule } from "./CaptureModule";

/* quiz-step3 v3 §5 → QZY-2 (quiz-logic dev-handoff v1.2 §2) — the Logic
   sub-view BODY: a two-column layout. LEFT is the map — one collapsible
   QuestionSection card per question in flow order (collapsed is the default
   scannable state), slim add-question dividers, and the capture terminal
   module ("Email Capture / End Quiz") at the bottom. RIGHT is the sticky
   RulesWidget (ONE global rule list, open on load — every rule's editable
   band lives there now; map cards keep per-answer λ chips + the pre-scoped
   "λ Add rule" shortcut whose draft LANDS in the widget) above the §9
   Fallback chooser. Owns the ephemeral state (expanded rule · flashes ·
   the zero-write draft · per-card collapse) and the bidirectional rail
   sync. THEN GO TO options are cycle-guarded via wouldCreateRevisit. */

export interface LogicScrollHandle {
  /** `flashWarn` pulses the section with the warn wash after the glide —
   *  the P4 health jump-link treatment (rules keep their indigo flash). */
  scrollToSection: (nodeId: string, opts?: { flashWarn?: boolean }) => void;
  scrollToRule: (ruleId: string) => void;
}

const NODE_TYPE_LABEL: Record<string, string> = {
  message: "Message step",
  email_gate: "Email gate",
  ask_ai: "Ask-AI step",
  product_cards: "Product cards",
  integration: "Integration step",
  branch: "Branch step",
  result: "Result page",
};

/** How long IO updates stay muted after a programmatic smooth scroll. */
const SUPPRESS_MS = 800;

export const LogicScroll = forwardRef<
  LogicScrollHandle,
  {
    doc: QuizDoc;
    questions: OrderedQuestion[];
    deciderId: string | null;
    categories: BuilderCategory[];
    collections: BuilderCollection[];
    productIndex: IndexedProduct[];
    captureOn: boolean;
    activeId: string;
    onActiveChange: (nodeId: string) => void;
    /** questions-full-page mock — the overview cards' ↑/↓ movers. */
    onMove: (id: string, dir: -1 | 1) => void;
    onCommit: (doc: QuizDoc) => void;
  }
>(function LogicScroll(
  {
    doc,
    questions,
    deciderId,
    categories,
    collections,
    productIndex,
    captureOn,
    activeId,
    onActiveChange,
    onMove,
    onCommit,
  },
  handleRef,
) {
  const rootRef = useRef<HTMLDivElement>(null);
  const sectionEls = useRef(new Map<string, HTMLElement>());
  const ruleEls = useRef(new Map<string, HTMLDivElement>());
  const suppressUntil = useRef(0);

  const [expandedRuleId, setExpandedRuleId] = useState<string | null>(null);
  const [flashRuleId, setFlashRuleId] = useState<string | null>(null);
  const flashTimer = useRef<number | undefined>(undefined);
  // P4 — the section-level warn-wash flash (health jump-link landing).
  const [flashSectionId, setFlashSectionId] = useState<string | null>(null);
  const flashSectionTimer = useRef<number | undefined>(undefined);
  // §5.6 — the pre-scoped rule draft: PURELY LOCAL until the first answer
  // pick (zero doc writes on open/cancel). Holds the pre-filled question id.
  const [draftHome, setDraftHome] = useState<string | null>(null);
  // A section that doesn't exist yet (freshly inserted question) — scroll
  // once its card mounts (carrying a requested flash along).
  const [pendingScroll, setPendingScroll] = useState<{ id: string; flashWarn: boolean } | null>(
    null,
  );
  // QZY-2 (spec §4) — per-card collapse; COLLAPSED is the default scannable
  // state, expansion persists for the session; jumps auto-expand the target.
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});
  const cardExpanded = useCallback(
    (id: string) => expandedCards[id] === true,
    [expandedCards],
  );
  const expandCard = useCallback((id: string) => {
    setExpandedCards((m) => (m[id] ? m : { ...m, [id]: true }));
  }, []);
  const toggleCard = useCallback((id: string) => {
    setExpandedCards((m) => ({ ...m, [id]: !m[id] }));
  }, []);

  const rules = useMemo(() => doc.decision_rules ?? [], [doc.decision_rules]);
  const questionIds = useMemo(() => questions.map((q) => q.node.id), [questions]);
  const idsKey = questionIds.join("|");

  // Palette + rule homes/chips — pure + derived, memoized on [rules, questions].
  const sectionColors = useMemo(
    () => assignSectionColors(questionIds, deciderId),
    [questionIds, deciderId],
  );
  const layout = useMemo(() => computeRuleLayout(rules, questionIds), [rules, questionIds]);

  // Spec §4 — the in-N-rules badge: rules whose CONDITIONS reference the
  // question (by question_id or one of its answer ids).
  const rulesReferencing = useMemo(() => {
    const counts = new Map<string, number>();
    for (const q of questions) {
      const answerIds = new Set(q.node.data.answers.map((a) => a.id));
      let n = 0;
      for (const r of rules) {
        if (r.conditions.some((c) => c.question_id === q.node.id || answerIds.has(c.answer_id)))
          n++;
      }
      counts.set(q.node.id, n);
    }
    return counts;
  }, [questions, rules]);

  // Then-go-to options (the QuestionsLogicLayout recipe): every question as
  // Q{n} + any exotic already-routed target + End quiz. Rows filter self;
  // QZY-2 disables revisit-creating targets per question (spec §1).
  const skipOptions = useMemo<SkipOption[]>(() => {
    const opts: SkipOption[] = questions.map((q) => ({
      value: q.node.id,
      label: `Q${q.qIndex}`,
    }));
    const seen = new Set(questionIds);
    for (const n of doc.nodes) {
      if (n.type !== "question") continue;
      for (const a of n.data.answers) {
        const e = doc.edges.find(
          (ed) => ed.source === n.id && ed.source_handle === a.edge_handle_id,
        );
        if (!e) continue;
        const tn = doc.nodes.find((x) => x.id === e.target);
        if (!tn || tn.type === "end" || tn.type === "intro" || seen.has(tn.id)) continue;
        seen.add(tn.id);
        opts.push({ value: tn.id, label: NODE_TYPE_LABEL[tn.type] ?? tn.type });
      }
    }
    opts.push({ value: "__end__", label: "End quiz" });
    return opts;
  }, [questions, questionIds, doc.nodes, doc.edges]);

  const isRevisitTarget = useCallback(
    (fromQuestionId: string, targetId: string) => {
      if (targetId === "__end__") return false;
      return wouldCreateRevisit(doc, fromQuestionId, targetId);
    },
    [doc],
  );

  const registerSection = useCallback((nodeId: string, el: HTMLElement | null) => {
    if (el) sectionEls.current.set(nodeId, el);
    else sectionEls.current.delete(nodeId);
  }, []);
  const registerRuleEl = useCallback((ruleId: string, el: HTMLDivElement | null) => {
    if (el) ruleEls.current.set(ruleId, el);
    else ruleEls.current.delete(ruleId);
  }, []);

  const flash = useCallback((ruleId: string) => {
    setFlashRuleId(ruleId);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlashRuleId(null), 2000);
  }, []);
  const flashSection = useCallback((nodeId: string) => {
    setFlashSectionId(nodeId);
    if (flashSectionTimer.current) window.clearTimeout(flashSectionTimer.current);
    flashSectionTimer.current = window.setTimeout(() => setFlashSectionId(null), 2000);
  }, []);
  useEffect(
    () => () => {
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
      if (flashSectionTimer.current) window.clearTimeout(flashSectionTimer.current);
    },
    [],
  );

  const scrollToSection = useCallback(
    (nodeId: string, opts?: { flashWarn?: boolean }) => {
      expandCard(nodeId); // a jump always lands on an OPEN card
      const el = sectionEls.current.get(nodeId);
      if (!el) {
        // Not mounted yet (a just-inserted question) — retry on next render.
        setPendingScroll({ id: nodeId, flashWarn: opts?.flashWarn === true });
        return;
      }
      suppressUntil.current = Date.now() + SUPPRESS_MS;
      onActiveChange(nodeId); // report the destination immediately
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      if (opts?.flashWarn) flashSection(nodeId);
    },
    [onActiveChange, flashSection, expandCard],
  );

  const scrollToRule = useCallback(
    (ruleId: string) => {
      setExpandedRuleId(ruleId);
      flash(ruleId);
      // The expanded editor mounts on the NEXT render — scroll after a frame
      // so the geometry includes it (rules live in the right-column widget).
      requestAnimationFrame(() => {
        suppressUntil.current = Date.now() + SUPPRESS_MS;
        ruleEls.current.get(ruleId)?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    },
    [flash],
  );

  useImperativeHandle(handleRef, () => ({ scrollToSection, scrollToRule }), [
    scrollToSection,
    scrollToRule,
  ]);

  // Deferred scroll for a freshly-inserted question (mounts after the commit).
  useEffect(() => {
    if (!pendingScroll) return;
    const el = sectionEls.current.get(pendingScroll.id);
    if (el) {
      suppressUntil.current = Date.now() + SUPPRESS_MS;
      onActiveChange(pendingScroll.id);
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      if (pendingScroll.flashWarn) flashSection(pendingScroll.id);
      setPendingScroll(null);
    }
  }, [pendingScroll, idsKey, onActiveChange, flashSection]);

  // Rail sync — geometry-based active recompute (the QuestionsLogicLayout
  // pattern) + the programmatic-scroll mute above.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(
      () => {
        if (Date.now() < suppressUntil.current) return;
        const r = root.getBoundingClientRect();
        let bestId: string | null = null;
        let bestOffset = Infinity;
        for (const [id, el] of sectionEls.current) {
          const b = el.getBoundingClientRect();
          const offset = b.top - r.top;
          if (offset <= r.height * 0.4 && offset > -b.height && Math.abs(offset) < Math.abs(bestOffset)) {
            bestOffset = offset;
            bestId = id;
          }
        }
        if (bestId) onActiveChange(bestId);
      },
      { root, threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    for (const el of sectionEls.current.values()) obs.observe(el);
    return () => obs.disconnect();
  }, [idsKey, onActiveChange]);

  // §5.6 — commit the pre-scoped draft as ONE doc write: append the rule and
  // patch its condition in the same committed doc (cancel = zero writes).
  const commitDraft = useCallback(
    (cond: DecisionRuleCondition, targetId: string) => {
      const { doc: next, ruleId } = createRuleWithCondition(doc, cond, targetId);
      if (!ruleId) return; // no categories / legacy doc — the button is disabled anyway
      onCommit(next);
      setDraftHome(null);
      setExpandedRuleId(ruleId);
    },
    [doc, onCommit],
  );

  const toggleRule = useCallback(
    (ruleId: string) => setExpandedRuleId((cur) => (cur === ruleId ? null : ruleId)),
    [],
  );

  // Divider insert — anchored BELOW questions[i] (a movable question, never
  // the ordered spine's terminal), then scroll the new section in.
  const addBelow = useCallback(
    (refId: string) => {
      const before = new Set(doc.nodes.map((n) => n.id));
      const next = insertQuestionRelative(doc, refId, "below");
      const newId = next.nodes.find((n) => !before.has(n.id))?.id ?? null;
      onCommit(next);
      if (newId) setPendingScroll({ id: newId, flashWarn: false });
    },
    [doc, onCommit],
  );

  return (
    <div className="qz-s3-logicbody">
      <div className="qz-s3-logic" ref={rootRef} aria-label="Logic map">
        {questions.map((q, qi) => (
          <div key={q.node.id} className="qz-s3-secwrap">
            <QuestionSection
              doc={doc}
              question={q}
              isDecider={q.node.id === deciderId}
              hasCurrentDecider={deciderId !== null}
              colorKey={sectionColors.get(q.node.id) ?? "green"}
              categories={categories}
              productIndex={productIndex}
              skipOptions={skipOptions}
              isRevisitTarget={isRevisitTarget}
              chipsByAnswer={layout.chipsByAnswer}
              inRulesCount={rulesReferencing.get(q.node.id) ?? 0}
              flashWarn={flashSectionId === q.node.id}
              active={activeId === q.node.id}
              expanded={cardExpanded(q.node.id)}
              canUp={qi > 0}
              canDown={qi < questions.length - 1}
              onMove={(dir) => onMove(q.node.id, dir)}
              onToggleExpanded={() => toggleCard(q.node.id)}
              onCommit={onCommit}
              onChipClick={scrollToRule}
              onStartDraft={setDraftHome}
              registerSection={registerSection}
            />
            <AddQuestionDivider onAdd={() => addBelow(q.node.id)} />
          </div>
        ))}
        {/* QZY-2 (owner supplement) — the map pre-populates the capture as
            the LAST step: "Email Capture / End Quiz" instead of a bare end. */}
        <CaptureModule doc={doc} captureOn={captureOn} onCommit={onCommit} />
      </div>

      <div className="qz-s3-rwcol">
        <RulesWidget
          doc={doc}
          questions={questions}
          categories={categories}
          expandedRuleId={expandedRuleId}
          flashRuleId={flashRuleId}
          draftHome={draftHome}
          registerRuleEl={registerRuleEl}
          onToggleRule={toggleRule}
          onCommit={onCommit}
          onCommitDraft={commitDraft}
          onCancelDraft={() => setDraftHome(null)}
          onStartDraft={() => setDraftHome(questions[0]?.node.id ?? null)}
        />
        <FallbackSection
          doc={doc}
          collections={collections}
          productIndex={productIndex}
          onCommit={onCommit}
        />
      </div>
    </div>
  );
});
