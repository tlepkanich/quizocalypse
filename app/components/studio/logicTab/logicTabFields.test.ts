import { describe, expect, it } from "vitest";
import type { IndexedProduct } from "../../../lib/recommendationEngine";
import {
  answerValuesForField,
  fieldValues,
  narrowFieldOptions,
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
