import { z } from "zod";
import type { DecisionRule, Quiz } from "./quizSchema";
import type { IndexedProduct } from "./recommendationEngine";
import { isSellable } from "./recommendationEngine";
import { answerTargets, applyRuleAction, ruleTargets, type ResolvedTarget } from "./recommendDecider";
import { answerFilterValues, filterQuestions, narrowIdsByFilters, type AnswerFilterValues } from "./filterMatching";
import { enumeratePaths } from "./pathEnumeration";
import { engineLogicStyle, type LogicStyle } from "./logicStyle";
import { describeRuleTokens, type RuleTokens } from "./ruleSummary";
import { ruleStatuses } from "./ruleStatus";
import { ruleShowsRecommendations } from "./recommendationCoverage";
import { RULE_COPY, VERBS } from "../components/studio/logicTab/logicCopy";

// ════════════════════════════════════════════════════════════════════════════
// Analytics handoff, Data work 6 — "How a product is reached". For every
// product a published DECIDER quiz maps, every way a shopper reaches it, in
// the Logic step's own words, each pointing to the recommendation (result) it
// lands in:
//   • starting_set — "Dry opens the Hydrating set, which includes this product."
//   • narrows      — "Budget $25–50 keeps it: tagged under-50."
//   • rule         — "When they pick Redness, show Barrier Repair Cream."
// plus `reachable` / `noLogic` (the Products table's only flag).
//
// Nothing here re-implements resolution. One pass over `enumeratePaths` (the
// runtime router + `resolveTarget`), and on each path the engine's own pool
// pipeline exactly as `recommendForResultExplained` runs it: base pool from
// the baked map → sellable junk filter → `narrowIdsByFilters` (skipped in
// Rules only) → `applyRuleAction`. A product counts as reached when it is in
// that final pool on at least one path. Cost: O(paths × pool) once for the
// whole catalog, never per product.
//
// Remaining approximations (documented, not silent):
//   1. Pool membership, not visibility: the results page shows a hero plus
//      gridMax products of the pool, ordered by the hero/grid signals and live
//      stock. A product deep in a large pool counts as reached even if the cap
//      usually hides it.
//   2. Fallback layers are not logic: a product served ONLY by a result
//      fallback collection, the empty-result fallback, the safety net or the
//      global fallback reads as `noLogic` (computeReachability counts those as
//      reachable; this explainer answers "does an answer path reach it").
//   3. Multi-select combinations: `enumeratePaths` forks one answer per
//      question, so a rule needing two answers of one multi-select question
//      never matches an enumerated path. Rules that never won on any path but
//      `ruleStatuses` says can run are added statically (`inferred: true`)
//      when the engine provably keeps their products (Rules only, a Show rule,
//      or a replace rule on a quiz with no narrowing question). Narrowing
//      combinations of a multi-select filter question are likewise not
//      expanded (each answer forks on its own).
//   4. Sellable is judged on the publish-time snapshot (`isSellable` on the
//      baked product_index), as the runtime does until the next publish.
//   5. When enumeration hits its path cap the report says `truncated: true`;
//      a product reached only past the cap reads as `noLogic`.
// Pure: no I/O. Legacy (non-decider) docs return null.
// ════════════════════════════════════════════════════════════════════════════

/** A recommendation (Step-1 Category) the way lands the shopper in. */
export interface ReachResult {
  targetId: string;
  /** target_index name; RULE_COPY.missingRecommendation when not baked. */
  name: string;
}

/** The product attribute a narrowing answer matched on. */
export type NarrowFact =
  | { kind: "tag"; value: string }
  | { kind: "collection"; collectionId: string; name: string | null }
  | { kind: "metafield"; key: string; value: string }
  | { kind: "variant"; name: string; value: string }
  | { kind: "product_type"; value: string };

interface WayBase {
  /** Ready-to-render sentence, the Logic step's wording. */
  sentence: string;
  /** Where this way lands: the recommendation(s) holding the product. */
  results: ReachResult[];
  /** Enumerated shopper paths on which this way brings the product in. 0 for
   *  an `inferred` rule way. */
  pathCount: number;
}

