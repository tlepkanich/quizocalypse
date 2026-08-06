import { useEffect } from "react";

// qz:height — the auto-resize half of the theme-app-extension bridge. The
// storefront app block (extensions/quizocalypse-block/blocks/quiz.liquid)
// listens for this message and sets the iframe's height, so shoppers never see
// an inner scrollbar or a block of dead whitespace under the quiz; the block's
// min_height setting becomes a floor instead of a guess.
//
// Live + in-iframe ONLY: preview renders inside the builder's DeviceFrame
// (never an iframe we size), and a top-level /q tab has no parent to tell.
// Client-only effect — the server-rendered /q HTML is untouched
// (byte-stability; same posture as addToCart.ts, including the "*" target:
// the embedding storefront's origin is not knowable from a cross-origin
// iframe, and the payload is just a pixel count).
//
// Height is effectively GROW-ONLY within a session: the runtime page keeps
// min-height:100vh, so once the iframe grows, scrollHeight can never report
// smaller than the current iframe height. That is deliberate — shrinking on
// every step change would jitter the host page's scroll position; short steps
// centre vertically in the grown frame instead.
export function useIframeHeightBridge(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    if (window.parent === window) return;
    let raf = 0;
    let last = 0;
    const post = () => {
      raf = 0;
      const h = document.documentElement.scrollHeight;
      if (h > 0 && h !== last) {
        last = h;
        window.parent.postMessage({ type: "qz:height", height: h }, "*");
      }
    };
    const schedule = () => {
      if (!raf) raf = window.requestAnimationFrame(post);
    };
    schedule();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    ro?.observe(document.documentElement);
    if (document.body) ro?.observe(document.body);
    return () => {
      ro?.disconnect();
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [enabled]);
}
