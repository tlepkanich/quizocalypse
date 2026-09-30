import type { DecisionRule, DecisionRuleCondition, Quiz } from "../../../lib/quizSchema";
import type { LogicStyle } from "../../../lib/logicStyle";
import type { BuilderCategory } from "../../builder/stepProps";
import { TYPE_CHIP_LABEL } from "../../onboarding/questionsLogicV3/content/TypeChipSelector";
import { QUESTION_TYPE_TAG } from "./logicCopy";

// ════════════════════════════════════════════════════════════════════════════
// The rule window (Create a rule / Edit rule) — its PURE derivations, kept
// out of the component so they are unit-testable (mock modalHTML, tidy,
// fitDraft, typeMeta, arHTML; handoff "The rule window", D12, D15, D24).
//
// Coverage is NOT defined here any more: the band, the strip, the Table and
// the Tier-1 findings all read the ONE style-aware helper,
// app/lib/recommendationCoverage.ts (B10/B41). Coverage is a readout, never
// a gate — nothing here blocks saving or publishing.
// ════════════════════════════════════════════════════════════════════════════

type QuestionNode = Extract<Quiz["nodes"][number], { type: "question" }>;

/** The ids a rule targets — `target_ids` when present, else the single
 *  `target_id` byte-form (parsed forever). */
export function ruleTargetIds(rule: Pick<DecisionRule, "target_id" | "target_ids">): string[] {
  return rule.target_ids?.length ? rule.target_ids : [rule.target_id];
}

/** Band order: the recommendations nothing covers yet FIRST, then the
 *  covered ones, each half in category order. Sorted by SAVED coverage only
 *  (the draft never counts), so picking never moves a chip. */
export function splitRecommendationGroups(
  categories: readonly BuilderCategory[],
  covered: (id: string) => boolean,
): { needs: BuilderCategory[]; done: BuilderCategory[] } {
  const needs: BuilderCategory[] = [];
  const done: BuilderCategory[] = [];
  for (const cat of categories) (covered(cat.id) ? done : needs).push(cat);
  return { needs, done };
}

/** What the quiz ALREADY uses of each catalogue kind — the rows the builder
 *  band's kind tabs show without a search. Tags/collections/metafields come
 *  from the answers' stored filters; products are whatever the
 *  recommendation groups hold. */
export function quizUsedRefs(
  doc: Quiz,
  categories: readonly BuilderCategory[],
): { tags: Set<string>; collections: Set<string>; metafields: Set<string>; products: Set<string> } {
  const tags = new Set<string>();
  const collections = new Set<string>();
  const metafields = new Set<string>();
  const products = new Set<string>();
  for (const n of doc.nodes) {
    if (n.type !== "question") continue;
    for (const a of n.data.answers) {
      for (const t of a.tags) {
        const k = t.trim();
        if (k) tags.add(k);
      }
      if (a.collection_filter) collections.add(a.collection_filter);
      for (const c of a.collection_filters ?? []) collections.add(c);
      // Same "key: value" convention as the builder band's metafield rows.
      for (const m of a.metafield_filters ?? []) metafields.add(`${m.key}: ${m.value}`);
    }
  }
  for (const cat of categories) {
    for (const id of cat.productIds) products.add(id);
    if (cat.source === "tag" && cat.sourceRef) tags.add(cat.sourceRef);
    if (cat.source === "collection" && cat.sourceRef) collections.add(cat.sourceRef);
  }
  return { tags, collections, metafields, products };
}

/** "1 rule" / "2 rules". */
export function rulesWord(n: number): string {
  return `${n} ${n === 1 ? "rule" : "rules"}`;
}

/** "1 product" / "12 products". */
export function productsWord(n: number): string {
  return `${n} ${n === 1 ? "product" : "products"}`;
}

// ── question rows ───────────────────────────────────────────────────────────

/** The fewest / most answers a shopper can pick (quizSchema: min_selections
 *  default 1, max_selections default the answer count). */
