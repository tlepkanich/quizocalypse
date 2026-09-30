// Logic step (D16, D16-template, D12, D13, B3-B5, B22-B26, B36) — the sheet
// model: serialize, the cell-level import diff, all-or-nothing rules, the
// grammar in both directions, the example row, the decoder and the Undo.
import { describe, expect, it } from "vitest";

import { logicDoc, rule } from "./logicStep.fixtures";
import {
  applyLogicImport,
  decodeSpreadsheetText,
  exportWorkbook,
  importToastMessage,
  isBinarySpreadsheet,
  joinWhenParts,
  logicSheets,
  nameList,
  parseTypeCell,
  QUESTION_ORDER_PROP,
  splitNames,
  type Cell,
  type PlainWorkbook,
  type RuleSheetRow,
  type SheetCategory,
  type SheetContext,
} from "./logicSheets";
import { ruleWhenMachine } from "./ruleSummary";
import type { DecisionRule, Quiz } from "./quizSchema";
import { setAnswerText } from "./quizMutations";

const cat = (id: string, name: string, n = 3): SheetCategory => ({
  id,
  name,
  productIds: Array.from({ length: n }, (_, i) => `${id}-p${i}`),
  quizId: "quiz",
});
const RECS = [cat("cat1", "Dry fix"), cat("cat2", "Oily, balanced"), cat("cat3", 'Both "mixed"'), cat("catX", "Extra")];
const ctxFor = (style: "rules" | "attributes"): SheetContext => ({
  style,
  categories: RECS,
  recommendations: RECS,
});

const RULES: DecisionRule[] = [
  rule("r1", [["q1", "a1"], ["q2", "b3"]], "cat1"),
  rule("r2", [["q3", "m1"], ["q3", "m2"]], ["cat2", "cat3"], { action: "prioritize" }),
  rule("r3", [["q2", "b1"], ["q2", "b2"], ["q4", "r5", "is_not"]], "catX", { any_of: ["q2"], action: "hide" }),
  rule("r4", [], "cat1", { action: "show" }),
  rule("r5", [["q1", "a2"], ["q3", "m3"]], "gone", { match: "any", action: "show" }),
];

function doc(opts: { rules?: DecisionRule[]; style?: "rules" | "attributes" } = {}): Quiz {
  return logicDoc({ rules: opts.rules ?? RULES, ...(opts.style ? { logic_style: opts.style } : {}) });
}

/** A copy of an exported workbook the test can edit. */
function exported(d: Quiz, ctx: SheetContext): PlainWorkbook {
  const wb = exportWorkbook(d, ctx).workbook;
  return { props: { ...wb.props }, sheets: wb.sheets.map((s) => ({ ...s, rows: s.rows.map((r) => [...r]) })) };
}
const sheet = (wb: PlainWorkbook, name: string) => wb.sheets.find((s) => s.name === name)!;
const col = (wb: PlainWorkbook, name: string, header: string) =>
  sheet(wb, name).rows[0]!.findIndex((h) => String(h).startsWith(header));
const setCell = (wb: PlainWorkbook, name: string, row: number, header: string, v: Cell) => {
  sheet(wb, name).rows[row]![col(wb, name, header)] = v;
};
const dropCol = (wb: PlainWorkbook, name: string, header: string) => {
  const i = col(wb, name, header);
  const s = sheet(wb, name);
  s.rows = s.rows.map((r) => r.filter((_, j) => j !== i));
};
/** Every answers-sheet row of one answer (by id). */
const answerRow = (wb: PlainWorkbook, answerId: string) =>
  sheet(wb, "Answers").rows.findIndex((r) => r[r.length - 1] === answerId);

