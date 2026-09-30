import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { DecisionRule, Quiz } from "../../../lib/quizSchema";
import type { BuilderCategory, BuilderCollection } from "../../builder/stepProps";
import type { IndexedProduct } from "../../../lib/recommendationEngine";
import type { OrderedQuestion } from "../../../lib/questionOrder";
import type { LogicStyle } from "../../../lib/logicStyle";
import type { RulesUndo } from "./RulesList";
import {
  createDecisionRule,
  duplicateDecisionRule,
  normalizeDecisionRule,
  removeDecisionRule,
  restoreDecisionRules,
  updateDecisionRule,
} from "../../../lib/quizMutations";
import { describeRuleTokens } from "../../../lib/ruleSummary";
import { ruleStatuses } from "../../../lib/ruleStatus";
import { recommendationCoverage } from "../../../lib/recommendationCoverage";
import { impossibleAllOf } from "../../../lib/pathAnalyzer";
import { deliverableCopy } from "../../../lib/bucketSelection";
import { QzPopover, useFocusTrap, useInertBackground, useScrollLock } from "../../qz-overlays";
import { useQzToast } from "../../qz-toast";
import { useRowFit } from "./useRowFit";
import {
  batches,
  blankDraft,
  draftFromRule,
  draftToRule,
  isScalePoint,
  mapEnsureResponse,
  productsWord,
  questionTypeTag,
  quizUsedRefs,
  removeDraftQuestion,
  rulesWord,
  sameStoredRule,
  scaleEndLabel,
  splitRecommendationGroups,
  stylesVerbs,
  toggleDraftAll,
  toggleDraftAnswer,
  toggleDraftNot,
  type EnsureKind,
  type EnsureResult,
  type RuleDraft,
  type RuleVerb,
} from "./createRuleBand";
import { RuleSentence } from "./RulesList";
import { AddRecommendationsDialog, ProductPeek, type LogicCatalog } from "./AddRecommendationsDialog";
import {
  RULE_COPY,
  RULE_WINDOW_COPY as W,
  STRIP_COPY,
  VERBS,
  YOUR_RECOMMENDATIONS,
  verbHint,
} from "./logicCopy";

// ════════════════════════════════════════════════════════════════════════════
// The rule window — "Create a rule" / "Edit rule" (D24, owner 2026-09-17/18;
// mock modalHTML / drawModal / tidy / fitDraft / ACT.m*; handoff "The rule
// window"). One dialog creates and edits every rule, in both logic styles.
//
//   ┌ WHAT HAPPENS [Show|Pin|Hide] hint ········ Duplicate  Delete rule  × ┐
//   │ ┌ YOUR RECOMMENDATIONS n/N have a rule ······ + Add recommendations ┐ │
//   │ │ [□ name 4 ●] [□ …] … two rows max, "See N more · P picked"        │ │
//   │ └───────────────────────────────────────────────────────────────────┘ │
//   │ WHEN THEY ANSWER                                                      │
//   │ Q1  question text        is      [104×68 buckets … scroll sideways]  │
//   │ Q2  text MULTI · PICK 1–5 is/any  [ … ]                              │
//   ├ Show dryness when (A or B) and not (C) ··· Cancel  & add another  Save┤
//   └───────────────────────────────────────────────────────────────────────┘
//
// No title bar (the aria-label names it); one scrolling body; only the
// footer is pinned. The box hugs its widest answer row (min 680px, each
// strip capped at 676px with a right fade while more is left to scroll).
//
// `flow` changes the RECOMMENDATIONS BAND and nothing else (D6 parked):
//   onboarding · the funnel band above (this quiz's Category rows, coverage
//                from THE shared helper recommendationCoverage, "+ Add
//                recommendations" through ensure-targets, D15);
//   builder    · the builder keeps its "What the quiz shows" catalogue band
//                in the same slot until the main-builder work adopts this
//                screen.
//
// Binding (B2): an edit window is bound to its rule ID for its whole life.
// If the rule disappears while open (an Undo, an import), the window closes
// and says so; Save never silently creates or overwrites. Duplicate copies
// the ON-SCREEN draft directly below and the window moves onto the copy.
// Stored `match: "any"` survives an edit (D13); a stored "is not" row opens
// as none-of and can never be all-of (D12); in Rules only a stored Pin /
// Hide opens as Show and says so (D2).
//
// Modal behaviour: draft-safe scrim (a click never closes), the page behind
// is inert and its scroll locked, Tab stays inside, focus lands on the
// chosen verb and returns to the opener, Esc closes the innermost layer
// (a popover, then Add recommendations, then this window). The scrim pads
// by --qz-toast-reserve so a toast never sits on the footer (B34).
// ════════════════════════════════════════════════════════════════════════════

type QuizDoc = Quiz;

type Kind = "set" | "tag" | "collection" | "product" | "metafield";
type KindFilter = "all" | Kind;

export type CreateRuleFlow = "onboarding" | "builder";

interface SelectedResource {
  key: string;
  kind: Kind;
  ref: string;
  name: string;
  count: number;
}

const setRow = (c: Pick<BuilderCategory, "id" | "name" | "productIds">): SelectedResource => ({
  key: `set:${c.id}`,
  kind: "set",
  ref: c.id,
  name: c.name,
  count: c.productIds.length,
});

// ── the builder band (kept for flow="builder" until D6 lands) ───────────────
const KIND_CHIPS: Array<{ kind: Kind; label: string }> = [
  { kind: "set", label: "Recommendations" },
  { kind: "product", label: "Products" },
  { kind: "collection", label: "Collections" },
  { kind: "tag", label: "Tags" },
  { kind: "metafield", label: "Metafields" },
];
const KIND_TAG: Record<Kind, string> = {
  set: "Group",
  product: "Product",
  collection: "Collection",
  tag: "Tag",
  metafield: "Metafield",
};
const ROW_CAP = 5;
const LIST_CAP = 40;

