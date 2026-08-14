import { describe, expect, it } from "vitest";
import type { IndexedProduct } from "../../../lib/recommendationEngine";
import type { BuilderCategory } from "../../builder/stepProps";
import {
  answerHasSelection,
  answerValuesForField,
  applyNarrowField,
  derivedNarrowField,
  derivedNarrowLabel,
  fieldSlotLabel,
  guessAnswerMappings,
  guessAnswerValuesForField,
  fieldValues,
  narrowAppliedToast,
  narrowFieldOptions,
  popoverShopifyUrl,
  writeValuesForField,
} from "./logicTabFields";

// Logic tab (HANDOFF §6.1/§6.3 + DECISIONS G5) — field-mode derivations.

const P = (
  id: string,
  tags: string[] = [],
  metafields?: Record<string, string>,
): IndexedProduct => ({
  product_id: id,
  title: id,
  handle: id,
  price: "10",
  image_url: null,
  tags,
  collection_ids: [],
  inventory_in_stock: true,
  ...(metafields ? { metafields } : {}),
});

const index = [
  P("p1", ["fit:Slim", "colour:Red"], { "custom.gender": "Women" }),
  P("p2", ["fit:Relaxed"], { "custom.gender": "Men", "__rank_bestseller": "9" }),
  P("p3", ["fit:Slim", "plain-tag"], { "custom.gender": "Women" }),
  P("p4", [], { "custom.material": "wool" }),
];

describe("narrowFieldOptions (§6.1)", () => {
  it("derives tag families + metafield keys, coverage-sorted; internals and single-value fields dropped", () => {
    const fields = narrowFieldOptions(index);
    const keys = fields.map((f) => f.field);
    expect(keys).toContain("tag:fit");
    expect(keys).toContain("tag:colour");
    expect(keys).toContain("mf:custom.gender");
    // __rank_* internals never surface as merchant fields.
    expect(keys.find((k) => k.includes("__rank"))).toBeUndefined();
    // A single-value metafield can't narrow.
    expect(keys).not.toContain("mf:custom.material");
    // Plain (family-less) tags are not a field.
    expect(keys.find((k) => k.includes("plain-tag"))).toBeUndefined();
    const fit = fields.find((f) => f.field === "tag:fit")!;
    expect(fit.coverage).toBe(3);
    expect(fit.valueCount).toBe(2);
    // Coverage-sorted: fit (3) before colour (1).
    expect(keys.indexOf("tag:fit")).toBeLessThan(keys.indexOf("tag:colour"));
  });
});

describe("G5 widening — variant options + product type as fields", () => {
  const widened = [
    { ...P("w1"), variant_options: { Size: ["Small", "Large"] }, product_type: "Snowboard" },
    { ...P("w2"), variant_options: { Size: ["Large"] }, product_type: "Bindings" },
  ];
  it("derives vo:<name> and ptype fields with coverage", () => {
    const fields = narrowFieldOptions(widened);
    const size = fields.find((f) => f.field === "vo:Size");
    expect(size).toMatchObject({ kind: "variant", coverage: 2, valueCount: 2 });
    const pt = fields.find((f) => f.field === "ptype");
    expect(pt).toMatchObject({ kind: "ptype", coverage: 2, valueCount: 2 });
  });
  it("vo/ptype values + write/read round-trips", () => {
    expect(fieldValues(widened, "vo:Size").map((v) => v.value)).toEqual(["large", "small"]);
    expect(fieldValues(widened, "ptype").map((v) => v.value).sort()).toEqual([
      "bindings",
      "snowboard",
    ]);
    const wv = writeValuesForField("vo:Size", ["large"]);
    expect(wv).toEqual({ variant_filters: [{ name: "Size", value: "large" }] });
    const a = { id: "a", text: "A", tags: [], edge_handle_id: "h", ...wv } as never;
    expect(answerValuesForField(a, "vo:Size")).toEqual(["large"]);
    const wt = writeValuesForField("ptype", ["snowboard"]);
    expect(wt).toEqual({ product_type_filters: ["snowboard"] });
    const b = { id: "b", text: "B", tags: [], edge_handle_id: "h", ...wt } as never;
    expect(answerValuesForField(b, "ptype")).toEqual(["snowboard"]);
  });
});

