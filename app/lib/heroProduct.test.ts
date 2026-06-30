import { describe, expect, it } from "vitest";
import { selectHeroAndGrid } from "./heroProduct";

const P = (id: string, inStock?: boolean) =>
  ({ id, ...(inStock === undefined ? {} : { inventory_in_stock: inStock }) });

describe("selectHeroAndGrid (step4-dev-handoff §6 hero split)", () => {
  it("empty input → no hero, empty grid", () => {
    expect(selectHeroAndGrid([])).toEqual({ hero: null, grid: [] });
  });

  it("all in-stock → hero is the top product, grid is the rest in order", () => {
    const r = selectHeroAndGrid([P("a"), P("b"), P("c")]);
    expect(r.hero?.id).toBe("a");
    expect(r.grid.map((p) => p.id)).toEqual(["b", "c"]);
  });

  it("undefined available is treated as in-stock (matches IndexedProduct default)", () => {
    const r = selectHeroAndGrid([P("a"), P("b")]); // no available field
    expect(r.hero?.id).toBe("a");
    expect(r.grid.map((p) => p.id)).toEqual(["b"]);
  });

  it("promotes the first IN-STOCK product over higher-ranked OOS ones; OOS go to the grid", () => {
    // a (OOS) ranks first but b (in stock) becomes the hero; a + c stay in the grid.
    const r = selectHeroAndGrid([P("a", false), P("b", true), P("c", true)]);
    expect(r.hero?.id).toBe("b");
    expect(r.grid.map((p) => p.id)).toEqual(["a", "c"]); // order preserved, hero removed
  });

  it("all OOS + heroOos='next' → first product is the (OOS-badged) hero, rest grid", () => {
    const r = selectHeroAndGrid([P("a", false), P("b", false)], "next");
    expect(r.hero?.id).toBe("a");
    expect(r.grid.map((p) => p.id)).toEqual(["b"]);
  });

  it("all OOS + heroOos='grid' → no hero, every product in the grid", () => {
    const r = selectHeroAndGrid([P("a", false), P("b", false)], "grid");
    expect(r.hero).toBeNull();
    expect(r.grid.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("heroOos defaults to 'next'", () => {
    expect(selectHeroAndGrid([P("a", false)]).hero?.id).toBe("a");
  });

  it("does not mutate the input array", () => {
    const input = [P("a", true), P("b", false)];
    const snap = JSON.stringify(input);
    selectHeroAndGrid(input, "grid");
    expect(JSON.stringify(input)).toBe(snap);
  });
});
