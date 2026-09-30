import { describe, expect, it } from "vitest";

import { logicDoc, rule } from "./logicStep.fixtures";
import {
  deciderFallbackProducts,
  resolveRecPageGlobal,
  resolveTarget,
  settingsForTarget,
  type ResolvedRecPageConfig,
} from "./recommendDecider";
import {
  deciderSafetyNet,
  recommendForResultExplained,
  resolveGlobalFallbackProducts,
  unresolvedDeciderReveal,
  type IndexedProduct,
} from "./recommendationEngine";
import type { Quiz } from "./quizSchema";

// D1 safety net (owner ruling D1-safety-net). A decider shopper whose target
// does not resolve gets the SAME fallback chain an empty result gets, on the
// quiz-wide settings; the runtime keeps the bare no-match card only when the
// chain finds nothing or the merchant turned it off.

const P = (id: string, extra: Partial<IndexedProduct> = {}): IndexedProduct => ({
  product_id: id,
  title: `Product ${id}`,
  handle: id,
  price: "10",
  image_url: null,
  tags: [],
  collection_ids: [],
  inventory_in_stock: true,
  ...extra,
});

const inCol = (col: string, ...ids: string[]) =>
  ids.map((id) => P(id, { collection_ids: [col] }));

// fb1..fb5 in "fb", net1..net2 in "net", sold-out fbX in "fb", and the rule
// target catX's own members x1/x2.
const INDEX: IndexedProduct[] = [
  ...inCol("fb", "fb1", "fb2", "fb3", "fb4", "fb5"),
  P("fbX", { collection_ids: ["fb"], inventory_in_stock: false }),
  ...inCol("net", "net1", "net2"),
  P("x1"),
  P("x2"),
];
const TARGET_MAP = { catX: ["x1", "x2"], cat1: [], cat2: [], cat3: [] };

type Doc = Quiz;
type GlobalPatch = Partial<ResolvedRecPageConfig>;

/** Rules only: ONE Show rule (q2 = Short → catX). A shopper who answers
 *  Long on q2 matches no rule, so the target does not resolve. */
function rulesOnly(
  opts: { global?: GlobalPatch; gf?: Partial<Doc["global_fallback"]>; hideFirst?: boolean } = {},
): Doc {
  const rules = [
    ...(opts.hideFirst ? [rule("hide", [["q2", "b2"]], "catX", { action: "hide" })] : []),
    rule("show", [["q2", "b1"]], "catX", { action: "show" }),
  ];
  const doc = logicDoc({ rules, logic_style: "rules" });
  return withSettings(doc, opts);
}

function withSettings(
  doc: Doc,
  opts: { global?: GlobalPatch; gf?: Partial<Doc["global_fallback"]> },
): Doc {
  return {
    ...doc,
    ...(opts.global ? { rec_page_settings: { global: opts.global } } : {}),
    global_fallback: { ...doc.global_fallback, ...(opts.gf ?? {}) },
  } as Doc;
}

const UNMATCHED = ["a1", "b2", "m1", "r3"];

function explain(doc: Doc, answers: string[]) {
  return recommendForResultExplained({
    quiz: doc,
    productIndex: INDEX,
    selectedAnswerIds: answers,
    resultNodeId: "res",
    targetProductIdsMap: TARGET_MAP,
  });
}

/** What the runtime renders at a decider result: the engine's payload, else
 *  the safety-net payload, and the fallback the reveal computes from it.
 *  `null` = the bare no-match card (QuizRuntime's `else if (isDecider)`). */
function runtimeDecision(doc: Doc, answers: string[]) {
  const explained = explain(doc, answers);
  const decider = explained.decider ?? unresolvedDeciderReveal(doc, INDEX);
  if (!decider) return null;
  const fallback =
    explained.products.length === 0
      ? deciderSafetyNet(decider.config, doc.global_fallback, INDEX)
      : null;
  return { decider, products: explained.products, fallback };
}

const ids = (xs: readonly { product_id: string }[] | undefined) =>
  (xs ?? []).map((p) => p.product_id);

