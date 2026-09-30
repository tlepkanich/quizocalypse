import { describe, it, expect } from "vitest";

import { fitOneRow, fitTwoRows, oneRowLabel, twoRowLabel } from "./useRowFit";

/* A fake layout: every item has a width, items sit in a row with a gap, the
   more control's width grows with its label. */
const GAP = 8;
const moreWidth = (label: string | null) => (label === null ? 0 : label.length * 7 + 16);

function oneRowMeasure(widths: Record<string, number>, order: string[], containerWidth: number) {
  return (hidden: ReadonlySet<string>, label: string | null) => {
    const parts = order.filter((id) => !hidden.has(id)).map((id) => widths[id]!);
    if (label !== null) parts.push(moreWidth(label));
    const total = parts.reduce((a, b) => a + b, 0) + GAP * Math.max(0, parts.length - 1);
    return total > containerWidth;
  };
}

/** Rows used by a wrapping flex row (items + the more control last). */
function twoRowMeasure(widths: Record<string, number>, order: string[], containerWidth: number) {
  return (hidden: ReadonlySet<string>, label: string | null) => {
    const parts = order.filter((id) => !hidden.has(id)).map((id) => widths[id]!);
    if (label !== null) parts.push(moreWidth(label));
    let rows = parts.length ? 1 : 0;
    let x = 0;
    for (const w of parts) {
      const need = x === 0 ? w : x + GAP + w;
      if (need > containerWidth && x > 0) {
        rows++;
        x = w;
      } else x = need;
    }
    return rows;
  };
}

describe("fitOneRow (mock fitRow)", () => {
  const order = ["a", "b", "c", "d", "e"];
  const widths = { a: 100, b: 100, c: 100, d: 100, e: 100 };

  it("everything fits → nothing hidden, no more control", () => {
    const r = fitOneRow(order.map((id) => ({ id, armed: false })), oneRowMeasure(widths, order, 600));
    expect(r.showMore).toBe(false);
    expect(r.hidden.size).toBe(0);
  });

  it("trailing items collapse into +N more", () => {
    // 5×100 + 4×8 = 532 > 400. "+2 more" is 7 chars → 65px.
    const r = fitOneRow(order.map((id) => ({ id, armed: false })), oneRowMeasure(widths, order, 400));
    expect([...r.hidden]).toEqual(["e", "d"]);
    expect(r.moreLabel).toBe(oneRowLabel(2));
    expect(r.moreCount).toBe(2);
  });

  it("an armed item never collapses (B52): the one before it goes instead", () => {
    const items = order.map((id) => ({ id, armed: id === "e" }));
    const r = fitOneRow(items, oneRowMeasure(widths, order, 400));
    expect(r.hidden.has("e")).toBe(false);
    expect([...r.hidden]).toEqual(["d", "c"]);
  });

  it("when only armed items could go, no more control shows", () => {
    const items = order.map((id) => ({ id, armed: true }));
    const r = fitOneRow(items, oneRowMeasure(widths, order, 100));
    expect(r.showMore).toBe(false);
    expect(r.hidden.size).toBe(0);
  });
});

describe("fitTwoRows (mock fitTwoRows)", () => {
  const order = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const widths = Object.fromEntries(order.map((id) => [id, 100]));

  it("two rows or fewer → nothing hidden", () => {
    const r = fitTwoRows(order.map((id) => ({ id, picked: false })), twoRowMeasure(widths, order, 1000));
    expect(r.showMore).toBe(false);
  });

  it("unpicked collapse first; picks keep their place", () => {
    // 3 per row at 330px: 8 items + more = 3 rows → hide from the end, unpicked only.
    const items = order.map((id) => ({ id, picked: id === "g" || id === "h" }));
    const r = fitTwoRows(items, twoRowMeasure(widths, order, 330));
    expect(r.hidden.has("g") || r.hidden.has("h")).toBe(false);
    expect(r.pickedHidden).toBe(0);
    expect(r.moreLabel).toBe(twoRowLabel(r.moreCount, 0));
  });

  it("picks follow only when unpicked are exhausted: 'See N more · P picked'", () => {
    const items = order.map((id) => ({ id, picked: true }));
    const r = fitTwoRows(items, twoRowMeasure(widths, order, 330));
    expect(r.pickedHidden).toBe(r.moreCount);
    expect(r.moreLabel).toBe(`See ${r.moreCount} more · ${r.moreCount} picked`);
  });

  it("labels", () => {
    expect(twoRowLabel(3, 0)).toBe("See 3 more");
    expect(twoRowLabel(2, 1)).toBe("See 3 more · 1 picked");
    expect(oneRowLabel(4)).toBe("+4 more");
  });
});
