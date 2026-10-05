// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Quiz } from "../../../lib/quizSchema";
import type { BuilderCategory } from "../../builder/stepProps";
import { logicDoc } from "../../../lib/logicStep.fixtures";
import { orderedQuestions } from "../../../lib/questionOrder";
import { buildAttributeReadout } from "../../../lib/attributeClustering";
import { LogicQuestionWidget, type PaneFocusRequest } from "./LogicQuestionWidget";
import type { PaneUndo } from "./LogicTabMenus";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no layout: give every element a visible box so popovers that
// close when their anchor leaves view (closeOnAnchorHidden) stay open.
const realRect = Element.prototype.getBoundingClientRect;
const realRects = Element.prototype.getClientRects;
beforeAll(() => {
  Element.prototype.getBoundingClientRect = function () {
    return { top: 10, bottom: 30, left: 10, right: 110, width: 100, height: 20, x: 10, y: 10, toJSON() {} } as DOMRect;
  };
  Element.prototype.getClientRects = function (this: Element) {
    return [this.getBoundingClientRect()] as unknown as DOMRectList;
  };
});
afterAll(() => {
  Element.prototype.getBoundingClientRect = realRect;
  Element.prototype.getClientRects = realRects;
});

// Logic step redesign — the Filter Results + Rules rail and question pane:
// rail tags + role counts, the tray's D14 colours, arm and place (one shot,
// Esc disarms), the role menu's ONE D9 path (loss toast with an inverse
// Undo), inert Info cells and the route labels.

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

const cat = (id: string, name: string, n = 2): BuilderCategory =>
  ({
    id,
    name,
    description: "",
    tags: [],
    productIds: Array.from({ length: n }, (_, i) => `${id}-p${i}`),
    source: "manual",
    sourceRef: null,
    quizId: "quiz",
  }) as BuilderCategory;
const CATS = [cat("cat1", "Dry kit"), cat("cat2", "Oily kit"), cat("cat3", "Both kit"), cat("catX", "Extra")];

function mount(
  doc: Quiz,
  opts: { selectedId?: string; undo?: PaneUndo; focusRequest?: PaneFocusRequest } = {},
) {
  const commits: Quiz[] = [];
  let current = doc;
  let selected = opts.selectedId ?? null;
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const render = () =>
    act(() =>
      root!.render(
        createElement(LogicQuestionWidget, {
          doc: current,
          questions: orderedQuestions(current),
          categories: CATS,
          colTitleById: new Map(),
          productIndex: [],
          readout: buildAttributeReadout([]),
          qIndexByNodeId: new Map(),
          commit: (d: Quiz) => {
            commits.push(d);
            current = d;
            render();
          },
          ...(opts.undo ? { undo: opts.undo } : {}),
          ...(opts.focusRequest ? { focusRequest: opts.focusRequest } : {}),
          rulesOnly: false,
          deciderQIndex: 1,
          hasNarrowFields: false,
          rulesByAnswer: new Map(),
          selectedId: selected,
          onSelect: (id: string) => {
            selected = id;
            render();
          },
        }),
      ),
    );
  render();
  return { commits, latest: () => current };
}
const q = (sel: string) => document.body.querySelector<HTMLElement>(sel);
const qa = (sel: string) => [...document.body.querySelectorAll<HTMLElement>(sel)];
const click = (el: HTMLElement | null) => {
  if (!el) throw new Error("missing element");
  act(() => el.click());
};

describe("the rail", () => {
  it("rows carry Picks / Info / Narrows / Info tags and the foot counts the roles", () => {
    mount(logicDoc());
    expect(qa(".qz-lg-qtag").map((t) => t.textContent)).toEqual(["Picks", "Info", "Narrows", "Info"]);
    expect(q(".qz-lg-railcount")?.textContent).toBe("Picks 1Narrows 1Info 2");
    expect(q(".qz-lg-kick")?.textContent).toBe("Questions");
    expect(q(".qz-lg-railn")?.textContent).toBe("4");
    expect(qa(".qz-lg-qi.is-on")).toHaveLength(1);
  });
});

describe("the tray and arm-and-place (D14)", () => {
  it("chips in catalogue order: green when on no answer, black when placed", () => {
    mount(logicDoc());
    const chips = qa(".qz-lg-tchip:not(.is-more)");
    expect(chips.map((c) => c.textContent)).toEqual(["Dry kit", "Oily kit", "Both kit", "Extra"]);
    expect(chips.map((c) => c.classList.contains("is-fresh"))).toEqual([false, false, false, true]);
  });

  it("arming turns every cell into a drop target; a click ADDS and disarms", () => {
    const { commits, latest } = mount(logicDoc());
    click(qa(".qz-lg-tchip").find((c) => c.textContent === "Extra")!);
    expect(q(".qz-lg-tchip.is-armed")?.textContent).toBe("Extra");
    expect(qa(".qz-lg-cell.is-drop")).toHaveLength(3);
    expect(qa(".qz-lg-cell")[0]!.getAttribute("aria-label")).toBe("Add Extra");
    click(qa(".qz-lg-cell")[0]!);
    expect(commits).toHaveLength(1);
    const a1 = latest().nodes.find((n) => n.id === "q1")!;
    expect(a1.type === "question" && a1.data.answers[0]!.target_ids).toEqual(["cat1", "catX"]);
    expect(q(".qz-lg-tchip.is-armed")).toBeNull();
  });

  it("a cell already holding it adds nothing and still disarms; Esc disarms", () => {
    const { commits } = mount(logicDoc());
    click(qa(".qz-lg-tchip").find((c) => c.textContent === "Dry kit")!);
    expect(qa(".qz-lg-cell")[0]!.getAttribute("aria-label")).toBe("Dry kit is already here");
    click(qa(".qz-lg-cell")[0]!);
    expect(commits).toHaveLength(0);
    expect(q(".qz-lg-tchip.is-armed")).toBeNull();
    click(qa(".qz-lg-tchip")[0]!);
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(q(".qz-lg-tchip.is-armed")).toBeNull();
  });
});

