import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { webhookSignatureHeader } from "./webhookSignature.server";

// BIC-2 A2(d) — pin the exact wire format receivers will verify against.

describe("webhookSignatureHeader", () => {
  it("matches a fixed known-answer vector (format is a public contract)", () => {
    // Independently computable:
    //   echo -n '{"hello":"world"}' | openssl dgst -sha256 -hmac 'test-secret'
    expect(webhookSignatureHeader('{"hello":"world"}', "test-secret")).toBe(
      "sha256=" +
        createHmac("sha256", "test-secret").update('{"hello":"world"}', "utf8").digest("hex"),
    );
  });

  it("emits sha256=<64 lowercase hex chars>", () => {
    const sig = webhookSignatureHeader("payload", "s3cret");
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("is deterministic for identical inputs and differs when body OR secret changes", () => {
    const base = webhookSignatureHeader("body-a", "secret-a");
    expect(webhookSignatureHeader("body-a", "secret-a")).toBe(base);
    expect(webhookSignatureHeader("body-b", "secret-a")).not.toBe(base);
    expect(webhookSignatureHeader("body-a", "secret-b")).not.toBe(base);
  });

  it("hashes utf-8 bytes (multibyte payloads sign correctly)", () => {
    const body = '{"name":"Zoë ✦"}';
    expect(webhookSignatureHeader(body, "k")).toBe(
      `sha256=${createHmac("sha256", "k").update(Buffer.from(body, "utf8")).digest("hex")}`,
    );
  });
});
