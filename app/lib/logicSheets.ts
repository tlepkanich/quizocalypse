// ════════════════════════════════════════════════════════════════════════════
// Logic step redesign (D16, D16-template, D12, D13, D17) — THE sheet model.
// One pure module feeds the Table view, Export and Import (mock sheets(),
// tableHTML(), buildWorkbook(), applyImport()), so the Table and the file
// can never diverge. It never imports the spreadsheet library: it reads and
// writes a plain shape (sheets of cell rows plus workbook properties); the
// SheetJS adapter lives in LogicImportExport.tsx.
//
//   Rules sheet (both styles)        #, What happens, Recommendations,
//                                    When they answer, + Rule ID (file only)
//   Recommendations (Rules only)     Recommendation, Products, Shown by
//                                    rules, Status (read-only in the file)
//   Answers (Filter Results + Rules) Q, Question, Type, Answer, What it
//                                    does, Shows / keeps, Then, + Answer ID
//
// Import is a cell-level diff against what Export would write NOW: an
// unchanged cell is never parsed and never written, so an unchanged file is
// "Nothing changed" by construction. Apply order: Recommendations (compare
// only) → Answers (question cells, then answer cells) → Rules (all or
// nothing). One result doc, one inverse (restores only the parts the import
// touched, and only while they still hold what the import left).
// ════════════════════════════════════════════════════════════════════════════
import { Quiz } from "./quizSchema";
import type { Answer, DecisionRule, DecisionRuleCondition, QuizNode } from "./quizSchema";
import type { LogicStyle } from "./logicStyle";
import { orderedQuestions, type OrderedQuestion } from "./questionOrder";
import { answerNextNode } from "./pathAnalyzer";
import { answerTargets, ruleTargets } from "./recommendDecider";
import { describeRuleTokens, MISSING_ANSWER_TEXT, ruleWhenMachine, type RuleTokens } from "./ruleSummary";
import { ruleStatuses, type RuleStatus } from "./ruleStatus";
import { recommendationCoverage } from "./recommendationCoverage";
import {
  addAnswerTarget,
  removeAnswerTarget,
  setAnswerFilterValues,
  setAnswerRoute,
  setAnswerText,
  setQuestionText,
  setQuestionType,
  setSelectionBounds,
  changeQuestionRole,
  normalizeDecisionRule,
  splitCrossQuestionOr,
  QUESTION_TEXT_MAX,
  ANSWER_TEXT_MAX,
} from "./quizMutations";
import { uid } from "./mutations/shared";
import { IMPORT_COPY, RULE_COPY, SHEET_COPY, VERBS } from "../components/studio/logicTab/logicCopy";

type QuizDoc = Quiz;
type QuestionNode = Extract<QuizNode, { type: "question" }>;
type Role = "decides" | "filter" | "info";

// ── Inputs and the plain workbook shape ─────────────────────────────────────

/** The subset of a Category row the sheets read (BuilderCategory fits). */
export interface SheetCategory {
  id: string;
  name: string;
  productIds: readonly string[];
  quizId: string | null;
}

export interface SheetContext {
  /** The resolved SCREEN style (resolveLogicStyle): which sheets show. */
  style: LogicStyle;
  /** Every category the view knows (names for any target). */
  categories: readonly SheetCategory[];
  /** This quiz's recommendations (quizId set), in list order. */
  recommendations: readonly SheetCategory[];
  /** Collection id → title (Narrows "Collection: …" values). */
  collectionTitles?: ReadonlyMap<string, string>;
  /** ruleStatuses(doc, knownIds) when the host already has it. */
  statuses?: ReadonlyMap<string, RuleStatus>;
}

export type Cell = string | number;

export interface PlainSheet {
  name: string;
  rows: Cell[][];
  /** Column widths in characters (file only). */
  widths?: number[];
}

export interface PlainWorkbook {
  sheets: PlainSheet[];
  /** Custom document properties (the stale-file guard). */
  props?: Record<string, string>;
}

/** Custom property Export writes: the ordered question ids. */
export const QUESTION_ORDER_PROP = "WiskrQuestionOrder";

// ── Small text helpers (shared by both directions) ──────────────────────────

/** Collapse whitespace and trim (mock nrm). */
export const nrm = (v: unknown): string =>
  String(v == null ? "" : v)
    .replace(/\s+/g, " ")
    .trim();
const low = (v: unknown) => nrm(v).toLowerCase();

/** A name written into a list cell: CSV-quoted when it holds a comma or a
 *  double quote (a quote inside is doubled). Mock qName. */
