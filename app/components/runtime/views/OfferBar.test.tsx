// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DiscountConfig } from "../../../lib/quizSchema";
import { OfferBar, useOffer } from "./OfferBar";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let host: HTMLDivElement;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const discount = DiscountConfig.parse({ enabled: true, configured: true, kind: "percentage", value: 10 });
function Harness(props: { ready: boolean; preview: boolean; email?: string }) {
  const state = useOffer({ enabled: true, quizId: "q", sessionId: "s".repeat(16), discount, ...props });
  return state.status === "issued" ? createElement(OfferBar, { offer: state.offer }) : createElement("i", null, state.status);
}
function mount(props: { ready: boolean; preview: boolean; email?: string }) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(Harness, props)));
}
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

describe("the shopper's offer (results handoff §12)", () => {
  it("the builder preview shows a masked sample and never fetches", () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    mount({ ready: true, preview: true });
    expect(host.textContent).toContain("10% off your order");
    expect(host.textContent).toContain("QUIZ-••••••");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("stays idle and silent while the email that unlocks it is missing", () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    mount({ ready: false, preview: false });
    expect(host.textContent).toBe("idle");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("retries a 409 (session still posting), then shows the issued code", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ offer: null, reason: "session_incomplete" }), { status: 409 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ offer: { code: "QUIZ-7K2M9QAB", line: "10% off your order", ends_at: null } }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetcher);
    mount({ ready: true, preview: false, email: "a@b.co" });
    await flush();
    await act(async () => { vi.advanceTimersByTime(800); });
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetcher.mock.calls[0]![1].body as string)).toEqual({ quiz_id: "q", session_id: "s".repeat(16), email: "a@b.co" });
    expect(host.querySelector('[data-qz-offer="bar"]')?.textContent).toContain("QUIZ-7K2M9QAB");
  });

  it("a missing offer settles quietly", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ offer: null, reason: "not_offered" }), { status: 200 })));
    mount({ ready: true, preview: false });
    await flush();
    expect(host.textContent).toBe("none");
  });
});
