// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement } from "react";

import {
  QzMenu,
  QzModal,
  QzPopover,
  computePopoverPlacement,
  nextRovingIndex,
  pickPopoverInitialFocus,
} from "./qz-overlays";
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

describe("QzModal — LOGIC-STEP Phase 3 options", () => {
  it("a plain modal closes on a scrim mousedown; a draftSafe one does not", () => {
    const onClose = vi.fn();
    mount(createElement(QzModal, { open: true, onClose, title: "Rule" }, "x"));
    const scrim = document.body.querySelector(".qz-modal-scrim")!;
    act(() => void scrim.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => root?.unmount());
    root = null;
    document.body.replaceChildren();

    const onClose2 = vi.fn();
    mount(createElement(QzModal, { open: true, onClose: onClose2, title: "Rule", draftSafe: true }, "x"));
    const scrim2 = document.body.querySelector(".qz-modal-scrim")!;
    act(() => void scrim2.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(onClose2).not.toHaveBeenCalled();
    // Esc still closes a draft-safe window.
    act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(onClose2).toHaveBeenCalledTimes(1);
  });

  it("makes the page inert while open (live regions excepted) and restores it", () => {
    const page = document.createElement("main");
    const live = document.createElement("div");
    live.setAttribute("data-qz-keep-live", "");
    document.body.append(page, live);
    mount(createElement(QzModal, { open: true, onClose: () => {}, title: "Rule" }, "x"));
    expect(page.inert).toBe(true);
    expect(live.inert).toBeFalsy();
    expect((document.body.querySelector(".qz-modal-scrim") as HTMLElement).inert).toBeFalsy();
    act(() => root!.render(createElement(QzModal, { open: false, onClose: () => {}, title: "Rule" }, "x")));
    expect(page.inert).toBe(false);
  });

  it("lockScroll hides the page overflow only while open", () => {
    mount(createElement(QzModal, { open: true, onClose: () => {}, lockScroll: true }, "x"));
    expect(document.documentElement.style.overflow).toBe("hidden");
    act(() => root!.render(createElement(QzModal, { open: false, onClose: () => {}, lockScroll: true }, "x")));
    expect(document.documentElement.style.overflow).toBe("");
  });

  it("returnFocus runs on close when the opener is gone", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const fallback = document.createElement("button");
    document.body.appendChild(fallback);
    const returnFocus = vi.fn(() => fallback.focus());
    mount(createElement(QzModal, { open: true, onClose: () => {}, returnFocus }, "x"));
    opener.remove();
    act(() => root!.render(createElement(QzModal, { open: false, onClose: () => {}, returnFocus }, "x")));
    expect(returnFocus).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(fallback);
  });
});

describe("computePopoverPlacement (mock placePop, B27)", () => {
  const vp = { width: 1000, height: 800 };
  const base = {
    viewport: vp,
    popWidth: 300,
    listHeight: null,
    placement: "bottom" as const,
    align: "start" as const,
    offset: 6,
  };

  it("sits below the anchor when it fits", () => {
    const p = computePopoverPlacement({ ...base, anchor: { top: 100, bottom: 120, left: 50, right: 90 }, popHeight: 200 });
    expect(p).toEqual({ side: "bottom", left: 50, edge: 126, maxHeight: null, listMaxHeight: null });
  });

  it("flips above when it does not fit below and there is more room above", () => {
    const p = computePopoverPlacement({ ...base, anchor: { top: 600, bottom: 620, left: 50, right: 90 }, popHeight: 300 });
    expect(p.side).toBe("top");
    expect(p.edge).toBe(594);
    expect(p.maxHeight).toBeNull();
  });

  it("caps to the room and the list gives up height first", () => {
    const p = computePopoverPlacement({
      ...base,
      anchor: { top: 300, bottom: 320, left: 50, right: 90 },
      popHeight: 600,
      listHeight: 500,
    });
    // below = 800-320-14 = 466 > above = 286 → stays below, capped.
    expect(p.side).toBe("bottom");
    expect(p.maxHeight).toBe(466);
    expect(p.listMaxHeight).toBe(366);
  });

  it("never exceeds the stylesheet cap; the list absorbs the difference", () => {
    const p = computePopoverPlacement({
      ...base,
      anchor: { top: 100, bottom: 120, left: 50, right: 90 },
      popHeight: 900,
      listHeight: 800,
      heightCap: 480,
    });
    expect(p.maxHeight).toBe(480);
    expect(p.listMaxHeight).toBe(380);
  });

  it("keeps the side decided at open", () => {
    const p = computePopoverPlacement({
      ...base,
      anchor: { top: 100, bottom: 120, left: 50, right: 90 },
      popHeight: 200,
      decidedSide: "top",
    });
    expect(p.side).toBe("top");
    expect(p.maxHeight).toBe(120);
  });

  it("end-aligns to the trigger and clamps to an 8px margin", () => {
    const end = computePopoverPlacement({
      ...base,
      align: "end",
      anchor: { top: 100, bottom: 120, left: 500, right: 600 },
      popHeight: 100,
    });
    expect(end.left).toBe(300);
    const clamped = computePopoverPlacement({ ...base, anchor: { top: 100, bottom: 120, left: 900, right: 950 }, popHeight: 100 });
    expect(clamped.left).toBe(692);
  });
});

