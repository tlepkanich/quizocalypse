// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement } from "react";

import { RecPageV2Panel } from "./RecPageV2Panel";
import { Quiz } from "../../lib/quizSchema";
import type { BuilderCategory, BuilderCollection } from "../builder/stepProps";

/* BIC-2 D3 — the sparse-override contract at unit level (rec-page-spec-V2
   §2/§3, live-proven in L2-8; these pin it):
   · toggling "Give this its own page" ON commits NOTHING (sparse — nothing
     diverges until a field is set);
   · editing one override field commits exactly {that key} for that target;
   · clearing the last stored field re-inherits — the override AND the empty
     rec_page_settings root are dropped;
   · global-only fields (§2.1: grid/OOS/fallbacks/descriptions/capture) are
     hidden at target scope so they can never leak into an override;
   · unchecking Lock under a LOCKED global stores an explicit false (dropping
     the key would just re-inherit the global lock). */

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

// Fixtures go through Quiz.parse — never hand-shaped literals.
const doc = (patch: Record<string, unknown> = {}) =>
  Quiz.parse({
    quiz_id: "qz1",
    scope: { collection_ids: [] },
    logic_model: "decider",
    nodes: [
      { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
      {
        id: "q1",
        type: "question",
        position: { x: 0, y: 0 },
        data: {
          text: "Terrain?",
          question_type: "single_select",
          role: "decides",
          answers: [
            { id: "park", text: "Park", tags: [], edge_handle_id: "h1", target_id: "cat_park" },
            { id: "powder", text: "Powder", tags: [], edge_handle_id: "h2", target_id: "cat_powder" },
          ],
        },
      },
      { id: "r1", type: "result", position: { x: 0, y: 0 }, data: { headline: "Match", fallback_collection_id: "c1" } },
    ],
    edges: [
      { id: "e1", source: "intro", target: "q1" },
      { id: "e2", source: "q1", target: "r1" },
    ],
    ...patch,
  });

const CATS: BuilderCategory[] = [
  {
    id: "cat_park",
    name: "Park",
    description: "",
    tags: [],
    productIds: ["p1"],
    source: "collection",
    sourceRef: "c1",
    quizId: "db1",
  },
  {
    id: "cat_powder",
    name: "Powder",
    description: "",
    tags: [],
    productIds: ["p2"],
    source: "collection",
    sourceRef: "c2",
    quizId: "db1",
  },
];
const COLS: BuilderCollection[] = [{ collectionId: "c1", title: "Everything" }];

function panel(
  d: Quiz,
  onCommit: (next: Quiz) => void,
  selectedTargetId: string | null,
) {
  return createElement(RecPageV2Panel, {
    doc: d,
    quizId: "db1",
    categories: CATS,
    collections: COLS,
    onCommit,
    selectedTargetId,
    onSelectTarget: () => {},
  });
}

/** The input/textarea/checkbox inside the label whose text includes `labelText`. */
function fieldInput(labelText: string): HTMLInputElement {
  const label = Array.from(document.body.querySelectorAll("label")).find((l) =>
    (l.textContent ?? "").includes(labelText),
  );
  const input = label?.querySelector("input, textarea, select");
  if (!input) throw new Error(`no field labeled "${labelText}"`);
  return input as HTMLInputElement;
}

function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = Object.getPrototypeOf(el) as object;
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  desc?.set?.call(el, value);
  act(() => {
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("RecPageV2Panel — sparse per-target overrides", () => {
  it("toggling 'own page' ON commits nothing; fields appear prefilled with the inherited global", () => {
    const onCommit = vi.fn();
    mount(panel(doc(), onCommit, "cat_park"));

    act(() => fieldInput("Give this result its own page").click());
    expect(onCommit).not.toHaveBeenCalled(); // sparse: no divergence yet

    const headline = fieldInput("Headline");
    expect(headline.value).toBe("Your perfect match"); // the read-time default
    expect(document.body.textContent).toContain("inherits global");
  });

  it("editing one override field commits exactly {that key} under that target", () => {
    const onCommit = vi.fn();
    mount(panel(doc(), onCommit, "cat_park"));
    act(() => fieldInput("Give this result its own page").click());

    typeInto(fieldInput("Headline"), "Park picks");

    expect(onCommit).toHaveBeenCalledTimes(1);
    const committed = onCommit.mock.calls[0]![0] as Quiz;
    expect(committed.rec_page_settings).toEqual({
      global: {},
      overrides: { cat_park: { headline: "Park picks" } },
    });
  });

  it("clearing the last stored field re-inherits: the override AND the empty settings root drop", () => {
    const onCommit = vi.fn();
    const d = doc({
      rec_page_settings: { global: {}, overrides: { cat_park: { headline: "Custom" } } },
    });
    mount(panel(d, onCommit, "cat_park"));

    const headlineLabel = Array.from(document.body.querySelectorAll("label")).find((l) =>
      (l.textContent ?? "").includes("Headline"),
    );
    const clear = headlineLabel?.querySelector("button.qz-rp2-clear");
    if (!(clear instanceof HTMLButtonElement)) throw new Error("↺ clear affordance missing");
    act(() => clear.click());

    expect(onCommit).toHaveBeenCalledTimes(1);
    const committed = onCommit.mock.calls[0]![0] as Quiz;
    expect(committed.rec_page_settings).toBeUndefined();
  });

  it("toggling 'own page' OFF removes the whole override (full inheritance again)", () => {
    const onCommit = vi.fn();
    const d = doc({
      rec_page_settings: { global: {}, overrides: { cat_park: { headline: "Custom" } } },
    });
    mount(panel(d, onCommit, "cat_park"));

    act(() => fieldInput("Give this result its own page").click()); // checked → unchecked
    expect(onCommit).toHaveBeenCalledTimes(1);
    const committed = onCommit.mock.calls[0]![0] as Quiz;
    expect(committed.rec_page_settings).toBeUndefined();
  });

  it("global-only fields are hidden at target scope, present at global scope", () => {
    const d = doc({
      rec_page_settings: { global: {}, overrides: { cat_park: { headline: "Custom" } } },
    });
    mount(panel(d, () => {}, "cat_park"));
    const overrideText = document.body.textContent ?? "";
    for (const globalOnly of [
      "Grid size",
      "Show product descriptions",
      "If a result comes up empty",
      "Contact capture",
    ]) {
      expect(overrideText).not.toContain(globalOnly);
    }

    act(() => root?.unmount());
    document.body.replaceChildren();
    mount(panel(d, () => {}, null));
    const globalText = document.body.textContent ?? "";
    for (const globalOnly of [
      "Grid size",
      "Show product descriptions",
      "If a result comes up empty",
      "Contact capture",
    ]) {
      expect(globalText).toContain(globalOnly);
    }
  });

  it("at global scope the same edit stores under global (sparse — only the set key)", () => {
    const onCommit = vi.fn();
    mount(panel(doc(), onCommit, null));

    typeInto(fieldInput("Headline"), "Hey you");

    expect(onCommit).toHaveBeenCalledTimes(1);
    const committed = onCommit.mock.calls[0]![0] as Quiz;
    expect(committed.rec_page_settings).toEqual({
      global: { headline: "Hey you" },
      overrides: {},
    });
  });

  it("unchecking Lock under a LOCKED global stores an explicit false on the override", () => {
    const onCommit = vi.fn();
    const d = doc({
      rec_page_settings: {
        global: { whyCopyLocked: true },
        overrides: { cat_park: { headline: "Custom" } },
      },
    });
    mount(panel(d, onCommit, "cat_park"));

    const lock = fieldInput("Lock this copy");
    expect(lock.checked).toBe(true); // inherited from the locked global
    act(() => lock.click());

    expect(onCommit).toHaveBeenCalledTimes(1);
    const committed = onCommit.mock.calls[0]![0] as Quiz;
    expect(committed.rec_page_settings?.overrides).toEqual({
      cat_park: { headline: "Custom", whyCopyLocked: false },
    });
    expect(committed.rec_page_settings?.global).toEqual({ whyCopyLocked: true });
  });
});
