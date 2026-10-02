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

/**
 * Results handoff §12.4 — put a code on the storefront's AJAX cart.
 * `/cart/update.js { discount }` REPLACES the cart's code list, so the codes
 * already there are sent back with the new one. Same-origin only (the DOM
 * embed); the iframe path does the same in the theme block's listener.
 */
export async function applyCartDiscount(code: string): Promise<void> {
  const cart = (await (await fetch("/cart.js")).json()) as { discount_codes?: Array<{ code?: string }> };
  const kept = (cart.discount_codes ?? []).map((c) => c.code).filter((c): c is string => Boolean(c));
  const all = [...new Set([...kept, code])];
  const res = await fetch("/cart/update.js", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ discount: all.join(",") }),
  });
  if (!res.ok) throw new Error("discount apply failed");
}

/**
 * @param ajaxCode the shopper's issued offer code (decider results only).
 *   When set, the add stays in the quiz and the code goes onto the AJAX cart;
 *   every failure falls back to the cart permalink, which carries the code.
 *   Absent = the behaviour before the offer pipeline, unchanged.
 */
export function addToCartFromQuiz(
  cartUrl: string,
  variantId: string | null,
  hasDiscount: boolean,
  ajaxCode?: string,
) {
  if (typeof window === "undefined") return;
  const goToCart = () => {
    try {
      (window.top ?? window).location.href = cartUrl;
    } catch {
      window.open(cartUrl, "_blank");
    }
  };
  if (ajaxCode && variantId) {
    addWithCode(variantId, ajaxCode, goToCart);
    return;
  }
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

/** Ask the parent page to add ONE variant; resolve by ack, :fail or silence. */
function askParent(message: Record<string, unknown>, goToCart: () => void) {
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
    window.parent.postMessage(message, "*");
  } catch {
    cleanup();
    goToCart();
    return;
  }
  window.setTimeout(() => {
    if (!settled) {
      cleanup();
      goToCart();
    }
  }, 1200);
}

function addWithCode(variantId: string, code: string, goToCart: () => void) {
  if (isEmbedMode()) {
    void fetch("/cart/add.js", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ id: Number(variantId), quantity: 1 }] }),
    })
      .then((res) => {
        if (!res.ok) throw new Error("add failed");
      })
      .then(
        () =>
          applyCartDiscount(code).then(
            () => {
              try {
                document.dispatchEvent(new CustomEvent("cart:refresh"));
              } catch {
                // A theme without the event contract still got the item.
              }
            },
            // The item is in the cart, so the permalink would add it twice.
            // Shopify's discount link applies the code and lands on the cart.
            () => {
              window.location.href = `/discount/${encodeURIComponent(code)}?redirect=/cart`;
            },
          ),
        goToCart, // the add itself failed: the permalink adds + applies
      );
    return;
  }
  if (window.parent === window) {
    goToCart();
    return;
  }
  // A NEW message type on purpose: a theme block from before the offer
  // pipeline ignores it, sends no ack, and the 1200 ms fallback takes the
  // permalink. Had it reused "qz:add-to-cart", an old block would ack, add
  // the item and silently drop the code.
  askParent({ type: "qz:add-to-cart:coded", variantId, quantity: 1, discount: code }, goToCart);
}
