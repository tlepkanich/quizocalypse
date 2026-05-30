import { describe, expect, it } from "vitest";
import { LATEST_RELEASES, RELEASES } from "./releases";

describe("releases data file", () => {
  it("ships at least one release", () => {
    expect(RELEASES.length).toBeGreaterThan(0);
  });

  it("has unique version strings", () => {
    const versions = RELEASES.map((r) => r.version);
    const unique = new Set(versions);
    expect(unique.size).toBe(versions.length);
  });

  it("every release has at least one feature and a non-empty summary", () => {
    for (const r of RELEASES) {
      expect(r.features.length, `${r.version} has no features`).toBeGreaterThan(0);
      expect(r.summary.length, `${r.version} has empty summary`).toBeGreaterThan(0);
      expect(r.name.length, `${r.version} has empty name`).toBeGreaterThan(0);
    }
  });

  it("every feature has a non-empty title and description", () => {
    for (const r of RELEASES) {
      for (const f of r.features) {
        expect(
          f.title.length,
          `${r.version} feature has empty title`,
        ).toBeGreaterThan(0);
        expect(
          f.description.length,
          `${r.version} feature "${f.title}" has empty description`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("is sorted by date descending", () => {
    for (let i = 1; i < RELEASES.length; i++) {
      const prev = new Date(RELEASES[i - 1]!.date).getTime();
      const curr = new Date(RELEASES[i]!.date).getTime();
      expect(
        prev,
        `${RELEASES[i - 1]!.version} (${RELEASES[i - 1]!.date}) should be ≥ ${RELEASES[i]!.version} (${RELEASES[i]!.date})`,
      ).toBeGreaterThanOrEqual(curr);
    }
  });

  it("LATEST_RELEASES is capped at 4 entries and matches the head of RELEASES", () => {
    expect(LATEST_RELEASES.length).toBe(Math.min(4, RELEASES.length));
    LATEST_RELEASES.forEach((r, i) => {
      expect(r.version).toBe(RELEASES[i]!.version);
    });
  });
});