describe("serializing", () => {
  it("Filter Results + Rules: the Rules sheet then the Answers sheet", () => {
    const sheets = logicSheets(doc(), ctxFor("attributes"));
    expect(sheets.map((s) => s.name)).toEqual(["Rules", "Answers"]);
    const rules = sheets[0]!;
    expect(rules.fileCols).toEqual(["#", "What happens", "Recommendations", "When they answer", "Rule ID (don't edit)"]);
    const files = (rules.rows as Array<{ file: Cell[] }>).map((r) => r.file);
    expect(files[0]).toEqual([1, "Show", "Dry fix", "Q1 = Dry AND Q2 = Yes", "r1"]);
    // Pin, names quoted when they hold a comma or a quote, all-of on a multi.
    expect(files[1]).toEqual([2, "Pin", '"Oily, balanced", "Both ""mixed"""', "(Q3 = Cheeks AND Q3 = Nose)", "r2"]);
    expect(files[2]![3]).toBe("(Q2 = Short OR Q2 = Long) AND NOT (Q4 = 5)");
    expect(files[3]![2]).toBe("Dry fix");
    expect(files[3]![3]).toBe("(no answers)");
    // A deleted recommendation and a stored match any (D13).
    expect(files[4]![2]).toBe("(deleted recommendation)");
    expect(files[4]![3]).toBe("Q1 = Oily OR Q3 = Yes");
  });

  it("the When cell is ruleWhenMachine, the one describer", () => {
    const d = doc();
    const rows = logicSheets(d, ctxFor("attributes"))[0]!.rows as RuleSheetRow[];
    rows.forEach((r, i) => {
      expect(r.when).toBe(ruleWhenMachine(d.decision_rules![i]!, d));
      // The Table draws the same text from its parts (bold joins).
      expect(joinWhenParts(r.whenParts)).toBe(r.when);
    });
  });

  it("the Answers sheet: types, roles, shows / keeps, then, ids", () => {
    const sh = logicSheets(doc(), ctxFor("attributes"))[1]!;
    const files = (sh.rows as Array<{ file: Cell[] }>).map((r) => r.file);
    expect(sh.fileCols.at(-1)).toBe("Answer ID (don't edit)");
    expect(files[0]).toEqual(["Q1", "Skin feel", "Single select", "Dry", "Picks results", "Dry fix", "Next question", "a1"]);
    expect(files[1]![5]).toBe('"Oily, balanced"');
    expect(files[3]!.slice(2, 6)).toEqual(["Single select", "Short", "Info only", ""]);
    expect(files[6]!.slice(2, 6)).toEqual(["Multi-select · pick 1–2", "Cheeks", "Narrows", "Tag: cheeks"]);
    expect(files[8]![5]).toBe("Keeps everything");
    expect(files[9]![2]).toBe("Scale · 1–5");
    // B64: the last question's unset route goes to the results.
    expect(files[13]![6]).toBe("Straight to results");
    // Question-level cells repeat on every file row.
    expect(files[1]!.slice(0, 3)).toEqual(["Q1", "Skin feel", "Single select"]);
  });

  it("Rules only: the Rules sheet then the read-only Recommendations sheet", () => {
    const d = doc({ style: "rules" });
    const [rules, recs] = logicSheets(d, ctxFor("rules"));
    expect(recs!.name).toBe("Recommendations");
    // Every verb reads Show in Rules only.
    expect((rules!.rows as Array<{ verb: string }>).map((r) => r.verb)).toEqual(["Show", "Show", "Show", "Show", "Show"]);
    const files = (recs!.rows as Array<{ file: Cell[] }>).map((r) => r.file);
    // r1 shows cat1; r2 (Pin) shows cat2 + cat3; r3 is a stored Hide (never
    // counts); r4 has no answers (never runs).
    expect(files[0]).toEqual(["Dry fix", 3, "1", "Has a rule"]);
    expect(files[1]).toEqual(["Oily, balanced", 3, "2", "Has a rule"]);
    expect(files[3]).toEqual(["Extra", 3, "—", "Needs a rule"]);
  });

  it("D16-template: an empty Rules sheet gets one example row from the quiz's own words", () => {
    const { workbook, example } = exportWorkbook(doc({ rules: [] }), ctxFor("attributes"));
    expect(example).toBe(true);
    expect(sheet(workbook, "Rules").rows).toEqual([
      ["#", "What happens", "Recommendations", "When they answer", "Rule ID (don't edit)"],
      [1, "Show", "Dry fix", "Q1 = Dry", "EXAMPLE"],
    ]);
    expect(workbook.props?.[QUESTION_ORDER_PROP]).toBe("q1,q2,q3,q4");
    const bare = exportWorkbook(doc({ rules: [] }), { style: "rules", categories: [], recommendations: [] });
    expect(sheet(bare.workbook, "Rules").rows[1]).toEqual([
      1,
      "Show",
      "Your recommendation name",
      "Q1 = Dry",
      "EXAMPLE",
    ]);
    expect(exportWorkbook(doc(), ctxFor("attributes")).example).toBe(false);
  });

  it("nameList and splitNames round trip commas and quotes (B23)", () => {
    const names = ["Plain", "Oily, balanced", 'Both "mixed"', 'a,"b"'];
    expect(splitNames(nameList(names))).toEqual(names);
    expect(nameList([])).toBe("");
  });

  it("parses only the popover's type words (a hyphen reads as the en dash)", () => {
    expect(parseTypeCell("single select")).toEqual({ type: "single_select" });
    expect(parseTypeCell("Multi-select · pick 2-3")).toEqual({ type: "multi_select", min: 2, max: 3 });
    expect(parseTypeCell("Multi-select · pick 2")).toEqual({ type: "multi_select", min: 2, max: 2 });
    expect(parseTypeCell("Scale · 1-7")).toEqual({ type: "rating", five: false, n: 7 });
    expect(parseTypeCell("Five-point scale")).toEqual({ type: "rating", five: true, n: 5 });
    expect(parseTypeCell("Dropdown")).toBeNull();
  });
});

