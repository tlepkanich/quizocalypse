import { createHmac } from "node:crypto";
import type { ActionFunctionArgs } from "@remix-run/node";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import prisma from "../db.server";
import { Quiz } from "./quizSchema";
import { action as integrationAction } from "../routes/q.$id.integration";

// BIC-2 A2(d) — wiring-level proof for the outbound webhook signature: drive
// the REAL integration action with a captured fetch and verify the served
// X-Quizocalypse-Signature against an independently computed HMAC over the
// exact body that was sent. (A live listener is impractical here by design:
// the SSRF guard rejects localhost/http receivers.)

vi.mock("../db.server", () => ({
  default: { quiz: { findFirst: vi.fn() } },
}));

vi.mock("./ssrfGuard.server", () => ({
  assertPublicHttpsUrl: vi.fn(async () => ({ ok: true })),
}));

const p = prisma as unknown as { quiz: { findFirst: Mock } };

const SECRET = "wh-secret-under-test";

function publishedDoc(secret?: string) {
  return Quiz.parse({
    quiz_id: "q1",
    status: "published",
    scope: { collection_ids: [] },
    nodes: [
      {
        id: "int1",
        type: "integration",
        position: { x: 0, y: 0 },
        data: {
          actions: [
            { kind: "webhook", url: "https://receiver.example/hook", ...(secret ? { secret } : {}) },
          ],
        },
      },
      {
        id: "res1",
        type: "result",
        position: { x: 0, y: 0 },
        data: { headline: "Your match", fallback_collection_id: "col1" },
      },
    ],
  });
}

function args(body: unknown): ActionFunctionArgs {
  const request = new Request("https://shop.example/q/q1/integration", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { request, params: { id: "q1" }, context: {} } as unknown as ActionFunctionArgs;
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("integration webhook signature (A2d, additive)", () => {
  it("sends sha256 HMAC of the EXACT raw body alongside the legacy secret header", async () => {
    p.quiz.findFirst.mockResolvedValue({ publishedJson: publishedDoc(SECRET), name: "T" });

    const res = await integrationAction(
      args({ nodeId: "int1", path: [], session_id: "abcdef0123456789" }),
    );
    expect(res.status).toBe(200);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://receiver.example/hook");
    const headers = init.headers as Record<string, string>;
    const body = init.body as string;

    // Legacy header untouched (additive contract).
    expect(headers["X-Quizocalypse-Secret"]).toBe(SECRET);
    // Signature verifies against an INDEPENDENT HMAC of the exact sent bytes.
    expect(headers["X-Quizocalypse-Signature"]).toBe(
      `sha256=${createHmac("sha256", SECRET).update(body, "utf8").digest("hex")}`,
    );
    // And the body is still the documented payload shape.
    const payload = JSON.parse(body) as { quiz_id: string; node_id: string };
    expect(payload.quiz_id).toBe("q1");
    expect(payload.node_id).toBe("int1");
  });

  it("no secret configured → neither the secret header nor a signature", async () => {
    p.quiz.findFirst.mockResolvedValue({ publishedJson: publishedDoc(), name: "T" });

    const res = await integrationAction(args({ nodeId: "int1", path: [] }));
    expect(res.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Quizocalypse-Secret"]).toBeUndefined();
    expect(headers["X-Quizocalypse-Signature"]).toBeUndefined();
  });
});
