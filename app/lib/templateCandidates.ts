// FLOW-3 — the "Generate Quiz Templates" front door's PURE half (unit-tested;
// no IO). The IO/job half lives in templateCandidates.server.ts (the
// goalPrepick.ts / goalPrepick.server.ts convention).

// The candidate generation's four-outcome failure copy (ai-fallbacks §1) —
// templates-page wording: the starter rail below IS the non-AI way forward, so
// every class points at it. Never renders raw error text.
export function friendlyTemplateGenError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/credit balance|billing|quota|insufficient|payment/i.test(msg)) {
    return "AI template generation is temporarily unavailable — start from a ready-made template below, or try again shortly.";
  }
  if (/rate.?limit|429|overloaded|529/i.test(msg)) {
    return "The AI is busy right now — try again in a moment, or start from a ready-made template below.";
  }
  return "We couldn't draft template ideas just now — try again, or start from a ready-made template below.";
}

// The limit_reached class (BIC-2 A3 budget refusal) — same surface wording.
export const TEMPLATE_GEN_LIMIT_ERROR =
  "Today's AI generation limit for this shop is reached — start from a ready-made template below, or try again tomorrow.";
