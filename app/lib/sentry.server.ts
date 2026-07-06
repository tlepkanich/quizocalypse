import * as Sentry from "@sentry/node";

// BIC-2 A1 — dormant Sentry hook, SERVER-ONLY (@sentry/node, deliberately not
// @sentry/remix: no client instrumentation, so the /q shopper bundle is
// byte-untouched). Everything here is a no-op until the owner sets SENTRY_DSN.
//
// Init happens at module scope (not entry.server.tsx): the sole consumer is
// the log seam (app/lib/log.server.ts reportError), and importing this module
// initializes before first use with zero ordering hazards — Remix v2 + Vite
// doesn't guarantee entry.server evaluates before route modules in dev, so
// module-init at the seam is the cleaner pattern.

let initialized = false;

try {
  const dsn = process.env.SENTRY_DSN;
  if (dsn) {
    Sentry.init({
      dsn,
      // FLY_APP_NAME identifies the deploy; NODE_ENV covers local prod runs.
      environment: process.env.FLY_APP_NAME ?? process.env.NODE_ENV ?? "development",
      // Error tracking only — no performance tracing spend.
      tracesSampleRate: 0,
    });
    initialized = true;
  }
} catch {
  // A broken DSN / init failure must never take the server down — stay dormant.
  initialized = false;
}

// True only when SENTRY_DSN was set AND init succeeded (used by reportError).
export function sentryEnabled(): boolean {
  return initialized;
}

// Forward an error to Sentry with optional structured context. NEVER throws;
// silently no-ops while dormant.
export function captureError(err: unknown, ctx?: Record<string, unknown>): void {
  if (!initialized) return;
  try {
    Sentry.captureException(err, ctx ? { extra: ctx } : undefined);
  } catch {
    // Reporting must never become a new failure mode.
  }
}