describe("a focus request that arms a recommendation (the never-recommended fix)", () => {
  it("arms it on the picking question, so every answer offers to place it", () => {
    mount(logicDoc(), {
      focusRequest: { nonce: 1, questionId: "q1", control: "picks", armId: "catX" },
    });
    expect(q(".qz-lg-tchip.is-armed")?.textContent).toBe("Extra");
    expect(qa(".qz-lg-cell.is-drop")).toHaveLength(3);
    expect(qa(".qz-lg-cell")[0]!.getAttribute("aria-label")).toBe("Add Extra");
  });

  it("stays disarmed for a recommendation the tray does not hold", () => {
    mount(logicDoc(), {
      focusRequest: { nonce: 1, questionId: "q1", control: "picks", armId: "gone" },
    });
    expect(q(".qz-lg-tchip.is-armed")).toBeNull();
    expect(qa(".qz-lg-cell.is-drop")).toHaveLength(0);
  });
});

describe("the role menu (D9: one path, announced with an inverse Undo)", () => {
  it("moving Picks results clears Q1's recommendations and the Undo restores them", () => {
    const push = vi.fn();
    const { latest } = mount(logicDoc(), { selectedId: "q2", undo: { push } });
    click(q(".qz-lg-rolebtn"));
    const items = qa('[role="menuitemradio"]');
    expect(items.map((i) => i.querySelector(".qz-lg-mi2-t")?.textContent)).toEqual([
      "Picks the result",
      "Narrows",
      "Info only",
    ]);
    expect(items[0]!.textContent).toContain("moves it from Q1 and clears Q1's mapping");
    expect(q(".qz-lg-pfoot")?.textContent).toBe("Only one question can pick the result.");
    click(items[0]!);
    const moved = latest();
    const q1 = moved.nodes.find((n) => n.id === "q1")!;
    expect(q1.type === "question" && q1.data.role).toBe("qualifier");
    expect(push).toHaveBeenCalledTimes(1);
    const step = push.mock.calls[0]![0] as { message: string; inverse: (d: Quiz) => Quiz };
    expect(step.message).toBe("Q1's 3 recommendations were removed");
    const back = step.inverse(moved);
    const r1 = back.nodes.find((n) => n.id === "q1")!;
    expect(r1.type === "question" && r1.data.role).toBe("decides");
    expect(r1.type === "question" && r1.data.answers.map((a) => a.target_id)).toEqual(["cat1", "cat2", "cat3"]);
  });

  it("leaving Narrows names the values it clears; a change that clears nothing does not toast", () => {
    const push = vi.fn();
    mount(logicDoc(), { selectedId: "q3", undo: { push } });
    click(q(".qz-lg-rolebtn"));
    const info = qa('[role="menuitemradio"]')[2]!;
    expect(info.textContent).toContain("clears Q3's values");
    click(info);
    expect(push.mock.calls[0]![0].message).toBe("Q3's 3 values were removed");
    push.mockClear();
    click(q('.qz-lg-qi[data-node-id="q2"]'));
    click(q(".qz-lg-rolebtn"));
    click(qa('[role="menuitemradio"]')[1]!);
    expect(push).not.toHaveBeenCalled();
  });
});

describe("rows", () => {
  it("Info cells are inert, scale rows are numbered, routes read Next / Results", () => {
    mount(logicDoc(), { selectedId: "q4" });
    expect(qa(".qz-lg-cell.is-inert")).toHaveLength(5);
    expect(qa(".qz-lg-akey").map((k) => k.textContent)).toEqual(["1", "2", "3", "4", "5"]);
    expect(qa(".qz-lg-go").every((g) => /Results/.test(g.textContent ?? "") && !g.classList.contains("is-set"))).toBe(true);
    expect(q(".qz-lg-qtype")?.textContent).toContain("Scale · 1–5");
  });

  it("Narrows cells show chips, Keeps everything and the multi-select type line", () => {
    mount(logicDoc(), { selectedId: "q3" });
    const cells = qa(".qz-lg-cell");
    expect(cells[0]!.textContent).toContain("cheeks");
    expect(cells[2]!.textContent).toContain("Keeps everything");
    expect(q(".qz-lg-qtype")?.textContent).toContain("Multi-select · pick 1–2");
  });
});