const COPY_ICON = (
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
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.4" />
    <path d="M10.5 3.2A1.7 1.7 0 0 0 8.8 2H4.2A1.7 1.7 0 0 0 2.5 3.7v4.6c0 .8.5 1.4 1.2 1.6" />
  </svg>
);
const TRASH_ICON = (
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

/* ── the builder band's target card (flow="builder" only) ─────────────── */
function TargetCard({
  r,
  on,
  ruleCount,
  img,
  products,
  onToggle,
}: {
  r: SelectedResource;
  on: boolean;
  ruleCount: number;
  img: string | null;
  products: IndexedProduct[];
  onToggle: () => void;
}) {
  const showRuleCount = r.kind === "set" && ruleCount > 0;
  const titleParts = [`${r.name} · ${productsWord(r.count)}`];
  if (r.kind === "set" && ruleCount) titleParts.push(`used by ${rulesWord(ruleCount)}`);
  const cardRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={cardRef} className={`qz-lm-tcard${on ? " is-on" : ""}`}>
      <button
        type="button"
        className="qz-lm-tsel"
        aria-pressed={on}
        aria-label={r.name}
        title={titleParts.join(" · ")}
        onClick={onToggle}
      />
      <span className={`qz-lm-pthumb${img ? " has-img" : ""}`} aria-hidden>
        {img ? <img src={img} alt="" loading="lazy" /> : null}
      </span>
      <span className="qz-lm-tmeta">
        <span className="qz-lm-tn" title={r.name}>
          {r.name}
        </span>
        <span className="qz-lm-tsub">
          <QzPopover
            placement="top"
            maxWidth={260}
            anchorRef={cardRef}
            trigger={
              <button
                type="button"
                className="qz-lm-tcount"
                title="See what is in this group"
                aria-label={W.peekLabel(productsWord(r.count), r.name)}
              >
                {productsWord(r.count)}
              </button>
            }
            content={<ProductPeek name={r.name} products={products} />}
          />
          {showRuleCount ? <span className="qz-lm-thas">· {rulesWord(ruleCount)}</span> : null}
        </span>
      </span>
      <span className="qz-lm-kd">{KIND_TAG[r.kind]}</span>
    </div>
  );
}

export type CreateRuleModalProps = {
  doc: QuizDoc;
  questions: OrderedQuestion[];
  categories: BuilderCategory[];
  collections: BuilderCollection[];
  productIndex: IndexedProduct[];
  quizId: string;
  open: boolean;
  /** Edit mode: the rule this window is bound to, BY ID (B2). Null/absent =
   *  create. The window keeps its own binding once open (Duplicate moves it
   *  onto the copy; "Save & add another" moves it to a new create draft). */
  editRuleId?: string | null;
  /** Which recommendations band to render — the ONLY thing the flow
   *  changes. The funnel passes "onboarding"; the builder passes nothing. */
  flow?: CreateRuleFlow;
  onClose: () => void;
  commit: (doc: QuizDoc) => void;
  onCategoriesCreated: (cats: BuilderCategory[]) => void;
  /** Latest-doc seam: every commit builds on the CURRENT doc, never the
   *  render-time snapshot captured before an await (review L2-5). */
  getLatestDoc?: () => QuizDoc;
  /** The SCREEN style (resolveLogicStyle). */
  style?: LogicStyle;
  /** Prefill for "Create a rule" opened from an uncovered recommendation. */
  initialTargetIds?: readonly string[];
  /** The card's ONE Undo run, so delete / duplicate join the row toasts. */
  undo?: RulesUndo;
  /** The funnel loader's catalogue, for "+ Add recommendations". */
  catalog?: LogicCatalog;
};