describe("import: round trip", () => {
  it.each(["attributes", "rules"] as const)("an unchanged export is Nothing changed (%s)", (style) => {
    const d = doc({ style });
    const res = applyLogicImport(d, exported(d, ctxFor(style)), ctxFor(style));
    expect(res.changes).toBe(0);
    expect(res.skipped).toBe(0);
    expect(res.notes).toEqual([]);
    expect(res.doc).toBe(d);
    expect(res.inverse).toBeNull();
    expect(importToastMessage(res)).toBe("Nothing changed");
  });

  it("an unchanged Answers sheet imported into a Rules-only quiz changes nothing", () => {
    const d = doc({ style: "rules" });
    const wb = exported(d, ctxFor("attributes"));
    const res = applyLogicImport(d, wb, ctxFor("rules"));
    expect(res.changes).toBe(0);
  });

  it("B3: repeated answer text (\"Yes\" on Q2 and Q3) never moves a rule", () => {
    const d = doc({ rules: [rule("r1", [["q3", "m3"]], "cat1")] });
    const wb = exported(d, ctxFor("attributes"));
    expect(sheet(wb, "Rules").rows[1]![3]).toBe("Q3 = Yes");
    expect(applyLogicImport(d, wb, ctxFor("attributes")).changes).toBe(0);
  });

  it("the D16 template imports back as nothing, with a note; rows under it import", () => {
    const d = doc({ rules: [] });
    const wb = exported(d, ctxFor("attributes"));
    const res = applyLogicImport(d, wb, ctxFor("attributes"));
    expect(res.changes).toBe(0);
    expect(res.notes).toEqual(["Ignored the example row"]);
    expect(importToastMessage(res)).toBe("Nothing changed · Ignored the example row");
    sheet(wb, "Rules").rows.push([2, "Show", "Extra", "Q2 = Long", ""]);
    const res2 = applyLogicImport(d, wb, ctxFor("attributes"));
    expect(res2.changes).toBe(1);
    expect(res2.doc.decision_rules).toHaveLength(1);
    expect(res2.doc.decision_rules![0]).toMatchObject({
      conditions: [{ question_id: "q2", answer_id: "b2", op: "is" }],
      target_id: "catX",
      action: "show",
    });
    expect(importToastMessage(res2)).toBe("Imported 1 change · Ignored the example row");
  });
});

