// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement } from "react";

import { DeciderResultView } from "./DeciderViews";
import { stylesFor } from "../runtimeStyles";
import { CHROME_TOKENS, ChromeContext, chromeFor } from "../chromeStrings";
import { settingsForTarget, type DeciderFallback } from "../../../lib/recommendDecider";
import type { RecPageSettings } from "../../../lib/quizSchema";
import type {
  ExplainedRecommendation,
  IndexedProduct,
} from "../../../lib/recommendationEngine";

// Owner 2026-09-30 — the decider fallback page (no hero, empty grid, fallback
// products) carries its OWN headline (merchant global fallbackHeadline, else
// the translatable chrome default) and ONE honest line in place of the
// why-copy. Every page with products keeps the reveal headline + why-copy.

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

const OLD_FALLBACK_LINE = "We couldn't find an exact match — here are our most-loved products.";
const WHY_DEFAULT =
  "Based on your quiz answers, we matched you with products tailored to your specific needs.";

function decider(
  settings: RecPageSettings | undefined,
  patch: Partial<Decider> = {},
  targetId: string | null = "cat_a",
): Decider {
  return {
    targetId,
    matchedRuleId: null,
    config: settingsForTarget(settings, targetId ?? "__none__"),
    hero: null,
    grid: [],
    allOutOfStock: false,
    ...patch,
  };
}

const FALLBACK: DeciderFallback = { source: "safety_net", products: [P("f1"), P("f2")] };

function render(
  d: Decider,
  fallback: DeciderFallback | null,
  opts: { aiWhyCopy?: string; chrome?: Record<string, string> } = {},
) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const view = createElement(DeciderResultView, {
    decider: d,
    fallback,
    answerIds: [],
    resultNodeId: "res",
    styles: stylesFor({}),
    startedAt: Date.now(),
    completed: { current: true },
    analytics: null,
    onReset: () => {},
    ...(opts.aiWhyCopy ? { aiWhyCopy: opts.aiWhyCopy } : {}),
  });
  act(() => {
    root!.render(
      opts.chrome
        ? createElement(ChromeContext.Provider, { value: chromeFor(opts.chrome) }, view)
        : view,
    );
  });
  return {
    h2: host.querySelector("h2")?.textContent ?? null,
    text: host.textContent ?? "",
  };
}

const settings = (global: Record<string, unknown>, overrides: Record<string, unknown> = {}) =>
  ({ global, overrides }) as RecPageSettings;