export function CreateRuleModal({
  doc,
  questions,
  categories,
  collections,
  productIndex,
  quizId,
  open,
  editRuleId = null,
  flow = "builder",
  onClose,
  commit,
  onCategoriesCreated,
  getLatestDoc,
  style = "attributes",
  initialTargetIds,
  undo,
  catalog,
}: CreateRuleModalProps) {
  const toast = useQzToast();
  const scrimRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const verbRef = useRef<HTMLButtonElement>(null);
  const latest = useCallback(() => (getLatestDoc ? getLatestDoc() : doc), [getLatestDoc, doc]);

  // ── binding + draft ────────────────────────────────────────────────────
  const [boundId, setBoundId] = useState<string | null>(null);
  const boundRef = useRef<string | null>(null);
  boundRef.current = boundId;
  const [draft, setDraft] = useState<RuleDraft>(blankDraft);
  const [sel, setSel] = useState<SelectedResource[]>([]);
  // A new draft re-keys the scrolling body: scrollTop 0 and every answer
  // strip back to scrollLeft 0 (B51). A redraw of the same draft keeps both.
  const [draftKey, setDraftKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [recMoreOpen, setRecMoreOpen] = useState(false);
  const [recQuery, setRecQuery] = useState("");
  const [addRecsOpen, setAddRecsOpen] = useState(false);
  // Builder band state.
  const [query, setQuery] = useState("");
  const [kindChip, setKindChip] = useState<KindFilter>("all");
  const [moreOpen, setMoreOpen] = useState(false);
  const focusVerbNext = useRef(false);
  const editing = boundId !== null;
  const onboarding = flow === "onboarding";

  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const closeWindow = useCallback(() => {
    setRecMoreOpen(false);
    setAddRecsOpen(false);
    onClose();
  }, [onClose]);

  // Where focus goes when the opener is gone (a deleted row, a closed
  // popover): the bound rule's row, else the view's create control.
  const focusFallback = useCallback(() => {
    const card = document.querySelector('[data-testid="logic-tab-card"]');
    const id = boundRef.current;
    const row = id ? card?.querySelector<HTMLElement>(`[data-rule-id="${CSS.escape(id)}"] .qz-lg-rbody`) : null;
    const target =
      row ??
      card?.querySelector<HTMLElement>(
        ".qz-lg-sact .qz-lg-btn.is-pri, .qz-lg-rcol-h .qz-lg-btn, [data-rules-empty-focus]",
      ) ??
      null;
    target?.focus({ preventScroll: true });
  }, []);

  // Inert FIRST (cleanups run in declaration order: the page is live again
  // before the trap hands focus back to the opener).
  useInertBackground(scrimRef, open);
  useFocusTrap(boxRef, open, verbRef, focusFallback);
  useScrollLock(open);

  // ── seed once per open (and per new binding from the host) ─────────────
  const initialKey = initialTargetIds?.join("|") ?? "";
  useEffect(() => {
    if (!open) {
      setRecMoreOpen(false);
      setAddRecsOpen(false);
      // A closed window is bound to nothing (the next open re-binds).
      setBoundId(null);
      return;
    }
    const base = latest();
    setQuery("");
    setKindChip("all");
    setMoreOpen(false);
    setRecMoreOpen(false);
    setRecQuery("");
    // The new draft re-keys the body; focus its chosen verb once it lands.
    focusVerbNext.current = true;
    setDraftKey((k) => k + 1);
    if (editRuleId) {
      const rule = (base.decision_rules ?? []).find((r) => r.id === editRuleId);
      if (!rule) {
        closeWindow();
        toast(W.gone);
        return;
      }
      setBoundId(rule.id);
      setDraft(draftFromRule(rule, style));
      setSel(
        (rule.target_ids?.length ? rule.target_ids : [rule.target_id]).map((tid) => {
          const cat = catById.get(tid);
          // A deleted recommendation stays picked, flagged and removable —
          // never silently dropped (B1, B9).
          return cat ? setRow(cat) : { key: `set:${tid}`, kind: "set" as const, ref: tid, name: "", count: 0 };
        }),
      );
      return;
    }
    setBoundId(null);
    setDraft(blankDraft());
    setSel(
      (initialTargetIds ?? []).flatMap((id) => {
        const cat = catById.get(id);
        return cat ? [setRow(cat)] : [];
      }),
    );
    // Categories and the doc are lookups here — reseeding on their refresh
    // would clobber the draft in progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editRuleId, initialKey]);

  // ── B2: the bound rule vanished (an Undo, an import) → close and say so ──
  const ownIds = useRef(new Set<string>());
  const rules = useMemo(() => doc.decision_rules ?? [], [doc.decision_rules]);
  useEffect(() => {
    if (!open || !boundId || busyRef.current) return;
    if (rules.some((r) => r.id === boundId)) {
      ownIds.current.delete(boundId);
      return;
    }
    if (ownIds.current.has(boundId)) return;
    closeWindow();
    toast(W.gone);
  }, [open, boundId, rules, closeWindow, toast]);

  // A fresh draft ("… & add another") moves focus to its first control.
  useEffect(() => {
    if (!focusVerbNext.current) return;
    focusVerbNext.current = false;
    verbRef.current?.focus({ preventScroll: true });
  }, [draftKey]);

  // Esc closes the innermost layer. An open popover and Add recommendations
  // (QzModal, capture phase + stopPropagation) take it first.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (document.querySelector(".qz-popover")) return;
      closeWindow();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, closeWindow]);

  // ── derived ───────────────────────────────────────────────────────────────
  const rowSpec = useMemo(
    () => questions.map((q) => ({ id: q.node.id, multi: q.node.data.question_type === "multi_select" })),
    [questions],
  );
  const recommendations = useMemo(() => categories.filter((c) => c.quizId != null), [categories]);
  const recIds = useMemo(() => recommendations.map((c) => c.id), [recommendations]);
  const statuses = useMemo(
    () => (open ? ruleStatuses(doc, categories.map((c) => c.id)) : null),
    [open, doc, categories],
  );
  const coverage = useMemo(
    () => (statuses ? recommendationCoverage(doc, style, recIds, statuses) : new Map()),
    [statuses, doc, style, recIds],
  );
  const covered = useCallback((id: string) => coverage.get(id)?.covered ?? false, [coverage]);

  const selKeys = useMemo(() => new Set(sel.map((s) => s.key)), [sel]);
  const sentenceIds = useMemo(() => sel.map((s) => (s.kind === "set" ? s.ref : s.key)), [sel]);
  const sentenceCats = useMemo(() => {
    const m = new Map(catById);
    for (const s of sel) {
      if (s.kind !== "set")
        m.set(s.key, {
          id: s.key,
          name: s.name,
          description: "",
          tags: [],
          productIds: [],
          source: s.kind,
          sourceRef: s.ref,
          quizId: null,
        });
    }
    return m;
  }, [catById, sel]);
  const draftRule = useMemo(
    () => draftToRule(draft, rowSpec, sentenceIds, boundId ?? "draft", editing),
    [draft, rowSpec, sentenceIds, boundId, editing],
  );
  const tokens = useMemo(() => {
    const t = describeRuleTokens(draftRule, doc, style);
    // No recommendation picked yet reads "…", never a deleted one.
    return { ...t, targetIds: t.targetIds.filter(Boolean) };
  }, [draftRule, doc, style]);
  const impossible = useMemo(() => impossibleAllOf(draftRule, doc), [draftRule, doc]);
  const canSubmit = draftRule.conditions.length > 0 && sel.length > 0 && !impossible;

  // ── ensure-targets (D15): raw builder picks become quiz Category rows,
  //    at most 12 per call, lifted after every batch ────────────────────────
  const resolveTargets = async (): Promise<string[] | null> => {
    const raw = sel.filter((s) => s.kind !== "set");
    const idByKey = new Map<string, string>();
    for (const batch of batches(raw)) {
      const sent = batch.map((r) => ({ kind: r.kind as EnsureKind, ref: r.ref, name: r.name }));
      let body: { ok?: boolean; results?: EnsureResult[]; categories?: BuilderCategory[] };
      try {
        const res = await fetch("/api/categories/ensure-targets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quizId, resources: sent }),
        });
        body = (await res.json()) as typeof body;
      } catch {
        toast(W.offline);
        return null;
      }
      if (!body.ok) {
        toast(W.addFailed);
        return null;
      }
      const results = mapEnsureResponse(sent, body);
      const lifted = results.flatMap((x) => ("category" in x ? [x.category] : []));
      if (lifted.length) onCategoriesCreated(lifted);
      results.forEach((x, i) => {
        if ("category" in x) idByKey.set(batch[i]!.key, x.category.id);
      });
      if (results.some((x) => "skipped" in x)) {
        toast(W.addFailed);
        return null;
      }
    }
    if (raw.length) {
      // The picks are Category rows now: a retry never re-sends them.
      setSel((prev) =>
        prev.map((s) => {
          const id = idByKey.get(s.key);
          return id ? { key: `set:${id}`, kind: "set", ref: id, name: s.name, count: s.count } : s;
        }),
      );
    }
    return sel
      .map((s) => (s.kind === "set" ? s.ref : idByKey.get(s.key)))
      .filter((id): id is string => Boolean(id));
  };

  const startBlank = () => {
    setBoundId(null);
    setDraft(blankDraft());
    setSel([]);
    setRecMoreOpen(false);
    setRecQuery("");
    setQuery("");
    setKindChip("all");
    setMoreOpen(false);
    focusVerbNext.current = true;
    setDraftKey((k) => k + 1);
  };

  const withBusy = async (run: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await run();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  /** The normalized rule a draft saves against `base`. */
  const savedRule = (base: QuizDoc, targetIds: string[], id: string, asEdit: boolean) =>
    normalizeDecisionRule(draftToRule(draft, rowSpec, targetIds, id, asEdit), base);

  const save = (more: boolean) =>
    withBusy(async () => {
      if (!canSubmit) return;
      setRecMoreOpen(false);
      const targetIds = await resolveTargets();
      if (!targetIds) return;
      const base = latest();
      const id = boundRef.current;
      if (id !== null) {
        const stored = (base.decision_rules ?? []).find((r) => r.id === id);
        if (!stored) {
          // B2: never save the draft as a new rule behind the merchant's back.
          closeWindow();
          toast(W.goneOnSave);
          return;
        }
        const rule = savedRule(base, targetIds, id, true);
        if (!sameStoredRule(rule, normalizeDecisionRule(stored, base))) {
          commit(
            updateDecisionRule(base, id, {
              conditions: rule.conditions,
              target_ids: rule.target_ids ?? [rule.target_id],
              // Always pass the key: its presence clears a kept legacy action.
              action: rule.action,
              any_of: rule.any_of ?? [],
            }),
          );
        }
        toast(W.saved);
      } else {
        const rule = savedRule(base, targetIds, "new", false);
        commit(
          createDecisionRule(base, {
            conditions: rule.conditions,
            target_ids: rule.target_ids ?? [rule.target_id],
            ...(rule.action ? { action: rule.action } : {}),
            ...(rule.any_of?.length ? { any_of: rule.any_of } : {}),
          }),
        );
        toast(W.created);
      }
      if (more) startBlank();
      else closeWindow();
    });

  const duplicate = () =>
    withBusy(async () => {
      const id = boundRef.current;
      if (!id || !canSubmit) return;
      const targetIds = await resolveTargets();
      if (!targetIds) return;
      const base = latest();
      const at = (base.decision_rules ?? []).findIndex((r) => r.id === id);
      if (at < 0) {
        closeWindow();
        toast(W.goneOnCopy);
        return;
      }
      const stored = base.decision_rules![at]!;
      const rule = savedRule(base, targetIds, id, true);
      // The copy is what is on screen (mock ACT.mdup): the rule under edit
      // takes the draft too, so the copy never differs from it.
      const origChanged = !sameStoredRule(rule, normalizeDecisionRule(stored, base));
      let next = base;
      if (origChanged) {
        next = updateDecisionRule(next, id, {
          conditions: rule.conditions,
          target_ids: rule.target_ids ?? [rule.target_id],
          action: rule.action,
          any_of: rule.any_of ?? [],
        });
      }
      next = duplicateDecisionRule(next, id);
      const copy = next.decision_rules?.[at + 1];
      if (!copy || copy.id === id) return;
      ownIds.current.add(copy.id);
      commit(next);
      setBoundId(copy.id);
      setDraft(draftFromRule(copy, style));
      undo?.push({
        message: W.copied(at + 2, at + 1),
        inverse: (d) => {
          let x = removeDecisionRule(d, copy.id);
          if (origChanged) {
            const i = (x.decision_rules ?? []).findIndex((r) => r.id === stored.id);
            if (i >= 0) x = restoreDecisionRules(removeDecisionRule(x, stored.id), [{ rule: stored, index: i }]);
          }
          return x;
        },
      });
    });

  const deleteBound = () => {
    if (busyRef.current) return;
    const id = boundRef.current;
    if (!id) return;
    const base = latest();
    const at = (base.decision_rules ?? []).findIndex((r) => r.id === id);
    if (at < 0) {
      closeWindow();
      toast(W.goneOnDelete);
      return;
    }
    const rule = base.decision_rules![at]!;
    commit(removeDecisionRule(base, id));
    closeWindow();
    const card = () => document.querySelector('[data-testid="logic-tab-card"]');
    const focusAt = () => {
      const bodies = Array.from(card()?.querySelectorAll<HTMLElement>(".qz-lg-rbody") ?? []);
      (
        bodies[at] ??
        bodies[bodies.length - 1] ??
        card()?.querySelector<HTMLElement>("[data-rules-empty-focus], .qz-lg-sact .qz-lg-btn.is-pri, .qz-lg-rcol-h .qz-lg-btn")
      )?.focus();
    };
    // After the window's focus trap has handed focus back (the discrete
    // click flushes its effects synchronously), the Undo takes it (B32).
    window.setTimeout(() => {
      undo?.push({
        // The card's ONE run counts the deletes (a row delete then this one
        // reads "2 rules deleted"), so the message is built there.
        message: RULE_COPY.deletedRun(at + 1),
        inverse: (d) => restoreDecisionRules(d, [{ rule, index: at }]),
        isDelete: true,
        focusAction: true,
        returnFocus: focusAt,
        focusAfter: () =>
          window.requestAnimationFrame(() =>
            card()
              ?.querySelector<HTMLElement>(`[data-rule-id="${CSS.escape(rule.id)}"] .qz-lg-rbody`)
              ?.focus(),
          ),
      });
      if (!undo) toast(RULE_COPY.deleted(at + 1));
    }, 0);
  };

  // ── draft edits ───────────────────────────────────────────────────────────
  const toggleRec = (r: SelectedResource) =>
    setSel((prev) => (prev.some((s) => s.key === r.key) ? prev.filter((s) => s.key !== r.key) : [...prev, r]));

  // ── the answer strips' right fade (mock markMore) ───────────────────────
  const markMore = useCallback(() => {
    boxRef.current?.querySelectorAll<HTMLElement>(".qz-lg-mans").forEach((el) => {
      el.parentElement?.classList.toggle("is-more", el.scrollWidth - el.clientWidth - el.scrollLeft > 4);
    });
  }, []);
  useLayoutEffect(() => {
    if (open) markMore();
  });
  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", markMore);
    return () => window.removeEventListener("resize", markMore);
  }, [open, markMore]);

  // ── the builder band's index (flow="builder") ───────────────────────────
  const index = useMemo(() => {
    if (onboarding || !open) return [] as SelectedResource[];
    const colCounts = new Map<string, number>();
    const tagCounts = new Map<string, { name: string; count: number }>();
    const mfCounts = new Map<string, { name: string; count: number }>();
    for (const p of productIndex) {
      for (const c of p.collection_ids) colCounts.set(c, (colCounts.get(c) ?? 0) + 1);
      for (const t of p.tags) {
        const k = t.trim();
        if (!k) continue;
        const e = tagCounts.get(k);
        if (e) e.count++;
        else tagCounts.set(k, { name: k, count: 1 });
      }
      for (const [k, v] of Object.entries(p.metafields ?? {})) {
        if (k.startsWith("__") || !v || v.trim().startsWith("{")) continue;
        const ref = `${k}: ${v}`;
        const e = mfCounts.get(ref);
        if (e) e.count++;
        else mfCounts.set(ref, { name: `${k.split(".").pop()}: ${v}`, count: 1 });
      }
    }
    return [
      ...categories.map(setRow),
      ...[...tagCounts.entries()].map(([k, e]) => ({ key: `tag:${k}`, kind: "tag" as const, ref: e.name, name: e.name, count: e.count })),
      ...collections.map((c) => ({
        key: `collection:${c.collectionId}`,
        kind: "collection" as const,
        ref: c.collectionId,
        name: c.title,
        count: colCounts.get(c.collectionId) ?? 0,
      })),
      ...[...mfCounts.entries()].map(([ref, e]) => ({ key: `metafield:${ref}`, kind: "metafield" as const, ref, name: e.name, count: e.count })),
      ...productIndex.map((p) => ({ key: `product:${p.product_id}`, kind: "product" as const, ref: p.product_id, name: p.title, count: 1 })),
    ];
  }, [onboarding, open, categories, collections, productIndex]);
  const productById = useMemo(() => new Map(productIndex.map((p) => [p.product_id, p])), [productIndex]);
  const resolveResource = useCallback(
    (s: SelectedResource): IndexedProduct[] => {
      if (s.kind === "set")
        return (catById.get(s.ref)?.productIds ?? [])
          .map((id) => productById.get(id))
          .filter((p): p is IndexedProduct => p !== undefined);
      if (s.kind === "product") {
        const p = productById.get(s.ref);
        return p ? [p] : [];
      }
      if (s.kind === "collection") return productIndex.filter((p) => p.collection_ids.includes(s.ref));
      if (s.kind === "tag") return productIndex.filter((p) => p.tags.some((x) => x.trim() === s.ref));
      const i = s.ref.indexOf(": ");
      if (i <= 0) return [];
      const key = s.ref.slice(0, i);
      const value = s.ref.slice(i + 2);
      return productIndex.filter((p) => p.metafields?.[key] === value);
    },
    [catById, productById, productIndex],
  );

  // ── the funnel band's two-row fit (mock fitTwoRows, B50): unpicked chips
  //    go behind "See N more" first, picks only when they still don't fit ──
  const recsRef = useRef<HTMLDivElement>(null);
  const fit = useRowFit(recsRef, {
    mode: "two",
    deps: [
      open,
      onboarding,
      draftKey,
      recommendations.map((c) => `${c.id}:${c.name}:${covered(c.id) ? 1 : 0}`).join("|"),
      sel.map((s) => s.key).join("|"),
    ],
  });

  if (!open || typeof document === "undefined") return null;

  const verbs = stylesVerbs(style);
  const hint = draft.was ? W.onlyInFilter(VERBS[draft.was].name) : verbHint(draft.verb, style);
  const pressedVerb: RuleVerb = draft.verb;

  // ── the funnel band ("Your recommendations") ─────────────────────────────
  const funnelBand = () => {
    const { needs, done } = splitRecommendationGroups(recommendations, covered);
    const recIdSet = new Set(recIds);
    // Targets outside this quiz's list (a shop-global row, a deleted one)
    // render as picked chips with the others: no part of the rule is hidden.
    const others = sel.filter((s) => !(s.kind === "set" && recIdSet.has(s.ref)));
    const total = recommendations.length;
    const coveredN = done.length;
    const chipTitle = (id: string) => {
      const c = coverage.get(id);
      if (c?.rulesShowing.length) return W.chipRules(c.rulesShowing.length);
      if (c?.mapped) return W.chipMapped;
      return W.chipNeeds;
    };
    const rowHint = (id: string) => {
      const c = coverage.get(id);
      return c?.rulesShowing.length ? W.rowHasRule : c?.mapped ? W.rowMapped : W.rowNeeds;
    };
    const chip = (c: BuilderCategory) => {
      const r = setRow(c);
      const on = selKeys.has(r.key);
      return (
        <RecChip
          key={r.key}
          id={r.key}
          name={c.name}
          count={c.productIds.length}
          on={on}
          done={covered(c.id)}
          hidden={fit.hidden.has(r.key)}
          title={chipTitle(c.id)}
          products={resolveResource(r)}
          onToggle={() => toggleRec(r)}
        />
      );
    };
    const q = recQuery.trim().toLowerCase();
    const moreList = [...needs, ...done].filter((c) => !q || c.name.toLowerCase().includes(q));
    const pickedCount = sel.length;
    return (
      <div className="qz-lg-mband">
        <div className="qz-lg-mband-in">
          <div className="qz-lg-mband-h">
            <span className="qz-lg-tray-lb">{YOUR_RECOMMENDATIONS}</span>
            {total > 0 ? (
              <span className={`qz-lg-frac${coveredN === total ? " is-all" : ""}`}>
                <b>
                  {coveredN}/{total}
                </b>{" "}
                {W.frac[style]}
              </span>
            ) : null}
            <span className="qz-lg-msp" />
            <button
              type="button"
              className="qz-lg-addelse"
              onClick={() => {
                setRecMoreOpen(false);
                setAddRecsOpen(true);
              }}
            >
              {STRIP_COPY.addRecommendations}
            </button>
          </div>
          {total > 0 || others.length > 0 ? (
            <div className="qz-lg-mrecs" ref={recsRef}>
              {needs.map(chip)}
              {done.map(chip)}
              {others.map((s) => {
                const cat = s.kind === "set" ? catById.get(s.ref) : undefined;
                const missing = s.kind === "set" && !cat;
                return (
                  <RecChip
                    key={s.key}
                    id={s.key}
                    name={missing ? W.deletedRecommendation : cat?.name ?? s.name}
                    count={cat ? cat.productIds.length : s.count}
                    on
                    missing={missing}
                    done={cat ? covered(cat.id) : false}
                    hidden={fit.hidden.has(s.key)}
                    title={missing ? W.removeDeleted : chipTitle(s.ref)}
                    products={resolveResource(s)}
                    onToggle={() => toggleRec(s)}
                  />
                );
              })}
              <QzPopover
                open={recMoreOpen}
                onOpenChange={setRecMoreOpen}
                width={340}
                maxWidth={340}
                manageFocus
                closeOnAnchorHidden
                ariaLabel={STRIP_COPY.all(total)}
                className="qz-lg-pop"
                trigger={
                  <button type="button" className="qz-lg-rc is-more" data-fit-more hidden={!fit.showMore}>
                    {fit.moreLabel}
                  </button>
                }
                content={
                  <>
                    <div className="qz-lg-pt">{STRIP_COPY.all(total)}</div>
                    <div className="qz-lg-vptools">
                      <input
                        type="search"
                        className="qz-lg-vpsearch"
                        placeholder={STRIP_COPY.search}
                        aria-label={STRIP_COPY.search}
                        value={recQuery}
                        onChange={(e) => setRecQuery(e.target.value)}
                      />
                    </div>
                    <div className="qz-lg-vplist" data-qz-pop-list>
                      {moreList.length === 0 ? (
                        <div className="qz-lg-vpnone">{STRIP_COPY.nothingMatches}</div>
                      ) : (
                        moreList.map((c) => {
                          const on = selKeys.has(`set:${c.id}`);
                          return (
                            <button
                              key={c.id}
                              type="button"
                              role="checkbox"
                              aria-checked={on}
                              className={`qz-lg-mi${on ? " is-on" : ""}`}
                              onClick={() => toggleRec(setRow(c))}
                            >
                              <span className="qz-lg-ck" aria-hidden>
                                {on ? "✓" : ""}
                              </span>
                              <span className="qz-lg-mi-n">{c.name}</span>
                              <span className="qz-lg-mi-h">
                                {productsWord(c.productIds.length)} · {rowHint(c.id)}
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>
                    <div className="qz-lg-vpfoot">
                      <span>
                        {pickedCount ? (
                          <>
                            <b>{pickedCount}</b> {W.pickedFoot}
                          </>
                        ) : (
                          W.pickFoot
                        )}
                      </span>
                      <button type="button" className="qz-lg-btn is-pri" onClick={() => setRecMoreOpen(false)}>
                        {W.done}
                      </button>
                    </div>
                  </>
                }
              />
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  // ── the builder band ("What the quiz shows"; D6 parked) ─────────────────
  const builderBand = () => {
    const used = quizUsedRefs(doc, categories);
    const groupIds = new Set(recIds);
    const isGroupRow = (r: SelectedResource) => r.kind === "set" && groupIds.has(r.ref);
    const inQuiz = (r: SelectedResource): boolean => {
      if (r.kind === "set") return true;
      if (r.kind === "tag") return used.tags.has(r.ref);
      if (r.kind === "collection") return used.collections.has(r.ref);
      if (r.kind === "metafield") return used.metafields.has(r.ref);
      return used.products.has(r.ref);
    };
    const kindCounts = new Map<Kind, number>();
    for (const r of index) kindCounts.set(r.kind, (kindCounts.get(r.kind) ?? 0) + 1);
    const renderCard = (r: SelectedResource) => (
      <TargetCard
        key={r.key}
        r={r}
        on={selKeys.has(r.key)}
        ruleCount={r.kind === "set" ? coverage.get(r.ref)?.rulesShowing.length ?? 0 : 0}
        img={r.kind === "product" ? resolveResource(r)[0]?.image_url ?? null : null}
        products={resolveResource(r)}
        onToggle={() => toggleRec(r)}
      />
    );
    const kindTab = (kind: KindFilter, label: string, count?: number) => (
      <button
        key={kind}
        type="button"
        className={`qz-lm-tf${kindChip === kind ? " is-on" : ""}`}
        aria-pressed={kindChip === kind}
        onClick={() => setKindChip(kind)}
      >
        {label}
        {count !== undefined ? <span className="qz-lm-tfc">{count}</span> : null}
      </button>
    );
    const qlc = query.trim().toLowerCase();
    let grid: ReactNode;
    let line: ReactNode = null;
    if (qlc) {
      let rows = index.filter((r) => !selKeys.has(r.key));
      if (kindChip !== "all") rows = rows.filter((r) => r.kind === kindChip);
      rows = rows.filter((r) => r.name.toLowerCase().includes(qlc));
      const kinds = [...new Set(rows.map((r) => r.kind))];
      const grouped = kinds.flatMap((k) => rows.filter((r) => r.kind === k).slice(0, 12));
      const foundLine = `Found ${rows.length} across ${kinds.length} ${kinds.length === 1 ? "type" : "types"}`;
      grid =
        grouped.length === 0 && sel.length === 0 ? (
          <div className="qz-lm-tempty">Nothing matches “{query.trim()}”.</div>
        ) : (
          <div className="qz-lm-tgrid">
            {sel.map(renderCard)}
            {grouped.map(renderCard)}
          </div>
        );
      line = (
        <div className="qz-lm-more">
          {foundLine}
          {rows.length > grouped.length ? ` · +${rows.length - grouped.length} more, type to narrow` : ""}
        </div>
      );
    } else if (kindChip === "all") {
      const pool = index.filter(
        (r) => !selKeys.has(r.key) && (isGroupRow(r) || (r.kind === "tag" && used.tags.has(r.ref))),
      );
      const list = [...sel, ...pool];
      const capped = !moreOpen && list.length > ROW_CAP;
      const shown = capped ? list.slice(0, ROW_CAP) : list.slice(0, LIST_CAP);
      grid = (
        <div className="qz-lm-tgrid">
          {shown.map(renderCard)}
          {capped ? (
            <button type="button" className="qz-lm-tmore" onClick={() => setMoreOpen(true)}>
              +{list.length - ROW_CAP} from the catalogue
            </button>
          ) : null}
        </div>
      );
      if (!capped && list.length > LIST_CAP)
        line = <div className="qz-lm-more">+{list.length - LIST_CAP} more, type to narrow</div>;
    } else {
      const pool = index.filter(
        (r) => !selKeys.has(r.key) && r.kind === kindChip && (kindChip === "set" ? isGroupRow(r) : inQuiz(r)),
      );
      const meta = KIND_CHIPS.find((k) => k.kind === kindChip)!;
      const total = kindCounts.get(kindChip) ?? 0;
      grid =
        sel.length === 0 && pool.length === 0 ? (
          <div className="qz-lm-tempty">Nothing of this kind is in the quiz yet. Search the catalogue to add one.</div>
        ) : (
          <div className="qz-lm-tgrid">
            {sel.map(renderCard)}
            {(kindChip === "set" ? pool : pool.slice(0, LIST_CAP)).map(renderCard)}
          </div>
        );
      line = (
        <div className="qz-lm-tgroup">
          {kindChip === "set"
            ? `Recommendations · all ${recommendations.length} this quiz recommends`
            : `${meta.label} · ${pool.length} in this quiz of ${total.toLocaleString()}, search to reach the rest`}
        </div>
      );
    }
    return (
      <div className="qz-lg-mband is-builder">
        <section className="qz-lm-showband">
          <div className="qz-lm-showhead">
            <span className="qz-lm-st">What the quiz shows</span>
            <span className="qz-lm-tfilt">
              {kindTab("all", "All")}
              {KIND_CHIPS.map(({ kind, label }) => kindTab(kind, label, kindCounts.get(kind) ?? 0))}
            </span>
            <input
              className="qz-lm-tsearch"
              placeholder="Search products, sets, tags…"
              aria-label="Search what the rule acts on"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {line}
          {grid}
        </section>
      </div>
    );
  };

  // ── question rows ─────────────────────────────────────────────────────────
  const liveIds = new Set(questions.map((q) => q.node.id));
  const deletedQs = Object.keys(draft.seeded).filter((qid) => !liveIds.has(qid) && (draft.picks[qid] ?? []).length > 0);

  const questionRow = (q: OrderedQuestion) => {
    const qid = q.node.id;
    const aids = draft.picks[qid] ?? [];
    const multi = q.node.data.question_type === "multi_select";
    const isNot = Boolean(draft.not[qid]);
    const isAll = multi && Boolean(draft.all[qid]);
    const text = q.node.data.text.replace(/\?\s*$/, "");
    const tag = questionTypeTag(q.node);
    const answerIds = new Set(q.node.data.answers.map((a) => a.id));
    const missing = aids.filter((id) => !answerIds.has(id));
    const rowRule: Pick<DecisionRule, "conditions" | "any_of"> = {
      conditions: draftRule.conditions.filter((c) => c.question_id === qid),
      any_of: (draftRule.any_of ?? []).filter((x) => x === qid),
    };
    const over = !isNot ? impossibleAllOf(rowRule, doc) : null;
    const rowClass = ["qz-lg-mrow", aids.length ? "is-live" : "", isNot ? "is-not" : ""].filter(Boolean).join(" ");
    return (
      <div key={qid} className={rowClass} data-q={qid}>
        <div className="qz-lg-mqn">Q{q.qIndex}</div>
        <div className="qz-lg-mqt">
          {text}
          {tag ? <span className="qz-lg-mtag">{tag}</span> : null}
        </div>
        <div className="qz-lg-mop">
          <button
            type="button"
            className={`qz-lg-opb${isNot ? " is-not" : ""}`}
            aria-pressed={isNot}
            title={isNot ? W.isNotTip : W.isTip}
            onClick={() => setDraft((d) => toggleDraftNot(d, qid))}
          >
            {isNot ? "is not" : "is"}
          </button>
          {aids.length > 1 ? (
            isNot ? (
              // D12: hidden, not dimmed; it keeps its slot so nothing reflows.
              <span className="qz-lg-opb is-sub is-gone" aria-hidden>
                any of
              </span>
            ) : multi ? (
              <button
                type="button"
                className="qz-lg-opb is-sub"
                aria-pressed={isAll}
                title={W.joinTip}
                onClick={() => setDraft((d) => toggleDraftAll(d, qid))}
              >
                {isAll ? "all of" : "any of"} ⇄
              </button>
            ) : (
              <span className="qz-lg-opb is-sub is-fixed" title={W.fixedJoinTip}>
                any of
              </span>
            )
          ) : null}
        </div>
        <div className="qz-lg-manswrap">
          <div className="qz-lg-mans" onScroll={markMore}>
            {q.node.data.answers.map((a, i) => {
              const on = aids.includes(a.id);
              const pt = isScalePoint(q.node, i);
              const end = scaleEndLabel(q.node, i);
              return (
                <button
                  key={a.id}
                  type="button"
                  className={`qz-lg-bk${pt ? " is-pt" : ""}${on ? " is-on" : ""}`}
                  aria-pressed={on}
                  title={a.text}
                  onClick={() => setDraft((d) => toggleDraftAnswer(d, qid, a.id))}
                >
                  {pt ? (
                    <>
                      <span className="qz-lg-ptn">{i + 1}</span>
                      {end ? <span className="qz-lg-ptl">{end}</span> : null}
                    </>
                  ) : (
                    <>
                      <span className="qz-lg-bkt">{a.text}</span>
                      {end ? <span className="qz-lg-ptl">{end}</span> : null}
                    </>
                  )}
                </button>
              );
            })}
            {missing.map((id) => (
              <button
                key={id}
                type="button"
                className="qz-lg-bk is-on is-missing"
                aria-pressed
                title={W.removeDeleted}
                onClick={() => setDraft((d) => toggleDraftAnswer(d, qid, id))}
              >
                <span className="qz-lg-bkt">{W.deletedAnswer}</span>
              </button>
            ))}
          </div>
        </div>
        {over ? <div className="qz-lg-mwarn">{W.impossible(over.canPick, over.needs)}</div> : null}
      </div>
    );
  };

  const deletedRow = (qid: string) => (
    <div key={qid} className="qz-lg-mrow is-live is-gone" data-q={qid}>
      <div className="qz-lg-mqn">Q?</div>
      <div className="qz-lg-mqt">{W.deletedQuestion}</div>
      <div className="qz-lg-mop">
        <span className="qz-lg-opb is-fixed">{draft.not[qid] ? "is not" : "is"}</span>
      </div>
      <div className="qz-lg-manswrap">
        <div className="qz-lg-mans" onScroll={markMore}>
          {(draft.picks[qid] ?? []).map((id) => (
            <button
              key={id}
              type="button"
              className="qz-lg-bk is-on is-missing"
              aria-pressed
              title={W.removeDeleted}
              onClick={() => setDraft((d) => removeDraftQuestion(d, qid))}
            >
              <span className="qz-lg-bkt">{W.deletedAnswer}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  const note = draft.matchAny ? W.matchAnyNote : editing && draft.legacyReplace && draft.verb === "show" && !draft.was ? W.legacyNote : null;
  const label = editing ? W.editLabel : W.createLabel;
  const submitDisabled = !canSubmit;

  return createPortal(
    // The scrim deliberately does NOT close (draft-safe); Esc is a
    // document-level listener above.
    <div ref={scrimRef} className="qz-modal-scrim qz-lg-mscrim">
      <div
        ref={boxRef}
        className={`qz-lg-mbox${onboarding ? "" : " is-builder"}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        data-testid="rule-window"
        data-rule-id={boundId ?? undefined}
      >
        <div className="qz-lg-mscroll" key={draftKey}>
          <div className="qz-lg-mthen">
            <span className="qz-lg-mlab" id="qz-lg-mverblab">
              {W.whatHappens}
            </span>
            <span className="qz-lg-vseg" role="group" aria-labelledby="qz-lg-mverblab">
              {verbs.map((v) => (
                <button
                  key={v}
                  ref={v === pressedVerb ? verbRef : undefined}
                  type="button"
                  aria-pressed={pressedVerb === v}
                  onClick={() => setDraft((d) => ({ ...d, verb: v, was: null }))}
                >
                  {VERBS[v].name}
                </button>
              ))}
            </span>
            <span className="qz-lg-vhint">{hint}</span>
            <span className="qz-lg-msp" />
            {editing ? (
              <>
                <button
                  type="button"
                  className="qz-lg-mdel is-dup"
                  title={W.duplicateTip}
                  disabled={!canSubmit}
                  onClick={duplicate}
                >
                  {COPY_ICON}
                  {W.duplicate}
                </button>
                <button type="button" className="qz-lg-mdel" onClick={deleteBound}>
                  {TRASH_ICON}
                  {W.deleteRule}
                </button>
              </>
            ) : null}
            <button type="button" className="qz-lg-mx" aria-label={W.close} onClick={closeWindow}>
              ×
            </button>
            {note ? <p className="qz-lg-mnote">{note}</p> : null}
          </div>

          {onboarding ? funnelBand() : builderBand()}

          <div className="qz-lg-mq">
            <div className="qz-lg-mqlab">{W.whenTheyAnswer}</div>
            {questions.map(questionRow)}
            {deletedQs.map(deletedRow)}
          </div>
        </div>

        <div className="qz-lg-mfoot">
          <span className="qz-lg-msay" aria-live="polite">
            <RuleSentence tokens={tokens} catById={sentenceCats} />
          </span>
          <button type="button" className="qz-lg-btn" onClick={closeWindow}>
            {W.cancel}
          </button>
          <button
            type="button"
            className="qz-lg-btn"
            disabled={submitDisabled}
            aria-disabled={busy || undefined}
            onClick={() => void save(true)}
          >
            {editing ? W.saveAnother : W.createAnother}
          </button>
          <button
            type="button"
            className="qz-lg-btn is-pri"
            disabled={submitDisabled}
            aria-disabled={busy || undefined}
            onClick={() => void save(false)}
          >
            {busy ? W.saving : editing ? W.save : W.create}
          </button>
        </div>
      </div>
      {addRecsOpen ? (
        <AddRecommendationsDialog
          open
          quizId={quizId}
          {...(catalog ? { catalog } : {})}
          categories={categories}
          productIndex={productIndex}
          forRule
          onCategoriesCreated={onCategoriesCreated}
          onAdded={(cats) =>
            setSel((prev) => {
              const have = new Set(prev.map((s) => s.key));
              return [...prev, ...cats.map(setRow).filter((r) => !have.has(r.key))];
            })
          }
          onClose={() => setAddRecsOpen(false)}
        />
      ) : null}

    </div>,
    document.body,
  );
}

/** One recommendation chip (mock .rc): checkbox, name, product count, status
 *  dot. The chip's toggle and the count's peek are two sibling buttons
 *  (never nested), so both stay reachable (D19). */
function RecChip({
  id,
  name,
  count,
  on,
  done,
  missing = false,
  hidden,
  title,
  products,
  onToggle,
}: {
  id: string;
  name: string;
  count: number;
  on: boolean;
  done: boolean;
  missing?: boolean;
  hidden: boolean;
  title: string;
  products: readonly IndexedProduct[];
  onToggle: () => void;
}) {
  const chipRef = useRef<HTMLSpanElement>(null);
  return (
    <span
      ref={chipRef}
      className={`qz-lg-rc${on ? " is-on" : ""}${missing ? " is-missing" : ""}`}
      data-fit-id={id}
      data-fit-picked={on ? "" : undefined}
      hidden={hidden}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        onToggle();
      }}
    >
      <button type="button" className="qz-lg-rc-t" aria-pressed={on} title={title} onClick={onToggle}>
        <span className="qz-lg-ck" aria-hidden>
          {on ? "✓" : ""}
        </span>
        <span className="qz-lg-rc-n">{name}</span>
      </button>
      {missing ? null : (
        <QzPopover
          placement="bottom"
          maxWidth={260}
          anchorRef={chipRef}
          trigger={
            <button
              type="button"
              className="qz-lg-rc-c"
              title={deliverableCopy(count, count)}
              aria-label={W.peekLabel(deliverableCopy(count, count), name)}
            >
              {count}
            </button>
          }
          content={<ProductPeek name={name} products={products} />}
        />
      )}
      <span className={`qz-lg-st${done ? " is-done" : ""}`} aria-hidden />
    </span>
  );
}
