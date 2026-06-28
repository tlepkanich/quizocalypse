import { describe, it, expect } from "vitest";
import { answerGridColumns } from "./answerLayout";

describe("answerGridColumns (Design Settings §4 answer layout)", () => {
  it("UNSET → today's responsive default (2-up desktop, 1-up mobile) — byte-stable", () => {
    expect(answerGridColumns({ minimal: false, desktop: true })).toBe("repeat(2, minmax(0, 1fr))");
    expect(answerGridColumns({ minimal: false, desktop: false })).toBe("1fr");
    expect(answerGridColumns({ minimal: false, desktop: true, answerLayout: "auto" })).toBe(
      "repeat(2, minmax(0, 1fr))",
    );
  });

  it("minimal chrome always single column, ignoring answer_layout", () => {
    expect(answerGridColumns({ minimal: true, desktop: true, answerLayout: "grid", gridColumns: 3 })).toBe("1fr");
    expect(answerGridColumns({ minimal: true, desktop: false, answerLayout: "list" })).toBe("1fr");
  });

  it("list → single column on every breakpoint", () => {
    expect(answerGridColumns({ minimal: false, desktop: true, answerLayout: "list" })).toBe("1fr");
    expect(answerGridColumns({ minimal: false, desktop: false, answerLayout: "list" })).toBe("1fr");
  });

  it("grid honors answer_grid_columns on desktop, stays 1-up on mobile", () => {
    expect(answerGridColumns({ minimal: false, desktop: true, answerLayout: "grid", gridColumns: 3 })).toBe(
      "repeat(3, minmax(0, 1fr))",
    );
    expect(answerGridColumns({ minimal: false, desktop: true, answerLayout: "grid", gridColumns: 2 })).toBe(
      "repeat(2, minmax(0, 1fr))",
    );
    // grid with no explicit columns defaults to 2
    expect(answerGridColumns({ minimal: false, desktop: true, answerLayout: "grid" })).toBe(
      "repeat(2, minmax(0, 1fr))",
    );
    // mobile stays single column even under grid
    expect(answerGridColumns({ minimal: false, desktop: false, answerLayout: "grid", gridColumns: 3 })).toBe("1fr");
  });
});
