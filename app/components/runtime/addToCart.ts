import { isEmbedMode } from "../../lib/embedMode";

// Add-to-cart from the quiz (Phase 5). The quiz runs in a cross-origin iframe,
// so we first ask the parent storefront (the Theme App Extension listener) to
// add via the same-origin AJAX cart and ack — that's the In-Quiz Add-On
// (add then continue, no navigation). If no ack arrives quickly (not embedded /
// no listener), fall back to navigating the top window to the cart permalink,
// which adds the item + auto-applies the discount.
/** QZY-5 — multi-item adds (the "Add all" bar) go straight to the cart
 *  permalink: the TAE postMessage contract is single-variant, and Shopify's
 *  comma-pair permalink handles quantities + the discount natively. Same
 *  top-window escape as the single-item fallback below. */
export function goToCartPermalink(cartUrl: string) {
  if (typeof window === "undefined") return;
  try {
    (window.top ?? window).location.href = cartUrl;
  } catch {
    window.open(cartUrl, "_blank");
  }
}

export function addToCartFromQuiz(cartUrl: string, variantId: string | null, hasDiscount: boolean) {
  if (typeof window === "undefined") return;
  const goToCart = () => {
    try {
      (window.top ?? window).location.href = cartUrl;
    } catch {
      window.open(cartUrl, "_blank");
    }
  };
  // A discount can only be applied via the cart permalink (the AJAX cart can't
  // carry a code), so go straight there. Also when there's no variant.
  //
  // NOTE this is the ONE iframe cost the DOM embed does NOT remove: a
  // discounted add still navigates the shopper away. That is a Shopify
  // constraint (no discount code on /cart/add.js), not a framing one.
  if (hasDiscount || !variantId) {
    goToCart();
    return;
  }

  // DOM embed: we ARE the storefront document, so the AJAX cart is plainly
  // same-origin. No postMessage, no ack protocol, no 1200ms race — the whole
  // bridge below exists only because a cross-origin iframe cannot do this.
  // `cart:refresh` is the event Shopify themes listen on to re-render the
  // cart drawer; the iframe path gets it from quiz.liquid's listener instead.
  if (isEmbedMode()) {
    void fetch("/cart/add.js", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ id: Number(variantId), quantity: 1 }] }),
    })
      .then((res) => {
        if (!res.ok) throw new Error("add failed");
        try {
          document.dispatchEvent(new CustomEvent("cart:refresh"));
        } catch {
          // A theme without the event contract still got the item.
        }
      })
      .catch(goToCart); // same permalink fallback the bridge path uses
    return;
  }

  if (window.parent === window) {
    goToCart();
    return;
  }
  // In-Quiz Add-On: ask the parent storefront (the Theme App Extension) to add
  // same-origin so the shopper stays in the quiz. The listener acks on RECEIPT
  // (so we cancel the fallback regardless of fetch timing → no double-add) and
  // posts :fail if the add fails (→ permalink fallback).
  let settled = false;
  const cleanup = () => window.removeEventListener("message", onMsg);
  const onMsg = (e: MessageEvent) => {
    if (e.source !== window.parent) return;
    const d = e.data as { type?: string } | null;
    if (!d || typeof d !== "object") return;
    if (d.type === "qz:add-to-cart:ok") {
      settled = true;
      cleanup();
    } else if (d.type === "qz:add-to-cart:fail") {
      settled = true;
      cleanup();
      goToCart();
    }
  };
  window.addEventListener("message", onMsg);
  try {
    window.parent.postMessage({ type: "qz:add-to-cart", variantId, quantity: 1 }, "*");
  } catch {
    cleanup();
    goToCart();
    return;
  }
  // No listener present (no ack of any kind) → permalink fallback.
  window.setTimeout(() => {
    if (!settled) {
      cleanup();
      goToCart();
    }
  }, 1200);
}
