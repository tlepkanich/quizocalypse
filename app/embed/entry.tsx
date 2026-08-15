import { createRoot } from "react-dom/client";
import { QuizRuntime } from "../components/runtime/QuizRuntime";
import { setApiBase } from "../lib/apiBase";
import { setEmbedMode } from "../lib/embedMode";
import { googleFontsUrl } from "../components/runtime/runtimeStyles";
import runtimeCss from "../styles/quiz-runtime.css?inline";

// Wiskr DOM embed — mounts the shopper runtime directly into a merchant's
// storefront document instead of a cross-origin iframe.
//
// Built separately from the Remix app (vite.embed.config.ts, IIFE) because
// nothing here is Remix: app/components/runtime/** has ZERO @remix-run
// imports, so <QuizRuntime> is a plain React tree that takes props. The only
// thing the iframe was really providing was (a) our origin for the ~14 API
// calls and (b) a document to own. apiBase.ts covers (a); this file covers (b).
//
// SHADOW DOM. A light-DOM mount was built first and measured against a test
// storefront carrying `button { background:#c0392b !important }` — the quiz's
// Start button rendered in the theme's red, square corners, serif face. Our
// own styles never leak OUT (all 51 classes in quiz-runtime.css are `.qz-`
// prefixed), but nothing stops a theme leaking IN, and !important armor is an
// arms race we would lose on some theme eventually.
//
// A shadow root ends it: theme SELECTORS cannot match inside it at all, while
// INHERITED properties (font-family, color, line-height) still cascade through
// the boundary — which is exactly the "feels native" half merchants actually
// want, without the hostile-override half.
//
// The one real cost: @font-face does NOT register from a stylesheet inside a
// shadow root, and the runtime renders its Google Fonts <link> in-tree
// (QuizRuntime.tsx:1836). That in-tree link still loads, but its font faces
// would never bind. So we ALSO put the same URL in document.head, where font
// faces are document-scoped and the shadow tree can resolve them. Deriving
// the families here keeps QuizRuntime — the highest-risk file in the repo —
// completely untouched, so /q stays byte-identical.

interface EmbedPayload {
  quizId: string;
  name: string;
  version: number;
  doc: Parameters<typeof QuizRuntime>[0]["doc"];
  productIndex: Parameters<typeof QuizRuntime>[0]["productIndex"];
  designTokens: Parameters<typeof QuizRuntime>[0]["designTokens"];
  designOverrides: Parameters<typeof QuizRuntime>[0]["designOverrides"];
  breakpointOverrides: Parameters<typeof QuizRuntime>[0]["breakpointOverrides"];
  resultLayoutMode: Parameters<typeof QuizRuntime>[0]["resultLayoutMode"];
  designLinked: boolean;
  recPageDesign: Parameters<typeof QuizRuntime>[0]["recPageDesign"];
  shopDomain: string;
  platform: "shopify" | "standalone";
  answerWeights: Parameters<typeof QuizRuntime>[0]["answerWeights"];
  targetProductIdsMap: Parameters<typeof QuizRuntime>[0]["targetProductIdsMap"];
  targetIndex: Parameters<typeof QuizRuntime>[0]["targetIndex"];
  locale: string;
  chrome: Parameters<typeof QuizRuntime>[0]["chrome"];
  buddySessionId: string | null;
  aiCopyEnabled: boolean;
}

const STYLE_ID = "wiskr-embed-styles";
const MOUNTED = "wiskrMounted"; // dataset flag — re-init must never double-mount

// Resolved at module scope: document.currentScript is only non-null while the
// script is executing synchronously, so it cannot be read from inside an
// async mount. Falls back to scanning for our own tag (a merchant who inlines
// the bundle), then to the page origin (dev / same-origin hosting).
const SCRIPT_ORIGIN: string = (() => {
  const current = document.currentScript as HTMLScriptElement | null;
  const candidates = current?.src
    ? [current.src]
    : Array.from(document.querySelectorAll<HTMLScriptElement>("script[src]"))
        .map((s) => s.src)
        .filter((s) => s.includes("wiskr-embed"));
  for (const src of candidates) {
    try {
      return new URL(src).origin;
    } catch {
      // Malformed src — keep looking.
    }
  }
  return window.location.origin;
})();

/**
 * Every font family the doc can ask for, across the base tokens, the de-linked
 * rec-page design, per-node overrides and breakpoint overrides. A superset is
 * correct here: googleFontsUrl() drops system fonts and dedupes, and an unused
 * family costs one entry in a stylesheet request we are already making.
 */