describe("DeciderResultView — the fallback page headline", () => {
  it("default: the chrome headline + the one line; why-copy and the old line are absent", () => {
    const { h2, text } = render(decider(undefined), FALLBACK);
    expect(h2).toBe(CHROME_TOKENS.decider_fallback_headline);
    expect(h2).toBe("Our most-loved products");
    expect(text).toContain(
      "We couldn't find an exact match for your answers, so here are some favourites.",
    );
    expect(text).not.toContain(WHY_DEFAULT);
    expect(text).not.toContain(OLD_FALLBACK_LINE);
    expect(text).not.toContain("Your perfect match");
    expect(text).toContain("Product f1");
  });

  it("the merchant's fallbackHeadline replaces the default; blank text falls back to it", () => {
    expect(
      render(decider(settings({ fallbackHeadline: "Staff favourites" })), FALLBACK).h2,
    ).toBe("Staff favourites");
    act(() => root?.unmount());
    host?.remove();
    expect(render(decider(settings({ fallbackHeadline: "   " })), FALLBACK).h2).toBe(
      CHROME_TOKENS.decider_fallback_headline,
    );
  });

  it("a global headline, a per-target headline override and a custom why-copy never reach the fallback page", () => {
    const s = settings(
      { headline: "Global reveal", whyCopy: "Custom why", fallbackHeadline: "Staff favourites" },
      { cat_a: { headline: "Target reveal", whyCopy: "Target why" } },
    );
    const { h2, text } = render(decider(s), FALLBACK);
    expect(h2).toBe("Staff favourites");
    expect(text).not.toContain("Global reveal");
    expect(text).not.toContain("Target reveal");
    expect(text).not.toContain("Custom why");
    expect(text).not.toContain("Target why");
  });

  it("the AI why-copy paragraph does not render on the fallback page", () => {
    const { text } = render(decider(undefined), FALLBACK, { aiWhyCopy: "AI says you ride park" });
    expect(text).not.toContain("AI says you ride park");
    expect(text).toContain(CHROME_TOKENS.decider_fallback_subline);
  });

  it("persona name, image and description do not render on the fallback page", () => {
    const d = decider(undefined, {
      persona: { name: "The Shredder", description: "Lives for powder", image: "https://x/p.png" },
    });
    render(d, FALLBACK);
    expect(host!.querySelector("h2")?.textContent).toBe(CHROME_TOKENS.decider_fallback_headline);
    expect(host!.textContent).not.toContain("The Shredder");
    expect(host!.textContent).not.toContain("Lives for powder");
    expect(host!.querySelector("img[src='https://x/p.png']")).toBeNull();
  });

  it("the D1 safety-net payload (targetId null) uses the same headline + line", () => {
    const s = settings({ fallbackHeadline: "Staff favourites", headline: "Global reveal" });
    const { h2, text } = render(decider(s, {}, null), FALLBACK);
    expect(h2).toBe("Staff favourites");
    expect(text).toContain(CHROME_TOKENS.decider_fallback_subline);
    expect(text).not.toContain("Global reveal");
  });

  it("a locale table translates the default headline and the line", () => {
    const { h2, text } = render(decider(undefined), FALLBACK, {
      chrome: {
        "chrome.decider_fallback_headline": "Nos produits préférés",
        "chrome.decider_fallback_subline": "Aucune correspondance exacte, voici nos favoris.",
      },
    });
    expect(h2).toBe("Nos produits préférés");
    expect(text).toContain("Aucune correspondance exacte, voici nos favoris.");
  });
});

describe("DeciderResultView — pages that are NOT the fallback page are unchanged", () => {
  it("a page with products keeps the reveal headline + why-copy and never shows the fallback copy", () => {
    const s = settings({ fallbackHeadline: "Staff favourites" });
    const { h2, text } = render(decider(s, { hero: ex("h1"), grid: [ex("g1")] }), null);
    expect(h2).toBe("Your perfect match");
    expect(text).toContain(WHY_DEFAULT);
    expect(text).not.toContain("Staff favourites");
    expect(text).not.toContain(CHROME_TOKENS.decider_fallback_headline);
    expect(text).not.toContain(CHROME_TOKENS.decider_fallback_subline);
  });

  it("a per-target headline override and the AI why-copy still render on a page with products", () => {
    const s = settings({}, { cat_a: { headline: "Target reveal" } });
    const { h2, text } = render(decider(s, { hero: ex("h1") }), null, {
      aiWhyCopy: "AI says you ride park",
    });
    expect(h2).toBe("Target reveal");
    expect(text).toContain("AI says you ride park");
  });

  it("the persona still heads a page with products", () => {
    const d = decider(undefined, { hero: ex("h1"), persona: { name: "The Shredder" } });
    expect(render(d, null).h2).toBe("The Shredder");
  });

  it("the bare no-match card (no fallback products) keeps the reveal headline + why-copy", () => {
    const { h2, text } = render(decider(settings({ fallbackHeadline: "Staff favourites" })), null);
    expect(h2).toBe("Your perfect match");
    expect(text).toContain(WHY_DEFAULT);
    expect(text).toContain(CHROME_TOKENS.no_results_match);
    expect(text).not.toContain("Staff favourites");
    expect(text).not.toContain(CHROME_TOKENS.decider_fallback_subline);
  });

  it("an all-out-of-stock page keeps its headline, why-copy and stock line", () => {
    const { h2, text } = render(
      decider(undefined, { hero: ex("h1"), allOutOfStock: true }),
      null,
    );
    expect(h2).toBe("Your perfect match");
    expect(text).toContain(WHY_DEFAULT);
    expect(text).toContain(CHROME_TOKENS.all_out_of_stock);
  });
});
