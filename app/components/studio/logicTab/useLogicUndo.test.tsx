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

  it("a push of another kind always starts a new run (P2-7)", () => {
    const a = del("r1", 0);
    const r1 = undoRunReducer<Doc>(null, { type: "push", step: a, live: false });
    const r2 = undoRunReducer(r1, { type: "push", step: a, live: true, kind: "import" });
    expect(r2).toEqual({ kind: "import", steps: [a] });
    expect(undoLabel({ kind: "question", steps: [a, a] })).toBe("Undo");
  });

  it("labels: Undo / Undo both / Undo all N; a delete-only run stays Undo", () => {
    const move: UndoStep<Doc> = { isDelete: false, inverse: (d) => d };
    expect(undoLabel<Doc>(null)).toBe("Undo");
    expect(undoLabel({ kind: "rules", steps: [move] })).toBe("Undo");
    expect(undoLabel({ kind: "rules", steps: [move, move] })).toBe("Undo both");
    expect(undoLabel({ kind: "rules", steps: [move, del("x", 0), move] })).toBe("Undo all 3");
    expect(undoLabel({ kind: "rules", steps: [del("a", 0), del("b", 0), del("c", 0)] })).toBe("Undo");
  });

  it("applies inverses newest-first against the latest doc (unrelated edits survive)", () => {
    // Start [r1, r2, r3]; delete r2 (index 1) → [r1, r3]; delete r1 (index 0) → [r3].
    const run = { kind: "rules" as const, steps: [del("r2", 1), del("r1", 0)] };
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
  function App({ withHost }: { withHost: boolean }) {
    return createElement(QzToastProvider, null, withHost ? createElement(Host) : null);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    doc = { rules: ["r1", "r2", "r3"], note: "" };
    commit.mockClear();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(createElement(App, { withHost: true })));
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

  const message = () => (document.body.querySelector(".qz-toast")?.firstChild?.textContent ?? "").trim();

  it("the run counts its deletes, whichever surface pushed them (P1-5)", () => {
    act(() => push({ message: (n) => (n > 1 ? `${n} rules deleted` : "Rule 1 deleted"), inverse: (d) => d, isDelete: true }));
    expect(message()).toBe("Rule 1 deleted");
    act(() => push({ message: "Rule 1 moved to position 2", inverse: (d) => d }));
    act(() => push({ message: (n) => (n > 1 ? `${n} rules deleted` : "Rule 3 deleted"), inverse: (d) => d, isDelete: true }));
    expect(message()).toBe("2 rules deleted");
    expect(action()!.textContent).toBe("Undo all 3");
  });

  it("a question change waits while a rules Undo is live; an import replaces it (P2-7)", () => {
    act(() => push({ message: (n) => `${n} deleted`, inverse: (d) => d, isDelete: true }));
    act(() => push({ message: "Q2's 3 values were removed", kind: "question", inverse: (d) => d }));
    expect(message()).toBe("1 deleted");
    expect(action()!.textContent).toBe("Undo");
    act(() => push({ message: "Imported 2 changes", kind: "import", inverse: (d) => d }));
    expect(message()).toBe("Imported 2 changes");
    expect(action()!.textContent).toBe("Undo");
  });

  it("an Undo that changes nothing says so (P2-8)", () => {
    act(() => push({ message: "Imported 1 change", kind: "import", inverse: (d) => d, staleMessage: "Can't undo" }));
    act(() => action()!.click());
    expect(commit).not.toHaveBeenCalled();
    expect(message()).toBe("Can't undo");
  });

  it("unmounting the host drops the run and hides its toast (P1-10)", () => {
    act(() => push({ message: "Rule 1 deleted", inverse: del("r1", 0).inverse, isDelete: true }));
    expect(action()).not.toBeNull();
    act(() => root!.render(createElement(App, { withHost: false })));
    act(() => void vi.advanceTimersByTime(10));
    expect(action()).toBeNull();
    expect(document.body.querySelector(".qz-toast")).toBeNull();
    expect(commit).not.toHaveBeenCalled();
  });
});