describe("import: the Rules sheet", () => {
  it("B25: one inserted rule counts one change", () => {
    const d = doc();
    const wb = exported(d, ctxFor("attributes"));
    sheet(wb, "Rules").rows.splice(2, 0, [2, "Show", "Extra", "Q1 = Both", ""]);
    const res = applyLogicImport(d, wb, ctxFor("attributes"));
    expect(res.changes).toBe(1);
    expect(res.doc.decision_rules!.map((r) => r.id).slice(0, 1)).toEqual(["r1"]);
    expect(res.doc.decision_rules).toHaveLength(6);
    expect(res.notes).toContain("# ignored: rules keep their row order, so move rows to reorder");
  });

  it("a moved row reorders by row order and counts one", () => {
    const d = doc();
    const wb = exported(d, ctxFor("attributes"));
    const rows = sheet(wb, "Rules").rows;
    const [moved] = rows.splice(1, 1);
    rows.push(moved!);
    const res = applyLogicImport(d, wb, ctxFor("attributes"));
    expect(res.doc.decision_rules!.map((r) => r.id)).toEqual(["r2", "r3", "r4", "r5", "r1"]);
    expect(res.changes).toBe(1);
  });

  it("a deleted row removes the rule and names it", () => {
    const d = doc();
    const wb = exported(d, ctxFor("attributes"));
    sheet(wb, "Rules").rows.splice(2, 1);
    const res = applyLogicImport(d, wb, ctxFor("attributes"));
    expect(res.doc.decision_rules!.map((r) => r.id)).toEqual(["r1", "r3", "r4", "r5"]);
    expect(res.notes).toContain("Removed rules that aren't in the file: 2");
    expect(res.changes).toBe(1);
  });

  it("edits only the changed cells, keeping a legacy action-less rule action-less", () => {
    const legacy: DecisionRule = { id: "L", conditions: [{ question_id: "q1", answer_id: "a1", op: "is" }], target_id: "cat1" };
    const d = doc({ rules: [legacy] });
    const wb = exported(d, ctxFor("attributes"));
    setCell(wb, "Rules", 1, "Recommendations", "Extra, Dry fix");
    const res = applyLogicImport(d, wb, ctxFor("attributes"));
    expect(res.changes).toBe(1);
    expect(res.doc.decision_rules![0]).toEqual({
      id: "L",
      conditions: legacy.conditions,
      target_id: "catX",
      target_ids: ["catX", "cat1"],
    });
  });

  it("B22: one bad row means no rule changes, named by its spreadsheet row; answers still apply", () => {
    const d = doc();
    const wb = exported(d, ctxFor("attributes"));
    setCell(wb, "Rules", 1, "Recommendations", "Dry fixx");
    setCell(wb, "Rules", 3, "When they answer", "Q1 = Nope");
    setCell(wb, "Answers", answerRow(wb, "b1"), "Answer", "Tiny");
    const res = applyLogicImport(d, wb, ctxFor("attributes"));
    expect(res.doc.decision_rules).toEqual(d.decision_rules);
    expect(res.skipped).toBe(2);
    expect(res.notes[0]).toBe(
      "No rule changed: Rules row 2: there's no recommendation called “Dry fixx”. Fix it and import again (+1 more row)",
    );
    expect(res.changes).toBe(1);
    const q2 = res.doc.nodes.find((n) => n.id === "q2");
    expect(q2?.type === "question" && q2.data.answers[0]!.text).toBe("Tiny");
  });

  it("D12: NOT (A AND B) is refused by name", () => {
    const d = doc();
    const wb = exported(d, ctxFor("attributes"));
    setCell(wb, "Rules", 1, "When they answer", "NOT (Q3 = Cheeks AND Q3 = Nose)");
    const res = applyLogicImport(d, wb, ctxFor("attributes"));
    expect(res.changes).toBe(0);
    expect(res.notes[0]).toContain(
      "Rules row 2: an is-not line means none of these answers, so write NOT (A OR B), not NOT (A AND B)",
    );
  });

  it("all-of on a single select is refused, and all-of past the pick limit", () => {
    const d = doc();
    const wb = exported(d, ctxFor("attributes"));
    setCell(wb, "Rules", 1, "When they answer", "(Q1 = Dry AND Q1 = Oily)");
    expect(applyLogicImport(d, wb, ctxFor("attributes")).notes[0]).toContain(
      "Q1 is single select, so a shopper can't pick both. Use OR",
    );
    setCell(wb, "Rules", 1, "When they answer", "(Q3 = Cheeks AND Q3 = Nose AND Q3 = Yes)");
    expect(applyLogicImport(d, wb, ctxFor("attributes")).notes[0]).toContain(
      "They can pick at most 2 on Q3, so all 3 can never happen together",
    );
  });

  it("D13: a new row's cross-question OR becomes adjacent rules; a stored match any keeps it", () => {
    const d = doc();
    const wb = exported(d, ctxFor("attributes"));
    sheet(wb, "Rules").rows.push([6, "Show", "Extra", "Q1 = Both OR q2 = long", ""]);
    // The stored match-any rule edited in place keeps its OR.
    setCell(wb, "Rules", 5, "When they answer", "Q1 = Both OR Q3 = Yes");
    setCell(wb, "Rules", 5, "Recommendations", "Extra");
    const res = applyLogicImport(d, wb, ctxFor("attributes"));
    const rules = res.doc.decision_rules!;
    expect(rules).toHaveLength(7);
    expect(rules[4]).toMatchObject({ id: "r5", match: "any", target_id: "catX" });
    expect(rules[5]!.conditions).toEqual([{ question_id: "q1", answer_id: "a3", op: "is" }]);
    expect(rules[6]!.conditions).toEqual([{ question_id: "q2", answer_id: "b2", op: "is" }]);
    expect(rules[5]!.match).toBeUndefined();
    expect(res.notes).toContain(
      "Rules row 7: answers from two questions joined with OR became one rule per question",
    );
  });

  it("bare text resolves only when one question has it; answers are never split on and/or", () => {
    const d = doc();
    const wb = exported(d, ctxFor("attributes"));
    setCell(wb, "Rules", 1, "When they answer", "Yes");
    expect(applyLogicImport(d, wb, ctxFor("attributes")).notes[0]).toContain(
      "“Yes” is an answer on Q2 and Q3. Write it as Q3 = Yes",
    );
    // An answer holding the word "and".
    const d2 = { ...d };
    const renamed = setAnswerText(d2, "q1", "a3", "Dry and oily");
    const wb2 = exported(renamed, ctxFor("attributes"));
    setCell(wb2, "Rules", 1, "When they answer", "Q1 = dry and oily and Q2 = Short");
    const res = applyLogicImport(renamed, wb2, ctxFor("attributes"));
    expect(res.notes).toEqual([]);
    expect(res.doc.decision_rules![0]!.conditions).toEqual([
      { question_id: "q1", answer_id: "a3", op: "is" },
      { question_id: "q2", answer_id: "b1", op: "is" },
    ]);
  });

  it("Rules only refuses a changed Pin / Hide; an unchanged stored Pin survives", () => {
    const d = doc({ style: "rules" });
    const wb = exported(d, ctxFor("rules"));
    expect(applyLogicImport(d, wb, ctxFor("rules")).changes).toBe(0);
    setCell(wb, "Rules", 1, "What happens", "Hide");
    expect(applyLogicImport(d, wb, ctxFor("rules")).notes[0]).toContain(
      "this quiz decides by rules, so every rule shows its recommendations. Use Show",
    );
  });

  it("B5: a missing column leaves its field unchanged; a blank # is still a rule", () => {
    const d = doc();
    const wb = exported(d, ctxFor("attributes"));
    dropCol(wb, "Rules", "When they answer");
    setCell(wb, "Rules", 1, "#", "");
    setCell(wb, "Rules", 1, "What happens", "Pin");
    const res = applyLogicImport(d, wb, ctxFor("attributes"));
    expect(res.changes).toBe(1);
    expect(res.doc.decision_rules![0]).toMatchObject({ id: "r1", action: "prioritize", conditions: RULES[0]!.conditions });
  });

  it("an unknown or repeated rule ID is a bad row", () => {
    const d = doc();
    const wb = exported(d, ctxFor("attributes"));
    setCell(wb, "Rules", 1, "Rule ID", "nope");
    expect(applyLogicImport(d, wb, ctxFor("attributes")).notes[0]).toContain(
      "Rules row 2: this rule ID isn't in the quiz. Clear it to add the row as a new rule",
    );
  });

  it("without the Rule ID column, rows keep identity by position", () => {
    const d = doc();
    const wb = exported(d, ctxFor("attributes"));
    dropCol(wb, "Rules", "Rule ID");
    expect(applyLogicImport(d, wb, ctxFor("attributes")).changes).toBe(0);
    setCell(wb, "Rules", 1, "Recommendations", "Extra");
    const res = applyLogicImport(d, wb, ctxFor("attributes"));
    expect(res.changes).toBe(1);
    expect(res.doc.decision_rules![0]).toMatchObject({ id: "r1", target_id: "catX" });
  });
});

