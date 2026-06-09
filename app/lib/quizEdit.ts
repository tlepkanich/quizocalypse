import { z } from "zod";
import type { Quiz } from "./quizSchema";
import {
  addQuestionNode,
  deleteNode,
  addAnswer,
  removeAnswer,
  moveStep,
  straightThroughRun,
} from "./quizMutations";
import { getPreset } from "./themePresets";
import { resolveDesignTokens } from "./designTokens";

// ───────────────────────────────────────────────────────────────────────────
// Inline AI chat edit — the deterministic OPS engine (the Dev Spec's "Call 2").
//
// The AI never emits the quiz graph. It emits a small list of intent-level edit
// OPERATIONS that reference existing node/answer ids (from an id-bearing outline
// we hand it). `applyEditOps` applies them onto the REAL node+edge schema using
// the already-tested mutations in quizMutations.ts (which preserve edges, handle
// ids, branch slots, re-stitch on delete, etc.). The caller then runs
// `Quiz.parse` as the final gate. This keeps graph integrity in deterministic,
// unit-testable code — the AI can't strand a successor, drop an edge, or mint a
// colliding id. Everything not named by an op is preserved by construction
// (pure spreads), so it's additive + back-compatible.
//
// PURE: no Claude, no IO. The Claude call that produces these ops lives in
// claude.ts (`editQuiz`). A `regenerate_question_flow` escape hatch (needs an AI
// call + buckets) is intentionally out of this first cut — full restructures go
// through Smart Build in Advanced mode.
// ───────────────────────────────────────────────────────────────────────────

type QuizDoc = z.infer<typeof Quiz>;

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

// Editable single-line text fields, by node type. We only ever write a field
// that already exists on the target node's data (guarded below), so an op can
// never introduce an invalid key that would fail Quiz.parse.
const TEXT_FIELDS = [
  "headline",
  "subtext",
  "text",
  "button_label",
  "cta_label",
] as const;

const AnswerSpec = z.object({
  text: z.string().min(1),
  tags: z.array(z.string()).default([]),
});

// The op vocabulary. Each variant maps to a safe mutation (or an inline,
// edge-preserving patch). Kept deliberately small + content-only — no ids,
// edges, positions, points, bindings, or tokens are ever authored by the AI.
export const EditOp = z.discriminatedUnion("op", [
  // Rewrite one text field on any node ("make the results page warmer").
  z.object({
    op: z.literal("set_text"),
    node_id: z.string().min(1),
    field: z.enum(TEXT_FIELDS),
    value: z.string(),
  }),
  // Rewrite a question's text and/or its answer set ("make Q2 simpler").
  // Answers re-merge by order so existing ids + edge routing survive.
  z.object({
    op: z.literal("edit_question"),
    node_id: z.string().min(1),
    text: z.string().min(1).optional(),
    answers: z.array(AnswerSpec).min(2).optional(),
  }),
  // Insert a question into the linear chain ("add a budget question").
  z.object({
    op: z.literal("add_question"),
    after_node_id: z.string().min(1).optional(),
    text: z.string().min(1),
    question_type: z.enum(["single_select", "multi_select"]).default("single_select"),
    answers: z.array(AnswerSpec).min(2),
  }),
  // Remove a node ("remove the last question"). deleteNode re-stitches prev→next.
  z.object({
    op: z.literal("remove_node"),
    node_id: z.string().min(1),
  }),
  // Append an answer to a question, with content.
  z.object({
    op: z.literal("add_answer"),
    node_id: z.string().min(1),
    text: z.string().min(1),
    tags: z.array(z.string()).default([]),
  }),
  // Remove an answer by id (removeAnswer prunes its edge + enforces minimums).
  z.object({
    op: z.literal("remove_answer"),
    node_id: z.string().min(1),
    answer_id: z.string().min(1),
  }),
  // Reorder a question in the linear run (before_node_id null = move to end).
  z.object({
    op: z.literal("reorder_question"),
    node_id: z.string().min(1),
    before_node_id: z.string().min(1).nullable().default(null),
  }),
  // Set/clear the micro-education card shown before a question (Dev Spec §4.1).
  // An empty value clears the card.
  z.object({
    op: z.literal("set_education_card"),
    node_id: z.string().min(1),
    value: z.string(),
  }),
  // Restyle the WHOLE quiz with a vetted theme preset ("make it dark", "use the
  // editorial look"). The AI picks from a closed preset set by id — it never
  // authors raw tokens; applyEditOps resolves the preset's curated token pack.
  z.object({
    op: z.literal("set_theme"),
    preset: z.string().min(1),
  }),
]);
export type EditOp = z.infer<typeof EditOp>;

export interface ApplyEditResult {
  doc: QuizDoc;
  warnings: string[];
}

function findNode(doc: QuizDoc, id: string) {
  return doc.nodes.find((n) => n.id === id) ?? null;
}

