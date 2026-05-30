import { describe, expect, it } from "vitest";
import { mergeTags, normalizeTags } from "./enrichTags";

describe("normalizeTags", () => {
  it("lowercases and hyphenates incoming tags", () => {
    const out = normalizeTags(
      ["Cold Weather", "Business_Casual", "WOOL"],
      new Set(),
    );
    expect(out).toEqual(["cold-weather", "business-casual", "wool"]);
  });

  it("excludes tags that already exist case-insensitively", () => {
    const out = normalizeTags(
      ["wool", "Cotton", "WOOL"],
      new Set(["wool"]),
    );
    expect(out).toEqual(["cotton"]);
  });

  it("dedupes after normalization", () => {
    const out = normalizeTags(
      ["cold-weather", "Cold weather", "COLD-WEATHER"],
      new Set(),
    );
    expect(out).toEqual(["cold-weather"]);
  });

  it("strips invalid characters, converts underscores, and collapses hyphens", () => {
    const out = normalizeTags(
      ["high--quality", "merino_wool/200gsm", "  with spaces  "],
      new Set(),
    );
    // slash is invalid → stripped; underscore → hyphen; double-hyphen collapses
    expect(out).toEqual([
      "high-quality",
      "merino-wool200gsm",
      "with-spaces",
    ]);
  });

  it("caps the result at 12 tags", () => {
    const many = Array.from({ length: 20 }, (_, i) => `tag-${i}`);
    const out = normalizeTags(many, new Set());
    expect(out).toHaveLength(12);
  });

  it("rejects tags longer than 60 characters", () => {
    const longTag = "a".repeat(70);
    const out = normalizeTags([longTag, "ok"], new Set());
    expect(out).toEqual(["ok"]);
  });

  it("ignores empty / whitespace-only entries", () => {
    const out = normalizeTags(["", "   ", "valid"], new Set());
    expect(out).toEqual(["valid"]);
  });

  it("preserves colon-prefixed namespaces", () => {
    const out = normalizeTags(["color:red", "season:winter"], new Set());
    expect(out).toEqual(["color:red", "season:winter"]);
  });
});

describe("mergeTags", () => {
  it("appends new tags onto the existing list, preserving order", () => {
    const merged = mergeTags(["a", "b"], ["c", "d"]);
    expect(merged).toEqual(["a", "b", "c", "d"]);
  });

  it("dedupes case-insensitively against existing tags", () => {
    const merged = mergeTags(["Wool"], ["wool", "cotton"]);
    expect(merged).toEqual(["Wool", "cotton"]);
  });

  it("dedupes among the new tags themselves", () => {
    const merged = mergeTags([], ["wool", "Wool", "WOOL", "cotton"]);
    expect(merged).toEqual(["wool", "cotton"]);
  });

  it("returns the existing list unchanged when new tags is empty", () => {
    const existing = ["a", "b"];
    const merged = mergeTags(existing, []);
    expect(merged).toEqual(["a", "b"]);
  });
});
