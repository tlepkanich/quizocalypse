import { describe, expect, it } from "vitest";
import type { IndexedProduct } from "./recommendationEngine";
import {
  attributeValueProductIds,
  buildAttributeReadout,
  type CatalogAttribute,
} from "./attributeClustering";

function product(id: string, init: Partial<IndexedProduct> = {}): IndexedProduct {
  return {
    product_id: id,
    title: id,
    handle: id,
    price: null,
    image_url: null,
    tags: [],
    collection_ids: [],
    inventory_in_stock: true,
    ...init,
  };
}

function attrNamed(attributes: CatalogAttribute[], name: string): CatalogAttribute {
  const found = attributes.find((attr) => attr.name === name);
  if (!found) {
    throw new Error(
      `no attribute named ${name}; got ${attributes.map((a) => a.name).join(", ")}`,
    );
  }
  return found;
}

describe("copy demotion (§10b)", () => {
  it("keeps long care-copy containing 'sterling silver' out of the Metal attribute", () => {
    const index = [
      product("p1", {
        tags: ["metal:sterling silver"],
        metafields: {
          "custom.care_instructions":
            "polish your sterling silver piece gently with the included cloth and keep it dry",
        },
      }),
      product("p2", {
        tags: ["metal:gold vermeil"],
        metafields: {
          "custom.care_instructions":
            "store your sterling silver jewelry away from moisture and direct sunlight always",
        },
      }),
      product("p3", { tags: ["metal:sterling silver"] }),
      product("p4", { tags: ["metal:gold vermeil"] }),
    ];
    const readout = buildAttributeReadout(index);

    const metal = attrNamed(readout.attributes, "Metal");
    expect(metal.members).toEqual([{ kind: "tag_family", key: "metal" }]);

    expect(readout.demoted).toEqual([
      {
        source: { kind: "metafield", key: "custom.care_instructions" },
        label: "Care instructions",
        reason: "copy",
      },
    ]);
  });
});

describe("identifier demotion (§10b)", () => {
  it("demotes a near-unique SKU-like metafield", () => {
    const index = ["p1", "p2", "p3", "p4", "p5"].map((id, i) =>
      product(id, {
        tags: ["metal:gold"],
        metafields: { "custom.sku": `sku-100${i}` },
      }),
    );
    const readout = buildAttributeReadout(index);

    expect(readout.demoted).toEqual([
      {
        source: { kind: "metafield", key: "custom.sku" },
        label: "Sku",
        reason: "identifier",
      },
    ]);
    for (const attr of readout.attributes) {
      expect(attr.members).not.toContainEqual({ kind: "metafield", key: "custom.sku" });
    }
  });
});

describe("the hits >= 2 guard (§10c)", () => {
  it("does not merge a one-value numeric source into sizes it overlaps", () => {
    const index = [
      product("p1", {
        variant_options: { Size: ["5.0"] },
        metafields: { "custom.customization_max_charms": "5.0" },
      }),
      product("p2", { variant_options: { Size: ["6.0"] } }),
      product("p3", { variant_options: { Size: ["7.0"] } }),
    ];
    const readout = buildAttributeReadout(index);

    const size = attrNamed(readout.attributes, "Size");
    expect(size.members).toEqual([{ kind: "variant_option", key: "size" }]);

    const charms = attrNamed(readout.attributes, "Customization max charms");
    expect(charms.members).toEqual([
      { kind: "metafield", key: "custom.customization_max_charms" },
    ]);
    expect(charms.grade).toBe("cantsplit");
  });

  it("merges a real synonym cluster sharing >= 2 values", () => {
    const index = [
      product("p1", { tags: ["metal:gold"], metafields: { "custom.metal_type": "gold" } }),
      product("p2", { tags: ["metal:silver"], metafields: { "custom.metal_type": "silver" } }),
      product("p3", { tags: ["metal:bronze"] }),
    ];
    const readout = buildAttributeReadout(index);

    const metal = attrNamed(readout.attributes, "Metal");
    expect(metal.members).toEqual([
      { kind: "tag_family", key: "metal" },
      { kind: "metafield", key: "custom.metal_type" },
    ]);
  });
});