// Re-merge an AI answer list onto an existing question, preserving ids +
// edge_handle_ids by order (so edges survive) and pruning edges for any answers
// that were dropped. Mirrors the regenerate-node merge in quizEditorIO.
function mergeQuestionAnswers(
  doc: QuizDoc,
  nodeId: string,
  newAnswers: Array<{ text: string; tags: string[] }>,
): QuizDoc {
  const node = findNode(doc, nodeId);
  if (!node || node.type !== "question") return doc;
  const old = node.data.answers;
  const merged = newAnswers.map((a, i) => {
    const prev = old[i];
    return prev
      ? { ...prev, text: a.text, tags: a.tags }
      : { id: uid("a"), text: a.text, tags: a.tags, edge_handle_id: uid("h") };
  });
  // Edges sourced from a dropped answer's handle are now dangling — prune them.
  const droppedHandles = new Set(
    old.slice(newAnswers.length).map((a) => a.edge_handle_id),
  );
  return {
    ...doc,
    nodes: doc.nodes.map((n) =>
      n.id === nodeId && n.type === "question"
        ? { ...n, data: { ...n.data, answers: merged } }
        : n,
    ),
    edges: droppedHandles.size
      ? doc.edges.filter((e) => !e.source_handle || !droppedHandles.has(e.source_handle))
      : doc.edges,
  };
}

// Insert a question after `anchorId`, splicing it into the linear chain: if the
// anchor had a plain (handle-less) successor edge, re-point it through the new
// node so the flow stays anchor → new → next. Reuses addQuestionNode (tested
// node + anchor→new edge creation), then re-stitches the successor + sets copy.
function insertQuestion(
  doc: QuizDoc,
  anchorId: string | null,
  spec: { text: string; question_type: "single_select" | "multi_select"; answers: Array<{ text: string; tags: string[] }> },
): QuizDoc {
  const before = new Set(doc.nodes.map((n) => n.id));
  let next = addQuestionNode(doc, anchorId);
  const created = next.nodes.find((n) => !before.has(n.id));
  if (!created) return doc;
  const newId = created.id;

  // Splice: re-point the anchor's pre-existing chain successor through the new node.
  if (anchorId) {
    const succ = doc.edges.find(
      (e) => e.source === anchorId && !e.source_handle && e.target !== newId,
    );
    if (succ) {
      next = {
        ...next,
        edges: [
          ...next.edges.filter((e) => e.id !== succ.id),
          { id: uid("e"), source: newId, target: succ.target },
        ],
      };
    }
  }

  // Apply the AI's content (text + type + answers) onto the seeded node.
  return {
    ...next,
    nodes: next.nodes.map((n) =>
      n.id === newId && n.type === "question"
        ? {
            ...n,
            data: {
              ...n.data,
              text: spec.text,
              question_type: spec.question_type,
              answers: spec.answers.map((a) => ({
                id: uid("a"),
                text: a.text,
                tags: a.tags,
                edge_handle_id: uid("h"),
              })),
            },
          }
        : n,
    ),
  };
}

/**
 * Apply a list of AI edit operations to a quiz doc, deterministically and
 * defensively. Unknown/invalid targets are SKIPPED with a warning rather than
 * throwing, so one bad op never discards the rest. The returned doc is NOT yet
 * schema-validated — the caller must run `Quiz.parse` before committing (and
 * discard on failure). Pure: returns a new doc, never mutates the input.
 */