describe("import: the Answers sheet", () => {
  it("renames an answer and a rule edit written with the old text still resolves", () => {
    const d = doc();
    const wb = exported(d, ctxFor("attributes"));
    setCell(wb, "Answers", answerRow(wb, "a1"), "Answer", "Parched");
    setCell(wb, "Rules", 1, "When they answer", "Q1 = Dry AND Q2 = Long");
    const res = applyLogicImport(d, wb, ctxFor("attributes"));
    expect(res.changes).toBe(2);
    expect(res.doc.decision_rules![0]!.conditions).toEqual([
      { question_id: "q1", answer_id: "a1", op: "is" },
      { question_id: "q2", answer_id: "b2", op: "is" },
    ]);
  });

  it("B4: a deleted row changes nothing else and is reported", () => {
    const d = doc();
    const wb = exported(d, ctxFor("attributes"));
    sheet(wb, "Answers").rows.splice(answerRow(wb, "a2"), 1);
    const res = applyLogicImport(d, wb, ctxFor("attributes"));
    expect(res.changes).toBe(0);
    expect(res.notes).toEqual(["Q1: 1 answer isn't in the file; import never deletes answers"]);
  });

  it("without ids, rows match by Q and text, then a rename pairs one for one", () => {
    const d = doc();
    const wb = exported(d, ctxFor("attributes"));
    dropCol(wb, "Answers", "Answer ID");
    expect(applyLogicImport(d, wb, ctxFor("attributes")).changes).toBe(0);
    // Every row of Q1 is edited in place: row 2 renamed.
    setCell(wb, "Answers", 2, "Answer", "Slick");
    const res = applyLogicImport(d, wb, ctxFor("attributes"));
    const q1 = res.doc.nodes.find((n) => n.id === "q1");
    expect(q1?.type === "question" && q1.data.answers.map((a) => a.text)).toEqual(["Dry", "Slick", "Both"]);
    // An extra row never adds an answer.
    sheet(wb, "Answers").rows.splice(3, 0, ["Q1", "Skin feel", "Single select", "Sticky", "Picks results", "", "Next question"]);
    const res2 = applyLogicImport(d, wb, ctxFor("attributes"));
    expect(res2.notes.join(" | ")).toContain("import never adds answers");
  });

  it("an unknown answer ID is skipped", () => {
    const d = doc();
    const wb = exported(d, ctxFor("attributes"));
    setCell(wb, "Answers", 1, "Answer ID", "zzz");
    const res = applyLogicImport(d, wb, ctxFor("attributes"));
    expect(res.skipped).toBe(1);
    expect(res.notes).toContain("Answers row 2: this answer ID isn't in the quiz");
  });

  it("D9: Picks results moves through the one role path and names what it cleared", () => {
    const d = doc();
    const wb = exported(d, ctxFor("attributes"));
    for (const id of ["b1", "b2", "b3"]) setCell(wb, "Answers", answerRow(wb, id), "What it does", "Picks results");
    const res = applyLogicImport(d, wb, ctxFor("attributes"));
    expect(res.notes).toContain("Q2 now picks the result. Q1's 3 recommendations were removed");
    const q1 = res.doc.nodes.find((n) => n.id === "q1");
    const q2 = res.doc.nodes.find((n) => n.id === "q2");
    expect(q2?.type === "question" && q2.data.role).toBe("decides");
    expect(q1?.type === "question" && q1.data.answers.every((a) => !a.target_id)).toBe(true);
    // Two questions asking to pick: neither applies.
    setCell(wb, "Answers", answerRow(wb, "r1"), "What it does", "Picks results");
    const res2 = applyLogicImport(d, wb, ctxFor("attributes"));
    expect(res2.notes).toContain("Only one question can pick the result");
  });

  it("question rows that disagree are skipped", () => {
    const d = doc();
    const wb = exported(d, ctxFor("attributes"));
    setCell(wb, "Answers", answerRow(wb, "a1"), "Question", "One");
    setCell(wb, "Answers", answerRow(wb, "a2"), "Question", "Two");
    const res = applyLogicImport(d, wb, ctxFor("attributes"));
    expect(res.notes).toContain("Q1: its rows don't agree on Question");
    expect(res.changes).toBe(0);
  });

  it("Type: leaving multi-select converts all-of rules; scale points must match", () => {
    const d = doc();
    const wb = exported(d, ctxFor("attributes"));
    for (const id of ["m1", "m2", "m3"]) setCell(wb, "Answers", answerRow(wb, id), "Type", "Single select");
    for (const id of ["r1", "r2", "r3", "r4", "r5"]) setCell(wb, "Answers", answerRow(wb, id), "Type", "Scale · 1-6");
    const res = applyLogicImport(d, wb, ctxFor("attributes"));
    const q3 = res.doc.nodes.find((n) => n.id === "q3");
    expect(q3?.type === "question" && q3.data.question_type).toBe("single_select");
    expect(q3?.type === "question" && q3.data.max_selections).toBeUndefined();
    expect(res.doc.decision_rules![1]!.any_of).toEqual(["q3"]);
    expect(res.notes).toContain("Rules on Q3 now match any of their answers");
    expect(res.notes).toContain("Q4 has 5 answers. Change its points in the app");
    expect(res.changes).toBe(2);
  });

  it("Five-point scale stamps the preset; multi-select limits follow the steppers", () => {
    const d = doc();
    const wb = exported(d, ctxFor("attributes"));
    for (const id of ["r1", "r2", "r3", "r4", "r5"]) setCell(wb, "Answers", answerRow(wb, id), "Type", "Five-point scale");
    for (const id of ["m1", "m2", "m3"]) setCell(wb, "Answers", answerRow(wb, id), "Type", "Multi-select · pick 1–3");
    const res = applyLogicImport(d, wb, ctxFor("attributes"));
    const q4 = res.doc.nodes.find((n) => n.id === "q4");
    const q3 = res.doc.nodes.find((n) => n.id === "q3");
    expect(q4?.type === "question" && q4.data.scale_config).toMatchObject({ min: 1, max: 5 });
    expect(q3?.type === "question" && q3.data.max_selections).toBeUndefined();
    expect(res.changes).toBe(2);
    const again = exported(res.doc, ctxFor("attributes"));
    expect(applyLogicImport(res.doc, again, ctxFor("attributes")).changes).toBe(0);
  });

  it("Shows / keeps: names on a Picks question, typed values on a Narrows question", () => {
    const d = doc();
    const wb = exported(d, ctxFor("attributes"));
    setCell(wb, "Answers", answerRow(wb, "a1"), "Shows / keeps", '"Oily, balanced", Dry fix');
    setCell(wb, "Answers", answerRow(wb, "m1"), "Shows / keeps", "Tag: fit · slim, Metafield: custom.Skin · Dry, Variant: Size · 30 ml");
    setCell(wb, "Answers", answerRow(wb, "m2"), "Shows / keeps", "Keeps everything");
    setCell(wb, "Answers", answerRow(wb, "m3"), "Shows / keeps", "");
    const res = applyLogicImport(d, wb, ctxFor("attributes"));
    expect(res.changes).toBe(4);
    const q1 = res.doc.nodes.find((n) => n.id === "q1");
    expect(q1?.type === "question" && q1.data.answers[0]).toMatchObject({ target_id: "cat2", target_ids: ["cat2", "cat1"] });
    const q3 = res.doc.nodes.find((n) => n.id === "q3");
    if (q3?.type !== "question") throw new Error("q3");
    expect(q3.data.answers[0]).toMatchObject({
      tags: ["fit:slim"],
      metafield_filters: [{ key: "custom.Skin", value: "Dry" }],
      variant_filters: [{ name: "Size", value: "30 ml" }],
    });
    expect(q3.data.answers[1]!.no_preference).toBe(true);
    expect(q3.data.answers[2]!.no_preference).toBeUndefined();
    // Round trip of the new values is exact.
    expect(applyLogicImport(res.doc, exported(res.doc, ctxFor("attributes")), ctxFor("attributes")).changes).toBe(0);
    // An unknown name skips the cell.
    setCell(wb, "Answers", answerRow(wb, "a2"), "Shows / keeps", "Nope");
    expect(applyLogicImport(d, wb, ctxFor("attributes")).notes).toContain("Q1: there's no recommendation called “Nope”");
  });

  it("Then: forward routes only, compared by where the answer really goes", () => {
    const d = doc();
    const wb = exported(d, ctxFor("attributes"));
    setCell(wb, "Answers", answerRow(wb, "a1"), "Then", "Skips to Q4");
    setCell(wb, "Answers", answerRow(wb, "b1"), "Then", "Skips to Q1");
    setCell(wb, "Answers", answerRow(wb, "r5"), "Then", "Next question");
    const res = applyLogicImport(d, wb, ctxFor("attributes"));
    expect(res.changes).toBe(1);
    expect(res.doc.edges.some((e) => e.source === "q1" && e.source_handle === "h1" && e.target === "q4")).toBe(true);
    expect(res.notes).toContain("“Short” on Q2: routes only go forward");
    // Numbering follows the flow, so the re-export reads the new order; it
    // still imports back as nothing.
    expect(applyLogicImport(res.doc, exported(res.doc, ctxFor("attributes")), ctxFor("attributes")).changes).toBe(0);
  });

  it("Rules only: roles and results on an Answers sheet are saved, with a note", () => {
    const d = doc({ style: "rules" });
    const wb = exported(d, ctxFor("attributes"));
    setCell(wb, "Answers", answerRow(wb, "a1"), "Shows / keeps", "Extra");
    const res = applyLogicImport(d, wb, ctxFor("rules"));
    expect(res.changes).toBe(1);
    expect(res.notes).toContain(
      "This quiz decides by rules, so the roles and results on the Answers sheet were saved but don't change what shoppers see",
    );
    expect(res.doc.logic_style).toBe("rules");
  });

  it("B21: markup in text columns is stored as plain text", () => {
    const d = doc();
    const wb = exported(d, ctxFor("attributes"));
    setCell(wb, "Answers", answerRow(wb, "a1"), "Answer", '<img src=x onerror="alert(1)">');
    const res = applyLogicImport(d, wb, ctxFor("attributes"));
    const q1 = res.doc.nodes.find((n) => n.id === "q1");
    expect(q1?.type === "question" && q1.data.answers[0]!.text).toBe('<img src=x onerror="alert(1)">');
  });
});

