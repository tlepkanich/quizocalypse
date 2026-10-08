// The shop's ONE Klaviyo connection (ANALYTICS-HANDOFF.md, Data work 8).
//
// Connected once, in Integrations, with a private API key that carries every
// scope the features use (profiles, lists, events, subscriptions, metrics:read,
// segments:write). The key is AES-256-GCM encrypted at rest (crypto.ts), like
// the Shopify connector token, and never leaves the server. Quiz Klaviyo
// actions and "Create Klaviyo segment" read it through `shopKlaviyoKey`.
//
// Existing quizzes carried a plaintext key inside their integration action;
// `moveQuizKeyToShop` is the one-time move. Those keys keep working as a
// fallback until the shop connects (q.$id.integration.tsx).

import prisma from "../db.server";
import { decrypt, encrypt } from "./crypto";
import { logFor } from "./log.server";
import {
  ADDED_TO_CART_METRIC,
  COMPLETED_QUIZ_METRIC,
  PLACED_ORDER_METRIC,
  STARTED_CHECKOUT_METRIC,
  metricsNeeded,
  segmentDefinition,
  type MetricIds,
  type SegmentSpec,
} from "./klaviyoSegment";
import { Quiz } from "./quizSchema";

/** Every Klaviyo call pins this revision (segments need newer than 2024-02-15). */
export const KLAVIYO_REVISION = "2026-07-15";
const KLAVIYO_BASE = "https://a.klaviyo.com";
const TIMEOUT_MS = 8000;

export function klaviyoHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/vnd.api+json",
    Accept: "application/vnd.api+json",
    Authorization: `Klaviyo-API-Key ${apiKey}`,
    revision: KLAVIYO_REVISION,
  };
}

export async function klaviyoFetch(
  apiKey: string,
  path: string,
  init: { method?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), init.timeoutMs ?? TIMEOUT_MS);
  try {
    const res = await fetch(`${KLAVIYO_BASE}${path}`, {
      method: init.method ?? "GET",
      headers: klaviyoHeaders(apiKey),
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: controller.signal,
    });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(t);
  }
}

/** Klaviyo's first error detail, for a message the merchant can act on. */
function errorDetail(body: unknown): string | null {
  const errs = (body as { errors?: Array<{ detail?: unknown; title?: unknown }> } | null)?.errors;
  const e = Array.isArray(errs) ? errs[0] : undefined;
  const d = typeof e?.detail === "string" ? e.detail : typeof e?.title === "string" ? e.title : null;
  return d ? d.slice(0, 300) : null;
}

/** The shop's decrypted key, or null when not connected (or undecryptable). */
export async function shopKlaviyoKey(shopId: string): Promise<string | null> {
  const row = await prisma.shop.findUnique({ where: { id: shopId }, select: { klaviyoApiKey: true } });
  if (!row?.klaviyoApiKey) return null;
  try {
    return decrypt(row.klaviyoApiKey);
  } catch (err) {
    logFor("klaviyo").error({ err, shopId }, "klaviyo key decrypt failed");
    return null;
  }
}

export interface KlaviyoStatus {
  connected: boolean;
  accountName: string | null;
  connectedAt: string | null;
  /** Quizzes whose Klaviyo action still carries its own key. */
  quizKeys: Array<{ quizId: string; quizName: string }>;
}

function quizKeysOf(json: unknown): string[] {
  const parsed = Quiz.safeParse(json);
  if (!parsed.success) return [];
  const keys: string[] = [];
  for (const n of parsed.data.nodes) {
    if (n.type !== "integration") continue;
    for (const a of n.data.actions) if (a.kind === "klaviyo" && a.api_key) keys.push(a.api_key);
  }
  return keys;
}

async function quizzesWithKeys(shopId: string) {
  const quizzes = await prisma.quiz.findMany({
    where: { shopId },
    select: { id: true, name: true, draftJson: true, publishedJson: true },
    orderBy: { updatedAt: "desc" },
  });
  return quizzes
    .map((q) => ({ quizId: q.id, quizName: q.name, keys: [...quizKeysOf(q.draftJson), ...quizKeysOf(q.publishedJson)] }))
    .filter((q) => q.keys.length > 0);
}

export async function klaviyoStatus(shopId: string): Promise<KlaviyoStatus> {
  const [row, withKeys] = await Promise.all([
    prisma.shop.findUnique({
      where: { id: shopId },
      select: { klaviyoApiKey: true, klaviyoAccountName: true, klaviyoConnectedAt: true },
    }),
    quizzesWithKeys(shopId),
  ]);
  return {
    connected: Boolean(row?.klaviyoApiKey),
    accountName: row?.klaviyoAccountName ?? null,
    connectedAt: row?.klaviyoConnectedAt?.toISOString() ?? null,
    quizKeys: withKeys.map(({ quizId, quizName }) => ({ quizId, quizName })),
  };
}

/** Check a key against Klaviyo and save it, encrypted. */
export async function connectKlaviyo(
  shopId: string,
  rawKey: string,
): Promise<{ ok: true; accountName: string | null } | { ok: false; error: string }> {
  const key = rawKey.trim();
  if (!/^pk_[A-Za-z0-9_]{10,}$/.test(key)) {
    return { ok: false, error: "That doesn't look like a Klaviyo private API key (it starts with pk_)." };
  }
  let res;
  try {
    res = await klaviyoFetch(key, "/api/accounts/");
  } catch {
    return { ok: false, error: "Klaviyo didn't answer. Try again in a moment." };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: "Klaviyo didn't accept this key. Check it's a private key with full access." };
  }
  if (!res.ok) return { ok: false, error: errorDetail(res.body) ?? `Klaviyo returned ${res.status}.` };
  const account = (res.body as { data?: Array<{ attributes?: { contact_information?: { organization_name?: unknown } } }> } | null)
    ?.data?.[0];
  const name = account?.attributes?.contact_information?.organization_name;
  const accountName = typeof name === "string" && name ? name.slice(0, 120) : null;
  await prisma.shop.update({
    where: { id: shopId },
    data: { klaviyoApiKey: encrypt(key), klaviyoAccountName: accountName, klaviyoConnectedAt: new Date() },
  });
  logFor("klaviyo").info({ shopId }, "klaviyo connected");
  return { ok: true, accountName };
}