export interface StartingSetWay extends WayBase {
  kind: "starting_set";
  questionId: string;
  questionText: string;
  answerId: string;
  answerText: string;
  targetId: string;
  targetName: string;
  /** The target is a single product (wording: "opens X"). */
  targetIsProduct: boolean;
}

export interface NarrowWay extends WayBase {
  kind: "narrows";
  questionId: string;
  questionText: string;
  answerId: string;
  answerText: string;
  /** Why the answer keeps this product (what the filter checks). */
  facts: NarrowFact[];
}

export interface RuleConditionGroup {
  questionId: string;
  /** Question text; "" when the question was deleted. */
  questionText: string;
  /** true = none of these answers. */
  not: boolean;
  join: "and" | "or";
  answers: Array<{ answerId: string; text: string }>;
}

export interface RuleWay extends WayBase {
  kind: "rule";
  ruleId: string;
  /** 1-based, as the Logic step numbers rules (array position = priority). */
  ruleNumber: number;
  /** The Logic step's verb chip (Rules only always reads "show"). */
  verb: "show" | "pin";
  across: "and" | "or";
  groups: RuleConditionGroup[];
  targets: ReachResult[];
  /** Added statically (approximation 3): the rule can run but no enumerated
   *  path exercised it. */
  inferred?: true;
}

export type ReachWay = StartingSetWay | NarrowWay | RuleWay;

export interface ProductReach {
  productId: string;
  title: string;
  /** Baked price string (null when unknown). */
  price: string | null;
  /** Some answer path puts the product in its results pool. */
  reachable: boolean;
  /** The Products "No logic" flag: mapped (in product_index) but no answer
   *  path reaches it. Always === !reachable. */
  noLogic: boolean;
  /** Enumerated paths whose final pool holds this product. */
  pathCount: number;
  /** Starting sets first, then narrows, then rules by number. */
  ways: ReachWay[];
}

export interface ProductReachReport {
  /** Every product_index product, keyed by product id, in index order. */
  products: Map<string, ProductReach>;
  /** Enumeration hit its cap (approximation 5). */
  truncated: boolean;
  /** Enumerated shopper paths. */
  pathCount: number;
}

export interface ProductReachOptions {
  /** Collection id → title, for collection narrowing facts (not baked). */
  collectionNames?: ReadonlyMap<string, string> | Record<string, string>;
  /** enumeratePaths cap (default 2000). */
  maxPaths?: number;
}

// ── Raw published-JSON boundary (baked fields outside the Quiz schema) ──────

const RawProduct = z.object({
  product_id: z.string().min(1),
  title: z.string().catch(""),
  handle: z.string().catch(""),
  url: z.string().optional().catch(undefined),
  price: z.string().nullable().catch(null),
  image_url: z.string().nullable().catch(null),
  tags: z.array(z.string()).catch([]),
  collection_ids: z.array(z.string()).catch([]),
  inventory_in_stock: z.boolean().catch(true),
  metafields: z.record(z.string(), z.string()).optional().catch(undefined),
  product_type: z.string().optional().catch(undefined),
  status: z.string().optional().catch(undefined),
  variant_options: z.record(z.string(), z.array(z.string())).optional().catch(undefined),
});

const RawBake = z.object({
  target_product_ids_map: z.record(z.string(), z.array(z.string())),
  target_index: z
    .record(z.string(), z.object({ name: z.string().catch(""), type: z.string().optional() }).passthrough())
    .optional()
    .catch(undefined),
  product_index: z.array(z.unknown()).catch([]),
});

interface Bake {
  map: Record<string, string[]>;
  index: Record<string, { name: string; type?: string }>;
  products: IndexedProduct[];
}

