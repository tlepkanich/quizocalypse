import { describe, expect, it } from "vitest";
import type { Tier1Report } from "../../../../lib/pathReport";
import { checkRows, checkTitle } from "./CheckPopover";

// Logic step redesign — the check popover's rows and title (mock checkPop).
const report = (checks: Tier1Report["checks"]): Tier1Report => ({
  checks,
  outcomes: [],
  verdict: { blocking: 0, warnings: 0, safe: true, label: "" },
});

describe("check popover rows", () => {
  it("orders blocks, then the style note, then warnings, then notes; drops V10/V16", () => {
    const rows = checkRows(
      report([
        { id: "R5", severity: "warn", status: "fail", title: "", findings: [{ message: "w1" }] },
        { id: "V10", severity: "info", status: "fail", title: "", findings: [{ message: "long" }] },
        { id: "V14", severity: "info", status: "fail", title: "", findings: [{ message: "n1" }] },
        { id: "R1", severity: "block", status: "fail", title: "", findings: [{ message: "b1", link: { kind: "rules" } }] },
        { id: "R0", severity: "warn", status: "fail", title: "", findings: [{ message: "style" }] },
        { id: "V16", severity: "info", status: "fail", title: "", findings: [{ message: "cov" }] },
        { id: "V5", severity: "block", status: "pass", title: "", findings: [] },
      ]),
    );
    expect(rows.map((r) => r.message)).toEqual(["b1", "style", "w1", "n1"]);
    expect(rows.map((r) => r.severity)).toEqual(["crit", "warn", "warn", "note"]);
    expect(rows[0]!.link).toEqual({ kind: "rules" });
  });

  it("titles: fix / review / nothing (mock checkPop)", () => {
    expect(checkTitle([{ key: "a", checkId: "R1", severity: "crit", message: "" }])).toBe(
      "1 thing to fix before you continue",
    );
    expect(
      checkTitle([
        { key: "a", checkId: "R5", severity: "warn", message: "" },
        { key: "b", checkId: "R5", severity: "warn", message: "" },
      ]),
    ).toBe("2 things to review · you can still continue");
    expect(checkTitle([{ key: "n", checkId: "V14", severity: "note", message: "" }])).toBe("Nothing to fix");
  });
});
