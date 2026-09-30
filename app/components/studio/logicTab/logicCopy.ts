import type { LogicStyle } from "../../../lib/logicStyle";

// ════════════════════════════════════════════════════════════════════════════
// Logic step redesign (D18, owner 2026-09-22) — THE merchant-facing copy of
// the Logic step. Every surface (the funnel's Logic step, the builder's Logic
// view and Rules inspector, the check popover, the Table and the export)
// reads its names from here, so the vocabulary can never drift again.
//
// Rules for anything added here:
//   • no internal words: decider, bucket, branch, boost, weight, score,
//     "Tag buckets" never reach a merchant;
//   • no em dashes (owner, 2026-09-07);
//   • mock wording is verbatim (docs/design/logic-tab/rules-row/index.html:
//     styleName, STYLE_HINT, TAG, BTN, JOBS, VERBS, headRight, rulesBand,
//     ruleRows, vizRecs, stripMoreHTML, checkPop, delRule, moveRule).
// ════════════════════════════════════════════════════════════════════════════

/** The two logic styles by name (mock styleName). Names, not descriptions. */
export const LOGIC_STYLE_NAME: Record<LogicStyle, string> = {
  attributes: "Filter Results + Rules",
  rules: "Rules only",
};

/** The title switch and its "Logic style" menu (mock statusHead, styleMenu). */
export const LOGIC_STYLE_MENU = {
  title: "Logic style",
  titleTip: "Change how this quiz decides",
  items: [
    { style: "attributes" as const, name: LOGIC_STYLE_NAME.attributes, hint: "answers map, rules add exceptions" },
    { style: "rules" as const, name: LOGIC_STYLE_NAME.rules, hint: "every outcome is a rule you write" },
  ],
};

/** The one-line description beside the title (mock STYLE_HINT / hintHTML).
 *  `more` is the second paragraph behind "More"; null = no More control. */
export const STYLE_HINT: Record<LogicStyle, { lead: string; more: string | null }> = {
  attributes: {
    lead: "Choose the question that decides your Results category.",
    more: "Use the questions to filter them down with tags, variants, or custom groups. Make rules to prioritize specific behaviors.",
  },
  rules: {
    lead: "Every outcome is a rule you write: which products to show, based on how someone answered.",
    more: null,
  },
};

export const HINT_MORE = "More";
export const HINT_LESS = "Less";

/** Edit | Table (mock headRight .vseg2). */
export const VIEW_COPY = { group: "View", edit: "Edit", table: "Table" };

/** Import | Export (mock headRight .iox; D16-template names Export as the template too). */
export const IO_COPY = {
  import: "Import",
  export: "Export",
  importTip: "Apply changes from a spreadsheet",
  exportTip: "Download the current logic as an Excel file, the same file Import accepts",
};

// ── Question roles (stored values decides / filter / qualifier never change) ──

/** The role control on a question (mock BTN). */
export const ROLE_BUTTON = {
  decides: "Picks results",
  filter: "Narrows results",
  info: "Info only",
} as const;

/** The rail's role tag (mock TAG). */
export const ROLE_TAG = {
  decides: "Picks",
  filter: "Narrows",
  info: "Info",
} as const;

/** The role menu's two-line items (mock JOBS): name, then what it does. */
export const ROLE_MENU = [
  { k: "decides" as const, n: "Picks the result", hint: "each answer maps to a product group" },
  { k: "filter" as const, n: "Narrows", hint: "filters down the product groups" },
  { k: "info" as const, n: "Info only", hint: "collects the data only" },
];

/** The role menu's foot line (mock roleMenu .pfoot). */
export const ROLE_MENU_FOOT = "Only one question can pick the result.";

// ── Recommendations (a Category row, by its D18 name) ──

export const RECOMMENDATIONS = "Recommendations";
export const YOUR_RECOMMENDATIONS = "Your recommendations";
export const CHOOSE_A_RESULT = "Choose a result";

