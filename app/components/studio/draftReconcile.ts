import { Quiz } from "../../lib/quizSchema";

type QuizDoc = Quiz;
type Json = unknown;

// ───────────────────────────────────────────────────────────────────────────
// Draft reconciliation — the autosave-vs-AI race fix (pure, unit-testable).
//
// The AI studio intents (ai-edit / enrich-reviews / translate-quiz) take a
// multi-second LLM round-trip. While it runs, the merchant can keep typing in
// the builder. The AI returns a WHOLE new doc built on a snapshot taken when the
// request was DISPATCHED; naively adopting it (setDoc) would silently overwrite
// any edit typed during the call — last-write-wins data loss.
//
// `reconcileDraft` is a 3-way merge that re-applies those in-flight edits on top
// of the AI's doc:
//   • base  — the doc the AI was dispatched against (the common ancestor).
//   • ai    — what the AI returned (= base + the AI's changes).
//   • local — the doc NOW (= base + whatever the merchant typed during the call).
//
// Policy (leaf-level): keep the merchant's value IFF they changed it from base;
// otherwise take the AI's value. Objects recurse key-by-key so AI and local
// edits to DIFFERENT fields both survive; a true same-field conflict resolves to
// LOCAL (we never silently drop a keystroke — that's the whole point). Arrays
// are treated as leaves (replaced whole) — answer lists, tag lists, stage lists
// merge at array granularity, which is safe and avoids fragile element splicing.
//
// Graph integrity: `edges` are taken verbatim from the AI doc and `nodes` are
// matched by id (local content edits overlaid onto the nodes the AI kept), so
// the result can never strand an edge or invent a node the graph doesn't wire.
// Structural edits made locally during a call (adding/deleting a node) are the
// rare case and defer to the AI's structure — fail-safe, never corrupting.
// ───────────────────────────────────────────────────────────────────────────

function isPlainObject(v: Json): v is Record<string, Json> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Structural equality over JSON values (the doc is plain JSON). Used to decide
// whether the merchant changed a leaf relative to the common ancestor.
function deepEqual(a: Json, b: Json): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    return ak.length === bk.length && ak.every((k) => k in b && deepEqual(a[k], b[k]));
  }
  return false;
}

// 3-way merge of a single value. Plain objects recurse (per-key); everything
// else (primitives, arrays, type mismatches, present/absent) is a leaf resolved
// by the protect-local rule below.
function mergeValue(base: Json, ai: Json, local: Json): Json {
  if (isPlainObject(ai) && isPlainObject(local)) {
    const b = isPlainObject(base) ? base : {};
    const out: Record<string, Json> = {};
    for (const k of new Set([...Object.keys(ai), ...Object.keys(local)])) {
      const merged = mergeValue(b[k], ai[k], local[k]);
      // undefined ⇒ the key was dropped by the winning side; omit it (and let
      // JSON serialization / the schema's optionals handle the absence).
      if (merged !== undefined) out[k] = merged;
    }
    return out;
  }
  // Leaf: keep the merchant's value only if they actually changed it from the
  // base the AI also started from; otherwise take whatever the AI produced.
  return deepEqual(local, base) ? ai : local;
}

function nodeId(n: Json): string | null {
  return isPlainObject(n) && typeof n.id === "string" ? n.id : null;
}

// Overlay the merchant's in-flight content edits onto the AI's node list,
// matched by id. The AI owns node STRUCTURE (which nodes exist, in what order);
// for every node it kept that the merchant also still has, we 3-way merge the
// node's fields so a headline typed during the call survives a reworded subtext.
function mergeNodesById(baseNodes: Json[], aiNodes: Json[], localNodes: Json[]): Json[] {
  const baseById = new Map<string, Json>();
  for (const n of baseNodes) {
    const id = nodeId(n);
    if (id) baseById.set(id, n);
  }
  const localById = new Map<string, Json>();
  for (const n of localNodes) {
    const id = nodeId(n);
    if (id) localById.set(id, n);
  }
  return aiNodes.map((aiNode) => {
    const id = nodeId(aiNode);
    if (!id) return aiNode;
    const local = localById.get(id);
    if (local === undefined) return aiNode; // AI-added, or locally deleted → AI wins
    // Use the common ancestor when we have it; fall back to the AI node so an
    // unexpectedly-missing base degrades to "prefer local where it differs".
    return mergeValue(baseById.get(id) ?? aiNode, aiNode, local);
  });
}

/**
 * Merge edits the merchant typed DURING an AI call (`local`, relative to the
 * dispatch snapshot `base`) on top of the doc the AI returned (`ai`). The result
 * is always a valid Quiz: it starts from the AI doc's structure + edges, only
 * overlays scalar/leaf content, and is re-validated with `Quiz.safeParse` —
 * falling back to the (already-valid) AI doc if the merge somehow parsed dirty.
 */
export function reconcileDraft(base: QuizDoc, ai: QuizDoc, local: QuizDoc): QuizDoc {
  const merged = mergeValue(base, ai, local) as Record<string, Json>;
  const result = {
    ...merged,
    // Graph structure is the AI's; only overlay local content onto kept nodes.
    nodes: mergeNodesById(base.nodes as Json[], ai.nodes as Json[], local.nodes as Json[]),
    edges: ai.edges,
  };
  const parsed = Quiz.safeParse(result);
  return parsed.success ? parsed.data : ai;
}