export function pickRange(node: QuestionNode): { min: number; max: number } {
  const n = node.data.answers.length;
  if (node.data.question_type !== "multi_select") return { min: 1, max: Math.min(1, n) };
  const min = Math.max(1, Math.min(node.data.min_selections ?? 1, n));
  const max = Math.max(min, Math.min(node.data.max_selections ?? n, n));
  return { min, max };
}

/** A five-point question is the rating type carrying the 1–5 preset. */
export function isFivePoint(node: QuestionNode): boolean {
  return (
    node.data.question_type === "rating" &&
    node.data.scale_config?.min === 1 &&
    node.data.scale_config?.max === 5
  );
}

/** The row's type tag (mock typeMeta): null on single-select, which is the
 *  default and carries no tag. */
export function questionTypeTag(node: QuestionNode): string | null {
  const t = node.data.question_type;
  if (t === "single_select") return null;
  if (t === "multi_select") {
    const { min, max } = pickRange(node);
    return QUESTION_TYPE_TAG.multi(min, max);
  }
  if (t === "rating") {
    return isFivePoint(node) ? QUESTION_TYPE_TAG.five : QUESTION_TYPE_TAG.scale(node.data.answers.length);
  }
  return TYPE_CHIP_LABEL[t] ?? null;
}

/** A scale answer whose text is its own number renders as a numbered point. */
export function isScalePoint(node: QuestionNode, index: number): boolean {
  return node.data.question_type === "rating" && node.data.answers[index]?.text.trim() === String(index + 1);
}

/** The end label under the first and last point of a scale. */
export function scaleEndLabel(node: QuestionNode, index: number): string {
  if (node.data.question_type !== "rating") return "";
  const last = node.data.answers.length - 1;
  if (index === 0) return node.data.scale_config?.endpoint_label_min ?? "";
  if (index === last) return node.data.scale_config?.endpoint_label_max ?? "";
  return "";
}

// ── the draft ───────────────────────────────────────────────────────────────

export type RuleVerb = "show" | "pin" | "hide";

export const VERB_TO_ACTION: Record<RuleVerb, "show" | "prioritize" | "hide"> = {
  show: "show",
  pin: "prioritize",
  hide: "hide",
};

export function actionToVerb(action: DecisionRule["action"]): RuleVerb {
  return action === "prioritize" ? "pin" : action === "hide" ? "hide" : "show";
}

/** The verbs a style offers (D2 settled half): Rules only is Show alone. */
export function stylesVerbs(style: LogicStyle): RuleVerb[] {
  return style === "rules" ? ["show"] : ["show", "pin", "hide"];
}

export interface RuleDraft {
  /** Picked answer ids per question, in click order (deleted answers kept). */
  picks: Record<string, string[]>;
  /** "is not" rows. */
  not: Record<string, boolean>;
  /** "all of" rows (multi-select, 2+ picks, never beside "is not" — D12). */
  all: Record<string, boolean>;
  verb: RuleVerb;
  /** Rules only (mock fitDraft): the stored Pin / Hide this draft opened
   *  from. It reads as Show and saving makes it Show. */
  was: "pin" | "hide" | null;
  /** The stored rule has no action (the legacy replace form). */
  legacyReplace: boolean;
  /** A stored cross-question "or" (D13) — shown as a note, kept on save. */
  matchAny: boolean;
  /** The stored conditions per question, for rows the merchant never
   *  touches (edit fidelity: mixed per-condition ops survive). */
  seeded: Record<string, DecisionRuleCondition[]>;
  /** Rows the merchant touched (re-derived on save). */
  dirty: string[];
  /** The stored any_of, read for untouched rows. */
  storedAnyOf: string[];
}

export function blankDraft(): RuleDraft {
  return {
    picks: {},
    not: {},
    all: {},
    verb: "show",
    was: null,
    legacyReplace: false,
    matchAny: false,
    seeded: {},
    dirty: [],
    storedAnyOf: [],
  };
}

