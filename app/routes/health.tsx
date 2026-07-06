import prisma from "../db.server";
import { logFor } from "../lib/log.server";

// BIC-2 A1 — /health: the Fly http check target (fly.toml [[http_service.checks]]).
// Resource route (no default export): GET/HEAD → 200 {ok:true} when the DB
// answers a SELECT 1, 503 {ok:false} otherwise. No auth, no rate limit,
// never cached. The DB ping is bounded (4s < the Fly check's 5s timeout) so a
// hung connection fails the check fast instead of hanging it.

const DB_PING_TIMEOUT_MS = 4000;

const HEADERS = {
  "content-type": "application/json",
  "cache-control": "no-store",
};

async function pingDb(): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`db ping timed out after ${DB_PING_TIMEOUT_MS}ms`)),
      DB_PING_TIMEOUT_MS,
    );
  });
  try {
    await Promise.race([prisma.$queryRaw`SELECT 1`, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function loader() {
  try {
    await pingDb();
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: HEADERS });
  } catch (err) {
    // Log-only (no Sentry forward): a down DB already pages via the failing
    // Fly check; at one probe per 15s this stays readable, not floody.
    logFor("health").error({ err }, "health check failed");
    return new Response(JSON.stringify({ ok: false }), { status: 503, headers: HEADERS });
  }
}