describe("import: the file as a whole", () => {
  it("B36: Recommendations sheet edits, an unknown sheet and extra columns are reported", () => {
    const d = doc({ style: "rules" });
    const wb = exported(d, ctxFor("rules"));
    setCell(wb, "Recommendations", 1, "Status", "Needs a rule");
    wb.sheets.push({ name: "Sheet2", rows: [["hello"]] });
    sheet(wb, "Rules").rows[0]!.push("Notes");
    const res = applyLogicImport(d, wb, ctxFor("rules"));
    expect(res.changes).toBe(0);
    expect(res.notes).toEqual([
      "Ignored sheet “Sheet2”: it isn't a Rules or Answers sheet",
      "Ignored the “notes” column on the Rules sheet",
      "Recommendations sheet is read-only, so edits there were ignored",
    ]);
  });

  it("a file with no Rules or Answers sheet changes nothing", () => {
    const res = applyLogicImport(doc(), { sheets: [{ name: "X", rows: [["a", "b"], [1, 2]] }] }, ctxFor("attributes"));
    expect(res.notes).toEqual([
      "Nothing in that file matched the Rules or Answers sheet. Import the file Export writes",
    ]);
  });

  it("a file exported before the questions changed is refused whole", () => {
    const d = doc();
    const wb = exported(d, ctxFor("attributes"));
    wb.props = { [QUESTION_ORDER_PROP]: "q2,q1,q3,q4" };
    const res = applyLogicImport(d, wb, ctxFor("attributes"));
    expect(res.error).toBe("Your questions changed since this file was exported. Export again, then redo your edits.");
    expect(res.doc).toBe(d);
  });

  it("the toast line shows two notes, then a count", () => {
    expect(importToastMessage({ changes: 2, skipped: 1, notes: ["a", "b", "c", "d"] })).toBe(
      "Imported 2 changes · 1 skipped · a · b · +2 more",
    );
  });
});

