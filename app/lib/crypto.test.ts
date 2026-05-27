import { describe, expect, it, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";
import { encrypt, decrypt } from "./crypto";

describe("crypto", () => {
  beforeAll(() => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  });

  it("roundtrips a token", () => {
    const token = "shpat_abcd1234EFGH5678ijkl";
    const encrypted = encrypt(token);
    expect(encrypted).not.toContain(token);
    expect(decrypt(encrypted)).toBe(token);
  });

  it("produces a different ciphertext each time (IV is random)", () => {
    const token = "same-token";
    expect(encrypt(token)).not.toBe(encrypt(token));
  });

  it("rejects a tampered payload via the auth tag", () => {
    const ciphertext = encrypt("secret");
    const tampered = Buffer.from(ciphertext, "base64");
    if (tampered[tampered.length - 1] !== undefined) {
      tampered[tampered.length - 1]! ^= 0x01;
    }
    expect(() => decrypt(tampered.toString("base64"))).toThrow();
  });

  it("rejects too-short payloads", () => {
    expect(() => decrypt("short")).toThrow();
  });
});
