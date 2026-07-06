import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { logFor } from "../lib/log.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    const { payload, session, topic, shop } = await authenticate.webhook(request);
    logFor("webhook").info({ topic, shop }, "received");

    const current = payload.current as string[];
    if (session) {
        // HII-2 — a failed scope write 500s so Shopify REDELIVERS the (idempotent)
        // update, instead of acking 200 and leaving the session's stored scope
        // stale. authenticate.webhook above already validated HMAC.
        try {
            await db.session.update({
                where: {
                    id: session.id
                },
                data: {
                    scope: current.toString(),
                },
            });
        } catch (err) {
            logFor("webhook").error({ err, topic, shop }, "scope update failed");
            return new Response(null, { status: 500 });
        }
    }
    return new Response();
};
