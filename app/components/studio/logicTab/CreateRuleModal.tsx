import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Quiz } from "../../../lib/quizSchema";
import type { BuilderCategory, BuilderCollection } from "../../builder/stepProps";
import type { IndexedProduct } from "../../../lib/recommendationEngine";
import type { OrderedQuestion } from "../../../lib/questionOrder";
import { createDecisionRule, updateDecisionRule } from "../../../lib/quizMutations";
import { QzPopover, useFocusTrap } from "../../qz-overlays";
import { useQzToast } from "../../qz-toast";
import {
  productsWord,
  quizUsedRefs,
  ruleCoverage,
  rulesWord,
  splitRecommendationGroups,
} from "./createRuleBand";

// ════════════════════════════════════════════════════════════════════════════
// Create-a-rule modal — the ONE-SCREEN rebuild (create-rule handoff,
// docs/design/logic-tab/CREATE-RULE-HANDOFF.md; reference artifact
// "One-Screen Rule Builder"). The modal opened at ~1,050px of content and the
// products band was below the fold; this build puts every question on one
// ROW (fixed 130×62 answer buckets, two-line clamp), a constant 124px
// operator column, a one-row THEN, and a one-row products band.
//
// Two flows, one component — `flow` changes the PRODUCTS BAND and nothing
// else:
//   onboarding · the quiz's recommendation groups ARE the band ("Your
//                recommendations", a `2/3 have a rule` fraction, uncovered
//                first and amber, covered green); the catalogue (kind tabs +
//                search) is behind "+ Add something else".
//   builder    · today's mixed band ("What the quiz shows"): kind tabs +
//                search from the start, one row at rest on All, plain rule
//                counts where rules exist and NOTHING where they don't.
//
// Operators (logic-step §3, unchanged fields): `is / is not` per question
// (per-condition `op`), `any of / all of` per question once two answers are
// picked (`any_of`; a control on multi-select only — "all of" on a single-
// select can never fire, so there it is stated, not offered). The cross-
// question `match any` segment is CUT from the UI: new rules never write
// `match`; an edited rule keeps whatever it had (the key is not patched).
//
// Verbs per §4: Show → "show" · Pin → "prioritize" · Hide → "hide". A legacy
// REPLACE rule (action absent) is parsed forever; editing one keeps it
// absent unless the verb changes.
//
// Esc closes; clicking the scrim must NOT discard the draft (§4.5) — which
// is why this is a bespoke shell on useFocusTrap, not QzModal (review L2-4).
// ════════════════════════════════════════════════════════════════════════════

type QuizDoc = Quiz;
type DecisionRuleT = NonNullable<Quiz["decision_rules"]>[number];

type Verb = "show" | "pin" | "hide";
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

// Band kind tabs, handoff order: All · Recommendations · Products ·
// Collections · Tags · Metafields. "Recommendations" are the Category rows —
// the groups the merchant confirmed on the Recommendations step.
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

// One row at rest — five cards plus the dashed "+ N" tile.
const ROW_CAP = 5;
// A long recommendation list wraps anyway, so it splits into labelled halves.
const SPLIT_AT = 6;
// Catalogue safety cap (the 12-per-kind search grouping is separate).
const LIST_CAP = 40;
// The peek lists six products and a "+ N more" tail.
const PEEK_ROWS = 6;

const FIXED_JOIN_TITLE =
  "A shopper answers this question once, so two answers here can only mean either of them";

/* ── the target card ─────────────────────────────────────────────────────
   Selection is the STRETCHED button (absolute, covering the card) so the
   count can be its own sibling button: opening the group's contents must
   never toggle the target, and a click inside the peek must never select
   or close it (handoff §4). The peek opens UPWARD through QzPopover — this
   band sits at the bottom of the modal and .qz-lm clips overflow. Module-
   level so its identity is stable across renders (position holding). */
