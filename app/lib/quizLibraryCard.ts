import type { Quiz as QuizDoc } from "./quizSchema";
import { isFreeformType } from "./quizSchema";
import { orderedQuestions } from "./questionOrder";

// Per-card facts for the Quizzes library.
// Pure + defensive: reads a loosely-typed quiz doc (draftJson) WITHOUT a full
// Zod parse, so a legacy/odd doc can never throw the library loader. Facts are
// cosmetic — a missing field just falls back.

interface LooseAnswer {
  text?: unknown;
  target_id?: string;
}
interface LooseNode {
  type?: string;
  data?: {
    text?: unknown;
    question_type?: unknown;
    answers?: LooseAnswer[];
  };
}
interface LooseDoc {
  nodes?: LooseNode[];
  edges?: unknown[];
}

// Quizzes tab (Crest) — the card's preview is the quiz's own opening question,
// set in our type: different for every quiz, and it can't render badly.
export interface QuizCardOpening {
  /** The opening question's text, trimmed. */
  text: string;
  /** "typed" = text | email | numeric | date | slider: no answer list is drawn. */
  kind: "choices" | "typed";
  questionType: string;
  /** The first four answer labels, in stored order. Empty when kind is "typed". */
  answers: string[];
  /** Every answer on the question, for the "5 answers" count. 0 when typed. */
  answerCount: number;
}
export interface QuizCardFacts {
  questions: number;
  personas: number;
  targetIds: string[];
  /** null = no questions yet. */
  opening: QuizCardOpening | null;
}

const OPENING_ANSWERS = 4;

// "Opening question" = Q1 as the builder numbers it (orderedQuestions walks the
// flow from the intro), not the first question in nodes order. orderFlow
// iterates doc.nodes / doc.edges directly and throws on a malformed doc, so it
// only runs when both are arrays, inside a try; anything else falls back to the
// first question in nodes order.
function openingNode(d: LooseDoc, nodes: LooseNode[]): LooseNode | undefined {
  if (Array.isArray(d.nodes) && Array.isArray(d.edges)) {
    try {
      const first = orderedQuestions(d as unknown as QuizDoc)[0]?.node as LooseNode | undefined;
      if (first) return first;
    } catch {
      // Odd doc — the nodes-order fallback below.
    }
  }
  return nodes.find((n) => n?.type === "question");
}

function quizCardOpening(d: LooseDoc, nodes: LooseNode[]): QuizCardOpening | null {
  const node = openingNode(d, nodes);
  if (!node) return null;
  const data = node.data && typeof node.data === "object" ? node.data : {};
  const text = typeof data.text === "string" ? data.text.trim() : "";
  const questionType = typeof data.question_type === "string" ? data.question_type : "";
  // A typed question stores one seed answer in answers[] — never show it.
  if (isFreeformType(questionType)) {
    return { text, kind: "typed", questionType, answers: [], answerCount: 0 };
  }
  // Text only: icon, image_url and every other answer field are ignored.
  const labels = (Array.isArray(data.answers) ? data.answers : [])
    .map((a) => (a && typeof a.text === "string" ? a.text.trim() : ""))
    .filter(Boolean);
  return {
    text,
    kind: "choices",
    questionType,
    answers: labels.slice(0, OPENING_ANSWERS),
    answerCount: labels.length,
  };
}

export function quizCardFacts(doc: unknown): QuizCardFacts {
  const d = (doc && typeof doc === "object" ? doc : {}) as LooseDoc;
  const nodes = Array.isArray(d.nodes) ? d.nodes : [];

  const questions = nodes.filter((n) => n?.type === "question").length;

  // Personas = distinct outcome targets an answer maps to (target_id). If the
  // doc has none yet (results bake at publish), fall back to result-node count.
  const targets = new Set<string>();
  let resultNodes = 0;
  for (const n of nodes) {
    if (n?.type === "result") resultNodes += 1;
    const answers = n?.data?.answers;
    if (Array.isArray(answers)) {
      for (const a of answers) if (a?.target_id) targets.add(a.target_id);
    }
  }
  const personas = targets.size > 0 ? targets.size : resultNodes;

  return {
    questions,
    personas,
    targetIds: [...targets],
    opening: quizCardOpening(d, nodes),
  };
}