export const quoteName = (n: string): string => (/[",]/.test(n) ? `"${n.replace(/"/g, '""')}"` : n);

/** Mock nameList: names joined ", ", each quoted when needed. [] → "". */
export const nameList = (names: readonly string[]): string => names.map(quoteName).join(", ");

/** The inverse of nameList (mock splitNames). */
export function splitNames(raw: string): string[] {
  const t = nrm(raw);
  const out: string[] = [];
  let i = 0;
  while (i < t.length) {
    while (t[i] === " ") i++;
    if (i >= t.length) break;
    if (t[i] === '"') {
      let s = "";
      i++;
      while (i < t.length) {
        if (t[i] === '"') {
          if (t[i + 1] === '"') {
            s += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        s += t[i++];
      }
      out.push(s.trim());
      const j = t.indexOf(",", i);
      i = j < 0 ? t.length : j + 1;
    } else {
      let j = t.indexOf(",", i);
      if (j < 0) j = t.length;
      out.push(t.slice(i, j).trim());
      i = j + 1;
    }
  }
  return out.filter(Boolean);
}

// ── Row models ──────────────────────────────────────────────────────────────

export interface SheetTarget {
  id: string;
  name: string;
  missing: boolean;
}

export interface RuleSheetRow {
  kind: "rule";
  ruleId: string;
  /** 1-based priority. */
  number: number;
  /** "Show" | "Pin" | "Hide": the style's effective verb. */
  verb: string;
  targets: SheetTarget[];
  /** The one describer's structure. */
  tokens: RuleTokens;
  /** The machine form, "Q1 = x AND (Q2 = a OR Q2 = b)". */
  when: string;
  /** The same text in parts, for the Table's bold joins (joinParts(parts)
   *  === when, pinned by a test). */
  whenParts: WhenParts;
  /** What the file writes, in file column order. */
  file: Cell[];
}

export interface WhenParts {
  across: "AND" | "OR";
  groups: Array<{
    not: boolean;
    join: "AND" | "OR";
    answers: Array<{ text: string; missing: boolean }>;
  }>;
}

/** The describer's groups in the machine form ("Qn = text"). */
export function machineWhenParts(tokens: RuleTokens, doc: QuizDoc): WhenParts {
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  return {
    across: tokens.across === "or" ? "OR" : "AND",
    groups: tokens.groups.map((g) => {
      const node = byId.get(g.questionId);
      const q = g.qIndex !== null ? `Q${g.qIndex}` : "Q?";
      return {
        not: g.not,
        join: g.join === "and" ? "AND" : "OR",
        answers: g.answers.map((a) => {
          const found =
            node && node.type === "question" ? node.data.answers.find((x) => x.id === a.answerId) : undefined;
          return { text: `${q} = ${found ? found.text : MISSING_ANSWER_TEXT}`, missing: !found };
        }),
      };
    }),
  };
}

/** WhenParts → the file's text (capitals). */
export function joinWhenParts(p: WhenParts): string {
  if (!p.groups.length) return SHEET_COPY.noAnswers;
  return p.groups
    .map((g) => {
      const ans = g.answers.map((a) => a.text);
      const body = ans.length > 1 || g.not ? `(${ans.join(` ${g.join} `)})` : ans[0]!;
      return (g.not ? "NOT " : "") + body;
    })
    .join(` ${p.across} `);
}

export type NarrowValue = { label: string; file: string };

export type ShowsCell =
  | { kind: "picks"; targets: SheetTarget[] }
  | { kind: "values"; keepsAll: boolean; values: NarrowValue[] }
  | { kind: "info" };

export interface AnswerSheetRow {
  kind: "answer";
  questionId: string;
  answerId: string;
  qIndex: number;
  /** 0-based answer position. */
  answerIndex: number;
  /** The first row of its question (question-level cells show here only). */
  first: boolean;
  question: string;
  type: string;
  answer: string;
  role: Role;
  does: string;
  shows: ShowsCell;
  /** The Table's plain text for Shows / keeps. */
  showsText: string;
  then: string;
  file: Cell[];
}

export interface RecSheetRow {
  kind: "rec";
  categoryId: string;
  name: string;
  products: number;
  shownBy: number[];
  has: boolean;
  file: Cell[];
}

export interface SheetModel<R> {
  kind: "rules" | "answers" | "recommendations";
  name: string;
  /** Table columns. */
  cols: readonly string[];
  /** File header row. */
  fileCols: readonly string[];
  /** File column widths (characters). */
  widths: number[];
  rows: R[];
}

export type RulesSheet = SheetModel<RuleSheetRow> & { kind: "rules" };
export type AnswersSheet = SheetModel<AnswerSheetRow> & { kind: "answers" };
export type RecsSheet = SheetModel<RecSheetRow> & { kind: "recommendations" };
export type AnySheet = RulesSheet | AnswersSheet | RecsSheet;

// ── Serializing ─────────────────────────────────────────────────────────────

function roleOf(node: QuestionNode): Role {
  return node.data.role === "decides" ? "decides" : node.data.role === "filter" ? "filter" : "info";
}

/** Labels for stored types outside the four picks (TypeChipSelector's). */
const OTHER_TYPE_LABEL: Record<string, string> = {
  text: "Open text",
  email: "Email input",
  searchable: "Searchable list",
  image_picker: "Image grid",
  dropdown: "Dropdown",
  swatch: "Swatch picker",
  numeric: "Number input",
  date: "Date input",
  slider: "Slider (0–100)",
};

function isFivePoint(node: QuestionNode): boolean {
  return (
    node.data.question_type === "rating" &&
    node.data.scale_config?.min === 1 &&
    node.data.scale_config?.max === 5
  );
}

function multiBounds(node: QuestionNode): { min: number; max: number } {
  const count = node.data.answers.length;
  const min = Math.max(1, Math.min(node.data.min_selections ?? 1, count));
  const max = Math.max(min, Math.min(node.data.max_selections ?? count, count));
  return { min, max };
}

/** The Type cell (mock typeMeta). */
export function questionTypeLabel(node: QuestionNode): string {
  const t = node.data.question_type;
  if (t === "single_select") return SHEET_COPY.type.single;
  if (t === "multi_select") {
    const { min, max } = multiBounds(node);
    return SHEET_COPY.type.multi(min, max);
  }
  if (t === "image_tile") return SHEET_COPY.type.image;
  if (t === "rating") {
    return isFivePoint(node) ? SHEET_COPY.type.five : SHEET_COPY.type.scale(node.data.answers.length);
  }
  return OTHER_TYPE_LABEL[t] ?? t;
}

export type Destination =
  | { kind: "next" }
  | { kind: "skip"; qIndex: number; nodeId: string }
  | { kind: "results" }
  /** An unset route on the last question (mock nextText). */
  | { kind: "last" };

/** Where an answer really goes (B64): walk past content steps to the next
 *  question or the results. An unset route on the last question reads
 *  "Results (last question)"; "Straight to results" is an explicit route. */
export function answerDestination(
  doc: QuizDoc,
  q: OrderedQuestion,
  answer: Answer,
  qIndexByNode: ReadonlyMap<string, number>,
  lastIndex: number,
): Destination {
  let nextId = answerNextNode(doc, q.node.id, answer.edge_handle_id);
  for (let hops = 0; nextId && hops < 24; hops++) {
    const cur = nextId;
    if (qIndexByNode.has(cur)) break;
    const node = doc.nodes.find((n) => n.id === cur);
    if (!node || node.type === "result" || node.type === "end") break;
    nextId = doc.edges.find((e) => e.source === cur)?.target ?? null;
  }
  const own = doc.edges.some((e) => e.source === q.node.id && e.source_handle === answer.edge_handle_id);
  const unsetLast = !own && q.qIndex >= lastIndex;
  if (!nextId) return unsetLast ? { kind: "last" } : q.qIndex >= lastIndex ? { kind: "results" } : { kind: "next" };
  const nq = qIndexByNode.get(nextId);
  if (nq === undefined) return unsetLast ? { kind: "last" } : { kind: "results" };
  if (nq === q.qIndex + 1) return { kind: "next" };
  return { kind: "skip", qIndex: nq, nodeId: nextId };
}

export function destinationText(d: Destination): string {
  return d.kind === "next"
    ? SHEET_COPY.then.next
    : d.kind === "results"
      ? SHEET_COPY.then.results
      : d.kind === "last"
        ? SHEET_COPY.then.last
        : SHEET_COPY.then.skip(d.qIndex);
}

/** A Narrows answer's values, each with its kind (D16: the file writes the
 *  kind and the stored key; the Table shows the Edit view's chip label). */
export function narrowValues(answer: Answer, collectionTitles?: ReadonlyMap<string, string>): NarrowValue[] {
  const V = SHEET_COPY.value;
  const out: NarrowValue[] = [];
  for (const t of answer.tags) {
    const ci = t.indexOf(":");
    if (ci > 0 && ci < t.length - 1) {
      out.push({ label: t.slice(ci + 1), file: `${V.tag}: ${t.slice(0, ci)} · ${t.slice(ci + 1)}` });
    } else out.push({ label: t, file: `${V.tag}: ${t}` });
  }
  const cols = [
    ...(answer.collection_filter ? [answer.collection_filter] : []),
    ...(answer.collection_filters ?? []),
  ].filter((c, i, all) => Boolean(c) && all.indexOf(c) === i);
  for (const c of cols) {
    const title = collectionTitles?.get(c) ?? c;
    out.push({ label: title, file: `${V.collection}: ${title}` });
  }
  for (const m of answer.metafield_filters ?? []) {
    out.push({ label: m.value, file: `${V.metafield}: ${m.key} · ${m.value}` });
  }
  for (const v of answer.variant_filters ?? []) {
    out.push({ label: v.value, file: `${V.variant}: ${v.name} · ${v.value}` });
  }
  for (const p of answer.product_type_filters ?? []) {
    out.push({ label: p, file: `${V.productType}: ${p}` });
  }
  return out;
}

function targetsOf(ids: readonly string[], catById: ReadonlyMap<string, SheetCategory>): SheetTarget[] {
  return ids.map((id) => {
    const c = catById.get(id);
    return { id, name: c ? c.name : RULE_COPY.missingRecommendation, missing: !c };
  });
}

interface BuildBits {
  ordered: OrderedQuestion[];
  qIndexByNode: Map<string, number>;
  catById: Map<string, SheetCategory>;
  statuses: ReadonlyMap<string, RuleStatus>;
}

function bits(doc: QuizDoc, ctx: SheetContext): BuildBits {
  const ordered = orderedQuestions(doc);
  const catById = new Map<string, SheetCategory>();
  for (const c of ctx.categories) catById.set(c.id, c);
  for (const c of ctx.recommendations) if (!catById.has(c.id)) catById.set(c.id, c);
  return {
    ordered,
    qIndexByNode: new Map(ordered.map((q) => [q.node.id, q.qIndex])),
    catById,
    statuses: ctx.statuses ?? ruleStatuses(doc, [...catById.keys()]),
  };
}

function rulesSheet(doc: QuizDoc, ctx: SheetContext, b: BuildBits): RulesSheet {
  const rows = (doc.decision_rules ?? []).map((rule, i): RuleSheetRow => {
    const tokens = describeRuleTokens(rule, doc, ctx.style);
    const verb = VERBS[tokens.verb].name;
    const targets = targetsOf(ruleTargets(rule), b.catById);
    const when = ruleWhenMachine(rule, doc);
    return {
      kind: "rule",
      ruleId: rule.id,
      number: i + 1,
      verb,
      targets,
      tokens,
      when,
      whenParts: machineWhenParts(tokens, doc),
      file: [i + 1, verb, nameList(targets.map((t) => t.name)), when, rule.id],
    };
  });
  return {
    kind: "rules",
    name: SHEET_COPY.rules,
    cols: SHEET_COPY.rulesCols,
    fileCols: [...SHEET_COPY.rulesCols, SHEET_COPY.ruleIdCol],
    widths: [5, 14, 26, 80, 18],
    rows,
  };
}

function answersSheet(doc: QuizDoc, ctx: SheetContext, b: BuildBits): AnswersSheet {
  const rows: AnswerSheetRow[] = [];
  const last = b.ordered.length;
  for (const q of b.ordered) {
    const node = q.node;
    const role = roleOf(node);
    const type = questionTypeLabel(node);
    const does = SHEET_COPY.does[role];
    node.data.answers.forEach((a, ai) => {
      let shows: ShowsCell;
      let showsText: string;
      let showsFile: string;
      if (role === "decides") {
        const targets = targetsOf(answerTargets(a), b.catById);
        shows = { kind: "picks", targets };
        showsText = targets.length ? targets.map((t) => t.name).join(", ") : SHEET_COPY.notSet;
        showsFile = nameList(targets.map((t) => t.name));
      } else if (role === "filter") {
        const values = a.no_preference ? [] : narrowValues(a, ctx.collectionTitles);
        shows = { kind: "values", keepsAll: !!a.no_preference, values };
        showsText = a.no_preference
          ? SHEET_COPY.keepsEverything
          : values.length
            ? values.map((v) => v.label).join(", ")
            : SHEET_COPY.notSet;
        showsFile = a.no_preference ? SHEET_COPY.keepsEverything : nameList(values.map((v) => v.file));
      } else {
        shows = { kind: "info" };
        showsText = SHEET_COPY.empty;
        showsFile = "";
      }
      const then = destinationText(answerDestination(doc, q, a, b.qIndexByNode, last));
      rows.push({
        kind: "answer",
        questionId: node.id,
        answerId: a.id,
        qIndex: q.qIndex,
        answerIndex: ai,
        first: ai === 0,
        question: node.data.text,
        type,
        answer: a.text,
        role,
        does,
        shows,
        showsText,
        then,
        file: [`Q${q.qIndex}`, node.data.text, type, a.text, does, showsFile, then, a.id],
      });
    });
  }
  return {
    kind: "answers",
    name: SHEET_COPY.answers,
    cols: SHEET_COPY.answersCols,
    fileCols: [...SHEET_COPY.answersCols, SHEET_COPY.answerIdCol],
    widths: [5, 52, 22, 36, 14, 34, 20, 18],
    rows,
  };
}

function recsSheet(doc: QuizDoc, ctx: SheetContext, b: BuildBits): RecsSheet {
  const cov = recommendationCoverage(
    doc,
    "rules",
    ctx.recommendations.map((r) => r.id),
    b.statuses,
  );
  const rows = ctx.recommendations.map((r): RecSheetRow => {
    const shownBy = cov.get(r.id)?.rulesShowing ?? [];
    const has = shownBy.length > 0;
    return {
      kind: "rec",
      categoryId: r.id,
      name: r.name,
      products: r.productIds.length,
      shownBy,
      has,
      file: [
        r.name,
        r.productIds.length,
        shownBy.length ? shownBy.join(", ") : SHEET_COPY.empty,
        has ? SHEET_COPY.hasRule : SHEET_COPY.needsRule,
      ],
    };
  });
  return {
    kind: "recommendations",
    name: SHEET_COPY.recommendations,
    cols: SHEET_COPY.recsCols,
    fileCols: SHEET_COPY.recsCols,
    widths: [24, 10, 16, 14],
    rows,
  };
}

/** The sheets for `ctx.style`, rules first (mock sheets()): Rules only →
 *  [Rules, Recommendations]; Filter Results + Rules → [Rules, Answers]. */
export function logicSheets(doc: QuizDoc, ctx: SheetContext): AnySheet[] {
  const b = bits(doc, ctx);
  const rules = rulesSheet(doc, ctx, b);
  return ctx.style === "rules" ? [rules, recsSheet(doc, ctx, b)] : [rules, answersSheet(doc, ctx, b)];
}

/** D16-template: the example row on a quiz with no rules, drawn from this
 *  quiz's own vocabulary so it resolves if the merchant keeps it. */
export function exampleRuleRow(doc: QuizDoc, ctx: SheetContext): Cell[] {
  const first = orderedQuestions(doc).find((q) => q.node.data.answers.length > 0);
  const rec = ctx.recommendations[0];
  return [
    1,
    VERBS.show.name,
    rec ? nameList([rec.name]) : SHEET_COPY.exampleRecommendation,
    first ? `Q${first.qIndex} = ${first.node.data.answers[0]!.text}` : SHEET_COPY.exampleAnswer,
    SHEET_COPY.exampleRuleId,
  ];
}

/** Export: the workbook in the plain shape (one sheet per Table sheet, same
 *  order and rows, trailing id columns, the example row on an empty Rules
 *  sheet, the question-order property). `example` = the row was added. */
export function exportWorkbook(
  doc: QuizDoc,
  ctx: SheetContext,
): { workbook: PlainWorkbook; example: boolean } {
  let example = false;
  const sheets = logicSheets(doc, ctx).map((sh): PlainSheet => {
    const rows: Cell[][] = (sh.rows as Array<{ file: Cell[] }>).map((r) => r.file);
    if (sh.kind === "rules" && rows.length === 0) {
      rows.push(exampleRuleRow(doc, ctx));
      example = true;
    }
    return { name: sh.name, rows: [[...sh.fileCols], ...rows], widths: sh.widths };
  });
  return {
    workbook: {
      sheets,
      props: {
        [QUESTION_ORDER_PROP]: orderedQuestions(doc)
          .map((q) => q.node.id)
          .join(","),
      },
    },
    example,
  };
}

// ── Decoding (B26) ──────────────────────────────────────────────────────────

/** xlsx ("PK"), xls (D0 CF) and UTF-16 (a byte-order mark) go to the
 *  library as binary; everything else is text. */
export function isBinarySpreadsheet(u8: Uint8Array): boolean {
  const a = u8[0];
  const b = u8[1];
  return (
    (a === 0x50 && b === 0x4b) ||
    (a === 0xd0 && b === 0xcf) ||
    (a === 0xff && b === 0xfe) ||
    (a === 0xfe && b === 0xff)
  );
}

/** A CSV's text: UTF-8 (a UTF-8 byte-order mark is dropped), Windows-1252
 *  only when the bytes are not valid UTF-8. */
export function decodeSpreadsheetText(u8: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(u8);
  } catch {
    return new TextDecoder("windows-1252").decode(u8);
  }
}

// ── Import ──────────────────────────────────────────────────────────────────

export interface ImportResult {
  doc: QuizDoc;
  changes: number;
  skipped: number;
  notes: string[];
  /** Maps the LATEST doc to it with this import's parts restored; null when
   *  nothing changed. */
  inverse: ((doc: QuizDoc) => QuizDoc) | null;
  /** Set when nothing may be applied (stale file, invalid result). */
  error?: string;
}

type SheetKind = "rules" | "answers" | "recs";

interface BodyRow {
  cells: readonly unknown[];
  /** Spreadsheet row number (the header is row 1). */
  row: number;
}

interface ReadSheet {
  name: string;
  kind: SheetKind | null;
  col: Map<string, number>;
  head: string[];
  body: BodyRow[];
}

const RULE_ID_KEY = "rule id";
const ANSWER_ID_KEY = "answer id";

function headKey(h: unknown): string {
  const k = low(h);
  if (k.startsWith(RULE_ID_KEY)) return RULE_ID_KEY;
  if (k.startsWith(ANSWER_ID_KEY)) return ANSWER_ID_KEY;
  return k;
}

const KNOWN_COLS: Record<SheetKind, readonly string[]> = {
  rules: [...SHEET_COPY.rulesCols.map(low), RULE_ID_KEY],
  answers: [...SHEET_COPY.answersCols.map(low), ANSWER_ID_KEY],
  recs: SHEET_COPY.recsCols.map(low),
};

function readSheet(sheet: PlainSheet): ReadSheet {
  const rows = sheet.rows;
  const head = (rows[0] ?? []).map(headKey);
  const col = new Map<string, number>();
  head.forEach((h, i) => {
    if (h && !col.has(h)) col.set(h, i);
  });
  const has = (k: string) => col.has(k);
  const kind: SheetKind | null =
    has("when they answer") || (has("what happens") && has("recommendations"))
      ? "rules"
      : has("answer") && (has("q") || has(ANSWER_ID_KEY) || has("shows / keeps"))
        ? "answers"
        : has("recommendation") && (has("status") || has("shown by rules"))
          ? "recs"
          : null;
  const body = rows
    .slice(1)
    .map((cells, i): BodyRow => ({ cells, row: i + 2 }))
    .filter((r) => r.cells.some((c) => nrm(c) !== ""));
  return { name: sheet.name, kind, col, head, body };
}

const cellOf = (s: ReadSheet, r: BodyRow, key: string): string | undefined => {
  const i = s.col.get(key);
  return i === undefined ? undefined : nrm(r.cells[i]);
};

/** Cell compare: case-insensitive, except text columns (exact). */
const sameCell = (fileCell: string, exported: Cell, exact = false) =>
  exact ? fileCell === nrm(exported) : low(fileCell) === low(exported);

function sortedJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : v,
  );
}

// ── Name resolution (recommendations) ───────────────────────────────────────

type NameHit = { id: string } | { err: "none" | "two" };

/** Names resolve exactly (any case) against this quiz's recommendations
 *  first, then any other category the surface loaded. A name two rows share
 *  is refused, never guessed. */
function nameResolver(ctx: SheetContext): (name: string) => NameHit {
  const recIds = new Set(ctx.recommendations.map((r) => r.id));
  const tiers = [ctx.recommendations, ctx.categories.filter((c) => !recIds.has(c.id))];
  return (name) => {
    const want = low(name);
    for (const tier of tiers) {
      const hits = [...new Set(tier.filter((c) => low(c.name) === want).map((c) => c.id))];
      if (hits.length === 1) return { id: hits[0]! };
      if (hits.length > 1) return { err: "two" };
    }
    return { err: "none" };
  };
}

// ── The "When they answer" grammar (D12, D13, D16, D17) ─────────────────────

interface ParsedWhen {
  conditions: DecisionRuleCondition[];
  anyOf: string[];
  /** true = groups joined with OR (a stored match "any"). */
  acrossOr: boolean;
}

interface WhenCtx {
  /** Base numbering: qIndex → question. */
  byIndex: ReadonlyMap<number, QuestionNode>;
  qIndexOf: ReadonlyMap<string, number>;
  /** Every text an answer can be matched by (now, and before the import),
   *  longest first. */
  texts: ReadonlyMap<string, Array<{ answerId: string; text: string }>>;
}

class WhenError extends Error {}

function whenContext(base: QuizDoc, mid: QuizDoc): WhenCtx {
  const ordered = orderedQuestions(base);
  const byIndex = new Map<number, QuestionNode>();
  const qIndexOf = new Map<string, number>();
  const texts = new Map<string, Array<{ answerId: string; text: string }>>();
  const midNodes = new Map(mid.nodes.map((n) => [n.id, n]));
  for (const q of ordered) {
    const m = midNodes.get(q.node.id);
    const node = m && m.type === "question" ? m : q.node;
    byIndex.set(q.qIndex, node);
    qIndexOf.set(q.node.id, q.qIndex);
    const list: Array<{ answerId: string; text: string }> = node.data.answers.map((a) => ({
      answerId: a.id,
      text: a.text,
    }));
    for (const a of q.node.data.answers) {
      if (!list.some((x) => x.answerId === a.id && low(x.text) === low(a.text))) {
        list.push({ answerId: a.id, text: a.text });
      }
    }
    list.sort((x, y) => y.text.length - x.text.length);
    texts.set(q.node.id, list);
  }
  return { byIndex, qIndexOf, texts };
}

/** Whether position `i` of `s` ends an atom: the end, ")", or a join. */
function atomEnds(s: string, i: number): boolean {
  const rest = s.slice(i);
  return rest === "" || /^\s*\)/.test(rest) || /^\s+(and|or)\s/i.test(rest) || /^\s*$/.test(rest);
}

function parseWhenCell(raw: string, wc: WhenCtx): ParsedWhen {
  const s = nrm(raw);
  if (!s || low(s) === low(SHEET_COPY.noAnswers)) return { conditions: [], anyOf: [], acrossOr: false };
  let i = 0;
  const skipWs = () => {
    while (i < s.length && s[i] === " ") i++;
  };
  const wordAt = (w: string): number => {
    const m = s.slice(i).match(new RegExp(`^${w}\\s`, "i"));
    return m ? m[0].length : 0;
  };
  const snippet = (): string => {
    const rest = s.slice(i);
    const m = rest.match(/^(.*?)(\s+(and|or)\s|\)|$)/i);
    return nrm(m ? m[1] : rest);
  };

  type Atom = { questionId: string; answerId: string };
  const readAtom = (): Atom => {
    skipWs();
    const qm = s.slice(i).match(/^q(\d+)\s*=\s*/i);
    if (qm) {
      const n = Number(qm[1]);
      const node = wc.byIndex.get(n);
      i += qm[0].length;
      if (!node) throw new WhenError(IMPORT_COPY.noQuestion(`Q${n}`));
      for (const cand of wc.texts.get(node.id) ?? []) {
        const seg = s.slice(i, i + cand.text.length);
        if (low(seg) === low(cand.text) && atomEnds(s, i + cand.text.length)) {
          i += cand.text.length;
          return { questionId: node.id, answerId: cand.answerId };
        }
      }
      throw new WhenError(IMPORT_COPY.noAnswerOn(n, snippet()));
    }
    // Bare text: resolves only when exactly one question has that answer.
    const hits: Array<{ node: QuestionNode; answerId: string; len: number }> = [];
    for (const node of wc.byIndex.values()) {
      for (const cand of wc.texts.get(node.id) ?? []) {
        const seg = s.slice(i, i + cand.text.length);
        if (low(seg) === low(cand.text) && atomEnds(s, i + cand.text.length)) {
          hits.push({ node, answerId: cand.answerId, len: cand.text.length });
          break;
        }
      }
    }
    if (hits.length === 0) throw new WhenError(IMPORT_COPY.notAnAnswer(snippet()));
    const longest = Math.max(...hits.map((h) => h.len));
    const best = hits.filter((h) => h.len === longest);
    const text = s.slice(i, i + longest);
    if (best.length > 1) {
      const nums = best.map((h) => wc.qIndexOf.get(h.node.id) ?? 0).sort((a, b) => a - b);
      throw new WhenError(IMPORT_COPY.ambiguous(text, nums, nums[nums.length - 1]!));
    }
    i += longest;
    return { questionId: best[0]!.node.id, answerId: best[0]!.answerId };
  };

  const readJoin = (): "and" | "or" | null => {
    const save = i;
    skipWs();
    const a = wordAt("and");
    if (a) {
      i += a;
      return "and";
    }
    const o = wordAt("or");
    if (o) {
      i += o;
      return "or";
    }
    i = save;
    return null;
  };

  type Group = { not: boolean; join: "and" | "or" | null; atoms: Atom[]; text: string };
  const readGroup = (): Group => {
    skipWs();
    const start = i;
    let not = false;
    const n = wordAt("not");
    if (n) {
      not = true;
      i += n;
      skipWs();
    }
    if (s[i] === "(") {
      i++;
      const atoms = [readAtom()];
      let join: "and" | "or" | null = null;
      for (;;) {
        skipWs();
        if (s[i] === ")") {
          i++;
          break;
        }
        const j = readJoin();
        if (!j) throw new WhenError(IMPORT_COPY.syntax(s.slice(start)));
        if (join && j !== join) throw new WhenError(IMPORT_COPY.mixedJoins);
        join = j;
        atoms.push(readAtom());
      }
      return { not, join, atoms, text: s.slice(start, i) };
    }
    return { not, join: null, atoms: [readAtom()], text: s.slice(start, i) };
  };

  const groups: Group[] = [readGroup()];
  let across: "and" | "or" | null = null;
  for (;;) {
    skipWs();
    if (i >= s.length) break;
    const j = readJoin();
    if (!j) throw new WhenError(IMPORT_COPY.syntax(s.slice(i)));
    if (across && j !== across) throw new WhenError(IMPORT_COPY.mixedAcross);
    across = j;
    groups.push(readGroup());
  }

  // "Q1 = A OR Q1 = B" with no brackets is one any-of group.
  if (across === "or" && groups.length > 1 && groups.every((g) => !g.not && g.atoms.length === 1)) {
    const q0 = groups[0]!.atoms[0]!.questionId;
    if (groups.every((g) => g.atoms[0]!.questionId === q0)) {
      const merged: Group = { not: false, join: "or", atoms: groups.map((g) => g.atoms[0]!), text: s };
      groups.splice(0, groups.length, merged);
      across = null;
    }
  }

  const conditions: DecisionRuleCondition[] = [];
  const anyOf: string[] = [];
  const seenQ = new Set<string>();
  for (const g of groups) {
    const qid = g.atoms[0]!.questionId;
    if (g.atoms.some((a) => a.questionId !== qid)) throw new WhenError(IMPORT_COPY.mixed(nrm(g.text)));
    const qn = wc.qIndexOf.get(qid) ?? 0;
    if (seenQ.has(qid)) throw new WhenError(IMPORT_COPY.twice(qn));
    seenQ.add(qid);
    const node = wc.byIndex.get(qn)!;
    const ids = [...new Set(g.atoms.map((a) => a.answerId))];
    if (g.not && g.join === "and" && ids.length > 1) throw new WhenError(IMPORT_COPY.notAll);
    if (!g.not && g.join === "and" && ids.length > 1) {
      if (node.data.question_type !== "multi_select") {
        throw new WhenError(IMPORT_COPY.singleAll(qn, questionTypeLabel(node).toLowerCase()));
      }
      const { max } = multiBounds(node);
      if (ids.length > max) throw new WhenError(IMPORT_COPY.overMax(max, qn, ids.length));
    }
    if (!g.not && g.join !== "and" && ids.length > 1) anyOf.push(qid);
    for (const aid of ids) conditions.push({ question_id: qid, answer_id: aid, op: g.not ? "is_not" : "is" });
  }
  return { conditions, anyOf, acrossOr: across === "or" && groups.length > 1 };
}

// ── Narrows values ──────────────────────────────────────────────────────────

type ValueSet = {
  tags: string[];
  collection_filters: string[];
  metafield_filters: Array<{ key: string; value: string }>;
  variant_filters: Array<{ name: string; value: string }>;
  product_type_filters: string[];
};

function splitPair(x: string): [string, string] | null {
  const k = x.indexOf(" · ");
  return k > 0 ? [x.slice(0, k).trim(), x.slice(k + 3).trim()] : null;
}

function parseNarrowValue(
  raw: string,
  titles: ReadonlyMap<string, string> | undefined,
  known: readonly Answer[],
): ((v: ValueSet) => void) | null {
  const t = nrm(raw);
  const m = t.match(/^([^:]+):\s*(.+)$/);
  if (m) {
    const kind = low(m[1]);
    const rest = m[2]!.trim();
    const V = SHEET_COPY.value;
    if (kind === low(V.tag)) {
      const p = splitPair(rest);
      const tag = p ? `${p[0]}:${p[1]}` : rest;
      return (v) => v.tags.push(tag);
    }
    if (kind === low(V.collection)) {
      const byTitle = [...(titles ?? new Map<string, string>())].filter(([, title]) => low(title) === low(rest));
      if (byTitle.length === 1) return (v) => v.collection_filters.push(byTitle[0]![0]);
      if (byTitle.length > 1) return null;
      const stored = known.flatMap((a) => [
        ...(a.collection_filter ? [a.collection_filter] : []),
        ...(a.collection_filters ?? []),
      ]);
      return stored.includes(rest) ? (v) => v.collection_filters.push(rest) : null;
    }
    if (kind === low(V.metafield)) {
      const p = splitPair(rest);
      return p ? (v) => v.metafield_filters.push({ key: p[0], value: p[1] }) : null;
    }
    if (kind === low(V.variant)) {
      const p = splitPair(rest);
      return p ? (v) => v.variant_filters.push({ name: p[0], value: p[1] }) : null;
    }
    if (kind === low(V.productType)) return (v) => v.product_type_filters.push(rest);
  }
  // A bare value resolves only when exactly one stored value on this
  // question carries that label.
  const matches = new Set<string>();
  for (const a of known) {
    for (const nv of narrowValues(a, titles)) if (low(nv.label) === low(t)) matches.add(nv.file);
  }
  if (matches.size === 1) return parseNarrowValue([...matches][0]!, titles, []);
  return null;
}

// ── Rule canonical form + diff count (mock canonRule / ruleDiff, B25) ──────

function canonRule(r: DecisionRule, doc: QuizDoc): string {
  const n = normalizeDecisionRule(r, doc);
  return JSON.stringify([
    n.conditions,
    [...(n.any_of ?? [])].sort(),
    n.match ?? "all",
    n.action ?? null,
    ruleTargets(n),
  ]);
}

/** max(old, new) minus the longest run kept in order: an insert, a delete,
 *  an edit or a move each count once. */
export function ruleDiff(a: readonly DecisionRule[], b: readonly DecisionRule[], doc: QuizDoc): number {
  const ka = a.map((r) => canonRule(r, doc));
  const kb = b.map((r) => canonRule(r, doc));
  const L: number[][] = Array.from({ length: ka.length + 1 }, () => new Array<number>(kb.length + 1).fill(0));
  for (let i = ka.length - 1; i >= 0; i--) {
    for (let j = kb.length - 1; j >= 0; j--) {
      L[i]![j] = ka[i] === kb[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
    }
  }
  return Math.max(ka.length, kb.length) - L[0]![0]!;
}

// ── Question-level writes the import (and the Table) compose ────────────────

function patchQuestion(
  doc: QuizDoc,
  nodeId: string,
  fn: (d: QuestionNode["data"]) => QuestionNode["data"],
): QuizDoc {
  const node = doc.nodes.find((n) => n.id === nodeId);
  if (!node || node.type !== "question") return doc;
  const data = fn(node.data);
  if (data === node.data) return doc;
  return { ...doc, nodes: doc.nodes.map((n) => (n.id === nodeId && n.type === "question" ? { ...n, data } : n)) };
}

export type ParsedType =
  | { type: "single_select" }
  | { type: "image_tile" }
  | { type: "rating"; five: boolean; n: number }
  | { type: "multi_select"; min: number; max: number };

/** Accepted Type words (only what the Question type popover offers; a
 *  hyphen reads as the en dash). */
export function parseTypeCell(raw: string): ParsedType | null {
  const s = low(raw)
    .replace(/(\d)\s*[-–]\s*(\d)/g, "$1–$2")
    .replace(/\s*·\s*/g, " · ");
  if (s === low(SHEET_COPY.type.single)) return { type: "single_select" };
  if (s === low(SHEET_COPY.type.image)) return { type: "image_tile" };
  if (s === low(SHEET_COPY.type.five)) return { type: "rating", five: true, n: 5 };
  const sc = s.match(/^scale · 1–(\d+)$/);
  if (sc) return { type: "rating", five: false, n: Number(sc[1]) };
  const mu = s.match(/^multi-select · pick (\d+)(?:–(\d+))?$/);
  if (mu) return { type: "multi_select", min: Number(mu[1]), max: Number(mu[2] ?? mu[1]) };
  return null;
}

/** Converts a question's all-of rule groups to any-of (leaving
 *  multi-select). Returns the doc and how many rules changed. */
function convertAllOf(doc: QuizDoc, nodeId: string): { doc: QuizDoc; count: number } {
  const rules = doc.decision_rules ?? [];
  let count = 0;
  const next = rules.map((r) => {
    const isCount = r.conditions.filter((c) => c.question_id === nodeId && c.op === "is").length;
    if (isCount < 2 || r.any_of?.includes(nodeId)) return r;
    count++;
    return { ...r, any_of: [...(r.any_of ?? []), nodeId] };
  });
  return count ? { doc: { ...doc, decision_rules: next }, count } : { doc, count: 0 };
}

/** The Type write (TypeChipSelector semantics, D10 left open: answers are
 *  kept; Five-point stamps the 1 to 5 preset; leaving multi-select clears
 *  the limits and converts all-of rules to any-of). Only what changes is
 *  written. */
export function applyQuestionType(
  doc: QuizDoc,
  nodeId: string,
  p: ParsedType,
): { doc: QuizDoc; converted: number } {
  // Decider docs only: the Logic step's Table and Import are the callers,
  // and a legacy doc must never be rewritten through them.
  if (doc.logic_model !== "decider") return { doc, converted: 0 };
  const node = doc.nodes.find((n) => n.id === nodeId);
  if (!node || node.type !== "question") return { doc, converted: 0 };
  let next = doc;
  const was = node.data.question_type;
  if (was !== p.type) next = setQuestionType(next, nodeId, p.type);
  if (p.type === "multi_select") {
    const cur = next.nodes.find((n) => n.id === nodeId) as QuestionNode;
    const bnd = multiBounds(cur);
    if (bnd.min !== p.min || bnd.max !== p.max) next = setSelectionBounds(next, nodeId, p.min, p.max);
    return { doc: next, converted: 0 };
  }
  next = patchQuestion(next, nodeId, (d) => {
    let data = d;
    if (data.min_selections !== undefined || data.max_selections !== undefined) {
      const { min_selections: _a, max_selections: _b, ...rest } = data;
      data = rest;
    }
    if (p.type === "rating") {
      const cfg = { ...(data.scale_config ?? {}) };
      if (p.five) {
        if (cfg.min !== 1 || cfg.max !== 5) data = { ...data, scale_config: { ...cfg, min: 1, max: 5 } };
      } else if (cfg.min !== undefined || cfg.max !== undefined) {
        const { min: _mn, max: _mx, ...restCfg } = cfg;
        const { scale_config: _sc, ...rest } = data;
        data = Object.keys(restCfg).length ? { ...rest, scale_config: restCfg } : rest;
      }
    }
    return data;
  });
  if (was === "multi_select") {
    const c = convertAllOf(next, nodeId);
    return { doc: c.doc, converted: c.count };
  }
  return { doc: next, converted: 0 };
}

/** The ordered target list of one answer, written through the public add /
 *  remove mutations (never setAnswerTarget, which replaces the list). */
export function writeAnswerTargetList(
  doc: QuizDoc,
  nodeId: string,
  answerId: string,
  ids: readonly string[],
): QuizDoc {
  const node = doc.nodes.find((n) => n.id === nodeId);
  const a = node && node.type === "question" ? node.data.answers.find((x) => x.id === answerId) : undefined;
  if (!a) return doc;
  let next = doc;
  for (const t of answerTargets(a)) next = removeAnswerTarget(next, nodeId, answerId, t);
  for (const t of ids) next = addAnswerTarget(next, nodeId, answerId, t);
  return next;
}

// ── The inverse (D7): parts restored only while they hold what we left ──────

function outgoing(doc: QuizDoc, nodeId: string) {
  return doc.edges.filter((e) => e.source === nodeId);
}

/** Undo for an import (and the Table's announced writes): the questions, their outgoing edges and the rules it
 *  changed, each written back only while it still holds what the import
 *  left there, so an edit made after the import survives. A question
 *  deleted since is skipped (no dangling reference comes back). */
export function logicPartsInverse(before: QuizDoc, after: QuizDoc): ((doc: QuizDoc) => QuizDoc) | null {
  const qBefore = new Map<string, QuestionNode["data"]>();
  const qAfter = new Map<string, string>();
  const eBefore = new Map<string, QuizDoc["edges"]>();
  const eAfter = new Map<string, string>();
  for (const n of before.nodes) {
    if (n.type !== "question") continue;
    const an = after.nodes.find((x) => x.id === n.id);
    if (!an || an.type !== "question") continue;
    if (sortedJson(an.data) !== sortedJson(n.data)) {
      qBefore.set(n.id, n.data);
      qAfter.set(n.id, sortedJson(an.data));
    }
    const ae = sortedJson(outgoing(after, n.id));
    if (sortedJson(outgoing(before, n.id)) !== ae) {
      eBefore.set(n.id, outgoing(before, n.id));
      eAfter.set(n.id, ae);
    }
  }
  const beforeRules = before.decision_rules ?? [];
  const afterRules = after.decision_rules ?? [];
  const rulesChanged = sortedJson(beforeRules) !== sortedJson(afterRules);
  if (!qBefore.size && !eBefore.size && !rulesChanged) return null;
  const beforeEdgeOrder = new Map(before.edges.map((e, i) => [e.id, i]));

  return (latest: QuizDoc) => {
    let doc = latest;
    for (const [id, data] of qBefore) {
      const n = doc.nodes.find((x) => x.id === id);
      if (!n || n.type !== "question" || sortedJson(n.data) !== qAfter.get(id)) continue;
      doc = { ...doc, nodes: doc.nodes.map((x) => (x.id === id && x.type === "question" ? { ...x, data } : x)) };
    }
    for (const [id, edges] of eBefore) {
      if (!doc.nodes.some((x) => x.id === id)) continue;
      if (sortedJson(outgoing(doc, id)) !== eAfter.get(id)) continue;
      const cur = doc;
      const restore = edges.filter((e) => cur.nodes.some((x) => x.id === e.target));
      const merged = [...cur.edges.filter((e) => e.source !== id), ...restore];
      // Keep the pre-import edge order (edges added since stay last).
      const at = (eid: string) => {
        const k = beforeEdgeOrder.get(eid);
        return k === undefined ? Number.MAX_SAFE_INTEGER : k;
      };
      doc = {
        ...doc,
        edges: merged
          .map((e, k) => ({ e, k }))
          .sort((x, y) => at(x.e.id) - at(y.e.id) || x.k - y.k)
          .map((x) => x.e),
      };
    }
    if (rulesChanged) {
      const cur = doc.decision_rules ?? [];
      if (sortedJson(cur) === sortedJson(afterRules)) {
        doc = { ...doc, decision_rules: beforeRules };
      } else {
        // By id: drop rules the import added (as it left them), put patched
        // rules back, re-insert removed ones near their old place.
        const beforeById = new Map(beforeRules.map((r) => [r.id, r]));
        const afterById = new Map(afterRules.map((r) => [r.id, r]));
        let list = cur.filter((r) => {
          const a = afterById.get(r.id);
          return !(a && !beforeById.has(r.id) && sortedJson(a) === sortedJson(r));
        });
        list = list.map((r) => {
          const bRule = beforeById.get(r.id);
          const a = afterById.get(r.id);
          return bRule && a && sortedJson(a) === sortedJson(r) ? bRule : r;
        });
        const present = new Set(list.map((r) => r.id));
        beforeRules.forEach((r, i) => {
          if (!present.has(r.id) && !afterById.has(r.id)) list.splice(Math.min(i, list.length), 0, r);
        });
        doc = { ...doc, decision_rules: list };
      }
    }
    return doc;
  };
}

// ── The import ──────────────────────────────────────────────────────────────

interface ImportState {
  doc: QuizDoc;
  changes: number;
  skipped: number;
  notes: string[];
  /** A role or Shows / keeps cell was applied (inert in Rules only). */
  inertAnswers: boolean;
}

const addNote = (st: ImportState, m: string) => {
  if (m && !st.notes.includes(m)) st.notes.push(m);
};

/** Apply a workbook against `base` (the LATEST doc at the moment of
 *  applying). Pure. Import writes question nodes, their edges and
 *  decision_rules only; never logic_style, build_session or design. */
export function applyLogicImport(base: QuizDoc, wb: PlainWorkbook, ctx: SheetContext): ImportResult {
  const nothing = (notes: string[], error?: string): ImportResult => ({
    doc: base,
    changes: 0,
    skipped: 0,
    notes,
    inverse: null,
    ...(error ? { error } : {}),
  });
  if (base.logic_model !== "decider") return nothing([IMPORT_COPY.noSheets]);

  // Stale-file guard: the question order the file was exported from.
  const order = wb.props?.[QUESTION_ORDER_PROP];
  if (order) {
    const now = orderedQuestions(base)
      .map((q) => q.node.id)
      .join(",");
    if (order !== now) return nothing([], IMPORT_COPY.stale);
  }

  const st: ImportState = { doc: base, changes: 0, skipped: 0, notes: [], inertAnswers: false };
  const read = wb.sheets.map(readSheet);
  const byKind = new Map<SheetKind, ReadSheet[]>();
  for (const s of read) {
    if (!s.kind) {
      if (s.body.length || s.head.some(Boolean)) addNote(st, IMPORT_COPY.ignoredSheet(s.name));
      continue;
    }
    byKind.set(s.kind, [...(byKind.get(s.kind) ?? []), s]);
  }
  if (!byKind.get("rules")?.length && !byKind.get("answers")?.length) {
    return nothing([IMPORT_COPY.noSheets]);
  }
  const one = (k: SheetKind, label: string): ReadSheet | null => {
    const list = byKind.get(k) ?? [];
    if (list.length > 1) {
      addNote(st, IMPORT_COPY.twoSheets(label));
      return null;
    }
    return list[0] ?? null;
  };
  const recs = one("recs", SHEET_COPY.recommendations);
  const answers = one("answers", SHEET_COPY.answers);
  const rules = one("rules", SHEET_COPY.rules);
  for (const s of [recs, answers, rules]) {
    if (!s?.kind) continue;
    const known = KNOWN_COLS[s.kind];
    s.head.forEach((h) => {
      if (h && !known.includes(h)) addNote(st, IMPORT_COPY.ignoredColumn(h, s.name));
    });
  }

  const baseBits = bits(base, ctx);
  if (recs) importRecommendations(recs, base, ctx, baseBits, st);
  if (answers) importAnswers(answers, base, ctx, baseBits, st);
  if (rules) importRules(rules, base, ctx, baseBits, st);
  if (st.inertAnswers && ctx.style === "rules") addNote(st, IMPORT_COPY.rulesOnlyInert);

  if (st.doc === base || sortedJson(st.doc) === sortedJson(base)) {
    return { doc: base, changes: 0, skipped: st.skipped, notes: st.notes, inverse: null };
  }
  if (!Quiz.safeParse(st.doc).success) return nothing([], IMPORT_COPY.invalid);
  return {
    doc: st.doc,
    changes: Math.max(1, st.changes),
    skipped: st.skipped,
    notes: st.notes,
    inverse: logicPartsInverse(base, st.doc),
  };
}

function importRecommendations(s: ReadSheet, base: QuizDoc, ctx: SheetContext, b: BuildBits, st: ImportState): void {
  const want = recsSheet(base, ctx, b).rows.map((r) => r.file);
  const keys = SHEET_COPY.recsCols.map(low);
  const got = s.body.map((r) => keys.map((k) => cellOf(s, r, k)));
  const differs =
    got.length !== want.length ||
    got.some((g, i) => g.some((v, j) => v !== undefined && !sameCell(v, want[i]![j]!, j === 0)));
  if (differs) addNote(st, IMPORT_COPY.recsReadOnly);
}

const ROLE_WORDS: Record<string, "decides" | "filter" | "qualifier"> = {
  "picks results": "decides",
  "picks the result": "decides",
  narrows: "filter",
  "narrows results": "filter",
  "info only": "qualifier",
};

const A_COL = {
  q: "q",
  question: "question",
  type: "type",
  answer: "answer",
  does: "what it does",
  shows: "shows / keeps",
  then: "then",
} as const;
/** File column positions (AnswerSheetRow.file). */
const A_IDX = { q: 0, question: 1, type: 2, answer: 3, does: 4, shows: 5, then: 6 } as const;

function importAnswers(s: ReadSheet, base: QuizDoc, ctx: SheetContext, b: BuildBits, st: ImportState): void {
  const expected = new Map(answersSheet(base, ctx, b).rows.map((r) => [r.answerId, r]));
  const hasAid = s.col.has(ANSWER_ID_KEY);
  const byIndex = new Map(b.ordered.map((q) => [q.qIndex, q]));
  const answerLoc = new Map<string, { q: OrderedQuestion; ai: number }>();
  for (const q of b.ordered) q.node.data.answers.forEach((a, ai) => answerLoc.set(a.id, { q, ai }));

  // ── row matching (B4): id, then Q + exact text, then one-for-one ──
  const pair = new Map<BodyRow, string>();
  const rowQ = new Map<BodyRow, OrderedQuestion>();
  const usedIds = new Set<string>();
  const idCount = new Map<string, number>();
  if (hasAid) {
    for (const r of s.body) {
      const id = cellOf(s, r, ANSWER_ID_KEY) ?? "";
      if (id) idCount.set(id, (idCount.get(id) ?? 0) + 1);
    }
  }
  for (const r of s.body) {
    const id = hasAid ? (cellOf(s, r, ANSWER_ID_KEY) ?? "") : "";
    const qCell = cellOf(s, r, A_COL.q);
    const qm = qCell ? qCell.match(/^q(\d+)$/i) : null;
    const qFromCell = qm ? byIndex.get(Number(qm[1])) : undefined;
    if (id) {
      const loc = answerLoc.get(id);
      if (!loc) {
        st.skipped++;
        addNote(st, IMPORT_COPY.badAnswerId(r.row));
        continue;
      }
      if ((idCount.get(id) ?? 0) > 1) {
        st.skipped++;
        addNote(st, IMPORT_COPY.repeatedAnswerId(r.row));
        continue;
      }
      if (qCell && qFromCell?.node.id !== loc.q.node.id) {
        st.skipped++;
        addNote(st, IMPORT_COPY.wrongQ(r.row));
        continue;
      }
      pair.set(r, id);
      usedIds.add(id);
      rowQ.set(r, loc.q);
      continue;
    }
    if (!qFromCell) {
      st.skipped++;
      addNote(st, IMPORT_COPY.noAddAnswers(cellOf(s, r, A_COL.answer) || qCell || "?"));
      continue;
    }
    rowQ.set(r, qFromCell);
  }
  for (const q of b.ordered) {
    const rows = s.body.filter((r) => rowQ.get(r) === q);
    const rest = rows.filter((r) => !pair.has(r));
    for (const r of rest) {
      const t = cellOf(s, r, A_COL.answer);
      if (t === undefined) continue;
      const a = q.node.data.answers.find((x) => !usedIds.has(x.id) && low(x.text) === low(t));
      if (a) {
        pair.set(r, a.id);
        usedIds.add(a.id);
      }
    }
    const openR = rest.filter((r) => !pair.has(r));
    const openA = q.node.data.answers.filter((a) => !usedIds.has(a.id));
    if (openR.length && openR.length === openA.length) {
      openR.forEach((r, j) => {
        pair.set(r, openA[j]!.id);
        usedIds.add(openA[j]!.id);
      });
    } else {
      for (const r of openR) {
        st.skipped++;
        addNote(st, IMPORT_COPY.noSuchAnswer(q.qIndex, cellOf(s, r, A_COL.answer) || "?"));
      }
    }
    const gone = q.node.data.answers.filter((a) => !usedIds.has(a.id)).length;
    if (gone > 0) addNote(st, IMPORT_COPY.notInFile(q.qIndex, gone));
    const order = rows.filter((r) => pair.has(r)).map((r) => answerLoc.get(pair.get(r)!)!.ai);
    if (order.some((v, i) => i > 0 && v < order[i - 1]!)) addNote(st, IMPORT_COPY.order);
  }

  const matched = s.body.filter((r) => pair.has(r));
  const rowsOf = (qid: string) => matched.filter((r) => answerLoc.get(pair.get(r)!)!.q.node.id === qid);

  // ── question-level cells: every changed row of a question must agree ──
  const proposal = (
    q: OrderedQuestion,
    key: string,
    idx: number,
    colName: string,
    exact: boolean,
  ): string | undefined => {
    if (!s.col.has(key)) return undefined;
    const vals = new Set<string>();
    let raw: string | undefined;
    for (const r of rowsOf(q.node.id)) {
      const v = cellOf(s, r, key)!;
      const exp = expected.get(pair.get(r)!)!;
      if (sameCell(v, exp.file[idx]!, exact)) continue;
      vals.add(exact ? v : low(v));
      raw = v;
    }
    if (vals.size > 1) {
      st.skipped++;
      addNote(st, IMPORT_COPY.disagree(q.qIndex, colName));
      return undefined;
    }
    return raw;
  };
  const cols = SHEET_COPY.answersCols;
  const qNum = (id: string) => b.qIndexByNode.get(id) ?? 0;

  // What it does: demotions first, then the one promotion (D9 path).
  const roleWants: Array<{ q: OrderedQuestion; role: "decides" | "filter" | "qualifier" }> = [];
  for (const q of b.ordered) {
    const v = proposal(q, A_COL.does, A_IDX.does, cols[A_IDX.does]!, false);
    if (v === undefined) continue;
    const role = ROLE_WORDS[low(v)];
    if (!role) {
      st.skipped++;
      addNote(st, IMPORT_COPY.badRole(q.qIndex, v));
      continue;
    }
    roleWants.push({ q, role });
  }
  const promotions = roleWants.filter((w) => w.role === "decides");
  if (promotions.length > 1) {
    st.skipped += promotions.length;
    addNote(st, IMPORT_COPY.onePicker);
  }
  for (const w of [...roleWants.filter((x) => x.role !== "decides"), ...(promotions.length === 1 ? promotions : [])]) {
    const res = changeQuestionRole(st.doc, w.q.node.id, w.role);
    if (res.doc === st.doc) {
      const cur = (st.doc.nodes.find((n) => n.id === w.q.node.id) as QuestionNode | undefined)?.data.role;
      if ((cur ?? "qualifier") === w.role) continue;
      st.skipped++;
      addNote(st, IMPORT_COPY.cantPick(w.q.qIndex));
      continue;
    }
    st.doc = res.doc;
    st.changes++;
    st.inertAnswers = true;
    if (w.role === "decides") {
      const lost = res.lost.targets;
      addNote(
        st,
        lost && lost.nodeId !== w.q.node.id
          ? `${SHEET_COPY.roleMoved(w.q.qIndex)}. ${SHEET_COPY.roleLost(qNum(lost.nodeId), lost.count)}`
          : SHEET_COPY.roleMoved(w.q.qIndex),
      );
    } else if (res.lost.targets) {
      addNote(st, SHEET_COPY.roleLost(qNum(res.lost.targets.nodeId), res.lost.targets.count));
    }
    if (res.lost.values) addNote(st, SHEET_COPY.valuesLost(qNum(res.lost.values.nodeId), res.lost.values.count));
  }

  // Type.
  for (const q of b.ordered) {
    const v = proposal(q, A_COL.type, A_IDX.type, cols[A_IDX.type]!, false);
    if (v === undefined) continue;
    const node = st.doc.nodes.find((n) => n.id === q.node.id) as QuestionNode | undefined;
    if (!node) continue;
    const p = parseTypeCell(v);
    const count = node.data.answers.length;
    let why: string | null = null;
    if (!p) why = IMPORT_COPY.badType(q.qIndex, v);
    else if (p.type === "image_tile" && node.data.question_type !== "image_tile") why = IMPORT_COPY.imageOnly(q.qIndex);
    else if (p.type === "rating" && p.n !== count) why = IMPORT_COPY.typePoints(q.qIndex, count);
    else if (p.type === "multi_select" && (p.min < 1 || p.min > p.max || p.max > count)) {
      why = IMPORT_COPY.typePicks(q.qIndex, v);
    }
    if (why || !p) {
      st.skipped++;
      addNote(st, why ?? IMPORT_COPY.badType(q.qIndex, v));
      continue;
    }
    const res = applyQuestionType(st.doc, q.node.id, p);
    if (res.doc === st.doc) continue;
    st.doc = res.doc;
    st.changes++;
    if (res.converted) {
      st.changes += res.converted;
      addNote(st, SHEET_COPY.anyOfNow(q.qIndex));
    }
  }

  // Question text.
  for (const q of b.ordered) {
    const v = proposal(q, A_COL.question, A_IDX.question, cols[A_IDX.question]!, true);
    if (v === undefined) continue;
    if (!v) {
      st.skipped++;
      addNote(st, IMPORT_COPY.emptyQuestion(q.qIndex));
      continue;
    }
    if (v.length > QUESTION_TEXT_MAX) {
      st.skipped++;
      addNote(st, IMPORT_COPY.longQuestion(q.qIndex));
      continue;
    }
    const next = setQuestionText(st.doc, q.node.id, v);
    if (next !== st.doc) {
      st.doc = next;
      st.changes++;
    }
  }

  const answerNow = (qid: string, aid: string) => {
    const n = st.doc.nodes.find((x) => x.id === qid);
    return n && n.type === "question" ? { node: n, answer: n.data.answers.find((a) => a.id === aid) } : null;
  };

  // Answer text.
  for (const r of matched) {
    const aid = pair.get(r)!;
    const { q } = answerLoc.get(aid)!;
    const at = cellOf(s, r, A_COL.answer);
    if (at === undefined || sameCell(at, expected.get(aid)!.file[A_IDX.answer]!, true)) continue;
    if (!at) {
      st.skipped++;
      addNote(st, IMPORT_COPY.emptyAnswer(q.qIndex));
      continue;
    }
    if (at.length > ANSWER_TEXT_MAX) {
      st.skipped++;
      addNote(st, IMPORT_COPY.longAnswer(q.qIndex, `${at.slice(0, 24)}…`));
      continue;
    }
    const next = setAnswerText(st.doc, q.node.id, aid, at);
    if (next !== st.doc) {
      st.doc = next;
      st.changes++;
    }
  }

  // Shows / keeps (read against the role AFTER the role cells).
  const resolveName = nameResolver(ctx);
  for (const r of matched) {
    const aid = pair.get(r)!;
    const { q } = answerLoc.get(aid)!;
    const sv = cellOf(s, r, A_COL.shows);
    if (sv === undefined || sameCell(sv, expected.get(aid)!.file[A_IDX.shows]!, true)) continue;
    const now = answerNow(q.node.id, aid);
    if (!now?.answer) continue;
    const { node, answer } = now;
    const role = roleOf(node);
    const blank = !sv || low(sv) === low(SHEET_COPY.notSet) || sv === SHEET_COPY.empty;
    if (role === "info") {
      if (blank) continue;
      st.skipped++;
      addNote(st, IMPORT_COPY.infoValue(q.qIndex));
      continue;
    }
    if (role === "decides") {
      const names = blank ? [] : splitNames(sv).filter((n) => low(n) !== low(SHEET_COPY.none));
      const ids: string[] = [];
      let why: string | null = null;
      for (const n of names) {
        const hit = resolveName(n);
        if ("err" in hit) {
          why =
            hit.err === "two"
              ? IMPORT_COPY.twoRecommendations(q.qIndex, n)
              : IMPORT_COPY.noRecommendation(q.qIndex, n);
          break;
        }
        if (!ids.includes(hit.id)) ids.push(hit.id);
      }
      if (why) {
        st.skipped++;
        addNote(st, why);
        continue;
      }
      if (sortedJson(ids) === sortedJson(answerTargets(answer))) continue;
      st.doc = writeAnswerTargetList(st.doc, q.node.id, aid, ids);
      st.changes++;
      st.inertAnswers = true;
      continue;
    }
    // Narrows: one full-set write built from the typed values.
    let values: Parameters<typeof setAnswerFilterValues>[3];
    if (low(sv) === low(SHEET_COPY.keepsEverything)) values = { no_preference: true };
    else if (blank) values = {};
    else {
      const set: ValueSet = {
        tags: [],
        collection_filters: [],
        metafield_filters: [],
        variant_filters: [],
        product_type_filters: [],
      };
      let bad: string | null = null;
      for (const item of splitNames(sv)) {
        const w = parseNarrowValue(item, ctx.collectionTitles, node.data.answers);
        if (!w) {
          bad = item;
          break;
        }
        w(set);
      }
      if (bad !== null) {
        st.skipped++;
        addNote(st, IMPORT_COPY.badValue(q.qIndex, bad));
        continue;
      }
      values = set;
    }
    const next = setAnswerFilterValues(st.doc, q.node.id, aid, values);
    const after = (next.nodes.find((n) => n.id === q.node.id) as QuestionNode).data.answers.find((a) => a.id === aid);
    if (sortedJson(answer) === sortedJson(after)) continue;
    st.doc = next;
    st.changes++;
    st.inertAnswers = true;
  }

  // Then: forward only, compared by where the answer really goes.
  const resultNode = base.nodes.find((n) => n.type === "result") ?? base.nodes.find((n) => n.type === "end");
  const last = b.ordered.length;
  for (const r of matched) {
    const aid = pair.get(r)!;
    const { q } = answerLoc.get(aid)!;
    const tv = cellOf(s, r, A_COL.then);
    if (tv === undefined || sameCell(tv, expected.get(aid)!.file[A_IDX.then]!, false)) continue;
    const now = answerNow(q.node.id, aid);
    if (!now?.answer) continue;
    const answer = now.answer;
    const t = low(tv);
    let target: string | null | undefined;
    let want: string;
    if (!t || t === low(SHEET_COPY.then.next) || t === low(SHEET_COPY.then.last)) {
      target = null;
      want = q.qIndex >= last ? SHEET_COPY.then.last : SHEET_COPY.then.next;
    } else if (t === low(SHEET_COPY.then.results)) {
      target = resultNode?.id;
      want = SHEET_COPY.then.results;
    } else {
      const m = t.match(/^skips to q(\d+)$/);
      const tq = m ? byIndex.get(Number(m[1])) : undefined;
      if (!tq) {
        st.skipped++;
        addNote(st, IMPORT_COPY.badThen(q.qIndex, tv));
        continue;
      }
      if (tq.qIndex <= q.qIndex) {
        st.skipped++;
        addNote(st, IMPORT_COPY.forwardOnly(answer.text, q.qIndex));
        continue;
      }
      target = tq.qIndex === q.qIndex + 1 ? null : tq.node.id;
      want = tq.qIndex === q.qIndex + 1 ? SHEET_COPY.then.next : SHEET_COPY.then.skip(tq.qIndex);
    }
    if (target === undefined) {
      st.skipped++;
      addNote(st, IMPORT_COPY.badThen(q.qIndex, tv));
      continue;
    }
    const nowDest = destinationText(answerDestination(st.doc, q, answer, b.qIndexByNode, last));
    if (nowDest === want) continue;
    const next = setAnswerRoute(st.doc, q.node.id, aid, target);
    if (next === st.doc) {
      st.skipped++;
      addNote(st, IMPORT_COPY.forwardOnly(answer.text, q.qIndex));
      continue;
    }
    st.doc = next;
    st.changes++;
  }
}

const R_COL = { num: "#", verb: "what happens", recs: "recommendations", when: "when they answer" } as const;
const R_IDX = { num: 0, verb: 1, recs: 2, when: 3 } as const;

function importRules(s: ReadSheet, base: QuizDoc, ctx: SheetContext, b: BuildBits, st: ImportState): void {
  const expected = new Map(rulesSheet(base, ctx, b).rows.map((r) => [r.ruleId, r]));
  const mid = st.doc;
  const midRules = mid.decision_rules ?? [];
  const midById = new Map(midRules.map((r) => [r.id, r]));
  const hasRid = s.col.has(RULE_ID_KEY);
  const wc = whenContext(base, mid);
  const resolveName = nameResolver(ctx);

  const idRows = new Map<string, number>();
  if (hasRid) {
    for (const r of s.body) {
      const id = cellOf(s, r, RULE_ID_KEY) ?? "";
      if (id && low(id) !== low(SHEET_COPY.exampleRuleId)) idRows.set(id, (idRows.get(id) ?? 0) + 1);
    }
  }
  const claimed = new Set([...idRows.keys()].filter((id) => midById.has(id)));
  const used = new Set<string>();
  const next: DecisionRule[] = [];
  const bad: string[] = [];
  const splits: number[] = [];
  let examples = 0;
  let lastNum = -Infinity;
  let renumbered = false;
  // The file row's place among the rule rows. Pairing reads this, never
  // `next.length`: a D13 split pushes several rules for one row.
  let rowPos = 0;

  for (const r of s.body) {
    const rid0 = hasRid ? (cellOf(s, r, RULE_ID_KEY) ?? "") : "";
    if (low(rid0) === low(SHEET_COPY.exampleRuleId)) {
      examples++;
      continue;
    }
    const pos = rowPos++;
    const num = cellOf(s, r, R_COL.num) ?? "";
    if (num) {
      const v = Number.parseFloat(num);
      if (!(v > lastNum)) renumbered = true;
      if (Number.isFinite(v)) lastNum = v;
    }
    const fail = (why: string) => bad.push(`${IMPORT_COPY.rowPrefix(r.row)}: ${why}`);
    let baseRule: DecisionRule | null = null;
    if (rid0) {
      if (!midById.has(rid0)) {
        fail(IMPORT_COPY.unknownRuleId);
        continue;
      }
      if ((idRows.get(rid0) ?? 0) > 1) {
        fail(IMPORT_COPY.repeatedRuleId);
        continue;
      }
      baseRule = midById.get(rid0)!;
    } else if (!hasRid) {
      // No id column: the rule in this place, if no other row claims it.
      const p = midRules[pos];
      if (p && !used.has(p.id) && !claimed.has(p.id)) baseRule = p;
    }
    const exp = baseRule ? expected.get(baseRule.id) : undefined;
    const fileCell = (key: string) => cellOf(s, r, key);
    const changed = (key: string, idx: number, exact: boolean): string | undefined => {
      const v = fileCell(key);
      if (v === undefined) return undefined;
      if (exp && sameCell(v, exp.file[idx]!, exact)) return undefined;
      return v;
    };
    let rule: DecisionRule = baseRule ? { ...baseRule } : { id: "", conditions: [], target_id: "" };
    let edited = !baseRule;
    let why: string | null = null;

    // What happens.
    const vt = changed(R_COL.verb, R_IDX.verb, false);
    if (vt !== undefined || !baseRule) {
      const raw = vt ?? fileCell(R_COL.verb);
      const word = low(raw ?? "");
      const action = word === "show" ? "show" : word === "pin" ? "prioritize" : word === "hide" ? "hide" : null;
      if (raw === undefined) rule.action = "show";
      else if (!word) why = IMPORT_COPY.emptyVerb;
      else if (!action) why = IMPORT_COPY.badVerb(raw);
      else if (ctx.style === "rules" && action !== "show") why = IMPORT_COPY.rulesOnlyVerb;
      else rule.action = action;
      edited = true;
    }

    // Recommendations.
    const rc = changed(R_COL.recs, R_IDX.recs, true);
    if (!why && (rc !== undefined || (!baseRule && fileCell(R_COL.recs) !== undefined))) {
      const names = splitNames(rc ?? fileCell(R_COL.recs) ?? "").filter((n) => low(n) !== low(SHEET_COPY.none));
      const ids: string[] = [];
      for (const n of names) {
        const hit = resolveName(n);
        if ("err" in hit) {
          why = hit.err === "two" ? IMPORT_COPY.twoRuleRecommendations(n) : IMPORT_COPY.noRuleRecommendation(n);
          break;
        }
        if (!ids.includes(hit.id)) ids.push(hit.id);
      }
      if (!why) {
        const { target_ids: _t, ...rest } = rule;
        rule = { ...rest, target_id: ids[0] ?? "", ...(ids.length > 1 ? { target_ids: ids } : {}) };
      }
      edited = true;
    }

    // When they answer.
    const wcell = changed(R_COL.when, R_IDX.when, true);
    let split = false;
    if (!why && (wcell !== undefined || (!baseRule && fileCell(R_COL.when) !== undefined))) {
      try {
        const p = parseWhenCell(wcell ?? fileCell(R_COL.when) ?? "", wc);
        const { any_of: _a, match: _m, ...rest } = rule;
        rule = {
          ...rest,
          conditions: p.conditions,
          ...(p.anyOf.length ? { any_of: p.anyOf } : {}),
          ...(p.acrossOr ? { match: "any" as const } : {}),
        };
        // D13: a stored match-any rule keeps its OR; any other becomes
        // adjacent rules, one per question.
        if (p.acrossOr && baseRule?.match !== "any") split = true;
      } catch (e) {
        if (!(e instanceof WhenError)) throw e;
        why = e.message;
      }
      edited = true;
    }

    if (!why && edited) {
      if (rule.conditions.length === 0) why = IMPORT_COPY.needsAnswer;
      else if (!rule.target_id) why = IMPORT_COPY.needsRecommendation;
    }
    if (why) {
      fail(why);
      continue;
    }
    if (!edited && baseRule) {
      used.add(baseRule.id);
      next.push(baseRule);
      continue;
    }
    const id = baseRule && !used.has(baseRule.id) ? baseRule.id : uid("rule");
    used.add(id);
    const normalized = normalizeDecisionRule({ ...rule, id }, mid);
    if (split) {
      splits.push(r.row);
      for (const part of splitCrossQuestionOr(normalized, () => uid("rule"))) {
        next.push(normalizeDecisionRule(part, mid));
      }
    } else next.push(normalized);
  }

  if (examples) addNote(st, examples > 1 ? IMPORT_COPY.exampleRows(examples) : IMPORT_COPY.exampleRow);
  if (renumbered) addNote(st, IMPORT_COPY.renumbered);
  if (bad.length) {
    st.skipped += bad.length;
    addNote(st, IMPORT_COPY.rulesBad(bad[0]!, bad.length - 1));
    return;
  }
  for (const row of splits) addNote(st, IMPORT_COPY.ruleSplit(row));
  if (sortedJson(midRules) === sortedJson(next)) return;
  const kept = new Set(next.map((r) => r.id));
  const removed = midRules.map((r, i) => (kept.has(r.id) ? 0 : i + 1)).filter(Boolean);
  if (removed.length) addNote(st, IMPORT_COPY.rulesRemoved(removed.join(", ")));
  const d = ruleDiff(midRules, next, mid);
  st.doc = { ...mid, decision_rules: next };
  st.changes += d || 1;
}

/** The toast line for an import result (mock toastImp): "Imported N
 *  changes · K skipped · note · note · +M more". */
export function importToastMessage(r: Pick<ImportResult, "changes" | "skipped" | "notes">): string {
  const parts = [r.changes ? IMPORT_COPY.imported(r.changes) : IMPORT_COPY.nothingChanged];
  if (r.skipped) parts.push(IMPORT_COPY.skipped(r.skipped));
  parts.push(...r.notes.slice(0, 2));
  if (r.notes.length > 2) parts.push(IMPORT_COPY.more(r.notes.length - 2));
  return parts.join(" · ");
}
