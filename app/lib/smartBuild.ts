import type { Quiz as QuizDoc, QuestionType, MatchLadderStrategy } from "./quizSchema";
import { seedPointsFromCategories } from "./quizGenSettings";

// ───────────────────────────────────────────────────────────────────────────
// Smart Build merge (product-first AI question generation, Studio Step 4).
//
// `applyQuestionFlow` takes a quiz that already has an intro + one result node
// per bucket (created by reconcileBucketsToResultNodes) and the AI's id-less
// question specs, and deterministically wires the question flow + a routing
// branch so shoppers land on the right bucket page. Pure + idempotent: every
// Smart-Build-owned node carries an `sb_` id prefix, so re-running strips the
// prior flow and rebuilds — manual nodes (q_/br_ … from quizMutations) and the
// intro/result nodes are never touched. No storefront-engine changes: routing
// rides on the existing branch + edge-condition (tag) + points mechanisms.
// ───────────────────────────────────────────────────────────────────────────

type QuizNode = QuizDoc["nodes"][number];
type QuizEdge = QuizDoc["edges"][number];

const SB = "sb_";
const isSb = (id: string): boolean => id.startsWith(SB);
const rid = (p: string): string => `sb_${p}_${Math.random().toString(36).slice(2, 10)}`;

export interface GeneratedAnswerSpec {
  text: string;
  tags: string[];
  collection_filter?: string;
  image_url?: string;
}
export interface GeneratedQuestionSpec {
  text: string;
  question_type: QuestionType;
  required?: boolean;
  max_selections?: number;
  answers: GeneratedAnswerSpec[];
}
export interface GeneratedQuestionFlow {
  questions: GeneratedQuestionSpec[];
  welcome_message?: { text: string };
  email_gate?: { headline: string; subtext: string };
}
export interface SmartBuildBucket {
  id: string; // category id
  name: string;
  tags: string[];
  resultNodeId: string;
}

export function applyQuestionFlow(
  doc: QuizDoc,
  generated: GeneratedQuestionFlow,
  buckets: SmartBuildBucket[],
): QuizDoc {
  const intro = doc.nodes.find((n) => n.type === "intro");
  const introId = intro?.id ?? null;
  const resultIds = new Set(
    doc.nodes.filter((n) => n.type === "result").map((n) => n.id),
  );

  // 1. Strip prior Smart Build nodes. 2. Drop edges touching stripped nodes,
  // intro's outbound, and any inbound-to-result (we re-wire the whole chain
  // through the branch). Manual middle-node edges survive.
  const nodes: QuizNode[] = doc.nodes.filter((n) => !isSb(n.id));
  const edges: QuizEdge[] = doc.edges.filter((e) => {
    if (isSb(e.source) || isSb(e.target)) return false;
    if (introId && e.source === introId) return false;
    if (resultIds.has(e.target)) return false;
    return true;
  });

  const baseX = intro?.position.x ?? 0;
  const y = intro?.position.y ?? 0;
  let col = 1;
  const xAt = (c: number) => baseX + c * 320;

  let prevId: string | null = introId;
  const connect = (targetId: string) => {
    if (prevId) edges.push({ id: rid("e"), source: prevId, target: targetId });
    prevId = targetId;
  };

  // 3. Linear chain: intro → [welcome] → q1…qN → [email] → branch
  if (generated.welcome_message) {
    const id = rid("m");
    nodes.push({
      id,
      type: "message",
      position: { x: xAt(col++), y },
      data: { text: generated.welcome_message.text, supports_merge_tags: true },
    } as QuizNode);
    connect(id);
  }

  generated.questions.forEach((q, i) => {
    const id = `sb_q_${i + 1}`;
    const answers = q.answers.map((a) => ({
      id: rid("a"),
      text: a.text,
      tags: a.tags,
      edge_handle_id: rid("h"),
      ...(a.collection_filter ? { collection_filter: a.collection_filter } : {}),
      ...(a.image_url ? { image_url: a.image_url } : {}),
    }));
    nodes.push({
      id,
      type: "question",
      position: { x: xAt(col++), y },
      data: {
        text: q.text,
        question_type: q.question_type,
        required: q.required ?? true,
        ...(q.max_selections !== undefined ? { max_selections: q.max_selections } : {}),
        answers,
        show_preview_after: false,
      },
    } as QuizNode);
    connect(id);
  });

  if (generated.email_gate) {
    const id = rid("eg");
    nodes.push({
      id,
      type: "email_gate",
      position: { x: xAt(col++), y },
      data: {
        headline: generated.email_gate.headline,
        subtext: generated.email_gate.subtext,
        email_required: true,
        name_optional: true,
        skip_allowed: false,
      },
    } as QuizNode);
    connect(id);
  }

  // 4. Routing branch: one slot per bucket (conditioned on a dominant tag) +
  // an unconditioned default catch-all (last, so conditioned slots win).
  // Collect the EXACT answer-tag strings (runtime accumulatedTags are the
  // answers' original-case tags), so a slot condition is guaranteed to match.
  const answerTagList: string[] = [];
  for (const q of generated.questions)
    for (const a of q.answers) for (const t of a.tags) answerTagList.push(t);
  const dominantTag = (b: SmartBuildBucket): string | null => {
    const lc = new Set(b.tags.map((t) => t.toLowerCase()));
    for (const at of answerTagList) if (lc.has(at.toLowerCase())) return at;
    return b.tags[0] ?? null;
  };

  const branchId = "sb_br";
  const slots = buckets.map((b, i) => ({
    id: `sb_sl_${i + 1}`,
    label: b.name || `Bucket ${i + 1}`,
    weight: 1,
  }));
  slots.push({ id: "sb_sl_default", label: "Other", weight: 1 });
  nodes.push({
    id: branchId,
    type: "branch",
    position: { x: xAt(col++), y },
    data: { label: "Route to result", mode: "rules", slots },
  } as QuizNode);
  connect(branchId);

  buckets.forEach((b, i) => {
    const tag = dominantTag(b);
    edges.push({
      id: rid("e"),
      source: branchId,
      target: b.resultNodeId,
      source_handle: `sb_sl_${i + 1}`,
      ...(tag ? { condition: { tag } } : {}),
    });
  });
  const defaultTarget = buckets[0]?.resultNodeId;
  if (defaultTarget) {
    edges.push({
      id: rid("e"),
      source: branchId,
      target: defaultTarget,
      source_handle: "sb_sl_default",
    });
  }

  // 5. Seed answer points from bucket-tag overlap (shared with the wizard).
  const seededNodes = seedPointsFromCategories(
    nodes,
    buckets.map((b) => ({ id: b.id, tags: b.tags })),
  );

  // 6. Each bucket result resolves products by category, then points fallback.
  const finalNodes = seededNodes.map((n) => {
    if (n.type !== "result") return n;
    const ladder: MatchLadderStrategy[] = [...n.data.match_ladder];
    if (!ladder.includes("category")) ladder.unshift("category");
    if (!ladder.includes("points")) ladder.push("points");
    return { ...n, data: { ...n.data, match_ladder: ladder } };
  });

  return { ...doc, nodes: finalNodes, edges };
}
