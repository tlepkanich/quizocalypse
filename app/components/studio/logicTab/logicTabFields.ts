import type { z } from "zod";
import type { Answer } from "../../../lib/quizSchema";
import type { IndexedProduct } from "../../../lib/recommendationEngine";

type AnswerT = z.infer<typeof Answer>;

// ════════════════════════════════════════════════════════════════════════════
// Logic tab (HANDOFF §6.1/§6.3 + DECISIONS G5) — pure derivations for "field
// mode" narrowing. A field is a namespaced key over the DRAFT product index:
//   "tag:<family>"  — tags shaped "<family>:<value>" ("fit:slim" → family fit)
//   "mf:<key>"      — a baked product metafield key
// Variant options / product type / price bands are NOT offered (G5 — the
// engine cannot honour them; a silently-ignored field looks identical to one
// that matches everything). Pure — no React, unit-tested.
// ════════════════════════════════════════════════════════════════════════════

export interface NarrowFieldOption {
  /** Namespaced field key ("tag:fit" | "mf:custom.gender"). */
  field: string;
  /** Display label ("Fit" | "gender"). */
  label: string;
  kind: "tag" | "metafield";
  /** Products carrying ANY value of this field. */
  coverage: number;
  /** Distinct values. */
  valueCount: number;
}

const label = (raw: string): string => {
  const last = raw.split(".").pop() ?? raw;
  return last.charAt(0).toUpperCase() + last.slice(1);
};

/** Every field the catalogue can narrow by, coverage-sorted (best first). */
export function narrowFieldOptions(
  productIndex: readonly IndexedProduct[],
): NarrowFieldOption[] {
  const tagFamilies = new Map<string, { products: Set<string>; values: Set<string> }>();
  const metafields = new Map<string, { products: Set<string>; values: Set<string> }>();
  for (const p of productIndex) {
    for (const t of p.tags) {
      const i = t.indexOf(":");
      if (i <= 0 || i === t.length - 1) continue;
      const family = t.slice(0, i).trim().toLowerCase();
      const value = t.slice(i + 1).trim();
      if (!family || !value) continue;
      const e = tagFamilies.get(family) ?? { products: new Set(), values: new Set() };
      e.products.add(p.product_id);
      e.values.add(value.toLowerCase());
      tagFamilies.set(family, e);
    }
    for (const [k, v] of Object.entries(p.metafields ?? {})) {
      // Internal ranking keys are not merchant fields.
      if (k.startsWith("__") || !v) continue;
      const e = metafields.get(k) ?? { products: new Set(), values: new Set() };
      e.products.add(p.product_id);
      e.values.add(v.trim().toLowerCase());
      metafields.set(k, e);
    }
  }
  const out: NarrowFieldOption[] = [];
  for (const [family, e] of tagFamilies) {
    out.push({
      field: `tag:${family}`,
      label: label(family),
      kind: "tag",
      coverage: e.products.size,
      valueCount: e.values.size,
    });
  }
  for (const [key, e] of metafields) {
    // A metafield with one value across the whole catalogue can't narrow.
    if (e.values.size < 2) continue;
    out.push({
      field: `mf:${key}`,
      label: label(key),
      kind: "metafield",
      coverage: e.products.size,
      valueCount: e.values.size,
    });
  }
  return out.sort((a, b) => b.coverage - a.coverage || a.label.localeCompare(b.label));
}

export interface FieldValue {
  /** Canonical (lowercased) value used for storage + matching. */
  value: string;
  /** Display casing (first seen). */
  label: string;
  count: number;
}

/** §6.3 — the field's values with per-value product counts. */
export function fieldValues(
  productIndex: readonly IndexedProduct[],
  field: string,
): FieldValue[] {
  const seen = new Map<string, { label: string; count: number }>();
  const bump = (raw: string) => {
    const value = raw.trim().toLowerCase();
    if (!value) return;
    const e = seen.get(value);
    if (e) e.count++;
    else seen.set(value, { label: raw.trim(), count: 1 });
  };
  if (field.startsWith("tag:")) {
    const family = field.slice(4).toLowerCase();
    for (const p of productIndex) {
      const values = new Set<string>();
      for (const t of p.tags) {
        const i = t.indexOf(":");
        if (i <= 0) continue;
        if (t.slice(0, i).trim().toLowerCase() !== family) continue;
        values.add(t.slice(i + 1).trim());
      }
      for (const v of values) bump(v);
    }
  } else if (field.startsWith("mf:")) {
    const key = field.slice(3);
    for (const p of productIndex) {
      const v = p.metafields?.[key];
      if (v) bump(v);
    }
  }
  return [...seen.entries()]
    .map(([value, e]) => ({ value, label: e.label, count: e.count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** The answer's currently-selected values for a field (menu state). */
export function answerValuesForField(a: AnswerT, field: string): string[] {
  if (field.startsWith("tag:")) {
    const family = field.slice(4).toLowerCase();
    const out: string[] = [];
    for (const t of a.tags) {
      const i = t.indexOf(":");
      if (i <= 0) continue;
      if (t.slice(0, i).trim().toLowerCase() !== family) continue;
      out.push(t.slice(i + 1).trim().toLowerCase());
    }
    return out;
  }
  if (field.startsWith("mf:")) {
    const key = field.slice(3);
    return (a.metafield_filters ?? [])
      .filter((m) => m.key === key)
      .map((m) => m.value.trim().toLowerCase());
  }
  return [];
}

/** The setAnswerFilterValues payload storing `values` under `field`. */
export function writeValuesForField(
  field: string,
  values: readonly string[],
): { tags?: string[]; metafield_filters?: Array<{ key: string; value: string }> } {
  if (values.length === 0) return {};
  if (field.startsWith("tag:")) {
    const family = field.slice(4).toLowerCase();
    return { tags: values.map((v) => `${family}:${v}`) };
  }
  if (field.startsWith("mf:")) {
    const key = field.slice(3);
    return { metafield_filters: values.map((v) => ({ key, value: v })) };
  }
  return {};
}