function TargetCard({
  r,
  on,
  ruleCount,
  status,
  img,
  products,
  onToggle,
}: {
  r: SelectedResource;
  on: boolean;
  ruleCount: number;
  /** onboarding recommendation cards carry a status chip in the kind-tag
   *  slot; every other card carries its kind tag. */
  status: "needs" | "done" | null;
  img: string | null;
  products: IndexedProduct[];
  onToggle: () => void;
}) {
  const showRuleCount = status === null && r.kind === "set" && ruleCount > 0;
  const titleParts = [`${r.name} · ${productsWord(r.count)}`];
  if (r.kind === "set") {
    if (ruleCount) titleParts.push(`used by ${rulesWord(ruleCount)}`);
    else if (status === "needs") titleParts.push("no rule points at it yet");
  }
  const state = on ? " is-on" : status === "needs" ? " is-needs" : status === "done" ? " is-done" : "";
  const cardRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={cardRef} className={`qz-lm-tcard${state}`}>
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
                aria-label={`${productsWord(r.count)} in ${r.name}`}
              >
                {productsWord(r.count)}
              </button>
            }
            content={
              <div className="qz-lm-peek">
                <div className="qz-lm-peek-h">Inside {r.name}</div>
                {products.slice(0, PEEK_ROWS).map((p) => (
                  <div key={p.product_id} className="qz-lm-peek-row">
                    {p.image_url ? (
                      <img src={p.image_url} alt="" width={22} height={22} loading="lazy" />
                    ) : (
                      <span className="qz-lm-peek-sw" aria-hidden />
                    )}
                    <span>{p.title}</span>
                  </div>
                ))}
                {products.length === 0 ? (
                  <div className="qz-lm-peek-more">No products in this group yet</div>
                ) : null}
                {products.length > PEEK_ROWS ? (
                  <div className="qz-lm-peek-more">+{products.length - PEEK_ROWS} more</div>
                ) : null}
              </div>
            }
          />
          {showRuleCount ? <span className="qz-lm-thas">· {rulesWord(ruleCount)}</span> : null}
        </span>
      </span>
      {status ? (
        <span className={`qz-lm-tstat is-${status}`}>
          {status === "done" ? `✓ ${rulesWord(ruleCount)}` : "Needs a rule"}
        </span>
      ) : (
        <span className="qz-lm-kd">{KIND_TAG[r.kind]}</span>
      )}
    </div>
  );
}

