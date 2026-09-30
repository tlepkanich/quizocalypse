// ════════════════════════════════════════════════════════════════════════════
// Logic step (handoff §13 "Copy rules for finding messages and check titles",
// D18) — every merchant-facing string the Tier-1 report produces. The check
// popover and the builder's publish card render these, so they carry no em
// dashes and never say decider/deciding, bucket, branch, boost, weight or
// score. Strings marked (mock) in the handoff are approved; the rest are the
// handoff's (proposed) wording. pathReport.ts builds its findings from here
// only, and pathReport.test.ts asserts against these constants.
// ════════════════════════════════════════════════════════════════════════════

/** The words and marks no finding or title may contain (D18). */
export const BANNED_REPORT_WORDS = /—|decid|bucket|branch|boost|weight|score/i;

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** "Q2 · " style prefix used by question findings (mock `findings()`). */
const onQ = (q: string, rest: string) => `${q} · ${rest}`;

const SKIPS_PICKER = "without the question that picks the result";

export const REPORT_COPY = {
  titles: {
    R0: "The logic style is saved",
    V1: "One question picks the result",
    V2: "Every path reaches the question that picks the result",
    V3: "The question that picks the result is required",
    V4: "Every answer that picks the result has a recommendation",
    R1: "Rules only has a rule",
    R2: "A rule can show something",
    R3: "Every rule has answers and a recommendation",
    V5: "Rules show recommendations that exist",
    V6: "Rules use answers that exist",
    V7: "Every rule can be reached",
    V8: "No rule is caught first by a rule above it",
    V9: "No half-built rules",
    R4: "No rule needs more answers than shoppers can pick",
    R5: "Every recommendation can be shown",
    V10: "Answer text fits comfortably",
    V11: "Every narrowing answer keeps products",
    V12gap: "Slider bands cover the whole range",
    V12overlap: "Slider bands don't overlap",
    V13: "Every narrowing answer has a value",
    V14: "Every product in scope is live",
    V15: "Narrowing questions split the catalog",
    V16: "The starting set covers the catalog",
    S1: "Every step is connected",
  },

  /** R0 (proposed). Also appended to every Filter block that fires with it. */
  styleNotSaved:
    "This quiz still picks results the Filter Results + Rules way. Choose 'Rules only' in the title menu to save it.",

  /** V1 (mock / proposed). */
  noPicker: "No question picks the result. Give one question that job.",
  alsoPicks: (q: string) => `${q} also picks the result. Only one question can.`,

  /** V2 (proposed, from the B17 fix): one finding per route. */
  straightToResults: (q: string, answer: string) =>
    onQ(q, `“${answer}” goes straight to the results ${SKIPS_PICKER}`),
  skipsTo: (q: string, answer: string, to: string) =>
    onQ(q, `“${answer}” skips to ${to} ${SKIPS_PICKER}`),
  canFinishWithout: (q: string, answer: string) =>
    onQ(q, `“${answer}” can finish the quiz ${SKIPS_PICKER}`),
  /** The gate's decider_bypass with no answer to pin it on. */
  pathSkipsPicker: `A path can finish the quiz ${SKIPS_PICKER}. Send it through that question.`,

  /** V3 (proposed). */
  pickerOptional: (q: string) => `${q} picks the result, but shoppers can skip it. Make it required.`,

  /** V4 (mock / proposed): one finding per question per case. */
  answersNoRec: (q: string, k: number) =>
    onQ(q, `${k} ${plural(k, "answer has", "answers have")} no recommendation`),
  answersDeletedRec: (q: string, k: number) =>
    onQ(q, `${k} ${plural(k, "answer shows", "answers show")} a deleted recommendation`),

  /** V5 (proposed, from the B11 fix). */
  ruleNoRec: (n: number) => `Rule ${n} has no recommendation`,
  ruleDeletedRec: (n: number) => `Rule ${n} shows a deleted recommendation`,

  /** V6 (proposed). */
  ruleDeletedAnswer: (n: number | string) => `Rule ${n} uses a deleted answer, so it never runs`,
  ruleDeletedAnswerMatchesAll: (n: number | string) =>
    `Rule ${n} uses a deleted answer, so it now matches every shopper`,

  /** V7 (proposed). */
  ruleUnreachable: (n: number) => `Rule ${n} can never run: it needs a question no shopper reaches`,
  ruleExclusive: (n: number) =>
    `Rule ${n} can never run: two of its answers are never on the same path`,

  /** R3 / V9 / V8 / R4 (mock `findings()`): the rule's one never-runs reason. */
  ruleIncomplete: (n: number, why: string) => `Rule ${n} has ${why}, so it never runs`,
  ruleNeverRuns: (n: number, why: string) => `Rule ${n} never runs: ${why}`,
  ruleImpossible: (n: number, needs: number, q: string | null, canPick: number) =>
    `Rule ${n} never runs: it needs all ${needs} of its ${q ?? "question's"} answers and they can pick ${canPick}`,

  /** R1 / R2 (mock / proposed). */
  rulesOnlyNeedsRule: "Rules only needs at least one rule to show anything.",
  noRuleCanRun: "None of your rules can ever run.",
  noRuleShows: "No rule shows anything yet. Add a Show rule.",

  /** R5 (mock). */
  neverRecommended: (name: string) => `“${name}” is never recommended`,

  /** V10 (unlisted in the popover; the builder's list shows it). */
  answerLong: (q: string, answer: string) => onQ(q, `“${answer}…” is long and may wrap on small screens`),

  /** V11 (proposed): one finding per question. */
  keepsNoProducts: (q: string, answer: string) => onQ(q, `“${answer}” keeps 0 products`),
  answersKeepNoProducts: (q: string, k: number) => onQ(q, `${k} answers keep 0 products`),

  /** V12 (proposed). */
  bandGap: (q: string, from: number, to: number) =>
    onQ(q, `slider values ${from}–${to} fall in no band`),
  bandOverlap: (q: string, from: number, to: number) =>
    onQ(q, `slider bands overlap at ${from}–${to}, so the first one wins`),

  /** V13 (mock): count only unset answers, never "Keeps everything" ones. */
  keepsEverything: (q: string, k: number) =>
    onQ(q, `${k} ${plural(k, "answer keeps", "answers keep")} everything (no value chosen)`),

  /** V14 (mock wording; numbers from the report). */
  notLive: (n: number, of: number) => `${n} of ${of} products are not live, so shoppers will never see them.`,

  /** V15 (proposed). */
  weakNarrowing: (q: string, largest: number, of: number) =>
    `${q} barely narrows: its biggest answer keeps ${largest} of ${of} products`,

  /** V16 (unlisted in the popover). */
  outsideEverySet: (n: number, of: number) =>
    `${n} of ${of} products belong to no result set, so shoppers can never be shown them.`,

  /** S1: the gate's structural issues, in merchant words. */
  structure: {
    introNoOut: "The start screen doesn't lead anywhere yet.",
    orphan: (where: string) => `${where} can't be reached from the start of the quiz.`,
    deadEnd: (where: string) => `${where} doesn't lead anywhere, so shoppers who reach it get stuck.`,
    splitDeadEnd: "A split in the flow has a path that leads nowhere.",
    deadAnswerRouting: (where: string) =>
      `${where} sends answers to results pages, but none of those routes is connected. Connect each answer to its page.`,
    oldEmailStep:
      "This quiz has an old email step. Remove it in the builder and set up Email capture in Questions instead.",
    other: "Something in the quiz flow isn't connected yet.",
  },

  /** Where an S1 issue sits, when it is not a question. */
  place: {
    intro: "The start screen",
    result: "The results page",
    end: "The end screen",
    step: "A step",
    deletedQuestion: "a deleted question",
  },
} as const;

/** The gate's S1 issue in merchant words. Kinds the report maps always get
 *  plain copy; any other message is kept when it is already clean, and
 *  replaced by a generic line when it is not (D18). */
export function structureMessage(
  kind: string,
  gateMessage: string,
  where: string,
  nodeType: string | undefined,
): string {
  const s = REPORT_COPY.structure;
  switch (kind) {
    case "intro_missing_outbound":
      return s.introNoOut;
    case "orphan":
      return s.orphan(where);
    case "dead_end":
      if (nodeType === "branch") return s.splitDeadEnd;
      if (!BANNED_REPORT_WORDS.test(gateMessage) && !/outbound edge/i.test(gateMessage)) {
        return nodeType === "question" ? `${where} · ${gateMessage}` : gateMessage;
      }
      return s.deadEnd(where);
    case "dead_answer_routing":
      return s.deadAnswerRouting(where);
    case "decider_email_gate":
      return s.oldEmailStep;
    default:
      return BANNED_REPORT_WORDS.test(gateMessage) ? s.other : gateMessage;
  }
}
