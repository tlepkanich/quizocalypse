import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { CART_BRIDGE_HANDLER } from "./cartBridgeScript";

type Call = { url: string; body?: unknown };
type Responder = (url: string) => { ok: boolean; json?: unknown };

/** Run the ES5 handler with a fake storefront. */
async function run(message: Record<string, unknown>, respond: Responder) {
  const calls: Call[] = [];
  const replies: string[] = [];
  const location = { href: "" };
  const fetchFake = (url: string, init?: { body?: string }) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
    const r = respond(url);
    return Promise.resolve({ ok: r.ok, json: () => Promise.resolve(r.json ?? {}) });
  };
  const onAdded = vi.fn();
  // The handler ships as source text; running it is the test.
  // eslint-disable-next-line no-new-func
  const make = new Function(
    "fetch",
    "window",
    "document",
    "CustomEvent",
    `${CART_BRIDGE_HANDLER}; return qzCartAdd;`,
  );
  const handler = make(fetchFake, { location }, { dispatchEvent: () => true }, class {}) as (
    d: unknown,
    reply: (t: string) => void,
    onAdded: () => void,
  ) => void;
  handler(message, (t) => replies.push(t), onAdded);
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  return { calls, replies, location, onAdded };
}

const allOk: Responder = (url) =>
  url === "/cart.js" ? { ok: true, json: { discount_codes: [{ code: "WELCOME" }] } } : { ok: true };

describe("the storefront add-to-cart bridge", () => {
  it("the theme block carries the same handler text as the launcher", () => {
    const liquid = readFileSync("extensions/quizocalypse-block/blocks/quiz.liquid", "utf8");
    expect(liquid).toContain(CART_BRIDGE_HANDLER);
  });

  it("a plain add never touches the cart's codes", async () => {
    const r = await run({ type: "qz:add-to-cart", variantId: "42" }, allOk);
    expect(r.replies).toEqual(["qz:add-to-cart:ok"]);
    expect(r.calls.map((c) => c.url)).toEqual(["/cart/add.js"]);
    expect(r.calls[0]!.body).toEqual({ items: [{ id: 42, quantity: 1 }] });
    expect(r.onAdded).toHaveBeenCalledOnce();
  });

  it("a coded add keeps the cart's codes and adds the shopper's", async () => {
    const r = await run({ type: "qz:add-to-cart:coded", variantId: "42", discount: "QUIZ-7K2M9Q" }, allOk);
    expect(r.replies).toEqual(["qz:add-to-cart:ok"]);
    expect(r.calls.map((c) => c.url)).toEqual(["/cart/add.js", "/cart.js", "/cart/update.js"]);
    expect(r.calls[2]!.body).toEqual({ discount: "WELCOME,QUIZ-7K2M9Q" });
    expect(r.location.href).toBe("");
  });

  it("a coded add with a malformed code gets no ack, so the quiz takes the cart link", async () => {
    const r = await run({ type: "qz:add-to-cart:coded", variantId: "42", discount: "A,B&x=1" }, allOk);
    expect(r.replies).toEqual([]);
    expect(r.calls).toEqual([]);
  });

  it("a failed add reports :fail and never applies a code", async () => {
    const r = await run({ type: "qz:add-to-cart:coded", variantId: "42", discount: "QUIZ-1" }, () => ({ ok: false }));
    expect(r.replies).toEqual(["qz:add-to-cart:ok", "qz:add-to-cart:fail"]);
    expect(r.calls.map((c) => c.url)).toEqual(["/cart/add.js"]);
  });

  it("when the code cannot be applied, the item is not added twice: Shopify's discount link is used", async () => {
    const r = await run({ type: "qz:add-to-cart:coded", variantId: "42", discount: "QUIZ-1" }, (url) =>
      url === "/cart/update.js" ? { ok: false } : allOk(url),
    );
    expect(r.replies).toEqual(["qz:add-to-cart:ok"]);
    expect(r.location.href).toBe("/discount/QUIZ-1?redirect=/cart");
  });

  it("ignores every other message", async () => {
    const r = await run({ type: "qz:height", height: 10 }, allOk);
    expect(r.replies).toEqual([]);
    expect(r.calls).toEqual([]);
  });
});
