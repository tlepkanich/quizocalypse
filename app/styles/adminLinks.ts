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
  // Self-hosted fonts (design-system-V2): preload so the swap window is one
  // paint, not a fetch round-trip. crossOrigin is required for font preloads.
  { rel: "preload", href: "/fonts/MonaSans.woff2", as: "font", type: "font/woff2", crossOrigin: "anonymous" },
  { rel: "preload", href: "/fonts/JetBrainsMono-Medium.woff2", as: "font", type: "font/woff2", crossOrigin: "anonymous" },
  { rel: "stylesheet", href: qzStyles },
];
