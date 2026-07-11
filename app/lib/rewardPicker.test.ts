import { describe, it, expect } from "vitest";
import { pickRewardValue } from "./rewardPicker";

describe("§L reward value picker (server-side, deterministic)", () => {
  it("fixed reward returns its value regardless of seed", () => {
    expect(pickRewardValue({ value: 15 }, "s1")).toBe(15);
    expect(pickRewardValue({ value: 15 }, "s2")).toBe(15);
  });

  it("deterministic per seed — same session always gets the same reward (anti-abuse)", () => {
    const r = { value: 10, rangeMax: 20, odds: "equal" as const };
    expect(pickRewardValue(r, "sess-abc")).toBe(pickRewardValue(r, "sess-abc"));
  });

  it("range picks stay within [min, max]", () => {
    for (const seed of ["a", "b", "c", "d", "e", "f", "g"]) {
      const v = pickRewardValue({ value: 10, rangeMax: 20 }, seed);
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThanOrEqual(20);
    }
  });

  it("weighted odds bias toward the low end on average", () => {
    const seeds = Array.from({ length: 200 }, (_, i) => `seed-${i}`);
    const avg = (odds: "equal" | "weighted") =>
      seeds.reduce((a, s) => a + pickRewardValue({ value: 10, rangeMax: 30, odds }, s), 0) / seeds.length;
    expect(avg("weighted")).toBeLessThan(avg("equal"));
  });
});
