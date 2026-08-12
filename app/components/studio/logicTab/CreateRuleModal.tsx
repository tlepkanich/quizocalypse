import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Quiz } from "../../../lib/quizSchema";
import type { BuilderCategory, BuilderCollection } from "../../builder/stepProps";
import type { IndexedProduct } from "../../../lib/recommendationEngine";
import type { OrderedQuestion } from "../../../lib/questionOrder";
import { createDecisionRule } from "../../../lib/quizMutations";
import { QzPopover, useFocusTrap } from "../../qz-overlays";
import { useQzToast } from "../../qz-toast";

// ════════════════════════════════════════════════════════════════════════════
// Logic tab (HANDOFF §4 + DECISIONS G1-G4/G9) — the create-a-rule modal.
// Three columns: WHEN THEY ANSWER · THEN · WHAT IT ACTS ON.
//
// v1 scoping locked in DECISIONS.md:
// - AND-only; the and/or joiner is not rendered (G2a).
// - One chip per single-select question (picking a second REPLACES it) — two
//   ANDed `is` conditions on a single-select can never fire (G3). Multi-select
//   questions may carry several chips (all-of; the engine's semantics).
// - Verbs wire per G4: Show → action absent · Highlight → "show" ·
//   Exclude → "hide". Default on a blank draft: Exclude.
// - The tray is multi-target (G1, `target_ids`); raw tag/collection/product
//   picks are materialized as Category rows via /api/categories/ensure-targets
//   at Create time (a rule target must be a Category id — publish blocks on
//   missing rows).
// - Esc closes; clicking the scrim must NOT discard the draft (§4.5) — which
//   is why this is a bespoke shell on useFocusTrap, not QzModal.
// ════════════════════════════════════════════════════════════════════════════

type QuizDoc = Quiz;

type Verb = "show" | "highlight" | "exclude";

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

const VERBS: Array<{ verb: Verb; name: string; hint: string }> = [
  { verb: "show", name: "Show", hint: "replaces the starting set — Narrows still apply" },
  { verb: "highlight", name: "Highlight", hint: "adds these in, even if a filter would drop them" },
  { verb: "exclude", name: "Exclude", hint: "takes these away for those shoppers" },
];

export function CreateRuleModal({
  doc,
  questions,
  categories,
  collections,
  productIndex,
  quizId,
  open,
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
  const [verb, setVerb] = useState<Verb>("exclude"); // §4.2 blank-draft default
  const [sel, setSel] = useState<SelectedResource[]>([]);
  const [query, setQuery] = useState("");
  const [kindChip, setKindChip] = useState<
    "all" | "set" | "tag" | "collection" | "metafield" | "product"
  >("all");
  const [busy, setBusy] = useState(false);
  // §4.5/G10 — the impact line, computed server-side (pathEnumeration, cap
  // 2 000 with truncated → "(sampled)"). Debounced; errors just hide the line.
  const [impact, setImpact] = useState<
    | null
    | { loading: true }
    | { notEstimable: true }
    | { fires: number; total: number; truncated: boolean }
  >(null);

  const conditionsKey = JSON.stringify(picks);
  useEffect(() => {
    if (!open) return;
    const conditions = Object.entries(picks).flatMap(([qid, aids]) =>
      aids.map((aid) => ({ question_id: qid, answer_id: aid, op: "is" as const })),
    );
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
          body: JSON.stringify({ quizId, conditions }),
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

  const toggleAnswer = (q: OrderedQuestion, answerId: string) => {
    setPicks((prev) => {
      const cur = prev[q.node.id] ?? [];
      const on = cur.includes(answerId);
      const multi = q.node.data.question_type === "multi_select";
      const next = on
        ? cur.filter((x) => x !== answerId)
        : multi
          ? [...cur, answerId]
          : [answerId]; // DECISIONS G3 — single-select: replace, never AND
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
    setVerb("exclude");
    setSel([]);
    setQuery("");
    setKindChip("all");
  };

  const canCreate = pickedCount > 0 && sel.length > 0 && !busy;

  const handleCreate = async () => {
    if (!canCreate) return;
    const conditions = Object.entries(picks).flatMap(([qid, aids]) =>
      aids.map((aid) => ({ question_id: qid, answer_id: aid, op: "is" as const })),
    );
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
      const action =
        verb === "exclude" ? ("hide" as const) : verb === "highlight" ? ("show" as const) : undefined;
      // Commit against the LATEST doc, not the render-time snapshot captured
      // before the await (review L2-5).
      const base = getLatestDoc ? getLatestDoc() : doc;
      commit(createDecisionRule(base, { conditions, target_ids, ...(action ? { action } : {}) }));
      toast("✓ Rule created — checked top down, first match applies");
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
  const verbWord = verb === "show" ? "show" : verb === "highlight" ? "highlight" : "exclude";

  return createPortal(
    // §4.5 — the scrim deliberately does NOT close (draft-safe); Esc is a
    // document-level listener above.
    <div className="qz-modal-scrim">
      <div ref={boxRef} className="qz-crm" role="dialog" aria-modal="true" aria-label="Create a rule">
        <header className="qz-crm-hd">
          <h2>Create a rule</h2>
          <span className="qz-crm-hint">
            Who it applies to on the left · what happens on the right
          </span>
          <button
            type="button"
            className="qz-btn qz-btn-primary"
            disabled={!canCreate}
            onClick={handleCreate}
          >
            {busy ? "Creating…" : "Create rule"}
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
                    {multi && cur.length > 1 ? (
                      <div className="qz-crm-qnote">shopper picked all of these</div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>

          {/* ── middle: THEN ── */}
          <section className="qz-crm-col qz-crm-verbs">
            <div className="qz-crm-colhd">Then</div>
            {VERBS.map((v) => (
              <button
                key={v.verb}
                type="button"
                className={`qz-crm-verb${verb === v.verb ? " is-on" : ""}${
                  v.verb === "exclude" ? " is-exclude" : v.verb === "highlight" ? " is-highlight" : ""
                }`}
                onClick={() => setVerb(v.verb)}
              >
                <b>{v.name}</b>
                <span>{v.hint}</span>
              </button>
            ))}
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
              Object.entries(picks)
                .flatMap(([qid, aids]) => aids.map((aid) => answerLabel(qid, aid)))
                .filter(Boolean)
                .map((label, i) => (
                  <span key={`${label}:${i}`}>
                    {i > 0 ? <span className="qz-ltab-join"> and </span> : null}
                    <b>{label}</b>
                  </span>
                ))
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
