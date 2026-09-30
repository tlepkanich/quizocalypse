import { useEffect, useMemo, useState } from "react";
import type { ReactNode, RefObject } from "react";
import type { Answer } from "../../../lib/quizSchema";
import type { IndexedProduct } from "../../../lib/recommendationEngine";
import type {
  AttributeReadout,
  AttributeSourceKind,
  CatalogAttribute,
} from "../../../lib/attributeClustering";
import { attributeValueProductIds } from "../../../lib/attributeClustering";
import { QzPopover } from "../../qz-overlays";
import { VALUE_COPY } from "./logicCopy";

// ════════════════════════════════════════════════════════════════════════════
// The value picker on a Narrows cell (mock vpHTML; handoff "Value picker").
//   "<answer> · keeps" · search (focused on open) · pill tabs All / Tags /
//   Metafields / Variants / Product types with counts · "Keeps everything ·
//   no narrowing" · groups by attribute with Select all / Clear all ·
//   checkbox rows with "N products" (the › drill-in, D19) · foot
//   "Keeps everything" / "N selected · U of T products" / "Nothing selected"
//   · Cancel · Done.
//
// STAGED: nothing is written until Done. Done writes ONE full-set payload:
// `{no_preference: true}` when Keeps everything is on (that clears every
// stored value, collection filters included); otherwise the picked values,
// each written under EVERY member source of its attribute — tag_family F →
// tag "F:value"; metafield K → {key, value}; variant_option N → {name,
// value}; product_type → product_type_filters — with the EXACT baked key
// casing (the read-out lowercases keys, but the runtime matcher reads
// metafield keys and option names raw), plus every stored value the picker
// does NOT manage (collection filters, bare tags, off-readout values)
// carried through untouched. Cancel, Esc and an outside click discard.
// ════════════════════════════════════════════════════════════════════════════

type AnswerT = Answer;

