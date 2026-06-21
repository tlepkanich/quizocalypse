import { describe, expect, it } from "vitest";
import { suggestBucketStrategy } from "./bucketDetect";
import type { GroupingProduct } from "./categoryGrouping";

const mk = (n: number, fn: (i: number) => Partial<GroupingProduct>): GroupingProduct[] =>
  Array.from({ length: n }, (_, i) => ({
    productId: `p${i}`,
    title: `Product ${i}`,
    tags: [],
    collectionIds: [],
    ...fn(i),
  }));

const cols = [0, 1, 2, 3].map((c) => ({ collectionId: `gid://col${c}`, title: `C${c}` }));

describe("suggestBucketStrategy", () => {
  it("empty catalog → individual products, no signal, sync prompt", () => {
    const s = suggestBucketStrategy([], []);
    expect(s.suggestedType).toBe("product");
    expect(s.strength).toBeNull();
    expect(s.reason).toMatch(/sync/i);
  });

  it("small catalog (<25) → individual products", () => {
    const s = suggestBucketStrategy(mk(10, (i) => ({ tags: [`t${i % 3}`] })), []);
    expect(s.suggestedType).toBe("product");
    expect(s.strength).toBeNull();
    expect(s.reason).toMatch(/10 products/);
  });

  it("strong tag signal → tags, strong, with the coverage stat", () => {
    const s = suggestBucketStrategy(mk(50, (i) => ({ tags: [`tag${i % 4}`] })), []);
    expect(s.suggestedType).toBe("tag");
    expect(s.strength).toBe("strong");
    expect(s.reason).toMatch(/use tags consistently/);
    expect(s.reason).toMatch(/50 of your 50/);
    expect(s.secondary).toBeUndefined();
  });

  it("strong collection signal → collections, strong", () => {
    const s = suggestBucketStrategy(mk(50, (i) => ({ collectionIds: [`gid://col${i % 4}`] })), cols);
    expect(s.suggestedType).toBe("collection");
    expect(s.strength).toBe("strong");
    expect(s.reason).toMatch(/collections cover/);
  });

  it("no clean partition → individual-products fallback", () => {
    const s = suggestBucketStrategy(mk(50, () => ({})), []); // no tags, no collections
    expect(s.suggestedType).toBe("product");
    expect(s.strength).toBeNull();
    expect(s.reason).toMatch(/split cleanly/);
  });

  it("two viable options (tag + collection partition alike) → weak signal with a secondary", () => {
    const s = suggestBucketStrategy(
      mk(50, (i) => ({ tags: [`tag${i % 4}`], collectionIds: [`gid://col${i % 4}`] })),
      cols,
    );
    expect(s.strength).toBe("weak");
    expect(s.secondary).toBeDefined();
    expect(s.reason).toMatch(/could work with/);
  });
});
