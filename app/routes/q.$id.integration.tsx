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
import { assertPublicHttpsUrl } from "../lib/ssrfGuard.server";
import { webhookSignatureHeader } from "../lib/webhookSignature.server";
import { corsPreflight, withCors } from "../lib/publicCors";
import { rateLimit } from "../lib/rateLimiters";
import { klaviyoHeaders, shopKlaviyoKey } from "../lib/klaviyo.server";
import { resolveTarget } from "../lib/recommendDecider";
import { NO_MATCH_NAME } from "../lib/sessionResult";
import {
  eventAnswerProperties,
  listActionFor,
  profileAnswerProperties,
} from "../lib/klaviyoProfile";

// Integration node executor. When the storefront runtime reaches an
// integration node it POSTs here with the session payload; we fire every
// configured action server-side (so webhook secrets stay off the client)
// and respond OK so the runtime can advance.
//
// Outbound webhook authentication (when a secret is configured):
//   X-Quizocalypse-Secret:    the shared secret verbatim (legacy — kept).
//   X-Quizocalypse-Signature: sha256=<hex HMAC-SHA256(raw request body, secret)>
//     (BIC-2 A2d, additive). Receivers verify by HMAC-ing the exact raw body
//     bytes they received with the shared secret and constant-time comparing.

interface IntegrationRequestBody {
  nodeId: string;
  path: Array<{ questionNodeId: string; answerIds: string[] }>;
  // BIC P6: the runtime's session token, so outbound payloads (esp. Klaviyo)
  // can carry a results_url that links back to the saved My Results page.
  session_id?: string;
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
  answerWeights?: Record<string, number> | null,
  // LOGIC v2 (L2-9) — the decider bake, threaded from the raw publishedJson so
  // decider docs resolve their target's products here too. Absent on legacy.
  targetFields: {
    targetProductIdsMap?: Record<string, string[]>;
    targetIndex?: Record<string, { type: "product" | "collection" | "tag"; name?: string }>;
  } = {},
): { ids: string[]; titles: string[]; resultNodeId: string | null } {
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
        ...(answerWeights ? { answerWeights } : {}),
        ...targetFields,
      });
      return { ids: recs.map((r) => r.product_id), titles: recs.map((r) => r.title), resultNodeId: nextId };
    }
    if (n.type === "question") break; // more answers still needed
    cursor = nextId;
  }
  return { ids: [], titles: [], resultNodeId: null };
}

/**
 * The result name analytics shows for this shopper (sessionResult.ts): the
 * resolved target on decider docs, the result node's headline on legacy
 * docs, "No match" when nothing would be shown. null = not decided yet.
 */
function resultNameFor(
  doc: QuizDoc,
  path: Array<{ answerIds: string[] }>,
  recommended: { ids: string[]; resultNodeId: string | null },
  targetIndex: Record<string, { name?: string }> | undefined,
): string | null {
  if (!recommended.resultNodeId) return null;
  if (recommended.ids.length === 0) return NO_MATCH_NAME;
  if (doc.logic_model === "decider") {
    const resolved = resolveTarget(path.flatMap((s) => s.answerIds), doc);
    if (!resolved) return NO_MATCH_NAME;
    return targetIndex?.[resolved.targetId]?.name ?? null;
  }
  const node = doc.nodes.find((n) => n.id === recommended.resultNodeId);
  return node?.type === "result" ? node.data.headline || null : null;
}

// Hard cap on the outbound webhook timeout so a stuck receiver can't hang
// the shopper's flow. Each action gets its own fetch with this timeout.
const WEBHOOK_TIMEOUT_MS = 5000;

// 15/min/IP. This endpoint was the last public route with no limiter, which
// mattered more than the others: the actions loop below is SEQUENTIAL and
// unbounded (`for (const act of node.data.actions)`), each action its own
// outbound fetch with the 5 s timeout above — so a single request can occupy
// the one always-on machine for actions × 5 s.
//
// 15 rather than ai-chat's 10 because the traffic SHAPE matches /captures and
// /q/:id/notify (15 each): a shopper trips this about once per completed quiz,
// and mobile-carrier NAT puts many real shoppers behind one IP. Blocking a
// legitimate call here silently costs the merchant a Klaviyo signup or an
// email capture, so the failure is expensive in the other direction too.
//
// Not an amplifier against third parties — assertPublicHttpsUrl (ssrfGuard)
// pins targets to the merchant's own configured URL. The risk this bounds is
// self-DoS of the app.
const RATE = 15;

export const loader = async () => corsPreflight();

export async function action(args: ActionFunctionArgs) {
  if (args.request.method === "OPTIONS") return corsPreflight();
  return withCors(await actionImpl(args));
}