describe("D1 safety net — Rules only, a shopper no rule catches", () => {
  it("the target does not resolve (precondition: today's bare-card case)", () => {
    const doc = rulesOnly();
    expect(resolveTarget(UNMATCHED, doc)).toBeNull();
    expect(explain(doc, UNMATCHED).decider).toBeUndefined();
  });

  it("chain hit via the global fallback → the reveal on the quiz-wide settings, no target", () => {
    const doc = rulesOnly({ gf: { enabled: true, mode: "best_sellers", count: 3 } });
    const out = runtimeDecision(doc, UNMATCHED);
    expect(out).not.toBeNull();
    expect(out!.decider).toEqual({
      targetId: null,
      matchedRuleId: null,
      config: resolveRecPageGlobal(doc.rec_page_settings),
      hero: null,
      grid: [],
      allOutOfStock: false,
    });
    expect(out!.fallback?.source).toBe("global_fallback");
    // best_sellers = the whole sellable catalog, capped at the chooser count;
    // the sold-out member never qualifies.
    expect(out!.fallback?.products).toHaveLength(3);
    expect(ids(out!.fallback?.products)).not.toContain("fbX");
  });

  it("chain via the fallback collection (global fallback off) → in-stock only, capped at gridMax", () => {
    const doc = rulesOnly({ global: { emptyFallbackCol: "fb", gridMax: 3 } });
    const out = runtimeDecision(doc, UNMATCHED);
    expect(out!.fallback).toEqual({
      source: "empty_fallback",
      products: INDEX.filter((p) => ["fb1", "fb2", "fb3"].includes(p.product_id)),
    });
  });

  it("chain via the safety-net collection when the fallback collection is empty", () => {
    const doc = rulesOnly({ global: { emptyFallbackCol: "missing", safetyNetCol: "net" } });
    const out = runtimeDecision(doc, UNMATCHED);
    expect(out!.fallback?.source).toBe("safety_net");
    expect(ids(out!.fallback?.products)).toEqual(["net1", "net2"]);
  });

  it("a first-matching Hide also reaches the safety net", () => {
    const doc = rulesOnly({ hideFirst: true, global: { safetyNetCol: "net" } });
    expect(resolveTarget(UNMATCHED, doc)).toBeNull();
    expect(runtimeDecision(doc, UNMATCHED)!.fallback?.source).toBe("safety_net");
  });

  it("chain empty (nothing configured) → null → the bare no-match card", () => {
    expect(unresolvedDeciderReveal(rulesOnly(), INDEX)).toBeNull();
    expect(runtimeDecision(rulesOnly(), UNMATCHED)).toBeNull();
  });

  it("chain configured but finds nothing in stock → the bare card", () => {
    const doc = rulesOnly({ global: { emptyFallbackCol: "fb" } });
    const soldOut = INDEX.map((p) => ({ ...p, inventory_in_stock: false }));
    expect(unresolvedDeciderReveal(doc, soldOut)).toBeNull();
  });

  it("fallbackOn: false is respected even with every fallback configured", () => {
    const doc = rulesOnly({
      global: { fallbackOn: false, emptyFallbackCol: "fb", safetyNetCol: "net" },
      gf: { enabled: true, mode: "best_sellers" },
    });
    expect(unresolvedDeciderReveal(doc, INDEX)).toBeNull();
    expect(runtimeDecision(doc, UNMATCHED)).toBeNull();
  });

  it('emptyFallback: "hide" is respected — the net never overrides an explicit hide', () => {
    const doc = rulesOnly({
      global: { emptyFallback: "hide", emptyFallbackCol: "fb", safetyNetCol: "net" },
    });
    expect(unresolvedDeciderReveal(doc, INDEX)).toBeNull();
  });

  it("uses the QUIZ-WIDE settings: a target override never applies (there is no target)", () => {
    const doc = {
      ...rulesOnly(),
      rec_page_settings: { global: {}, overrides: { catX: { safetyNetCol: "net" } } },
    } as Doc;
    expect(unresolvedDeciderReveal(doc, INDEX)).toBeNull();
  });

  it("a shopper a rule DOES catch is untouched: the rule's target, no fallback", () => {
    const doc = rulesOnly({ global: { safetyNetCol: "net" } });
    const out = runtimeDecision(doc, ["a1", "b1", "m1", "r3"]);
    expect(out!.decider.targetId).toBe("catX");
    expect(out!.decider.matchedRuleId).toBe("show");
    expect(ids(out!.products)).toEqual(["x1", "x2"]);
    expect(out!.fallback).toBeNull();
  });
});

