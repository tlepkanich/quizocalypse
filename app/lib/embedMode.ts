// Is the runtime mounted directly into a merchant's document (DOM embed), or
// serving as our own /q page (hosted link, theme-extension iframe, launcher
// modal)? Set once by app/embed/entry.tsx; false everywhere else.
//
// Same shape and rationale as apiBase.ts: the consumers are a hook and a
// non-React helper called from two leaf components, so a module flag beats
// threading a prop through QuizRuntime — the highest-risk file in the repo —
// purely to carry a boolean.
//
// Defaults to false, so /q behaves exactly as it does today and its DOM is
// untouched. SSR-guarded for the same reason as apiBase: module state on the
// server is shared across every request.
//
// window.parent === window is NOT a substitute. It is true for a DOM embed on
// a normal storefront, but ALSO true for a /q page opened as a top-level tab —
// and false for a DOM embed on a storefront that is itself framed (Shopify's
// own theme editor preview does exactly that). The two conditions are
// genuinely different questions.

let embedded = false;

export function setEmbedMode(value: boolean): void {
  if (typeof window === "undefined") return;
  embedded = value;
}

export function isEmbedMode(): boolean {
  return embedded;
}
