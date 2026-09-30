// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { ValuePickerPopover } from "./ValuePickerPopover";
import { Answer } from "../../../lib/quizSchema";
import type { AttributeReadout } from "../../../lib/attributeClustering";
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
let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
});

const readout: AttributeReadout = {
  attributes: [
    {
      name: "Material",
      grade: "good",
      primary: { kind: "tag_family", key: "material" },
      members: [{ kind: "tag_family", key: "material" }],
      values: [
        { value: "wood", count: 1 },
        { value: "metal", count: 1 },
        { value: "glass", count: 1 },
      ],
      covered: 3,
      distinctValues: 3,
    },
  ],
  demoted: [],
  strongCount: 1,
  strongNames: ["Material"],
};

function mount(answer: Answer, onApply: (v: unknown) => void) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      createElement(ValuePickerPopover, {
        trigger: createElement("button", null, "Choose"),
        answer,
        siblingAnswers: [answer],
        readout,
        productIndex: [],
        onApply,
      }),
    ),
  );
}
const click = (text: string) => {
  const b = [...document.body.querySelectorAll("button")].find((x) => x.textContent?.trim() === text);
  if (!b) throw new Error(text);
  act(() => b.click());
};
const valueBoxes = () =>
  [...document.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')].filter(
    (b) => !b.hasAttribute("data-vp-keeps"),
  );

it("stages a copied selection; Cancel writes nothing and Done preserves every unmanaged family", () => {
  const answer = Answer.parse({
    id: "a",
    text: "A",
    edge_handle_id: "h",
    tags: ["keep"],
    collection_filters: ["collection"],
    metafield_filters: [{ key: "other", value: "preserve" }],
    variant_filters: [{ name: "Size", value: "L" }],
    product_type_filters: ["Board"],
  });
  const onApply = vi.fn();
  mount(answer, onApply);
  click("Choose");
  expect(document.querySelector(".qz-lg-pt")?.textContent).toBe("A · keeps");
  act(() => valueBoxes().forEach((b) => b.click()));
  expect(onApply).not.toHaveBeenCalled();
  expect(answer.tags).toEqual(["keep"]);
  click("Cancel");
  expect(onApply).not.toHaveBeenCalled();
  click("Choose");
  expect(valueBoxes().filter((b) => b.getAttribute("aria-checked") === "true")).toHaveLength(0);
  act(() => valueBoxes()[0]!.click());
  expect(document.querySelector(".qz-lg-vpfoot")?.textContent).toContain("1 selected");
  click("Done");
  expect(onApply).toHaveBeenCalledTimes(1);
  expect(onApply.mock.calls[0]![0]).toEqual({
    tags: ["keep", "material:wood"],
    collection_filters: ["collection"],
    metafield_filters: [{ key: "other", value: "preserve" }],
    variant_filters: [{ name: "Size", value: "L" }],
    product_type_filters: ["Board"],
  });
});

it("Keeps everything: ticking it clears the draft, a value unticks it, Done writes no_preference", () => {
  const answer = Answer.parse({ id: "a", text: "A", edge_handle_id: "h", tags: ["material:wood"] });
  const onApply = vi.fn();
  mount(answer, onApply);
  click("Choose");
  const keeps = () => document.querySelector<HTMLButtonElement>("[data-vp-keeps]")!;
  expect(valueBoxes()[0]!.getAttribute("aria-checked")).toBe("true");
  act(() => keeps().click());
  expect(keeps().getAttribute("aria-checked")).toBe("true");
  expect(valueBoxes().every((b) => b.getAttribute("aria-checked") === "false")).toBe(true);
  act(() => valueBoxes()[1]!.click());
  expect(keeps().getAttribute("aria-checked")).toBe("false");
  act(() => keeps().click());
  expect(document.querySelector(".qz-lg-vpfoot")?.textContent).toContain("Keeps everything");
  click("Done");
  expect(onApply.mock.calls[0]![0]).toEqual({ tags: [], no_preference: true });
});

it("a stored Keeps everything opens ticked; the search hides the row and matches attribute names", () => {
  const answer = Answer.parse({ id: "a", text: "A", edge_handle_id: "h", no_preference: true });
  mount(answer, vi.fn());
  click("Choose");
  expect(document.querySelector("[data-vp-keeps]")?.getAttribute("aria-checked")).toBe("true");
  const input = document.querySelector<HTMLInputElement>('input[type="search"]')!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setValue.call(input, "materi");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(document.querySelector("[data-vp-keeps]")).toBeNull();
  expect(valueBoxes()).toHaveLength(3);
});

it("staged picks follow the attribute, not its position, when the readout changes while open", () => {
  const answer = Answer.parse({ id: "a", text: "A", edge_handle_id: "h", tags: [] });
  const onApply = vi.fn();
  const color = {
    ...readout.attributes[0]!,
    name: "Color",
    primary: { kind: "tag_family" as const, key: "color" },
    members: [{ kind: "tag_family" as const, key: "color" }],
    values: [{ value: "red", count: 1 }],
  };
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const render = (r: AttributeReadout) =>
    act(() =>
      root!.render(
        createElement(ValuePickerPopover, {
          trigger: createElement("button", null, "Choose"),
          answer,
          siblingAnswers: [answer],
          readout: r,
          productIndex: [],
          onApply,
        }),
      ),
    );
  render(readout);
  click("Choose");
  act(() => valueBoxes()[0]!.click()); // Material · wood
  render({ ...readout, attributes: [color, ...readout.attributes] });
  click("Done");
  expect(onApply.mock.calls[0]![0]).toEqual({ tags: ["material:wood"] });
});
