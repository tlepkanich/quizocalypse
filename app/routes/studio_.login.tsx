import type { CSSProperties } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useNavigation } from "@remix-run/react";
import { hasStudioAccess } from "../lib/studioAccess.server";
import { requestMagicLink } from "../lib/studioMagicLink.server";

// Magic-link login for the standalone /studio surface. The `studio_` filename
// prefix de-nests this route from the gated studio.tsx layout, so it renders
// pre-auth (and the static "login" segment outranks the dynamic studio_.$id
// builder route). Styling is self-contained inline — this page must not depend
// on the authed studio shell's CSS.

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

const styles: Record<string, CSSProperties> = {
  body: {
    margin: 0,
    minHeight: "100vh",
    display: "grid",
    placeItems: "center",
    background: "#0f0f10",
    color: "#fafafa",
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    width: 320,
    padding: 28,
    background: "#1a1a1c",
    border: "1px solid #2a2a2e",
    borderRadius: 14,
  },
  h1: { fontSize: 16, margin: "0 0 4px" },
  p: { fontSize: 13, color: "#a1a1aa", margin: "0 0 8px" },
  input: {
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid #3a3a3e",
    background: "#0f0f10",
    color: "#fafafa",
    fontSize: 14,
  },
  button: {
    padding: "10px 12px",
    borderRadius: 8,
    border: "none",
    background: "#2a6df4",
    color: "#fff",
    fontWeight: 600,
    cursor: "pointer",
  },
};

export default function StudioLogin() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state !== "idle";

  return (
    <div style={styles.body}>
      {actionData?.sent ? (
        <div style={styles.card}>
          <h1 style={styles.h1}>Check your email</h1>
          <p style={styles.p}>
            If that address has access, a sign-in link is on its way. It works
            once and expires in 15 minutes.
          </p>
        </div>
      ) : (
        <Form method="post" style={styles.card}>
          <h1 style={styles.h1}>Quizocalypse Studio</h1>
          <p style={styles.p}>Enter your email and we&rsquo;ll send you a sign-in link.</p>
          <input
            style={styles.input}
            name="email"
            type="email"
            required
            placeholder="you@example.com"
            autoFocus
            autoComplete="email"
            aria-label="Email address"
          />
          <button style={styles.button} type="submit" disabled={submitting}>
            {submitting ? "Sending…" : "Email me a sign-in link"}
          </button>
        </Form>
      )}
    </div>
  );
}