describe("fieldValues (§6.3)", () => {
  it("tag family values with counts, case-insensitive, count-sorted", () => {
    expect(fieldValues(index, "tag:fit")).toEqual([
      { value: "slim", label: "Slim", count: 2 },
      { value: "relaxed", label: "Relaxed", count: 1 },
    ]);
  });
  it("metafield values with counts", () => {
    expect(fieldValues(index, "mf:custom.gender")).toEqual([
      { value: "women", label: "Women", count: 2 },
      { value: "men", label: "Men", count: 1 },
    ]);
  });
});

describe("answerValuesForField ↔ writeValuesForField round-trip", () => {
  const answer = (extra: Record<string, unknown>) =>
    ({ id: "a", text: "A", tags: [], edge_handle_id: "h", ...extra }) as never;

  it("tag field: values store as family:value tags", () => {
    const w = writeValuesForField("tag:fit", ["slim", "relaxed"]);
    expect(w).toEqual({ tags: ["fit:slim", "fit:relaxed"] });
    expect(answerValuesForField(answer({ tags: w.tags }), "tag:fit")).toEqual([
      "slim",
      "relaxed",
    ]);
  });

  it("metafield field: values store as metafield_filters", () => {
    const w = writeValuesForField("mf:custom.gender", ["women"]);
    expect(w).toEqual({
      metafield_filters: [{ key: "custom.gender", value: "women" }],
    });
    expect(
      answerValuesForField(answer({ metafield_filters: w.metafield_filters }), "mf:custom.gender"),
    ).toEqual(["women"]);
  });

  it("empty selection writes nothing (the 'not mapped yet' state)", () => {
    expect(writeValuesForField("tag:fit", [])).toEqual({});
  });
});

// ── UNIFIED one-window helpers ──────────────────────────────────────────────

describe("derivedNarrowLabel (unified §2 — never stored)", () => {
  const a = (id: string, extra: Record<string, unknown> = {}) =>
    ({ id, text: id, tags: [], edge_handle_id: "h", ...extra }) as never;
  it("one field → its label; two fields → mixed", () => {
    expect(derivedNarrowLabel([a("x", { tags: ["fit:slim"] })])).toBe("fit");
    expect(
      derivedNarrowLabel([
        a("x", { tags: ["fit:slim"] }),
        a("y", { metafield_filters: [{ key: "custom.gender", value: "women" }] }),
      ]),
    ).toBe("mixed");
  });
  it("plain selections → anything; none → nothing yet; nopref ignored", () => {
    expect(derivedNarrowLabel([a("x", { tags: ["plain"] })])).toBe("anything");
    expect(derivedNarrowLabel([a("x"), a("y")])).toBe("nothing yet");
    expect(derivedNarrowLabel([a("x", { no_preference: true, tags: ["fit:slim"] })])).toBe(
      "nothing yet",
    );
  });
  it("vo/ptype fields label correctly", () => {
    expect(
      derivedNarrowLabel([a("x", { variant_filters: [{ name: "Size", value: "xl" }] })]),
    ).toBe("Size");
    expect(derivedNarrowLabel([a("x", { product_type_filters: ["boards"] })])).toBe(
      "Product type",
    );
  });
});