export async function disconnectKlaviyo(shopId: string): Promise<void> {
  await prisma.shop.update({
    where: { id: shopId },
    data: { klaviyoApiKey: null, klaviyoAccountName: null, klaviyoConnectedAt: null },
  });
  logFor("klaviyo").info({ shopId }, "klaviyo disconnected");
}

/**
 * The one-time move: connect the shop with the key its quizzes already use
 * (the most recently edited quiz's first). The quiz docs are NOT rewritten
 * here — a published doc changes only on its next publish — and the shop
 * connection wins over any per-quiz key from now on.
 */
export async function moveQuizKeyToShop(
  shopId: string,
): Promise<{ ok: true; accountName: string | null } | { ok: false; error: string }> {
  const withKeys = await quizzesWithKeys(shopId);
  const tried = new Set<string>();
  let last: { ok: false; error: string } = { ok: false, error: "No quiz has a Klaviyo key to move." };
  for (const q of withKeys) {
    for (const k of q.keys) {
      if (tried.has(k)) continue;
      tried.add(k);
      const r = await connectKlaviyo(shopId, k);
      if (r.ok) return r;
      last = r;
    }
  }
  return last;
}

async function metricIdByName(apiKey: string, name: string): Promise<string | null> {
  const filter = encodeURIComponent(`equals(name,"${name.replace(/"/g, '\\"')}")`);
  const res = await klaviyoFetch(apiKey, `/api/metrics/?filter=${filter}`);
  if (!res.ok) return null;
  const data = (res.body as { data?: Array<{ id?: unknown }> } | null)?.data;
  const id = Array.isArray(data) ? data[0]?.id : null;
  return typeof id === "string" ? id : null;
}

const METRIC_NAMES: Record<keyof Omit<MetricIds, "completedQuiz">, string> = {
  placedOrder: PLACED_ORDER_METRIC,
  addedToCart: ADDED_TO_CART_METRIC,
  startedCheckout: STARTED_CHECKOUT_METRIC,
};

export type CreateSegmentResult =
  | { ok: true; segmentId: string; name: string }
  | { ok: false; error: string; code: "not_connected" | "missing_metric" | "klaviyo" };

/** One call to Klaviyo's Create Segment (limited by Klaviyo to 100 a day). */
export async function createKlaviyoSegment(shopId: string, name: string, spec: SegmentSpec): Promise<CreateSegmentResult> {
  const key = await shopKlaviyoKey(shopId);
  if (!key) return { ok: false, code: "not_connected", error: "Connect Klaviyo in Integrations first." };
  const completedQuiz = await metricIdByName(key, COMPLETED_QUIZ_METRIC);
  if (!completedQuiz) {
    return {
      ok: false,
      code: "missing_metric",
      error: `Klaviyo has no “${COMPLETED_QUIZ_METRIC}” activity yet. It appears once a shopper finishes a quiz with a Klaviyo step.`,
    };
  }
  const ids: MetricIds = { completedQuiz };
  for (const k of metricsNeeded(spec.status)) {
    const id = await metricIdByName(key, METRIC_NAMES[k]);
    if (!id) {
      return {
        ok: false,
        code: "missing_metric",
        error: `Klaviyo has no “${METRIC_NAMES[k]}” activity, which this segment needs. Connect your store to Klaviyo first.`,
      };
    }
    ids[k] = id;
  }
  const res = await klaviyoFetch(key, "/api/segments/", {
    method: "POST",
    body: {
      data: {
        type: "segment",
        attributes: { name: name.trim().slice(0, 120) || "Wiskr segment", definition: segmentDefinition(spec, ids) },
      },
    },
  });
  if (!res.ok) {
    logFor("klaviyo").warn({ shopId, status: res.status }, "klaviyo segment create failed");
    return {
      ok: false,
      code: "klaviyo",
      error:
        res.status === 429
          ? "Klaviyo allows 100 new segments a day, and that limit is reached. Try again tomorrow."
          : errorDetail(res.body) ?? `Klaviyo returned ${res.status}.`,
    };
  }
  const id = (res.body as { data?: { id?: unknown } } | null)?.data?.id;
  logFor("klaviyo").info({ shopId, quizId: spec.quizId }, "klaviyo segment created");
  return { ok: true, segmentId: typeof id === "string" ? id : "", name };
}

/**
 * The Integrations page's Klaviyo intents — shared by both surfaces after
 * their own auth. Returns null when the form is not a Klaviyo one.
 */
export async function handleKlaviyoForm(
  shopId: string,
  form: FormData,
): Promise<{ ok: boolean; error?: string; accountName?: string | null } | null> {
  const intent = form.get("intent");
  if (intent === "klaviyo-connect") {
    const key = form.get("apiKey");
    if (typeof key !== "string") return { ok: false, error: "Paste your Klaviyo private API key." };
    return connectKlaviyo(shopId, key);
  }
  if (intent === "klaviyo-move") return moveQuizKeyToShop(shopId);
  if (intent === "klaviyo-disconnect") {
    await disconnectKlaviyo(shopId);
    return { ok: true };
  }
  return null;
}
