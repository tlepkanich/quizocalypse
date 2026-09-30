// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement } from "react";

import { DeciderResultView } from "./DeciderViews";
import { stylesFor } from "../runtimeStyles";
import { CHROME_TOKENS } from "../chromeStrings";
import { logicDoc, rule } from "../../../lib/logicStep.fixtures";
import {
  deciderSafetyNet,
  unresolvedDeciderReveal,
  type IndexedProduct,
} from "../../../lib/recommendationEngine";

// D1 safety net — the unresolved shopper renders through the normal decider
// reveal: the "couldn't find an exact match" line, the fallback grid, Start
// over, and the completion analytics (a deliberate funnel-number change:
// these shoppers used to fire no quiz_completed / recommendation_viewed).

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
  collection_ids: ["net"],
  inventory_in_stock: true,
});

describe("DeciderResultView on the D1 safety-net payload", () => {
  it("renders the fallback page and tracks completion with fallback_source and no target", () => {
    const base = logicDoc({
      rules: [rule("show", [["q2", "b1"]], "catX", { action: "show" })],
      logic_style: "rules",
    });
    const doc = { ...base, rec_page_settings: { global: { safetyNetCol: "net" }, overrides: {} } };
    const index = [P("n1"), P("n2")];
    const decider = unresolvedDeciderReveal(doc, index);
    expect(decider).not.toBeNull();
    const fallback = deciderSafetyNet(decider!.config, doc.global_fallback, index);

    const track = vi.fn();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(
        createElement(DeciderResultView, {
          decider: decider!,
          fallback,
          answerIds: ["a1", "b2"],
          resultNodeId: "res",
          styles: stylesFor({}),
          startedAt: Date.now(),
          completed: { current: false },
          analytics: { track } as never,
          onReset: () => {},
        }),
      );
    });

    const text = host.textContent ?? "";
    expect(text).toContain(CHROME_TOKENS.decider_fallback_heading);
    expect(text).not.toContain(CHROME_TOKENS.no_results_match);
    expect(text).toContain("Product n1");
    expect(text).toContain("Product n2");
    expect(text).toContain(CHROME_TOKENS.start_over);

    const events = track.mock.calls.map((c) => c[0]);
    expect(events).toEqual(["quiz_completed", "recommendation_viewed"]);
    const viewed = track.mock.calls[1]![1] as Record<string, unknown>;
    expect(viewed).toEqual({
      result_node_id: "res",
      product_ids: ["n1", "n2"],
      secondary_product_ids: [],
      matched_rule_id: null,
      fallback_source: "safety_net",
    });
    expect("resolved_target_id" in viewed).toBe(false);
  });
});