describe("guessAnswerMappings (unified §3 — deterministic map-for-me)", () => {
  const gp = [
    P("g1", ["fit:Slim"], { "custom.gender": "Women" }),
    P("g2", ["fit:Relaxed"], { "custom.gender": "Men" }),
  ];
  const a = (id: string, text: string, extra: Record<string, unknown> = {}) =>
    ({ id, text, tags: [], edge_handle_id: "h", ...extra }) as never;
  it("exact value match wins; word-boundary hits; substrings never match", () => {
    const guesses = guessAnswerMappings(
      [a("a1", "Slim"), a("a2", "For women"), a("a3", "Womenswear")],
      gp,
    );
    expect(guesses.find((g) => g.answerId === "a1")).toMatchObject({
      field: "tag:fit",
      value: "slim",
    });
    expect(guesses.find((g) => g.answerId === "a2")).toMatchObject({
      value: "women",
    });
    // "Womenswear" must NOT substring-match "women".
    expect(guesses.find((g) => g.answerId === "a3")).toBeUndefined();
  });
  it("skips mapped and no-preference answers", () => {
    const guesses = guessAnswerMappings(
      [a("a1", "Slim", { tags: ["fit:slim"] }), a("a2", "Slim", { no_preference: true })],
      gp,
    );
    expect(guesses).toEqual([]);
  });
});

describe("QRTZ-H2 — answerHasSelection / derivedNarrowField / guessAnswerValuesForField", () => {
  const a = (id: string, text: string, extra: Record<string, unknown> = {}) =>
    ({ id, text, tags: [], edge_handle_id: "h", ...extra }) as never;
  const gp = [
    P("g1", ["fit:Slim"], { "custom.gender": "Women" }),
    P("g2", ["fit:Relaxed"], { "custom.gender": "Men" }),
  ];

  it("answerHasSelection sees every storage kind; blank tags don't count", () => {
    expect(answerHasSelection(a("x", "x"))).toBe(false);
    expect(answerHasSelection(a("x", "x", { tags: ["  "] }))).toBe(false);
    expect(answerHasSelection(a("x", "x", { tags: ["fit:slim"] }))).toBe(true);
    expect(answerHasSelection(a("x", "x", { collection_filters: ["c1"] }))).toBe(true);
    expect(answerHasSelection(a("x", "x", { collection_filter: "c1" }))).toBe(true);
    expect(
      answerHasSelection(a("x", "x", { metafield_filters: [{ key: "k", value: "v" }] })),
    ).toBe(true);
    expect(
      answerHasSelection(a("x", "x", { variant_filters: [{ name: "Size", value: "xl" }] })),
    ).toBe(true);
    expect(answerHasSelection(a("x", "x", { product_type_filters: ["boards"] }))).toBe(true);
    // no_preference is NOT a selection (the dialog's callers test it apart).
    expect(answerHasSelection(a("x", "x", { no_preference: true }))).toBe(false);
  });

  it("derivedNarrowField mirrors derivedNarrowLabel: one field → its key, else null", () => {
    expect(derivedNarrowField([a("x", "x", { tags: ["fit:slim"] })])).toBe("tag:fit");
    expect(
      derivedNarrowField([
        a("x", "x", { metafield_filters: [{ key: "custom.gender", value: "women" }] }),
      ]),
    ).toBe("mf:custom.gender");
    // mixed → null; anything (plain picks only) → null; nothing → null.
    expect(
      derivedNarrowField([
        a("x", "x", { tags: ["fit:slim"] }),
        a("y", "y", { product_type_filters: ["boards"] }),
      ]),
    ).toBe(null);
    expect(derivedNarrowField([a("x", "x", { tags: ["plain"] })])).toBe(null);
    expect(derivedNarrowField([a("x", "x")])).toBe(null);
    // A plain pick ALONGSIDE one field doesn't break the single-field read
    // (derivedNarrowLabel counts the same way).
    expect(
      derivedNarrowField([a("x", "x", { tags: ["fit:slim", "plain"] })]),
    ).toBe("tag:fit");
  });

  it("guessAnswerValuesForField seeds within ONE field, re-guessing mapped answers", () => {
    const guesses = guessAnswerValuesForField(
      [
        a("a1", "Slim"), // exact value
        a("a2", "Relaxed cut"), // word-boundary
        a("a3", "Womenswear"), // substring — must NOT match
        a("a4", "Slim", { tags: ["fit:relaxed"] }), // mapped — re-guessed anyway
        a("a5", "Slim", { no_preference: true }), // deliberate keep-everything
      ],
      gp,
      "tag:fit",
    );
    expect(guesses.find((g) => g.answerId === "a1")).toMatchObject({
      field: "tag:fit",
      value: "slim",
    });
    expect(guesses.find((g) => g.answerId === "a2")).toMatchObject({ value: "relaxed" });
    expect(guesses.find((g) => g.answerId === "a3")).toBeUndefined();
    expect(guesses.find((g) => g.answerId === "a4")).toMatchObject({ value: "slim" });
    expect(guesses.find((g) => g.answerId === "a5")).toBeUndefined();
    // Constrained to the chosen field: gender values never surface for fit.
    expect(guesses.every((g) => g.field === "tag:fit")).toBe(true);
  });

  it("guessAnswerValuesForField against the OTHER field finds only its values", () => {
    const guesses = guessAnswerValuesForField(
      [a("a1", "Slim"), a("a2", "For women")],
      gp,
      "mf:custom.gender",
    );
    expect(guesses).toHaveLength(1);
    expect(guesses[0]).toMatchObject({
      answerId: "a2",
      field: "mf:custom.gender",
      value: "women",
    });
  });
});

