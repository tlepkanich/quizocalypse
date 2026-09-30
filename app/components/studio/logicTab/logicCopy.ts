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
  moveUpTip: "Move up",
  moveDownTip: "Move down",
  deleted: (n: number) => `Rule ${n} deleted`,
  deletedMany: (count: number) => `${count} rules deleted`,
  /** The delete toast from the run's delete count (mock delRule, UNDO.dels). */
  deletedRun: (n: number) => (deletes: number) =>
    deletes > 1 ? `${deletes} rules deleted` : `Rule ${n} deleted`,
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

// ── The rule window (agent E; mock modalHTML, ACT.m*, D12, D13, D24) ──

export const RULE_WINDOW_COPY = {
  createLabel: "Create a rule",
  editLabel: "Edit rule",
  whatHappens: "What happens",
  whenTheyAnswer: "When they answer",
  /** D2 (Rules only): a stored Pin / Hide opens as Show and says so. */
  onlyInFilter: (verbName: string) =>
    `${verbName} only works in ${LOGIC_STYLE_NAME.attributes} · saving makes this a Show rule`,
  legacyNote: "This older rule replaces the results outright. Saving on Show keeps that behavior.",
  matchAnyNote: "This rule matches when any one of these questions matches. Saving keeps that.",
  duplicate: "Duplicate",
  duplicateTip: "Make a copy of this rule, just below it",
  deleteRule: "Delete rule",
  close: "Close",
  frac: { attributes: "are covered", rules: "have a rule" } as const,
  chipRules: (n: number) => `${n} rule${n === 1 ? "" : "s"}`,
  chipMapped: "Mapped from an answer · no rule needed",
  chipNeeds: "Needs a rule",
  rowHasRule: "has a rule",
  rowMapped: "mapped from an answer",
  rowNeeds: "needs a rule",
  pickedFoot: "picked",
  pickFoot: "Pick what this rule shows",
  done: "Done",
  deletedRecommendation: "recommendation deleted",
  deletedAnswer: "answer deleted",
  deletedQuestion: "Deleted question",
  removeDeleted: "Click to remove it from this rule",
  isTip: "Click to switch between is and is not",
  isNotTip:
    "“is not” means none of these answers: a shopper who picks any one of them doesn't match this rule. Click to switch back",
  joinTip: "Click to switch",
  fixedJoinTip: "A shopper answers this question once, so two answers here can only mean either of them",
  impossible: (max: number, picked: number) =>
    `They can pick at most ${max} here, so all ${picked} can never happen together. Pick ${max} or fewer, or switch to any of.`,
  cancel: "Cancel",
  createAnother: "Create & add another",
  saveAnother: "Save & add another",
  create: "Create rule",
  save: "Save rule",
  saving: "Saving…",
  created: "Rule created",
  saved: "Rule saved",
  addedPicked: "Added and picked for this rule",
  gone: "Undone. The rule you had open is gone, so its window closed",
  goneOnSave: "That rule was removed, so nothing was saved.",
  goneOnDelete: "That rule was already removed",
  goneOnCopy: "That rule was removed, so there was nothing to copy",
  copied: (copyN: number, origN: number) => `Rule ${copyN} is a copy of rule ${origN} · you are editing the copy`,
  offline: "Couldn't reach the server. The rule wasn't saved.",
  addFailed: "Couldn't add those recommendations. Try again.",
  peekTitle: (name: string) => `Inside ${name}`,
  peekEmpty: "No products in this group yet",
  peekMore: (n: number) => `+${n} more`,
  peekLabel: (count: string, name: string) => `${count} in ${name}`,
};

/** The question-type tag on a rule-window row (mock typeMeta). */
export const QUESTION_TYPE_TAG = {
  multi: (min: number, max: number) => `Multi-select · pick ${min === max ? min : `${min}–${max}`}`,
  scale: (n: number) => `Scale · 1–${n}`,
  five: "Five-point scale",
};

// ── Add recommendations (agent E; mock arHTML, ACT.ar*, D15) ──

