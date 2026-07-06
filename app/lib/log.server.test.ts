import { describe, expect, it, vi, type Mock } from "vitest";
import { captureError } from "./sentry.server";
import { createLogger, logFor, logger, reportError } from "./log.server";

// BIC-2 A1 — the reportError never-throw contract. reportError is called from
// detached-job catch blocks whose never-throw posture is sacred ([[detached-
// job-killed-strands-funnel]]): a throwing error-reporter would strand the
// funnel spinner forever. Poison the Sentry forward and feed hostile error
// values; reportError must swallow everything.
// vi.mock is hoisted above the imports by vitest (the publicWriteGuards
// pattern), so the ./sentry.server mock is in place before log.server loads.
vi.mock("./sentry.server", () => ({
  captureError: vi.fn(() => {
    throw new Error("poisoned Sentry mock");
  }),
  sentryEnabled: vi.fn(() => false),
}));

// Capture pino output: the singleton writes to a raw fd-1 stream (sonic-boom),
// so shape tests inject a destination into createLogger — the same options the
// singleton is built from.
function captureLines(): { lines: string[]; log: ReturnType<typeof createLogger> } {
  const lines: string[] = [];
  const log = createLogger({ write: (line: string) => void lines.push(line) });
  return { lines, log };
}

describe("reportError never throws", () => {
  it("survives a poisoned Sentry forward", () => {
    expect(() => reportError(new Error("boom"))).not.toThrow();
    expect(captureError as Mock).toHaveBeenCalled();
  });

  it("survives non-Error values (string, undefined, object)", () => {
    expect(() => reportError("plain string failure")).not.toThrow();
    expect(() => reportError(undefined)).not.toThrow();
    expect(() => reportError({ code: 42 })).not.toThrow();
  });

  it("survives a circular / unserializable error value", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => reportError(circular, { scope: "test" })).not.toThrow();
  });

  it("logs err + ctx fields and forwards ctx to Sentry", () => {
    (captureError as Mock).mockClear();
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    try {
      const ctx = { scope: "step2", quizId: "q1" };
      reportError(new Error("x"), ctx);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          err: expect.any(Error),
          scope: "step2",
          quizId: "q1",
          msg: "x", // no ctx.msg → falls back to the error message
        }),
      );
      expect(captureError as Mock).toHaveBeenCalledWith(expect.any(Error), ctx);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("a string ctx.msg wins over the error message", () => {
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    try {
      reportError(new Error("db down"), { scope: "captures", msg: "write failed" });
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ scope: "captures", msg: "write failed" }),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("log line shape (same options as the singleton)", () => {
  it("logFor-style child carries {scope} in single-line JSON", () => {
    const { lines, log } = captureLines();
    log.child({ scope: "step2" }).error({ quizId: "q1" }, "template generation failed");
    expect(lines.length).toBe(1);
    const line = lines[0] ?? "";
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed.scope).toBe("step2");
    expect(parsed.quizId).toBe("q1");
    expect(parsed.msg).toBe("template generation failed");
    expect(parsed.level).toBe(50);
    // Single-line JSON: no embedded newlines once the trailing one is trimmed.
    expect(line.trim()).not.toContain("\n");
  });

  it("serializes {err} with message + stack", () => {
    const { lines, log } = captureLines();
    log.error({ err: new Error("db down"), scope: "captures" }, "write failed");
    const parsed = JSON.parse(lines[0] ?? "") as {
      msg: string;
      err?: { message?: string; stack?: string };
    };
    expect(parsed.msg).toBe("write failed");
    expect(parsed.err?.message).toBe("db down");
    expect(parsed.err?.stack).toBeTruthy();
  });

  it("has no pid/hostname noise (base: undefined)", () => {
    const { lines, log } = captureLines();
    log.info("hello");
    const parsed = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
    expect(parsed.pid).toBeUndefined();
    expect(parsed.hostname).toBeUndefined();
    expect(parsed.msg).toBe("hello");
  });

  it("logFor on the real singleton returns a usable child (smoke)", () => {
    // The singleton writes to fd 1 — just prove the child exists and doesn't throw.
    expect(() => logFor("smoke").debug({ ok: true }, "seam smoke")).not.toThrow();
  });
});
