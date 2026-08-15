import { describe, expect, it } from "vitest";
import { corsPreflight, PUBLIC_CORS, withCors } from "./publicCors";

describe("publicCors", () => {
  it("replies 204 with the header set on preflight", async () => {
    const res = corsPreflight();
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
    expect(await res.text()).toBe("");
  });

  it("adds the headers while preserving body and status", async () => {
    const wrapped = withCors(
      new Response(JSON.stringify({ ok: false, code: "budget" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    expect(wrapped.status).toBe(200);
    expect(wrapped.headers.get("content-type")).toBe("application/json");
    expect(wrapped.headers.get("access-control-allow-origin")).toBe("*");
    expect(await wrapped.json()).toEqual({ ok: false, code: "budget" });
  });

  // The error paths are the ones that matter: without CORS on a 429 the
  // browser blocks the client from ever reading WHY it was refused.
  it("adds the headers to error responses and keeps retry-after", () => {
    const wrapped = withCors(
      new Response(JSON.stringify({ error: "rate limited" }), {
        status: 429,
        headers: { "retry-after": "30" },
      }),
    );
    expect(wrapped.status).toBe(429);
    expect(wrapped.headers.get("retry-after")).toBe("30");
    expect(wrapped.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("rebuilds 204 bodyless instead of throwing", () => {
    const wrapped = withCors(new Response(null, { status: 204 }));
    expect(wrapped.status).toBe(204);
    expect(wrapped.body).toBeNull();
    expect(wrapped.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("exposes every header it promises", () => {
    for (const key of Object.keys(PUBLIC_CORS)) {
      expect(corsPreflight().headers.get(key)).toBe(PUBLIC_CORS[key]);
    }
  });
});