/** Open a stored rule as a draft (mock fitDraft): D12 — a stored "is not"
 *  row never also reads as "all of"; D2 — in Rules only a Pin / Hide rule
 *  reads as Show. */
export function draftFromRule(rule: DecisionRule, style: LogicStyle): RuleDraft {
  const d = blankDraft();
  const isCount: Record<string, number> = {};
  for (const c of rule.conditions) {
    (d.picks[c.question_id] ??= []).push(c.answer_id);
    (d.seeded[c.question_id] ??= []).push({ ...c });
    if (c.op === "is_not") d.not[c.question_id] = true;
    else isCount[c.question_id] = (isCount[c.question_id] ?? 0) + 1;
  }
  const anyOf = new Set(rule.any_of ?? []);
  for (const [qid, n] of Object.entries(isCount)) {
    // Stored absence of any_of on a multi-pick is-row = all-of.
    if (n > 1 && !anyOf.has(qid) && !d.not[qid]) d.all[qid] = true;
  }
  d.storedAnyOf = [...anyOf];
  const verb = actionToVerb(rule.action);
  if (style === "rules" && verb !== "show") {
    d.was = verb;
    d.verb = "show";
  } else d.verb = verb;
  d.legacyReplace = !rule.action;
  d.matchAny = rule.match === "any";
  return d;
}

/** The action a draft saves: a legacy replace rule left on Show stays
 *  action-less; everything else saves its verb. */
export function draftAction(d: RuleDraft, editing: boolean): DecisionRule["action"] {
  if (editing && d.legacyReplace && d.verb === "show" && !d.was) return undefined;
  return VERB_TO_ACTION[d.verb];
}

/** The ONE derivation of a draft's stored conditions (mock tidy): questions
 *  with picks only, in question order; "is not" only where there are picks;
 *  any_of for an "is" row with 2+ picks left on "any of" (forced for
 *  non-multi rows); never for an "is not" row (D12). A row the merchant
 *  never touched keeps its stored conditions byte for byte, and conditions
 *  on a deleted question are kept (shown flagged) until removed. */
export function draftConditions(
  d: RuleDraft,
  questions: ReadonlyArray<{ id: string; multi: boolean }>,
): { conditions: DecisionRuleCondition[]; any_of: string[] } {
  const conditions: DecisionRuleCondition[] = [];
  const any_of: string[] = [];
  const dirty = new Set(d.dirty);
  const stored = new Set(d.storedAnyOf);
  const live = new Set(questions.map((q) => q.id));
  const untouched = (qid: string) => {
    const seeded = d.seeded[qid];
    if (!seeded) return false;
    conditions.push(...seeded.map((c) => ({ ...c })));
    if (seeded.filter((c) => c.op === "is").length > 1 && stored.has(qid)) any_of.push(qid);
    return true;
  };
  for (const q of questions) {
    const aids = d.picks[q.id] ?? [];
    if (aids.length === 0) continue;
    if (!dirty.has(q.id) && untouched(q.id)) continue;
    const op = d.not[q.id] ? ("is_not" as const) : ("is" as const);
    for (const aid of aids) conditions.push({ question_id: q.id, answer_id: aid, op });
    if (op === "is" && aids.length > 1 && (!q.multi || !d.all[q.id])) any_of.push(q.id);
  }
  // A deleted question's conditions: kept verbatim until the row is removed.
  for (const qid of Object.keys(d.seeded)) {
    if (live.has(qid) || dirty.has(qid)) continue;
    if ((d.picks[qid] ?? []).length === 0) continue;
    untouched(qid);
  }
  return { conditions, any_of };
}

