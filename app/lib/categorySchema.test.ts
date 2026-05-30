import { describe, expect, it } from "vitest";
import { DiscoveredCategory, DiscoveryResult } from "./categorySchema";

describe("DiscoveredCategory", () => {
  it("accepts a well-formed category", () => {
    const parsed = DiscoveredCategory.parse({
      name: "Cozy comfort",
      description: "Soft, warm fabrics for relaxing at home.",
      tags: ["cozy", "soft", "warm", "loungewear"],
      rationale: "Products designed for at-home comfort.",
    });
    expect(parsed.name).toBe("Cozy comfort");
    expect(parsed.tags).toHaveLength(4);
  });

  it("rejects fewer than 2 tags", () => {
    expect(() =>
      DiscoveredCategory.parse({
        name: "x",
        description: "y",
        tags: ["only-one"],
        rationale: "z",
      }),
    ).toThrow();
  });

  it("rejects more than 10 tags", () => {
    expect(() =>
      DiscoveredCategory.parse({
        name: "x",
        description: "y",
        tags: Array.from({ length: 11 }, (_, i) => `t${i}`),
        rationale: "z",
      }),
    ).toThrow();
  });

  it("rejects an empty name", () => {
    expect(() =>
      DiscoveredCategory.parse({
        name: "",
        description: "y",
        tags: ["a", "b"],
        rationale: "z",
      }),
    ).toThrow();
  });

  it("rejects names longer than 60 chars", () => {
    expect(() =>
      DiscoveredCategory.parse({
        name: "x".repeat(61),
        description: "y",
        tags: ["a", "b"],
        rationale: "z",
      }),
    ).toThrow();
  });
});

describe("DiscoveryResult", () => {
  const cat = (name: string) => ({
    name,
    description: "d",
    tags: ["t1", "t2"],
    rationale: "r",
  });

  it("rejects fewer than 3 categories", () => {
    expect(() =>
      DiscoveryResult.parse({
        categories: [cat("a"), cat("b")],
      }),
    ).toThrow();
  });

  it("accepts 3 to 12 categories", () => {
    expect(() =>
      DiscoveryResult.parse({
        categories: [cat("a"), cat("b"), cat("c")],
      }),
    ).not.toThrow();
    expect(() =>
      DiscoveryResult.parse({
        categories: Array.from({ length: 12 }, (_, i) => cat(`c${i}`)),
      }),
    ).not.toThrow();
  });

  it("rejects more than 12 categories", () => {
    expect(() =>
      DiscoveryResult.parse({
        categories: Array.from({ length: 13 }, (_, i) => cat(`c${i}`)),
      }),
    ).toThrow();
  });
});
