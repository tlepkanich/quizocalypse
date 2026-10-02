// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { setEmbedMode } from "../../lib/embedMode";
import { addToCartFromQuiz, applyCartDiscount } from "./addToCart";

type Sent = { url: string; body?: unknown };
function fakeFetch(respond: (url: string) => { ok: boolean; json?: unknown }) {
  const sent: Sent[] = [];
  vi.stubGlobal("fetch", (url: string, init?: { body?: string }) => {
    sent.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
    const r = respond(url);
    return Promise.resolve({ ok: r.ok, json: () => Promise.resolve(r.json ?? {}) });
  });
  return sent;
}
const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

afterEach(() => {
  setEmbedMode(false);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("applyCartDiscount", () => {
  it("sends the codes already on the cart with the new one", async () => {
    const sent = fakeFetch((url) =>
      url === "/cart.js" ? { ok: true, json: { discount_codes: [{ code: "WELCOME" }] } } : { ok: true },
    );
    await applyCartDiscount("QUIZ-1");
    expect(sent[1]).toEqual({ url: "/cart/update.js", body: { discount: "WELCOME,QUIZ-1" } });
  });

  it("never repeats a code the cart already has", async () => {
    const sent = fakeFetch((url) =>
      url === "/cart.js" ? { ok: true, json: { discount_codes: [{ code: "QUIZ-1" }] } } : { ok: true },
    );
    await applyCartDiscount("QUIZ-1");
    expect(sent[1]!.body).toEqual({ discount: "QUIZ-1" });
  });

  it("throws when the cart refuses the update", async () => {
    fakeFetch((url) => (url === "/cart.js" ? { ok: true, json: {} } : { ok: false }));
    await expect(applyCartDiscount("QUIZ-1")).rejects.toThrow();
  });
});

describe("addToCartFromQuiz with the shopper's offer code", () => {
  it("DOM embed: adds, then puts the code on the cart — no navigation", async () => {
    setEmbedMode(true);
    const sent = fakeFetch((url) => (url === "/cart.js" ? { ok: true, json: {} } : { ok: true }));
    addToCartFromQuiz("https://shop.example/cart/42:1?discount=QUIZ-1", "42", true, "QUIZ-1");
    await flush();
    expect(sent.map((s) => s.url)).toEqual(["/cart/add.js", "/cart.js", "/cart/update.js"]);
    expect(sent[2]!.body).toEqual({ discount: "QUIZ-1" });
  });

  it("iframe: posts the NEW coded message, which an old theme block ignores", () => {
    const post = vi.fn();
    vi.spyOn(window, "parent", "get").mockReturnValue({ postMessage: post } as unknown as Window);
    addToCartFromQuiz("https://shop.example/cart/42:1?discount=QUIZ-1", "42", true, "QUIZ-1");
    expect(post).toHaveBeenCalledWith(
      { type: "qz:add-to-cart:coded", variantId: "42", quantity: 1, discount: "QUIZ-1" },
      "*",
    );
  });

  it("without an offer code a discounted add still goes straight to the cart link", () => {
    const post = vi.fn();
    vi.spyOn(window, "parent", "get").mockReturnValue({ postMessage: post } as unknown as Window);
    const sent = fakeFetch(() => ({ ok: true }));
    // jsdom cannot navigate; the call must simply not use the bridge or fetch.
    vi.spyOn(console, "error").mockImplementation(() => {});
    addToCartFromQuiz("https://shop.example/cart/42:1?discount=SHARED", "42", true);
    expect(post).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });
});
