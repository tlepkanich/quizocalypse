import { pino, type DestinationStream, type Logger, type LoggerOptions } from "pino";
import { captureError } from "./sentry.server";

// BIC-2 A1 — the ONE logging seam for all server code. Plain pino, always
// single-line JSON to stdout (no pino-pretty transport: a worker-thread
// transport is a prod-build liability for zero payoff on Fly, where stdout IS
// the log pipeline). Level via LOG_LEVEL, default "info".
//
// Usage:
//   logFor("step2").error({ err, quizId }, "template generation failed");
//   reportError(err, { scope: "captures", msg: "write failed" });
// reportError = error log ALWAYS + Sentry forward when a DSN is configured
// (app/lib/sentry.server.ts — dormant until SENTRY_DSN is set).

const baseOptions: LoggerOptions = {
  level: process.env.LOG_LEVEL ?? "info",
  // Keep pid/hostname out of every line — Fly already attributes the machine.
  base: undefined,
};

// Exported for tests only: pino's default destination is a raw fd-1 stream
// (sonic-boom), which a process.stdout spy can't intercept — tests inject a
// capture stream here to assert the exact JSON line shape this config emits.
export function createLogger(destination?: DestinationStream): Logger {
  return destination ? pino(baseOptions, destination) : pino(baseOptions);
}

export const logger = createLogger();

// A child logger carrying {scope} — the structured successor to the "[tag]"
// console prefixes ([step2], [webhook], [captures], …). Preserve the old tag
// text verbatim as the scope so log searches keep working.
export function logFor(scope: string): Logger {
  return logger.child({ scope });
}

// Errors arrive as `unknown` (catch blocks); pino's err serializer wants an
// Error to extract type/message/stack. Wrap non-Errors without losing them.
function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  try {
    return new Error(typeof err === "string" ? err : JSON.stringify(err));
  } catch {
    return new Error(String(err));
  }
}

// Log an error (always) and forward it to Sentry (when initialized). ctx keys
// become structured fields; a string ctx.msg becomes the log message (pino
// treats `msg` in the merge object as the message). NEVER throws — this is
// called from detached-job catch blocks whose never-throw posture is sacred.
export function reportError(err: unknown, ctx?: Record<string, unknown>): void {
  try {
    const error = toError(err);
    const fields: Record<string, unknown> = { err: error, ...ctx };
    if (typeof fields.msg !== "string") fields.msg = error.message;
    logger.error(fields);
  } catch {
    // Even a logging failure must not introduce a new throw path.
  }
  try {
    captureError(err, ctx);
  } catch {
    // captureError already never-throws; belt and braces per the seam contract.
  }
}