describe("import: Undo (D7)", () => {
  it("the inverse restores what the import changed", () => {
    const d = doc();
    const wb = exported(d, ctxFor("attributes"));
    setCell(wb, "Answers", answerRow(wb, "a1"), "Answer", "Parched");
    setCell(wb, "Answers", answerRow(wb, "a1"), "Then", "Skips to Q4");
    sheet(wb, "Rules").rows.splice(1, 1);
    const res = applyLogicImport(d, wb, ctxFor("attributes"));
    const undone = res.inverse!(res.doc);
    expect(undone.decision_rules).toEqual(d.decision_rules);
    expect(undone.nodes).toEqual(d.nodes);
    expect(undone.edges).toEqual(d.edges);
  });

  it("an edit made after the import survives its Undo", () => {
    const d = doc();
    const wb = exported(d, ctxFor("attributes"));
    setCell(wb, "Answers", answerRow(wb, "a1"), "Answer", "Parched");
    const res = applyLogicImport(d, wb, ctxFor("attributes"));
    const later = setAnswerText(res.doc, "q2", "b1", "Brief");
    const undone = res.inverse!(later);
    const q1 = undone.nodes.find((n) => n.id === "q1");
    const q2 = undone.nodes.find((n) => n.id === "q2");
    expect(q1?.type === "question" && q1.data.answers[0]!.text).toBe("Dry");
    expect(q2?.type === "question" && q2.data.answers[0]!.text).toBe("Brief");
    // A question changed again since the import is left as it is now.
    const again = setAnswerText(res.doc, "q1", "a2", "Slick");
    const undone2 = res.inverse!(again);
    const q1b = undone2.nodes.find((n) => n.id === "q1");
    expect(q1b?.type === "question" && q1b.data.answers.map((a) => a.text)).toEqual(["Parched", "Slick", "Both"]);
  });
});

