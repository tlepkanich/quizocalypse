import { z } from "zod";
import { ImageBlock, isFreeformType, type Quiz } from "./quizSchema";
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
import { setDesignLayer } from "./designLayers";
import { synthesizeLayout } from "./synthesizeLayout";

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

// ── Unified P5 vocabulary ────────────────────────────────────────────────────
// Every question type the panel's Type select offers.
const QUESTION_TYPES = [
  "single_select",
  "multi_select",
  "dropdown",
  "image_tile",
  "image_picker",
  "rating",
  "swatch",
  "numeric",
  "date",
  "slider",
  "searchable",
  "text",
  "email",
] as const;

// Per-node-type writable content fields — mirrors the ContentTab panel. An op
// naming a field outside its node's list is skipped with a warning.
const NODE_FIELDS: Record<string, readonly string[]> = {
  intro: ["headline", "subtext", "button_label", "hero_image_url"],
  question: ["text", "section_label", "helper_text"],
  email_gate: ["headline", "subtext"],
  result: ["headline", "subtext", "cta_label", "escape_hatch_label", "escape_hatch_url"],
  message: ["text"],
  end: ["headline", "subtext", "cta_label", "cta_url"],
  ask_ai: ["persona_name", "opening_message", "system_prompt"],
  product_cards: ["headline", "subtext", "cta_label"],
  branch: ["label"],
  integration: ["label"],
};
const NODE_FIELD_NAMES = [
  "headline",
  "subtext",
  "button_label",
  "hero_image_url",
  "text",
  "cta_label",
  "cta_url",
  "persona_name",
  "opening_message",
  "system_prompt",
  "label",
  // Experiences E7.
  "section_label",
  "helper_text",
  "escape_hatch_label",
  "escape_hatch_url",
] as const;
// Fields that must be https URLs (empty clears).
const URL_FIELDS = new Set(["hero_image_url", "cta_url", "escape_hatch_url"]);