describe("D1 safety net — Filter Results + Rules", () => {
  // The picking question maps a1 → cat1, which has NO members: resolved but
  // empty. This is today's live safety-net path and must stay exactly as is.
  const filterDoc = (opts: { global?: GlobalPatch; gf?: Partial<Doc["global_fallback"]> } = {}) =>
    withSettings(logicDoc(), opts);
  const ANSWERS = ["a1", "b1", "m3", "r3"];

  it("resolved-but-empty keeps the engine's own payload (the new helper never runs)", () => {
    const doc = filterDoc({ global: { emptyFallbackCol: "fb", gridMax: 2 } });
    const explained = explain(doc, ANSWERS);
    expect(explained.decider?.targetId).toBe("cat1");
    expect(explained.decider?.config).toEqual(settingsForTarget(doc.rec_page_settings, "cat1"));
    const out = runtimeDecision(doc, ANSWERS);
    expect(out!.decider).toEqual(explained.decider);
    expect(out!.fallback?.source).toBe("empty_fallback");
    expect(ids(out!.fallback?.products)).toEqual(["fb1", "fb2"]);
  });

  it("resolved-but-empty with the fallback off or hidden → no fallback, the in-view no-match line", () => {
    expect(
      runtimeDecision(filterDoc({ global: { fallbackOn: false, emptyFallbackCol: "fb" } }), ANSWERS)!
        .fallback,
    ).toBeNull();
    expect(
      runtimeDecision(filterDoc({ global: { emptyFallback: "hide", emptyFallbackCol: "fb" } }), ANSWERS)!
        .fallback,
    ).toEqual({ source: null, products: [] });
  });

  it("a Filter doc that resolves never builds the safety-net payload", () => {
    const doc = filterDoc({ gf: { enabled: true, mode: "best_sellers" } });
    expect(explain(doc, ANSWERS).decider).toBeDefined();
    // (unresolvedDeciderReveal would answer for the doc, but the runtime only
    // calls it when the engine returned no decider payload.)
  });
});

describe("deciderSafetyNet — byte-identical to the chain it replaced in QuizRuntime", () => {
  // The inline chain QuizRuntime ran before this change, verbatim, for a
  // result with no products.
  function previousInlineChain(
    cfg: ResolvedRecPageConfig,
    gf: Doc["global_fallback"],
    productIndex: IndexedProduct[],
  ) {
    const globalFallbackRecs =
      cfg.fallbackOn !== false ? resolveGlobalFallbackProducts(gf, productIndex) : [];
    return cfg.fallbackOn !== false
      ? globalFallbackRecs.length > 0
        ? { source: "global_fallback" as const, products: globalFallbackRecs }
        : deciderFallbackProducts(cfg, productIndex)
      : null;
  }

  const base = logicDoc().global_fallback;
  const gfs: Array<Doc["global_fallback"]> = [
    base,
    { ...base, enabled: true, mode: "best_sellers" },
    { ...base, enabled: true, mode: "collection", collection_id: "net" },
    { ...base, enabled: true, mode: "collection", collection_id: "none" },
    { ...base, enabled: true, mode: "featured", product_ids: ["x2", "fbX"] },
  ];
  const cfgs: GlobalPatch[] = [
    {},
    { fallbackOn: false },
    { fallbackOn: true, emptyFallbackCol: "fb" },
    { emptyFallbackCol: "fb", gridMax: 2 },
    { emptyFallbackCol: "none", safetyNetCol: "net" },
    { emptyFallback: "hide", emptyFallbackCol: "fb", safetyNetCol: "net" },
    { emptyFallback: "collection", safetyNetCol: "net" },
  ];

  it.each(cfgs.flatMap((c, i) => gfs.map((g, j) => [i, j] as const)))(
    "cfg #%i × global_fallback #%i",
    (i, j) => {
      const cfg = resolveRecPageGlobal({ global: cfgs[i]!, overrides: {} });
      expect(deciderSafetyNet(cfg, gfs[j]!, INDEX)).toEqual(
        previousInlineChain(cfg, gfs[j]!, INDEX),
      );
    },
  );
});

describe("unresolvedDeciderReveal — never for a legacy doc", () => {
  it("returns null for a points/ladder doc whatever its fallback settings", () => {
    const legacy = withSettings(logicDoc({ legacy: true }), {
      gf: { enabled: true, mode: "best_sellers" },
      global: { safetyNetCol: "net" },
    });
    expect(unresolvedDeciderReveal(legacy, INDEX)).toBeNull();
  });
});
