import { json, type ActionFunctionArgs } from "@remix-run/node";
import { resolveApiShop } from "../lib/studioAccess.server";
import { logFor } from "../lib/log.server";
import { unauthenticated } from "../shopify.server";

// rec-page-spec-V2 §10.2 — validate an EXISTING merchant-created discount code
// on blur. READ-ONLY proxy to the Shopify Admin API: the app validates,
// displays, and auto-applies codes — it NEVER creates discounts (the explicit
// v2 narrowing vs the legacy ensureQuizDiscount, which stays legacy-only).
// Standalone shops (no Shopify session) degrade to { valid: null } so the UI
// shows an info note instead of a false negative.

const QUERY = `#graphql
  query ValidateDiscountCode($code: String!) {
    codeDiscountNodeByCode(code: $code) {
      id
      codeDiscount {
        __typename
        ... on DiscountCodeBasic { title status summary endsAt }
        ... on DiscountCodeBxgy { title status summary endsAt }
        ... on DiscountCodeFreeShipping { title status summary endsAt }
        ... on DiscountCodeApp { title status endsAt }
      }
    }
  }
`;

interface CodeDiscount {
  __typename: string;
  title?: string;
  status?: string;
  summary?: string;
  endsAt?: string | null;
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") return json({ valid: null, reason: "POST only" }, { status: 405 });
  const shop = await resolveApiShop(request);
  let code = "";
  try {
    const body = (await request.json()) as { code?: unknown };
    code = typeof body.code === "string" ? body.code.trim().slice(0, 64) : "";
  } catch {
    // fall through to the empty-code 400 below
  }
  if (!code) return json({ valid: null, reason: "No code provided" }, { status: 400 });

  // Resolve a read-only Admin client from the stored offline session. A shop
  // without one (the standalone workspace) can't validate — say so honestly.
  let adminGraphql: ((q: string, o?: { variables?: Record<string, unknown> }) => Promise<Response>) | null =
    null;
  try {
    const { admin } = await unauthenticated.admin(shop.shopDomain);
    adminGraphql = admin.graphql;
  } catch {
    adminGraphql = null;
  }
  if (!adminGraphql) {
    return json({
      valid: null,
      reason: "Connect your Shopify store to validate codes — we'll still display it as typed.",
    });
  }

  try {
    const res = await adminGraphql(QUERY, { variables: { code } });
    const data = (await res.json()) as {
      data?: { codeDiscountNodeByCode?: { codeDiscount?: CodeDiscount } | null };
    };
    const node = data.data?.codeDiscountNodeByCode;
    if (!node?.codeDiscount) {
      return json({ valid: false, active: false, reason: "Code not found — create it in Shopify Admin first" });
    }
    const d = node.codeDiscount;
    const active = d.status === "ACTIVE";
    return json({
      valid: true,
      active,
      summary: active
        ? `${d.title ?? code}${d.summary ? ` — ${d.summary}` : ""}`
        : undefined,
      reason: active ? undefined : `Code exists but is ${String(d.status ?? "inactive").toLowerCase()}`,
      expiresAt: d.endsAt ?? null,
    });
  } catch (err) {
    logFor("validate-discount").error({ err }, "lookup failed");
    return json({ valid: null, reason: "Can't validate right now — try again shortly" });
  }
}
