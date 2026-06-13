import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { parseBrandIdentitySafe } from "../lib/brandIdentity";
import {
  runBrandIdentityBuild,
  saveBrandIdentityEdits,
  confirmBrandIdentity,
} from "../lib/brandIdentityBuild.server";
import { QzPage, QzPageHeader } from "../components/qz";
import { BrandIdentityReview } from "../components/studio/BrandIdentityReview";

// Embedded twin of /studio/brand — the production "here's what we see" screen.
// Same shared <BrandIdentityReview>, but it authenticates via Shopify admin and
// passes the LIVE admin into the build, so this path gets the full maximal pull
// (shop meta / brand / theme / best-sellers) without depending on a stored
// offline session.

async function resolveEmbeddedShop(request: Request) {
  const { session, admin } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) throw new Response("Shop not found", { status: 404 });
  return { shop, admin: admin as AdminApiContext };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await resolveEmbeddedShop(request);
  return json({
    state: shop.brandIdentityState ?? null,
    identity: parseBrandIdentitySafe(shop.brandIdentity),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, admin } = await resolveEmbeddedShop(request);
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
  // build | refresh — pass the LIVE admin for the maximal pull.
  const result = await runBrandIdentityBuild(shop.id, admin, { refine: intent === "refresh" });
  return json(result, { status: result.ok ? 200 : 502 });
};

export default function AppOnboardingBrand() {
  const { state, identity } = useLoaderData<typeof loader>();
  return (
    <QzPage>
      <QzPageHeader
        eyebrow="Brand identity"
        title="Here's what we see"
        subtitle="The brand identity we digested from your store. Edit anything that's off — your edits are locked so a re-sync never overwrites them."
        actions={
          <Link to="/app" className="qz-btn qz-btn-ghost qz-btn-sm">
            ← Dashboard
          </Link>
        }
      />
      <BrandIdentityReview identity={identity} state={state} />
    </QzPage>
  );
}