function readBake(publishedRaw: unknown): Bake | null {
  const parsed = RawBake.safeParse(publishedRaw);
  if (!parsed.success) return null;
  const products: IndexedProduct[] = [];
  for (const raw of parsed.data.product_index) {
    const p = RawProduct.safeParse(raw);
    if (!p.success) continue;
    const d = p.data;
    products.push({
      product_id: d.product_id,
      title: d.title,
      handle: d.handle,
      price: d.price,
      image_url: d.image_url,
      tags: d.tags,
      collection_ids: d.collection_ids,
      inventory_in_stock: d.inventory_in_stock,
      ...(d.url !== undefined ? { url: d.url } : {}),
      ...(d.metafields !== undefined ? { metafields: d.metafields } : {}),
      ...(d.product_type !== undefined ? { product_type: d.product_type } : {}),
      ...(d.status !== undefined ? { status: d.status } : {}),
      ...(d.variant_options !== undefined ? { variant_options: d.variant_options } : {}),
    });
  }
  return {
    map: parsed.data.target_product_ids_map,
    index: parsed.data.target_index ?? {},
    products,
  };
}

// ── Narrowing facts — mirrors filterMatching.productMatches branch by branch,
// returning WHAT matched instead of a boolean. Only called on products
// narrowIdsByFilters already kept, so the two cannot disagree on membership;
// a test pins that every kept product yields at least one fact.

export function narrowFacts(
  p: IndexedProduct,
  v: AnswerFilterValues,
  collectionName: (id: string) => string | null = () => null,
): NarrowFact[] {
  const facts: NarrowFact[] = [];
  for (const c of v.collectionIds) {
    if (p.collection_ids.includes(c)) facts.push({ kind: "collection", collectionId: c, name: collectionName(c) });
  }
  for (const tag of p.tags) {
    if (v.tags.includes(tag.toLowerCase())) facts.push({ kind: "tag", value: tag });
  }
  if (p.metafields) {
    for (const m of v.metafields) {
      const raw = p.metafields[m.key];
      if (raw === undefined) continue;
      if (raw.trim().toLowerCase() === m.value) {
        facts.push({ kind: "metafield", key: m.key, value: raw.trim() });
        continue;
      }
      if (raw.includes(",")) {
        const hit = raw.split(",").find((x) => x.trim().toLowerCase() === m.value);
        if (hit !== undefined) facts.push({ kind: "metafield", key: m.key, value: hit.trim() });
      }
    }
  }
  if (p.variant_options) {
    for (const vo of v.variantOptions) {
      const hit = p.variant_options[vo.name]?.find((x) => x.trim().toLowerCase() === vo.value);
      if (hit !== undefined) facts.push({ kind: "variant", name: vo.name, value: hit.trim() });
    }
  }
  if (p.product_type && v.productTypes.includes(p.product_type.trim().toLowerCase())) {
    facts.push({ kind: "product_type", value: p.product_type.trim() });
  }
  return facts;
}

// ── Sentences ───────────────────────────────────────────────────────────────

const metafieldLabel = (key: string): string =>
  (key.split(".").pop() ?? key).replace(/[_-]+/g, " ").trim();

export function narrowFactText(f: NarrowFact): string {
  switch (f.kind) {
    case "tag":
      return `tagged ${f.value}`;
    case "collection":
      return f.name ? `in ${f.name}` : "in the collection it picks";
    case "metafield":
      return `${metafieldLabel(f.key)} is ${f.value}`;
    case "variant":
      return `comes in ${f.value}`;
    case "product_type":
      return `product type ${f.value}`;
  }
}

export function startingSetSentence(answerText: string, targetName: string, targetIsProduct: boolean): string {
  return targetIsProduct
    ? `${answerText} opens ${targetName}.`
    : `${answerText} opens the ${targetName} set, which includes this product.`;
}

export function narrowSentence(answerText: string, facts: readonly NarrowFact[]): string {
  return facts.length
    ? `${answerText} keeps it: ${facts.map(narrowFactText).join(", ")}.`
    : `${answerText} keeps it.`;
}

/** "When they pick Redness, show Barrier Repair Cream." Groups read like the
 *  rule row (RulesList ruleSentenceText): "(A or B)" for a multi-answer or
 *  negated group, the rule's own joins between groups. */