async function actionImpl({ params, request }: ActionFunctionArgs) {
  const { id } = params;
  if (!id) return json({ error: "Missing quiz id" }, { status: 400 });
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  // Before the body is even parsed, so a flood costs us nothing but the check.
  // The CORS headers on this 429 come from the withCors() wrapper on `action`
  // — without them a cross-origin embed could not read WHY it was refused.
  const rl = rateLimit(request, "integration", RATE);
  if (!rl.ok) {
    return json(
      { error: "rate limited" },
      { status: 429, headers: { "retry-after": String(rl.retryAfterS) } },
    );
  }

  // BIC-2 D2 — malformed input is a client error, not a server crash: invalid
  // JSON or a missing/mis-typed path used to escape as an unhandled throw
  // (Remix generic 500). Same guard shape as q.$id.rec-copy.
  let body: IntegrationRequestBody;
  try {
    body = (await request.json()) as IntegrationRequestBody;
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.nodeId || typeof body.nodeId !== "string") {
    return json({ error: "Missing nodeId" }, { status: 400 });
  }
  if (!Array.isArray(body.path)) {
    return json({ error: "Missing path" }, { status: 400 });
  }

  const quiz = await prisma.quiz.findFirst({
    where: { id },
    select: { publishedJson: true, name: true, shopId: true },
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
  const answerWeights =
    (quiz.publishedJson as { answer_weights?: Record<string, number> }).answer_weights ?? null;
  const rawBake = quiz.publishedJson as {
    target_product_ids_map?: Record<string, string[]>;
    target_index?: Record<string, { type: "product" | "collection" | "tag"; name?: string }>;
  };
  const recommended = resolveRecommendedProducts(doc, productIndex, body.path, node.id, answerWeights, {
    ...(rawBake.target_product_ids_map
      ? { targetProductIdsMap: rawBake.target_product_ids_map }
      : {}),
    ...(rawBake.target_index ? { targetIndex: rawBake.target_index } : {}),
  });

  const resultName = resultNameFor(doc, body.path, recommended, rawBake.target_index);

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

  // BIC P6: a durable link back to the shopper's saved results. The session
  // row may not exist yet when the integration fires (it writes on result
  // render) — the results route redirects to the quiz in that case, so the
  // emailed link degrades to "retake" rather than an error page.
  const sessionId = typeof body.session_id === "string" ? body.session_id.slice(0, 128) : "";
  const resultsUrl = sessionId
    ? `${new URL(request.url).origin}/q/${id}/results?session_id=${encodeURIComponent(sessionId)}`
    : null;

  const outboundPayload = {
    quiz_id: id,
    quiz_name: quiz.name,
    node_id: node.id,
    timestamp: new Date().toISOString(),
    email: body.email ?? null,
    name: body.name ?? null,
    phone: body.phone ?? null,
    results_url: resultsUrl,
    answers,
    accumulated_tags: Array.from(allTags),
    recommended_product_ids: recommended.ids,
    recommended_product_titles: recommended.titles,
  };

  // Fire every action with bounded timeout. We collect per-action results
  // for the response so the runtime can log failures, but advancement
  // happens regardless when continue_on_error is true.
  // Serialized ONCE so the signature (A2d) is computed over the exact bytes
  // every webhook action sends.
  const rawOutboundBody = JSON.stringify(outboundPayload);
  const results: Array<{ kind: string; ok: boolean; status?: number; error?: string }> = [];
  // Loaded once, on the first Klaviyo action that needs them.
  let klaviyoKey: string | undefined;
  let consent: boolean | null | undefined;
  for (const act of node.data.actions) {
    if (act.kind === "webhook") {
      // SSRF guard before POSTing the shopper payload to a merchant-set URL.
      const safe = await assertPublicHttpsUrl(act.url);
      if (!safe.ok) {
        results.push({ kind: "webhook", ok: false, error: `blocked: ${safe.reason}` });
        continue;
      }
      try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
        const res = await fetch(act.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "Wiskr/1.0",
            ...(act.secret
              ? {
                  "X-Quizocalypse-Secret": act.secret,
                  // BIC-2 A2(d) — additive HMAC signature over the exact raw
                  // body below (see the route comment for verification).
                  "X-Quizocalypse-Signature": webhookSignatureHeader(rawOutboundBody, act.secret),
                }
              : {}),
          },
          body: rawOutboundBody,
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
      // The shop's ONE connection (Integrations); a legacy per-quiz key only
      // until the shop connects.
      klaviyoKey ??= (quiz.shopId ? await shopKlaviyoKey(quiz.shopId) : null) ?? "";
      const apiKey = klaviyoKey || act.api_key || "";
      if (!apiKey) {
        results.push({ kind: "klaviyo", ok: false, error: "Klaviyo is not connected (Integrations)." });
        continue;
      }
      // The shopper's stored marketing consent decides the list (handoff §8).
      // Matched on the session AND the email: this route is public, so a
      // caller's own "yes" must never subscribe someone else's address.
      if (consent === undefined) {
        const cap = sessionId
          ? await prisma.emailCapture.findFirst({
              where: {
                quizId: id,
                sessionId,
                email: { equals: body.email.trim(), mode: "insensitive" },
                marketingConsent: { not: null },
              },
              orderBy: { capturedAt: "desc" },
              select: { marketingConsent: true },
            })
          : null;
        consent = cap?.marketingConsent ?? null;
      }
      const headers = klaviyoHeaders(apiKey);
      const post = async (path: string, payload: unknown) => {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
        try {
          return await fetch(`https://a.klaviyo.com${path}`, {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(t);
        }
      };
      try {
        // Create-or-update the profile with the quiz folded into properties.
        const res = await post("/api/profile-import/", {
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
                ...(resultName ? { quiz_result: resultName } : {}),
                // BIC P6 — flow emails can link straight back to the shopper's
                // saved results ({{ person|lookup:'quiz_results_url' }}).
                ...(resultsUrl ? { quiz_results_url: resultsUrl } : {}),
                ...profileAnswerProperties(outboundPayload.answers),
              },
            },
          },
        });
        results.push({ kind: "klaviyo", ok: res.ok, status: res.status });
        let profileId: string | null = null;
        if (res.ok) {
          try {
            const created = (await res.json()) as { data?: { id?: unknown } };
            profileId = typeof created.data?.id === "string" ? created.data.id : null;
          } catch {
            profileId = null;
          }
        }
        // Lists follow consent: yes ⇒ subscribed, no ⇒ left off, not asked ⇒
        // the profile (by id — the old call sent an email where Klaviyo
        // expects ids) joins the list without a consent record.
        const listAction = listActionFor(consent);
        if (res.ok && listAction === "subscribe") {
          const sub = await post("/api/profile-subscription-bulk-create-jobs/", {
            data: {
              type: "profile-subscription-bulk-create-job",
              attributes: {
                custom_source: `Wiskr quiz: ${quiz.name}`.slice(0, 120),
                profiles: {
                  data: [
                    {
                      type: "profile",
                      attributes: {
                        email: body.email,
                        subscriptions: { email: { marketing: { consent: "SUBSCRIBED" } } },
                      },
                    },
                  ],
                },
              },
              ...(act.list_id ? { relationships: { list: { data: { type: "list", id: act.list_id } } } } : {}),
            },
          }).catch(() => null);
          if (!sub?.ok) results.push({ kind: "klaviyo_subscribe", ok: false, status: sub?.status, error: "subscribe failed" });
        } else if (res.ok && listAction === "add_profile" && act.list_id && profileId) {
          const add = await post(`/api/lists/${encodeURIComponent(act.list_id)}/relationships/profiles/`, {
            data: [{ type: "profile", id: profileId }],
          }).catch(() => null);
          if (!add?.ok) results.push({ kind: "klaviyo_list", ok: false, status: add?.status, error: "list add failed" });
        }
        // "Completed Quiz" — flows trigger on it, and "Create Klaviyo
        // segment" filters on its quiz id, result, answers and products.
        if (res.ok) {
          const ev = await post("/api/events/", {
            data: {
              type: "event",
              attributes: {
                metric: { data: { type: "metric", attributes: { name: "Completed Quiz" } } },
                profile: { data: { type: "profile", attributes: { email: body.email } } },
                properties: {
                  ...eventAnswerProperties(outboundPayload.answers),
                  quiz_id: id,
                  quiz_name: quiz.name,
                  ...(resultName ? { quiz_result: resultName } : {}),
                  quiz_tags: outboundPayload.accumulated_tags,
                  recommended_products: recommended.titles,
                  recommended_product_ids: recommended.ids,
                },
                time: outboundPayload.timestamp,
              },
            },
          }).catch(() => null);
          if (!ev?.ok) results.push({ kind: "klaviyo_event", ok: false, status: ev?.status, error: "event failed" });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        results.push({ kind: "klaviyo", ok: false, error: msg });
      }
    }
  }

  // Only the primary actions decide advancement; the Klaviyo follow-ups
  // (subscribe, list, event) are reported but stay best-effort, as before.
  const anyFailed = results.some((r) => !r.ok && (r.kind === "webhook" || r.kind === "klaviyo"));
  if (anyFailed && !node.data.continue_on_error) {
    return json(
      { error: "One or more actions failed", results },
      { status: 502 },
    );
  }

  return json({ ok: true, results });
}