describe("QRTZ-H5 — applyNarrowField (the ONE apply seam behind the dialog)", () => {
  const a = (id: string, text: string, extra: Record<string, unknown> = {}) => ({
    id,
    text,
    tags: [] as string[],
    edge_handle_id: `h_${id}`,
    ...extra,
  });
  const gp = [
    P("g1", ["fit:Slim"], { "custom.gender": "Women" }),
    P("g2", ["fit:Relaxed"], { "custom.gender": "Men" }),
  ];
  const doc = (role: string, answers: ReturnType<typeof a>[]) =>
    ({
      quiz_id: "qz",
      status: "draft",
      logic_model: "decider",
      nodes: [
        {
          id: "n1",
          type: "question",
          position: { x: 0, y: 0 },
          data: { text: "Fit?", question_type: "single_select", required: true, role, answers },
        },
      ],
      edges: [],
    }) as never;
  const q1 = (d: unknown) =>
    (d as { nodes: Array<{ id: string; data: { role?: string; answers: never[] } }> }).nodes.find(
      (n) => n.id === "n1",
    )!.data;

  it("fresh flip: writes role=filter + seeds matches, skips no_preference, counts unmatched", () => {
    const applied = applyNarrowField(
      doc("qualifier", [
        a("a1", "Slim"),
        a("a2", "Something else"),
        a("a3", "Any", { no_preference: true }),
      ]),
      "n1",
      gp,
      "tag:fit",
    );
    expect(applied).not.toBeNull();
    const data = q1(applied!.doc);
    expect(data.role).toBe("filter");
    expect(data.answers[0]).toMatchObject({ tags: ["fit:slim"] });
    // Unmatched with NO prior selection stays untouched (nothing to clear).
    expect(answerHasSelection(data.answers[1]!)).toBe(false);
    // no_preference is a deliberate choice — never overwritten.
    expect(data.answers[2]).toMatchObject({ no_preference: true });
    expect(applied).toMatchObject({ mapped: 1, unmatched: 1 });
  });

  it("re-picking the current derived field is a no-op (null — guesses never clobber hand-tuning)", () => {
    const d = doc("filter", [a("a1", "Whatever", { tags: ["fit:slim"] })]);
    expect(applyNarrowField(d, "n1", gp, "tag:fit")).toBeNull();
  });

  it("changing field re-guesses mapped answers and CLEARS unmatched old values", () => {
    const applied = applyNarrowField(
      doc("filter", [
        a("a1", "Men", { tags: ["fit:slim"] }), // re-guessed onto the new field
        a("a2", "Slim", { tags: ["fit:slim"] }), // no gender match → cleared
      ]),
      "n1",
      gp,
      "mf:custom.gender",
    );
    const data = q1(applied!.doc);
    expect(data.role).toBe("filter");
    expect(data.answers[0]).toMatchObject({
      tags: [],
      metafield_filters: [{ key: "custom.gender", value: "men" }],
    });
    expect(answerHasSelection(data.answers[1]!)).toBe(false);
    expect(applied).toMatchObject({ mapped: 1, unmatched: 1 });
  });

  it("missing / non-question node → null", () => {
    expect(applyNarrowField(doc("qualifier", []), "nope", gp, "tag:fit")).toBeNull();
  });

  it("narrowAppliedToast keeps H2's exact copy on both branches", () => {
    expect(narrowAppliedToast("Which fit?", "mf:custom.gender", 1, 2)).toBe(
      '"Which fit" now narrows by gender — map 2 answers on the Logic step',
    );
    expect(narrowAppliedToast("Which fit?", "tag:fit", 2, 0)).toBe(
      '"Which fit" now narrows by fit — 2 answers mapped, check them',
    );
    expect(fieldSlotLabel("ptype")).toBe("Product type");
  });
});

