/* Per-commit save tracking for useQuizDraft (D8 — the field save pill is
   driven by the REAL save, never a timer). Pure bookkeeping, no React and no
   Remix, so the contract is unit-testable without a fetcher.

   Every commit takes a sequence number. Each PUT records the newest sequence
   it carries. Settling is by sequence, not by request: a new submit on the
   same fetcher aborts the one in flight (@remix-run/router's fetch() calls
   abortFetcher first), so an aborted PUT never reports back and its edit is
   confirmed by the later PUT that carries it.

     pending → saved    a PUT carrying this seq (or newer) returned ok
     pending → failed   the PUT carrying this seq returned an error
     failed  → saved    a LATER success (including Retry) carries it too
*/

export type SaveStatus = "pending" | "saved" | "failed";
export type SaveOutcome = "saved" | "failed";

export interface SaveToken {
  /** The commit sequence this token watches. */
  readonly seq: number;
  /** Current status (synchronous). */
  status(): SaveStatus;
  /** Called on every status change (pending→failed, failed→saved, …).
      Returns an unsubscribe function. */
  subscribe(listener: (status: SaveStatus) => void): () => void;
  /** Resolves on the first settled status ("saved" or "failed"). */
  settled(): Promise<SaveOutcome>;
}

export type SaveTrackerState = {
  /** Newest committed sequence (0 = nothing committed). */
  seq: number;
  /** Sequence carried by the PUT currently in flight, if any. */
  inFlight: number | null;
  /** Highest sequence confirmed saved. */
  confirmed: number;
  /** Highest sequence whose PUT failed and that no success has covered yet. */
  failed: number;
};

export const initialSaveTrackerState: SaveTrackerState = {
  seq: 0,
  inFlight: null,
  confirmed: 0,
  failed: 0,
};

/** A new commit: bump the sequence. */
export function trackCommit(s: SaveTrackerState): SaveTrackerState {
  return { ...s, seq: s.seq + 1 };
}

/** A PUT was submitted carrying everything up to the newest sequence. A
    submit replaces (aborts) any earlier in-flight PUT. */
export function trackSent(s: SaveTrackerState): SaveTrackerState {
  return { ...s, inFlight: s.seq };
}

/** The in-flight PUT returned. */
export function trackResult(s: SaveTrackerState, ok: boolean): SaveTrackerState {
  if (s.inFlight === null) return s;
  const carried = s.inFlight;
  if (ok) {
    const confirmed = Math.max(s.confirmed, carried);
    return { ...s, inFlight: null, confirmed, failed: s.failed <= confirmed ? 0 : s.failed };
  }
  return { ...s, inFlight: null, failed: Math.max(s.failed, carried) };
}

/** Status of one sequence under a tracker state. */
export function saveStatusOf(s: SaveTrackerState, seq: number): SaveStatus {
  if (s.confirmed >= seq) return "saved";
  if (s.failed >= seq) return "failed";
  return "pending";
}

/** A tiny mutable store around the pure functions, shared by every token a
    draft hands out. */
export function createSaveTracker() {
  let state = initialSaveTrackerState;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const l of Array.from(listeners)) l();
  };
  const set = (next: SaveTrackerState) => {
    if (next === state) return;
    state = next;
    emit();
  };

  function token(seq: number): SaveToken {
    return {
      seq,
      status: () => saveStatusOf(state, seq),
      subscribe(listener) {
        let last = saveStatusOf(state, seq);
        const onChange = () => {
          const now = saveStatusOf(state, seq);
          if (now === last) return;
          last = now;
          listener(now);
        };
        listeners.add(onChange);
        return () => {
          listeners.delete(onChange);
        };
      },
      settled() {
        const now = saveStatusOf(state, seq);
        if (now !== "pending") return Promise.resolve(now);
        return new Promise<SaveOutcome>((resolve) => {
          const onChange = () => {
            const st = saveStatusOf(state, seq);
            if (st === "pending") return;
            listeners.delete(onChange);
            resolve(st);
          };
          listeners.add(onChange);
        });
      },
    };
  }

  return {
    get state() {
      return state;
    },
    commit(): number {
      set(trackCommit(state));
      return state.seq;
    },
    sent() {
      set(trackSent(state));
    },
    result(ok: boolean) {
      set(trackResult(state, ok));
    },
    /** Token for a sequence (defaults to the newest commit). */
    token(seq: number = state.seq): SaveToken {
      return token(seq);
    },
  };
}

export type SaveTracker = ReturnType<typeof createSaveTracker>;
