import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import type { Quiz, Answer } from "../../../lib/quizSchema";
import { isFreeformType } from "../../../lib/quizSchema";
import type { BuilderCategory, BuilderCollection } from "../../builder/stepProps";
import type { IndexedProduct } from "../../../lib/recommendationEngine";
import type { OrderedQuestion } from "../../../lib/questionOrder";
import {
  moveDecider,
  setAnswerFilterValues,
  setAnswerTarget,
  setQuestionRole,
} from "../../../lib/quizMutations";
import { filterAnswerMatchCount } from "../../../lib/filterMatching";
import { QzPopover, useFocusTrap } from "../../qz-overlays";
import { useQzToast } from "../../qz-toast";
import {
  fieldHue,
  guessAnswerMappings,
  guessAnswerTargets,
  derivedNarrowLabel,
  fieldValues,
  narrowFieldOptions,
  writeValuesForField,
} from "./logicTabFields";

// ════════════════════════════════════════════════════════════════════════════
// UNIFIED one-window (unified/_v.js) — THE QUESTION WINDOW. The same three
// panels as Create-a-rule, because the merchant is answering the same
// question: WHICH PRODUCTS. Left is the thing being pointed (answers, vs. a
// rule's conditions), the 182px spine is the verb (this question's job, vs.
// show/highlight/exclude), and the right is the one resource index. Five
// popovers become one window they already know.
//
// Storage mapping (build plan P10):
// - decides: ONE target per answer (G9) — setAnswerTarget over the Sets.
// - filter: setAnswerFilterValues FULL-SET writes; field values go through
//   writeValuesForField, plain picks land in tags / collection_filters.
// - narrow_field is NEVER written here (parse-forever; the pill derives).
// Every write is a pure mutation → commit(next); edits are live, "Done"
// just closes. Esc priority: menu > question window (the popover check).
// ════════════════════════════════════════════════════════════════════════════

type QuizDoc = Quiz;

/** One selectable thing in the window's right bank. */
type WinItem =
  | { kind: "fv"; field: string; value: string }
  | { kind: "tag"; tag: string }
  | { kind: "col"; id: string };

type Badge = "tag" | "collection" | "metafield" | "variant" | "type" | "set";

interface WinResource {
  key: string;
  item: WinItem;
  badge: Badge;
  /** Full row label ("Gender = Men" for field values). */
  name: string;
  /** Chip/sentence label ("Men"). */
  short: string;
  count: number;
  field?: string;
}

const BADGE_LABEL: Record<Badge, string> = {
  tag: "Tag",
  collection: "Coll",
  metafield: "Meta",
  variant: "Opt",
  type: "Type",
  set: "Set",
};
// Group headers while searching (mock kindLabel + s).
const BADGE_GROUP: Record<Badge, string> = {
  collection: "Collections",
  tag: "Tags",
  metafield: "Metafields",
  variant: "Variant options",
  type: "Product types",
  set: "Sets",
};

const badgeForField = (field: string): Badge =>
  field.startsWith("tag:")
    ? "tag"
    : field.startsWith("mf:")
      ? "metafield"
      : field.startsWith("vo:")
        ? "variant"
        : "type";

const itemKey = (it: WinItem): string =>
  it.kind === "fv" ? `fv:${it.field}:${it.value}` : it.kind === "tag" ? `tag:${it.tag}` : `col:${it.id}`;

/** The answer's stored selection, lifted into window items. Family-shaped
 *  tags ("fit:slim") read as field values; the rest are plain picks. */
function answerSelection(a: Answer): WinItem[] {
  const items: WinItem[] = [];
  for (const t of a.tags) {
    const i = t.indexOf(":");
    if (i > 0 && i < t.length - 1)
      items.push({
        kind: "fv",
        field: `tag:${t.slice(0, i).trim().toLowerCase()}`,
        value: t.slice(i + 1).trim().toLowerCase(),
      });
    else if (t.trim()) items.push({ kind: "tag", tag: t });
  }
  for (const m of a.metafield_filters ?? [])
    items.push({ kind: "fv", field: `mf:${m.key}`, value: m.value.trim().toLowerCase() });
  for (const v of a.variant_filters ?? [])
    items.push({ kind: "fv", field: `vo:${v.name}`, value: v.value.trim().toLowerCase() });
  for (const t of a.product_type_filters ?? [])
    items.push({ kind: "fv", field: "ptype", value: t.trim().toLowerCase() });
  for (const c of [
    ...(a.collection_filter ? [a.collection_filter] : []),
    ...(a.collection_filters ?? []),
  ])
    items.push({ kind: "col", id: c });
  return items;
}

