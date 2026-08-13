// QRTZ-G1 — the speculative-prefetch pure half: signature determinism +
// sensitivity, and the start/continue decision tables (cache hit, tombstone,
// supersede, stale-corpse handling).
import { describe, expect, it } from "vitest";
import {
  isSpecStale,
  poolSignature,
  SPEC_STALE_MS,
  specContinueDecision,
  specStartDecision,
  type SpeculativeMarker,
  type SpecSignatureInput,
} from "./specPrefetch";

const baseInput = (): SpecSignatureInput => ({
  pool: [
    { id: "cat_a", name: "Boards", members: ["p1", "p2"] },
    { id: "cat_b", name: "Boots", members: ["p3"] },
  ],
  goal: "Help riders find the right board",
  struggle: "",
  flow: "ai_generate",
});

const NOW = new Date("2026-08-13T12:00:00.000Z");
const FRESH_AT = new Date(NOW.getTime() - 30_000).toISOString();
const STALE_AT = new Date(NOW.getTime() - SPEC_STALE_MS - 1_000).toISOString();

const marker = (over: Partial<SpeculativeMarker> = {}): SpeculativeMarker => ({
  signature: poolSignature(baseInput()),
  status: "running",
  started_at: FRESH_AT,
  ...over,
});

describe("poolSignature", () => {
  it("is deterministic and versioned", () => {
    const sig = poolSignature(baseInput());
    expect(sig).toBe(poolSignature(baseInput()));
    expect(sig).toMatch(/^v1-[0-9a-f]{16}$/);
  });

  it("ignores row and member ORDER (DB order can never fake a miss)", () => {
    const shuffled: SpecSignatureInput = {
      ...baseInput(),
      pool: [
        { id: "cat_b", name: "Boots", members: ["p3"] },
        { id: "cat_a", name: "Boards", members: ["p2", "p1"] },
      ],
    };
    expect(poolSignature(shuffled)).toBe(poolSignature(baseInput()));
  });

  it("changes when a pool row's ID rotates (remove + re-add must miss)", () => {
    const rotated = baseInput();
    rotated.pool[0] = { ...rotated.pool[0]!, id: "cat_a2" };
    expect(poolSignature(rotated)).not.toBe(poolSignature(baseInput()));
  });

  it("changes when a row's membership changes (catalog resync honesty)", () => {
    const resynced = baseInput();
    resynced.pool[1] = { ...resynced.pool[1]!, members: ["p3", "p4"] };
    expect(poolSignature(resynced)).not.toBe(poolSignature(baseInput()));
  });

  it("changes with goal, struggle, question length, flow, and row name", () => {
    const sig = poolSignature(baseInput());
    expect(poolSignature({ ...baseInput(), goal: "Different goal entirely" })).not.toBe(sig);
    expect(poolSignature({ ...baseInput(), struggle: "sizing" })).not.toBe(sig);
    expect(poolSignature({ ...baseInput(), questionLength: 5 })).not.toBe(sig);
    expect(poolSignature({ ...baseInput(), flow: "goal_first" })).not.toBe(sig);
    const renamed = baseInput();
    renamed.pool[0] = { ...renamed.pool[0]!, name: "Snowboards" };
    expect(poolSignature(renamed)).not.toBe(sig);
  });

  it("keeps field boundaries unambiguous", () => {
    // Same concatenated text, different field split — must not collide.
    const a = poolSignature({ ...baseInput(), goal: "ab", struggle: "c" });
    const b = poolSignature({ ...baseInput(), goal: "a", struggle: "bc" });
    expect(a).not.toBe(b);
  });
});

describe("specStartDecision", () => {
  const sig = poolSignature(baseInput());

  it("starts with no marker", () => {
    expect(specStartDecision(undefined, sig, NOW)).toBe("start");
  });

  it("supersedes a DIFFERENT signature regardless of its status", () => {
    expect(specStartDecision(marker({ signature: "v1-other" }), sig, NOW)).toBe("start");
    expect(
      specStartDecision(marker({ signature: "v1-other", status: "ready" }), sig, NOW),
    ).toBe("start");
  });

  it("skips a same-signature run already in flight (one at a time)", () => {
    expect(specStartDecision(marker(), sig, NOW)).toBe("skip");
  });

  it("never speculates twice for the same signature (ready = cache hit)", () => {
    expect(specStartDecision(marker({ status: "ready" }), sig, NOW)).toBe("skip");
  });

  it("never auto-retries a failed signature (tombstone)", () => {
    expect(specStartDecision(marker({ status: "failed" }), sig, NOW)).toBe("skip");
  });

  it("restarts a stale running marker (the job died with the marker up)", () => {
    expect(specStartDecision(marker({ started_at: STALE_AT }), sig, NOW)).toBe("start");
  });
});

describe("specContinueDecision", () => {
  const sig = poolSignature(baseInput());

  it("runs fresh with no marker or a signature mismatch", () => {
    expect(specContinueDecision(undefined, sig, NOW)).toBe("fresh");
    expect(specContinueDecision(marker({ signature: "v1-other", status: "ready" }), sig, NOW)).toBe(
      "fresh",
    );
  });

  it("applies a matching READY result", () => {
    expect(specContinueDecision(marker({ status: "ready" }), sig, NOW)).toBe("apply");
  });

  it("attaches to a matching FRESH in-flight run", () => {
    expect(specContinueDecision(marker(), sig, NOW)).toBe("attach");
  });

  it("never attaches to a stale corpse — fresh instead", () => {
    expect(specContinueDecision(marker({ started_at: STALE_AT }), sig, NOW)).toBe("fresh");
  });

  it("treats a failed tombstone as fresh (silent discard — no merchant error)", () => {
    expect(specContinueDecision(marker({ status: "failed" }), sig, NOW)).toBe("fresh");
  });
});

describe("isSpecStale", () => {
  it("bounds the freshness window", () => {
    expect(isSpecStale(FRESH_AT, NOW)).toBe(false);
    expect(isSpecStale(STALE_AT, NOW)).toBe(true);
  });

  it("treats an unparseable timestamp as stale (never attach to it)", () => {
    expect(isSpecStale("not-a-date", NOW)).toBe(true);
  });
});