export function applyEditOps(doc: QuizDoc, ops: EditOp[]): ApplyEditResult {
  let working = doc;
  const warnings: string[] = [];

  for (const op of ops) {
    switch (op.op) {
      case "set_text": {
        const node = findNode(working, op.node_id);
        if (!node) {
          warnings.push(`set_text: node ${op.node_id} not found`);
          break;
        }
        const data = node.data as Record<string, unknown>;
        if (!(op.field in data)) {
          warnings.push(`set_text: ${node.type} node has no "${op.field}" field`);
          break;
        }
        working = {
          ...working,
          nodes: working.nodes.map((n) =>
            n.id === op.node_id
              ? ({ ...n, data: { ...n.data, [op.field]: op.value } } as typeof n)
              : n,
          ),
        };
        break;
      }
      case "set_theme": {
        const preset = getPreset(op.preset);
        if (!preset) {
          warnings.push(`set_theme: unknown theme "${op.preset}"`);
          break;
        }
        working = {
          ...working,
          design_tokens: resolveDesignTokens(preset.tokens) as typeof working.design_tokens,
        };
        break;
      }
      case "edit_question": {
        const node = findNode(working, op.node_id);
        if (!node || node.type !== "question") {
          warnings.push(`edit_question: ${op.node_id} is not a question`);
          break;
        }
        if (op.text !== undefined) {
          working = {
            ...working,
            nodes: working.nodes.map((n) =>
              n.id === op.node_id && n.type === "question"
                ? { ...n, data: { ...n.data, text: op.text! } }
                : n,
            ),
          };
        }
        if (op.answers) working = mergeQuestionAnswers(working, op.node_id, op.answers);
        break;
      }
      case "set_education_card": {
        const node = findNode(working, op.node_id);
        if (!node || node.type !== "question") {
          warnings.push(`set_education_card: ${op.node_id} is not a question`);
          break;
        }
        const card = op.value.trim();
        working = {
          ...working,
          nodes: working.nodes.map((n) =>
            n.id === op.node_id && n.type === "question"
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    education_card_before: card.length > 0 ? card : undefined,
                  },
                }
              : n,
          ),
        };
        break;
      }
      case "add_question": {
        // Anchor: the explicit after_node_id IF it exists, else the last step in
        // the linear run, else the intro. The existence guard matters — `??`
        // only coalesces null/undefined, so a stale/hallucinated after_node_id
        // would otherwise become the anchor and create a dangling edge to a
        // missing node (which still passes Quiz.parse).
        const run = straightThroughRun(working);
        const runTail = run.run.length ? run.run[run.run.length - 1]! : run.head;
        const anchor =
          op.after_node_id && findNode(working, op.after_node_id)
            ? op.after_node_id
            : runTail;
        if (op.after_node_id && !findNode(working, op.after_node_id)) {
          warnings.push(`add_question: anchor ${op.after_node_id} not found — appended to the chain instead`);
        }
        working = insertQuestion(working, anchor, {
          text: op.text,
          question_type: op.question_type,
          answers: op.answers,
        });
        break;
      }
      case "remove_node": {
        const node = findNode(working, op.node_id);
        if (!node) {
          warnings.push(`remove_node: ${op.node_id} not found`);
          break;
        }
        if (node.type === "intro") {
          warnings.push("remove_node: refusing to delete the intro");
          break;
        }
        if (node.type === "result" && working.nodes.filter((n) => n.type === "result").length <= 1) {
          warnings.push("remove_node: refusing to delete the only result page");
          break;
        }
        working = deleteNode(working, op.node_id);
        break;
      }
      case "add_answer": {
        const node = findNode(working, op.node_id);
        if (!node || node.type !== "question") {
          warnings.push(`add_answer: ${op.node_id} is not a question`);
          break;
        }
        const beforeIds = new Set(node.data.answers.map((a) => a.id));
        working = addAnswer(working, op.node_id);
        // Patch the newly appended answer with the AI's text/tags.
        working = {
          ...working,
          nodes: working.nodes.map((n) => {
            if (n.id !== op.node_id || n.type !== "question") return n;
            return {
              ...n,
              data: {
                ...n.data,
                answers: n.data.answers.map((a) =>
                  beforeIds.has(a.id) ? a : { ...a, text: op.text, tags: op.tags },
                ),
              },
            };
          }),
        };
        break;
      }
      case "remove_answer": {
        const node = findNode(working, op.node_id);
        if (!node || node.type !== "question") {
          warnings.push(`remove_answer: ${op.node_id} is not a question`);
          break;
        }
        const next = removeAnswer(working, op.node_id, op.answer_id);
        if (next === working) {
          warnings.push(`remove_answer: could not remove ${op.answer_id} (min answers reached or not found)`);
        }
        working = next;
        break;
      }
      case "reorder_question": {
        if (!findNode(working, op.node_id)) {
          warnings.push(`reorder_question: ${op.node_id} not found`);
          break;
        }
        const next = moveStep(working, op.node_id, op.before_node_id);
        if (next === working) {
          warnings.push(`reorder_question: ${op.node_id} is not in the reorderable run (no change)`);
        }
        working = next;
        break;
      }
    }
  }

  return { doc: working, warnings };
}

// Compact, id-bearing outline of the quiz handed to the AI so its ops can
// reference real node/answer ids. Ordered by the linear chain (intro → run →
// tail) then any remaining nodes, so "the last question" resolves naturally.
export function outlineQuiz(doc: QuizDoc): string {
  const { head, run, tail } = straightThroughRun(doc);
  const ordered = [head, ...run, tail].filter(
    (x): x is string => Boolean(x),
  );
  const seen = new Set(ordered);
  const rest = doc.nodes.map((n) => n.id).filter((id) => !seen.has(id));
  const ids = [...ordered, ...rest];

  const lines: string[] = [];
  for (const id of ids) {
    const node = findNode(doc, id);
    if (!node) continue;
    const d = node.data as Record<string, unknown>;
    const label =
      (typeof d.text === "string" && d.text) ||
      (typeof d.headline === "string" && d.headline) ||
      (typeof d.label === "string" && d.label) ||
      "";
    lines.push(`- [${node.type}] id=${node.id}${label ? ` — "${label}"` : ""}`);
    if (node.type === "question") {
      for (const a of node.data.answers) {
        lines.push(
          `    · answer id=${a.id} "${a.text}"${a.tags.length ? ` (tags: ${a.tags.join(", ")})` : ""}`,
        );
      }
    }
  }
  return lines.join("\n");
}