/** The setAnswerFilterValues payload for a whole selection (FULL-SET). */
function payloadFor(items: WinItem[]): Parameters<typeof setAnswerFilterValues>[3] {
  const tags: string[] = [];
  const collection_filters: string[] = [];
  const metafield_filters: Array<{ key: string; value: string }> = [];
  const variant_filters: Array<{ name: string; value: string }> = [];
  const product_type_filters: string[] = [];
  for (const it of items) {
    if (it.kind === "tag") tags.push(it.tag);
    else if (it.kind === "col") collection_filters.push(it.id);
    else {
      const w = writeValuesForField(it.field, [it.value]);
      if (w.tags) tags.push(...w.tags);
      if (w.metafield_filters) metafield_filters.push(...w.metafield_filters);
      if (w.variant_filters) variant_filters.push(...w.variant_filters);
      if (w.product_type_filters) product_type_filters.push(...w.product_type_filters);
    }
  }
  return {
    tags,
    ...(collection_filters.length ? { collection_filters } : {}),
    ...(metafield_filters.length ? { metafield_filters } : {}),
    ...(variant_filters.length ? { variant_filters } : {}),
    ...(product_type_filters.length ? { product_type_filters } : {}),
  };
}

// Word-boundary matching only — a substring test makes "Men" match "Women",
// which is the classic way these guesses become wrong instead of merely
// unhelpful (unified/_v.js wordRe).
const wordRe = (t: string) =>
  new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i");

// "and"-joined name list ("A", "A and B", "A, B and C") — mock joinN.
function joinNames(nodes: ReactNode[]): ReactNode {
  return nodes.map((n, i) => (
    <span key={i}>
      {i > 0 ? (
        <span className="qz-ltab-join">{i === nodes.length - 1 ? " and " : ", "}</span>
      ) : null}
      {n}
    </span>
  ));
}

const stripQ = (s: string) => s.replace(/\s*\?\s*$/, "");