/** The full-set payload shape setAnswerFilterValues expects. */
export interface FilterValueSet {
  tags: string[];
  collection_filters?: string[];
  metafield_filters?: Array<{ key: string; value: string }>;
  variant_filters?: Array<{ name: string; value: string }>;
  product_type_filters?: string[];
  /** "Keeps everything": clears every value (setAnswerFilterValues). */
  no_preference?: boolean;
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const lower = (s: string) => s.trim().toLowerCase();

/** Does the answer currently store `value` under any member source of `attr`? */
function answerHasAttrValue(a: AnswerT, attr: CatalogAttribute, value: string): boolean {
  for (const m of attr.members) {
    if (m.kind === "tag_family") {
      for (const t of a.tags) {
        const i = t.indexOf(":");
        if (i <= 0) continue;
        if (lower(t.slice(0, i)) === m.key && lower(t.slice(i + 1)) === value) return true;
      }
    } else if (m.kind === "metafield") {
      if ((a.metafield_filters ?? []).some((f) => lower(f.key) === m.key && lower(f.value) === value))
        return true;
    } else if (m.kind === "variant_option") {
      if ((a.variant_filters ?? []).some((f) => lower(f.name) === m.key && lower(f.value) === value))
        return true;
    } else if ((a.product_type_filters ?? []).some((p) => lower(p) === value)) {
      return true;
    }
  }
  return false;
}

type Tab = AttributeSourceKind | "all";
const TABS: Tab[] = ["all", "tag_family", "metafield", "variant_option", "product_type"];

/** The group heading (mock .vpg): "Tag · Material", "Metafield · Skin type",
 *  "Variant · Size", "Product type". */
/** An attribute's identity: its primary source (kind + key). */
function attrId(attr: CatalogAttribute): string {
  return `${attr.primary.kind}:${attr.primary.key}`;
}
/** A staged pick: attribute identity + value ("\n" never occurs in either). */
function pickKey(attr: CatalogAttribute, value: string): string {
  return `${attrId(attr)}\n${value}`;
}
function splitPickKey(key: string): { id: string; value: string } {
  const at = key.indexOf("\n");
  return { id: key.slice(0, at), value: key.slice(at + 1) };
}

function groupLabel(attr: CatalogAttribute): string {
  const kind = attr.primary.kind;
  if (kind === "product_type") return VALUE_COPY.group.product_type;
  return `${VALUE_COPY.group[kind]} · ${attr.name}`;
}

export function ValuePickerPopover({
  trigger,
  answer,
  siblingAnswers,
  readout,
  productIndex,
  onApply,
  open: controlledOpen,
  onOpenChange,
  anchorRef,
}: {
  /** The mapping cell (QzPopover anchors it). */
  trigger: ReactNode;
  /** The mapping CELL is the control (a div role=button that must open from
   *  the keyboard), so the widget drives the open state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  anchorRef?: RefObject<HTMLElement | null>;
  answer: AnswerT;
  /** The question's OTHER answers — the attribute they already use leads. */
  siblingAnswers: readonly AnswerT[];
  readout: AttributeReadout;
  productIndex: readonly IndexedProduct[];
  /** Done — the ONE full-set write (parent commits setAnswerFilterValues). */
  onApply: (values: FilterValueSet) => void;
}) {
  const [uncontrolled, setUncontrolled] = useState(false);
  const open = controlledOpen ?? uncontrolled;
  const setOpen = (next: boolean) => {
    onOpenChange?.(next);
    if (controlledOpen === undefined) setUncontrolled(next);
  };
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  // The › drill-in: the products carrying one value, in place (D19).
  const [drill, setDrill] = useState<{ attr: CatalogAttribute; value: string } | null>(null);
  // Selection keyed by the attribute's IDENTITY and the value (the same
  // value can exist under two attributes — "silver" as Material and as
  // Color). Never by position: a readout rebuilt while the picker is open
  // must not move a staged pick onto another attribute.
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [keepsAll, setKeepsAll] = useState(false);

  const attributes = readout.attributes;
  const attrById = useMemo(() => new Map(attributes.map((a) => [attrId(a), a])), [attributes]);

  // Exact baked key casing for the write path (see the header note).
  const exactKeys = useMemo(() => {
    const mf = new Map<string, string>();
    const vo = new Map<string, string>();
    for (const p of productIndex) {
      for (const k of Object.keys(p.metafields ?? {})) {
        const l = lower(k);
        if (!mf.has(l)) mf.set(l, k);
      }
      for (const n of Object.keys(p.variant_options ?? {})) {
        const l = lower(n);
        if (!vo.has(l)) vo.set(l, n);
      }
    }
    return { mf, vo };
  }, [productIndex]);

  // (Re)seed the draft from the answer's CURRENT values on every open.
  useEffect(() => {
    if (!open) return;
    const next = new Set<string>();
    for (const attr of attributes) {
      for (const v of attr.values) {
        if (answerHasAttrValue(answer, attr, v.value)) next.add(pickKey(attr, v.value));
      }
    }
    setPicked(next);
    setKeepsAll(answer.no_preference === true);
    setSearch("");
    setTab("all");
    setDrill(null);
    // Seed on OPEN only: a commit elsewhere while the picker is open must
    // never wipe the staged draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // The attribute the question's OTHER answers already use first, then the
  // rest in read-out (grade) order.
  const order = useMemo(() => {
    const idx = attributes.map((_, i) => i);
    let leadIndex = -1;
    outer: for (const [i, attr] of attributes.entries()) {
      for (const sib of siblingAnswers) {
        if (sib.id === answer.id) continue;
        for (const v of attr.values) {
          if (answerHasAttrValue(sib, attr, v.value)) {
            leadIndex = i;
            break outer;
          }
        }
      }
    }
    if (leadIndex <= 0) return idx;
    return [leadIndex, ...idx.filter((i) => i !== leadIndex)];
  }, [attributes, siblingAnswers, answer]);

  // Tab counts ignore the search: distinct values across the attributes
  // carrying a member of that kind (All = every attribute).
  const tabCounts = useMemo(() => {
    const counts = new Map<Tab, number>();
    for (const t of TABS) {
      let n = 0;
      for (const attr of attributes) {
        if (t === "all" || attr.members.some((m) => m.kind === t)) n += attr.distinctValues;
      }
      counts.set(t, n);
    }
    return counts;
  }, [attributes]);

  const q = lower(search);
  const visibleGroups = order
    .map((ai) => {
      const attr = attributes[ai]!;
      if (tab !== "all" && !attr.members.some((m) => m.kind === tab)) return null;
      const nameHit = !!q && lower(attr.name).includes(q);
      const values = attr.values.filter((v) => !q || nameHit || v.value.includes(q));
      if (values.length === 0) return null;
      return { ai, attr, values };
    })
    .filter((g): g is { ai: number; attr: CatalogAttribute; values: CatalogAttribute["values"] } => g !== null);

  const toggle = (ai: number, value: string) => {
    setKeepsAll(false);
    setPicked((prev) => {
      const next = new Set(prev);
      const key = pickKey(attributes[ai]!, value);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Select all / Clear all act only on the values visible under the search.
  const toggleAll = (ai: number, values: CatalogAttribute["values"]) => {
    setKeepsAll(false);
    setPicked((prev) => {
      const next = new Set(prev);
      const keys = values.map((v) => pickKey(attributes[ai]!, v.value));
      const allOn = keys.every((k) => next.has(k));
      for (const k of keys) {
        if (allOn) next.delete(k);
        else next.add(k);
      }
      return next;
    });
  };

  const toggleKeepsAll = () => {
    const next = !keepsAll;
    setKeepsAll(next);
    if (next) setPicked(new Set());
  };

  // Footer — the UNION across every selected value (25 of 28, never 24+1+1).
  const union = useMemo(() => {
    const ids = new Set<string>();
    for (const key of picked) {
      const { id, value } = splitPickKey(key);
      const attr = attrById.get(id);
      if (!attr) continue;
      for (const pid of attributeValueProductIds(productIndex, attr, value)) ids.add(pid);
    }
    return ids.size;
  }, [picked, attrById, productIndex]);

  const buildPayload = (): FilterValueSet => {
    if (keepsAll) return { tags: [], no_preference: true };
    // Which (source, value) pairs the picker manages — everything else on the
    // answer is carried through untouched.
    const managed = (kind: AttributeSourceKind, key: string, value: string): boolean =>
      attributes.some(
        (attr) =>
          attr.members.some((m) => m.kind === kind && m.key === key) &&
          attr.values.some((v) => v.value === value),
      );

    const tags: string[] = [];
    const metafield_filters: Array<{ key: string; value: string }> = [];
    const variant_filters: Array<{ name: string; value: string }> = [];
    const product_type_filters: string[] = [];

    for (const t of answer.tags) {
      const i = t.indexOf(":");
      const fam = i > 0 ? lower(t.slice(0, i)) : "";
      const val = i > 0 ? lower(t.slice(i + 1)) : "";
      if (!(fam && managed("tag_family", fam, val))) tags.push(t);
    }
    for (const f of answer.metafield_filters ?? []) {
      if (!managed("metafield", lower(f.key), lower(f.value))) metafield_filters.push(f);
    }
    for (const f of answer.variant_filters ?? []) {
      if (!managed("variant_option", lower(f.name), lower(f.value))) variant_filters.push(f);
    }
    for (const p of answer.product_type_filters ?? []) {
      if (!managed("product_type", "product_type", lower(p))) product_type_filters.push(p);
    }

    for (const key of picked) {
      const { id, value } = splitPickKey(key);
      const attr = attrById.get(id);
      if (!attr) continue;
      for (const m of attr.members) {
        if (m.kind === "tag_family") {
          const tag = `${m.key}:${value}`;
          if (!tags.some((t) => lower(t) === tag)) tags.push(tag);
        } else if (m.kind === "metafield") {
          const exact = exactKeys.mf.get(m.key);
          if (!exact) continue;
          if (!metafield_filters.some((f) => lower(f.key) === m.key && lower(f.value) === value))
            metafield_filters.push({ key: exact, value });
        } else if (m.kind === "variant_option") {
          const exact = exactKeys.vo.get(m.key);
          if (!exact) continue;
          if (!variant_filters.some((f) => lower(f.name) === m.key && lower(f.value) === value))
            variant_filters.push({ name: exact, value });
        } else if (!product_type_filters.some((p) => lower(p) === value)) {
          product_type_filters.push(value);
        }
      }
    }

    const collection_filters = [
      ...(answer.collection_filter ? [answer.collection_filter] : []),
      ...(answer.collection_filters ?? []),
    ].filter((c, i, all) => Boolean(c) && all.indexOf(c) === i);

    return {
      tags,
      ...(collection_filters.length ? { collection_filters } : {}),
      ...(metafield_filters.length ? { metafield_filters } : {}),
      ...(variant_filters.length ? { variant_filters } : {}),
      ...(product_type_filters.length ? { product_type_filters } : {}),
    };
  };

  const title = VALUE_COPY.title(answer.text);
  return (
    <QzPopover
      open={open}
      onOpenChange={setOpen}
      width={370}
      maxWidth={370}
      manageFocus
      closeOnAnchorHidden
      ariaLabel={title}
      className="qz-lg-pop"
      offset={6}
      trigger={trigger}
      anchorRef={anchorRef}
      content={
        drill ? (
          <DrillView
            attr={drill.attr}
            value={drill.value}
            productIndex={productIndex}
            onBack={() => setDrill(null)}
          />
        ) : (
          <div className="qz-lg-vp" data-testid="value-picker">
            <div className="qz-lg-pt">{title}</div>
            <div className="qz-lg-vptools qz-lg-vptools--rule">
              <input
                className="qz-lg-vpsearch"
                type="search"
                placeholder={VALUE_COPY.search}
                aria-label={VALUE_COPY.searchLabel}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="qz-lg-vptabs" role="group" aria-label={VALUE_COPY.tabsLabel}>
                {TABS.filter((t) => t === "all" || (tabCounts.get(t) ?? 0) > 0).map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={tab === t}
                    onClick={() => setTab(t)}
                  >
                    {VALUE_COPY.tabs[t]}
                    <span className="qz-lg-vptab-c">{tabCounts.get(t) ?? 0}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="qz-lg-vplist" data-qz-pop-list>
              {tab === "all" && !q ? (
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={keepsAll}
                  className={`qz-lg-mi${keepsAll ? " is-on" : ""}`}
                  data-vp-keeps
                  onClick={toggleKeepsAll}
                >
                  <span className="qz-lg-ck" aria-hidden>
                    {keepsAll ? "✓" : ""}
                  </span>
                  <span className="qz-lg-mi-n">{VALUE_COPY.keepsEverything}</span>
                  <span className="qz-lg-mi-h">{VALUE_COPY.noNarrowing}</span>
                </button>
              ) : null}
              {visibleGroups.length === 0 ? (
                <p className="qz-lg-vpnone">
                  {attributes.length === 0 ? VALUE_COPY.none : VALUE_COPY.nothingMatches(search.trim())}
                </p>
              ) : (
                visibleGroups.map(({ ai, attr, values }) => {
                  const allOn = values.every((v) => picked.has(pickKey(attr, v.value)));
                  return (
                    <div key={attr.name + String(ai)} role="group" aria-label={groupLabel(attr)}>
                      <div className="qz-lg-vpg">
                        <span>{groupLabel(attr)}</span>
                        <button
                          type="button"
                          className="qz-lg-vpall"
                          onClick={() => toggleAll(ai, values)}
                        >
                          {allOn ? VALUE_COPY.clearAll : VALUE_COPY.selectAll}
                        </button>
                      </div>
                      {values.map((v) => {
                        const on = picked.has(pickKey(attr, v.value));
                        return (
                          <div key={v.value} className="qz-lg-vprow">
                            <button
                              type="button"
                              role="checkbox"
                              aria-checked={on}
                              className={`qz-lg-mi${on ? " is-on" : ""}`}
                              onClick={() => toggle(ai, v.value)}
                            >
                              <span className="qz-lg-ck" aria-hidden>
                                {on ? "✓" : ""}
                              </span>
                              <span className="qz-lg-mi-n">{cap(v.value)}</span>
                            </button>
                            <button
                              type="button"
                              className="qz-lg-vpdrill"
                              aria-label={VALUE_COPY.drill(v.count, v.value)}
                              onClick={() => setDrill({ attr, value: v.value })}
                            >
                              {VALUE_COPY.products(v.count)}
                              <span aria-hidden> ›</span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  );
                })
              )}
            </div>
            <div className="qz-lg-vpfoot">
              <span aria-live="polite">
                {keepsAll ? (
                  VALUE_COPY.keepsEverything
                ) : picked.size ? (
                  <>
                    <b>{picked.size}</b> selected · {VALUE_COPY.union(union, productIndex.length)}
                  </>
                ) : (
                  VALUE_COPY.nothingSelected
                )}
              </span>
              {/* Ticking stages; Done writes; Cancel discards (closing the
                  popover drops the draft — nothing was written). */}
              <button type="button" className="qz-lg-btn is-ghost" onClick={() => setOpen(false)}>
                {VALUE_COPY.cancel}
              </button>
              <button
                type="button"
                className="qz-lg-btn is-pri"
                onClick={() => {
                  onApply(buildPayload());
                  setOpen(false);
                }}
              >
                {VALUE_COPY.done}
              </button>
            </div>
          </div>
        )
      }
    />
  );
}

// The › drill-in: the products behind one value, then ‹ Back.
function DrillView({
  attr,
  value,
  productIndex,
  onBack,
}: {
  attr: CatalogAttribute;
  value: string;
  productIndex: readonly IndexedProduct[];
  onBack: () => void;
}) {
  const ids = attributeValueProductIds(productIndex, attr, value);
  const rows = productIndex.filter((p) => ids.has(p.product_id));
  const shown = rows.slice(0, 14);
  return (
    <div className="qz-lg-vp">
      <div className="qz-lg-pt">
        {cap(value)} <span className="qz-lg-pt-sub">· {VALUE_COPY.products(ids.size)}</span>
      </div>
      <div className="qz-lg-vplist" data-qz-pop-list>
        {shown.length === 0 ? (
          <p className="qz-lg-vpnone">{VALUE_COPY.noProducts}</p>
        ) : (
          shown.map((p) => (
            <div key={p.product_id} className="qz-lg-pp">
              {p.image_url ? (
                <img className="qz-lg-pp-sw" src={p.image_url} alt="" loading="lazy" />
              ) : (
                <span className="qz-lg-pp-sw" aria-hidden />
              )}
              <span className="qz-lg-pp-nm">{p.title}</span>
              {p.product_type ? <span className="qz-lg-pp-ty">{p.product_type}</span> : null}
            </div>
          ))
        )}
        {rows.length > shown.length ? (
          <p className="qz-lg-vpnone">
            Showing {shown.length} of {rows.length}
          </p>
        ) : null}
      </div>
      <div className="qz-lg-vpfoot">
        <span />
        <button type="button" className="qz-lg-btn" onClick={onBack}>
          {VALUE_COPY.back}
        </button>
      </div>
    </div>
  );
}
