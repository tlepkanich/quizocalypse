import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

// The bare domain is the standalone studio's front door. Shopify's embedded
// install/login still arrives here with ?shop=…; forward that to /app so the
// OAuth flow is untouched. Every other (direct) visit goes to /studio, where
// the access-key gate takes over. This replaces the stock template's
// placeholder marketing page.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  throw redirect("/studio");
};
