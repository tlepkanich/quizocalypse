import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import { parseBrandIdentitySafe } from "../lib/brandIdentity";
import {
  runBrandIdentityBuild,
  saveBrandIdentityEdits,
  confirmBrandIdentity,
} from "../lib/brandIdentityBuild.server";
import { QzPage, QzPageHeader } from "../components/qz";
import { BrandIdentityReview } from "../components/studio/BrandIdentityReview";

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

  if (intent === "save") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(form.get("identity") ?? "null"));
    } catch {
      return json({ ok: false, error: "bad identity JSON" }, { status: 400 });
    }
    const res = await saveBrandIdentityEdits(shop.id, parsed);
    return json(res, { status: res.ok ? 200 : 400 });
  }
  if (intent === "confirm") {
    const res = await confirmBrandIdentity(shop.id);
    return json(res, { status: res.ok ? 200 : 400 });
  }
  // build | refresh — awaited (one AI call ≈ 15–30s, within the edge-proxy
  // window). Admin is optional: with an offline session we add the maximal pull,
  // otherwise the digest builds from the synced catalog alone.
  const result = await runBrandIdentityBuild(shop.id, undefined, { refine: intent === "refresh" });
  return json(result, { status: result.ok ? 200 : 502 });
};

export default function StudioBrand() {
  const { shopDomain, state, identity } = useLoaderData<typeof loader>();
  return (
    <QzPage>
      <QzPageHeader
        eyebrow="Brand identity"
        title="Here's what we see"
        subtitle={`The internal brand identity we digested for ${shopDomain}. Edit anything that's off — your edits are locked so a re-sync never overwrites them.`}
        actions={
          <Link to="/studio" className="qz-btn qz-btn-ghost qz-btn-sm">
            ← All quizzes
          </Link>
        }
      />
      <BrandIdentityReview identity={identity} state={state} />
      <div
        className="qz-row qz-row-between"
        style={{ marginTop: 20, gap: 12, flexWrap: "wrap", alignItems: "center" }}
      >
        <span className="qz-dim" style={{ fontSize: 13 }}>
          This identity is applied automatically whenever the AI builds a quiz — no need to revisit it each time.
        </span>
        <Link to="/studio/onboarding" className="qz-btn qz-btn-ghost qz-btn-sm">
          Create a quiz →
        </Link>
      </div>
    </QzPage>
  );
}
