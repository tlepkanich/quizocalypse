// Results handoff §12.4 — the storefront half of the quiz's add-to-cart
// bridge, as plain ES5 source. The quiz iframe is cross-origin, so it posts
// "qz:add-to-cart" (no code) or "qz:add-to-cart:coded" (the shopper's offer
// code) and the storefront page adds same-origin via the AJAX cart.
//
// TWO hosts run this exact text: the launcher script (which embeds this
// constant) and the theme block, extensions/quizocalypse-block/blocks/
// quiz.liquid, which cannot import and so carries a copy. A unit test fails
// when the two differ — edit both.
export const CART_BRIDGE_HANDLER = `function qzCartAdd(d, reply, onAdded) {
          var coded = d.type === "qz:add-to-cart:coded";
          if ((d.type !== "qz:add-to-cart" && !coded) || !d.variantId) return;
          var code = coded && typeof d.discount === "string" ? d.discount : "";
          // A coded add with a bad code gets NO ack: the quiz then takes the
          // cart link, which carries the code.
          if (coded && !/^[A-Za-z0-9_-]{1,64}$/.test(code)) return;
          // Ack on RECEIPT so the quiz cancels its permalink fallback (avoids a
          // double-add if the cart write is slow). Post :fail only if it errors.
          reply("qz:add-to-cart:ok");
          var post = { method: "POST", headers: { "Content-Type": "application/json" } };
          post.body = JSON.stringify({ items: [{ id: Number(d.variantId), quantity: d.quantity || 1 }] });
          fetch("/cart/add.js", post)
            .then(function (r) { if (!r.ok) throw new Error("add failed"); return r.json(); })
            .then(function () {
              if (!code) return;
              // update.js REPLACES the cart's codes: send the ones already
              // there with the new one. If that fails the item is in the cart,
              // so use Shopify's discount link (the cart link would add twice).
              return fetch("/cart.js")
                .then(function (r) { return r.json(); })
                .then(function (cart) {
                  var codes = [];
                  (cart.discount_codes || []).forEach(function (c) {
                    if (c && c.code && codes.indexOf(c.code) < 0) codes.push(c.code);
                  });
                  if (codes.indexOf(code) < 0) codes.push(code);
                  post.body = JSON.stringify({ discount: codes.join(",") });
                  return fetch("/cart/update.js", post);
                })
                .then(function (r) { if (!r.ok) throw new Error("discount failed"); })
                .catch(function () {
                  window.location.href = "/discount/" + encodeURIComponent(code) + "?redirect=/cart";
                });
            })
            .then(function () {
              try { document.dispatchEvent(new CustomEvent("cart:refresh")); } catch (_) {}
              onAdded();
            })
            .catch(function () { reply("qz:add-to-cart:fail"); });
        }`;
