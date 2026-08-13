// QRTZ-G1 — speculative question-gen prefetch: the PURE half.
//
// While the merchant sits on the Recommendations (buckets) step, the funnel
// can run the exact generation chain their Continue would kick — keyed by a
// POOL SIGNATURE so the held result is only ever used when Continue's inputs
// match byte-for-byte-equivalently. This module owns the signature and the
// two decision tables (start / continue); it is pure and unit-tested
// (specPrefetch.test.ts). All I/O lives in specBuild.server.ts.

// What a speculation is keyed by. `pool` is the draft's Category rows — the
// row IDS matter (the built doc's targets reference them; a remove+re-add of
// the same product rotates the cuid and MUST miss), and each row's member
// product ids matter (a catalog resync that changes membership invalidates
// the held build honestly). `goal`/`struggle`/`questionLength` are the AI
// chain's text inputs; `flow` separates the goal-first (flow1-confirm) and
// pop-up-AI (continue-buckets) chains, which differ in exactly those inputs'
// derivation.
export interface SpecSignatureInput {
  pool: Array<{ id: string; name: string; members: string[] }>;
  goal: string;
  struggle: string;
  questionLength?: number;
  flow: "goal_first" | "ai_generate";
}

// The draft-side marker (build_session.speculative) as the decisions see it.
// The full schema (quizSchema.ts) also carries the held artifacts; decisions
// only read these four fields.
export interface SpeculativeMarker {
  signature: string;
  status: "running" | "ready" | "failed";
  started_at: string;
  committed?: boolean;
}

// A "running" marker older than this is presumed dead (the detached job was
// killed — deploy restart). The full chain measures ~170s worst-case (types +
// templates + question build); 300s gives a legitimately slow run margin.
// Continue must never ATTACH to a corpse (the merchant would sit out the
// 200s stall backstop for nothing), and a new settle may restart it.
export const SPEC_STALE_MS = 300_000;

// FNV-1a 64-bit over the canonical string — dependency-free and deterministic.
// Collision resistance here only needs to beat accidental drift in the
// merchant's own pool/goal, not an adversary.
function fnv1a64(text: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

/** The pool signature. Order-insensitive over rows and members (both are
 *  sorted into the canonical form) so DB row order can never fake a miss. */
export function poolSignature(input: SpecSignatureInput): string {
  const rows = [...input.pool]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((r) => `${r.id}\u0002${r.name}\u0002${[...r.members].sort().join(",")}`)
    .join("\u0003");
  const canonical = [
    rows,
    input.flow,
    input.questionLength === undefined ? "" : String(input.questionLength),
    input.goal,
    input.struggle,
  ].join("\u0001");
  return `v1-${fnv1a64(canonical)}`;
}

/** Should a settle ping start a (new) speculative chain?
 *   - no marker                         → start
 *   - DIFFERENT signature               → start (supersede: the old chain sees
 *                                         its marker replaced and halts at its
 *                                         next pass boundary — at most one
 *                                         LIVE speculation at a time)
 *   - same signature, ready             → skip (cache hit — never twice)
 *   - same signature, failed            → skip (tombstone — a failed
 *                                         speculation is never auto-retried)
 *   - same signature, running, fresh    → skip (already in flight)
 *   - same signature, running, stale    → start (the job died with the marker
 *                                         still up — a restart is honest) */
export function specStartDecision(
  spec: SpeculativeMarker | undefined,
  signature: string,
  now: Date,
): "start" | "skip" {
  if (!spec) return "start";
  if (spec.signature !== signature) return "start";
  if (spec.status === "ready" || spec.status === "failed") return "skip";
  return isSpecStale(spec.started_at, now) ? "start" : "skip";
}

/** What should Continue do with the marker?
 *   - ready + matching signature        → apply (near-instant transition)
 *   - running + matching + fresh        → attach (mark committed; the live
 *                                         chain's completion applies)
 *   - anything else (missing marker, signature drift, failed tombstone, or a
 *     stale "running" corpse)           → fresh (the normal chain; the fresh
 *                                         write clears the marker, halting
 *                                         any superseded chain) */
export function specContinueDecision(
  spec: SpeculativeMarker | undefined,
  signature: string,
  now: Date,
): "apply" | "attach" | "fresh" {
  if (!spec || spec.signature !== signature) return "fresh";
  if (spec.status === "ready") return "apply";
  if (spec.status === "running" && !isSpecStale(spec.started_at, now)) return "attach";
  return "fresh";
}

/** Is a running marker's job presumed dead? An unparseable timestamp counts
 *  as stale — never attach to something we can't age. */
export function isSpecStale(startedAt: string, now: Date): boolean {
  const t = Date.parse(startedAt);
  if (Number.isNaN(t)) return true;
  return now.getTime() - t > SPEC_STALE_MS;
}