/** The rule a draft saves, before normalizeDecisionRule. */
export function draftToRule(
  d: RuleDraft,
  questions: ReadonlyArray<{ id: string; multi: boolean }>,
  targetIds: readonly string[],
  id: string,
  editing: boolean,
): DecisionRule {
  const { conditions, any_of } = draftConditions(d, questions);
  const action = draftAction(d, editing);
  return {
    id,
    conditions,
    target_id: targetIds[0] ?? "",
    ...(targetIds.length > 1 ? { target_ids: [...targetIds] } : {}),
    ...(action ? { action } : {}),
    ...(any_of.length ? { any_of } : {}),
    ...(d.matchAny ? { match: "any" as const } : {}),
  };
}

/** Toggle one answer (every type accumulates — single-select rows are
 *  forced any-of at derivation time; never "fix" this to replace). Under
 *  two picks "all of" goes back to the default any-of (mock ACT.mans). */
export function toggleDraftAnswer(d: RuleDraft, qid: string, answerId: string): RuleDraft {
  const cur = d.picks[qid] ?? [];
  const next = cur.includes(answerId) ? cur.filter((x) => x !== answerId) : [...cur, answerId];
  const all = { ...d.all };
  if (next.length < 2) delete all[qid];
  return { ...d, picks: { ...d.picks, [qid]: next }, all, dirty: touch(d.dirty, qid) };
}

/** is ⇄ is not. Switching "is not" on takes any "all of" with it (D12). */
export function toggleDraftNot(d: RuleDraft, qid: string): RuleDraft {
  const on = !d.not[qid];
  const not = { ...d.not, [qid]: on };
  const all = { ...d.all };
  if (on) delete all[qid];
  return { ...d, not, all, dirty: touch(d.dirty, qid) };
}

/** any of ⇄ all of (never on an "is not" row, D12). */
export function toggleDraftAll(d: RuleDraft, qid: string): RuleDraft {
  if (d.not[qid]) return d;
  return { ...d, all: { ...d.all, [qid]: !d.all[qid] }, dirty: touch(d.dirty, qid) };
}

/** Remove a deleted question's row from the draft. */
export function removeDraftQuestion(d: RuleDraft, qid: string): RuleDraft {
  const picks = { ...d.picks };
  delete picks[qid];
  return { ...d, picks, dirty: touch(d.dirty, qid) };
}

function touch(list: readonly string[], qid: string): string[] {
  return list.includes(qid) ? [...list] : [...list, qid];
}

/** Stable, key-order-insensitive equality of two stored rules (an
 *  untouched Save must not mark the quiz changed). */
export function sameStoredRule(a: DecisionRule, b: DecisionRule): boolean {
  return stableJson(a) === stableJson(b);
}

function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

// ── ensure-targets batching (D15) ───────────────────────────────────────────

/** The route's cap per call (api.categories.ensure-targets.tsx). */
export const ENSURE_BATCH = 12;

