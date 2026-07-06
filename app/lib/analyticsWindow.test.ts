import { describe, expect, it } from "vitest";
import { ANALYTICS_EVENT_WINDOW, windowRows } from "./analyticsWindow";

describe("windowRows", () => {
  it("flags truncation and slices when the fetch returned cap+1 rows", () => {
    const rows = Array.from({ length: ANALYTICS_EVENT_WINDOW + 1 }, (_, i) => i);
    const out = windowRows(rows);
    expect(out.truncated).toBe(true);
    expect(out.rows).toHaveLength(ANALYTICS_EVENT_WINDOW);
    // Keeps the FIRST cap rows — with an `orderBy ts desc` fetch these are the
    // most recent; the single overflow row is dropped.
    expect(out.rows[0]).toBe(0);
    expect(out.rows[out.rows.length - 1]).toBe(ANALYTICS_EVENT_WINDOW - 1);
  });

  it("does not flag exactly-at-cap results", () => {
    const rows = Array.from({ length: ANALYTICS_EVENT_WINDOW }, (_, i) => i);
    const out = windowRows(rows);
    expect(out.truncated).toBe(false);
    expect(out.rows).toHaveLength(ANALYTICS_EVENT_WINDOW);
    expect(out.rows).toBe(rows); // untouched, no copy
  });

  it("passes small result sets through untouched", () => {
    const rows = [{ a: 1 }, { a: 2 }];
    const out = windowRows(rows);
    expect(out.truncated).toBe(false);
    expect(out.rows).toBe(rows);
  });

  it("handles empty input", () => {
    const out = windowRows([]);
    expect(out.truncated).toBe(false);
    expect(out.rows).toEqual([]);
  });

  it("respects a custom cap", () => {
    const out = windowRows([1, 2, 3, 4], 3);
    expect(out.truncated).toBe(true);
    expect(out.rows).toEqual([1, 2, 3]);
    expect(windowRows([1, 2, 3], 3).truncated).toBe(false);
  });
});
