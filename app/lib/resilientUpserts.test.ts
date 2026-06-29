import { beforeEach, describe, expect, it, vi } from "vitest";
import { runResilientUpserts } from "./resilientUpserts";

const opts = { label: "row", idOf: (n: number) => `id_${n}` };

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("runResilientUpserts", () => {
  it("skips + counts a failing row and completes the rest (HII-3 headline)", async () => {
    const written: number[] = [];
    const res = await runResilientUpserts(
      [1, 2, 3],
      async (n) => {
        if (n === 2) throw new Error("boom");
        written.push(n);
      },
      opts,
    );
    expect(res).toEqual({ count: 2, errors: 1 });
    expect(written).toEqual([1, 3]); // 2 skipped, 1 and 3 written
  });

  it("logs the failing row's id via idOf", async () => {
    // 7 fails, 8 succeeds → partial (not all-failed), logs the failing id, no abort.
    const res = await runResilientUpserts([7, 8], async (n) => { if (n === 7) throw new Error("x"); }, opts);
    expect(res).toEqual({ count: 1, errors: 1 });
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("id_7"),
      expect.anything(),
    );
  });

  it("empty list → zero counts, no throw", async () => {
    expect(await runResilientUpserts([], async () => {}, opts)).toEqual({ count: 0, errors: 0 });
  });

  it("ABORTS on 100% failure regardless of sample size (a zero-row sync is systemic, not transient)", async () => {
    // 3 of 3 fail — below the minAbortSample floor, but ALL failed → still aborts,
    // so a wholly-broken small catalog never reads as a clean "ok" sync.
    await expect(
      runResilientUpserts([1, 2, 3], async () => { throw new Error("x"); }, opts),
    ).rejects.toThrow(/all rows failed/i);
    // even a single-row total failure aborts (nothing landed).
    await expect(
      runResilientUpserts([1], async () => { throw new Error("x"); }, opts),
    ).rejects.toThrow(/aborted/i);
  });

  it("does NOT abort a small catalog on a PARTIAL transient failure (some land)", async () => {
    // 1 of 3 fails (below floor, not all) → partial sync completes, no throw.
    const res = await runResilientUpserts([1, 2, 3], async (n) => { if (n === 2) throw new Error("x"); }, opts);
    expect(res).toEqual({ count: 2, errors: 1 });
  });

  it("aborts when > 20% of a meaningful sample fails (systemic)", async () => {
    const items = Array.from({ length: 10 }, (_, i) => i); // sample 10 ≥ floor
    // fail 3 of 10 = 30% > 20% → throw rather than ship a partial catalog
    await expect(
      runResilientUpserts(items, async (n) => { if (n < 3) throw new Error("x"); }, opts),
    ).rejects.toThrow(/aborted/i);
  });

  it("does NOT abort at exactly the 20% threshold (strict >)", async () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    // fail 2 of 10 = 20%, NOT > 20% → partial sync, no throw
    const res = await runResilientUpserts(items, async (n) => { if (n < 2) throw new Error("x"); }, opts);
    expect(res).toEqual({ count: 8, errors: 2 });
  });

  it("all rows succeed → count===length, errors===0", async () => {
    const res = await runResilientUpserts([1, 2, 3, 4], async () => {}, opts);
    expect(res).toEqual({ count: 4, errors: 0 });
  });

  it("respects custom abortRatio + minAbortSample", async () => {
    const four = [0, 1, 2, 3];
    // ratio 0.5, floor 4: 2 of 4 = 50%, NOT > 50% → no abort
    const ok = await runResilientUpserts(
      four,
      async (n) => { if (n < 2) throw new Error("x"); },
      { ...opts, abortRatio: 0.5, minAbortSample: 4 },
    );
    expect(ok).toEqual({ count: 2, errors: 2 });
    // 3 of 4 = 75% > 50% → abort
    await expect(
      runResilientUpserts(
        four,
        async (n) => { if (n < 3) throw new Error("x"); },
        { ...opts, abortRatio: 0.5, minAbortSample: 4 },
      ),
    ).rejects.toThrow(/aborted/i);
  });
});
