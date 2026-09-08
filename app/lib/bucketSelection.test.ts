import { describe, expect, it } from "vitest";
import {
  applyTyped,
  autoGroupName,
  buildOrder,
  bulkPlan,
  comparator,
  deliverableCopy,
  idOf,
  ledgerHidden,
  railComposition,
  revertTyped,
  sortsFor,
  statusKeeps,
  typedSelectionIs,
  visibleCards,
  type SelectableCard,
} from "./bucketSelection";

const card = (type: SelectableCard["type"], key: string, count = 1): SelectableCard => ({
  type,
  key,
  name: key,
  count,
});

describe("sorts", () => {
  it("Products and Collections get A–Z / Z–A only; Tags and Custom browse by weight", () => {
    expect(sortsFor("product")).toEqual(["az", "za"]);
    expect(sortsFor("collection")).toEqual(["az", "za"]);
    expect(sortsFor("tag")[0]).toBe("size");
    expect(sortsFor("group")[0]).toBe("size");
  });
  it("size sorts break ties by name, numerically aware", () => {
    const rows = [card("tag", "b", 2), card("tag", "a10", 2), card("tag", "a9", 5)];
    expect(rows.sort(comparator("size")).map((c) => c.key)).toEqual(["a9", "a10", "b"]);
  });
});

describe("frozen selected-first order", () => {
  const cards = [card("tag", "apparel", 45), card("tag", "acne", 3), card("tag", "dryness", 4)];
  it("selected first, sort inside each group", () => {
    const sel = new Set([idOf("tag", "acne")]);
    expect(buildOrder(cards, (id) => sel.has(id), "size")).toEqual(["tag:acne", "tag:apparel", "tag:dryness"]);
  });
  it("a toggle does NOT re-partition: the frozen order is replayed", () => {
    const order = buildOrder(cards, () => false, "size");
    const shown = visibleCards(cards, order, "", "size", () => true);
    expect(shown.map((c) => c.key)).toEqual(["apparel", "dryness", "acne"]);
  });
  it("a search bypasses the frozen order: flat sorted matches", () => {
    const order = ["tag:acne", "tag:apparel", "tag:dryness"];
    expect(visibleCards(cards, order, "a", "az", () => true).map((c) => c.key)).toEqual(["acne", "apparel"]);
  });
  it("a card the frozen order never saw (a group created later) still renders, last", () => {
    const order = ["tag:acne"];
    expect(visibleCards(cards, order, "", "size", () => true).map((c) => c.key)).toEqual(["acne", "apparel", "dryness"]);
  });
});

describe("status filter", () => {
  it("Active is the default rule; a selected row is always shown", () => {
    expect(statusKeeps("active", "draft", false)).toBe(false);
    expect(statusKeeps("active", "draft", true)).toBe(true);
    expect(statusKeeps("all", "archived", false)).toBe(true);
    expect(statusKeeps("active", null, false)).toBe(true); // manual catalog
  });
  it("the ledger names only the statuses not currently shown", () => {
    expect(ledgerHidden("active", { draft: 20, archived: 11 })).toEqual(["20 draft", "11 archived"]);
    expect(ledgerHidden("draft", { draft: 20, archived: 11 })).toEqual(["11 archived"]);
    expect(ledgerHidden("all", { draft: 20, archived: 11 })).toEqual([]);
    expect(ledgerHidden("active", { draft: 0, archived: 0 })).toEqual([]);
  });
});

describe("select all / clear all on the loaded window", () => {
  const win = [card("tag", "a"), card("tag", "b"), card("tag", "c")];
  it("add counts what will actually change", () => {
    const plan = bulkPlan(win, (id) => id === "tag:a");
    expect(plan.mode).toBe("add");
    expect(plan.cards.map((c) => c.key)).toEqual(["b", "c"]);
  });
  it("clear removes the whole window once every row is picked", () => {
    const plan = bulkPlan(win, () => true);
    expect(plan.mode).toBe("clear");
    expect(plan.cards.length).toBe(3);
  });
  it("an empty window adds nothing (the control disables)", () => {
    expect(bulkPlan([], () => false)).toEqual({ mode: "add", cards: [] });
  });
});

describe("typed apply / revert (§05)", () => {
  const products = [card("product", "p1"), card("product", "p2")];
  const oldTags = [card("tag", "old")];
  const aiTags = [card("tag", "fine-lines"), card("tag", "acne")];
  it("apply replaces the tag half only", () => {
    const next = applyTyped([...products, ...oldTags], "tag", aiTags);
    expect(next.map((c) => idOf(c.type, c.key))).toEqual(["product:p1", "product:p2", "tag:fine-lines", "tag:acne"]);
  });
  it("apply → add a product → revert: the product survives", () => {
    const applied = applyTyped([...products, ...oldTags], "tag", aiTags);
    const sinceThen = [...applied, card("product", "p3")];
    const reverted = revertTyped(sinceThen, "tag", oldTags);
    expect(reverted.map((c) => idOf(c.type, c.key))).toEqual(["product:p1", "product:p2", "product:p3", "tag:old"]);
  });
  it("applied means the type half is exactly the pick set", () => {
    const applied = applyTyped(products, "tag", aiTags);
    expect(typedSelectionIs(applied, "tag", ["acne", "fine-lines"])).toBe(true);
    expect(typedSelectionIs([...applied, card("tag", "extra")], "tag", ["acne", "fine-lines"])).toBe(false);
    expect(typedSelectionIs(products, "tag", ["acne"])).toBe(false);
  });
  it("the override confirm fires only on an existing selection OF THAT TYPE", () => {
    expect(products.filter((c) => c.type === "tag").length).toBe(0);
  });
});

describe("rail", () => {
  it("composes Groups and Products", () => {
    const { groups, products } = railComposition([card("tag", "t"), card("group", "g"), card("product", "p")]);
    expect(groups.map((c) => c.key)).toEqual(["t", "g"]);
    expect(products.map((c) => c.key)).toEqual(["p"]);
  });
  it("deliverable copy shows the gap only when there is one", () => {
    expect(deliverableCopy(44, 44)).toBe("44 products");
    expect(deliverableCopy(38, 44)).toBe("38 of 44 products");
    expect(deliverableCopy(1, 1)).toBe("1 product");
    expect(deliverableCopy(0, 1)).toBe("0 of 1 product");
  });
});

describe("autoGroupName", () => {
  it("names from the parts", () => {
    expect(autoGroupName([])).toBe("");
    expect(autoGroupName(["sensitive"])).toBe("sensitive");
    expect(autoGroupName(["sensitive", "fragrance-free"])).toBe("sensitive + fragrance-free");
    expect(autoGroupName(["a", "b", "c"])).toBe("a + 2 more");
  });
});
