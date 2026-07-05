import type { ContentBlock, ContentBlockType, Quiz, QuizNode } from "../../lib/quizSchema";
import {
  addAskAINode,
  addBranchNode,
  addEmailGateNode,
  addEndNode,
  addIntegrationNode,
  addMessageNode,
  addProductCardsNode,
  addQuestionNode,
  addResultNode,
} from "../../lib/quizMutations";

type QuizDoc = Quiz;

// ───────────────────────────────────────────────────────────────────────────
// Pure doc helpers for the Studio builder. All return a NEW doc (immutable),
// matching the quizMutations convention. No React/prisma — easy to reason about
// and reuse from the route + the rail tabs.
// ───────────────────────────────────────────────────────────────────────────

export type InsertKind =
  | "question"
  | "message"
  | "branch"
  | "email_gate"
  | "ask_ai"
  | "product_cards"
  | "integration"
  | "result"
  | "end";

export interface ModuleMeta {
  kind: InsertKind;
  label: string;
  glyph: string;
  hint: string;
}

// Templated insertion palette (mirrors the canvas ModulePicker, Studio-styled).
export const INSERTABLE_MODULES: ModuleMeta[] = [
  { kind: "question", label: "Question", glyph: "?", hint: "Ask the shopper something" },
  { kind: "message", label: "Message", glyph: "“", hint: "A chat-style note" },
  { kind: "branch", label: "Branch", glyph: "⑂", hint: "Route by answer or A/B split" },
  { kind: "email_gate", label: "Email gate", glyph: "✉", hint: "Capture an email before results" },
  { kind: "ask_ai", label: "Ask AI", glyph: "✶", hint: "Conversational follow-up" },
  { kind: "product_cards", label: "Products", glyph: "▦", hint: "Showcase picked products" },
  { kind: "integration", label: "Integration", glyph: "⇄", hint: "Fire a webhook / Klaviyo" },
  { kind: "result", label: "Result", glyph: "★", hint: "Recommendations page" },
  { kind: "end", label: "End", glyph: "■", hint: "Thank-you / redirect" },
];

// Insert a module after an anchor (optionally off a specific source handle) and
// return the new doc + the freshly created node id (last node in the array,
// matching the canvas convention).
export function insertModule(
  doc: QuizDoc,
  kind: InsertKind,
  anchorId: string | null,
  anchorHandle: string | undefined,
  fallbackCollectionId: string,
): { doc: QuizDoc; newNodeId: string | null } {
  // SPLICE, don't dead-end: capture the anchor's existing successor edge so we
  // can re-route it through the new node (anchor → new → next) instead of
  // leaving the new node a dead-end and orphaning the old successor. Match the
  // specific handle when inserting off a branch slot; otherwise the anchor's
  // default (handle-less) outgoing edge.
  const successorEdge =
    anchorId != null
      ? doc.edges.find((e) =>
          e.source === anchorId &&
          (anchorHandle ? e.source_handle === anchorHandle : !e.source_handle),
        )
      : undefined;

  let next: QuizDoc;
  switch (kind) {
    case "question":
      next = addQuestionNode(doc, anchorId, anchorHandle);
      break;
    case "message":
      next = addMessageNode(doc, anchorId, anchorHandle);
      break;
    case "branch":
      next = addBranchNode(doc, anchorId, anchorHandle);
      break;
    case "email_gate":
      next = addEmailGateNode(doc, anchorId, anchorHandle);
      break;
    case "ask_ai":
      next = addAskAINode(doc, anchorId, anchorHandle);
      break;
    case "product_cards":
      next = addProductCardsNode(doc, anchorId, anchorHandle);
      break;
    case "integration":
      next = addIntegrationNode(doc, anchorId, anchorHandle);
      break;
    case "end":
      next = addEndNode(doc, anchorId, anchorHandle);
      break;
    case "result":
      next = addResultNode(doc, anchorId, fallbackCollectionId, anchorHandle);
      break;
  }
  const newNodeId = next.nodes[next.nodes.length - 1]?.id ?? null;

  // Re-route the captured successor edge to start from the new node, so the
  // chain becomes anchor → new → next (no dead-end, no orphan). The handle
  // belonged to the anchor's slot, so it's dropped on the new node's default
  // outgoing edge.
  if (newNodeId && successorEdge) {
    next = {
      ...next,
      edges: next.edges.map((e) =>
        e.id === successorEdge.id
          ? { id: e.id, source: newNodeId, target: e.target }
          : e,
      ),
    };
  }

  return { doc: next, newNodeId };
}

// ── BLD-2 — inline canvas text editing ───────────────────────────────────────
// The inspect system tags every editable element with a typed InspectTarget;
// double-clicking the SELECTED element turns it contenteditable (builder-side
// DOM only — zero runtime changes) and the committed text lands here. Only
// parts whose DISPLAYED text is exactly the stored field are editable inline:
// answers render `${icon} ${text}` composites, message_text resolves merge
// tags, education cards are multi-field — those keep panel-only editing.
export const INLINE_EDITABLE_PARTS: ReadonlySet<string> = new Set([
  "headline",
  "subtext",
  "cta",
  "question_text",
  "end_headline",
  "end_subtext",
  "email_headline",
  "email_subtext",
  "result_headline",
  "result_subtext",
  "pc_headline",
  "pc_subtext",
  "askai_persona",
]);

