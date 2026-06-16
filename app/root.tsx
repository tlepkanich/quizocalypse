import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from "@remix-run/react";
import { json, type LinksFunction, type LoaderFunctionArgs } from "@remix-run/node";

import qzStyles from "./styles/quizocalypse.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: qzStyles },
];

// Read the persisted admin theme from a cookie so SSR can set data-theme on
// <html> before first paint (no FOUC, no inline script). Only the admin chrome
// (body[data-qz]) reacts to it; the shopper runtime /q renders its own subtree
// with its own --qz-color-* and ignores this entirely.
export async function loader({ request }: LoaderFunctionArgs) {
  const dark = /(?:^|;\s*)qz-theme=dark(?:;|$)/.test(request.headers.get("Cookie") ?? "");
  return json({ theme: dark ? "dark" : "light" });
}

export default function App() {
  const { theme } = useLoaderData<typeof loader>();
  return (
    <html lang="en" {...(theme === "dark" ? { "data-theme": "dark" } : {})}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
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
