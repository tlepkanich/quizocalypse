import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Quiz } from "../../../lib/quizSchema";
import type { BuilderCategory, BuilderCollection } from "../../builder/stepProps";
import type { IndexedProduct } from "../../../lib/recommendationEngine";
import type { OrderedQuestion } from "../../../lib/questionOrder";
import { createDecisionRule, updateDecisionRule } from "../../../lib/quizMutations";
import { QzPopover, useFocusTrap } from "../../qz-overlays";
import { useQzToast } from "../../qz-toast";

// ════════════════════════════════════════════════════════════════════════════
// Logic tab (HANDOFF §4) + logic-step handoff §3/§4/§12 — the rule builder.
// Three columns: WHEN THEY ANSWER · THEN · WHAT IT ACTS ON.
//
// Logic-step rework (supersedes DECISIONS G2a/G3/G4 where they conflict):
// - Verbs per §4: Show → action "show" · Pin → "prioritize" · Hide → "hide".
//   The legacy REPLACE rule (action absent) is parsed forever but never
//   written by new UI; editing one keeps it absent unless the verb changes.
// - §3 operators, one control per scope: picking several answers of ONE
//   question is "any of" by default (or between the chips; all of is a
//   per-question toggle, meaningful on multi-select); an is / is not toggle
//   per question column; ONE and ⇄ or join across questions per rule.
// - §12 — Edit opens this same modal pre-filled against the existing rule
//   id (same storage, no second code path). Duplicate lives on the ledger.
// - The tray is multi-target (G1, `target_ids`); raw tag/collection/product
//   picks are materialized as Category rows via /api/categories/ensure-targets
//   at Create time (a rule target must be a Category id — publish blocks on
//   missing rows).
// - Esc closes; clicking the scrim must NOT discard the draft (§4.5) — which
//   is why this is a bespoke shell on useFocusTrap, not QzModal.
// ════════════════════════════════════════════════════════════════════════════

type QuizDoc = Quiz;
type DecisionRuleT = NonNullable<Quiz["decision_rules"]>[number];

type Verb = "show" | "pin" | "hide";

interface SelectedResource {
  key: string;
  kind: "set" | "tag" | "collection" | "product" | "metafield";
  ref: string;
  name: string;
  count: number;
}

const KIND_LABEL: Record<SelectedResource["kind"], string> = {
  set: "Set",
  tag: "Tag",
  collection: "Coll",
  metafield: "Meta",
  product: "Prod",
};

// §4.3 — a resource row: [KIND] Name [N products ▾] ✓. The count is its OWN
// button opening a product-list popover; it must NOT toggle selection.
// Clicking anywhere else on the row toggles.
function ResourceRow({
  r,
  on,
  onToggle,
  resolveResource,
}: {
  r: SelectedResource;
  on: boolean;
  onToggle: () => void;
  resolveResource: (s: SelectedResource) => IndexedProduct[];
}) {
  const [listOpen, setListOpen] = useState(false);
  return (
    <span className={`qz-crm-res${on ? " is-on" : ""}`}>
      <button type="button" className="qz-crm-resmain" onClick={onToggle}>
        <span className={`qz-crm-kind is-${r.kind}`}>{KIND_LABEL[r.kind]}</span>
        <span className="qz-crm-resname">{r.name}</span>
      </button>
      <QzPopover
        open={listOpen}
        onOpenChange={setListOpen}
        maxWidth={300}
        trigger={
          <button type="button" className="qz-crm-rescount" aria-label={`${r.count} products in ${r.name}`}>
            {r.count} {r.count === 1 ? "product" : "products"}
          </button>
        }
        content={
          <div className="qz-ltab-menu">
            <div className="qz-ltab-menu-title">
              {r.name} — {r.count} {r.count === 1 ? "product" : "products"}
            </div>
            <div className="qz-ltab-menu-products">
              {resolveResource(r)
                .slice(0, 24)
                .map((p) => (
                  <div key={p.product_id} className="qz-ltab-menu-product">
                    {p.image_url ? (
                      <img src={p.image_url} alt="" width={22} height={22} loading="lazy" />
                    ) : (
                      <span className="qz-ltab-menu-swatch" aria-hidden />
                    )}
                    <span>{p.title}</span>
                  </div>
                ))}
              {r.count > 24 ? (
                <div className="qz-ltab-menu-none">+{r.count - 24} more</div>
              ) : null}
            </div>
          </div>
        }
      />
      <span className="qz-crm-rescheck" aria-hidden>
        {on ? "✓" : ""}
      </span>
    </span>
  );
}

