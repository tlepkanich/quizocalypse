// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Quiz } from "../../../lib/quizSchema";
import { ContentTab } from "./ContentTab";

// Owner 2026-09-16 — the intro editor's "Show an intro page" toggle writes
// data.hidden (true = the published quiz starts on the first step). These pin
// the sparse-write contract: unchecking writes hidden:true, re-checking
// removes the key (undefined serialises away), other intro fields untouched.

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const fixture = () =>
  Quiz.parse({
    quiz_id: "ct",
    scope: { collection_ids: [] },
    nodes: [
      {
        id: "intro",
        type: "intro",
        position: { x: 0, y: 0 },
        data: { headline: "Welcome", subtext: "Sub" },
      },
      {
        id: "q1",
        type: "question",
        position: { x: 0, y: 0 },
        data: {
          text: "Q",
          question_type: "single_select",
          answers: [
            { id: "a", text: "A", edge_handle_id: "ha", tags: [] },
            { id: "b", text: "B", edge_handle_id: "hb", tags: [] },
          ],
        },
      },
    ],
    edges: [{ id: "e", source: "intro", target: "q1" }],
  });

let root: Root | undefined;
let host: HTMLDivElement;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
});
function mount(el: React.ReactElement) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(el));
}
const checkbox = () =>
  Array.from(document.querySelectorAll("label"))
    .find((l) => l.textContent?.includes("Show an intro page"))
    ?.querySelector("input");

describe("ContentTab — intro visibility toggle", () => {
  it("unchecking writes hidden:true; nothing else on the intro changes", () => {
    const doc = fixture();
    const commit = vi.fn();
    mount(createElement(ContentTab, { doc, node: doc.nodes[0]!, onCommit: commit }));
    const box = checkbox();
    expect(box?.checked).toBe(true);
    act(() => box!.click());
    const next = commit.mock.lastCall?.[0] as Quiz;
    const intro = next.nodes.find((n) => n.type === "intro");
    expect(intro?.type === "intro" && intro.data.hidden).toBe(true);
    expect(intro?.type === "intro" && intro.data.headline).toBe("Welcome");
  });

  it("re-checking clears the flag (undefined — serialises away, legacy-sparse)", () => {
    const doc = fixture();
    const hiddenDoc = {
      ...doc,
      nodes: doc.nodes.map((n) =>
        n.type === "intro" ? { ...n, data: { ...n.data, hidden: true } } : n,
      ),
    } as Quiz;
    const commit = vi.fn();
    mount(
      createElement(ContentTab, { doc: hiddenDoc, node: hiddenDoc.nodes[0]!, onCommit: commit }),
    );
    const box = checkbox();
    expect(box?.checked).toBe(false);
    act(() => box!.click());
    const next = commit.mock.lastCall?.[0] as Quiz;
    const intro = next.nodes.find((n) => n.type === "intro");
    expect(intro?.type === "intro" && intro.data.hidden).toBeUndefined();
    expect(JSON.stringify(next)).not.toContain('"hidden"');
  });
});