describe("token-subset matching (§10c)", () => {
  it("matches 'gold vermeil' with '14k gold vermeil' (shared token >= 5, subset)", () => {
    const index = [
      product("p1", { tags: ["metal:gold vermeil"] }),
      product("p2", { tags: ["metal:sterling silver"] }),
      product("p3", { metafields: { "custom.metal_type": "14k gold vermeil" } }),
      product("p4", { metafields: { "custom.metal_type": "sterling silver" } }),
    ];
    const readout = buildAttributeReadout(index);

    const metal = attrNamed(readout.attributes, "Metal");
    expect(metal.members).toEqual([
      { kind: "tag_family", key: "metal" },
      { kind: "metafield", key: "custom.metal_type" },
    ]);
    const values = metal.values.map((v) => v.value).sort();
    expect(values).toEqual([
      "14k gold vermeil",
      "gold vermeil",
      "sterling silver",
    ]);
  });

  it("never token-matches pure numbers", () => {
    // Without the number guard both pairs share a >= 5-char token and are
    // token-set subsets — they would merge.
    const index = [
      product("p1", { tags: ["width:12345", "width:23456"] }),
      product("p2", {
        metafields: { "custom.size_code": "12345 wide" },
      }),
      product("p3", {
        metafields: { "custom.size_code": "23456 wide" },
      }),
    ];
    const readout = buildAttributeReadout(index);

    const width = attrNamed(readout.attributes, "Width");
    expect(width.members).toEqual([{ kind: "tag_family", key: "width" }]);
    const sizeCode = attrNamed(readout.attributes, "Size code");
    expect(sizeCode.members).toEqual([{ kind: "metafield", key: "custom.size_code" }]);
  });
});

describe("orphan absorption (§10d)", () => {
  it("absorbs a one-value source on an exact value match", () => {
    const index = [
      product("p1", { tags: ["colour:nude"] }),
      product("p2", {
        tags: ["colour:black"],
        metafields: { "custom.color_pattern": "Nude" },
      }),
      product("p3", { tags: ["colour:white"] }),
    ];
    const readout = buildAttributeReadout(index);

    const colour = attrNamed(readout.attributes, "Colour");
    expect(colour.members).toEqual([
      { kind: "tag_family", key: "colour" },
      { kind: "metafield", key: "custom.color_pattern" },
    ]);
    // Matching unions across all members: p1 via the tag, p2 via the metafield.
    expect(attributeValueProductIds(index, colour, "nude")).toEqual(
      new Set(["p1", "p2"]),
    );
  });

  it("never absorbs a one-value bare number", () => {
    const index = [
      product("p1", {
        variant_options: { Size: ["5"] },
        metafields: { "custom.max_charms": "5" },
      }),
      product("p2", { variant_options: { Size: ["6"] } }),
      product("p3", { variant_options: { Size: ["7"] } }),
    ];
    const readout = buildAttributeReadout(index);

    const size = attrNamed(readout.attributes, "Size");
    expect(size.members).toEqual([{ kind: "variant_option", key: "size" }]);
    const charms = attrNamed(readout.attributes, "Max charms");
    expect(charms.grade).toBe("cantsplit");
  });

  it("leaves a one-value source with no exact match as its own attribute", () => {
    const index = [
      product("p1", {
        tags: ["colour:nude"],
        metafields: { "custom.pattern": "unicorn" },
      }),
      product("p2", { tags: ["colour:black"] }),
      product("p3", { tags: ["colour:white"] }),
    ];
    const readout = buildAttributeReadout(index);

    const colour = attrNamed(readout.attributes, "Colour");
    expect(colour.members).toEqual([{ kind: "tag_family", key: "colour" }]);
    const pattern = attrNamed(readout.attributes, "Pattern");
    expect(pattern.members).toEqual([{ kind: "metafield", key: "custom.pattern" }]);
    expect(pattern.grade).toBe("cantsplit");
  });
});