export const ADD_RECS_COPY = {
  title: "Add recommendations",
  search: "Search products, collections, tags, groups",
  searchLabel: "Search the catalogue",
  kindGroup: "Kind",
  tabs: { all: "All", collection: "Collections", tag: "Tags", product: "Products", group: "Custom groups" },
  kind: { collection: "Collection", tag: "Tag", product: "Product", group: "Custom group" },
  groupsNote: "Groups you made on the Recommendations step.",
  inQuiz: "In this quiz",
  nothingMatches: (q: string) => `Nothing matches “${q}”.`,
  noCatalogue: "The catalogue isn't available here yet.",
  footEmpty: "Pick what shoppers could be shown",
  selected: "selected",
  cancel: "Cancel",
  addNone: "Add recommendations",
  add: (n: number) => `Add ${n} recommendation${n === 1 ? "" : "s"}`,
  adding: "Adding…",
  added: (n: number) =>
    `Added ${n} recommendation${n === 1 ? "" : "s"}. ${n === 1 ? "It needs" : "Each needs"} a rule`,
  offlineNone: "Couldn't reach the server. Nothing was added.",
  offlineSome: (k: number, n: number) => `Couldn't reach the server. ${k} of ${n} recommendations were added.`,
  skipped: (why: "empty" | "not_found") =>
    `1 wasn't added: ${why === "empty" ? "it has no products" : "it is no longer in the catalogue"}.`,
  skippedMany: (n: number) => `${n} weren't added: they have no products or are no longer in the catalogue.`,
};

// ── Paste rules (agent E; D13) ──

export const PASTE_COPY = {
  created: (n: number) =>
    `${n} rule${n === 1 ? "" : "s"} created. Rules run top to bottom, first match applies`,
};

// ── Table view · Export · Import (agent F; mock sheets, tableHTML,
//    headRight, applyImport, importFile, toastImp; handoff D16) ──

/** Sheet names, column headers and fixed cell words. The file and the Table
 *  read the SAME headers (the file adds the trailing do-not-edit id). */
export const SHEET_COPY = {
  rules: "Rules",
  answers: "Answers",
  recommendations: "Recommendations",
  rulesCols: ["#", "What happens", "Recommendations", "When they answer"],
  answersCols: ["Q", "Question", "Type", "Answer", "What it does", "Shows / keeps", "Then"],
  recsCols: ["Recommendation", "Products", "Shown by rules", "Status"],
  ruleIdCol: "Rule ID (don't edit)",
  answerIdCol: "Answer ID (don't edit)",
  rowActions: "Row actions",
  nothingYet: "Nothing yet",
  none: "(none)",
  notSet: "(not set)",
  noAnswers: "(no answers)",
  empty: "—",
  keepsEverything: "Keeps everything",
  hasRule: "Has a rule",
  needsRule: "Needs a rule",
  does: { decides: "Picks results", filter: "Narrows", info: "Info only" },
  then: {
    next: "Next question",
    results: "Straight to results",
    /** An unset route on the last question (mock nextText). */
    last: "Results (last question)",
    skip: (n: number) => `Skips to Q${n}`,
  },
  type: {
    single: "Single select",
    multi: (min: number, max: number) => `Multi-select · pick ${min === max ? min : `${min}–${max}`}`,
    image: "Image select",
    five: "Five-point scale",
    scale: (n: number) => `Scale · 1–${n}`,
  },
  value: {
    tag: "Tag",
    collection: "Collection",
    metafield: "Metafield",
    variant: "Variant",
    productType: "Product type",
  },
  exampleRuleId: "EXAMPLE",
  exampleRecommendation: "Your recommendation name",
  exampleAnswer: "Q1 = your answer text",
  editRule: (n: number) => `Edit rule ${n}`,
  createFor: (name: string) => `Create a rule for ${name}`,
  typeLabel: (n: number, type: string) => `Q${n} type: ${type}`,
  roleLabel: (n: number, role: string) => `Q${n} does: ${role}`,
  showsLabel: (n: number, answer: string, value: string) => `Q${n} answer ${answer} shows: ${value}`,
  thenLabel: (n: number, answer: string, where: string) => `Q${n} answer ${answer} goes to: ${where}`,
  questionLabel: (n: number) => `Q${n} question`,
  answerLabel: (n: number, i: number) => `Q${n} answer ${i}`,
  typeMenuTitle: "Question type",
  roleMenuTitle: (n: number) => `Question ${n} does`,
  routeMenuTitle: (answer: string) => `${answer} · goes to`,
  pickerTitle: CHOOSE_A_RESULT,
  valuesTitle: "Keeps products with",
  pickerDone: "Done",
  roleMoved: (to: number) => `Q${to} now picks the result`,
  roleLost: (q: number, count: number) =>
    `Q${q}'s ${count} recommendation${count === 1 ? " was" : "s were"} removed`,
  valuesLost: (q: number, count: number) => `Q${q}'s ${count} value${count === 1 ? " was" : "s were"} removed`,
  roleChanged: (q: number, role: string) => `Q${q} now: ${role}`,
  typeChanged: (q: number, type: string) => `Q${q} is now ${type}`,
  anyOfNow: (q: number) => `Rules on Q${q} now match any of their answers`,
};