/** Split a list into calls of at most `size`, in order. */
export function batches<T>(list: readonly T[], size = ENSURE_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export type EnsureKind = "tag" | "collection" | "product" | "group" | "metafield";

export type EnsureResult =
  | { kind: EnsureKind; ref: string; category: BuilderCategory }
  | { kind: EnsureKind; ref: string; skipped: "empty" | "not_found" };

/** Map a batch response back onto its request by position; a skip in the
 *  middle never shifts the surviving rows (the route answers one result per
 *  input, in input order). Old servers answered `categories` only. */
export function mapEnsureResponse(
  sent: ReadonlyArray<{ kind: EnsureKind; ref: string }>,
  body: { results?: EnsureResult[]; categories?: BuilderCategory[] },
): EnsureResult[] {
  if (Array.isArray(body.results) && body.results.length === sent.length) return body.results;
  const cats = body.categories ?? [];
  return sent.map((s, i) =>
    cats[i] ? { kind: s.kind, ref: s.ref, category: cats[i]! } : { kind: s.kind, ref: s.ref, skipped: "not_found" },
  );
}

// ── the Add recommendations catalogue (D15) ─────────────────────────────────

export type CatalogKind = "collection" | "tag" | "product" | "group";

/** The client feed, identical on both surfaces (handoff 09). */
export interface LogicCatalogRow {
  kind: CatalogKind;
  /** collection id · tag slug · product id · shop-global Category id */
  key: string;
  label: string;
  count: number;
  /** Product ids behind the row (the count's peek). */
  productIds: readonly string[];
}

export const CATALOG_KINDS: readonly CatalogKind[] = ["collection", "tag", "product", "group"];

/** The loader's catalogue as one list, in the feed's own order per kind
 *  (collections and tags by product count then label; products and groups
 *  as the loader returns them). */
export function catalogRows(catalog: {
  products: ReadonlyArray<{ id: string; title: string; tagKeys: readonly string[]; collectionIds: readonly string[] }>;
  tags: ReadonlyArray<{ key: string; label: string; count: number }>;
  collections: ReadonlyArray<{ key: string; label: string; count: number }>;
  groups: ReadonlyArray<{ key: string; label: string; count: number; productIds: readonly string[] }>;
}): LogicCatalogRow[] {
  const byTag = new Map<string, string[]>();
  const byCol = new Map<string, string[]>();
  for (const p of catalog.products) {
    for (const t of p.tagKeys) (byTag.get(t) ?? byTag.set(t, []).get(t)!).push(p.id);
    for (const c of p.collectionIds) (byCol.get(c) ?? byCol.set(c, []).get(c)!).push(p.id);
  }
  return [
    ...catalog.collections.map((c) => ({
      kind: "collection" as const,
      key: c.key,
      label: c.label,
      count: c.count,
      productIds: byCol.get(c.key) ?? [],
    })),
    ...catalog.tags.map((t) => ({
      kind: "tag" as const,
      key: t.key,
      label: t.label,
      count: t.count,
      productIds: byTag.get(t.key) ?? [],
    })),
    ...catalog.products.map((p) => ({
      kind: "product" as const,
      key: p.id,
      label: p.title,
      count: 1,
      productIds: [p.id],
    })),
    ...catalog.groups.map((g) => ({
      kind: "group" as const,
      key: g.key,
      label: g.label,
      count: g.count,
      productIds: g.productIds,
    })),
  ];
}

export const catalogKey = (kind: string, key: string): string => `${kind}:${key}`;

/** "kind:key" for a quiz Category row (a smart collection is a collection). */
export function categoryCatalogKey(c: Pick<BuilderCategory, "source" | "sourceRef">): string | null {
  if (!c.sourceRef) return null;
  const kind = c.source === "smart_collection" ? "collection" : c.source;
  return catalogKey(kind, c.sourceRef);
}

/** Which catalogue rows are already this quiz's (server keys + rows lifted
 *  this session). Identity only, never names. */
export function inQuizKeySet(
  serverKeys: readonly string[] | undefined,
  quizCategories: ReadonlyArray<Pick<BuilderCategory, "source" | "sourceRef" | "quizId">>,
): Set<string> {
  const out = new Set(serverKeys ?? []);
  for (const c of quizCategories) {
    if (c.quizId == null) continue;
    const k = categoryCatalogKey(c);
    if (k) out.add(k);
  }
  return out;
}

/** The ONE match test the list and the tab counts share (B54): a
 *  case-insensitive substring of the name. */
export function catalogMatches(row: Pick<LogicCatalogRow, "label">, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || row.label.toLowerCase().includes(q);
}

/** Tab counts from the query-filtered set, rows already in the quiz included. */
export function catalogCounts(
  rows: readonly LogicCatalogRow[],
  query: string,
): Record<"all" | CatalogKind, number> {
  const out = { all: 0, collection: 0, tag: 0, product: 0, group: 0 };
  for (const r of rows) {
    if (!catalogMatches(r, query)) continue;
    out.all++;
    out[r.kind]++;
  }
  return out;
}