describe("grading and sort order (§10e)", () => {
  // 10 products:
  //  - metal: gold on 5, silver on 5           → good (100% covered, split 50/50)
  //  - shade: light on all 10, dark on 1       → weak (largest 10/10 > 90%)
  //  - fit: on 5 products only                 → thin (50% < 60% of catalog)
  //  - line: essentials on all 10              → cantsplit (V < 2)
  const index = Array.from({ length: 10 }, (_, i) => {
    const id = `p${i + 1}`;
    const tags = [
      "line:essentials",
      i < 5 ? "metal:gold" : "metal:silver",
      "shade:light",
    ];
    if (i === 0) tags.push("shade:dark");
    if (i < 3) tags.push("fit:slim");
    if (i === 3 || i === 4) tags.push("fit:relaxed");
    return product(id, { tags });
  });

  it("grades cantsplit, thin, weak, and good", () => {
    const readout = buildAttributeReadout(index);
    expect(attrNamed(readout.attributes, "Metal").grade).toBe("good");
    expect(attrNamed(readout.attributes, "Shade").grade).toBe("weak");
    expect(attrNamed(readout.attributes, "Fit").grade).toBe("thin");
    expect(attrNamed(readout.attributes, "Line").grade).toBe("cantsplit");
  });

  it("grades cantsplit when every covered product carries every value", () => {
    const both = [
      product("p1", { tags: ["side:left", "side:right"] }),
      product("p2", { tags: ["side:left", "side:right"] }),
    ];
    const readout = buildAttributeReadout(both);
    expect(attrNamed(readout.attributes, "Side").grade).toBe("cantsplit");
  });

  it("sorts by grade order, then value count descending", () => {
    const readout = buildAttributeReadout(index);
    expect(readout.attributes.map((attr) => attr.name)).toEqual([
      "Metal",
      "Shade",
      "Fit",
      "Line",
    ]);
  });
});

describe("union counting (§10e)", () => {
  const index = [
    product("p1", { tags: ["metal:gold"] }),
    product("p2", { tags: ["metal:gold"], metafields: { "custom.metal_type": "gold" } }),
    product("p3", { metafields: { "custom.metal_type": "gold" } }),
    product("p4", { tags: ["metal:silver"], metafields: { "custom.metal_type": "silver" } }),
  ];

  it("counts a product carried by two member sources once", () => {
    const readout = buildAttributeReadout(index);
    const metal = attrNamed(readout.attributes, "Metal");
    expect(metal.members).toHaveLength(2);
    expect(metal.primary).toEqual({ kind: "tag_family", key: "metal" });
    expect(metal.values).toEqual([
      { value: "gold", count: 3 },
      { value: "silver", count: 1 },
    ]);
    expect(metal.covered).toBe(4);
  });

  it("attributeValueProductIds returns the union across members", () => {
    const readout = buildAttributeReadout(index);
    const metal = attrNamed(readout.attributes, "Metal");
    expect(attributeValueProductIds(index, metal, "gold")).toEqual(
      new Set(["p1", "p2", "p3"]),
    );
    expect(attributeValueProductIds(index, metal, "silver")).toEqual(new Set(["p4"]));
  });
});

describe("list-metafield atoms (§10a)", () => {
  it("splits a comma-joined metafield value into two atoms", () => {
    const index = [
      product("p1", { metafields: { "custom.materials": "gold vermeil, sterling silver" } }),
      product("p2", { metafields: { "custom.materials": "gold vermeil, sterling silver" } }),
    ];
    const readout = buildAttributeReadout(index);

    const materials = attrNamed(readout.attributes, "Materials");
    expect(materials.distinctValues).toBe(2);
    expect(materials.values.map((v) => v.value).sort()).toEqual([
      "gold vermeil",
      "sterling silver",
    ]);
    expect(attributeValueProductIds(index, materials, "sterling silver")).toEqual(
      new Set(["p1", "p2"]),
    );
  });
});

describe("strongCount and strongNames", () => {
  it("counts good attributes and names the top three splitters in grade order", () => {
    // metal + stone are good (full coverage, even split); fit is thin.
    const index = Array.from({ length: 10 }, (_, i) => {
      const id = `p${i + 1}`;
      const tags = [
        i < 5 ? "metal:gold" : "metal:silver",
        i < 5 ? "stone:ruby" : "stone:opal",
      ];
      if (i < 3) tags.push("fit:slim");
      if (i === 3 || i === 4) tags.push("fit:relaxed");
      return product(id, { tags });
    });
    const readout = buildAttributeReadout(index);

    expect(readout.strongCount).toBe(2);
    expect(readout.strongNames).toEqual(["Metal", "Stone", "Fit"]);
  });

  it("excludes cantsplit attributes from strongNames", () => {
    const index = [
      product("p1", { tags: ["metal:gold", "line:essentials"] }),
      product("p2", { tags: ["metal:silver", "line:essentials"] }),
    ];
    const readout = buildAttributeReadout(index);
    expect(readout.strongCount).toBe(1);
    expect(readout.strongNames).toEqual(["Metal"]);
  });

  it("returns an empty readout for an empty index", () => {
    const readout = buildAttributeReadout([]);
    expect(readout).toEqual({
      attributes: [],
      demoted: [],
      strongCount: 0,
      strongNames: [],
    });
  });
});
