// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement } from "react";

import { RecPageV2Preview } from "./RecPageV2Preview";
import { CHROME_TOKENS } from "../runtime/chromeStrings";
import type { Quiz } from "../../lib/quizSchema";
import type { BuilderCategory } from "../builder/stepProps";
import type { IndexedProduct } from "../../lib/recommendationEngine";

// Owner 2026-09-30 — the merchant-side preview draws the fallback page with
// the same headline + line as the runtime (DeciderResultView).

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
  collection_ids: ["net"],
  inventory_in_stock: true,
});

const cat = (id: string, productIds: string[]): BuilderCategory => ({
  id,
  name: id,
  description: "",
  tags: [],
  productIds,
  source: "collection",
  sourceRef: "c",
  quizId: "db1",
});

const WHY =
  "Based on your quiz answers, we matched you with products tailored to your specific needs.";

function render(global: Record<string, unknown>, categories: BuilderCategory[]) {
  const doc = {
    logic_model: "decider",
    rec_page_settings: { global, overrides: {} },
    global_fallback: { enabled: false, heading: "Our most-loved products", product_ids: [], count: 4 },
  } as unknown as Quiz;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      createElement(RecPageV2Preview, {
        doc,
        categories,
        productIndex: [P("n1"), P("p1")],
        targetId: null,
      }),
    );
  });
  return { h2: host.querySelector("h2")?.textContent, text: host.textContent ?? "" };
}

describe("RecPageV2Preview — the fallback page", () => {
  it("an empty target with fallback products shows the fallback headline + line, no why-copy", () => {
    const { h2, text } = render({ safetyNetCol: "net" }, [cat("empty", [])]);
    expect(h2).toBe(CHROME_TOKENS.decider_fallback_headline);
    expect(text).toContain(CHROME_TOKENS.decider_fallback_subline);
    expect(text).not.toContain(WHY);
  });

  it("uses the merchant's fallback headline", () => {
    const { h2 } = render(
      { safetyNetCol: "net", fallbackHeadline: "Staff favourites" },
      [cat("empty", [])],
    );
    expect(h2).toBe("Staff favourites");
  });

  it("a target with products keeps the reveal headline + why-copy", () => {
    const { h2, text } = render(
      { safetyNetCol: "net", fallbackHeadline: "Staff favourites" },
      [cat("full", ["p1"])],
    );
    expect(h2).toBe("Your perfect match");
    expect(text).toContain(WHY);
    expect(text).not.toContain(CHROME_TOKENS.decider_fallback_subline);
  });
});