describe("popoverShopifyUrl (QRTZ-B2 — the popover's Open-in-Shopify link)", () => {
  const a = (extra: Record<string, unknown> = {}) =>
    ({ id: "a", text: "A", tags: [], edge_handle_id: "h", ...extra }) as never;
  const cat = (extra: Partial<BuilderCategory>): BuilderCategory => ({
    id: "c1",
    name: "Cat",
    description: "",
    tags: [],
    productIds: [],
    source: "collection",
    sourceRef: null,
    quizId: null,
    ...extra,
  });
  const D = "test.myshopify.com";

  it("decides → collection/smart_collection targets link the collection admin page", () => {
    expect(
      popoverShopifyUrl(D, "decides", a(), cat({ sourceRef: "gid://shopify/Collection/42" })),
    ).toBe("https://test.myshopify.com/admin/collections/42");
    expect(
      popoverShopifyUrl(
        D,
        "decides",
        a(),
        cat({ source: "smart_collection", sourceRef: "77" }),
      ),
    ).toBe("https://test.myshopify.com/admin/collections/77");
  });
  it("decides → tag targets link the tag-filtered products list (encoded)", () => {
    expect(
      popoverShopifyUrl(D, "decides", a(), cat({ source: "tag", sourceRef: "work wear" })),
    ).toBe("https://test.myshopify.com/admin/products?tag=work%20wear");
  });
  it("decides → single-product groups link the product; metafield groups get no link", () => {
    expect(
      popoverShopifyUrl(
        D,
        "decides",
        a(),
        cat({ source: "product", sourceRef: "gid://shopify/Product/9" }),
      ),
    ).toBe("https://test.myshopify.com/admin/products/9");
    expect(
      popoverShopifyUrl(D, "decides", a(), cat({ source: "metafield", sourceRef: "x.y:z" })),
    ).toBeNull();
  });
  it("filter → a single unambiguous collection or tag links; mixed selections do not", () => {
    expect(
      popoverShopifyUrl(D, "filter", a({ collection_filter: "gid://shopify/Collection/5" }), undefined),
    ).toBe("https://test.myshopify.com/admin/collections/5");
    expect(popoverShopifyUrl(D, "filter", a({ tags: ["fit:slim"] }), undefined)).toBe(
      "https://test.myshopify.com/admin/products?tag=fit%3Aslim",
    );
    expect(
      popoverShopifyUrl(
        D,
        "filter",
        a({ tags: ["fit:slim"], collection_filter: "gid://shopify/Collection/5" }),
        undefined,
      ),
    ).toBeNull();
    expect(popoverShopifyUrl(D, "filter", a({ tags: ["a", "b"] }), undefined)).toBeNull();
  });
  it("no admin domain (unconnected standalone) or no role → no link", () => {
    expect(
      popoverShopifyUrl(null, "decides", a(), cat({ sourceRef: "gid://shopify/Collection/42" })),
    ).toBeNull();
    expect(popoverShopifyUrl(D, undefined, a(), undefined)).toBeNull();
  });
});