// Logic-step §4 — the verb map: Show → "show", Pin → "prioritize" (rename
// only), Hide → "hide". Absent action (legacy replace) is never offered.
const VERBS: Array<{ verb: Verb; name: string; hint: string }> = [
  { verb: "show", name: "Show", hint: "these become the results" },
  { verb: "pin", name: "Pin", hint: "these move to the top" },
  { verb: "hide", name: "Hide", hint: "these never show" },
];
const VERB_TO_ACTION: Record<Verb, "show" | "prioritize" | "hide"> = {
  show: "show",
  pin: "prioritize",
  hide: "hide",
};
const ACTION_TO_VERB: Record<"show" | "prioritize" | "hide", Verb> = {
  show: "show",
  prioritize: "pin",
  hide: "hide",
};

export function CreateRuleModal({
  doc,
  questions,
  categories,
  collections,
  productIndex,
  quizId,
  open,
  editRule,
  onClose,
  commit,
  onCategoriesCreated,
  getLatestDoc,
}: {
  doc: QuizDoc;
  questions: OrderedQuestion[];
  categories: BuilderCategory[];
  collections: BuilderCollection[];
  productIndex: IndexedProduct[];
  quizId: string;
  open: boolean;
  /** Logic-step §12 — non-null puts the modal in EDIT mode, pre-filled from
   *  this rule; saving patches it in place (updateDecisionRule). */
  editRule?: DecisionRuleT | null;
  onClose: () => void;
  commit: (doc: QuizDoc) => void;
  onCategoriesCreated: (cats: BuilderCategory[]) => void;
  /** Latest-doc seam: commit builds on the CURRENT doc, not the render-time
   *  snapshot captured before the ensure-targets await (review L2-5). */
  getLatestDoc?: () => QuizDoc;
}) {
  const toast = useQzToast();
  const boxRef = useRef<HTMLDivElement>(null);
  useFocusTrap(boxRef, open);

  // §4.5 — Esc closes from anywhere. A scrim onKeyDown dies once focus lands
  // on a non-focusable region (keydown targets <body>, an ancestor of the
  // scrim, so it never bubbles here) — document-level listener instead
  // (review L2-4).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const [picks, setPicks] = useState<Record<string, string[]>>({});
  const [verb, setVerb] = useState<Verb>("hide"); // §4.2 blank-draft default
  const [sel, setSel] = useState<SelectedResource[]>([]);
  const [query, setQuery] = useState("");
  const [kindChip, setKindChip] = useState<
    "all" | "set" | "tag" | "collection" | "metafield" | "product"
  >("all");
  const [busy, setBusy] = useState(false);
  // Logic-step §3 — the per-scope operator state, one control each:
  //   notCols[qid]  — the column's is / is not toggle (is_not = none of).
  //   allCols[qid]  — the column's all-of toggle (default any-of; only
  //                   meaningful on multi-select, forced any on single).
  //   matchMode     — THE one cross-question join (and ⇄ or).
  const [notCols, setNotCols] = useState<Record<string, boolean>>({});
  const [allCols, setAllCols] = useState<Record<string, boolean>>({});
  const [matchMode, setMatchMode] = useState<"all" | "any">("all");
  // §12 — editing a LEGACY replace rule (action absent) keeps it absent
  // unless the merchant actively changes the verb.
  const [legacyReplace, setLegacyReplace] = useState(false);

  // §12 — seed the draft from the rule under edit each time the modal opens.
  const editId = editRule?.id ?? null;
  useEffect(() => {
    if (!open) return;
    if (!editRule) {
      setPicks({});
      setVerb("hide");
      setSel([]);
      setNotCols({});
      setAllCols({});
      setMatchMode("all");
      setLegacyReplace(false);
      return;
    }
    const seededPicks: Record<string, string[]> = {};
    const seededNot: Record<string, boolean> = {};
    const isCount: Record<string, number> = {};
    for (const c of editRule.conditions) {
      (seededPicks[c.question_id] ??= []).push(c.answer_id);
      if (c.op === "is_not") seededNot[c.question_id] = true;
      else isCount[c.question_id] = (isCount[c.question_id] ?? 0) + 1;
    }
    const anyOf = new Set(editRule.any_of ?? []);
    const seededAll: Record<string, boolean> = {};
    for (const [qid, n] of Object.entries(isCount)) {
      // Stored absence of any_of on a multi-pick is-column = all-of (§3).
      if (n > 1 && !anyOf.has(qid)) seededAll[qid] = true;
    }
    setPicks(seededPicks);
    setNotCols(seededNot);
    setAllCols(seededAll);
    setMatchMode(editRule.match === "any" ? "any" : "all");
    setVerb(editRule.action ? ACTION_TO_VERB[editRule.action] : "show");
    setLegacyReplace(!editRule.action);
    const targetIds = editRule.target_ids?.length
      ? editRule.target_ids
      : [editRule.target_id];
    setSel(
      targetIds.flatMap((tid) => {
        const cat = categories.find((c) => c.id === tid);
        return cat
          ? [
              {
                key: `set:${cat.id}`,
                kind: "set" as const,
                ref: cat.id,
                name: cat.name,
                count: cat.productIds.length,
              },
            ]
          : [];
      }),
    );
    // categories is a lookup only — reseeding on its refresh would clobber
    // in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editId]);
  // §4.5/G10 — the impact line, computed server-side (pathEnumeration, cap
  // 2 000 with truncated → "(sampled)"). Debounced; errors just hide the line.
  const [impact, setImpact] = useState<
    | null
    | { loading: true }
    | { notEstimable: true }
    | { fires: number; total: number; truncated: boolean }
  >(null);

  // ── §3 — the ONE derivation of the draft's stored shape ───────────────────
  // conditions (per-column op), any_of (an is-column with several picks left
  // on "any of"; single-select is FORCED any — two ANDed is on a single-
  // select can match nobody), match ("any" only when >1 question is used).
  const multiById = useMemo(
    () =>
      new Map(
        questions.map((q) => [q.node.id, q.node.data.question_type === "multi_select"]),
      ),
    [questions],
  );
  const draft = useMemo(() => {
    const conditions: DecisionRuleT["conditions"] = [];
    const any_of: string[] = [];
    let usedQuestions = 0;
    for (const q of questions) {
      const qid = q.node.id;
      const aids = picks[qid] ?? [];
      if (aids.length === 0) continue;
      usedQuestions++;
      const op = notCols[qid] ? ("is_not" as const) : ("is" as const);
      for (const aid of aids) conditions.push({ question_id: qid, answer_id: aid, op });
      if (op === "is" && aids.length > 1) {
        const forcedAny = !multiById.get(qid);
        if (forcedAny || !allCols[qid]) any_of.push(qid);
      }
    }
    const match = matchMode === "any" && usedQuestions > 1 ? ("any" as const) : undefined;
    return { conditions, any_of, match, usedQuestions };
  }, [questions, picks, notCols, allCols, matchMode, multiById]);

  const conditionsKey = JSON.stringify([picks, notCols, allCols, matchMode]);
  useEffect(() => {
    if (!open) return;
    const { conditions, any_of, match } = draft;
    if (conditions.length === 0) {
      setImpact(null);
      return;
    }
    let alive = true;
    setImpact({ loading: true });
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/quizzes/rule-impact", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            quizId,
            conditions,
            ...(match ? { match } : {}),
            ...(any_of.length ? { any_of } : {}),
          }),
        });
        const j = (await res.json()) as
          | { ok: true; notEstimable?: boolean; fires?: number; total?: number; truncated?: boolean }
          | { ok: false };
        if (!alive) return;
        if (!j.ok) setImpact(null);
        else if (j.notEstimable) setImpact({ notEstimable: true });
        else if (typeof j.fires === "number" && typeof j.total === "number")
          setImpact({ fires: j.fires, total: j.total, truncated: Boolean(j.truncated) });
        else setImpact(null);
      } catch {
        if (alive) setImpact(null);
      }
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // conditionsKey stringifies picks — the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conditionsKey, open, quizId]);

  // ── the one resource index (§4.3) ─────────────────────────────────────────
  const index = useMemo(() => {
    const colCounts = new Map<string, number>();
    const tagCounts = new Map<string, { name: string; count: number }>();
    const mfCounts = new Map<string, { name: string; count: number }>();
    for (const p of productIndex) {
      for (const c of p.collection_ids) colCounts.set(c, (colCounts.get(c) ?? 0) + 1);
      for (const t of p.tags) {
        // EXACT-case keying: resolveMembership matches tags exact-case, so a
        // case-folded merge would show a count the materialized category
        // can't deliver (review L2-6). Distinct casings stay distinct rows.
        const k = t.trim();
        if (!k) continue;
        const e = tagCounts.get(k);
        if (e) e.count++;
        else tagCounts.set(k, { name: k, count: 1 });
      }
      for (const [k, v] of Object.entries(p.metafields ?? {})) {
        // Metafield VALUES, keyed by the membership convention "key: value"
        // (resolveMembership matches metafieldValuesOf output exact).
        // Internal ranking keys + structured JSON values are not pickable.
        if (k.startsWith("__") || !v || v.trim().startsWith("{")) continue;
        const ref = `${k}: ${v}`;
        const e = mfCounts.get(ref);
        if (e) e.count++;
        else mfCounts.set(ref, { name: `${k.split(".").pop()}: ${v}`, count: 1 });
      }
    }
    const rows: SelectedResource[] = [
      ...categories.map((c) => ({
        key: `set:${c.id}`,
        kind: "set" as const,
        ref: c.id,
        name: c.name,
        count: c.productIds.length,
      })),
      ...[...tagCounts.entries()].map(([k, e]) => ({
        key: `tag:${k}`,
        kind: "tag" as const,
        ref: e.name,
        name: e.name,
        count: e.count,
      })),
      ...collections.map((c) => ({
        key: `collection:${c.collectionId}`,
        kind: "collection" as const,
        ref: c.collectionId,
        name: c.title,
        count: colCounts.get(c.collectionId) ?? 0,
      })),
      ...[...mfCounts.entries()].map(([ref, e]) => ({
        key: `metafield:${ref}`,
        kind: "metafield" as const,
        ref,
        name: e.name,
        count: e.count,
      })),
      ...productIndex.map((p) => ({
        key: `product:${p.product_id}`,
        kind: "product" as const,
        ref: p.product_id,
        name: p.title,
        count: 1,
      })),
    ];
    return rows;
  }, [categories, collections, productIndex]);

  // §4.3 nothing-typed + All: the curated sets PLUS the tags the quiz
  // already uses (filter answers' stored tags).
  const quizTagRefs = useMemo(() => {
    const used = new Set<string>();
    for (const n of doc.nodes) {
      if (n.type !== "question") continue;
      for (const a of n.data.answers) for (const t of a.tags) used.add(t.trim());
    }
    return used;
  }, [doc]);

  const qlc = query.trim().toLowerCase();
  const { shown, overflow, foundLine } = useMemo(() => {
    let rows = index;
    if (kindChip !== "all") rows = rows.filter((r) => r.kind === kindChip);
    if (qlc) {
      rows = rows.filter((r) => r.name.toLowerCase().includes(qlc));
      // §4.3 typed → one group per kind, 12 rows each, with the found-line.
      const kinds = [...new Set(rows.map((r) => r.kind))];
      const grouped = kinds.flatMap((k) => rows.filter((r) => r.kind === k).slice(0, 12));
      return {
        shown: grouped,
        overflow: rows.length - grouped.length,
        foundLine: `Found ${rows.length} across ${kinds.length} ${kinds.length === 1 ? "type" : "types"}`,
      };
    }
    if (kindChip === "all") {
      const dflt = index.filter(
        (r) => r.kind === "set" || (r.kind === "tag" && quizTagRefs.has(r.ref)),
      );
      return { shown: dflt.slice(0, 40), overflow: Math.max(0, dflt.length - 40), foundLine: null };
    }
    return { shown: rows.slice(0, 40), overflow: Math.max(0, rows.length - 40), foundLine: null };
  }, [index, kindChip, qlc, quizTagRefs]);

  const pickedCount = Object.values(picks).reduce((n, a) => n + a.length, 0);
  // ONE resolver for both the tray total and each row's product popover —
  // they can never disagree. Exact-case matching throughout (mirrors
  // resolveMembership; review L2-6).
  const resolveResource = useMemo(() => {
    const byId = new Map(productIndex.map((p) => [p.product_id, p]));
    const catById = new Map(categories.map((c) => [c.id, c]));
    return (s: SelectedResource): IndexedProduct[] => {
      if (s.kind === "set")
        return (catById.get(s.ref)?.productIds ?? [])
          .map((id) => byId.get(id))
          .filter((p): p is IndexedProduct => p !== undefined);
      if (s.kind === "product") {
        const p = byId.get(s.ref);
        return p ? [p] : [];
      }
      if (s.kind === "collection")
        return productIndex.filter((p) => p.collection_ids.includes(s.ref));
      if (s.kind === "tag")
        return productIndex.filter((p) => p.tags.some((x) => x.trim() === s.ref));
      // metafield — ref is the membership "key: value" convention.
      const i = s.ref.indexOf(": ");
      if (i <= 0) return [];
      const key = s.ref.slice(0, i);
      const value = s.ref.slice(i + 2);
      return productIndex.filter((p) => p.metafields?.[key] === value);
    };
  }, [categories, productIndex]);

  const selProducts = useMemo(() => {
    const ids = new Set<string>();
    for (const s of sel) for (const p of resolveResource(s)) ids.add(p.product_id);
    return ids.size;
  }, [sel, resolveResource]);

  // §3 — several chips on ONE question is now expressible (any-of / all-of),
  // so every question type ACCUMULATES; single-select columns are forced
  // any-of at derivation time (G3's replace behavior is retired).
  const toggleAnswer = (q: OrderedQuestion, answerId: string) => {
    setPicks((prev) => {
      const cur = prev[q.node.id] ?? [];
      const on = cur.includes(answerId);
      const next = on ? cur.filter((x) => x !== answerId) : [...cur, answerId];
      return { ...prev, [q.node.id]: next };
    });
  };

  const toggleResource = (r: SelectedResource) => {
    setSel((prev) =>
      prev.some((s) => s.key === r.key)
        ? prev.filter((s) => s.key !== r.key)
        : [...prev, r],
    );
  };

  const reset = () => {
    setPicks({});
    setVerb("hide");
    setSel([]);
    setQuery("");
    setKindChip("all");
    setNotCols({});
    setAllCols({});
    setMatchMode("all");
    setLegacyReplace(false);
  };

  const canCreate = pickedCount > 0 && sel.length > 0 && !busy;

  const handleCreate = async () => {
    if (!canCreate) return;
    const { conditions, any_of, match } = draft;
    setBusy(true);
    try {
      const raw = sel.filter((s) => s.kind !== "set");
      const createdByKey = new Map<string, string>();
      if (raw.length) {
        // Explicit failure surface — a network error must toast, never escape
        // as an unhandled rejection (review L1-3).
        let j: { ok: boolean; categories?: BuilderCategory[] };
        try {
          const res = await fetch("/api/categories/ensure-targets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              quizId,
              resources: raw.map((r) => ({ kind: r.kind, ref: r.ref, name: r.name })),
            }),
          });
          j = (await res.json()) as { ok: boolean; categories?: BuilderCategory[] };
        } catch {
          toast("Couldn't reach the server — the rule wasn't created");
          return;
        }
        if (!j.ok || !j.categories) {
          toast("Couldn't save those targets — try again");
          return;
        }
        onCategoriesCreated(j.categories);
        for (let i = 0; i < raw.length; i++) {
          const cat = j.categories[i];
          if (cat) createdByKey.set(raw[i]!.key, cat.id);
        }
      }
      const target_ids = sel
        .map((s) => (s.kind === "set" ? s.ref : createdByKey.get(s.key)))
        .filter((id): id is string => Boolean(id));
      // §4 — new rules always carry an action; a legacy replace rule under
      // edit keeps action ABSENT unless the merchant changed the verb.
      const keepLegacyReplace = editRule && legacyReplace && verb === "show";
      const action = keepLegacyReplace ? undefined : VERB_TO_ACTION[verb];
      // Commit against the LATEST doc, not the render-time snapshot captured
      // before the await (review L2-5).
      const base = getLatestDoc ? getLatestDoc() : doc;
      if (editRule) {
        commit(
          updateDecisionRule(base, editRule.id, {
            conditions,
            target_ids,
            action,
            match,
            any_of,
          }),
        );
        toast("✓ Rule updated");
      } else {
        commit(
          createDecisionRule(base, {
            conditions,
            target_ids,
            ...(action ? { action } : {}),
            ...(match ? { match } : {}),
            ...(any_of.length ? { any_of } : {}),
          }),
        );
        toast("✓ Rule created — checked top down, first match applies");
      }
      reset();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  if (!open || typeof document === "undefined") return null;

  const answerLabel = (qid: string, aid: string) => {
    const q = questions.find((x) => x.node.id === qid);
    return q?.node.data.answers.find((a) => a.id === aid)?.text ?? "";
  };
  const verbWord = verb;
  const modalTitle = editRule ? "Edit rule" : "Create a rule";

  return createPortal(
    // §4.5 — the scrim deliberately does NOT close (draft-safe); Esc is a
    // document-level listener above.
    <div className="qz-modal-scrim">
      <div ref={boxRef} className="qz-crm" role="dialog" aria-modal="true" aria-label={modalTitle}>
        <header className="qz-crm-hd">
          <h2>{modalTitle}</h2>
          <span className="qz-crm-hint">
            Who it applies to on the left · what happens on the right
          </span>
          <button
            type="button"
            className="qz-btn qz-btn-primary"
            disabled={!canCreate}
            onClick={handleCreate}
          >
            {busy ? "Saving…" : editRule ? "Save rule" : "Create rule"}
          </button>
        </header>
        <div className="qz-crm-cols">
          {/* ── left: WHEN THEY ANSWER ── */}
          <section className="qz-crm-col">
            <div className="qz-crm-colhd">
              When they answer
              <span className={`qz-crm-count${pickedCount ? "" : " is-zero"}`}>
                {pickedCount} picked
              </span>
            </div>
            <div className="qz-crm-scroll">
              {/* §4.1 — EVERY question is listed, Asked-only included: on a
                  rules-only quiz those are the only conditions there are. */}
              {questions.map((q) => {
                const cur = picks[q.node.id] ?? [];
                const multi = q.node.data.question_type === "multi_select";
                return (
                  <div key={q.node.id} className={`qz-crm-qblock${cur.length ? " is-used" : ""}`}>
                    <div className="qz-crm-qhead">
                      <span className="qz-crm-qnum">Q{q.qIndex}</span>
                      {/* §4.1 — the numeral is what a merchant scans by; the
                          label (20 chars) is the reminder. */}
                      <span className="qz-crm-qlabel">{q.node.data.text.slice(0, 20)}</span>
                      {multi ? <span className="qz-crm-qtag">multi-select</span> : null}
                    </div>
                    <div className="qz-crm-chips">
                      {q.node.data.answers.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          className={`qz-crm-chip${cur.includes(a.id) ? " is-on" : ""}`}
                          onClick={() => toggleAnswer(q, a.id)}
                        >
                          {a.text}
                        </button>
                      ))}
                    </div>
                    {/* §3 — the column's own operators: is / is not, and the
                        any-of / all-of footer (all-of only means something on
                        a multi-select; single-select is forced any-of). */}
                    {cur.length > 0 ? (
                      <div className="qz-crm-colops">
                        <button
                          type="button"
                          className={`qz-crm-colop${notCols[q.node.id] ? " is-not" : ""}`}
                          title={
                            notCols[q.node.id]
                              ? "Matches shoppers who picked NONE of these"
                              : "Matches shoppers who picked these"
                          }
                          onClick={() =>
                            setNotCols((prev) => ({
                              ...prev,
                              [q.node.id]: !prev[q.node.id],
                            }))
                          }
                        >
                          {notCols[q.node.id] ? "is not" : "is"} ⇄
                        </button>
                        {cur.length > 1 && !notCols[q.node.id] ? (
                          multi ? (
                            <button
                              type="button"
                              className="qz-crm-colop"
                              title="any of — one pick is enough · all of — every one must be picked"
                              onClick={() =>
                                setAllCols((prev) => ({
                                  ...prev,
                                  [q.node.id]: !prev[q.node.id],
                                }))
                              }
                            >
                              {allCols[q.node.id] ? "all of" : "any of"} {cur.length} ⇄
                            </button>
                          ) : (
                            <span className="qz-crm-colnote">any of {cur.length}</span>
                          )
                        ) : null}
                        {notCols[q.node.id] && cur.length > 1 ? (
                          <span className="qz-crm-colnote">none of {cur.length}</span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {/* §3 — ONE cross-question join per rule (the mock's and ⇆ under
                the columns): and = every question must match, or = any one. */}
            {draft.usedQuestions > 1 ? (
              <div className="qz-crm-joinbar">
                <span>Questions join with</span>
                <button
                  type="button"
                  className={`qz-crm-colop${matchMode === "any" ? " is-or" : ""}`}
                  onClick={() =>
                    setMatchMode((m) => (m === "all" ? "any" : "all"))
                  }
                >
                  {matchMode === "all" ? "and — all must match" : "or — any can match"} ⇄
                </button>
              </div>
            ) : null}
          </section>

          {/* ── middle: THEN ── */}
          <section className="qz-crm-col qz-crm-verbs">
            <div className="qz-crm-colhd">Then</div>
            {VERBS.map((v) => (
              <button
                key={v.verb}
                type="button"
                className={`qz-crm-verb${verb === v.verb ? " is-on" : ""}${
                  v.verb === "hide" ? " is-exclude" : v.verb === "pin" ? " is-pin" : " is-highlight"
                }`}
                onClick={() => setVerb(v.verb)}
              >
                <b>{v.name}</b>
                <span>{v.hint}</span>
              </button>
            ))}
            {/* §12 — an edited legacy rule that stays on Show keeps its
                original replace behavior; say so rather than hiding it. */}
            {editRule && legacyReplace && verb === "show" ? (
              <p className="qz-crm-qnote">
                This older rule replaces the results outright — saving on Show
                keeps that behavior.
              </p>
            ) : null}
          </section>

          {/* ── right: WHAT IT ACTS ON ── */}
          <section className="qz-crm-col">
            <div className="qz-crm-colhd">
              What it acts on
              <span className={`qz-crm-count${sel.length ? "" : " is-zero"}`}>
                {selProducts} products
              </span>
            </div>
            <input
              className="qz-ltab-menu-search"
              placeholder="Search…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="qz-ltab-menu-chips">
              {/* §4.3 fixed chip order (Variants DECIDED-out per G5). */}
              {(
                [
                  ["all", "All"],
                  ["tag", "Tags"],
                  ["collection", "Collections"],
                  ["metafield", "Metafields"],
                  ["product", "Products"],
                  ["set", "Sets"],
                ] as const
              ).map(([k, l]) => (
                <button
                  key={k}
                  type="button"
                  className={`qz-ltab-menu-chip${kindChip === k ? " is-on" : ""}`}
                  onClick={() => setKindChip(k)}
                >
                  {l}
                </button>
              ))}
            </div>
            <div className="qz-crm-scroll">
              {!qlc && kindChip === "all" ? (
                <div className="qz-ltab-menu-group">This quiz already recommends</div>
              ) : null}
              {foundLine ? <div className="qz-ltab-menu-none">{foundLine}</div> : null}
              {shown.length === 0 ? (
                <div className="qz-ltab-menu-none">
                  Nothing matches{query ? ` "${query}"` : ""}.
                </div>
              ) : (
                shown.map((r, i) => (
                  <span key={r.key}>
                    {/* §4.3 typed → one group header per kind. */}
                    {qlc && (i === 0 || shown[i - 1]!.kind !== r.kind) ? (
                      <div className="qz-ltab-menu-group">{KIND_LABEL[r.kind]}s</div>
                    ) : null}
                    <ResourceRow
                      r={r}
                      on={sel.some((s) => s.key === r.key)}
                      onToggle={() => toggleResource(r)}
                      resolveResource={resolveResource}
                    />
                  </span>
                ))
              )}
              {overflow > 0 ? (
                <div className="qz-ltab-menu-none">+{overflow} more — type to narrow</div>
              ) : null}
            </div>
          </section>
        </div>

        {/* ── tray (§4.4) ── */}
        {sel.length ? (
          <div className="qz-crm-tray">
            <span className="qz-crm-traylabel">Acts on</span>
            {sel.map((s) => (
              <button
                key={s.key}
                type="button"
                className="qz-crm-traychip"
                onClick={() => toggleResource(s)}
              >
                {s.name} <span aria-hidden>✕</span>
              </button>
            ))}
            <span className="qz-crm-traymeta">
              {selProducts} products
              {sel.some((s) => s.kind !== "product" && s.kind !== "set")
                ? " · updates as the catalogue changes"
                : ""}
            </span>
          </div>
        ) : null}

        {/* ── footer (§4.5): the live sentence ── */}
        <footer className="qz-crm-ft">
          <p className="qz-crm-sentence">
            When a shopper picks{" "}
            {pickedCount === 0 ? (
              <span className="qz-ltab-muted">pick answers</span>
            ) : (
              // §3 read-back — the sentence uses the rule's OWN operators:
              // within a column "or" (any-of) / "and" (all-of) / "none of"
              // (is not); between columns the one rule join.
              questions
                .filter((q) => (picks[q.node.id] ?? []).length > 0)
                .map((q, gi) => {
                  const qid = q.node.id;
                  const aids = picks[qid] ?? [];
                  const isNot = Boolean(notCols[qid]);
                  const withinWord =
                    isNot ? "nor" : allCols[qid] && multiById.get(qid) ? "and" : "or";
                  return (
                    <span key={qid}>
                      {gi > 0 ? (
                        <span className="qz-ltab-join">
                          {" "}
                          {matchMode === "any" ? "or" : "and"}{" "}
                        </span>
                      ) : null}
                      {isNot ? <span className="qz-ltab-join">not </span> : null}
                      {aids.map((aid, i) => (
                        <span key={aid}>
                          {i > 0 ? (
                            <span className="qz-ltab-join"> {withinWord} </span>
                          ) : null}
                          <b>{answerLabel(qid, aid)}</b>
                        </span>
                      ))}
                    </span>
                  );
                })
            )}
            <span className="qz-ltab-join">, </span>
            {verbWord}{" "}
            {sel.length === 0 ? (
              <span className="qz-ltab-muted">pick what it acts on</span>
            ) : (
              sel.map((s, i) => (
                <span key={s.key}>
                  {i > 0 ? <span className="qz-ltab-join"> and </span> : null}
                  <b>{s.name}</b>
                </span>
              ))
            )}
            .
            {impact ? (
              <span className="qz-crm-impact">
                {"loading" in impact
                  ? "…"
                  : "notEstimable" in impact
                    ? "Needs multi-answer shoppers — not estimable yet"
                    : impact.truncated
                      ? `≈${impact.total ? Math.round((impact.fires / impact.total) * 100) : 0}% of shoppers (sampled)`
                      : `Fires on ${impact.fires.toLocaleString()} of ${impact.total.toLocaleString()} paths`}
              </span>
            ) : null}
          </p>
          <button type="button" className="qz-btn" onClick={onClose}>
            Cancel
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
