import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Quiz } from "../../../lib/quizSchema";
import type { BuilderCategory, BuilderCollection } from "../../builder/stepProps";
import type { IndexedProduct } from "../../../lib/recommendationEngine";
import type { OrderedQuestion } from "../../../lib/questionOrder";
import { createDecisionRule, updateDecisionRule } from "../../../lib/quizMutations";
import { useFocusTrap } from "../../qz-overlays";
import { useQzToast } from "../../qz-toast";

// ════════════════════════════════════════════════════════════════════════════
// Logic tab (HANDOFF §4) + logic-step handoff §3/§4/§12 — the rule builder,
// rendered to the Live · Made By Mary artifact's three bands:
//   1 WHEN THEY ANSWER — question COLUMNS (answer chips, or/and links,
//     is / is-not), the match all ⇄ match any toggle, the "Fires on" path
//     readout, and + Qn chips for questions not yet opened as columns.
//   2 THEN — Show / Pin / Hide verb cards.
//   3 WHAT THE QUIZ SHOWS — kind-count chips + search + target tiles.
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

// Live artifact band-3 chip order: Products · Sets · Collections · Tags ·
// Metafields, each with a live count.
const KIND_CHIPS: Array<{ kind: SelectedResource["kind"]; label: string }> = [
  { kind: "product", label: "Products" },
  { kind: "set", label: "Sets" },
  { kind: "collection", label: "Collections" },
  { kind: "tag", label: "Tags" },
  { kind: "metafield", label: "Metafields" },
];

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
  // Live caption D — questions that already act on products (decides/filter)
  // open as COLUMNS; info-only ones wait below as + chips. Whatever the
  // merchant adds or drops holds for the session (until the next open).
  const [activeCols, setActiveCols] = useState<string[]>([]);
  // §12 — editing a LEGACY replace rule (action absent) keeps it absent
  // unless the merchant actively changes the verb.
  const [legacyReplace, setLegacyReplace] = useState(false);
  // Audit fix (mixed-op flattening) — the column op toggle is per QUESTION,
  // but the schema allows per-CONDITION ops on one question ("Q1 is A and
  // Q1 is_not B", built by the older inline editor). Re-deriving such a
  // column from the toggle would silently rewrite every condition to one op.
  // So: an edited column the merchant never touched keeps its ORIGINAL
  // conditions verbatim; only touched columns re-derive.
  const seededGroups = useRef<Record<string, DecisionRuleT["conditions"]>>({});
  const [dirtyCols, setDirtyCols] = useState<Set<string>>(new Set());
  const touchCol = (qid: string) =>
    setDirtyCols((prev) => {
      if (prev.has(qid)) return prev;
      const next = new Set(prev);
      next.add(qid);
      return next;
    });

  // §12 — seed the draft from the rule under edit each time the modal opens.
  const editId = editRule?.id ?? null;
  useEffect(() => {
    if (!open) return;
    seededGroups.current = {};
    setDirtyCols(new Set());
    // Live caption D — the default column set: every question whose role
    // already acts on products, in quiz order. Rules-only quizzes (no roles)
    // start with no columns — every question is a + chip.
    const defaultActive = questions
      .filter(
        (q) => q.node.data.role === "decides" || q.node.data.role === "filter",
      )
      .map((q) => q.node.id);
    if (!editRule) {
      setActiveCols(defaultActive);
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
      (seededGroups.current[c.question_id] ??= []).push({ ...c });
      if (c.op === "is_not") seededNot[c.question_id] = true;
      else isCount[c.question_id] = (isCount[c.question_id] ?? 0) + 1;
    }
    const anyOf = new Set(editRule.any_of ?? []);
    const seededAll: Record<string, boolean> = {};
    for (const [qid, n] of Object.entries(isCount)) {
      // Stored absence of any_of on a multi-pick is-column = all-of (§3).
      if (n > 1 && !anyOf.has(qid)) seededAll[qid] = true;
    }
    // EDIT — the questions the rule constrains open as columns, on top of
    // the defaults, in quiz order.
    const defaults = new Set(defaultActive);
    setActiveCols(
      questions
        .filter((q) => defaults.has(q.node.id) || seededPicks[q.node.id])
        .map((q) => q.node.id),
    );
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
      // Untouched edited column → the original conditions, byte-for-byte
      // (mixed per-condition ops survive; the toggle can't express them).
      const seeded = seededGroups.current[qid];
      if (seeded && !dirtyCols.has(qid)) {
        conditions.push(...seeded);
        const isConds = seeded.filter((c) => c.op === "is");
        if (isConds.length > 1 && (editRule?.any_of ?? []).includes(qid)) {
          any_of.push(qid);
        }
        continue;
      }
      const op = notCols[qid] ? ("is_not" as const) : ("is" as const);
      for (const aid of aids) conditions.push({ question_id: qid, answer_id: aid, op });
      if (op === "is" && aids.length > 1) {
        const forcedAny = !multiById.get(qid);
        if (forcedAny || !allCols[qid]) any_of.push(qid);
      }
    }
    const match = matchMode === "any" && usedQuestions > 1 ? ("any" as const) : undefined;
    return { conditions, any_of, match, usedQuestions };
  }, [questions, picks, notCols, allCols, matchMode, multiById, dirtyCols, editRule]);

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

  // Live band-3 chip counts, from the same index the grid reads.
  const kindCounts = useMemo(() => {
    const counts = new Map<SelectedResource["kind"], number>();
    for (const r of index) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
    return counts;
  }, [index]);

  const pickedCount = Object.values(picks).reduce((n, a) => n + a.length, 0);
  // ONE resolver for the tiles' product thumbs and anything counting a
  // selection — mirrors resolveMembership, exact-case (review L2-6).
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

  // §3 — several chips on ONE question is now expressible (any-of / all-of),
  // so every question type ACCUMULATES; single-select columns are forced
  // any-of at derivation time (G3's replace behavior is retired).
  const toggleAnswer = (q: OrderedQuestion, answerId: string) => {
    touchCol(q.node.id);
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

  // Live caption D — the × on a column header returns the question to the
  // chip row and clears its picks; a + chip opens it as a column.
  const removeCol = (qid: string) => {
    touchCol(qid);
    setActiveCols((prev) => prev.filter((x) => x !== qid));
    setPicks((prev) => {
      const next = { ...prev };
      delete next[qid];
      return next;
    });
    setNotCols((prev) => {
      const next = { ...prev };
      delete next[qid];
      return next;
    });
    setAllCols((prev) => {
      const next = { ...prev };
      delete next[qid];
      return next;
    });
  };
  const addCol = (qid: string) =>
    setActiveCols((prev) => (prev.includes(qid) ? prev : [...prev, qid]));

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

  // Live band 1 — the "Fires on" answer-path readout, pure client-side (the
  // server impact line stays in the footer). Only under match all, and only
  // once at least one enumerable column (picked, not is-not) exists. An
  // or-column contributes each picked answer; an all-of multi column ONE
  // combined path; an all-of single-select column ZERO paths (dead state);
  // an is-not column is skipped from enumeration.
  const paths = useMemo(() => {
    if (matchMode !== "all") return null;
    const sets: string[][] = [];
    for (const qid of activeCols) {
      const aids = picks[qid] ?? [];
      if (aids.length === 0 || notCols[qid]) continue;
      const q = questions.find((x) => x.node.id === qid);
      if (!q) continue;
      const texts = q.node.data.answers
        .filter((a) => aids.includes(a.id))
        .map((a) => a.text);
      if (allCols[qid]) {
        if (!multiById.get(qid)) sets.push([]);
        else sets.push([texts.join(" + ")]);
      } else {
        sets.push(texts);
      }
    }
    if (sets.length === 0) return null;
    let out: string[][] = [[]];
    for (const set of sets) {
      const next: string[][] = [];
      for (const acc of out) for (const t of set) next.push([...acc, t]);
      out = next;
      if (out.length === 0) break;
    }
    return out.map((p) => p.join(" + "));
  }, [matchMode, activeCols, picks, notCols, allCols, questions, multiById]);

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
  const columns = activeCols
    .map((qid) => questions.find((q) => q.node.id === qid))
    .filter((q): q is OrderedQuestion => q !== undefined);
  const unused = questions.filter((q) => !activeCols.includes(q.node.id));

  return createPortal(
    // §4.5 — the scrim deliberately does NOT close (draft-safe); Esc is a
    // document-level listener above.
    <div className="qz-modal-scrim">
      <div
        ref={boxRef}
        className="qz-lm qz-lm-builder"
        role="dialog"
        aria-modal="true"
        aria-label={modalTitle}
      >
        <header className="qz-lm-h">
          <h2>{modalTitle}</h2>
          <button type="button" className="qz-lm-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="qz-lm-b">
          <div className="qz-lm-bands">
            {/* ── band 1: WHEN THEY ANSWER ── */}
            <section className="qz-lm-band">
              <div className="qz-lm-bh">
                <span className="qz-lm-bn">1</span>
                <span className="qz-lm-bt">When they answer</span>
                {activeCols.length > 1 ? (
                  <span className="qz-lm-right">
                    {/* §3 — THE one cross-question join, stated once. */}
                    <span className="qz-lm-seg">
                      <button
                        type="button"
                        aria-pressed={matchMode === "all"}
                        onClick={() => setMatchMode("all")}
                      >
                        match all
                      </button>
                      <button
                        type="button"
                        aria-pressed={matchMode === "any"}
                        onClick={() => setMatchMode("any")}
                      >
                        match any
                      </button>
                    </span>
                  </span>
                ) : null}
              </div>
              <div className="qz-lm-condzone">
                <div className="qz-lm-condrow">
                  {columns.map((q) => {
                    const qid = q.node.id;
                    const aids = picks[qid] ?? [];
                    const multi = q.node.data.question_type === "multi_select";
                    const isNot = Boolean(notCols[qid]);
                    const isAnd = multi && Boolean(allCols[qid]);
                    // "or" renders between PICKED chips — after every picked
                    // chip except the last picked one, in display order.
                    const pickedOrder = q.node.data.answers
                      .filter((a) => aids.includes(a.id))
                      .map((a) => a.id);
                    const lastPicked = pickedOrder[pickedOrder.length - 1];
                    return (
                      <div key={qid} className={`qz-lm-qcol${aids.length ? " is-has" : ""}`}>
                        <div className="qz-lm-qch">
                          <span className="qz-lm-qlabel">
                            <span className="qz-lm-qn">Q{q.qIndex}</span>{" "}
                            {q.node.data.text.replace(/\?$/, "")}
                            {multi ? <span className="qz-lm-multibadge">multi</span> : null}
                          </span>
                          {/* Handoff §3 — the is / is-not affordance the mock
                              omits; kept deliberately, seated in the header. */}
                          <button
                            type="button"
                            className={`qz-lm-qcf${isNot ? " is-not" : ""}`}
                            title={
                              isNot
                                ? "Matches shoppers who picked NONE of these"
                                : "Matches shoppers who picked these"
                            }
                            onClick={() => {
                              touchCol(qid);
                              setNotCols((prev) => ({ ...prev, [qid]: !prev[qid] }));
                            }}
                          >
                            {isNot ? "is not" : "is"}
                          </button>
                          <button
                            type="button"
                            className="qz-lm-qdrop"
                            title="Remove — returns it to the chips below"
                            aria-label={`Remove Q${q.qIndex} from the rule`}
                            onClick={() => removeCol(qid)}
                          >
                            ×
                          </button>
                        </div>
                        <div className="qz-lm-qcb">
                          {q.node.data.answers.map((a) => {
                            const on = aids.includes(a.id);
                            const showOr =
                              pickedOrder.length > 1 && on && a.id !== lastPicked;
                            return (
                              <Fragment key={a.id}>
                                <button
                                  type="button"
                                  className={`qz-lm-qchip${on ? " is-on" : ""}`}
                                  aria-pressed={on}
                                  onClick={() => toggleAnswer(q, a.id)}
                                >
                                  {a.text}
                                </button>
                                {showOr ? (
                                  multi ? (
                                    // §3 — only a multi-select can mean "all
                                    // of"; there the or is a control.
                                    <button
                                      type="button"
                                      className={`qz-lm-orlink is-live${isAnd ? " is-and" : ""}`}
                                      title={`Click to switch to ${isAnd ? "or" : "all of"}`}
                                      onClick={() => {
                                        touchCol(qid);
                                        setAllCols((prev) => ({
                                          ...prev,
                                          [qid]: !prev[qid],
                                        }));
                                      }}
                                    >
                                      {isAnd ? "and" : "or"}
                                    </button>
                                  ) : (
                                    // Single-select: stated, not offered —
                                    // "all of" would match nobody.
                                    <span className="qz-lm-orlink">or</span>
                                  )
                                ) : null}
                              </Fragment>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {paths ? (
                  paths.length === 0 ? (
                    <div className="qz-lm-paths is-dead">
                      <span className="qz-lm-paths-l">Fires on</span>
                      <b>no answer path</b>
                      <span className="qz-lm-paths-n">
                        A shopper answers each question once, so <em>all of</em> on
                        a single-select question can never be true.
                      </span>
                    </div>
                  ) : paths.length <= 8 ? (
                    <div className="qz-lm-paths">
                      <span className="qz-lm-paths-l">Fires on</span>
                      <b>
                        {paths.length} answer {paths.length === 1 ? "path" : "paths"}
                      </b>
                      <span className="qz-lm-paths-p">
                        {paths.map((p, i) => (
                          <span key={i}>{p}</span>
                        ))}
                      </span>
                    </div>
                  ) : (
                    <div className="qz-lm-paths">
                      <span className="qz-lm-paths-l">Fires on</span>
                      <b>{paths.length} answer paths</b>
                      <span className="qz-lm-paths-n">
                        Too many to list — narrow a column to see them.
                      </span>
                    </div>
                  )
                ) : null}
              </div>
              {unused.length ? (
                <div className="qz-lm-addwrap">
                  <div className="qz-lm-addrow">
                    {unused.map((q) => (
                      <button
                        key={q.node.id}
                        type="button"
                        className="qz-lm-addcond"
                        onClick={() => addCol(q.node.id)}
                      >
                        <span className="qz-lm-acp">+</span>
                        <span className="qz-lm-acn">Q{q.qIndex}</span>{" "}
                        {q.node.data.text.replace(/\?$/, "")}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>

            {/* ── band 2: THEN ── */}
            <section className="qz-lm-band is-inline">
              <div className="qz-lm-bh">
                <span className="qz-lm-bn">2</span>
                <span className="qz-lm-bt">Then</span>
              </div>
              <div className="qz-lm-verbrow">
                {VERBS.map((v) => (
                  <button
                    key={v.verb}
                    type="button"
                    className={`qz-lm-vcard${verb === v.verb ? " is-on" : ""}`}
                    aria-pressed={verb === v.verb}
                    onClick={() => setVerb(v.verb)}
                  >
                    <span className="qz-lm-vn">{v.name}</span>
                    <span className="qz-lm-vd">{v.hint}</span>
                  </button>
                ))}
              </div>
              {/* §12 — an edited legacy rule that stays on Show keeps its
                  original replace behavior; say so rather than hiding it. */}
              {editRule && legacyReplace && verb === "show" ? (
                <p className="qz-lm-legacynote">
                  This older rule replaces the results outright — saving on Show
                  keeps that behavior.
                </p>
              ) : null}
            </section>

            {/* ── band 3: WHAT THE QUIZ SHOWS ── */}
            <section className="qz-lm-band">
              <div className="qz-lm-bh">
                <span className="qz-lm-bn">3</span>
                <span className="qz-lm-bt">What the quiz shows</span>
              </div>
              <div className="qz-lm-actbar">
                <span className="qz-lm-tfilt">
                  {KIND_CHIPS.map(({ kind, label }) => (
                    <button
                      key={kind}
                      type="button"
                      className={`qz-lm-tf${kindChip === kind ? " is-on" : ""}`}
                      aria-pressed={kindChip === kind}
                      onClick={() => setKindChip((k) => (k === kind ? "all" : kind))}
                    >
                      {label}{" "}
                      <span className="qz-lm-tfc">{kindCounts.get(kind) ?? 0}</span>
                    </button>
                  ))}
                </span>
                <input
                  className="qz-lm-actsearch"
                  placeholder="Search products, sets, tags…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              {foundLine ? <div className="qz-lm-more">{foundLine}</div> : null}
              {shown.length === 0 ? (
                <div className="qz-lm-more">
                  Nothing matches{query ? ` "${query}"` : ""}.
                </div>
              ) : (
                <div className="qz-lm-tgrid">
                  {shown.map((r) => {
                    const on = sel.some((s) => s.key === r.key);
                    const img =
                      r.kind === "product"
                        ? resolveResource(r)[0]?.image_url ?? null
                        : null;
                    return (
                      <button
                        key={r.key}
                        type="button"
                        className={`qz-lm-tcard${on ? " is-on" : ""}`}
                        aria-pressed={on}
                        onClick={() => toggleResource(r)}
                      >
                        <span
                          className={`qz-lm-pthumb${img ? " has-img" : ""}`}
                          aria-hidden
                        >
                          {img ? <img src={img} alt="" loading="lazy" /> : null}
                        </span>
                        <span className="qz-lm-tn2">{r.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {overflow > 0 ? (
                <div className="qz-lm-more">+{overflow} more — type to narrow</div>
              ) : null}
            </section>
          </div>
        </div>

        {/* ── footer: the live sentence + the actions (§4.5) ── */}
        <footer className="qz-lm-f">
          {pickedCount === 0 ? (
            <span className="qz-lm-dimf">
              Pick an answer in at least one column to start the rule
            </span>
          ) : (
            <p>
              When a shopper picks{" "}
              {
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
              }
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
                <span className="qz-lm-impact">
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
          )}
          <span className="qz-lm-fright">
            <button type="button" className="qz-btn" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="qz-btn qz-btn-primary"
              disabled={!canCreate}
              onClick={handleCreate}
            >
              {busy ? "Saving…" : editRule ? "Save rule" : "Create rule"}
            </button>
          </span>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
