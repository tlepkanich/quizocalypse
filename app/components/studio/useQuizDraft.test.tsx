// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement } from "react";

import type { Quiz } from "../../lib/quizSchema";
import { useQuizDraft } from "./useQuizDraft";

/* A controllable stand-in for Remix's useFetcher: submit() flips it busy,
   finish()/crash() bring it back to idle with (or without) new data. */
type FakeData = { ok: boolean; savedAt?: string; error?: string } | undefined;
const fake: {
  submits: number;
  finish: (data: FakeData) => void;
  crash: () => void;
} = { submits: 0, finish: () => {}, crash: () => {} };

vi.mock("@remix-run/react", async () => {
  const React = await import("react");
  return {
    useFetcher: () => {
      const [st, setSt] = React.useState<{ state: "idle" | "submitting"; data: FakeData }>({
        state: "idle",
        data: undefined,
      });
      fake.finish = (data) => setSt({ state: "idle", data });
      fake.crash = () => setSt((s) => ({ state: "idle", data: s.data }));
      return {
        state: st.state,
        data: st.data,
        submit: () => {
          fake.submits += 1;
          setSt((s) => ({ ...s, state: "submitting" }));
        },
      };
    },
  };
});

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

type Draft = ReturnType<typeof useQuizDraft>;
let api: Draft | null = null;
function Harness({ initial }: { initial: Quiz }) {
  api = useQuizDraft(initial);
  return null;
}

const docA = { title: "A" } as unknown as Quiz;
const docB = { title: "B" } as unknown as Quiz;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  fake.submits = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(createElement(Harness, { initial: docA })));
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  api = null;
  vi.useRealTimers();
});

const draft = (): Draft => {
  if (!api) throw new Error("harness not mounted");
  return api;
};

describe("useQuizDraft — D8 save tokens and awaitable flush", () => {
  it("a tracked commit is pending through the debounce and saved when its PUT returns ok", () => {
    let tok = draft().pendingToken();
    act(() => {
      tok = draft().commitTracked(docB);
    });
    expect(tok.status()).toBe("pending");
    act(() => void vi.advanceTimersByTime(700));
    expect(fake.submits).toBe(1);
    expect(tok.status()).toBe("pending");
    act(() => fake.finish({ ok: true, savedAt: "now" }));
    expect(tok.status()).toBe("saved");
  });

  it("flush() sends now and resolves with the outcome", async () => {
    act(() => draft().commit(docB));
    let p: Promise<string> = Promise.resolve("");
    act(() => {
      p = draft().flush();
    });
    expect(fake.submits).toBe(1);
    act(() => fake.finish({ ok: false, error: "Invalid quiz document" }));
    await expect(p).resolves.toBe("failed");
  });

  it("a failed save turns to saved after Retry succeeds", () => {
    let tok = draft().pendingToken();
    act(() => {
      tok = draft().commitTracked(docB);
    });
    act(() => void draft().flush());
    act(() => fake.finish({ ok: false, error: "x" }));
    expect(tok.status()).toBe("failed");
    act(() => draft().retrySave());
    act(() => fake.finish({ ok: true }));
    expect(tok.status()).toBe("saved");
  });

  it("an edit whose PUT was superseded settles with the later PUT", () => {
    let first = draft().pendingToken();
    act(() => {
      first = draft().commitTracked(docB);
    });
    act(() => void draft().flush());
    act(() => void draft().commitTracked(docA));
    act(() => void draft().flush()); // aborts the first PUT (stays busy)
    expect(fake.submits).toBe(2);
    act(() => fake.finish({ ok: true }));
    expect(first.status()).toBe("saved");
  });

  it("a thrown/network failure (idle with no new data) counts as failed", () => {
    let tok = draft().pendingToken();
    act(() => {
      tok = draft().commitTracked(docB);
    });
    act(() => void draft().flush());
    act(() => fake.crash());
    expect(tok.status()).toBe("failed");
  });

  it("flush() waits out an AI pause and settles after the resumed save", async () => {
    act(() => void draft().beginAiEdit());
    act(() => draft().commit(docB));
    let p: Promise<string> = Promise.resolve("");
    act(() => {
      p = draft().flush();
    });
    expect(fake.submits).toBe(0);
    act(() => draft().endAiEdit());
    act(() => void vi.advanceTimersByTime(700));
    expect(fake.submits).toBe(1);
    act(() => fake.finish({ ok: true }));
    await expect(p).resolves.toBe("saved");
  });

  it("with nothing committed, flush() is already saved", async () => {
    await expect(draft().flush()).resolves.toBe("saved");
  });
});