/** Import | Export toasts and import notes (mock importFile / toastImp /
 *  applyImport; em dashes replaced with plain punctuation). */
export const IMPORT_COPY = {
  fileName: "quiz-logic.xlsx",
  exported: "Exported quiz-logic.xlsx",
  exportedExample: "Exported quiz-logic.xlsx with one example row",
  writerFailed: "Couldn't load the Excel writer. Check your connection and try again",
  exportFailed: "Couldn't export the file. Try again",
  readerFailed: "Couldn't load the spreadsheet reader. Check your connection and try again",
  unreadable: "Couldn't read that file",
  tooBig: "That file is too big to be a quiz logic sheet",
  invalid: "Couldn't apply that file. Nothing changed",
  nothingChanged: "Nothing changed",
  imported: (n: number) => `Imported ${n} change${n === 1 ? "" : "s"}`,
  skipped: (n: number) => `${n} skipped`,
  more: (n: number) => `+${n} more`,
  stale: "Your questions changed since this file was exported. Export again, then redo your edits.",
  noSheets: "Nothing in that file matched the Rules or Answers sheet. Import the file Export writes",
  ignoredSheet: (name: string) => `Ignored sheet “${name}”: it isn't a Rules or Answers sheet`,
  twoSheets: (kind: string) => `Two ${kind} sheets in the file, so neither was used`,
  ignoredColumn: (col: string, sheet: string) => `Ignored the “${col}” column on the ${sheet} sheet`,
  recsReadOnly: "Recommendations sheet is read-only, so edits there were ignored",
  exampleRow: "Ignored the example row",
  exampleRows: (n: number) => `Ignored ${n} example rows`,
  renumbered: "# ignored: rules keep their row order, so move rows to reorder",
  rulesBad: (first: string, more: number) =>
    `No rule changed: ${first}. Fix it and import again${more > 0 ? ` (+${more} more row${more === 1 ? "" : "s"})` : ""}`,
  rulesRemoved: (list: string) => `Removed rules that aren't in the file: ${list}`,
  ruleSplit: (row: number) =>
    `Rules row ${row}: answers from two questions joined with OR became one rule per question`,
  rulesOnlyInert:
    "This quiz decides by rules, so the roles and results on the Answers sheet were saved but don't change what shoppers see",
  noAddAnswers: (label: string) => `A row for “${label}” isn't in the quiz; import never adds answers`,
  noSuchAnswer: (q: number, text: string) => `Q${q} · “${text}”: no such answer on Q${q}; import never adds answers`,
  notInFile: (q: number, n: number) =>
    `Q${q}: ${n} answer${n === 1 ? " isn't" : "s aren't"} in the file; import never deletes answers`,
  order: "Answer order can't be changed by import",
  badAnswerId: (row: number) => `Answers row ${row}: this answer ID isn't in the quiz`,
  repeatedAnswerId: (row: number) => `Answers row ${row}: this answer ID is on two rows`,
  wrongQ: (row: number) => `Answers row ${row}: its Q doesn't match its answer`,
  disagree: (q: number, col: string) => `Q${q}: its rows don't agree on ${col}`,
  onePicker: "Only one question can pick the result",
  cantPick: (q: number) => `Q${q} can't pick the result: it has no answers to choose from`,
  badRole: (q: number, v: string) => `Q${q}: “${v}” isn't Picks results, Narrows or Info only`,
  badType: (q: number, v: string) => `Q${q}: “${v}” isn't a question type`,
  typePoints: (q: number, n: number) => `Q${q} has ${n} answers. Change its points in the app`,
  typePicks: (q: number, v: string) => `Q${q}: “${v}” asks for more picks than it has answers`,
  imageOnly: (q: number) => `Q${q}: Image select can only be kept, not chosen here`,
  emptyQuestion: (q: number) => `Q${q}: the question can't be empty`,
  longQuestion: (q: number) => `Q${q}: the question is longer than 150 characters`,
  emptyAnswer: (q: number) => `Q${q}: an answer can't be empty`,
  longAnswer: (q: number, text: string) => `Q${q} · “${text}”: an answer can't be longer than 60 characters`,
  noRecommendation: (q: number, name: string) => `Q${q}: there's no recommendation called “${name}”`,
  twoRecommendations: (q: number, name: string) => `Q${q}: two recommendations are called “${name}”`,
  notPicking: (q: number) => `Q${q} doesn't pick the result, so its Shows / keeps cells were skipped`,
  badValue: (q: number, v: string) => `Q${q}: “${v}” isn't a value you can keep`,
  infoValue: (q: number) => `Q${q} is Info only, so it doesn't show or keep anything`,
  badThen: (q: number, v: string) => `Q${q}: “${v}” isn't somewhere this answer can go`,
  forwardOnly: (text: string, q: number) => `“${text}” on Q${q}: routes only go forward`,
  /** Handoff §10: an import Undo that no longer changes anything. */
  undoStale: "Can't undo the import: the quiz changed after it",
  // Rules sheet reasons (each follows "Rules row N: ").
  rowPrefix: (row: number) => `Rules row ${row}`,
  unknownRuleId: "this rule ID isn't in the quiz. Clear it to add the row as a new rule",
  repeatedRuleId: "this rule ID is on two rows",
  badVerb: (v: string) => `“${v}” isn't Show, Pin or Hide`,
  emptyVerb: "What happens is empty. Write Show, Pin or Hide",
  rulesOnlyVerb: "this quiz decides by rules, so every rule shows its recommendations. Use Show",
  noRuleRecommendation: (name: string) => `there's no recommendation called “${name}”`,
  twoRuleRecommendations: (name: string) => `two recommendations are called “${name}”`,
  needsAnswer: "it needs at least one answer",
  needsRecommendation: "it needs at least one recommendation",
  notAnAnswer: (t: string) => `“${t}” isn't an answer in the quiz`,
  noAnswerOn: (q: number, t: string) => `Q${q} has no answer “${t}”`,
  noQuestion: (q: string) => `there's no question ${q}`,
  ambiguous: (t: string, qs: readonly number[], last: number) =>
    `“${t}” is an answer on ${qs.map((n) => `Q${n}`).join(" and ")}. Write it as Q${last} = ${t}`,
  mixed: (t: string) => `“${t}” mixes answers from more than one question`,
  twice: (q: number) => `Q${q} appears twice. Put its answers in one group`,
  mixedJoins: "use one kind of join inside brackets",
  mixedAcross: "use AND between questions",
  notAll: "an is-not line means none of these answers, so write NOT (A OR B), not NOT (A AND B)",
  singleAll: (q: number, kind: string) => `Q${q} is ${kind}, so a shopper can't pick both. Use OR`,
  overMax: (max: number, q: number, n: number) =>
    `They can pick at most ${max} on Q${q}, so all ${n} can never happen together`,
  syntax: (t: string) => `couldn't read “${t}”. Write answers as Qn = answer`,
};

