import { describe, it, expect, vi } from "vitest";

import {
  createSaveTracker,
  initialSaveTrackerState,
  saveStatusOf,
  trackCommit,
  trackResult,
  trackSent,
} from "./saveTracker";

describe("saveTracker (pure)", () => {
  it("saved after an ok response carrying its sequence", () => {
    let s = trackCommit(initialSaveTrackerState);
    expect(saveStatusOf(s, 1)).toBe("pending");
    s = trackSent(s);
    s = trackResult(s, true);
    expect(saveStatusOf(s, 1)).toBe("saved");
  });

  it("failed after an error, then saved after a later success", () => {
    let s = trackSent(trackCommit(initialSaveTrackerState));
    s = trackResult(s, false);
    expect(saveStatusOf(s, 1)).toBe("failed");
    s = trackResult(trackSent(s), true); // Retry re-PUTs the same doc
    expect(saveStatusOf(s, 1)).toBe("saved");
    expect(s.failed).toBe(0);
  });

  it("an aborted PUT settles with the later PUT that carries it", () => {
    let s = trackSent(trackCommit(initialSaveTrackerState)); // PUT #1 carries seq 1
    s = trackSent(trackCommit(s)); // PUT #2 aborts #1, carries seq 2
    expect(saveStatusOf(s, 1)).toBe("pending");
    s = trackResult(s, true);
    expect(saveStatusOf(s, 1)).toBe("saved");
    expect(saveStatusOf(s, 2)).toBe("saved");
  });

  it("a newer commit stays pending while an older one is confirmed", () => {
    let s = trackResult(trackSent(trackCommit(initialSaveTrackerState)), true);
    s = trackCommit(s);
    expect(saveStatusOf(s, 1)).toBe("saved");
    expect(saveStatusOf(s, 2)).toBe("pending");
  });

  it("a result with nothing in flight changes nothing", () => {
    const s = trackCommit(initialSaveTrackerState);
    expect(trackResult(s, true)).toBe(s);
  });
});

describe("createSaveTracker tokens", () => {
  it("settles at once when the outcome is already known", async () => {
    const t = createSaveTracker();
    t.commit();
    t.sent();
    t.result(true);
    await expect(t.token().settled()).resolves.toBe("saved");
  });

  it("subscribers see pending → failed → saved", async () => {
    const t = createSaveTracker();
    t.commit();
    const tok = t.token();
    const seen = vi.fn();
    const off = tok.subscribe(seen);
    const settled = tok.settled();
    t.sent();
    t.result(false);
    await expect(settled).resolves.toBe("failed");
    t.sent();
    t.result(true);
    expect(seen.mock.calls.map((c) => c[0])).toEqual(["failed", "saved"]);
    off();
    expect(tok.status()).toBe("saved");
  });
});
