// The SheetJS adapter (D16): the plain workbook survives a real xlsx write
// and read, custom properties included (the stale-file guard), text stays
// text, and CSV bytes decode as UTF-8 first (B26).
import * as X from "xlsx";
import { describe, expect, it } from "vitest";

import { logicDoc, rule } from "../../../lib/logicStep.fixtures";
import {
  applyLogicImport,
  exportWorkbook,
  QUESTION_ORDER_PROP,
  type SheetContext,
} from "../../../lib/logicSheets";
import { readSpreadsheet, workbookToPlain, workbookToXlsx } from "./LogicImportExport";

const ctx: SheetContext = {
  style: "attributes",
  categories: [
    { id: "cat1", name: "Dry fix", productIds: ["p1"], quizId: "q" },
    { id: "cat2", name: "Oily, balanced", productIds: [], quizId: "q" },
    { id: "cat3", name: "=SUM(1)", productIds: [], quizId: "q" },
  ],
  recommendations: [],
};
ctx.recommendations = ctx.categories;

describe("SheetJS adapter", () => {
  it("an exported xlsx reads back to the same rows and imports as Nothing changed", () => {
    expect(X.version).toBe("0.20.3");
    const d = logicDoc({ rules: [rule("r1", [["q3", "m3"]], ["cat2", "cat3"])] });
    const { workbook } = exportWorkbook(d, ctx);
    const bytes = new Uint8Array(workbookToXlsx(X, workbook));
    expect(bytes[0]).toBe(0x50);
    const plain = workbookToPlain(X, readSpreadsheet(X, bytes));
    expect(plain.props?.[QUESTION_ORDER_PROP]).toBe("q1,q2,q3,q4");
    expect(plain.sheets.map((s) => s.name)).toEqual(["Rules", "Answers"]);
    const rules = plain.sheets[0]!.rows;
    // A name that looks like a formula stays text.
    expect(rules[1]![2]).toBe('"Oily, balanced", =SUM(1)');
    const res = applyLogicImport(d, plain, ctx);
    expect(res.changes).toBe(0);
    expect(res.notes).toEqual([]);
  });

  it("widths are written per column", () => {
    const d = logicDoc();
    const bytes = new Uint8Array(workbookToXlsx(X, exportWorkbook(d, ctx).workbook));
    const wb = X.read(bytes, { type: "array", cellStyles: true });
    const cols = wb.Sheets.Rules!["!cols"] ?? [];
    expect(cols).toHaveLength(5);
    // Wider columns stay wider (SheetJS reads widths back in its own units).
    const w = cols.map((c) => c.wch ?? c.width ?? 0);
    expect(w[3]!).toBeGreaterThan(w[2]!);
    expect(w[2]!).toBeGreaterThan(w[0]!);
  });

  it("a UTF-8 CSV without a BOM keeps curly quotes and dashes (B26)", () => {
    const csv = "Q,Question,Answer,Answer ID (don't edit)\nQ2,Routine size,Don’t know — keep it simple,b1\n";
    const plain = workbookToPlain(X, readSpreadsheet(X, new TextEncoder().encode(csv)));
    expect(plain.sheets[0]!.rows[1]).toEqual(["Q2", "Routine size", "Don’t know — keep it simple", "b1"]);
    const res = applyLogicImport(logicDoc(), plain, ctx);
    const q2 = res.doc.nodes.find((n) => n.id === "q2");
    expect(q2?.type === "question" && q2.data.answers[0]!.text).toBe("Don’t know — keep it simple");
    expect(res.changes).toBe(1);
  });

  it("a CSV keeps number-like text as written", () => {
    const plain = workbookToPlain(X, readSpreadsheet(X, new TextEncoder().encode("A,B\n007,1-2\n")));
    expect(plain.sheets[0]!.rows[1]).toEqual(["007", "1-2"]);
  });
});
