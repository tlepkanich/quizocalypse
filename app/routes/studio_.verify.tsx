import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Link } from "@remix-run/react";
import { grantStudioSession } from "../lib/studioAccess.server";
import { consumeMagicLink } from "../lib/studioMagicLink.server";

// Magic-link landing route: consumes the single-use token from the email and
// sets the signed session cookie. De-nested from the gated studio.tsx layout
// (studio_ prefix) — it must be reachable pre-auth. An invalid/expired/used
// token falls through to the default export, which offers a retry link.

export const meta: MetaFunction = () => [{ title: "Sign in · Quizocalypse Studio" }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const email = await consumeMagicLink(token);
  if (email) {
    throw redirect("/studio", {
      headers: { "Set-Cookie": await grantStudioSession(email, request) },
    });
  }
  return null;
};

export default function StudioVerify() {
  return (
    <div
      style={{
        margin: 0,
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "#0f0f10",
        color: "#fafafa",
        fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          width: 320,
          padding: 28,
          background: "#1a1a1c",
          border: "1px solid #2a2a2e",
          borderRadius: 14,
        }}
      >
        <h1 style={{ fontSize: 16, margin: "0 0 4px" }}>Link expired</h1>
        <p style={{ fontSize: 13, color: "#a1a1aa", margin: "0 0 8px" }}>
          This sign-in link is invalid, already used, or older than 15 minutes.
        </p>
        <Link
          to="/studio/login"
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            background: "#2a6df4",
            color: "#fff",
            fontWeight: 600,
            textAlign: "center",
            textDecoration: "none",
          }}
        >
          Request a new link
        </Link>
      </div>
    </div>
  );
}
