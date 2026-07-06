// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement } from "react";

import { BuilderDesignPanel } from "./BuilderDesignPanel";
import { Quiz, DesignTokens } from "../../lib/quizSchema";

/* BIC-2 D3 — the writeTokens safeParse seam (D6b): every edit flows through
   DesignTokens.safeParse before the whole-doc commit (an unparseable
   design_tokens 500s SSR), and invalid input NEVER commits. Pinned through
   the public prop seam only (doc + commit). */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(el: React.ReactElement) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
}

afterEach(() => {
  vi.restoreAllMocks();
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  document.body.replaceChildren();
});

// Through Quiz.parse — design_tokens defaults in via the schema.
const doc = () =>
  Quiz.parse({
    quiz_id: "qz1",
    scope: { collection_ids: [] },
    nodes: [
      { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
      {
        id: "q1",
        type: "question",
        position: { x: 0, y: 0 },
        data: {
          text: "Pick one",
          question_type: "single_select",
          answers: [
            { id: "a1", text: "A", tags: [], edge_handle_id: "h1" },
            { id: "a2", text: "B", tags: [], edge_handle_id: "h2" },
          ],
        },
      },
      { id: "r1", type: "result", position: { x: 0, y: 0 }, data: { headline: "Done", fallback_collection_id: "c1" } },
    ],
    edges: [
      { id: "e1", source: "intro", target: "q1" },
      { id: "e2", source: "q1", target: "r1" },
    ],
  });

function buttonByText(text: string): HTMLButtonElement {
  const btn = Array.from(document.body.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === text,
  );
  if (!btn) throw new Error(`no button "${text}"`);
  return btn;
}

function logoUrlInput(): HTMLInputElement {
  const el = document.body.querySelector('input[aria-label="Logo image URL"]');
  if (!(el instanceof HTMLInputElement)) throw new Error("logo URL input not rendered");
  return el;
}

function typeAndBlur(el: HTMLInputElement, value: string) {
  const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  desc?.set?.call(el, value);
  act(() => {
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => {
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

describe("BuilderDesignPanel — writeTokens safeParse seam", () => {
  it("a Shape edit commits ONE whole-doc update whose design_tokens re-validate", () => {
    const d = doc();
    const commit = vi.fn();
    mount(createElement(BuilderDesignPanel, { doc: d, commit }));

    act(() => buttonByText("Rounded").click());

    expect(commit).toHaveBeenCalledTimes(1);
    const committed = commit.mock.calls[0]![0] as Quiz;
    expect(committed.design_tokens.radius).toBe("rounded");
    expect(DesignTokens.safeParse(committed.design_tokens).success).toBe(true);
    // Whole-doc commit: everything outside design_tokens is untouched.
    expect(committed.nodes).toEqual(d.nodes);
    expect(committed.edges).toEqual(d.edges);
  });

  it("an unsafe logo URL (http://) never commits — validator refuses before the write", () => {
    const commit = vi.fn();
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    mount(createElement(BuilderDesignPanel, { doc: doc(), commit }));

    typeAndBlur(logoUrlInput(), "http://not-safe.example/logo.png");

    expect(alert).toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it("a safe https logo URL commits a valid logo token with defaults (md / center)", () => {
    const commit = vi.fn();
    mount(createElement(BuilderDesignPanel, { doc: doc(), commit }));

    typeAndBlur(logoUrlInput(), "https://cdn.example.com/logo.png");

    expect(commit).toHaveBeenCalledTimes(1);
    const committed = commit.mock.calls[0]![0] as Quiz;
    expect(committed.design_tokens.logo).toEqual({
      url: "https://cdn.example.com/logo.png",
      size: "md",
      align: "center",
    });
    expect(DesignTokens.safeParse(committed.design_tokens).success).toBe(true);
  });

  it("turning Progress off commits a parse-valid progress_bar patch", () => {
    const commit = vi.fn();
    mount(createElement(BuilderDesignPanel, { doc: doc(), commit }));

    act(() => buttonByText("Off").click());

    expect(commit).toHaveBeenCalledTimes(1);
    const committed = commit.mock.calls[0]![0] as Quiz;
    expect(committed.design_tokens.progress_bar?.enabled).toBe(false);
    expect(DesignTokens.safeParse(committed.design_tokens).success).toBe(true);
  });
});