export function ruleSentence(way: Pick<RuleWay, "verb" | "across" | "groups" | "targets">): string {
  const verb = VERBS[way.verb].name.toLowerCase();
  const recs = way.targets.map((t) => t.name).join(", ");
  const parts = way.groups.map((g, i) => {
    const ans = g.answers.map((a) => a.text);
    const body = ans.length > 1 || g.not ? `(${ans.join(` ${g.join} `)})` : (ans[0] ?? "…");
    if (i === 0) return g.not ? `don't pick ${body}` : `pick ${body}`;
    return g.not ? `not ${body}` : body;
  });
  if (parts.length === 0) return `${verb[0]!.toUpperCase()}${verb.slice(1)} ${recs}.`;
  return `When they ${parts.join(` ${way.across} `)}, ${verb} ${recs}.`;
}

// ── The one pass ────────────────────────────────────────────────────────────

type QuestionNode = Extract<Quiz["nodes"][number], { type: "question" }>;

interface Acc {
  pathCount: number;
  ways: Map<string, ReachWay>;
  /** first-seen order per kind (starting sets, narrows) */
  order: string[];
}

const pushResult = (list: ReachResult[], r: ReachResult): void => {
  if (!list.some((x) => x.targetId === r.targetId)) list.push(r);
};

/**
 * Every way into every product of a published decider quiz, in one pass.
 * `doc` is the parsed published doc (`Quiz.parse(publishedJson)`), `publishedRaw`
 * the same JSON unparsed (its baked target_product_ids_map / target_index /
 * product_index are not in the Quiz schema). Returns null for a legacy doc or
 * a doc without the decider bake: nothing provable, never a guess.
 */
