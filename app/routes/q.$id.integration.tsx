import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { Quiz, type Quiz as QuizDoc } from "../lib/quizSchema";
import {
  resolveNextStep,
  recommendForResult,
  type BranchContext,
  type IndexedProduct,
} from "../lib/recommendationEngine";

// Integration node executor. When the storefront runtime reaches an
// integration node it POSTs here with the session payload; we fire every
// configured action server-side (so webhook secrets stay off the client)
// and respond OK so the runtime can advance.

interface IntegrationRequestBody {
  nodeId: string;
  path: Array<{ questionNodeId: string; answerIds: string[] }>;
  email?: string;
  name?: string;
  phone?: string;
}

// Resolve the products the shopper is about to be recommended, by walking the
// flow forward from the integration node to the first result page (best-effort:
// no A/B context, so branch routing is by accumulated tags only). Lets us send
// the recommendations to Klaviyo as profile attributes.
function resolveRecommendedProducts(
  doc: QuizDoc,
  productIndex: IndexedProduct[],
  path: Array<{ questionNodeId: string; answerIds: string[] }>,
  fromNodeId: string,
): { ids: string[]; titles: string[] } {
  const selectedAnswerIds = new Set<string>();
  const accumulatedTags = new Set<string>();
  for (const step of path) {
    const q = doc.nodes.find((n) => n.id === step.questionNodeId);
    if (!q || q.type !== "question") continue;
    for (const aid of step.answerIds) {
      selectedAnswerIds.add(aid);
      const a = q.data.answers.find((x) => x.id === aid);
      if (a) for (const t of a.tags) accumulatedTags.add(t);
    }
  }
  const ctx: BranchContext = { accumulatedTags, selectedAnswerIds, abAssignments: {} };
  let cursor: string | null = fromNodeId;
  for (let i = 0; i < 30 && cursor; i++) {
    const nextId: string | null = resolveNextStep(doc, cursor, null, ctx);
    if (!nextId) break;
    const n = doc.nodes.find((x) => x.id === nextId);
    if (!n) break;
    if (n.type === "result") {
      const recs = recommendForResult({
        quiz: doc,
        productIndex,
        selectedAnswerIds: [...selectedAnswerIds],
        resultNodeId: nextId,
      });
      return { ids: recs.map((r) => r.product_id), titles: recs.map((r) => r.title) };
    }
    if (n.type === "question") break; // more answers still needed
    cursor = nextId;
  }
  return { ids: [], titles: [] };
}

// Hard cap on the outbound webhook timeout so a stuck receiver can't hang
// the shopper's flow. Each action gets its own fetch with this timeout.
const WEBHOOK_TIMEOUT_MS = 5000;

