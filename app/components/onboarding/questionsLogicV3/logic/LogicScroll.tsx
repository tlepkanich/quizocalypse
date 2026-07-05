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
import { isFreeformType } from "../../../../lib/quizSchema";
import type { BuilderCategory } from "../../../builder/stepProps";
import { insertQuestionRelative } from "../../../../lib/quizMutations";
import { createRuleWithCondition } from "./draftRule";
import type { OrderedQuestion } from "../../questionsLogic/questionOrder";
import type { SkipOption } from "../../questionsLogic/AnswerRow";
import { assignSectionColors } from "../sectionPalette";
import { computeRuleLayout } from "../ruleHomes";
import { RulesStrip } from "./RulesStrip";
import { QuestionSection } from "./QuestionSection";
import { AddQuestionDivider } from "./AddQuestionDivider";

/* quiz-step3 v3 §5 — the Logic view's scrolling column: the sticky RulesStrip,
   then one floating QuestionSection per question in flow order with slim
   add-question dividers between/after. Owns the view's ephemeral state
   (expanded rule · flash · the zero-write pre-scoped rule draft) and the
   BIDIRECTIONAL rail sync: an IntersectionObserver recomputes the active
   section from geometry (the QuestionsLogicLayout pattern) with
   PROGRAMMATIC-SCROLL SUPPRESSION — a chip/rail/strip jump animates through
   intermediate sections, so IO updates are muted for the glide and the
   destination is reported immediately instead. scrollToSection/scrollToRule
   are exposed imperatively for the shell (rail clicks, P4 health jump-links). */

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
    activeId: string;
    onActiveChange: (nodeId: string) => void;
    onEditContent: (nodeId: string) => void;
    onCommit: (doc: QuizDoc) => void;
  }
>(function LogicScroll(
  { doc, questions, deciderId, categories, activeId, onActiveChange, onEditContent, onCommit },
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
  // pick (zero doc writes on open/cancel). Holds the home section's node id.
  const [draftHome, setDraftHome] = useState<string | null>(null);
  // A section that doesn't exist yet (freshly inserted question) — scroll
  // once its card mounts (carrying a requested flash along).
  const [pendingScroll, setPendingScroll] = useState<{ id: string; flashWarn: boolean } | null>(
    null,
  );

  const rules = useMemo(() => doc.decision_rules ?? [], [doc.decision_rules]);
  const rulesById = useMemo(() => new Map(rules.map((r) => [r.id, r] as const)), [rules]);
  const questionIds = useMemo(() => questions.map((q) => q.node.id), [questions]);
  const idsKey = questionIds.join("|");

  // Palette + rule homes/chips — pure + derived, memoized on [rules, questions].
  const sectionColors = useMemo(
    () => assignSectionColors(questionIds, deciderId),
    [questionIds, deciderId],
  );
  const layout = useMemo(() => computeRuleLayout(rules, questionIds), [rules, questionIds]);

  const conditionQuestions = useMemo(
    () => questions.filter((q) => !isFreeformType(q.node.data.question_type)),
    [questions],
  );

  // Then-go-to options (the QuestionsLogicLayout recipe): every question as
  // Q{n} + any exotic already-routed target + End quiz. Rows filter self.
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
    [onActiveChange, flashSection],
  );

  const scrollToRule = useCallback(
    (ruleId: string) => {
      setExpandedRuleId(ruleId);
      flash(ruleId);
      const home = layout.homes.get(ruleId) ?? null;
      suppressUntil.current = Date.now() + SUPPRESS_MS;
      if (home) onActiveChange(home);
      // The expanded editor mounts on the NEXT render — scroll after a frame
      // so the geometry includes it (rule els register for homed AND homeless).
      requestAnimationFrame(() => {
        suppressUntil.current = Date.now() + SUPPRESS_MS;
        const el =
          ruleEls.current.get(ruleId) ?? (home ? sectionEls.current.get(home) : undefined);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    },
    [layout, onActiveChange, flash],
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
    <div className="qz-s3-logic" ref={rootRef} aria-label="Logic view">
      <RulesStrip
        doc={doc}
        rules={rules}
        homeless={layout.homeless}
        questions={questions}
        conditionQuestions={conditionQuestions}
        categories={categories}
        expandedRuleId={expandedRuleId}
        flashRuleId={flashRuleId}
        onRuleClick={scrollToRule}
        onToggleRule={toggleRule}
        onCommit={onCommit}
        registerRuleEl={registerRuleEl}
      />

      {questions.map((q) => (
        <div key={q.node.id} className="qz-s3-secwrap">
          <QuestionSection
            doc={doc}
            question={q}
            isDecider={q.node.id === deciderId}
            hasCurrentDecider={deciderId !== null}
            colorKey={sectionColors.get(q.node.id) ?? "green"}
            categories={categories}
            skipOptions={skipOptions}
            layout={layout}
            rulesById={rulesById}
            totalRules={rules.length}
            questions={questions}
            conditionQuestions={conditionQuestions}
            expandedRuleId={expandedRuleId}
            flashRuleId={flashRuleId}
            flashWarn={flashSectionId === q.node.id}
            draftActive={draftHome === q.node.id}
            active={activeId === q.node.id}
            onCommit={onCommit}
            onEditContent={onEditContent}
            onChipClick={scrollToRule}
            onToggleRule={toggleRule}
            onStartDraft={setDraftHome}
            onCommitDraft={commitDraft}
            onCancelDraft={() => setDraftHome(null)}
            registerSection={registerSection}
            registerRuleEl={registerRuleEl}
          />
          <AddQuestionDivider onAdd={() => addBelow(q.node.id)} />
        </div>
      ))}
    </div>
  );
});