describe("menu keyboard helpers", () => {
  it("nextRovingIndex wraps and jumps", () => {
    expect(nextRovingIndex(-1, 3, "ArrowDown")).toBe(0);
    expect(nextRovingIndex(-1, 3, "ArrowUp")).toBe(2);
    expect(nextRovingIndex(2, 3, "ArrowDown")).toBe(0);
    expect(nextRovingIndex(0, 3, "ArrowUp")).toBe(2);
    expect(nextRovingIndex(1, 3, "Home")).toBe(0);
    expect(nextRovingIndex(1, 3, "End")).toBe(2);
    expect(nextRovingIndex(1, 3, "Enter")).toBeNull();
    expect(nextRovingIndex(0, 0, "ArrowDown")).toBeNull();
  });

  it("pickPopoverInitialFocus: chosen item, then search, then first control", () => {
    const box = document.createElement("div");
    box.innerHTML =
      '<button>First</button><input type="search"><button role="menuitemradio" aria-checked="true">On</button>';
    expect(pickPopoverInitialFocus(box).textContent).toBe("On");
    box.querySelector('[role="menuitemradio"]')!.remove();
    expect(pickPopoverInitialFocus(box).tagName).toBe("INPUT");
    box.querySelector("input")!.remove();
    expect(pickPopoverInitialFocus(box).textContent).toBe("First");
  });
});

describe("QzPopover / QzMenu focus and semantics", () => {
  it("ariaHaspopup is a prop (default dialog)", () => {
    mount(
      createElement("div", null,
        createElement(QzPopover, { trigger: createElement("button", { id: "a" }, "A"), content: "x" }),
        createElement(QzPopover, { trigger: createElement("button", { id: "b" }, "B"), content: "x", ariaHaspopup: "listbox" }),
      ),
    );
    expect(document.getElementById("a")!.getAttribute("aria-haspopup")).toBe("dialog");
    expect(document.getElementById("b")!.getAttribute("aria-haspopup")).toBe("listbox");
  });

  it("QzMenu: checked items are menuitemradio; focus goes to the chosen one; arrows rove; Esc returns focus", () => {
    const pick = vi.fn();
    mount(
      createElement(QzMenu, {
        trigger: createElement("button", { id: "trig" }, "Style"),
        ariaLabel: "Logic style",
        items: [
          { label: "Filter Results + Rules", checked: false, onSelect: pick },
          { label: "Rules only", checked: true, onSelect: pick },
        ],
      }),
    );
    const trig = document.getElementById("trig")!;
    expect(trig.getAttribute("aria-haspopup")).toBe("menu");
    act(() => trig.click());
    const items = Array.from(document.body.querySelectorAll('[role="menuitemradio"]'));
    expect(items.map((i) => i.getAttribute("aria-checked"))).toEqual(["false", "true"]);
    expect(document.activeElement).toBe(items[1]);
    act(() => {
      items[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    expect(document.activeElement).toBe(items[0]);
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trig);
  });

  it("QzMenu: Tab closes the menu and hands focus back to the trigger", () => {
    mount(
      createElement(QzMenu, {
        trigger: createElement("button", { id: "trig2" }, "More"),
        items: [{ label: "Duplicate", onSelect: () => {} }],
      }),
    );
    const trig = document.getElementById("trig2")!;
    act(() => trig.click());
    const item = document.body.querySelector('[role="menuitem"]') as HTMLElement;
    expect(document.activeElement).toBe(item);
    act(() => {
      item.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    });
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trig);
  });
});