export function CreateRuleModal({
  doc,
  questions,
  categories,
  collections,
  productIndex,
  quizId,
  open,
  editRule,
  flow = "builder",
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
  /** Which products band to render — the ONLY thing the flow changes. The
   *  funnel passes "onboarding"; the Logic tab passes nothing. */
  flow?: CreateRuleFlow;
  onClose: () => void;
  commit: (doc: QuizDoc) => void;
  onCategoriesCreated: (cats: BuilderCategory[]) => void;
  /** Latest-doc seam: commit builds on the CURRENT doc, not the render-time
   *  snapshot captured before the ensure-targets await (review L2-5). */
  getLatestDoc?: () => QuizDoc;
}) {
  const toast = useQzToast();
  const boxRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  useFocusTrap(boxRef, open);

  // §4.5 — Esc closes from anywhere. A scrim onKeyDown dies once focus lands
  // on a non-focusable region (keydown targets <body>, an ancestor of the
  // scrim, so it never bubbles here) — document-level listener instead
  // (review L2-4). An open peek popover takes Esc first (it registers its
  // own listener after this one and closes itself).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (document.querySelector(".qz-popover")) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const [picks, setPicks] = useState<Record<string, string[]>>({});
  const [verb, setVerb] = useState<Verb>("show");
  const [sel, setSel] = useState<SelectedResource[]>([]);
  const [query, setQuery] = useState("");
  const [kindChip, setKindChip] = useState<KindFilter>("all");
  const [busy, setBusy] = useState(false);
  // Onboarding: "+ Add something else" reveals the catalogue UNDER the groups.
  const [catalogueOpen, setCatalogueOpen] = useState(false);
  // The one-row cap's "+ N" tile — opened stays open for that rule.
  const [moreOpen, setMoreOpen] = useState(false);
  // Logic-step §3 — the per-question operator state, one control each:
  //   notQs[qid] — is / is not (is_not = none of these).
  //   allQs[qid] — all-of (default any-of; a control on multi-select only,
  //                forced any on single-select at derivation time).
  const [notQs, setNotQs] = useState<Record<string, boolean>>({});
  const [allQs, setAllQs] = useState<Record<string, boolean>>({});
  // §12 — editing a LEGACY replace rule (action absent) keeps it absent
  // unless the merchant actively changes the verb.
  const [legacyReplace, setLegacyReplace] = useState(false);
  // Audit fix (mixed-op flattening) — the op toggle is per QUESTION, but the
  // schema allows per-CONDITION ops on one question ("Q1 is A and Q1 is_not
  // B", built by the older inline editor). Re-deriving such a row from the
  // toggle would silently rewrite every condition to one op. So: an edited
  // row the merchant never touched keeps its ORIGINAL conditions verbatim;
  // only touched rows re-derive. (Kept through the rows rebuild — this is
  // about edit fidelity, not column lifecycle.)
  const seededGroups = useRef<Record<string, DecisionRuleT["conditions"]>>({});
  const [dirtyQs, setDirtyQs] = useState<Set<string>>(new Set());
  const touchQ = (qid: string) =>
    setDirtyQs((prev) => {
      if (prev.has(qid)) return prev;
      const next = new Set(prev);
      next.add(qid);
      return next;
    });

  const resetDraft = () => {
    setPicks({});
    setVerb("show");
    setSel([]);
    setQuery("");
    setKindChip("all");
    setNotQs({});
    setAllQs({});
    setLegacyReplace(false);
    setCatalogueOpen(false);
    setMoreOpen(false);
    seededGroups.current = {};
    setDirtyQs(new Set());
  };

  // §12 — seed the draft from the rule under edit each time the modal opens.
  const editId = editRule?.id ?? null;
  useEffect(() => {
    if (!open) return;
    resetDraft();
    if (!editRule) return;
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
      // Stored absence of any_of on a multi-pick is-row = all-of (§3).
      if (n > 1 && !anyOf.has(qid)) seededAll[qid] = true;
    }
    setPicks(seededPicks);
    setNotQs(seededNot);
    setAllQs(seededAll);
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

  // ── §3 — the ONE derivation of the draft's stored shape ───────────────────
  // conditions (per-row op), any_of (an is-row with several picks left on
  // "any of"; single-select is FORCED any — two ANDed is on a single-select
  // can match nobody). No `match` — the cross-question join is always AND
  // on new rules now.
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
    for (const q of questions) {
      const qid = q.node.id;
      const aids = picks[qid] ?? [];
      if (aids.length === 0) continue;
      // Untouched edited row → the original conditions, byte-for-byte
      // (mixed per-condition ops survive; the toggle can't express them).
      const seeded = seededGroups.current[qid];
      if (seeded && !dirtyQs.has(qid)) {
        conditions.push(...seeded);
        const isConds = seeded.filter((c) => c.op === "is");
        if (isConds.length > 1 && (editRule?.any_of ?? []).includes(qid)) {
          any_of.push(qid);
        }
        continue;
      }
      const op = notQs[qid] ? ("is_not" as const) : ("is" as const);
      for (const aid of aids) conditions.push({ question_id: qid, answer_id: aid, op });
      if (op === "is" && aids.length > 1) {
        const forcedAny = !multiById.get(qid);
        if (forcedAny || !allQs[qid]) any_of.push(qid);
      }
    }
    return { conditions, any_of };
  }, [questions, picks, notQs, allQs, multiById, dirtyQs, editRule]);

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

  // Live band chip counts, from the same index the grid reads.
  const kindCounts = useMemo(() => {
    const counts = new Map<Kind, number>();
    for (const r of index) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
    return counts;
  }, [index]);

  // Coverage — built ONCE per render from the doc (handoff §4): for each
  // category id, how many rules point at it. No cache; the ledger behind the
  // modal edits the same doc, so reopening is enough.
  const coverage = useMemo(() => ruleCoverage(doc.decision_rules), [doc.decision_rules]);

  // What the quiz already uses of each kind — the rows a kind tab shows
  // before any search.
  const used = useMemo(() => quizUsedRefs(doc, categories), [doc, categories]);
  const inQuiz = (r: SelectedResource): boolean => {
    if (r.kind === "set") return true;
    if (r.kind === "tag") return used.tags.has(r.ref);
    if (r.kind === "collection") return used.collections.has(r.ref);
    if (r.kind === "metafield") return used.metafields.has(r.ref);
    return used.products.has(r.ref);
  };

  // The quiz's OWN recommendation groups — the Category rows the merchant
  // confirmed on the Recommendations step (quizId set). The funnel loader
  // also passes the shop's reusable groups (quizId null); those are
  // catalogue, reachable through the tabs and search, never the band's
  // headline list (same split as TargetOptions).
  const groups = useMemo(() => categories.filter((c) => c.quizId != null), [categories]);
  const groupIds = useMemo(() => new Set(groups.map((c) => c.id)), [groups]);
  const isGroupRow = (r: SelectedResource) => r.kind === "set" && groupIds.has(r.ref);

  // A quiz with no recommendation groups has nothing to lead with — fall
  // back to the builder band (defensive; a funnel quiz always has groups).
  const onboarding = flow === "onboarding" && groups.length > 0;

  const selKeys = useMemo(() => new Set(sel.map((s) => s.key)), [sel]);
  const qlc = query.trim().toLowerCase();

  // §4.3 typed → one group per kind, 12 rows each, with the found-line. The
  // rule's own picks are excluded here (they render first, always).
  const search = useMemo(() => {
    if (!qlc) return null;
    let rows = index.filter((r) => !selKeys.has(r.key));
    // Onboarding: the quiz's groups are already on screen above the search.
    if (onboarding) rows = rows.filter((r) => !isGroupRow(r));
    if (kindChip !== "all") rows = rows.filter((r) => r.kind === kindChip);
    rows = rows.filter((r) => r.name.toLowerCase().includes(qlc));
    const kinds = [...new Set(rows.map((r) => r.kind))];
    const grouped = kinds.flatMap((k) => rows.filter((r) => r.kind === k).slice(0, 12));
    return {
      rows: grouped,
      overflow: rows.length - grouped.length,
      foundLine: `Found ${rows.length} across ${kinds.length} ${kinds.length === 1 ? "type" : "types"}`,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qlc, index, selKeys, kindChip, onboarding, groupIds]);

  const pickedCount = Object.values(picks).reduce((n, a) => n + a.length, 0);
  // ONE resolver for the tiles' product thumbs and the peek — mirrors
  // resolveMembership, exact-case (review L2-6).
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

  // §3 — several answers on ONE question is expressible (any-of / all-of),
  // so every question type ACCUMULATES; single-select rows are forced
  // any-of at derivation time. Do not "fix" this to replace on single-select.
  const toggleAnswer = (qid: string, answerId: string) => {
    touchQ(qid);
    setPicks((prev) => {
      const cur = prev[qid] ?? [];
      const on = cur.includes(answerId);
      const next = on ? cur.filter((x) => x !== answerId) : [...cur, answerId];
      return { ...prev, [qid]: next };
    });
  };

  const toggleResource = (r: SelectedResource) => {
    setSel((prev) =>
      prev.some((s) => s.key === r.key)
        ? prev.filter((s) => s.key !== r.key)
        : [...prev, r],
    );
  };

  const canCreate = pickedCount > 0 && sel.length > 0 && !busy;

  /** Commits on the shared path (ensure-targets → create/update). Returns
   *  true when the rule landed. On ANY failure the draft is left exactly as
   *  it is — a reset on the error path destroys work that cannot be
   *  recovered (handoff §3). */
  const save = async (): Promise<boolean> => {
    const { conditions, any_of } = draft;
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
        toast("Couldn't reach the server — the rule wasn't saved");
        return false;
      }
      if (!j.ok || !j.categories) {
        toast("Couldn't save those targets — try again");
        return false;
      }
      // The rows ensure-targets created belong to the QUIZ, not the draft —
      // lifted before any reset so the next rule never re-creates them.
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
    // before the await (review L2-5) — back-to-back "add another" saves
    // would otherwise drop the earlier rule.
    const base = getLatestDoc ? getLatestDoc() : doc;
    if (editRule) {
      // `match` is deliberately NOT in the patch: a rule saved with
      // match: "any" keeps behaving that way (we stop writing it, never
      // stop honouring it).
      commit(
        updateDecisionRule(base, editRule.id, {
          conditions,
          target_ids,
          action,
          any_of,
        }),
      );
    } else {
      commit(
        createDecisionRule(base, {
          conditions,
          target_ids,
          ...(action ? { action } : {}),
          ...(any_of.length ? { any_of } : {}),
        }),
      );
    }
    return true;
  };

  const handleCreate = async () => {
    if (!canCreate) return;
    setBusy(true);
    try {
      if (!(await save())) return;
      toast(editRule ? "✓ Rule updated" : "✓ Rule created");
      resetDraft();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  // Create & add another — the only place the modal SHOULD move you: commit
  // on the same path, toast (the merchant's only confirmation while the
  // modal stays open), reset the draft, scroll the body back to Q1.
  const handleCreateAnother = async () => {
    if (!canCreate || editRule) return;
    setBusy(true);
    try {
      if (!(await save())) return;
      toast("✓ Rule saved");
      resetDraft();
      bodyRef.current?.scrollTo({ top: 0 });
    } finally {
      setBusy(false);
    }
  };

  if (!open || typeof document === "undefined") return null;

  const modalTitle = editRule ? "Edit rule" : "Create a rule";
  const verbHint = VERBS.find((v) => v.verb === verb)?.hint ?? "";

  const renderCard = (r: SelectedResource, status: "needs" | "done" | null) => (
    <TargetCard
      key={r.key}
      r={r}
      on={selKeys.has(r.key)}
      ruleCount={r.kind === "set" ? coverage.get(r.ref) ?? 0 : 0}
      status={status}
      img={r.kind === "product" ? resolveResource(r)[0]?.image_url ?? null : null}
      products={resolveResource(r)}
      onToggle={() => toggleResource(r)}
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

  // ── the BUILDER band ("What the quiz shows") ──────────────────────────────
  // One grid, always, with whatever the rule already acts on rendered FIRST
  // regardless of the active filter — a filter can never hide part of the
  // rule. One row at rest on All; a filtered view is never capped.
  const builderBand = () => {
    let grid: ReactNode;
    let line: ReactNode = null;
    if (search) {
      grid = (
        <div className="qz-lm-tgrid">
          {sel.map((r) => renderCard(r, null))}
          {search.rows.map((r) => renderCard(r, null))}
        </div>
      );
      line = <div className="qz-lm-more">{search.foundLine}</div>;
      if (search.rows.length === 0 && sel.length === 0)
        grid = <div className="qz-lm-tempty">Nothing matches “{query.trim()}”.</div>;
      if (search.overflow > 0)
        line = (
          <div className="qz-lm-more">
            {search.foundLine} · +{search.overflow} more — type to narrow
          </div>
        );
    } else if (kindChip === "all") {
      // At rest: the picks, then the recommendation groups, then whatever
      // else the quiz already uses (its tags). The catalogue is behind the
      // tile and the tabs/search.
      const pool = index.filter(
        (r) => !selKeys.has(r.key) && (isGroupRow(r) || (r.kind === "tag" && used.tags.has(r.ref))),
      );
      const list = [...sel, ...pool];
      const capped = !moreOpen && list.length > ROW_CAP;
      const shown = capped ? list.slice(0, ROW_CAP) : list.slice(0, LIST_CAP);
      grid = (
        <div className="qz-lm-tgrid">
          {shown.map((r) => renderCard(r, null))}
          {capped ? (
            <button
              type="button"
              className="qz-lm-tmore"
              title="Tags, collections, products and metafields from the catalogue"
              onClick={() => setMoreOpen(true)}
            >
              +{list.length - ROW_CAP} from the catalogue
            </button>
          ) : null}
        </div>
      );
      if (!capped && list.length > LIST_CAP)
        line = <div className="qz-lm-more">+{list.length - LIST_CAP} more — type to narrow</div>;
    } else {
      const pool = index.filter(
        (r) => !selKeys.has(r.key) && r.kind === kindChip && (kindChip === "set" ? isGroupRow(r) : inQuiz(r)),
      );
      const meta = KIND_CHIPS.find((k) => k.kind === kindChip)!;
      const total = kindCounts.get(kindChip) ?? 0;
      const shown = kindChip === "set" ? pool : pool.slice(0, LIST_CAP);
      grid =
        sel.length === 0 && pool.length === 0 ? (
          <div className="qz-lm-tempty">
            Nothing of this kind is in the quiz yet — search the catalogue to add one.
          </div>
        ) : (
          <div className="qz-lm-tgrid">
            {sel.map((r) => renderCard(r, null))}
            {shown.map((r) => renderCard(r, null))}
          </div>
        );
      line = (
        <div className="qz-lm-tgroup">
          {kindChip === "set"
            ? `Recommendations · all ${groups.length} groups this quiz recommends`
            : `${meta.label} · ${pool.length} in this quiz of ${total.toLocaleString()} — search to reach the rest`}
        </div>
      );
    }
    return (
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
    );
  };

  // ── the ONBOARDING band ("Your recommendations") ──────────────────────────
  // The groups confirmed on the Recommendations step ARE the band: uncovered
  // first (amber, "Needs a rule"), then covered (green, "✓ N rules"), then
  // anything the rule uses from the catalogue. Cards move between the two
  // states only when a rule is SAVED (coverage is doc-derived), never while
  // picking. The catalogue sits UNDER the groups behind "+ Add something
  // else" — it adds a section, it never replaces the list.
  const onboardingBand = () => {
    const { needs, done } = splitRecommendationGroups(groups, coverage);
    const asRow = (c: BuilderCategory): SelectedResource => ({
      key: `set:${c.id}`,
      kind: "set",
      ref: c.id,
      name: c.name,
      count: c.productIds.length,
    });
    // Whatever the rule acts on beyond the groups — catalogue picks, or a
    // shop-wide reusable group — renders WITH the groups so a collapsed
    // catalogue can never hide part of the rule.
    const chosenOther = sel.filter((s) => !isGroupRow(s));
    const covered = done.length;
    const allCovered = covered === groups.length;
    const split = groups.length > SPLIT_AT;
    // Selected wins over both states — needs/done apply only when not picked.
    const groupCard = (c: BuilderCategory, status: "needs" | "done") =>
      renderCard(asRow(c), selKeys.has(`set:${c.id}`) ? null : status);

    let catalogueGrid: ReactNode = null;
    let catalogueLine: ReactNode = null;
    if (catalogueOpen) {
      if (search) {
        catalogueGrid =
          search.rows.length === 0 ? (
            <div className="qz-lm-tempty">Nothing matches “{query.trim()}”.</div>
          ) : (
            <div className="qz-lm-tgrid">{search.rows.map((r) => renderCard(r, null))}</div>
          );
        catalogueLine = (
          <div className="qz-lm-more">
            {search.foundLine}
            {search.overflow > 0 ? ` · +${search.overflow} more — type to narrow` : ""}
          </div>
        );
      } else {
        // The catalogue the quiz already touches: its tags, collections,
        // metafields and products, plus the shop's reusable groups.
        const pool = index.filter(
          (r) =>
            !isGroupRow(r) &&
            !selKeys.has(r.key) &&
            (kindChip === "all" || r.kind === kindChip) &&
            (r.kind === "set" || inQuiz(r)),
        );
        const capped = !moreOpen && pool.length > ROW_CAP + 1;
        const shown = capped ? pool.slice(0, ROW_CAP) : pool.slice(0, LIST_CAP);
        catalogueGrid =
          pool.length === 0 ? (
            <div className="qz-lm-tempty">
              Nothing of this kind is in the quiz yet — search the catalogue to add one.
            </div>
          ) : (
            <div className="qz-lm-tgrid">
              {shown.map((r) => renderCard(r, null))}
              {capped ? (
                <button type="button" className="qz-lm-tmore" onClick={() => setMoreOpen(true)}>
                  +{pool.length - ROW_CAP} more
                </button>
              ) : null}
            </div>
          );
        if (!capped && pool.length > LIST_CAP)
          catalogueLine = (
            <div className="qz-lm-more">+{pool.length - LIST_CAP} more — type to narrow</div>
          );
      }
    }

    return (
      <section className="qz-lm-showband" data-flow="onboarding">
        <div className="qz-lm-showhead">
          <span className="qz-lm-st">Your recommendations</span>
          <span className="qz-lm-cover">
            <b className={`qz-lm-frac${allCovered ? " is-done" : ""}`}>
              {allCovered ? "✓ " : ""}
              {covered}/{groups.length}
            </b>{" "}
            have a rule
          </span>
          {!catalogueOpen ? (
            <button
              type="button"
              className="qz-lm-expand"
              onClick={() => setCatalogueOpen(true)}
            >
              + Add something else
            </button>
          ) : null}
        </div>
        {split ? (
          <>
            {needs.length ? (
              <>
                <div className="qz-lm-tgroup is-needs">Needs a rule · {needs.length}</div>
                <div className="qz-lm-tgrid">{needs.map((c) => groupCard(c, "needs"))}</div>
              </>
            ) : null}
            {done.length ? (
              <>
                <div className="qz-lm-tgroup">Has rules · {done.length}</div>
                <div className="qz-lm-tgrid">{done.map((c) => groupCard(c, "done"))}</div>
              </>
            ) : null}
            {chosenOther.length ? (
              <>
                <div className="qz-lm-tgroup">Also in this rule · {chosenOther.length}</div>
                <div className="qz-lm-tgrid">{chosenOther.map((r) => renderCard(r, null))}</div>
              </>
            ) : null}
          </>
        ) : (
          <div className="qz-lm-tgrid">
            {needs.map((c) => groupCard(c, "needs"))}
            {done.map((c) => groupCard(c, "done"))}
            {chosenOther.map((r) => renderCard(r, null))}
          </div>
        )}
        {catalogueOpen ? (
          <div className="qz-lm-catbar">
            <div className="qz-lm-showhead">
              <span className="qz-lm-st qz-lm-catlabel">From the catalogue</span>
              <span className="qz-lm-tfilt">
                {kindTab("all", "All")}
                {KIND_CHIPS.filter((k) => k.kind !== "set").map(({ kind, label }) =>
                  kindTab(kind, label, kindCounts.get(kind) ?? 0),
                )}
              </span>
              <input
                className="qz-lm-tsearch"
                placeholder="Search products, collections, tags…"
                aria-label="Search the catalogue"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            {catalogueLine}
            {catalogueGrid}
          </div>
        ) : null}
      </section>
    );
  };

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

        <div className="qz-lm-b" ref={bodyRef}>
          {/* ── when they answer: one ROW per question, every question,
                 always. Keys are the question/answer ids, so a pick updates
                 buttons in place — nothing remounts, scroll and focus hold. ── */}
          <div className="qz-lm-qrows">
            {questions.map((q) => {
              const qid = q.node.id;
              const aids = picks[qid] ?? [];
              const multi = q.node.data.question_type === "multi_select";
              const isNot = Boolean(notQs[qid]);
              const isAll = multi && Boolean(allQs[qid]);
              const text = q.node.data.text.replace(/\?$/, "");
              return (
                <div key={qid} className={`qz-lm-qrow${aids.length ? " is-on" : ""}`}>
                  <span className="qz-lm-qc">
                    <span className="qz-lm-qmeta">
                      <span className="qz-lm-qn">Q{q.qIndex}</span>
                      {multi ? <span className="qz-lm-qbadge">Multi select</span> : null}
                    </span>
                    <span className="qz-lm-qt" title={text}>
                      {text}
                    </span>
                  </span>
                  <span className="qz-lm-tiles">
                    {q.node.data.answers.map((a) => {
                      const on = aids.includes(a.id);
                      return (
                        <button
                          key={a.id}
                          type="button"
                          className={`qz-lm-tile${on ? " is-on" : ""}`}
                          aria-pressed={on}
                          title={a.text}
                          onClick={() => toggleAnswer(qid, a.id)}
                        >
                          <span className="qz-lm-tx">{a.text}</span>
                        </button>
                      );
                    })}
                  </span>
                  {/* One cluster, one phrase: "Q1 is any of [these]". The
                      column is reserved whether or not the join shows, so
                      it appears into space the row already had. */}
                  <span className="qz-lm-ops">
                    <button
                      type="button"
                      className={`qz-lm-qcf${isNot ? " is-not" : ""}`}
                      aria-pressed={isNot}
                      title={
                        isNot
                          ? "Matches shoppers who picked NONE of these"
                          : "Matches shoppers who picked these"
                      }
                      onClick={() => {
                        touchQ(qid);
                        setNotQs((prev) => ({ ...prev, [qid]: !prev[qid] }));
                      }}
                    >
                      {isNot ? "is not" : "is"}
                    </button>
                    {aids.length > 1 ? (
                      multi ? (
                        <button
                          type="button"
                          className="qz-lm-qcf is-join"
                          aria-pressed={isAll}
                          title={`Click to switch to ${isAll ? "any of" : "all of"}`}
                          onClick={() => {
                            touchQ(qid);
                            setAllQs((prev) => ({ ...prev, [qid]: !prev[qid] }));
                          }}
                        >
                          {isAll ? "all of" : "any of"} ⇄
                        </button>
                      ) : (
                        // Stated, not offered — "all of" on a single-select
                        // can never fire.
                        <span className="qz-lm-qcf is-join is-fixed" title={FIXED_JOIN_TITLE}>
                          any of
                        </span>
                      )
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="qz-lm-sep" />

          {/* ── THEN: one row — label, Show | Pin | Hide, the verb's hint ── */}
          <div className="qz-lm-verbline">
            <span className="qz-lm-bt">Then</span>
            <span className="qz-lm-seg qz-lm-vseg">
              {VERBS.map((v) => (
                <button
                  key={v.verb}
                  type="button"
                  aria-pressed={verb === v.verb}
                  onClick={() => setVerb(v.verb)}
                >
                  {v.name}
                </button>
              ))}
            </span>
            <span className="qz-lm-verbhint">{verbHint}</span>
            {/* §12 — an edited legacy rule that stays on Show keeps its
                original replace behavior; say so rather than hiding it. */}
            {editRule && legacyReplace && verb === "show" ? (
              <span className="qz-lm-legacynote">
                This older rule replaces the results outright — saving on Show keeps that behavior.
              </span>
            ) : null}
          </div>

          <div className="qz-lm-sep" />

          {onboarding ? onboardingBand() : builderBand()}
        </div>

        {/* ── footer: [N selected] · Cancel · Create & add another · Create ── */}
        <footer className="qz-lm-f">
          {sel.length ? (
            <span className="qz-lm-fcount">
              <b>{sel.length}</b> selected
            </span>
          ) : null}
          <span className="qz-lm-fright">
            <button type="button" className="qz-btn" onClick={onClose}>
              Cancel
            </button>
            {!editRule ? (
              <button
                type="button"
                className="qz-btn qz-lm-fghost"
                disabled={!canCreate}
                onClick={handleCreateAnother}
              >
                Create &amp; add another
              </button>
            ) : null}
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
