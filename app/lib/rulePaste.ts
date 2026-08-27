import type { DecisionRuleCondition } from "./quizSchema";

// ════════════════════════════════════════════════════════════════════════════
// Logic-step handoff §6 — written rules (paste). Pure parser: pasted text +
// the quiz's answer/target vocabulary in, draft rules out. NOTHING IS
// GUESSED: a line that does not fully resolve is returned as unmatched with
// a reason, never snapped to the closest answer — that is the failure mode
// that makes paste untrustworthy.
//
// Grammar (no brackets — scope comes from which question each answer
// belongs to, §3's one-control-per-scope rule):
//   when <answer> [and|or <answer>]... then <show|pin|hide> <target>
//
//   · or  between answers of the SAME question  → within-column any-of
//   · and between answers of the SAME question  → all-of (multi-select only;
//     on a single-select it matches nobody → unmatched)
//   · connectors BETWEEN questions must all agree: and → match all,
//     or → match any; mixing and with or across questions has no single
//     reading → unmatched (§6).
//
// The one requirement that has already bitten (§6): answer names resolve
// LONGEST-WHOLE-MATCH-FIRST. Splitting on a bare "and" cuts inside real
// answer names — "Controlling shine and pores" is one answer.
// ════════════════════════════════════════════════════════════════════════════

export interface PasteVocabQuestion {
  id: string;
  text: string;
  /** true when the question allows several picks (multi_select). */
  multiSelect: boolean;
  answers: { id: string; text: string }[];
}

export interface PasteVocabTarget {
  id: string;
  label: string;
}

export interface PasteVocab {
  questions: PasteVocabQuestion[];
  targets: PasteVocabTarget[];
}

/** One tinted fragment of the parse-back line (mock module 18 — "every
 *  recognised part is tinted by what it resolved to"). */
export interface PasteSegment {
  text: string;
  kind: "keyword" | "answer" | "connector" | "verb" | "target" | "raw";
  questionId?: string;
}

export interface ParsedPasteLine {
  ok: true;
  line: string;
  lineNumber: number;
  conditions: DecisionRuleCondition[];
  /** Present only when the across-question join is OR. */
  match?: "any";
  /** Question ids whose within-column join is any-of. */
  any_of?: string[];
  action: "show" | "hide" | "prioritize";
  targetId: string;
  segments: PasteSegment[];
}

export interface UnmatchedPasteLine {
  ok: false;
  line: string;
  lineNumber: number;
  reason: string;
}

export type PasteLineResult = ParsedPasteLine | UnmatchedPasteLine;

const VERBS: Record<string, "show" | "hide" | "prioritize"> = {
  show: "show",
  pin: "prioritize",
  prioritize: "prioritize",
  hide: "hide",
};

interface AnswerEntry {
  norm: string;
  text: string;
  answerId: string;
  questionId: string;
  ambiguous: boolean;
}

