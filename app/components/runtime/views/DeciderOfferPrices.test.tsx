// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement } from "react";

import { DeciderResultView } from "./DeciderViews";
import { stylesFor } from "../runtimeStyles";
import { RuntimePreviewContext } from "../runtimeContexts";
import { settingsForTarget } from "../../../lib/recommendDecider";
import { DiscountConfig } from "../../../lib/quizSchema";
import type { ExplainedRecommendation, IndexedProduct } from "../../../lib/recommendationEngine";

// Results handoff §8 "Card prices strike only…" — on the live results page.
// Rendered in preview mode: useOffer then issues the masked sample with no
// request, which is all the price rule needs.

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const P = (id: string): IndexedProduct => ({
  product_id: id,
  title: `Product ${id}`,
  handle: id,
  price: "10",
  image_url: null,
  tags: [],
  collection_ids: ["c"],
  inventory_in_stock: true,
});
const ex = (id: string) => ({ ...P(id), score: 1, matched_tags: [] }) as never;
type Decider = NonNullable<ExplainedRecommendation["decider"]>;

function struck(discount: Partial<DiscountConfig>, opts: { unlock?: boolean } = {}) {
  const decider: Decider = {
    targetId: "cat_a",
    matchedRuleId: null,
    config: settingsForTarget(undefined, "cat_a"),
    hero: ex("h"),
    grid: [ex("g")],
    allOutOfStock: false,
  };
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const view = createElement(DeciderResultView, {
    decider,
    fallback: null,
    answerIds: [],
    resultNodeId: "res",
    styles: stylesFor({}),
    startedAt: Date.now(),
    completed: { current: true },
    analytics: null,
    onReset: () => {},
    offer: {
      discount: DiscountConfig.parse({ enabled: true, configured: true, code_mode: "dynamic", ...discount }),
      unlock: opts.unlock === true,
    },
  });
  act(() => {
    root!.render(createElement(RuntimePreviewContext.Provider, { value: true }, view));
  });
  return [...host.querySelectorAll("span")]
    .filter((s) => s.style.textDecoration === "line-through")
    .map((s) => s.nextElementSibling?.textContent ?? "");
}

describe("DeciderResultView — card prices under the shopper's offer", () => {
  it("a percentage off what we recommend strikes every matching card", () => {
    const after = struck({ kind: "percentage", value: 10, applies_to: "recommended" });
    expect(after).toHaveLength(2);
    expect(after.every((t) => t.includes("9"))).toBe(true);
  });

  it("a fixed amount once per order is split across the matching cards", () => {
    const after = struck({ kind: "amount", value: 6, applies_to: "recommended" });
    expect(after).toHaveLength(2);
    expect(after.every((t) => t.includes("7"))).toBe(true); // 10 − 6 ÷ 2
  });

  it("a fixed amount per item takes the full amount off each card", () => {
    const after = struck({ kind: "amount", value: 6, applies_to: "recommended", applies_on_each_item: true });
    expect(after.every((t) => t.includes("4"))).toBe(true);
  });

  it("an order discount never strikes a card", () => {
    expect(struck({ kind: "percentage", value: 10, applies_to: "all" })).toEqual([]);
  });

  it("a subscription-only discount never strikes a card", () => {
    expect(struck({ kind: "percentage", value: 10, applies_to: "recommended", purchase: "sub" })).toEqual([]);
  });

  it("an offer still locked behind the email never strikes a card", () => {
    expect(struck({ kind: "percentage", value: 10, applies_to: "recommended" }, { unlock: true })).toEqual([]);
  });
});
