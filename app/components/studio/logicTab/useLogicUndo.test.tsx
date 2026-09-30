// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement } from "react";

import { QzToastProvider } from "../../qz-toast";
import { applyUndoRun, undoLabel, undoRunReducer, useLogicUndo, type UndoStep } from "./useLogicUndo";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

type Doc = { rules: string[]; note: string };

const del = (rule: string, at: number): UndoStep<Doc> => ({
  isDelete: true,
  inverse: (d) => ({ ...d, rules: [...d.rules.slice(0, at), rule, ...d.rules.slice(at)] }),
});

describe("undo run accumulation (pure)", () => {
  it("a push while live extends the run; otherwise starts a new one", () => {
    const a = del("r1", 0);
    const b = del("r2", 0);
    const r1 = undoRunReducer<Doc>(null, { type: "push", step: a, live: false });
    const r2 = undoRunReducer(r1, { type: "push", step: b, live: true });
    expect(r2!.steps).toEqual([a, b]);
    const r3 = undoRunReducer(r2, { type: "push", step: a, live: false });
    expect(r3!.steps).toEqual([a]);
    expect(undoRunReducer(r3, { type: "clear" })).toBeNull();
  });

  it("labels: Undo / Undo both / Undo all N; a delete-only run stays Undo", () => {
    const move: UndoStep<Doc> = { isDelete: false, inverse: (d) => d };
    expect(undoLabel<Doc>(null)).toBe("Undo");
    expect(undoLabel({ steps: [move] })).toBe("Undo");
    expect(undoLabel({ steps: [move, move] })).toBe("Undo both");
    expect(undoLabel({ steps: [move, del("x", 0), move] })).toBe("Undo all 3");
    expect(undoLabel({ steps: [del("a", 0), del("b", 0), del("c", 0)] })).toBe("Undo");
  });

  it("applies inverses newest-first against the latest doc (unrelated edits survive)", () => {
    // Start [r1, r2, r3]; delete r2 (index 1) → [r1, r3]; delete r1 (index 0) → [r3].
    const run = { steps: [del("r2", 1), del("r1", 0)] };
    // Meanwhile an unrelated edit landed.
    const latest: Doc = { rules: ["r3"], note: "edited while the toast was up" };
    expect(applyUndoRun(latest, run)).toEqual({ rules: ["r1", "r2", "r3"], note: "edited while the toast was up" });
  });
});

describe("useLogicUndo with the real toast", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;
  let doc: Doc = { rules: ["r1", "r2", "r3"], note: "" };
  const commit = vi.fn((d: Doc) => {
    doc = d;
  });
  let push: ReturnType<typeof useLogicUndo<Doc>>["push"] = () => {};

  function Host() {
    push = useLogicUndo<Doc>({ getLatestDoc: () => doc, commit }).push;
    return null;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    doc = { rules: ["r1", "r2", "r3"], note: "" };
    commit.mockClear();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(createElement(QzToastProvider, null, createElement(Host))));
  });

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  const action = () => document.body.querySelector(".qz-toast-action") as HTMLButtonElement | null;

  it("several steps in a row become ONE Undo that commits once", () => {
    act(() => {
      doc = { ...doc, rules: ["r1", "r3"] };
      push({ message: "Rule deleted", inverse: del("r2", 1).inverse, isDelete: true });
    });
    expect(action()!.textContent).toBe("Undo");
    act(() => {
      doc = { ...doc, rules: ["r3", "r1"] };
      push({ message: "Rule moved", inverse: (d) => ({ ...d, rules: [...d.rules].reverse() }) });
    });
    expect(action()!.textContent).toBe("Undo both");
    act(() => {
      doc = { ...doc, note: "typed meanwhile" };
    });
    act(() => action()!.click());
    expect(commit).toHaveBeenCalledTimes(1);
    expect(doc).toEqual({ rules: ["r1", "r2", "r3"], note: "typed meanwhile" });
    expect(action()).toBeNull();
  });

  it("after the toast times out, the next step starts a fresh run", () => {
    act(() => push({ message: "Rule moved", inverse: (d) => d }));
    act(() => void vi.advanceTimersByTime(6100));
    expect(action()).toBeNull();
    act(() => push({ message: "Rule moved", inverse: (d) => d }));
    expect(action()!.textContent).toBe("Undo");
  });
});
