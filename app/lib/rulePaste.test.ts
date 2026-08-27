import { describe, expect, it } from "vitest";
import { parsePastedRules, type PasteVocab } from "./rulePaste";

// Vocabulary mirroring the handoff §6 examples (jewelry) plus the §6
// longest-match trap ("Controlling shine and pores" is ONE answer).
const vocab: PasteVocab = {
  questions: [
    {
      id: "q1",
      text: "What are you shopping for?",
      multiSelect: false,
      answers: [
        { id: "a_neck", text: "A necklace" },
        { id: "a_ring", text: "A ring" },
        { id: "a_brace", text: "A bracelet" },
      ],
    },
    {
      id: "q2",
      text: "Which tones?",
      multiSelect: true,
      answers: [
        { id: "a_warm", text: "Warm golds" },
        { id: "a_silver", text: "Silver tones" },
      ],
    },
    {
      id: "q3",
      text: "Skin goal?",
      multiSelect: false,
      answers: [
        { id: "a_shine", text: "Controlling shine and pores" },
        { id: "a_glow", text: "Glow" },
      ],
    },
  ],
  targets: [
    { id: "t_gift", label: "Gift cards" },
    { id: "t_neck", label: "Necklace" },
  ],
};

const parse = (text: string) => parsePastedRules(text, vocab);

describe("parsePastedRules (handoff §6)", () => {
  it("one condition: when A necklace then pin Gift cards", () => {
    const [line] = parse("when A necklace then pin Gift cards");
    expect(line).toMatchObject({
      ok: true,
      conditions: [{ question_id: "q1", answer_id: "a_neck", op: "is" }],
      action: "prioritize",
      targetId: "t_gift",
    });
    expect(line && "match" in line ? line.match : undefined).toBeUndefined();
  });

  it("or within one question → any_of, no rule-level match", () => {
    const [line] = parse("when A ring or A bracelet then pin Gift cards");
    expect(line).toMatchObject({
      ok: true,
      any_of: ["q1"],
      conditions: [
        { question_id: "q1", answer_id: "a_ring", op: "is" },
        { question_id: "q1", answer_id: "a_brace", op: "is" },
      ],
    });
    expect(line && line.ok ? line.match : "x").toBeUndefined();
  });

  it("and across questions → match all (absent field)", () => {
    const [line] = parse("when Warm golds and A necklace then show Necklace");
    expect(line).toMatchObject({
      ok: true,
      action: "show",
      targetId: "t_neck",
      conditions: [
        { question_id: "q2", answer_id: "a_warm", op: "is" },
        { question_id: "q1", answer_id: "a_neck", op: "is" },
      ],
    });
    expect(line && line.ok ? line.match : "x").toBeUndefined();
  });

  it("the §6 four-answer line: two any_of columns joined by and", () => {
    const [line] = parse(
      "when A necklace or A ring and Warm golds or Silver tones then pin Gift cards",
    );
    expect(line).toMatchObject({
      ok: true,
      action: "prioritize",
      any_of: ["q1", "q2"],
    });
    expect(line && line.ok ? line.match : "x").toBeUndefined();
    expect(line && line.ok ? line.conditions : []).toHaveLength(4);
  });

  it("or across questions → match any", () => {
    const [line] = parse("when A necklace or Warm golds then hide Gift cards");
    expect(line).toMatchObject({ ok: true, match: "any", action: "hide" });
  });

  it("longest-whole-match-first: a bare and inside an answer name never splits it", () => {
    const [line] = parse("when Controlling shine and pores then show Necklace");
    expect(line).toMatchObject({
      ok: true,
      conditions: [{ question_id: "q3", answer_id: "a_shine", op: "is" }],
    });
  });

  it("mixing and with or across questions is unmatched, never guessed", () => {
    const [line] = parse("when A necklace or Warm golds and Glow then show Necklace");
    expect(line).toMatchObject({ ok: false });
    expect(line && !line.ok ? line.reason : "").toMatch(/no single reading/i);
  });

  it("and between answers of a single-choice question is unmatched", () => {
    const [line] = parse("when A necklace and A ring then show Necklace");
    expect(line).toMatchObject({ ok: false });
    expect(line && !line.ok ? line.reason : "").toMatch(/single-choice/i);
  });

  it("and between answers of a multi-select = all-of (absent-field default)", () => {
    const [line] = parse("when Warm golds and Silver tones then pin Gift cards");
    expect(line).toMatchObject({
      ok: true,
      conditions: [
        { question_id: "q2", answer_id: "a_warm", op: "is" },
        { question_id: "q2", answer_id: "a_silver", op: "is" },
      ],
    });
    expect(line && line.ok ? line.any_of : ["x"]).toBeUndefined();
  });

  it("near-miss answers are unmatched (nothing is snapped)", () => {
    const [line] = parse("when A neckless then pin Gift cards");
    expect(line).toMatchObject({ ok: false });
    expect(line && !line.ok ? line.reason : "").toMatch(/couldn't match/i);
  });

  it("unknown verb and unknown target are unmatched with pointed reasons", () => {
    const [v, t] = parse(
      "when A necklace then boost Gift cards\nwhen A necklace then pin Gold cards",
    );
    expect(v).toMatchObject({ ok: false });
    expect(v && !v.ok ? v.reason : "").toMatch(/show, pin or hide/);
    expect(t).toMatchObject({ ok: false });
    expect(t && !t.ok ? t.reason : "").toMatch(/No result set/);
  });

  it("a target name shared by two result sets is ambiguous — unmatched", () => {
    const dupVocab: PasteVocab = {
      questions: vocab.questions,
      targets: [
        ...vocab.targets,
        { id: "t_acc1", label: "Accessories" },
        { id: "t_acc2", label: "accessories" },
      ],
    };
    const [line] = parsePastedRules("when A necklace then pin Accessories", dupVocab);
    expect(line).toMatchObject({ ok: false });
    expect(line && !line.ok ? line.reason : "").toMatch(/More than one result set/);
  });

  it("interleaved question runs are unmatched", () => {
    const [line] = parse("when A necklace or Warm golds or A ring then pin Gift cards");
    expect(line).toMatchObject({ ok: false });
  });

  it("blank lines are skipped; line numbers track the paste", () => {
    const lines = parse("\nwhen A necklace then pin Gift cards\n\nwhen nope then pin Gift cards\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ ok: true, lineNumber: 2 });
    expect(lines[1]).toMatchObject({ ok: false, lineNumber: 4 });
  });

  it("case and spacing are forgiven; the parse-back segments are tinted", () => {
    const [line] = parse("WHEN   a Necklace   THEN   PIN   gift CARDS");
    expect(line).toMatchObject({ ok: true, targetId: "t_gift" });
    if (line && line.ok) {
      expect(line.segments.map((s) => s.kind)).toEqual([
        "keyword",
        "answer",
        "keyword",
        "verb",
        "target",
      ]);
    }
  });
});
