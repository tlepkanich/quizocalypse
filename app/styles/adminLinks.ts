import type { LinkDescriptor } from "@remix-run/node";
import qzStyles from "./quizocalypse.css?url";

// BIC-2 B1 — the admin stylesheet chain, moved OUT of root.tsx links() so the
// shopper routes (/q/:id and friends) stop downloading ~100KB of body[data-qz]
// admin CSS plus two admin-font preloads they never use (the runtime styles
// itself inline; see app/styles/quiz-runtime.css for the shopper-side sheet).
//
// Every ADMIN document route spreads this into its own links():
//   - layout routes cover their nested children (studio.tsx → studio.*;
//     app.tsx → app.*)
//   - DE-NESTED routes (studio_. prefix) escape those layouts and each link
//     it directly: studio_.$id, studio_.onboarding_.$quizId, studio_.login,
//     studio_.verify.
// Adding a new studio_./app_. de-nested document route? It needs these links
// too, or it renders unstyled.
export const adminStyleLinks: LinkDescriptor[] = [
  // Self-hosted font: preload so the swap window is one paint, not a fetch
  // round-trip. crossOrigin is required for font preloads. Figtree is the
  // Quartz admin typeface (leads every --qz-font-* stack, mono included).
  // Mona Sans stays on disk + in the sheet's @font-face for embedded quiz
  // previews (quiz-runtime.css names it) but is loaded on demand, not here.
  { rel: "preload", href: "/fonts/Figtree.woff2", as: "font", type: "font/woff2", crossOrigin: "anonymous" },
  { rel: "stylesheet", href: qzStyles },
  // QRTZ-H — the Wiskr cat favicon (brand-2026 mark): dark-tab-aware SVG +
  // the PNG-based .ico fallback + apple-touch. Admin trees only — /q's HTML
  // stays byte-clean; shopper tabs get the cat via the auto /favicon.ico
  // fetch (the .ico bytes are the new mark).
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
  { rel: "icon", href: "/favicon.ico", sizes: "32x32" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
];
