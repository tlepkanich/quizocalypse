import type { z } from "zod";
import type { Answer, Quiz } from "../../../lib/quizSchema";
import type { IndexedProduct } from "../../../lib/recommendationEngine";
import type { BuilderCategory } from "../../builder/stepProps";
import { setAnswerFilterValues, setQuestionRole } from "../../../lib/quizMutations";
import { numericId } from "../../../lib/cartLink";

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
  /** Namespaced field key ("tag:fit" | "mf:custom.gender" | "vo:Size" | "ptype"). */
  field: string;
  /** Display label ("Fit" | "gender" | "Size" | "Product type"). */
  label: string;
  kind: "tag" | "metafield" | "variant" | "ptype";
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
  const variantOpts = new Map<string, { products: Set<string>; values: Set<string> }>();
  const ptype = { products: new Set<string>(), values: new Set<string>() };
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
    // G5 widening — variant options + product type as fields.
    for (const [name, values] of Object.entries(p.variant_options ?? {})) {
      const e = variantOpts.get(name) ?? { products: new Set(), values: new Set() };
      e.products.add(p.product_id);
      for (const val of values) e.values.add(val.trim().toLowerCase());
      variantOpts.set(name, e);
    }
    if (p.product_type) {
      ptype.products.add(p.product_id);
      ptype.values.add(p.product_type.trim().toLowerCase());
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
  for (const [name, e] of variantOpts) {
    if (e.values.size < 2) continue;
    out.push({
      field: `vo:${name}`,
      label: name,
      kind: "variant",
      coverage: e.products.size,
      valueCount: e.values.size,
    });
  }
  if (ptype.values.size >= 2) {
    out.push({
      field: "ptype",
      label: "Product type",
      kind: "ptype",
      coverage: ptype.products.size,
      valueCount: ptype.values.size,
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
  } else if (field.startsWith("vo:")) {
    const name = field.slice(3);
    for (const p of productIndex) {
      const values = new Set(p.variant_options?.[name] ?? []);
      for (const v of values) bump(v);
    }
  } else if (field === "ptype") {
    for (const p of productIndex) {
      if (p.product_type) bump(p.product_type);
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
  if (field.startsWith("vo:")) {
    const name = field.slice(3);
    return (a.variant_filters ?? [])
      .filter((v) => v.name === name)
      .map((v) => v.value.trim().toLowerCase());
  }
  if (field === "ptype") {
    return (a.product_type_filters ?? []).map((t) => t.trim().toLowerCase());
  }
  return [];
}

// ── UNIFIED one-window (unified/_v.js) — derived pill + map-for-me ─────────

/** §11 — the per-field chip palette is ASSIGNED BY HASHING the field key
 *  (there is no fixed list of merchant fields). Six hues from the repo's
 *  pastel system (.qz-ltab-chip.hue-0..5). Shared by the card and the
 *  question window so a field's colour never disagrees between them. */
export function fieldHue(field: string): number {
  let h = 0;
  for (let i = 0; i < field.length; i++) h = (h * 31 + field.charCodeAt(i)) | 0;
  return Math.abs(h) % 6;
}

/** The field an answer's stored values draw from, or null for a plain mix.
 *  Tag values only count as a FIELD when family-shaped ("fit:slim"). */
function answerFields(a: AnswerT): string[] {
  const out = new Set<string>();
  for (const t of a.tags) {
    const i = t.indexOf(":");
    if (i > 0 && i < t.length - 1) out.add(`tag:${t.slice(0, i).trim().toLowerCase()}`);
    else if (t.trim()) out.add("");
  }
  for (const m of a.metafield_filters ?? []) out.add(`mf:${m.key}`);
  for (const v of a.variant_filters ?? []) out.add(`vo:${v.name}`);
  if (a.product_type_filters?.length) out.add("ptype");
  if (a.collection_filter || a.collection_filters?.length) out.add("");
  return [...out];
}

/** unified §2 — the NARROWS pill label, PURELY COMPUTED (never stored):
 *  one field → its label · several → "mixed" · non-field selections →
 *  "anything" · none → "nothing yet". */
export function derivedNarrowLabel(answers: readonly AnswerT[]): string {
  // Mock-exact (narrowLabel, unified/_v.js): count distinct FIELDS across
  // all answers' selections; plain (non-field) selections count only toward
  // "any selection at all".
  const fields = new Set<string>();
  let anySelection = false;
  for (const a of answers) {
    if (a.no_preference) continue;
    const fs = answerFields(a);
    if (fs.length) anySelection = true;
    for (const f of fs) if (f) fields.add(f);
  }
  if (fields.size > 1) return "mixed";
  if (fields.size === 1) {
    const field = [...fields][0]!;
    if (field === "ptype") return "Product type";
    const bare = field.replace(/^(mf|tag|vo):/, "");
    return bare.split(".").pop() || bare;
  }
  return anySelection ? "anything" : "nothing yet";
}

export interface MapGuess {
  answerId: string;
  field: string;
  value: string;
  label: string;
}

/** unified §3 — deterministic map-for-me: for each unmapped answer, the best
 *  field VALUE guess by name match (exact value 100 · word-boundary hit 70;
 *  substring deliberately never matches — "Men" must not match "Women");
 *  ties break on product count. Returns one guess per mappable answer. */
export function guessAnswerMappings(
  answers: readonly AnswerT[],
  productIndex: readonly IndexedProduct[],
): MapGuess[] {
  const fields = narrowFieldOptions(productIndex);
  const candidates = fields.flatMap((f) =>
    fieldValues(productIndex, f.field).map((v) => ({ field: f.field, ...v })),
  );
  const out: MapGuess[] = [];
  for (const a of answers) {
    if (a.no_preference) continue;
    if (answerFields(a).length) continue; // already mapped
    const text = a.text.trim().toLowerCase();
    if (!text) continue;
    let best: (typeof candidates)[number] | null = null;
    let bestScore = 0;
    for (const c of candidates) {
      let score = 0;
      if (c.value === text) score = 100;
      else if (new RegExp(`\\b${c.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text))
        score = 70;
      if (score > bestScore || (score === bestScore && score > 0 && c.count > (best?.count ?? 0))) {
        best = c;
        bestScore = score;
      }
    }
    if (best && bestScore >= 70)
      out.push({ answerId: a.id, field: best.field, value: best.value, label: best.label });
  }
  return out;
}

/** QRTZ-H2 — does this answer carry ANY stored filter selection (field
 *  values, plain tags, or collections)? The Overview's role control uses it
 *  to decide whether flipping to Narrows needs the attribute dialog: a
 *  freshly-flipped question with nothing stored narrows by nothing. */
export function answerHasSelection(a: AnswerT): boolean {
  return (
    a.tags.some((t) => t.trim().length > 0) ||
    Boolean(a.collection_filter) ||
    (a.collection_filters?.length ?? 0) > 0 ||
    (a.metafield_filters?.length ?? 0) > 0 ||
    (a.variant_filters?.length ?? 0) > 0 ||
    (a.product_type_filters?.length ?? 0) > 0
  );
}

/** QRTZ-H2 — the single FIELD key the question's stored values draw from,
 *  or null ("anything", "mixed", or nothing yet). Mirrors derivedNarrowLabel's
 *  counting exactly (plain picks don't count as a field; no_preference
 *  answers are skipped) so the dialog's preselected radio can never disagree
 *  with the derived label. */
export function derivedNarrowField(answers: readonly AnswerT[]): string | null {
  const fields = new Set<string>();
  for (const a of answers) {
    if (a.no_preference) continue;
    for (const f of answerFields(a)) if (f) fields.add(f);
  }
  return fields.size === 1 ? [...fields][0]! : null;
}

/** QRTZ-H2 — the attribute dialog's seed pass: one best VALUE guess per
 *  answer, constrained to the CHOSEN field (exact 100 · word-boundary 70 ·
 *  threshold ≥70; substrings deliberately never match — the same scoring as
 *  guessAnswerMappings on one field's value list). Unlike guessAnswerMappings
 *  this re-guesses already-mapped answers — the dialog REPLACES a question's
 *  field, so old values are meaningless — skipping only no_preference
 *  ("keeps everything" is a deliberate choice, never overwritten). */
export function guessAnswerValuesForField(
  answers: readonly AnswerT[],
  productIndex: readonly IndexedProduct[],
  field: string,
): MapGuess[] {
  const candidates = fieldValues(productIndex, field);
  const out: MapGuess[] = [];
  for (const a of answers) {
    if (a.no_preference) continue;
    const text = a.text.trim().toLowerCase();
    if (!text) continue;
    let best: FieldValue | null = null;
    let bestScore = 0;
    for (const c of candidates) {
      let score = 0;
      if (c.value === text) score = 100;
      else if (new RegExp(`(^|[^a-z0-9])${escapeRe(c.value)}([^a-z0-9]|$)`).test(text))
        score = 70;
      if (score > bestScore || (score === bestScore && score > 0 && c.count > (best?.count ?? 0))) {
        best = c;
        bestScore = score;
      }
    }
    if (best && bestScore >= 70)
      out.push({ answerId: a.id, field, value: best.value, label: best.label });
  }
  return out;
}

export interface TargetGuess {
  answerId: string;
  categoryId: string;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** unified §3 (decides role) — deterministic map-for-me over the SETS: for
 *  each unmapped deciding answer, the best category-name guess (exact 100 ·
 *  word-boundary 70; substrings deliberately never match). One target per
 *  answer (G9). */
export function guessAnswerTargets(
  answers: readonly AnswerT[],
  categories: readonly { id: string; name: string }[],
): TargetGuess[] {
  const out: TargetGuess[] = [];
  for (const a of answers) {
    if (a.target_id) continue; // already mapped
    const text = a.text.trim().toLowerCase();
    if (!text) continue;
    const words = text.split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    let best: { id: string; score: number } | null = null;
    for (const c of categories) {
      const name = c.name.trim().toLowerCase();
      if (!name) continue;
      let score = 0;
      if (name === text) score = 100;
      else if (new RegExp(`(^|[^a-z0-9])${escapeRe(text)}([^a-z0-9]|$)`).test(name)) score = 70;
      else {
        const hits = words.filter((w) =>
          new RegExp(`(^|[^a-z0-9])${escapeRe(w)}([^a-z0-9]|$)`).test(name),
        ).length;
        if (hits) score = 35 + hits * 10;
      }
      if (score > (best?.score ?? 0)) best = { id: c.id, score };
    }
    if (best && best.score >= 70) out.push({ answerId: a.id, categoryId: best.id });
  }
  return out;
}

/** QRTZ-B2 — the products popover's "Open in Shopify" destination (mock
 *  .pp-foot button), derived from the SAME data the popover already lists.
 *  Only kinds with a reliable admin URL get a link:
 *    collection → /admin/collections/{numeric id from the gid}
 *    tag        → /admin/products?tag={ref} (the admin's tag-filtered list)
 *    product    → /admin/products/{numeric id} (single-product groups only)
 *  Metafield-, variant-, and type-shaped selections have no stable admin URL
 *  → null (no link). Mixed filter selections are ambiguous → null. The legacy
 *  {domain}/admin/... form redirects into admin.shopify.com, so the myshopify
 *  domain is all we need. Pure — unit-tested. */
export function popoverShopifyUrl(
  adminDomain: string | null | undefined,
  role: "decides" | "qualifier" | "filter" | undefined,
  answer: AnswerT,
  cat: BuilderCategory | undefined,
): string | null {
  if (!adminDomain) return null;
  const admin = `https://${adminDomain}/admin`;
  if (role === "decides") {
    if (!cat) return null;
    if (cat.source === "collection" || cat.source === "smart_collection") {
      const n = numericId(cat.sourceRef);
      return n ? `${admin}/collections/${n}` : null;
    }
    if (cat.source === "tag" && cat.sourceRef) {
      return `${admin}/products?tag=${encodeURIComponent(cat.sourceRef)}`;
    }
    if (cat.source === "product") {
      const ref =
        cat.sourceRef ?? (cat.productIds.length === 1 ? cat.productIds[0]! : null);
      const n = numericId(ref);
      return n ? `${admin}/products/${n}` : null;
    }
    return null;
  }
  if (role === "filter") {
    const collections = [
      ...new Set([
        ...(answer.collection_filter ? [answer.collection_filter] : []),
        ...(answer.collection_filters ?? []),
      ]),
    ];
    const kindCount =
      (collections.length ? 1 : 0) +
      (answer.tags.length ? 1 : 0) +
      (answer.metafield_filters?.length ? 1 : 0) +
      (answer.variant_filters?.length ? 1 : 0) +
      (answer.product_type_filters?.length ? 1 : 0);
    if (kindCount !== 1) return null; // mixed or empty → no single destination
    if (collections.length === 1) {
      const n = numericId(collections[0]);
      return n ? `${admin}/collections/${n}` : null;
    }
    if (answer.tags.length === 1) {
      return `${admin}/products?tag=${encodeURIComponent(answer.tags[0]!)}`;
    }
    return null;
  }
  return null;
}

/** The setAnswerFilterValues payload storing `values` under `field`. */
export function writeValuesForField(
  field: string,
  values: readonly string[],
): {
  tags?: string[];
  metafield_filters?: Array<{ key: string; value: string }>;
  variant_filters?: Array<{ name: string; value: string }>;
  product_type_filters?: string[];
} {
  if (values.length === 0) return {};
  if (field.startsWith("tag:")) {
    const family = field.slice(4).toLowerCase();
    return { tags: values.map((v) => `${family}:${v}`) };
  }
  if (field.startsWith("mf:")) {
    const key = field.slice(3);
    return { metafield_filters: values.map((v) => ({ key, value: v })) };
  }
  if (field.startsWith("vo:")) {
    const name = field.slice(3);
    return { variant_filters: values.map((v) => ({ name, value: v })) };
  }
  if (field === "ptype") {
    return { product_type_filters: [...values] };
  }
  return {};
}

// ════════════════════════════════════════════════════════════════════════════
// QRTZ-H5 (owner unification call 2026-08-14) — the ONE apply seam behind the
// attribute dialog. Every surface that lets a merchant pick "what this
// question narrows by" (the Overview's RoleControl, the Logic table's role
// menu + attr-slot) commits through applyNarrowField — the role write, the
// field choice and the seeded values compose HERE and nowhere else, so the
// open-first/apply-together contract (Cancel writes nothing; Use writes
// everything at once) can never drift between surfaces.
// ════════════════════════════════════════════════════════════════════════════

/** The attr-slot / toast label for a field key — derivedNarrowLabel's exact
    naming ("mf:custom.gender" → "gender", "ptype" → "Product type") so the
    toast can never disagree with the slot's readout. */
export const fieldSlotLabel = (field: string): string => {
  if (field === "ptype") return "Product type";
  const bare = field.replace(/^(mf|tag|vo):/, "");
  return bare.split(".").pop() || bare;
};

export interface AppliedNarrowField {
  doc: Quiz;
  /** Answers that received a seeded value guess. */
  mapped: number;
  /** Eligible (non-no_preference) answers left unmapped for the field. */
  unmatched: number;
}

/** QRTZ-H5 — apply a picked narrow-field to a question: ONE composition of
 *  the role write (when flipping) + one setAnswerFilterValues per answer,
 *  each built by writeValuesForField (the field derives back from the
 *  values; the legacy narrow_field key stays unwritten, exactly like
 *  QuestionWindow). H2's exact rules hold:
 *    - re-picking the current derived field returns null (no-op — re-seeding
 *      would overwrite hand-tuned per-answer values with guesses);
 *    - on a field change, mapped answers are re-guessed against the NEW
 *      field and unmatched old values are cleared (setQuestionNarrowField's
 *      locked semantic — old values are meaningless against the new field);
 *    - no_preference answers are never touched ("keeps everything" is a
 *      deliberate choice).
 *  Pure doc→doc (composes barrel mutations only); null = nothing to write. */
export function applyNarrowField(
  doc: Quiz,
  nodeId: string,
  productIndex: readonly IndexedProduct[],
  field: string,
): AppliedNarrowField | null {
  const node = doc.nodes.find((n) => n.id === nodeId);
  if (!node || node.type !== "question") return null;
  const answers = node.data.answers;
  const isFilter = node.data.role === "filter";
  if (isFilter && field === derivedNarrowField(answers)) return null;
  let next = doc;
  if (!isFilter) next = setQuestionRole(next, nodeId, "filter");
  const guesses = guessAnswerValuesForField(answers, productIndex, field);
  const byId = new Map(guesses.map((g) => [g.answerId, g]));
  for (const a of answers) {
    if (a.no_preference) continue;
    const g = byId.get(a.id);
    if (g)
      next = setAnswerFilterValues(next, nodeId, a.id, writeValuesForField(field, [g.value]));
    else if (answerHasSelection(a)) next = setAnswerFilterValues(next, nodeId, a.id, {});
  }
  const eligible = answers.filter((a) => !a.no_preference).length;
  return { doc: next, mapped: guesses.length, unmatched: eligible - guesses.length };
}

/** QRTZ-H5 — the one toast for an applied field, shared verbatim by every
 *  surface (the Overview's H2 copy, unchanged). */
export function narrowAppliedToast(
  questionText: string,
  field: string,
  mapped: number,
  unmatched: number,
): string {
  const q = questionText.replace(/\s*\?\s*$/, "");
  const name = fieldSlotLabel(field);
  return unmatched > 0
    ? `"${q}" now narrows by ${name} — map ${unmatched} answer${unmatched === 1 ? "" : "s"} on the Logic step`
    : `"${q}" now narrows by ${name} — ${mapped} answer${mapped === 1 ? "" : "s"} mapped, check them`;
}

// ════════════════════════════════════════════════════════════════════════════
// QRTZ-OB1 (GAPS §A item 7, owner call 2026-08-12) — the mock's Logic
// vocabulary replaces the product's locked set. ONE source for every surface
// (QuestionWindow spine, Logic-tab pills, Overview role column) so the role
// names can never drift apart again. Mock sources (_src/shared.mjs):
//   "Picks the result"  — QGROUPS role, line 316 + role popover line 446
//   "Narrows"           — QGROUPS role, line 327 (attr on its own slot)
//   "Asked only"        — the non-deciding badge, explainer line 1034
// "Starting set" survives ONLY in the pool sense (the initial product set a
// quiz narrows from — the mock's own explainer badge, shared.mjs ~1032);
// it is no longer a question ROLE name.
// ════════════════════════════════════════════════════════════════════════════

export const ROLE_JOBS = [
  { k: "decides" as const, n: "Picks the result", hint: "each answer opens a group of products" },
  { k: "filter" as const, n: "Narrows", hint: "each answer keeps only what matches" },
  { k: "info" as const, n: "Asked only", hint: "asked, but never touches products" },
];

/** Mock .pop-foot (shared.mjs line 451), verbatim — the one-decider rule. */
export const ROLE_FOOT =
  "One question picks the result. Every other question narrows on a single attribute.";