function collectFontFamilies(data: EmbedPayload): string[] {
  const families: string[] = [];
  const push = (tokens: unknown): void => {
    const typography = (
      tokens as { typography?: { heading?: { family?: string }; body?: { family?: string } } } | null
    )?.typography;
    if (typography?.heading?.family) families.push(typography.heading.family);
    if (typography?.body?.family) families.push(typography.body.family);
  };
  push(data.designTokens);
  push(data.recPageDesign);
  for (const tokens of Object.values(data.designOverrides ?? {})) push(tokens);
  for (const bp of Object.values(data.breakpointOverrides ?? {})) {
    push(bp?.desktop);
    push(bp?.mobile);
  }
  return families;
}

/**
 * Font faces are DOCUMENT-scoped — a stylesheet inside a shadow root cannot
 * register them. The head link is what makes the merchant's chosen fonts
 * actually resolve inside the shadow tree.
 */
function ensureFontLink(data: EmbedPayload): void {
  const href = googleFontsUrl(collectFontFamilies(data));
  if (!href) return; // system fonts only — nothing to fetch
  if (document.querySelector(`link[data-wiskr-font][href="${CSS.escape(href)}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.setAttribute("data-wiskr-font", "");
  document.head.appendChild(link);
}

/** The runtime sheet goes INSIDE the shadow root — that is what scopes it. */
function injectShadowStyles(shadow: ShadowRoot): void {
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = runtimeCss;
  shadow.appendChild(style);
}

async function mount(host: HTMLElement): Promise<void> {
  const quizId = host.dataset.quizId;
  if (!quizId) {
    // A misconfigured block must never throw into the merchant's page.
    console.warn("[wiskr] mount target has no data-quiz-id", host);
    return;
  }
  if (host.dataset[MOUNTED]) return;
  host.dataset[MOUNTED] = "1";

  // Every runtime API call resolves against US, not the storefront.
  setApiBase(SCRIPT_ORIGIN);
  // ...but the CART is the storefront's, and now plainly same-origin.
  setEmbedMode(true);

  const locale = host.dataset.locale;
  const url = new URL(`${SCRIPT_ORIGIN}/q/${encodeURIComponent(quizId)}.embed.json`);
  if (locale) url.searchParams.set("locale", locale);
  const buddy = new URLSearchParams(window.location.search).get("buddy");
  if (buddy) url.searchParams.set("buddy", buddy);

  let data: EmbedPayload;
  try {
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`embed.json ${res.status}`);
    data = (await res.json()) as EmbedPayload;
  } catch (err) {
    // Leave the host element empty rather than showing a broken shell. The
    // theme block keeps its iframe fallback for exactly this case.
    console.warn("[wiskr] could not load quiz", quizId, err);
    delete host.dataset[MOUNTED];
    return;
  }

  ensureFontLink(data);

  // Reuse an existing root on re-init (the theme editor re-runs section JS);
  // attachShadow throws if called twice on the same element. A host that
  // refuses a shadow root (rare, but attachShadow throws on several element
  // types) degrades to light DOM rather than rendering nothing — the quiz
  // still works, it just inherits more of the theme.
  let mountParent: ShadowRoot | HTMLElement;
  try {
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    if (!shadow.getElementById(STYLE_ID)) injectShadowStyles(shadow);
    mountParent = shadow;
  } catch {
    console.warn("[wiskr] shadow root unavailable, falling back to light DOM");
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = runtimeCss;
      document.head.appendChild(style);
    }
    mountParent = host;
  }

  const root = document.createElement("div");
  root.className = "qz-embed-root";
  mountParent.appendChild(root);

  createRoot(root).render(
    <QuizRuntime
      mode="live"
      doc={data.doc}
      productIndex={data.productIndex}
      designTokens={data.designTokens}
      designOverrides={data.designOverrides}
      breakpointOverrides={data.breakpointOverrides}
      resultLayoutMode={data.resultLayoutMode}
      designLinked={data.designLinked}
      recPageDesign={data.recPageDesign}
      quizId={data.quizId}
      version={data.version}
      shopDomain={data.shopDomain}
      platform={data.platform}
      answerWeights={data.answerWeights}
      targetProductIdsMap={data.targetProductIdsMap}
      targetIndex={data.targetIndex}
      chrome={data.chrome}
      locale={data.locale}
      buddySessionId={data.buddySessionId}
      aiCopyEnabled={data.aiCopyEnabled}
    />,
  );
}

/** Mount every un-mounted target currently in the document. */
function mountAll(): void {
  document
    .querySelectorAll<HTMLElement>("[data-wiskr-quiz]")
    .forEach((host) => void mount(host));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountAll);
} else {
  mountAll();
}

// Themes render sections lazily and the Shopify theme editor re-renders a
// block on every settings change, so a one-shot mount would leave those dead.
declare global {
  interface Window {
    Wiskr?: { mount: (host: HTMLElement) => void; mountAll: () => void; origin: string };
  }
}
window.Wiskr = { mount: (host) => void mount(host), mountAll, origin: SCRIPT_ORIGIN };
document.addEventListener("shopify:section:load", mountAll);