function norm(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Match an answer name at the START of `rest` (already-normalized text),
 *  longest first, and only at a word boundary. */
function matchAnswerAt(rest: string, entries: AnswerEntry[]): AnswerEntry | null {
  for (const e of entries) {
    if (!rest.startsWith(e.norm)) continue;
    const after = rest.charAt(e.norm.length);
    if (after === "" || after === " " || after === ",") return e;
  }
  return null;
}

export function parsePastedRules(text: string, vocab: PasteVocab): PasteLineResult[] {
  // Longest-first vocabulary — the §6 requirement.
  const entries: AnswerEntry[] = [];
  const byNorm = new Map<string, AnswerEntry>();
  for (const q of vocab.questions) {
    for (const a of q.answers) {
      const n = norm(a.text);
      if (!n) continue;
      const existing = byNorm.get(n);
      if (existing) {
        // The same visible text on two questions cannot be resolved without
        // guessing — matching it later reports the ambiguity.
        if (existing.questionId !== q.id || existing.answerId !== a.id) {
          existing.ambiguous = true;
        }
        continue;
      }
      const entry: AnswerEntry = {
        norm: n,
        text: a.text.trim(),
        answerId: a.id,
        questionId: q.id,
        ambiguous: false,
      };
      byNorm.set(n, entry);
      entries.push(entry);
    }
  }
  entries.sort((a, b) => b.norm.length - a.norm.length);

  // Case-folded target labels can collide ("Accessories" vs "accessories"
  // are distinct Category rows in real catalogs) — an ambiguous name is
  // reported, never resolved to whichever row came first.
  const targets = vocab.targets
    .map((t) => ({ norm: norm(t.label), label: t.label.trim(), id: t.id, ambiguous: false }))
    .filter((t) => t.norm.length > 0)
    .sort((a, b) => b.norm.length - a.norm.length);
  const targetNormCount = new Map<string, Set<string>>();
  for (const t of targets) {
    const ids = targetNormCount.get(t.norm) ?? new Set();
    ids.add(t.id);
    targetNormCount.set(t.norm, ids);
  }
  for (const t of targets) {
    if ((targetNormCount.get(t.norm)?.size ?? 0) > 1) t.ambiguous = true;
  }
  const multiSelect = new Set(
    vocab.questions.filter((q) => q.multiSelect).map((q) => q.id),
  );

  const out: PasteLineResult[] = [];
  const rawLines = text.split(/\r?\n/);
  rawLines.forEach((rawLine, idx) => {
    const line = rawLine.trim();
    if (!line) return; // blank lines are skipped, not unmatched
    const lineNumber = idx + 1;
    const fail = (reason: string) => {
      out.push({ ok: false, line, lineNumber, reason });
    };

    const lower = norm(line);
    if (!lower.startsWith("when ")) {
      fail('Lines start with "when" — e.g. when Warm golds then pin Gift cards.');
      return;
    }
    const thenAt = lower.lastIndexOf(" then ");
    if (thenAt < 0) {
      fail('Missing "then" — every line needs "then show / pin / hide <result>".');
      return;
    }
    const condsText = lower.slice("when ".length, thenAt).trim();
    const thenText = lower.slice(thenAt + " then ".length).trim();

    // ── then-clause: verb + target ─────────────────────────────────────────
    const verbWord = thenText.split(" ", 1)[0] ?? "";
    const action = VERBS[verbWord];
    if (!action) {
      fail(`Unknown action "${verbWord}" — use show, pin or hide.`);
      return;
    }
    const targetText = thenText.slice(verbWord.length).trim();
    if (!targetText) {
      fail(`"${verbWord}" needs a result to act on.`);
      return;
    }
    const target = targets.find((t) => t.norm === targetText);
    if (!target) {
      fail(`No result set called "${targetText}" — targets must match a result exactly.`);
      return;
    }
    if (target.ambiguous) {
      fail(`More than one result set is called "${target.label}" — can't tell which you mean.`);
      return;
    }

    // ── when-clause: answers + connectors, longest-whole-match-first ───────
    const answers: AnswerEntry[] = [];
    const connectors: ("and" | "or")[] = [];
    const segments: PasteSegment[] = [{ text: "when", kind: "keyword" }];
    let rest = condsText;
    let expectAnswer = true;
    let brokenAt: string | null = null;
    while (rest.length > 0) {
      rest = rest.replace(/^[\s,]+/, "");
      if (!rest) break;
      if (expectAnswer) {
        const hit = matchAnswerAt(rest, entries);
        if (!hit) {
          brokenAt = rest;
          break;
        }
        if (hit.ambiguous) {
          fail(`"${hit.text}" appears on more than one question — can't tell which you mean.`);
          return;
        }
        answers.push(hit);
        segments.push({ text: hit.text, kind: "answer", questionId: hit.questionId });
        rest = rest.slice(hit.norm.length);
        expectAnswer = false;
      } else {
        const conn = rest.startsWith("and ") || rest === "and"
          ? "and"
          : rest.startsWith("or ") || rest === "or"
            ? "or"
            : null;
        if (!conn) {
          brokenAt = rest;
          break;
        }
        connectors.push(conn);
        segments.push({ text: conn, kind: "connector" });
        rest = rest.slice(conn.length);
        expectAnswer = true;
      }
    }
    if (brokenAt !== null) {
      fail(`Couldn't match "${brokenAt.slice(0, 40)}" to an answer.`);
      return;
    }
    if (answers.length === 0) {
      fail("No answers found between when and then.");
      return;
    }
    if (expectAnswer) {
      fail(`The line ends after "${connectors[connectors.length - 1]}" — an answer is missing.`);
      return;
    }

    // ── scope resolution (§6): within-question vs across-question ──────────
    // A question's answers must sit in ONE contiguous run — "A or X or B"
    // with A/B on one question and X on another interleaves the columns and
    // has no single reading.
    const runsSeen = new Set<string>();
    let runQuestion: string | null = null;
    for (const a of answers) {
      if (a.questionId === runQuestion) continue;
      if (runsSeen.has(a.questionId)) {
        fail("Answers from one question must sit together — this line interleaves two questions.");
        return;
      }
      runsSeen.add(a.questionId);
      runQuestion = a.questionId;
    }
    const acrossConnectors = new Set<"and" | "or">();
    const withinByQuestion = new Map<string, Set<"and" | "or">>();
    for (let i = 0; i < connectors.length; i++) {
      const a = answers[i]!;
      const b = answers[i + 1]!;
      if (a.questionId === b.questionId) {
        const set = withinByQuestion.get(a.questionId) ?? new Set();
        set.add(connectors[i]!);
        withinByQuestion.set(a.questionId, set);
      } else {
        acrossConnectors.add(connectors[i]!);
      }
    }
    if (acrossConnectors.size > 1) {
      fail("Mixes and with or across questions — that has no single reading. Split it into two rules.");
      return;
    }
    const any_of: string[] = [];
    for (const [qid, conns] of withinByQuestion) {
      if (conns.size > 1) {
        fail("Mixes and with or between answers of one question — pick one.");
        return;
      }
      const conn = [...conns][0]!;
      if (conn === "or") {
        any_of.push(qid);
      } else if (!multiSelect.has(qid)) {
        const q = vocab.questions.find((x) => x.id === qid);
        fail(
          `"${q?.text ?? qid}" is single-choice — a shopper can't answer two of its options. Use or.`,
        );
        return;
      }
      // within-question "and" on a multi-select = all-of = the absent-field
      // default; nothing to store.
    }

    // A duplicated answer in one line collapses (the engine's set semantics
    // would too) — keep conditions unique per (question, answer).
    const seen = new Set<string>();
    const conditions: DecisionRuleCondition[] = [];
    for (const a of answers) {
      const k = `${a.questionId} ${a.answerId}`;
      if (seen.has(k)) continue;
      seen.add(k);
      conditions.push({ question_id: a.questionId, answer_id: a.answerId, op: "is" });
    }

    segments.push(
      { text: "then", kind: "keyword" },
      { text: verbWord, kind: "verb" },
      { text: target.label, kind: "target" },
    );
    out.push({
      ok: true,
      line,
      lineNumber,
      conditions,
      ...(acrossConnectors.has("or") ? { match: "any" as const } : {}),
      ...(any_of.length ? { any_of } : {}),
      action,
      targetId: target.id,
      segments,
    });
  });
  return out;
}