// §4.3 pattern — one row component for the whole right bank: [KIND] Name
// [N products ▾] ✓. The count is its OWN button (product-list popover); the
// rest of the row toggles. Mirrors CreateRuleModal's ResourceRow on the
// window's resource shape.
function WinRow({
  r,
  on,
  onToggle,
  resolve,
}: {
  r: WinResource;
  on: boolean;
  onToggle: () => void;
  resolve: (r: WinResource) => IndexedProduct[];
}) {
  const [listOpen, setListOpen] = useState(false);
  return (
    <span className={`qz-crm-res${on ? " is-on" : ""}`}>
      <button type="button" className="qz-crm-resmain" onClick={onToggle}>
        <span className={`qz-crm-kind is-${r.badge}`}>{BADGE_LABEL[r.badge]}</span>
        <span className="qz-crm-resname">{r.name}</span>
      </button>
      <QzPopover
        open={listOpen}
        onOpenChange={setListOpen}
        maxWidth={300}
        trigger={
          <button
            type="button"
            className="qz-crm-rescount"
            aria-label={`${r.count} products in ${r.name}`}
          >
            {r.count} {r.count === 1 ? "product" : "products"}
          </button>
        }
        content={
          <div className="qz-ltab-menu">
            <div className="qz-ltab-menu-title">
              {r.name} — {r.count} {r.count === 1 ? "product" : "products"}
            </div>
            <div className="qz-ltab-menu-products">
              {resolve(r)
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

const JOBS = [
  { k: "decides" as const, n: "Starting set", hint: "each answer opens a group of products" },
  { k: "filter" as const, n: "Narrows", hint: "each answer keeps only what matches" },
  { k: "info" as const, n: "Info only", hint: "asked, but never touches products" },
];

export function QuestionWindow({
  doc,
  q,
  questions,
  categories,
  collections,
  productIndex,
  initialAnswerId,
  onClose,
  commit,
}: {
  doc: QuizDoc;
  q: OrderedQuestion;
  questions: OrderedQuestion[];
  categories: BuilderCategory[];
  collections: BuilderCollection[];
  productIndex: IndexedProduct[];
  initialAnswerId: string | null;
  onClose: () => void;
  commit: (doc: QuizDoc) => void;
}) {
  const toast = useQzToast();
  const boxRef = useRef<HTMLDivElement>(null);
  useFocusTrap(boxRef, true);

  // Esc priority (unified spec): menu > question window. A QzPopover's own
  // document listener registers AFTER this one, so checking the DOM here sees
  // the still-open popover and yields — the popover then closes itself.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (document.querySelector(".qz-popover")) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const answers = q.node.data.answers;
  const role = q.node.data.role;
  const total = productIndex.length;
  const [focusId, setFocusId] = useState<string | null>(initialAnswerId ?? answers[0]?.id ?? null);
  const [query, setQuery] = useState("");
  const [chip, setChip] = useState<"all" | Exclude<Badge, "set">>("all");

  const a = answers.find((x) => x.id === focusId) ?? answers[0] ?? null;

  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const colTitleById = useMemo(
    () => new Map(collections.map((c) => [c.collectionId, c.title])),
    [collections],
  );
  const productById = useMemo(
    () => new Map(productIndex.map((p) => [p.product_id, p])),
    [productIndex],
  );

  // ── the one resource index, window-shaped ─────────────────────────────────
  const fields = useMemo(() => narrowFieldOptions(productIndex), [productIndex]);
  const fvRows = useMemo<WinResource[]>(() => {
    const out: WinResource[] = [];
    for (const f of fields) {
      for (const v of fieldValues(productIndex, f.field)) {
        out.push({
          key: `fv:${f.field}:${v.value}`,
          item: { kind: "fv", field: f.field, value: v.value },
          badge: badgeForField(f.field),
          name: `${f.label} = ${v.label}`,
          short: v.label,
          count: v.count,
          field: f.field,
        });
      }
    }
    return out;
  }, [fields, productIndex]);
  const plainTagRows = useMemo<WinResource[]>(() => {
    // Family-shaped tags already surface as field values — listing them again
    // as raw tags would show the same value twice.
    const counts = new Map<string, { name: string; count: number }>();
    for (const p of productIndex) {
      for (const t of p.tags) {
        const k = t.trim();
        if (!k) continue;
        const i = k.indexOf(":");
        if (i > 0 && i < k.length - 1) continue;
        const e = counts.get(k);
        if (e) e.count++;
        else counts.set(k, { name: k, count: 1 });
      }
    }
    return [...counts.entries()]
      .map(([k, e]) => ({
        key: `tag:${k}`,
        item: { kind: "tag" as const, tag: e.name },
        badge: "tag" as const,
        name: e.name,
        short: e.name,
        count: e.count,
      }))
      .sort((x, y) => y.count - x.count || x.name.localeCompare(y.name));
  }, [productIndex]);
  const colRows = useMemo<WinResource[]>(() => {
    const counts = new Map<string, number>();
    for (const p of productIndex)
      for (const c of p.collection_ids) counts.set(c, (counts.get(c) ?? 0) + 1);
    return collections.map((c) => ({
      key: `col:${c.collectionId}`,
      item: { kind: "col" as const, id: c.collectionId },
      badge: "collection" as const,
      name: c.title,
      short: c.title,
      count: counts.get(c.collectionId) ?? 0,
    }));
  }, [collections, productIndex]);
  const allRows = useMemo(
    () => [...fvRows, ...colRows, ...plainTagRows],
    [fvRows, colRows, plainTagRows],
  );
  const rowByKey = useMemo(() => new Map(allRows.map((r) => [r.key, r])), [allRows]);

  // ONE resolver for every row's product popover (mirrors filterMatching's
  // case-insensitive semantics so counts and popovers can never disagree).
  const resolveRow = useMemo(() => {
    return (r: WinResource): IndexedProduct[] => {
      const it = r.item;
      if (it.kind === "col") return productIndex.filter((p) => p.collection_ids.includes(it.id));
      if (it.kind === "tag")
        return productIndex.filter((p) =>
          p.tags.some((x) => x.trim().toLowerCase() === it.tag.trim().toLowerCase()),
        );
      const { field, value } = it;
      if (field.startsWith("tag:")) {
        const family = field.slice(4).toLowerCase();
        return productIndex.filter((p) =>
          p.tags.some((t) => {
            const i = t.indexOf(":");
            return (
              i > 0 &&
              t.slice(0, i).trim().toLowerCase() === family &&
              t.slice(i + 1).trim().toLowerCase() === value
            );
          }),
        );
      }
      if (field.startsWith("mf:")) {
        const key = field.slice(3);
        return productIndex.filter(
          (p) => p.metafields?.[key]?.trim().toLowerCase() === value,
        );
      }
      if (field.startsWith("vo:")) {
        const name = field.slice(3);
        return productIndex.filter((p) =>
          (p.variant_options?.[name] ?? []).some((x) => x.trim().toLowerCase() === value),
        );
      }
      return productIndex.filter((p) => p.product_type?.trim().toLowerCase() === value);
    };
  }, [productIndex]);

  const catRows = useMemo<WinResource[]>(
    () =>
      categories.map((c) => ({
        key: `set:${c.id}`,
        item: { kind: "tag" as const, tag: c.id }, // never written — Sets go through setAnswerTarget
        badge: "set" as const,
        name: c.name,
        short: c.name,
        count: c.productIds.length,
      })),
    [categories],
  );
  const resolveCat = useMemo(() => {
    return (r: WinResource): IndexedProduct[] =>
      (catById.get(r.key.slice(4))?.productIds ?? [])
        .map((id) => productById.get(id))
        .filter((p): p is IndexedProduct => p !== undefined);
  }, [catById, productById]);

  // ── per-answer derivations ────────────────────────────────────────────────
  const selection = a ? answerSelection(a) : [];
  const selKeys = new Set(selection.map(itemKey));
  const isMapped = (x: Answer): boolean =>
    role === "decides"
      ? Boolean(x.target_id)
      : x.no_preference === true || answerSelection(x).length > 0;
  const mapped = answers.filter(isMapped).length;
  // Mock jobSpine — the automap offer counts UNMAPPED answers per role:
  // decides = no target (G9); filter = no values and not "keeps everything".
  const unmapped =
    role === "decides"
      ? answers.filter((x) => !x.target_id).length
      : answers.filter((x) => !x.no_preference && answerSelection(x).length === 0).length;

  const focusedCount = (() => {
    if (!a) return 0;
    if (role === "decides")
      return a.target_id ? (catById.get(a.target_id)?.productIds.length ?? 0) : 0;
    if (a.no_preference) return total;
    return filterAnswerMatchCount(a, productIndex) ?? 0;
  })();

  // ── writes (pure mutation → commit; live, no draft) ───────────────────────
  const writeSelection = (items: WinItem[]) => {
    if (!a) return;
    commit(setAnswerFilterValues(doc, q.node.id, a.id, payloadFor(items)));
  };
  const toggleItem = (it: WinItem) => {
    const key = itemKey(it);
    writeSelection(
      selKeys.has(key) ? selection.filter((x) => itemKey(x) !== key) : [...selection, it],
    );
  };
  const toggleAny = () => {
    if (!a) return;
    commit(
      setAnswerFilterValues(doc, q.node.id, a.id, a.no_preference ? {} : { no_preference: true }),
    );
  };
  const pickTarget = (catId: string) => {
    if (!a) return;
    // G9 — exactly ONE target per deciding answer; re-clicking clears.
    commit(setAnswerTarget(doc, q.node.id, a.id, a.target_id === catId ? null : catId));
  };
  const setJob = (job: (typeof JOBS)[number]["k"]) => {
    if (job === "decides") {
      if (role === "decides") return;
      const prev = questions.find((x) => x.node.data.role === "decides");
      commit(moveDecider(doc, q.node.id));
      if (prev && prev.node.id !== q.node.id)
        toast(
          `Starting set moved from "${stripQ(prev.node.data.text)}" to "${stripQ(q.node.data.text)}"`,
        );
      return;
    }
    if (job === "filter" && role === "filter") return;
    if (job === "info" && role !== "decides" && role !== "filter") return;
    commit(setQuestionRole(doc, q.node.id, job === "filter" ? "filter" : "qualifier"));
  };
  const autoMap = () => {
    // Deterministic map-for-me (no AI): one best guess per unmapped answer;
    // no undo — everything stays editable. Mock autoMapAll runs for BOTH
    // non-info roles: decides guesses a Set by name (G9 — one target),
    // filter guesses a field value.
    let n = 0;
    let next = doc;
    if (role === "decides") {
      for (const g of guessAnswerTargets(answers, categories)) {
        next = setAnswerTarget(next, q.node.id, g.answerId, g.categoryId);
        n++;
      }
    } else {
      for (const g of guessAnswerMappings(answers, productIndex)) {
        next = setAnswerFilterValues(next, q.node.id, g.answerId, writeValuesForField(g.field, [g.value]));
        n++;
      }
    }
    if (n === 0) {
      toast("Nothing obvious to map — pick them yourself");
      return;
    }
    commit(next);
    toast(`${n} answer${n === 1 ? "" : "s"} mapped — check them and change anything`);
  };

  // ── left bank ─────────────────────────────────────────────────────────────
  const keys = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const answerChips = (x: Answer): ReactNode => {
    if (role !== "decides" && role !== "filter")
      return <span className="qz-ltab-muted">not used for products</span>;
    if (role === "decides") {
      if (!x.target_id) return <span className="qz-ltab-muted">nothing yet</span>;
      const cat = catById.get(x.target_id);
      return <span className="qz-ltab-chip">{cat?.name ?? "(deleted target)"}</span>;
    }
    if (x.no_preference) return <span className="qz-ltab-muted">keeps everything</span>;
    const items = answerSelection(x);
    if (items.length === 0) return <span className="qz-ltab-muted">nothing yet</span>;
    return (
      <>
        {items.slice(0, 3).map((it) => {
          const key = itemKey(it);
          const row = rowByKey.get(key);
          if (it.kind === "fv")
            return (
              <span key={key} className={`qz-ltab-chip hue-${fieldHue(it.field)}`}>
                {row?.short ?? it.value}
              </span>
            );
          return (
            <span key={key} className="qz-ltab-chip">
              {it.kind === "col" ? (colTitleById.get(it.id) ?? it.id) : it.tag}
            </span>
          );
        })}
        {items.length > 3 ? <span className="qz-ltab-soft">+{items.length - 3}</span> : null}
      </>
    );
  };
  const answerCount = (x: Answer): { text: string; bad: boolean } | null => {
    if (role !== "decides" && role !== "filter") return null;
    if (role === "decides") {
      const n = x.target_id ? (catById.get(x.target_id)?.productIds.length ?? 0) : 0;
      return { text: `${n} ${n === 1 ? "product" : "products"}`, bad: n === 0 };
    }
    if (x.no_preference) return { text: `all ${total}`, bad: false };
    const n = filterAnswerMatchCount(x, productIndex);
    if (n === null) return { text: "not set", bad: true };
    return { text: `${n} / ${total}`, bad: n === 0 };
  };

  // ── right bank content (filter role) ──────────────────────────────────────
  const qlc = query.trim().toLowerCase();
  const suggested = useMemo<WinResource[]>(() => {
    if (!a || role !== "filter") return [];
    // The strongest suggestion is consistency: whatever field the OTHER
    // answers on this question already use, offer its remaining values first…
    const sibFields = new Set<string>();
    for (const o of answers) {
      if (o.id === a.id) continue;
      for (const it of answerSelection(o)) if (it.kind === "fv") sibFields.add(it.field);
    }
    const out: WinResource[] = [];
    const seen = new Set(selKeys);
    for (const r of fvRows) {
      if (out.length >= 8) break;
      if (r.field && sibFields.has(r.field) && !seen.has(r.key)) {
        seen.add(r.key);
        out.push(r);
      }
    }
    // …and after that, the answer's own words (word-boundary only).
    const text = a.text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (text && out.length < 8) {
      const words = text.split(" ").filter((w) => w.length > 2);
      const scored: Array<{ r: WinResource; s: number }> = [];
      for (const r of fvRows) {
        if (seen.has(r.key)) continue;
        const it = r.item;
        const value = it.kind === "fv" ? it.value : "";
        const nm = r.name.toLowerCase();
        let s = 0;
        if (value === text) s = 100;
        else if (nm === text) s = 95;
        else if (wordRe(text).test(nm)) s = 70;
        else {
          const hits = words.filter((w) => wordRe(w).test(nm)).length;
          if (hits) s = 35 + hits * 10;
        }
        if (s) scored.push({ r, s });
      }
      scored.sort((x, y) => y.s - x.s || y.r.count - x.r.count);
      for (const { r } of scored) {
        if (out.length >= 8) break;
        seen.add(r.key);
        out.push(r);
      }
    }
    return out;
    // selKeys is derived from `a` + doc — a's identity captures it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a, role, answers, fvRows]);

  const renderGroup = (title: ReactNode, list: WinResource[], cap: number) => {
    if (list.length === 0) return null;
    return (
      <>
        <div className="qz-ltab-menu-group">{title}</div>
        {list.slice(0, cap).map((r) => (
          <WinRow
            key={r.key}
            r={r}
            on={selKeys.has(r.key)}
            onToggle={() => toggleItem(r.item)}
            resolve={resolveRow}
          />
        ))}
        {list.length > cap ? (
          <div className="qz-ltab-menu-none">+{list.length - cap} more — keep typing to narrow</div>
        ) : null}
      </>
    );
  };

  const filterBank = (): ReactNode => {
    if (!a) return null;
    const anyRow = (
      <button
        type="button"
        className={`qz-qwin-any${a.no_preference ? " is-on" : ""}`}
        onClick={toggleAny}
      >
        <span className="qz-crm-kind">Any</span>
        <span>Keeps everything</span>
        <span className="qz-qwin-anysub">this answer never narrows</span>
        <span className="qz-crm-rescheck" aria-hidden>
          {a.no_preference ? "✓" : ""}
        </span>
      </button>
    );
    if (a.no_preference) return anyRow;
    const selectedRows = selection.map(
      (it) =>
        rowByKey.get(itemKey(it)) ??
        ({
          key: itemKey(it),
          item: it,
          badge: it.kind === "col" ? "collection" : it.kind === "fv" ? badgeForField(it.field) : "tag",
          name:
            it.kind === "col"
              ? (colTitleById.get(it.id) ?? it.id)
              : it.kind === "fv"
                ? it.value
                : it.tag,
          short: it.kind === "col" ? (colTitleById.get(it.id) ?? it.id) : it.kind === "fv" ? it.value : it.tag,
          count: 0,
        } satisfies WinResource),
    );
    const selectedGroup = selection.length
      ? renderGroup(`Selected (${selection.length})`, selectedRows, selectedRows.length)
      : null;
    // THE RESTING STATE MATTERS: with nothing typed the column already shows
    // what a narrowing answer is nearly always pointed at — this shop's field
    // values and collections. Tags stay one keystroke away.
    if (!qlc && chip === "all") {
      const shown = new Set([...selKeys, ...suggested.map((r) => r.key)]);
      const restingFv = fvRows.filter((r) => !shown.has(r.key));
      const restingCols = colRows.filter((r) => !shown.has(r.key));
      const rest =
        plainTagRows.length + Math.max(0, restingFv.length - 40) + Math.max(0, restingCols.length - 40);
      // QRTZ-D2 (mock .ap; GAPS §C1) — the resting field values group PER
      // FIELD, so the header teaches coverage at the moment of choice: source
      // key · covered/total · the low-coverage flag (<50% — an attribute most
      // products lack silently drops the rest from every result). Same rows,
      // same toggles, same 40-row budget as the old flat "Field values" group.
      const fieldGroups: ReactNode[] = [];
      let fvBudget = 40;
      for (const f of fields) {
        if (fvBudget <= 0) break;
        const list = restingFv.filter((r) => r.field === f.field);
        if (list.length === 0) continue;
        const take = list.slice(0, fvBudget);
        fvBudget -= take.length;
        const thin = total > 0 && f.coverage / total < 0.5;
        const key = f.field === "ptype" ? null : f.field.replace(/^(mf|tag|vo):/, "");
        const showKey = key && key.toLowerCase() !== f.label.toLowerCase() ? key : null;
        fieldGroups.push(
          <span key={f.field}>
            {renderGroup(
              <>
                {f.label}
                <span className={`qz-qwin-covkey${thin ? " qz-ltab-menu-covthin" : ""}`}>
                  {showKey ? `${showKey} · ` : ""}
                  {f.coverage}/{total}
                </span>
                {thin ? <span className="qz-ltab-menu-thin">low coverage</span> : null}
              </>,
              take,
              take.length,
            )}
          </span>,
        );
      }
      return (
        <>
          {anyRow}
          {selectedGroup}
          {renderGroup(`Suggested for "${a.text}"`, suggested, 8)}
          {fieldGroups}
          {renderGroup("Collections", restingCols, 40)}
          {rest > 0 ? (
            <div className="qz-qwin-note">Type to search {rest} more — every tag.</div>
          ) : null}
        </>
      );
    }
    const hits = allRows.filter((r) => {
      if (chip !== "all" && r.badge !== chip) return false;
      if (selKeys.has(r.key)) return false;
      return !qlc || r.name.toLowerCase().includes(qlc);
    });
    if (hits.length === 0)
      return (
        <>
          {anyRow}
          {selectedGroup}
          <div className="qz-ltab-menu-none">Nothing matches{query ? ` "${query.trim()}"` : ""}.</div>
        </>
      );
    const cap = qlc ? 12 : 40;
    return (
      <>
        {anyRow}
        {selectedGroup}
        {(["collection", "tag", "metafield", "variant", "type"] as const).map((k) => (
          <span key={k}>
            {renderGroup(
              BADGE_GROUP[k],
              hits.filter((r) => r.badge === k),
              cap,
            )}
          </span>
        ))}
      </>
    );
  };

  const decidesBank = (): ReactNode => {
    if (!a) return null;
    const shown = catRows.filter((r) => !qlc || r.name.toLowerCase().includes(qlc));
    if (shown.length === 0)
      return (
        <div className="qz-ltab-menu-none">Nothing matches{query ? ` "${query.trim()}"` : ""}.</div>
      );
    return shown.map((r) => (
      <WinRow
        key={r.key}
        r={r}
        on={a.target_id === r.key.slice(4)}
        onToggle={() => pickTarget(r.key.slice(4))}
        resolve={resolveCat}
      />
    ));
  };

  // ── footer sentence + impact ──────────────────────────────────────────────
  const sentence = (): ReactNode => {
    if (!a) return null;
    const nm = <b>&quot;{a.text}&quot;</b>;
    if (role !== "decides" && role !== "filter")
      return <>{nm} is asked, but never touches products.</>;
    if (role === "decides") {
      if (!a.target_id) return <>{nm} opens <span className="qz-ltab-muted">nothing yet</span>.</>;
      const cat = catById.get(a.target_id);
      return (
        <>
          {nm} opens <b>{cat?.name ?? "(deleted target)"}</b>.
        </>
      );
    }
    if (a.no_preference) return <>{nm} keeps everything.</>;
    if (selection.length === 0)
      return (
        <>
          {nm} keeps <span className="qz-ltab-muted">nothing yet</span> — pick what it should
          match.
        </>
      );
    return (
      <>
        {nm} keeps{" "}
        {joinNames(
          selection.map((it) => {
            const row = rowByKey.get(itemKey(it));
            const label =
              row?.short ??
              (it.kind === "col"
                ? (colTitleById.get(it.id) ?? it.id)
                : it.kind === "fv"
                  ? it.value
                  : it.tag);
            return <b key={itemKey(it)}>{label}</b>;
          }),
        )}
        .
      </>
    );
  };

  if (typeof document === "undefined") return null;

  const decider = questions.find((x) => x.node.data.role === "decides");
  const cannotDecide =
    q.node.data.question_type === "multi_select" || isFreeformType(q.node.data.question_type);
  const chipCounts: Record<Exclude<Badge, "set">, number> = {
    tag: allRows.filter((r) => r.badge === "tag").length,
    collection: colRows.length,
    metafield: allRows.filter((r) => r.badge === "metafield").length,
    variant: allRows.filter((r) => r.badge === "variant").length,
    type: allRows.filter((r) => r.badge === "type").length,
  };
  const bankTitle =
    role === "decides" ? "What it opens" : role === "filter" ? "What it keeps" : "Not used";
  const infoRole = role !== "decides" && role !== "filter";

  return createPortal(
    // Same shell contract as Create-a-rule (§4.5): the scrim deliberately does
    // NOT close; Esc is the document listener above; "Done" closes.
    <div className="qz-modal-scrim">
      <div
        ref={boxRef}
        className="qz-crm qz-qwin"
        role="dialog"
        aria-modal="true"
        aria-label={stripQ(q.node.data.text)}
      >
        <header className="qz-crm-hd">
          <h2>{stripQ(q.node.data.text)}</h2>
          <span className="qz-crm-hint">
            Pick an answer on the left, then say what it means on the right.
          </span>
          {/* Live edits — every click already committed; no cancel. */}
          <button type="button" className="qz-btn qz-btn-primary" onClick={onClose}>
            Done
          </button>
        </header>
        <div className="qz-crm-cols">
          {/* ── left: ANSWERS ── */}
          <section className="qz-crm-col">
            <div className="qz-crm-colhd">
              Answers
              {infoRole ? (
                <span className="qz-crm-count is-zero">nothing to map</span>
              ) : (
                <span className={`qz-crm-count${mapped === answers.length ? "" : " is-zero"}`}>
                  {mapped} of {answers.length} mapped
                </span>
              )}
            </div>
            <div className="qz-crm-scroll">
              {answers.length === 0 ? (
                <div className="qz-ltab-menu-none">no answer options</div>
              ) : (
                answers.map((x, i) => {
                  const c = answerCount(x);
                  return (
                    <button
                      key={x.id}
                      type="button"
                      className={`qz-qwin-arow${a?.id === x.id ? " is-on" : ""}`}
                      onClick={() => setFocusId(x.id)}
                    >
                      <span className="qz-qwin-akey">{keys[i] ?? i + 1}</span>
                      <span className="qz-qwin-atext" title={x.text}>
                        {x.text}
                      </span>
                      <span className="qz-qwin-amap">{answerChips(x)}</span>
                      <span className={`qz-qwin-acount${c?.bad ? " is-bad" : ""}`}>
                        {c ? c.text : "·"}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </section>

          {/* ── spine: THIS QUESTION ── */}
          <section className="qz-crm-col qz-crm-verbs">
            <div className="qz-crm-colhd">This question</div>
            {JOBS.map((j) => {
              const on =
                j.k === "decides"
                  ? role === "decides"
                  : j.k === "filter"
                    ? role === "filter"
                    : infoRole;
              const sub =
                j.k === "decides" && decider && decider.node.id !== q.node.id
                  ? `${j.hint} · now on Q${decider.qIndex}`
                  : j.hint;
              return (
                <button
                  key={j.k}
                  type="button"
                  className={`qz-crm-verb${on ? " is-on" : ""}`}
                  disabled={j.k === "decides" && cannotDecide}
                  onClick={() => setJob(j.k)}
                >
                  <b>
                    {j.k === "decides" ? "◆ " : ""}
                    {j.n}
                  </b>
                  <span>{j.k === "decides" && cannotDecide ? "needs single-answer choices" : sub}</span>
                </button>
              );
            })}
            {role === "filter" ? (
              // A readout, never a control — the field is DERIVED, not chosen.
              <div className="qz-qwin-derived">
                narrows by <b>{derivedNarrowLabel(answers)}</b>
              </div>
            ) : null}
            {/* Mock jobSpine — offered for every non-info role. */}
            {!infoRole && unmapped > 0 ? (
              <button type="button" className="qz-qwin-automap" onClick={autoMap}>
                Map {unmapped} answer{unmapped === 1 ? "" : "s"} for me
              </button>
            ) : null}
            {/* QRTZ-D2 (mock .pop-foot; GAPS §C1) — the one-decider rule in
                the product's locked vocabulary, re-homed from the orphaned S6
                role menu. */}
            <div className="qz-qwin-rolefoot">
              One question picks the starting set. Every other narrows on a
              single product attribute.
            </div>
          </section>

          {/* ── right: the one index, per role ── */}
          <section className="qz-crm-col">
            <div className="qz-crm-colhd">
              {bankTitle}
              <span
                className={`qz-crm-count${
                  infoRole || (!a?.no_preference && role === "decides" && !a?.target_id) ||
                  (role === "filter" && !a?.no_preference && selection.length === 0)
                    ? " is-zero"
                    : ""
                }`}
              >
                {infoRole
                  ? "—"
                  : `${focusedCount} ${focusedCount === 1 ? "product" : "products"}`}
              </span>
            </div>
            {infoRole ? (
              <div className="qz-qwin-infomsg">
                This question is asked and recorded, but it never touches the products. Switch it
                to <b>Narrows</b> or <b>Starting set</b> in the middle column and everything you
                mapped before comes back.
              </div>
            ) : (
              <>
                <input
                  className="qz-ltab-menu-search"
                  placeholder="Search…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {role === "filter" ? (
                  <div className="qz-ltab-menu-chips">
                    {(
                      [
                        ["all", "All", allRows.length],
                        ["tag", "Tags", chipCounts.tag],
                        ["collection", "Collections", chipCounts.collection],
                        ["metafield", "Metafields", chipCounts.metafield],
                        ["variant", "Variant options", chipCounts.variant],
                        ["type", "Type", chipCounts.type],
                      ] as const
                    ).map(([k, l, n]) => (
                      <button
                        key={k}
                        type="button"
                        className={`qz-ltab-menu-chip${chip === k ? " is-on" : ""}`}
                        onClick={() => setChip(k)}
                      >
                        {l}
                        <span className="qz-qwin-chipn">{n}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="qz-crm-scroll">
                  {role === "decides" ? decidesBank() : filterBank()}
                </div>
                {/* QRTZ-D2 (mock .ap-foot; GAPS §C1) — informational only:
                    the window click-commits, so no Cancel/Use pair. */}
                {role === "filter" ? (
                  <div className="qz-qwin-covfoot">
                    <span className="qz-ltab-menu-apnote">
                      <b>Coverage matters:</b> a question can only narrow by
                      data your products actually have.
                    </span>
                  </div>
                ) : null}
              </>
            )}
          </section>
        </div>

        {/* ── footer: the read-back + impact ── */}
        <footer className="qz-crm-ft">
          <p className="qz-crm-sentence">{sentence()}</p>
          {a && !infoRole ? (
            <span className="qz-crm-impact">
              {role === "decides" ? (
                <>
                  <b>{focusedCount}</b> in this group
                </>
              ) : (
                <>
                  <b>{focusedCount}</b> of {total} kept
                </>
              )}
            </span>
          ) : null}
        </footer>
      </div>
    </div>,
    document.body,
  );
}