export const STRIP_COPY = {
  haveARule: "have a rule",
  createARule: "+ Create a rule",
  createFor: (name: string) => `Create a rule for ${name}`,
  usedBy: (name: string, rules: readonly number[]) =>
    `${name} · ${
      rules.length ? `used by rule${rules.length > 1 ? "s" : ""} ${joinNumbers(rules)}` : "no rule uses it"
    }`,
  moreLabel: (n: number) => `${n} more recommendations`,
  addRecommendations: "+ Add recommendations",
  addRecommendationsLabel: "Add recommendations",
  all: (n: number) => `All recommendations · ${n}`,
  search: "Search recommendations",
  hasARule: "has a rule",
  nothingMatches: "Nothing matches.",
};

// ── Rules ──

export const RULE_COPY = {
  createARule: "Create a rule",
  add: "+ Add",
  pasteRules: "Paste rules",
  createFirst: "Create your first rule",
  listLabel: "Rules, run top to bottom",
  columnTitle: "Rules",
  columnSub: "Exceptions that run on top of the answers.",
  rowTip: "Click to edit · drag or use ↑ ↓ to reorder",
  columnRowTip: "Click to edit · use ↑ ↓ to reorder",
  moveUp: (n: number) => `Move rule ${n} up`,
  moveDown: (n: number) => `Move rule ${n} down`,
  deleteTip: "Delete rule",
  deleteLabel: (n: number) => `Delete rule ${n}`,
  editLabel: (n: number, sentence: string) => `Edit rule ${n}: ${sentence}`,
  deleted: (n: number) => `Rule ${n} deleted`,
  deletedMany: (count: number) => `${count} rules deleted`,
  moved: (from: number, to: number) => `Rule ${from} moved to position ${to}`,
  /** A stored Hide rule in Rules only resolves to no result (D1, 2.2). */
  hidesTag: "shows nothing · this rule hides",
  missingRecommendation: "(deleted recommendation)",
};

/** Rules only, zero rules (mock rulesBand .rempty2). */
export const RULES_ONLY_EMPTY = {
  lead: "No rules yet.",
  body: "In Rules only every result comes from a rule, so nothing shows until you create one.",
};

/** The Filter rules column with zero rules (mock ruleRows .rempty). */
export function filterRulesEmpty(pickingQuestion: boolean, switchedOn: number): {
  lead: string;
  body: string;
  strong: string;
  tail: string;
} {
  return pickingQuestion
    ? {
        lead: "No rules yet.",
        body: "Your ",
        strong: String(switchedOn),
        tail: ` switched-on question${switchedOn === 1 ? " is" : "s are"} deciding everything.`,
      }
    : {
        lead: "No rules yet.",
        body: "No question picks the result yet, so nothing shows. Set one question to ",
        strong: ROLE_BUTTON.decides,
        tail: ".",
      };
}

/** Rule verbs (mock VERBS): stored action → name + the rule window's hint.
 *  D2 is OPEN for Filter Results + Rules: the Show hint there waits on the
 *  owner (read it through verbHint, never this table directly). */
export const VERBS = {
  show: { name: "Show", hint: "these become the results" },
  pin: { name: "Pin", hint: "these move to the top" },
  hide: { name: "Hide", hint: "these never show" },
} as const;

export type VerbKey = keyof typeof VERBS;

/** The one style-aware verb hint (D2): one line to change when the owner
 *  rules on the Filter half. */
export function verbHint(verb: VerbKey, _style: LogicStyle): string {
  return VERBS[verb].hint;
}

// ── Questions ──

export const QUESTION_COPY = {
  added: (n: number) => `Q${n} added`,
};

// ── The check popover (mock checkPop) ──

export const CHECK_COPY = {
  fix: (n: number) => `${n} thing${n === 1 ? "" : "s"} to fix before you continue`,
  review: (n: number) => `${n} thing${n === 1 ? "" : "s"} to review · you can still continue`,
  clean: "Nothing to fix",
  ctaBlocked: (n: number) => `Fix ${n} issue${n === 1 ? "" : "s"} to continue`,
  severity: { crit: "Must fix", warn: "Review", note: "Note" },
  label: "Checks",
};

/** "1", "1 and 3", "1, 2 and 4" (mock nlist). */
export function joinNumbers(list: readonly number[]): string {
  if (list.length <= 1) return String(list[0] ?? "");
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}