/** "1", "1 and 3", "1, 2 and 4" (mock nlist). */
export function joinNumbers(list: readonly number[]): string {
  if (list.length <= 1) return String(list[0] ?? "");
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

// ── Filter Results + Rules · the question rail and pane (mock railItems,
//    pane, roleMenu, picker, vpHTML, routeMenu, typeMenu, trayMoreHTML,
//    aqHTML). Stored roles decides / filter / qualifier never change. ──

export const RAIL_COPY = {
  kicker: "Questions",
  addQuestion: "+ Add question",
  countsLabel: "Question roles",
};

export const PANE_COPY = {
  questionLabel: (n: number) => `Question ${n} text`,
  answerLabel: (key: string) => `Answer ${key} text`,
  pointLabel: (n: number) => `Point ${n} label`,
  addLabel: "Add label",
  noAnswers: "no answer options",
  noQuestions: "No questions yet.",
  chooseValue: "Choose a value",
  keepsEverything: "Keeps everything",
  stopKeeping: "Stop keeping everything",
  place: (name: string) => `Place ${name} here`,
  add: (name: string) => `Add ${name}`,
  alreadyHere: (name: string) => `${name} is already here`,
  removeTarget: (name: string) => `Remove ${name} from this answer`,
  removeValue: (label: string) => `Remove ${label} from this answer`,
  deletedTarget: "recommendation deleted",
  cellPicks: (answer: string) => `Choose a result for ${answer}`,
  cellValues: (answer: string) => `Choose values for ${answer}`,
  routeNote: "The first checked answer, in the order above, decides where the shopper goes next.",
};

/** The tray on the picking question (mock pane .tray, trayMoreHTML). */
export const TRAY_COPY = {
  label: RECOMMENDATIONS,
  empty: "No recommendations yet",
  chipTip: (name: string, n: number, placed: boolean) =>
    `${name} · ${n} product${n === 1 ? "" : "s"}${placed ? " · placed" : ""}`,
  moreLabel: (n: number) => `${n} more recommendations`,
  all: (n: number) => `All recommendations · ${n}`,
  search: "Search recommendations",
  rowNote: (n: number, placed: boolean) =>
    `${placed ? "placed · " : ""}${n} product${n === 1 ? "" : "s"}`,
  nothingMatches: "Nothing matches.",
};

/** The picks picker on a Picks cell (mock picker). */
export const PICKER_COPY = {
  title: CHOOSE_A_RESULT,
  search: "Search recommendations",
  fresh: (n: number) => `No answer shows this yet · ${n} product${n === 1 ? "" : "s"}`,
  used: (n: number) => `Already on an answer · ${n} product${n === 1 ? "" : "s"}`,
  nothingMatches: "Nothing matches.",
  empty: "No recommendations yet.",
  drill: (n: number, name: string) => `See the ${n} products in ${name}`,
  products: (n: number) => `${n} product${n === 1 ? "" : "s"}`,
  back: "‹ Back",
  addThis: "Add this",
  removeThis: "Remove this",
  showing: (shown: number, total: number) => `Showing ${shown} of ${total}`,
  all: "All",
  kinds: {
    collection: "Collections",
    product: "Products",
    tag: "Tags",
    group: "Custom groups",
  },
};

/** The value picker on a Narrows cell (mock vpHTML). */
export const VALUE_COPY = {
  title: (answer: string) => `${answer} · keeps`,
  search: "Search tags, metafields, variants…",
  searchLabel: "Search values",
  tabsLabel: "Source",
  tabs: {
    all: "All",
    tag_family: "Tags",
    metafield: "Metafields",
    variant_option: "Variants",
    product_type: "Product types",
  },
  group: {
    tag_family: "Tag",
    metafield: "Metafield",
    variant_option: "Variant",
    product_type: "Product type",
  },
  keepsEverything: "Keeps everything",
  noNarrowing: "no narrowing",
  selectAll: "Select all",
  clearAll: "Clear all",
  products: (n: number) => `${n} product${n === 1 ? "" : "s"}`,
  drill: (n: number, value: string) => `See the ${n} products matching ${value}`,
  nothingSelected: "Nothing selected",
  selected: (n: number) => `${n} selected`,
  union: (u: number, total: number) => `${u} of ${total} products`,
  none: "No catalogue values to pick from yet.",
  nothingMatches: (q: string) => `Nothing matches “${q}”.`,
  noProducts: "No products carry this value.",
  cancel: "Cancel",
  done: "Done",
  back: "‹ Back",
};

/** The route menu (mock routeMenu). */
export const ROUTE_COPY = {
  next: "Next",
  results: "Results",
  title: (answer: string) => `${answer} · goes to`,
  menuLabel: (answer: string) => `Where “${answer}” goes`,
  nextQuestion: "The next question",
  lastQuestion: "the results (this is the last question)",
  skips: (n: number) => `skips ${n} question${n === 1 ? "" : "s"}`,
  straight: "Straight to the results",
  goesTo: (answer: string, where: string) => `${answer} goes to ${where}`,
};

/** The role menu's loss lines and the D9 toast (mock roleMenu, moveRole). */
export const ROLE_LOSS_COPY = {
  moves: (k: number) => ` · moves it from Q${k} and clears Q${k}'s mapping`,
  clearsValues: (n: number) => ` · clears Q${n}'s values`,
  cannotPick: "needs answers to choose from",
  targets: (q: number, n: number) =>
    `Q${q}'s ${n} recommendation${n === 1 ? " was" : "s were"} removed`,
  values: (q: number, n: number) => `Q${q}'s ${n} value${n === 1 ? " was" : "s were"} removed`,
  pillLabel: (n: number, role: string) => `Question ${n} role: ${role}`,
  narrowApplied: (field: string, mapped: number, unmatched: number) =>
    unmatched > 0
      ? `Now narrows by ${field}. Map ${unmatched} answer${unmatched === 1 ? "" : "s"} below`
      : `Now narrows by ${field}. ${mapped} answer${mapped === 1 ? "" : "s"} mapped, check them`,
  attrChoose: "Choose attribute",
  attrChooseTip: "Choose the attribute this question narrows by",
  attrTip: (label: string) => `Narrows on ${label}. Click to change the attribute`,
};

/** The type line and the Question type popover (mock typeMeta, typeMenu). */
export const TYPE_COPY = {
  title: "Question type",
  single: "Single select",
  multi: "Multi-select",
  five: "Five-point scale",
  scale: "Scale",
  image: "Image select",
  multiLine: (min: number, max: number) =>
    `Multi-select · pick ${min === max ? min : `${min}–${max}`}`,
  scaleLine: (n: number) => `Scale · 1–${n}`,
  /** D10 is open: the tooltip only promises what happens today (answers kept). */
  tip: "Change the question type. Your answers are kept.",
  min: "Min",
  max: "Max",
  points: "Points",
  minLabel: "minimum selections",
  maxLabel: "maximum selections",
  pointsLabel: "scale points",
  lowPlaceholder: "Label for 1 (optional)",
  highPlaceholder: (n: number) => `Label for ${n} (optional)`,
  lowLabel: "Label for the low end of the scale",
  highLabel: "Label for the high end of the scale",
  note: (n: number) => `Scale runs 1 → ${n}. Labels optional.`,
  scaleCap: "Scale takes up to 10 answers",
  anyOf: (q: number) => `Rules on Q${q} now match any of their answers`,
  removePointTip: (n: number, text: string | null, mapped: boolean) =>
    `Removes point ${n}${text ? ` · “${text}”` : ""}${mapped ? " and its mapping" : ""}`,
  pointRemoved: (n: number, q: number, mapped: boolean) =>
    `Removed point ${n} from Q${q}${mapped ? " · its mapping went with it" : ""}`,
  overMax: (q: number, rules: readonly number[], max: number, needs: number) =>
    rules.length > 1
      ? `Rules ${joinNumbers(rules)} can never run now: they need more Q${q} answers than shoppers can pick`
      : `Rule ${rules[0]} can never run now: it needs all ${needs} of its Q${q} answers and shoppers can pick ${max}`,
};

/** The most answers a question can have: appendBankQuestion keeps the
 *  first 12 (questionMutations.ts), so the dialog caps there and says so. */
export const MAX_QUESTION_ANSWERS = 12;

/** Add a question (mock aqHTML; handoff "Add a question"). The type names
 *  are the Question type popover's (D18: one spelling). */
export const ADD_QUESTION_COPY = {
  title: "Add a question",
  types: [
    { type: "single_select" as const, name: TYPE_COPY.single, hint: "they pick one answer" },
    { type: "multi_select" as const, name: TYPE_COPY.multi, hint: "they pick several" },
    { type: "image_tile" as const, name: TYPE_COPY.image, hint: "answers show as image tiles" },
    { type: "rating" as const, name: TYPE_COPY.five, hint: "they rate from 1 to 5" },
  ],
  bandType: "Type",
  bandQuestion: "Question",
  bandAnswers: "Answers",
  placeholder: "Type your question",
  answerPlaceholder: "Answer text",
  hint: (filled: number) => (filled < 2 ? `${filled} of 2 needed` : `${filled} answers`),
  fiveNote: "A five-point scale generates the answers itself: 1 to 5, nothing to type.",
  imageNote: "Images attach on the question once it exists.",
  cap: (n: number) => `${n} answers is the most a question can have.`,
  addAnswer: "+ Add answer",
  grip: (n: number) => `Reorder answer ${n}. Drag it, or use the arrow keys.`,
  deleteAnswer: (n: number) => `Delete answer ${n}`,
  cancel: "Cancel",
  add: "Add question",
};

/** Answer keys A…Z, then AA, AB… (mock letterKey, B58 backstop). */
export function letterKey(index: number): string {
  let s = "";
  for (let i = index + 1; i > 0; i = Math.floor((i - 1) / 26)) {
    s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  }
  return s;
}
