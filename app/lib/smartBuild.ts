import type { Quiz as QuizDoc, QuestionType, MatchLadderStrategy } from "./quizSchema";
import { seedPointsFromCategories } from "./categoryScoring";

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
  // Optional one-line teaching card shown before this question (Dev Spec §6).
  // At most ONE across the quiz is honored — applyQuestionFlow enforces it.
  education_card_before?: string;
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

  // Smart Build OWNS the question flow + routing, so rebuild the whole thing.
  // Strip every question + branch node (any prefix) and all prior Smart Build
  // output (sb_). Keep the intro, every result page, and any manual CONTENT
  // steps (message / email_gate / ask_ai / end / integration / product_cards),
  // re-threading them so nothing is stranded. Re-running is idempotent and
  // never leaves old/template questions as unreachable steps.
  const removedIds = new Set<string>();
  for (const n of doc.nodes) {
    if (n.type === "question" || n.type === "branch" || isSb(n.id)) removedIds.add(n.id);
  }
  const nodes: QuizNode[] = doc.nodes.filter((n) => !removedIds.has(n.id));
  // The entire flow is regenerated, so start from no edges and re-wire below.
  const edges: QuizEdge[] = [];
  // Manual content steps to keep reachable (intro/results are anchored below).
  const keptContent = nodes.filter((n) => n.type !== "intro" && n.type !== "result");

  const baseX = intro?.position.x ?? 0;
  const y = intro?.position.y ?? 0;
  let col = 1;
  const xAt = (c: number) => baseX + c * 320;

  let prevId: string | null = introId;
  const connect = (targetId: string) => {
    if (prevId) edges.push({ id: rid("e"), source: prevId, target: targetId });
    prevId = targetId;
  };

  // Re-thread surviving manual content steps right after the intro.
  for (const c of keptContent) connect(c.id);

  // 3. Linear chain: intro → [content] → [welcome] → q1…qN → [email] → branch
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

  const questionAnswerIds: string[][] = [];
  // Honor at most ONE AI-placed education card across the quiz (Dev Spec §6):
  // the first question carrying a non-empty card wins; the rest are ignored.
  const eduIdx = generated.questions.findIndex(
    (q) => typeof q.education_card_before === "string" && q.education_card_before.trim().length > 0,
  );
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
    questionAnswerIds.push(answers.map((a) => a.id));
    nodes.push({
      id,
      type: "question",
      position: { x: xAt(col++), y },
      data: {
        text: q.text,
        question_type: q.question_type,
        required: q.required ?? true,
        ...(i === eduIdx && q.education_card_before
          ? { education_card_before: q.education_card_before.trim() }
          : {}),
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

  // Result pages not tied to a question bucket (the merchant made more pages
  // than buckets) are wired off inert slots: a never-matching tag keeps them
  // graph-reachable (no orphan / publish block) while routing still falls
  // through to the real buckets + default. The merchant can bind or delete them.
  const bucketResultIds = new Set(buckets.map((b) => b.resultNodeId));
  const unbucketedResultIds = [...resultIds].filter((id) => !bucketResultIds.has(id));

  const branchId = "sb_br";
  const slots = buckets.map((b, i) => ({
    id: `sb_sl_${i + 1}`,
    label: b.name || `Bucket ${i + 1}`,
    weight: 1,
  }));
  unbucketedResultIds.forEach((_, i) =>
    slots.push({ id: `sb_sl_extra_${i + 1}`, label: "Unbound page", weight: 1 }),
  );
  slots.push({ id: "sb_sl_default", label: "Other", weight: 1 });
  nodes.push({
    id: branchId,
    type: "branch",
    position: { x: xAt(col++), y },
    data: { label: "Route to result", mode: "rules", slots },
  } as QuizNode);
  connect(branchId);

  // Per-bucket routing condition: prefer a tag the answers actually carry;
  // otherwise (tag-poor catalog → dominantTag null) route by the position-
  // matched answer of the first question. That keeps routing tag-INDEPENDENT,
  // so different first answers reach different result pages instead of every
  // shopper falling through to the default slot (the "same page every time"
  // half of the snowboards bug).
  const routingAnswerIds = questionAnswerIds[0] ?? [];
  buckets.forEach((b, i) => {
    const tag = dominantTag(b);
    const answerId = routingAnswerIds[i];
    const condition = tag
      ? { tag }
      : answerId
        ? { answer_id: answerId }
        : undefined;
    edges.push({
      id: rid("e"),
      source: branchId,
      target: b.resultNodeId,
      source_handle: `sb_sl_${i + 1}`,
      ...(condition ? { condition } : {}),
    });
  });
  unbucketedResultIds.forEach((rId, i) => {
    edges.push({
      id: rid("e"),
      source: branchId,
      target: rId,
      source_handle: `sb_sl_extra_${i + 1}`,
      condition: { tag: "__sb_unrouted__" },
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

  // 5b. Deterministic points FLOOR for a tag-poor catalog: if tag overlap seeded
  // nothing on an answer, give it points toward a bucket by position. This makes
  // the `points` strategy discriminate by answer even with empty tags, so the
  // resolved products differ per path instead of being identical every time.
  // Tag-seeded points are left untouched.
  const flooredNodes =
    buckets.length > 0
      ? seededNodes.map((n) => {
          if (n.type !== "question") return n;
          const answers = n.data.answers.map((a, j) => {
            if (a.points && Object.keys(a.points).length > 0) return a;
            const bid = buckets[j % buckets.length]!.id;
            return { ...a, points: { [bid]: 1 } };
          });
          return { ...n, data: { ...n.data, answers } };
        })
      : seededNodes;

  // 6. Each bucket result resolves products by category, then points fallback.
  const finalNodes = flooredNodes.map((n) => {
    if (n.type !== "result") return n;
    const ladder: MatchLadderStrategy[] = [...n.data.match_ladder];
    if (!ladder.includes("category")) ladder.unshift("category");
    if (!ladder.includes("points")) ladder.push("points");
    return { ...n, data: { ...n.data, match_ladder: ladder } };
  });

  return { ...doc, nodes: finalNodes, edges };
}
