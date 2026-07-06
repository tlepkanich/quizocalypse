import { createHmac } from "node:crypto";

// BIC-2 A2(d) — outbound webhook signing for the integration-node executor
// (app/routes/q.$id.integration.tsx). Additive alongside the existing
// X-Quizocalypse-Secret header: receivers that already check the secret are
// unaffected; receivers that want tamper-proofing verify the signature.
//
// Receiver verification:
//   expected = "sha256=" + hex(HMAC_SHA256(raw_request_body_bytes, shared_secret))
//   compare against the X-Quizocalypse-Signature header (constant-time).
// The signature is computed over the EXACT raw body string sent — receivers
// must hash the bytes as received, not a re-serialized parse.
export function webhookSignatureHeader(rawBody: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
}
