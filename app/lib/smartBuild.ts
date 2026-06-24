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
  // Experiences E3 — chapter label + reassurance line (both optional).
  section_label?: string;
  helper_text?: string;
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

// ---------- Generation-quality guards (BIC P3) ----------
// A category question mislabeled `rating` renders as a scale row — wrong layout
// for content like "Snow sports gear / Beauty & skincare" (seen live). Ratings
// are short ordinal scales; anything else (and anything money-ish) is a
// categorical choice. Pure + exported so validateQuizWarnings can reuse it.

const RATING_ANSWER =
  /^(\d{1,2}|[1-5]\s*stars?|⭐+|poor|fair|good|great|excellent|amazing|terrible|never|rarely|sometimes|often|always|daily|weekly|monthly|strongly disagree|disagree|neutral|agree|strongly agree|not at all|a little|somewhat|very|extremely)$/i;

export function looksLikeRatingScale(answers: Array<{ text: string }>): boolean {
  return answers.length >= 2 && answers.every((a) => RATING_ANSWER.test(a.text.trim()));
}

const MONEYISH = /[$€£]|\bbudget\b|\bprice\b|\bcost\b/i;

/**
 * Post-generation type sanity: `rating` whose answers aren't a scale (or are
 * money ranges) → `single_select`; `swatch` where any answer lacks an image →
 * `single_select` (swatches render image circles). Everything else untouched.
 */
export function normalizeQuestionSpec(q: GeneratedQuestionSpec): GeneratedQuestionSpec {
  if (q.question_type === "rating") {
    const scale = looksLikeRatingScale(q.answers);
    const moneyish = q.answers.some((a) => MONEYISH.test(a.text));
    if (!scale || moneyish) return { ...q, question_type: "single_select" };
  }
  if (q.question_type === "swatch" && q.answers.some((a) => !a.image_url)) {
    return { ...q, question_type: "single_select" };
  }
  return q;
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

  // Type sanity first (BIC P3) — covers the Smart Build path; existing docs
  // are covered by validateQuizWarnings.
  const questions = generated.questions.map(normalizeQuestionSpec);
  // Honor at most ONE AI-placed education card across the quiz (Dev Spec §6):
  // the first question carrying a non-empty card wins; the rest are ignored.
  const eduIdx = questions.findIndex(
    (q) => typeof q.education_card_before === "string" && q.education_card_before.trim().length > 0,
  );
  questions.forEach((q, i) => {
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
        ...(i === eduIdx && q.education_card_before
          ? { education_card_before: q.education_card_before.trim() }
          : {}),
        ...(q.section_label?.trim() ? { section_label: q.section_label.trim().slice(0, 40) } : {}),
        ...(q.helper_text?.trim() ? { helper_text: q.helper_text.trim().slice(0, 160) } : {}),
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

  // Experiences E2 — no buckets (survey / lead-capture): there is nothing to
  // route TO. Skip the branch and terminate the chain at an end node — reuse
  // an existing manual end node if the doc has one, else create a Smart-Build
  // owned one (sb_ prefix keeps it idempotent across regenerations).
  if (buckets.length === 0) {
    const existingEnd = nodes.find((n) => n.type === "end");
    if (existingEnd) {
      connect(existingEnd.id);
    } else {
      const endId = "sb_end";
      nodes.push({
        id: endId,
        type: "end",
        position: { x: xAt(col++), y },
        data: {
          headline: "Thank you 🙏",
          subtext: "We read every response — it genuinely shapes what we do next.",
        },
      } as QuizNode);
      connect(endId);
    }
    return { ...doc, nodes, edges };
  }

  // 4. Routing branch: ONE slot per bucket, fired by PLURALITY — the shopper
  // lands on the page for whichever bucket wins the per-answer points tally
  // (argmax over the whole path), plus an unconditioned default catch-all.
  //
  // Why not the old first-match-over-accumulated-tags rules branch: when every
  // question offers one answer per archetype, the accumulated-tag SET ends up
  // holding nearly every bucket's tag, so first-match priority collapses to
  // whatever bucket sits in slot 1 — the other archetype pages become almost
  // unreachable (exhaustively: 73.8% slot-1 vs 0.006% slot-5 on a 6-question,
  // 5-bucket quiz). `points` mode instead routes by HOW OFTEN each archetype
  // was picked, so all buckets are reachable in rough proportion (≈ even), and
  // the landing page matches the points-resolved products on it.
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
    data: { label: "Route to best match", mode: "points", slots },
  } as QuizNode);
  connect(branchId);

  // One conditioned edge per bucket: its slot fires when that bucket's category
  // id is the points winner. The points are seeded below (tag overlap + a
  // deterministic floor), so EVERY answer contributes toward a bucket — a
  // tag-poor catalog still routes by argmax instead of collapsing to the
  // default (the "same page every path" half of the snowboards bug).
  buckets.forEach((b, i) => {
    edges.push({
      id: rid("e"),
      source: branchId,
      target: b.resultNodeId,
      source_handle: `sb_sl_${i + 1}`,
      condition: { points_category: b.id },
    });
  });
  // Result pages not tied to a question bucket (the merchant made more pages
  // than buckets) are wired off inert slots: a never-matching tag keeps them
  // graph-reachable (no orphan / publish block) while routing still falls
  // through to the real buckets + default. The merchant can bind or delete them.
  unbucketedResultIds.forEach((rId, i) => {
    edges.push({
      id: rid("e"),
      source: branchId,
      target: rId,
      source_handle: `sb_sl_extra_${i + 1}`,
      condition: { tag: "__sb_unrouted__" },
    });
  });
  // Unconditioned default (kept LAST): the points-matched slots win; this only
  // fires if nothing scored (e.g. an all-skipped path), routing to the first
  // bucket so the shopper never dead-ends.
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
