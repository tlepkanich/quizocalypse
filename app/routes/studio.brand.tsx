import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useLoaderData, useNavigation } from "@remix-run/react";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import { parseBrandIdentitySafe } from "../lib/brandIdentity";
import { runBrandIdentityBuild } from "../lib/brandIdentityBuild.server";
import { QzPage, QzPageHeader, QzCard, QzButton, QzBanner } from "../components/qz";

// Brand Identity — the deploy-validation surface (P3). Cookie-gated like the
// rest of /studio; it runs a REAL build against the dev shop via the offline
// admin session and renders / returns the persisted identity. P4 grows this into
// the full editable "here's what we see" screen; for now it proves the chain
// end-to-end on the live deploy (and the action returns JSON for headless
// verification: POST intent=build with the studio cookie).

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  return json({
    shopDomain: shop.shopDomain,
    state: shop.brandIdentityState ?? null,
    identity: parseBrandIdentitySafe(shop.brandIdentity),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "build");
  const refine = intent === "refresh";
  // Awaited (a single AI call ≈ 15–30s, within the edge-proxy window). Uses the
  // offline admin session — works on the deploy with no embedded iframe.
  const result = await runBrandIdentityBuild(shop.id, undefined, { refine });
  return json(result, { status: result.ok ? 200 : 502 });
};

export default function StudioBrand() {
  const { shopDomain, state, identity } = useLoaderData<typeof loader>();
  const nav = useNavigation();
  const building = nav.state !== "idle" || state === "building";
  const errorState = state?.startsWith("error:") ? state.slice("error:".length) : null;

  return (
    <QzPage>
      <QzPageHeader
        eyebrow="Brand identity · validation"
        title="Here's what we see"
        subtitle={`The internal brand identity we digested for ${shopDomain}. P4 turns this into the editable confirm screen.`}
        actions={
          <Form method="post">
            <input type="hidden" name="intent" value={identity ? "refresh" : "build"} />
            <QzButton type="submit" variant="accent" disabled={building}>
              {building ? "Digesting…" : identity ? "Refresh" : "Build identity"}
            </QzButton>
          </Form>
        }
      />

      {errorState ? (
        <QzBanner tone="warn" title="Last build errored">
          {errorState}
        </QzBanner>
      ) : null}

      {!identity ? (
        <QzCard style={{ padding: 20 }}>
          <p className="qz-dim" style={{ margin: 0, fontSize: 14 }}>
            No identity yet. Click <strong>Build identity</strong> to digest this shop's catalog,
            brand assets, theme, and best-sellers into a brand identity.
          </p>
        </QzCard>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <QzCard style={{ padding: 20 }}>
            <div className="qz-label" style={{ marginBottom: 6 }}>
              Summary · confidence {identity.confidence}
            </div>
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55 }}>{identity.summary}</p>
            {identity.tags.length > 0 ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
                {identity.tags.map((t) => (
                  <span
                    key={t}
                    style={{
                      fontSize: 12,
                      padding: "2px 10px",
                      borderRadius: 999,
                      background: "var(--qz-rule, #eee)",
                    }}
                  >
                    {t}
                  </span>
                ))}
              </div>
            ) : null}
          </QzCard>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
            <QzCard style={{ padding: 20 }}>
              <div className="qz-label" style={{ marginBottom: 8 }}>
                Design lens · {identity.design.confidence}
              </div>
              <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", fontSize: 13 }}>
                <dt className="qz-dim">Aesthetic</dt>
                <dd style={{ margin: 0 }}>{identity.design.aesthetic.join(", ") || "—"}</dd>
                <dt className="qz-dim">Imagery</dt>
                <dd style={{ margin: 0 }}>{identity.design.imagery_density}</dd>
                <dt className="qz-dim">Palette</dt>
                <dd style={{ margin: 0 }}>{identity.design.color_temperament}</dd>
                <dt className="qz-dim">Template</dt>
                <dd style={{ margin: 0 }}>
                  {identity.design.suggested_theme_preset_id} · {identity.design.suggested_layout_variant_id}
                </dd>
              </dl>
              <p className="qz-dim" style={{ fontSize: 12.5, marginTop: 10, marginBottom: 0 }}>
                {identity.design.rationale}
              </p>
            </QzCard>

            <QzCard style={{ padding: 20 }}>
              <div className="qz-label" style={{ marginBottom: 8 }}>
                Positioning lens · {identity.positioning.confidence}
              </div>
              <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", fontSize: 13 }}>
                <dt className="qz-dim">Industry</dt>
                <dd style={{ margin: 0 }}>{identity.positioning.industry || "—"}</dd>
                <dt className="qz-dim">Vertical</dt>
                <dd style={{ margin: 0 }}>{identity.positioning.vertical || "—"}</dd>
                <dt className="qz-dim">Audience</dt>
                <dd style={{ margin: 0 }}>{identity.positioning.target_demographic.join(", ") || "—"}</dd>
                <dt className="qz-dim">Price</dt>
                <dd style={{ margin: 0 }}>{identity.positioning.price_tier}</dd>
                <dt className="qz-dim">Trends</dt>
                <dd style={{ margin: 0 }}>{identity.positioning.category_trends.join(", ") || "—"}</dd>
              </dl>
            </QzCard>
          </div>

          <p className="qz-dim" style={{ fontSize: 12, margin: 0 }}>
            Sources: {identity.sources.map((s) => s.kind).join(" · ") || "—"} · v{identity.version}
          </p>
        </div>
      )}
    </QzPage>
  );
}
