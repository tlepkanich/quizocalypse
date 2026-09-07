import type { Quiz } from "../../../lib/quizSchema";
import type { BuilderCategory } from "../../builder/stepProps";

// ════════════════════════════════════════════════════════════════════════════
// Create-a-rule modal — the products band's PURE derivations (create-rule
// handoff §2 "Both bands" + §4). Kept out of the component so they are unit-
// testable and so the coverage Map is built ONCE per render, never per card.
//
// Coverage is a COUNT, never a flag: several rules may legitimately point at
// the same group (rules are checked top down, first match applies), so the
// number goes up and the target stays fully selectable. It is a readout, not
// a gate — nothing here blocks saving or publishing.
// ════════════════════════════════════════════════════════════════════════════

type DecisionRuleT = NonNullable<Quiz["decision_rules"]>[number];

/** The ids a rule targets — `target_ids` when present, else the single
 *  `target_id` byte-form (parsed forever). */
export function ruleTargetIds(rule: Pick<DecisionRuleT, "target_id" | "target_ids">): string[] {
  return rule.target_ids?.length ? rule.target_ids : [rule.target_id];
}

/** For each category id, how many rules point at it. Derived from the doc on
 *  every render — there is no cache to invalidate when the ledger changes. */
export function ruleCoverage(rules: readonly DecisionRuleT[] | undefined): Map<string, number> {
  const out = new Map<string, number>();
  for (const rule of rules ?? []) {
    for (const id of new Set(ruleTargetIds(rule))) {
      out.set(id, (out.get(id) ?? 0) + 1);
    }
  }
  return out;
}

/** Onboarding band order: the groups nothing points at yet FIRST, then the
 *  covered ones — each half in category order, so a merchant scanning the
 *  row meets the to-dos before the done pile. */
export function splitRecommendationGroups(
  categories: readonly BuilderCategory[],
  coverage: Map<string, number>,
): { needs: BuilderCategory[]; done: BuilderCategory[] } {
  const needs: BuilderCategory[] = [];
  const done: BuilderCategory[] = [];
  for (const cat of categories) {
    if ((coverage.get(cat.id) ?? 0) > 0) done.push(cat);
    else needs.push(cat);
  }
  return { needs, done };
}

/** What the quiz ALREADY uses of each catalogue kind — the rows a kind tab
 *  shows without a search ("Tags · 2 in this quiz of 148 — search to reach
 *  the rest"). Tags/collections/metafields come from the answers' stored
 *  filters; products are whatever the recommendation groups hold. */
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
      // Same "key: value" convention as the modal's metafield rows.
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
