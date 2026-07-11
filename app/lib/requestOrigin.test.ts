import { describe, expect, it } from "vitest";
import { requestOrigin } from "./requestOrigin";

describe("requestOrigin", () => {
  it("upgrades to https behind a TLS-terminating proxy (Fly)", () => {
    const req = new Request("http://quizocalypse-studio.fly.dev/q/abc/llms.txt", {
      headers: { "x-forwarded-proto": "https", host: "quizocalypse-studio.fly.dev" },
    });
    expect(requestOrigin(req)).toBe("https://quizocalypse-studio.fly.dev");
  });

  it("keeps plain http for local dev (no forwarded proto)", () => {
    const req = new Request("http://localhost:3000/q/abc/llms.txt");
    expect(requestOrigin(req)).toBe("http://localhost:3000");
  });

  it("uses only the first hop of a multi-proxy X-Forwarded-Proto", () => {
    const req = new Request("http://quizocalypse-studio.fly.dev/q/abc", {
      headers: { "x-forwarded-proto": "https, http", host: "quizocalypse-studio.fly.dev" },
    });
    expect(requestOrigin(req)).toBe("https://quizocalypse-studio.fly.dev");
  });

  it("ignores a junk X-Forwarded-Proto value and falls back to the URL scheme", () => {
    const req = new Request("https://quizocalypse-studio.fly.dev/q/abc", {
      headers: { "x-forwarded-proto": "javascript", host: "quizocalypse-studio.fly.dev" },
    });
    expect(requestOrigin(req)).toBe("https://quizocalypse-studio.fly.dev");
  });

  it("prefers the Host header over the request URL's host", () => {
    const req = new Request("http://127.0.0.1:8080/q/abc", {
      headers: { "x-forwarded-proto": "https", host: "quizocalypse-studio.fly.dev" },
    });
    expect(requestOrigin(req)).toBe("https://quizocalypse-studio.fly.dev");
  });
});