// InspectPart → the node-data field the runtime renders for it (verified
// against each QuizRuntime call site).
const INSPECT_TEXT_FIELD: Record<string, string> = {
  headline: "headline",
  end_headline: "headline",
  email_headline: "headline",
  result_headline: "headline",
  pc_headline: "headline",
  subtext: "subtext",
  end_subtext: "subtext",
  email_subtext: "subtext",
  result_subtext: "subtext",
  pc_subtext: "subtext",
  cta: "button_label",
  question_text: "text",
  askai_persona: "persona_name",
};

/** Write inline-edited text back to the field the canvas rendered it from.
 *  Unknown/excluded parts return the doc unchanged (defensive no-op). */
export function applyInspectText(
  doc: QuizDoc,
  target: { nodeId: string; part: string },
  text: string,
): QuizDoc {
  const field = INSPECT_TEXT_FIELD[target.part];
  if (!field) return doc;
  return updateNodeData(doc, target.nodeId, { [field]: text });
}

// Shallow-merge a patch into a node's data (immutable).
export function updateNodeData(
  doc: QuizDoc,
  nodeId: string,
  patch: Record<string, unknown>,
): QuizDoc {
  return {
    ...doc,
    nodes: doc.nodes.map((n) =>
      n.id === nodeId ? ({ ...n, data: { ...n.data, ...patch } } as QuizNode) : n,
    ),
  };
}

// ── node_layouts ────────────────────────────────────────────────────────────
export function setNodeLayout(
  doc: QuizDoc,
  nodeId: string,
  blocks: ContentBlock[] | null,
): QuizDoc {
  const next = { ...doc.node_layouts };
  if (!blocks || blocks.length === 0) delete next[nodeId];
  else next[nodeId] = blocks;
  return { ...doc, node_layouts: next };
}

export function getNodeLayout(doc: QuizDoc, nodeId: string): ContentBlock[] | undefined {
  return doc.node_layouts[nodeId];
}

// ── node_css ─────────────────────────────────────────────────────────────────
export function setNodeCss(doc: QuizDoc, nodeId: string, css: string): QuizDoc {
  const next = { ...doc.node_css };
  if (!css.trim()) delete next[nodeId];
  else next[nodeId] = css;
  return { ...doc, node_css: next };
}

// ── block list helpers (operate on a ContentBlock[]) ─────────────────────────
function uid(): string {
  return `b_${Math.random().toString(36).slice(2, 10)}`;
}

export const PALETTE_BLOCKS: { type: ContentBlockType; label: string; glyph: string }[] = [
  { type: "heading", label: "Heading", glyph: "H" },
  { type: "text", label: "Text", glyph: "¶" },
  { type: "image", label: "Image", glyph: "▣" },
  { type: "button", label: "Button", glyph: "⬚" },
  { type: "spacer", label: "Spacer", glyph: "↕" },
  { type: "divider", label: "Divider", glyph: "—" },
  { type: "answers", label: "Answers", glyph: "☰" },
  { type: "recommendations", label: "Recommendations", glyph: "★" },
  { type: "email_input", label: "Email field", glyph: "✉" },
  { type: "ai_chat", label: "AI chat", glyph: "✶" },
  { type: "product_grid", label: "Product grid", glyph: "▦" },
];

export function makeBlock(type: ContentBlockType): ContentBlock {
  const base = { id: uid(), style: {} as Record<string, never> };
  switch (type) {
    case "heading":
      return { ...base, type, level: "h2", bind: "none", text: "Heading" };
    case "text":
      return { ...base, type, bind: "none", text: "Text", supports_merge_tags: false };
    case "image":
      return { ...base, type, bind: "none", alt: "", fit: "cover", aspect: "auto" };
    case "spacer":
      return { ...base, type, size: 24 };
    case "divider":
      return { ...base, type, thickness: 1 };
    case "button":
      return { ...base, type, bind: "none", label: "Continue", variant: "primary" };
    case "answers":
      return { ...base, type, layout: "auto" };
    case "recommendations":
      return { ...base, type, stage: "all" };
    case "email_input":
      return { ...base, type };
    case "ai_chat":
      return { ...base, type };
    case "product_grid":
      return { ...base, type };
  }
}

export function blockUpdate(
  blocks: ContentBlock[],
  blockId: string,
  patch: Partial<ContentBlock>,
): ContentBlock[] {
  return blocks.map((b) => (b.id === blockId ? ({ ...b, ...patch } as ContentBlock) : b));
}

export function blockMove(blocks: ContentBlock[], blockId: string, dir: -1 | 1): ContentBlock[] {
  const i = blocks.findIndex((b) => b.id === blockId);
  if (i < 0) return blocks;
  const j = i + dir;
  if (j < 0 || j >= blocks.length) return blocks;
  const next = blocks.slice();
  const tmp = next[i]!;
  next[i] = next[j]!;
  next[j] = tmp;
  return next;
}

export function blockRemove(blocks: ContentBlock[], blockId: string): ContentBlock[] {
  return blocks.filter((b) => b.id !== blockId);
}

export function blockAdd(blocks: ContentBlock[], block: ContentBlock): ContentBlock[] {
  return [...blocks, block];
}