const HEX_COLOR = z.string().regex(/^#[0-9a-fA-F]{3,8}$/, "hex color");

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
  // Editor revamp P6 — AI parity with the InspectorPanel's flexible-widget
  // controls. Set/clear an answer's emoji icon ("give every answer a fitting
  // emoji"). Empty icon clears it.
  z.object({
    op: z.literal("set_answer_icon"),
    node_id: z.string().min(1),
    answer_id: z.string().min(1),
    icon: z.string().max(16),
  }),
  // Set/clear an answer's image (renders on image_tile/image_picker/swatch).
  // https-only — enforced at apply so a bad URL becomes a warning, not a write.
  z.object({
    op: z.literal("set_answer_image"),
    node_id: z.string().min(1),
    answer_id: z.string().min(1),
    image_url: z.string(),
  }),
  // Explicit answer-grid columns (1 or 2; 0 restores the responsive default).
  z.object({
    op: z.literal("set_answer_columns"),
    node_id: z.string().min(1),
    columns: z.number().int().min(0).max(2),
  }),
  // ── Unified P5 — full panel parity ────────────────────────────────────────
  // Switch a question's type. Freeform→card switches are guarded at apply
  // (cards need ≥2 answers).
  z.object({
    op: z.literal("set_question_type"),
    node_id: z.string().min(1),
    question_type: z.enum(QUESTION_TYPES),
  }),
  // Multi-select pick constraints (omit a bound to clear it).
  z.object({
    op: z.literal("set_selections"),
    node_id: z.string().min(1),
    min: z.number().int().min(1).optional(),
    max: z.number().int().min(1).optional(),
  }),
  // Set any whitelisted content field on any node type (the superset of
  // set_text — per-type validity enforced at apply; URL fields https-only).
  z.object({
    op: z.literal("set_node_field"),
    node_id: z.string().min(1),
    field: z.enum(NODE_FIELD_NAMES),
    value: z.string(),
  }),
  // Quiz/node feature flags. collect_phone needs node_id (an email_gate).
  z.object({
    op: z.literal("set_flag"),
    flag: z.enum([
      "collect_email_on_result",
      "result_split",
      "collect_phone",
      // Experiences E7 — the shopper-theater flags.
      "show_recap",
      "show_match_reasons",
      "computing_reveal",
    ]),
    value: z.boolean(),
    node_id: z.string().min(1).optional(),
  }),
  // Insert a non-question step into the chain (questions go via add_question).
  z.object({
    op: z.literal("add_node"),
    type: z.enum(["message", "email_gate", "end"]),
    after_node_id: z.string().min(1).optional(),
    headline: z.string().optional(),
    text: z.string().optional(),
  }),
  // Per-node design within a tight whitelist (hex colors / radius / button
  // style on a layer) — the AI still never authors raw token packs.
  z.object({
    op: z.literal("set_node_design"),
    node_id: z.string().min(1),
    layer: z.enum(["synced", "desktop", "mobile"]).default("synced"),
    colors: z
      .object({
        primary: HEX_COLOR.optional(),
        background: HEX_COLOR.optional(),
        text: HEX_COLOR.optional(),
      })
      .optional(),
    radius: z.enum(["square", "rounded", "pill"]).optional(),
    button_style: z.enum(["filled", "outline", "ghost"]).optional(),
  }),
  // "Show a picture on this page" — place an image block above/below the
  // step's content (breaks the step into blocks if it's still on-template).
  z.object({
    op: z.literal("add_image_block"),
    node_id: z.string().min(1),
    placement: z.enum(["above", "below"]),
    image_url: z.string().optional(),
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
      case "set_answer_icon":
      case "set_answer_image": {
        const node = findNode(working, op.node_id);
        if (!node || node.type !== "question") {
          warnings.push(`${op.op}: ${op.node_id} is not a question`);
          break;
        }
        if (!node.data.answers.some((a) => a.id === op.answer_id)) {
          warnings.push(`${op.op}: answer ${op.answer_id} not found on ${op.node_id}`);
          break;
        }
        let patch: { icon?: string | undefined } | { image_url?: string | undefined };
        if (op.op === "set_answer_icon") {
          patch = { icon: op.icon.trim() || undefined };
        } else {
          const url = op.image_url.trim();
          if (url && !/^https:\/\//.test(url)) {
            warnings.push(`set_answer_image: only https URLs are allowed`);
            break;
          }
          patch = { image_url: url || undefined };
        }
        working = {
          ...working,
          nodes: working.nodes.map((n) =>
            n.id === op.node_id && n.type === "question"
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    answers: n.data.answers.map((a) =>
                      a.id === op.answer_id ? { ...a, ...patch } : a,
                    ),
                  },
                }
              : n,
          ),
        };
        break;
      }
      case "set_answer_columns": {
        const node = findNode(working, op.node_id);
        if (!node || node.type !== "question") {
          warnings.push(`set_answer_columns: ${op.node_id} is not a question`);
          break;
        }
        working = {
          ...working,
          nodes: working.nodes.map((n) =>
            n.id === op.node_id && n.type === "question"
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    answer_columns: op.columns === 0 ? undefined : (op.columns as 1 | 2),
                  },
                }
              : n,
          ),
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
      // ── Unified P5 cases ────────────────────────────────────────────────
      case "set_question_type": {
        const node = findNode(working, op.node_id);
        if (!node || node.type !== "question") {
          warnings.push(`set_question_type: ${op.node_id} is not a question`);
          break;
        }
        // Card-style types render answer choices; switching INTO one needs
        // at least 2 answers to render anything selectable.
        if (!isFreeformType(op.question_type) && node.data.answers.length < 2) {
          warnings.push(
            `set_question_type: "${op.question_type}" needs at least 2 answers — add answers first`,
          );
          break;
        }
        working = {
          ...working,
          nodes: working.nodes.map((n) =>
            n.id === op.node_id && n.type === "question"
              ? { ...n, data: { ...n.data, question_type: op.question_type } }
              : n,
          ),
        };
        break;
      }
      case "set_selections": {
        const node = findNode(working, op.node_id);
        if (!node || node.type !== "question") {
          warnings.push(`set_selections: ${op.node_id} is not a question`);
          break;
        }
        if (node.data.question_type !== "multi_select") {
          warnings.push(`set_selections: ${op.node_id} is not multi_select`);
          break;
        }
        if (op.min !== undefined && op.max !== undefined && op.min > op.max) {
          warnings.push(`set_selections: min ${op.min} > max ${op.max} — skipped`);
          break;
        }
        working = {
          ...working,
          nodes: working.nodes.map((n) =>
            n.id === op.node_id && n.type === "question"
              ? { ...n, data: { ...n.data, min_selections: op.min, max_selections: op.max } }
              : n,
          ),
        };
        break;
      }
      case "set_node_field": {
        const node = findNode(working, op.node_id);
        if (!node) {
          warnings.push(`set_node_field: node ${op.node_id} not found`);
          break;
        }
        const allowed = NODE_FIELDS[node.type] ?? [];
        if (!allowed.includes(op.field)) {
          warnings.push(`set_node_field: ${node.type} has no editable "${op.field}"`);
          break;
        }
        let value: string | undefined = op.value;
        if (URL_FIELDS.has(op.field)) {
          const url = op.value.trim();
          if (url && !/^https:\/\//.test(url)) {
            warnings.push(`set_node_field: ${op.field} must be an https URL`);
            break;
          }
          value = url || undefined;
        }
        // E7: the escape-hatch pair writes into result.data.escape_hatch
        // (both parts required for the link to render; clearing the URL
        // clears the hatch).
        if (op.field === "escape_hatch_label" || op.field === "escape_hatch_url") {
          working = {
            ...working,
            nodes: working.nodes.map((n) => {
              if (n.id !== op.node_id || n.type !== "result") return n;
              const cur = n.data.escape_hatch ?? { label: "Talk to a human", url: "" };
              const next =
                op.field === "escape_hatch_label"
                  ? { ...cur, label: value ?? "" }
                  : { ...cur, url: value ?? "" };
              const cleared = !next.label && !next.url;
              return {
                ...n,
                data: { ...n.data, escape_hatch: cleared ? undefined : next },
              } as typeof n;
            }),
          };
          break;
        }
        working = {
          ...working,
          nodes: working.nodes.map((n) =>
            n.id === op.node_id
              ? ({ ...n, data: { ...n.data, [op.field]: value } } as typeof n)
              : n,
          ),
        };
        break;
      }
      case "set_flag": {
        if (op.flag === "collect_email_on_result") {
          working = { ...working, collect_email_on_result: op.value };
        } else if (op.flag === "show_recap") {
          working = { ...working, show_recap: op.value };
        } else if (op.flag === "show_match_reasons") {
          working = { ...working, show_match_reasons: op.value };
        } else if (op.flag === "computing_reveal") {
          working = { ...working, results_reveal: op.value ? "computing" : undefined };
        } else if (op.flag === "result_split") {
          working = {
            ...working,
            design_tokens: { ...working.design_tokens, result_split: op.value },
          };
        } else {
          // collect_phone lives on an email_gate node.
          const node = op.node_id ? findNode(working, op.node_id) : null;
          const gate =
            node?.type === "email_gate"
              ? node
              : working.nodes.find((n) => n.type === "email_gate");
          if (!gate) {
            warnings.push("set_flag: collect_phone needs an email gate step");
            break;
          }
          working = {
            ...working,
            nodes: working.nodes.map((n) =>
              n.id === gate.id && n.type === "email_gate"
                ? { ...n, data: { ...n.data, collect_phone: op.value } }
                : n,
            ),
          };
        }
        break;
      }
      case "add_node": {
        const run = straightThroughRun(working);
        const runTail = run.run.length ? run.run[run.run.length - 1]! : run.head;
        const anchor =
          op.after_node_id && findNode(working, op.after_node_id)
            ? op.after_node_id
            : runTail;
        if (op.after_node_id && !findNode(working, op.after_node_id)) {
          warnings.push(`add_node: anchor ${op.after_node_id} not found — appended instead`);
        }
        const data =
          op.type === "message"
            ? { text: op.text || op.headline || "A quick note before we continue." }
            : op.type === "email_gate"
              ? {
                  headline: op.headline || "Where should we send your results?",
                  subtext: op.text || "",
                }
              : {
                  headline: op.headline || "Thanks for taking the quiz!",
                  subtext: op.text || "",
                };
        working = insertStep(working, anchor, op.type, data);
        break;
      }
      case "set_node_design": {
        const node = findNode(working, op.node_id);
        if (!node) {
          warnings.push(`set_node_design: node ${op.node_id} not found`);
          break;
        }
        const patch = {
          ...(op.colors ? { colors: op.colors } : {}),
          ...(op.radius ? { radius: op.radius } : {}),
          ...(op.button_style ? { button_style: op.button_style } : {}),
        };
        if (Object.keys(patch).length === 0) {
          warnings.push("set_node_design: empty patch — nothing to apply");
          break;
        }
        working = setDesignLayer(working, op.node_id, op.layer, patch);
        break;
      }
      case "add_image_block": {
        const node = findNode(working, op.node_id);
        if (!node) {
          warnings.push(`add_image_block: node ${op.node_id} not found`);
          break;
        }
        if (node.type === "branch" || node.type === "integration") {
          warnings.push(`add_image_block: ${node.type} steps are invisible to shoppers`);
          break;
        }
        const url = op.image_url?.trim();
        if (url && !/^https:\/\//.test(url)) {
          warnings.push("add_image_block: only https image URLs are allowed");
          break;
        }
        // Existing custom layout, or synthesize from the template (the same
        // "break into blocks" path the panel's Layout tab uses).
        const blocks = working.node_layouts[op.node_id] ?? synthesizeLayout(node);
        if (!blocks) {
          warnings.push(`add_image_block: ${node.type} has no composable layout`);
          break;
        }
        const img = ImageBlock.parse({
          id: uid("blk"),
          type: "image",
          ...(url ? { url } : {}),
        });
        working = {
          ...working,
          node_layouts: {
            ...working.node_layouts,
            [op.node_id]: op.placement === "above" ? [img, ...blocks] : [...blocks, img],
          },
        };
        break;
      }
    }
  }

  return { doc: working, warnings };
}

