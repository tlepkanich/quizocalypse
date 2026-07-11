import type { CSSProperties } from "react";
import type { ActionFunctionArgs, LinksFunction, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { adminStyleLinks } from "../styles/adminLinks";
import { Form, useActionData, useNavigation } from "@remix-run/react";
import { hasStudioAccess } from "../lib/studioAccess.server";
import { requestMagicLink } from "../lib/studioMagicLink.server";

// BIC-2 B1 — de-nested route (studio_ prefix escapes the studio.tsx layout),
// so it must link the admin sheet itself (body reset + Mona Sans).
export const links: LinksFunction = () => adminStyleLinks;

// Magic-link login for the standalone /studio surface. The `studio_` filename
// prefix de-nests this route from the gated studio.tsx layout, so it renders
// pre-auth (and the static "login" segment outranks the dynamic studio_.$id
// builder route). P2 Edit 2 — repainted to the Soft Pastel brand: it links the
// admin sheet (above) and uses the token-wired --qz-* system + qz-* classes so
// the first screen users see carries the identity.

export const meta: MetaFunction = () => [{ title: "Sign in · Quizocalypse Studio" }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (await hasStudioAccess(request)) throw redirect("/studio");
  return json({});
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const form = await request.formData();
  const email = String(form.get("email") ?? "");
  if (email) {
    // Same-origin link target, proxy-aware (Fly terminates TLS upstream).
    const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim()
      ?? new URL(request.url).protocol.replace(":", "");
    const host = request.headers.get("host") ?? new URL(request.url).host;
    await requestMagicLink(email, `${proto}://${host}`);
  }
  // Always "sent" — never reveals whether the address is allowlisted.
  return json({ sent: true });
};

// Soft Pastel, token-wired (all values resolve from the loaded admin sheet's
// :root). Card / input / button use the shared qz-* classes; only layout is
// inline here.
const styles: Record<string, CSSProperties> = {
  body: {
    margin: 0,
    minHeight: "100vh",
    display: "grid",
    placeItems: "center",
    padding: 24,
    background: "var(--qz-cream)",
    color: "var(--qz-ink)",
    fontFamily: "var(--qz-font-body)",
  },
  card: { width: 360, display: "flex", flexDirection: "column", gap: 14 },
  brand: { display: "flex", alignItems: "center", gap: 10, marginBottom: 2 },
  mono: {
    width: 36,
    height: 36,
    flex: "none",
    borderRadius: 10,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--qz-accent-wash)",
    color: "var(--qz-accent-ink)",
    fontFamily: "var(--qz-font-display)",
    fontWeight: 700,
    fontSize: 20,
    lineHeight: 1,
  },
  h1: {
    fontFamily: "var(--qz-font-display)",
    fontSize: 18,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    margin: 0,
  },
  p: { fontSize: 13.5, color: "var(--qz-ink-3)", margin: "0 0 4px", lineHeight: 1.5 },
};

export default function StudioLogin() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state !== "idle";

  return (
    <div style={styles.body}>
      {actionData?.sent ? (
        <div className="qz-card" style={styles.card}>
          <div style={styles.brand}>
            <span style={styles.mono} aria-hidden>
              Q
            </span>
            <h1 style={styles.h1}>Check your email</h1>
          </div>
          <p style={styles.p}>
            If that address has access, a sign-in link is on its way. It works
            once and expires in 15 minutes.
          </p>
        </div>
      ) : (
        <Form method="post" className="qz-card" style={styles.card}>
          <div style={styles.brand}>
            <span style={styles.mono} aria-hidden>
              Q
            </span>
            <h1 style={styles.h1}>Quizocalypse Studio</h1>
          </div>
          <p style={styles.p}>Enter your email and we&rsquo;ll send you a sign-in link.</p>
          <input
            className="qz-input"
            name="email"
            type="email"
            required
            placeholder="you@example.com"
            autoFocus
            autoComplete="email"
            aria-label="Email address"
          />
          <button className="qz-btn qz-btn-primary" type="submit" disabled={submitting}>
            {submitting ? "Sending…" : "Email me a sign-in link"}
          </button>
        </Form>
      )}
    </div>
  );
}
