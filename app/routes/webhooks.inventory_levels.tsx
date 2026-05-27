import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

// Inventory level updates arrive frequently. For the PoC we acknowledge them
// without writing — variant-level inventory isn't yet used by the catalog
// summary or quiz logic. M6 will need this; revisit then.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop } = await authenticate.webhook(request);
  console.log(`[webhook] ${topic} for ${shop} (no-op in PoC)`);
  return new Response();
};
