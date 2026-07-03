import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetRecCopyCache,
  getCachedRecCopy,
  recCopyCacheKey,
  resolveRecCopy,
} from "./recCopyCache.server";

afterEach(() => __resetRecCopyCache());

const T0 = 1_000_000;

describe("recCopyCacheKey", () => {
  it("joins quiz:session:target", () => {
    expect(recCopyCacheKey("q1", "s1", "t1")).toBe("q1:s1:t1");
  });
});

describe("resolveRecCopy", () => {
  it("generates once, then serves the cached copy on a repeat POST", async () => {
    const key = recCopyCacheKey("q", "s", "t");
    const produce = vi.fn(async () => "grounded copy");

    const first = await resolveRecCopy(key, T0, produce);
    expect(first).toEqual({ copy: "grounded copy", cached: false });

    const second = await resolveRecCopy(key, T0 + 1000, produce);
    expect(second).toEqual({ copy: "grounded copy", cached: true });
    expect(produce).toHaveBeenCalledTimes(1); // no second AI call
  });

  it("single-flights concurrent duplicate keys onto ONE generation", async () => {
    const key = recCopyCacheKey("q", "s", "t");
    let resolveGen: (v: string) => void = () => {};
    const produce = vi.fn(
      () =>
        new Promise<string>((res) => {
          resolveGen = res;
        }),
    );

    const p1 = resolveRecCopy(key, T0, produce);
    const p2 = resolveRecCopy(key, T0, produce);
    resolveGen("shared");
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(produce).toHaveBeenCalledTimes(1);
    expect(r1.copy).toBe("shared");
    expect(r2.copy).toBe("shared");
    expect(r2.cached).toBe(true); // the second awaiter rode the in-flight promise
  });

  it("expires an entry after the TTL and regenerates", async () => {
    const key = recCopyCacheKey("q", "s", "t");
    const produce = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("first")
      .mockResolvedValueOnce("second");

    await resolveRecCopy(key, T0, produce);
    expect(getCachedRecCopy(key, T0 + 60_000)).toBe("first");
    // 31 minutes later — past the 30-min TTL.
    expect(getCachedRecCopy(key, T0 + 31 * 60_000)).toBeNull();
    const again = await resolveRecCopy(key, T0 + 31 * 60_000, produce);
    expect(again).toEqual({ copy: "second", cached: false });
    expect(produce).toHaveBeenCalledTimes(2);
  });

  it("does not cache a rejected generation and clears the in-flight slot", async () => {
    const key = recCopyCacheKey("q", "s", "t");
    const produce = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("credit balance is too low"))
      .mockResolvedValueOnce("recovered");

    await expect(resolveRecCopy(key, T0, produce)).rejects.toThrow(/credit/);
    expect(getCachedRecCopy(key, T0)).toBeNull(); // nothing cached
    // A later retry can regenerate (the in-flight slot was released).
    const retry = await resolveRecCopy(key, T0 + 1, produce);
    expect(retry.copy).toBe("recovered");
  });

  it("keys are independent (different session → separate generation)", async () => {
    const produce = vi.fn(async () => "c");
    await resolveRecCopy(recCopyCacheKey("q", "s1", "t"), T0, produce);
    await resolveRecCopy(recCopyCacheKey("q", "s2", "t"), T0, produce);
    expect(produce).toHaveBeenCalledTimes(2);
  });
});