export function productReachMap(
  doc: Quiz,
  publishedRaw: unknown,
  opts: ProductReachOptions = {},
): ProductReachReport | null {
  if (doc.logic_model !== "decider") return null;
  const bake = readBake(publishedRaw);
  if (!bake) return null;

  const style: LogicStyle = engineLogicStyle(doc);
  const names = opts.collectionNames;
  const collectionName = (id: string): string | null =>
    names instanceof Map ? (names.get(id) ?? null) : names ? ((names as Record<string, string>)[id] ?? null) : null;
  const result = (targetId: string): ReachResult => ({
    targetId,
    name: bake.index[targetId]?.name || RULE_COPY.missingRecommendation,
  });

  const memberSets = new Map(Object.entries(bake.map).map(([t, ids]) => [t, new Set(ids)]));
  const holds = (targetId: string, pid: string): boolean => memberSets.get(targetId)?.has(pid) ?? false;
  const sellableById = new Map(bake.products.filter(isSellable).map((p) => [p.product_id, p]));
  const hasFilters = style !== "rules" && filterQuestions(doc).length > 0;
  const rules = doc.decision_rules ?? [];
  const ruleIndex = new Map(rules.map((r, i) => [r.id, i]));
  const questionById = new Map(
    doc.nodes.filter((n): n is QuestionNode => n.type === "question").map((n) => [n.id, n]),
  );
  const decider =
    style === "rules"
      ? undefined
      : doc.nodes.find((n): n is QuestionNode => n.type === "question" && n.data.role === "decides");
  const answerById = new Map<string, { q: QuestionNode; a: QuestionNode["data"]["answers"][number] }>();
  for (const q of questionById.values()) for (const a of q.data.answers) answerById.set(a.id, { q, a });

  // Rule ways are built once per rule (structure + sentence); per product only
  // the results and path counts differ.
  const tokenCache = new Map<string, RuleTokens>();
  const tokensFor = (rule: DecisionRule): RuleTokens => {
    let t = tokenCache.get(rule.id);
    if (!t) {
      t = describeRuleTokens(rule, doc, style);
      tokenCache.set(rule.id, t);
    }
    return t;
  };

  const accs = new Map<string, Acc>();
  const accFor = (pid: string): Acc => {
    let a = accs.get(pid);
    if (!a) {
      a = { pathCount: 0, ways: new Map(), order: [] };
      accs.set(pid, a);
    }
    return a;
  };
  const addWay = (acc: Acc, key: string, make: () => ReachWay, results: readonly ReachResult[], paths: number) => {
    let w = acc.ways.get(key);
    if (!w) {
      w = make();
      acc.ways.set(key, w);
      acc.order.push(key);
    }
    w.pathCount += paths;
    for (const r of results) pushResult(w.results, r);
  };

  const ruleWay = (rule: DecisionRule, inferred: boolean): RuleWay => {
    const tokens = tokensFor(rule);
    const groups: RuleConditionGroup[] = tokens.groups.map((g) => ({
      questionId: g.questionId,
      questionText: questionById.get(g.questionId)?.data.text ?? "",
      not: g.not,
      join: g.join,
      answers: g.answers.map((a) => ({ answerId: a.answerId, text: a.text })),
    }));
    const base = {
      verb: tokens.verb === "pin" ? ("pin" as const) : ("show" as const),
      across: tokens.across,
      groups,
      targets: ruleTargets(rule).map(result),
    };
    return {
      kind: "rule",
      ruleId: rule.id,
      ruleNumber: (ruleIndex.get(rule.id) ?? 0) + 1,
      ...base,
      results: [],
      pathCount: 0,
      sentence: ruleSentence(base),
      ...(inferred ? { inferred: true as const } : {}),
    };
  };

  const enumerated = enumeratePaths(doc, opts.maxPaths !== undefined ? { maxPaths: opts.maxPaths } : {});
  const rulesThatWon = new Set<string>();

  for (const path of enumerated.paths) {
    const resolved: ResolvedTarget | null = path.effectiveTarget;
    if (!resolved) continue; // fallback layer — not logic (approximation 2)
    const selected = path.selectedAnswerIds;
    const matchedRule = resolved.matchedRuleId != null ? rules[ruleIndex.get(resolved.matchedRuleId) ?? -1] : undefined;
    if (matchedRule) rulesThatWon.add(matchedRule.id);
    // A rule that produced the base itself: a replace rule, or (Rules only /
    // no base) a degraded show/prioritize. Same shape: no ruleAction.
    const ruleIsBase = matchedRule !== undefined && !resolved.ruleAction;

    const baseTargetIds = resolved.targetIds ?? [resolved.targetId];
    const baseIds = resolved.targetIds
      ? [...new Set(baseTargetIds.flatMap((id) => bake.map[id] ?? []))]
      : (bake.map[resolved.targetId] ?? []);
    const narrowed = hasFilters ? narrowIdsByFilters(baseIds, sellableById, doc, selected) : null;
    const applied = narrowed && narrowed.applied.length > 0 ? narrowed : null;
    let poolIds = applied ? applied.ids : baseIds;
    const keptByBase = new Set(poolIds);
    let actionMembers: Set<string> | null = null;
    if (resolved.ruleAction && resolved.ruleTargetId) {
      const members = [
        ...new Set((resolved.ruleTargetIds ?? [resolved.ruleTargetId]).flatMap((id) => bake.map[id] ?? [])),
      ];
      actionMembers = new Set(members);
      poolIds = applyRuleAction(poolIds, members, resolved.ruleAction);
    }
    // targetProducts drops ids missing from the (sellable) index.
    const finalPool = [...new Set(poolIds)].filter((id) => sellableById.has(id));

    // Selected deciding answers in authored order (resolveTarget's order).
    const deciderAnswers =
      !ruleIsBase && decider ? decider.data.answers.filter((a) => selected.includes(a.id)) : [];

    for (const pid of finalPool) {
      const acc = accFor(pid);
      acc.pathCount += 1;
      const viaBase = keptByBase.has(pid);
      const baseResults: ReachResult[] = [];

      if (viaBase) {
        if (ruleIsBase && matchedRule) {
          const holding = ruleTargets(matchedRule).filter((t) => holds(t, pid)).map(result);
          holding.forEach((r) => pushResult(baseResults, r));
          addWay(acc, `r:${matchedRule.id}`, () => ruleWay(matchedRule, false), holding, 1);
        } else {
          for (const a of deciderAnswers) {
            for (const t of answerTargets(a)) {
              if (!holds(t, pid)) continue;
              const r = result(t);
              pushResult(baseResults, r);
              const isProduct = bake.index[t]?.type === "product";
              addWay(
                acc,
                `s:${a.id}:${t}`,
                () => ({
                  kind: "starting_set",
                  questionId: decider!.id,
                  questionText: decider!.data.text,
                  answerId: a.id,
                  answerText: a.text,
                  targetId: t,
                  targetName: r.name,
                  targetIsProduct: isProduct,
                  results: [],
                  pathCount: 0,
                  sentence: startingSetSentence(a.text, r.name, isProduct),
                }),
                [r],
                1,
              );
            }
          }
        }
        if (applied) {
          const p = sellableById.get(pid)!;
          for (const f of applied.applied) {
            for (const aid of f.answerIds) {
              const hit = answerById.get(aid);
              if (!hit) continue;
              const v = answerFilterValues(hit.a);
              if (!v) continue;
              const facts = narrowFacts(p, v, collectionName);
              if (facts.length === 0) continue; // an OR sibling kept it, not this answer
              addWay(
                acc,
                `n:${f.questionId}:${aid}`,
                () => ({
                  kind: "narrows",
                  questionId: f.questionId,
                  questionText: f.questionText,
                  answerId: aid,
                  answerText: hit.a.text,
                  facts,
                  results: [],
                  pathCount: 0,
                  sentence: narrowSentence(hit.a.text, facts),
                }),
                baseResults,
                1,
              );
            }
          }
        }
      }

      // A show / prioritize rule acting on this path's pool.
      if (matchedRule && !ruleIsBase && actionMembers?.has(pid) && resolved.ruleAction !== "hide") {
        const holding = ruleTargets(matchedRule).filter((t) => holds(t, pid)).map(result);
        addWay(acc, `r:${matchedRule.id}`, () => ruleWay(matchedRule, false), holding, 1);
      }
    }
  }

  // Approximation 3 — rules no enumerated path exercised but that can run.
  if (rules.length > 0) {
    const statuses = ruleStatuses(doc);
    for (const rule of rules) {
      if (rulesThatWon.has(rule.id)) continue;
      if (!ruleShowsRecommendations(rule, statuses.get(rule.id), style)) continue;
      const survives = style === "rules" || rule.action === "show" || (rule.action === undefined && !hasFilters);
      if (!survives) continue;
      for (const t of ruleTargets(rule)) {
        for (const pid of bake.map[t] ?? []) {
          if (!sellableById.has(pid)) continue;
          addWay(accFor(pid), `r:${rule.id}`, () => ruleWay(rule, true), [result(t)], 0);
        }
      }
    }
  }

  const kindRank = { starting_set: 0, narrows: 1, rule: 2 } as const;
  const products = new Map<string, ProductReach>();
  for (const p of bake.products) {
    if (products.has(p.product_id)) continue;
    const acc = accs.get(p.product_id);
    const ways = acc
      ? acc.order
          .map((k, i) => ({ w: acc.ways.get(k)!, i }))
          .sort(
            (a, b) =>
              kindRank[a.w.kind] - kindRank[b.w.kind] ||
              (a.w.kind === "rule" && b.w.kind === "rule" ? a.w.ruleNumber - b.w.ruleNumber : 0) ||
              a.i - b.i,
          )
          .map((x) => x.w)
      : [];
    const reachable = ways.length > 0 || (acc?.pathCount ?? 0) > 0;
    products.set(p.product_id, {
      productId: p.product_id,
      title: p.title,
      price: p.price,
      reachable,
      noLogic: !reachable,
      pathCount: acc?.pathCount ?? 0,
      ways,
    });
  }

  return { products, truncated: enumerated.truncated, pathCount: enumerated.count };
}