describe("decoding (B26)", () => {
  it("UTF-8 without a BOM stays intact; Windows-1252 is the fallback", () => {
    const text = "Q,Answer\nQ1,Don’t know — keep it simple\n";
    expect(decodeSpreadsheetText(new TextEncoder().encode(text))).toBe(text);
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("hé")]);
    expect(decodeSpreadsheetText(bom)).toBe("hé");
    // "café" in Windows-1252: é = 0xE9 (invalid UTF-8 on its own).
    expect(decodeSpreadsheetText(new Uint8Array([0x63, 0x61, 0x66, 0xe9]))).toBe("café");
  });

  it("xlsx, xls and UTF-16 go to the library as binary", () => {
    expect(isBinarySpreadsheet(new Uint8Array([0x50, 0x4b, 3, 4]))).toBe(true);
    expect(isBinarySpreadsheet(new Uint8Array([0xd0, 0xcf, 0x11]))).toBe(true);
    expect(isBinarySpreadsheet(new Uint8Array([0xff, 0xfe, 0x51]))).toBe(true);
    expect(isBinarySpreadsheet(new Uint8Array([0xfe, 0xff, 0x00]))).toBe(true);
    expect(isBinarySpreadsheet(new TextEncoder().encode("Q,Answer"))).toBe(false);
  });
});
