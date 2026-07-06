// Add-to-cart from the quiz (Phase 5). The quiz runs in a cross-origin iframe,
// so we first ask the parent storefront (the Theme App Extension listener) to
// add via the same-origin AJAX cart and ack — that's the In-Quiz Add-On
// (add then continue, no navigation). If no ack arrives quickly (not embedded /
// no listener), fall back to navigating the top window to the cart permalink,
// which adds the item + auto-applies the discount.
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
  // carry a code), so go straight there. Also when not embedded / no variant.
  if (hasDiscount || !variantId || window.parent === window) {
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
