import type { LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { Quiz } from "../lib/quizSchema";

// Serves a tiny JS snippet that merchants drop on their storefront via a
// theme code injection or the Theme App Extension. When loaded it injects
// a floating button matching the configured launcher_config; clicking it
// opens the quiz inside a full-screen modal iframe pointing at /q/:id.
//
// We render this as a JS file (not HTML) so the merchant can include it
// with a regular <script src="..."> tag. Cache for 60s to avoid hammering
// the DB while staying responsive to merchant launcher config edits.

const ICON_SVGS: Record<string, string> = {
  sparkle:
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></svg>',
  star:
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3 7 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"/></svg>',
  chat:
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
};

const CORNER_STYLES: Record<string, string> = {
  "bottom-right": "bottom: 24px; right: 24px;",
  "bottom-left": "bottom: 24px; left: 24px;",
  "top-right": "top: 24px; right: 24px;",
  "top-left": "top: 24px; left: 24px;",
};

export async function loader({ params, request }: LoaderFunctionArgs) {
  const { id } = params;
  if (!id) return new Response("Missing id", { status: 400 });

  const quiz = await prisma.quiz.findFirst({
    where: { id },
    select: { publishedJson: true },
  });
  if (!quiz?.publishedJson) {
    return new Response("// Quiz not published", {
      status: 404,
      headers: { "Content-Type": "application/javascript" },
    });
  }

  const parsed = Quiz.safeParse(quiz.publishedJson);
  if (!parsed.success) {
    return new Response("// Quiz JSON invalid", {
      status: 500,
      headers: { "Content-Type": "application/javascript" },
    });
  }

  const cfg = parsed.data.launcher_config;
  if (!cfg.enabled) {
    return new Response("// Launcher not enabled for this quiz", {
      status: 200,
      headers: { "Content-Type": "application/javascript" },
    });
  }

  // The quiz iframe lives on the same origin we're serving this script
  // from. We derive the base URL from the incoming request so it works
  // identically in dev (tunnel) and prod without configuration.
  const reqUrl = new URL(request.url);
  const origin = `${reqUrl.protocol}//${reqUrl.host}`;
  const quizUrl = `${origin}/q/${id}`;

  const icon = ICON_SVGS[cfg.icon] ?? ICON_SVGS.sparkle;
  const cornerCss = CORNER_STYLES[cfg.corner] ?? CORNER_STYLES["bottom-right"];
  // Brand color fallback: use the quiz's primary token at publish time so
  // the launcher matches without an extra config field.
  const bgColor =
    cfg.color ?? parsed.data.design_tokens.colors?.primary ?? "#5563DE";
  const label = cfg.label.replace(/[<>&"']/g, "");

  const script = `(function(){
  if (window.__qzLauncher_${id.replace(/[^a-z0-9]/gi, "")}) return;
  window.__qzLauncher_${id.replace(/[^a-z0-9]/gi, "")} = true;

  var style = document.createElement("style");
  style.textContent = ${JSON.stringify(`
    .qz-launcher-btn {
      position: fixed; ${cornerCss}
      z-index: 2147483646;
      background: ${bgColor};
      color: #fff;
      border: none;
      border-radius: 999px;
      padding: 14px 18px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.18);
      cursor: pointer;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 14px;
      font-weight: 600;
      display: flex; align-items: center; gap: 8px;
      transition: transform 150ms ease;
    }
    .qz-launcher-btn:hover { transform: scale(1.05); }
    .qz-launcher-modal {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.45);
      z-index: 2147483647;
      display: none;
      align-items: center; justify-content: center;
      padding: 24px;
    }
    .qz-launcher-modal.open { display: flex; }
    .qz-launcher-frame {
      width: 100%; max-width: 720px; height: 90vh; max-height: 800px;
      background: #fff; border-radius: 12px; overflow: hidden;
      box-shadow: 0 12px 40px rgba(0,0,0,0.32);
      border: 0;
    }
    .qz-launcher-close {
      position: absolute; top: 32px; right: 32px;
      background: rgba(255,255,255,0.95);
      border: none; border-radius: 999px;
      width: 36px; height: 36px;
      cursor: pointer; font-size: 18px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.18);
    }
  `)};
  document.head.appendChild(style);

  var btn = document.createElement("button");
  btn.className = "qz-launcher-btn";
  btn.setAttribute("aria-label", "Open quiz");
  btn.innerHTML = ${JSON.stringify(icon)}${
    label ? ` + ${JSON.stringify(`<span>${label}</span>`)}` : ""
  };

  var modal = document.createElement("div");
  modal.className = "qz-launcher-modal";
  modal.innerHTML = ${JSON.stringify(`
    <iframe class="qz-launcher-frame" src="${quizUrl}" title="Quiz" allow="clipboard-write"></iframe>
    <button class="qz-launcher-close" aria-label="Close quiz">×</button>
  `)};

  btn.addEventListener("click", function(){ modal.classList.add("open"); });
  modal.addEventListener("click", function(e){
    if (e.target === modal || e.target.classList.contains("qz-launcher-close")) {
      modal.classList.remove("open");
    }
  });
  document.addEventListener("keydown", function(e){
    if (e.key === "Escape") modal.classList.remove("open");
  });

  document.body.appendChild(btn);
  document.body.appendChild(modal);
})();`;

  return new Response(script, {
    status: 200,
    headers: {
      "Content-Type": "application/javascript",
      "Cache-Control": "public, max-age=60",
    },
  });
}
