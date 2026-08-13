import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "@remix-run/react";
// QRTZ-H — the cat favicon links live in the ADMIN trees' links()
// (app/styles/adminLinks.ts), NOT here: root links() would add head tags to
// /q documents too, and the shopper HTML stays byte-clean by policy. Shopper
// tabs still get the cat — browsers auto-fetch /favicon.ico, whose bytes are
// the new mark.

// BIC-2 B1 — no root-level stylesheet: the admin sheet (quizocalypse.css) +
// font preloads moved to the admin route trees' links() (app/styles/
// adminLinks.ts), and the shopper routes link the tiny quiz-runtime.css
// themselves. Shoppers no longer download ~100KB of admin CSS.

// QUARTZ — dark mode is CUT (owner decision, 2026-08-09). The qz-theme cookie
// loader + ThemeToggle that used to set html[data-theme="dark"] are removed,
// so the attribute is never applied and the admin renders light-only (the
// sheet's :root also declares color-scheme: light). The html[data-theme]
// CSS blocks in quizocalypse.css stay as inert dead code until a later
// phase deletes them.

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="icon" type="image/svg+xml" href="/wiskr-fox.svg" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <Meta />
        <Links />
      </head>
      <body data-qz="1">
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
