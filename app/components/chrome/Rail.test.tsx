// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement } from "react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";

import { Rail } from "./Rail";

/* BIC-2 D3 — the §7.7 rail contract: collapse persists via localStorage
   ("qz-rail-collapsed", read in a mount effect so SSR stays expanded), the
   route-active item is marked aria-current, and the A2(b) Sign out affordance
   POSTs to /studio/logout. Rail uses Remix NavLink/Form (react-router
   underneath), so tests host it in a memory router.

   Node ≥22 shadows the global `localStorage` with its own file-backed store,
   which is method-less without --localstorage-file — stub a deterministic
   in-memory Storage so the persistence contract is actually exercisable. */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const backing = new Map<string, string>();
const memoryStorage: Storage = {
  get length() {
    return backing.size;
  },
  key: (i: number) => Array.from(backing.keys())[i] ?? null,
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => {
    backing.set(k, String(v));
  },
  removeItem: (k: string) => {
    backing.delete(k);
  },
  clear: () => backing.clear(),
};

beforeEach(() => {
  backing.clear();
  vi.stubGlobal("localStorage", memoryStorage);
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mountAt(path: string) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const router = createMemoryRouter([{ path: "*", element: createElement(Rail) }], {
    initialEntries: [path],
  });
  act(() => root!.render(createElement(RouterProvider, { router })));
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function aside(): HTMLElement {
  const el = document.body.querySelector("aside.qz-rail");
  if (!(el instanceof HTMLElement)) throw new Error("rail not rendered");
  return el;
}

function linkByLabel(label: string): HTMLAnchorElement {
  const a = Array.from(document.body.querySelectorAll("a")).find(
    (x) => (x.textContent ?? "").trim() === label,
  );
  if (!a) throw new Error(`no nav link "${label}"`);
  return a;
}

function buttonByAria(label: string): HTMLButtonElement {
  const btn = document.body.querySelector(`button[aria-label="${label}"]`);
  if (!(btn instanceof HTMLButtonElement)) throw new Error(`no button aria-label="${label}"`);
  return btn;
}

describe("Rail", () => {
  it("marks the route-active destination with aria-current (Home stays inactive off /studio)", () => {
    mountAt("/studio/quizzes");
    expect(linkByLabel("Quizzes").getAttribute("aria-current")).toBe("page");
    expect(linkByLabel("Home").getAttribute("aria-current")).toBeNull(); // end-matched
    expect(linkByLabel("Analytics").getAttribute("aria-current")).toBeNull();
  });

  it("collapse toggles the rail and persists to localStorage; expand persists back", () => {
    mountAt("/studio");
    expect(aside().classList.contains("is-collapsed")).toBe(false);

    act(() => buttonByAria("Collapse navigation").click());
    expect(aside().classList.contains("is-collapsed")).toBe(true);
    expect(localStorage.getItem("qz-rail-collapsed")).toBe("1");

    act(() => buttonByAria("Expand navigation").click());
    expect(aside().classList.contains("is-collapsed")).toBe(false);
    expect(localStorage.getItem("qz-rail-collapsed")).toBe("0");
  });

  it("a persisted collapse preference is restored on mount", () => {
    localStorage.setItem("qz-rail-collapsed", "1");
    mountAt("/studio");
    expect(aside().classList.contains("is-collapsed")).toBe(true);
  });

  it("Sign out is a POST form to /studio/logout with a real submit button", () => {
    mountAt("/studio");
    const form = document.body.querySelector('form[action="/studio/logout"]');
    if (!(form instanceof HTMLFormElement)) throw new Error("logout form missing");
    expect(form.getAttribute("method")?.toLowerCase()).toBe("post");
    const submit = Array.from(form.querySelectorAll('button[type="submit"]')).find((b) =>
      (b.textContent ?? "").includes("Sign out"),
    );
    expect(submit).toBeTruthy();
  });
});
