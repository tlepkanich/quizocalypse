import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { clearStudioCookies } from "../lib/studioAccess.server";
import { logFor } from "../lib/log.server";
import { clientIp } from "../lib/rateLimiters";

// BIC-2 A2(b) — POST /studio/logout: clears the magic-link session cookie AND
// the legacy break-glass token cookie, then lands on the login screen. The
// `studio_` filename prefix de-nests it from the gated studio.tsx layout so
// the sign-out never re-runs the access gate. No CSRF token: the action is a
// pure de-authorization (clearing your own cookies), the worst a forced
// cross-site POST achieves is signing the victim OUT.
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    throw new Response("Method not allowed", { status: 405 });
  }
  const headers = new Headers();
  for (const cookie of await clearStudioCookies(request)) {
    headers.append("Set-Cookie", cookie);
  }
  logFor("studio-login").info({ ip: clientIp(request) }, "studio sign-out");
  return redirect("/studio/login", { headers });
};

// A typed-in GET has nothing to show — bounce to login without clearing
// (state-changing work stays POST-only).
export const loader = async () => redirect("/studio/login");