export async function action({ params, request }: ActionFunctionArgs) {
  const { id } = params;
  if (!id) return json({ error: "Missing quiz id" }, { status: 400 });
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = (await request.json()) as IntegrationRequestBody;
  if (!body.nodeId) {
    return json({ error: "Missing nodeId" }, { status: 400 });
  }

  const quiz = await prisma.quiz.findFirst({
    where: { id },
    select: { publishedJson: true, name: true },
  });
  if (!quiz?.publishedJson) {
    return json({ error: "Quiz not published" }, { status: 404 });
  }

  const parsed = Quiz.safeParse(quiz.publishedJson);
  if (!parsed.success) {
    return json({ error: "Quiz JSON invalid" }, { status: 500 });
  }
  const doc = parsed.data;

  const node = doc.nodes.find((n) => n.id === body.nodeId);
  if (!node || node.type !== "integration") {
    return json({ error: "Node is not an integration node" }, { status: 400 });
  }

  // The shopper's recommended products (best-effort) for marketing payloads.
  const productIndex =
    (quiz.publishedJson as { product_index?: IndexedProduct[] }).product_index ?? [];
  const recommended = resolveRecommendedProducts(doc, productIndex, body.path, node.id);

  // Build the outbound payload from the path: question text → picked answer
  // text(s) + accumulated tags. Receivers get a flat readable shape.
  const answers: Array<{
    question_id: string;
    question_text: string;
    answer_ids: string[];
    answer_texts: string[];
    tags: string[];
  }> = [];
  const allTags = new Set<string>();
  for (const step of body.path) {
    const q = doc.nodes.find((n) => n.id === step.questionNodeId);
    if (!q || q.type !== "question") continue;
    const picked = q.data.answers.filter((a) => step.answerIds.includes(a.id));
    const tags = picked.flatMap((a) => a.tags);
    for (const t of tags) allTags.add(t);
    answers.push({
      question_id: q.id,
      question_text: q.data.text,
      answer_ids: step.answerIds,
      answer_texts: picked.map((a) => a.text),
      tags,
    });
  }

  const outboundPayload = {
    quiz_id: id,
    quiz_name: quiz.name,
    node_id: node.id,
    timestamp: new Date().toISOString(),
    email: body.email ?? null,
    name: body.name ?? null,
    phone: body.phone ?? null,
    answers,
    accumulated_tags: Array.from(allTags),
    recommended_product_ids: recommended.ids,
    recommended_product_titles: recommended.titles,
  };

  // Fire every action with bounded timeout. We collect per-action results
  // for the response so the runtime can log failures, but advancement
  // happens regardless when continue_on_error is true.
  const results: Array<{ kind: string; ok: boolean; status?: number; error?: string }> = [];
  for (const act of node.data.actions) {
    if (act.kind === "webhook") {
      try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
        const res = await fetch(act.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "Quizocalypse/1.0",
            ...(act.secret ? { "X-Quizocalypse-Secret": act.secret } : {}),
          },
          body: JSON.stringify(outboundPayload),
          signal: controller.signal,
        });
        clearTimeout(t);
        results.push({ kind: "webhook", ok: res.ok, status: res.status });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        results.push({ kind: "webhook", ok: false, error: msg });
      }
    } else if (act.kind === "klaviyo") {
      // Klaviyo upsert: requires an email. Skip cleanly if the shopper
      // hasn't hit an email_gate yet — the merchant should put the
      // integration node after the gate. We surface the skip so it's
      // visible in the response, not silent.
      if (!body.email) {
        results.push({
          kind: "klaviyo",
          ok: false,
          error: "No email captured yet — put integration after email_gate.",
        });
        continue;
      }
      try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
        // Klaviyo Profile API (v2024-02-15): create-or-update profile with
        // quiz answers folded into custom properties.
        const profilePayload = {
          data: {
            type: "profile",
            attributes: {
              email: body.email,
              ...(body.name ? { first_name: body.name } : {}),
              ...(body.phone ? { phone_number: body.phone } : {}),
              properties: {
                quiz_id: id,
                quiz_name: quiz.name,
                quiz_completed_at: outboundPayload.timestamp,
                quiz_tags: outboundPayload.accumulated_tags,
                quiz_recommended_products: recommended.titles,
                quiz_recommended_product_ids: recommended.ids,
                quiz_top_product: recommended.titles[0] ?? null,
                ...Object.fromEntries(
                  outboundPayload.answers.map((a) => [
                    `quiz_q_${a.question_id}`,
                    a.answer_texts.join(", "),
                  ]),
                ),
              },
            },
          },
        };
        const res = await fetch("https://a.klaviyo.com/api/profile-import/", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Klaviyo-API-Key ${act.api_key}`,
            revision: "2024-02-15",
          },
          body: JSON.stringify(profilePayload),
          signal: controller.signal,
        });
        clearTimeout(t);
        results.push({ kind: "klaviyo", ok: res.ok, status: res.status });
        // Best-effort list subscription if list_id is set. Failures here
        // don't fail the action — the profile upsert is the primary goal.
        if (res.ok && act.list_id) {
          try {
            const subController = new AbortController();
            const subT = setTimeout(
              () => subController.abort(),
              WEBHOOK_TIMEOUT_MS,
            );
            await fetch(
              `https://a.klaviyo.com/api/lists/${act.list_id}/relationships/profiles/`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Klaviyo-API-Key ${act.api_key}`,
                  revision: "2024-02-15",
                },
                body: JSON.stringify({
                  data: [{ type: "profile", attributes: { email: body.email } }],
                }),
                signal: subController.signal,
              },
            );
            clearTimeout(subT);
          } catch {
            // Swallow — list sub is best-effort.
          }
        }
        // Fire a "Completed Quiz" event (carrying tags + recommendations) so
        // merchants can trigger Klaviyo flows on quiz completion. Best-effort.
        if (res.ok) {
          try {
            const evController = new AbortController();
            const evT = setTimeout(() => evController.abort(), WEBHOOK_TIMEOUT_MS);
            await fetch("https://a.klaviyo.com/api/events/", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Klaviyo-API-Key ${act.api_key}`,
                revision: "2024-02-15",
              },
              body: JSON.stringify({
                data: {
                  type: "event",
                  attributes: {
                    metric: {
                      data: { type: "metric", attributes: { name: "Completed Quiz" } },
                    },
                    profile: {
                      data: { type: "profile", attributes: { email: body.email } },
                    },
                    properties: {
                      quiz_id: id,
                      quiz_name: quiz.name,
                      quiz_tags: outboundPayload.accumulated_tags,
                      recommended_products: recommended.titles,
                      recommended_product_ids: recommended.ids,
                    },
                    time: outboundPayload.timestamp,
                  },
                },
              }),
              signal: evController.signal,
            });
            clearTimeout(evT);
          } catch {
            // Swallow — event is best-effort.
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        results.push({ kind: "klaviyo", ok: false, error: msg });
      }
    }
  }

  const anyFailed = results.some((r) => !r.ok);
  if (anyFailed && !node.data.continue_on_error) {
    return json(
      { error: "One or more actions failed", results },
      { status: 502 },
    );
  }

  return json({ ok: true, results });
}