// Insert a non-question step after `anchorId` with the chain spliced through
// it (anchor → new → anchor's old successor) — the insertQuestion pattern,
// generalized for the add_node op.
function insertStep(
  doc: QuizDoc,
  anchorId: string | null,
  type: "message" | "email_gate" | "end",
  data: Record<string, unknown>,
): QuizDoc {
  const newId = uid("n");
  const anchor = anchorId ? doc.nodes.find((n) => n.id === anchorId) : null;
  const position = anchor
    ? { x: anchor.position.x + 220, y: anchor.position.y }
    : { x: 0, y: 0 };
  let next: QuizDoc = {
    ...doc,
    nodes: [
      ...doc.nodes,
      { id: newId, type, position, data } as QuizDoc["nodes"][number],
    ],
  };
  if (anchorId) {
    const succ = doc.edges.find((e) => e.source === anchorId && !e.source_handle);
    next = {
      ...next,
      edges: [
        ...next.edges.filter((e) => e.id !== succ?.id),
        { id: uid("e"), source: anchorId, target: newId },
        ...(succ ? [{ id: uid("e"), source: newId, target: succ.target }] : []),
      ],
    };
  }
  return next;
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
    // Unified P5: surface the question type + pick bounds so the AI can use
    // set_question_type / set_selections accurately.
    const meta =
      node.type === "question"
        ? ` (type=${node.data.question_type}${
            node.data.min_selections ? ` min=${node.data.min_selections}` : ""
          }${node.data.max_selections ? ` max=${node.data.max_selections}` : ""})`
        : "";
    lines.push(`- [${node.type}] id=${node.id}${meta}${label ? ` — "${label}"` : ""}`);
    if (node.type === "question") {
      for (const a of node.data.answers) {
        lines.push(
          `    · answer id=${a.id} "${a.text}"${a.tags.length ? ` (tags: ${a.tags.join(", ")})` : ""}`,
        );
      }
    }
  }
  // Quiz-level flags the set_flag op can toggle.
  lines.push(
    `- flags: collect_email_on_result=${doc.collect_email_on_result ?? false}, result_split=${doc.design_tokens?.result_split ?? false}`,
  );
  return lines.join("\n");
}
