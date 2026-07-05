// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement } from "react";

import { QzModal } from "./qz-overlays";
import { nextToastState } from "./qz-toast";

// React 18/19 act() outside a test renderer needs the flag.
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
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  document.body.replaceChildren();
});

describe("QzModal (design-system-V2 §7.5 contract)", () => {
  it("renders a dialog with the title, portaled to document.body", () => {
    mount(
      createElement(QzModal, { open: true, onClose: () => {}, title: "Pick a template" }, "Body copy"),
    );
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog!.textContent).toContain("Pick a template");
    expect(dialog!.textContent).toContain("Body copy");
  });

  it("Escape closes a NON-destructive modal", () => {
    const onClose = vi.fn();
    mount(createElement(QzModal, { open: true, onClose, title: "Info" }, "x"));
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape does NOT close a destructive confirm (explicit button press required)", () => {
    const onClose = vi.fn();
    mount(createElement(QzModal, { open: true, onClose, destructive: true, title: "Delete?" }, "x"));
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
    // Destructive confirms render as alertdialog and never show a ✕.
    expect(document.body.querySelector('[role="alertdialog"]')).toBeTruthy();
    expect(document.body.querySelector(".qz-modal-x")).toBeNull();
  });

  it("non-destructive content modals (md/lg) show the ✕; destructive never does", () => {
    mount(createElement(QzModal, { open: true, onClose: () => {}, size: "md", title: "Edit" }, "x"));
    expect(document.body.querySelector(".qz-modal-x")).toBeTruthy();
  });
});

describe("toast queue-of-1 (nextToastState)", () => {
  it("a new message always REPLACES the current one — never stacks", () => {
    const first = nextToastState(null, "Saved", 1);
    expect(first).toEqual({ id: 1, message: "Saved" });
    const second = nextToastState(first, "Added to quiz", 2);
    expect(second).toEqual({ id: 2, message: "Added to quiz" });
  });
});
