import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { UnifiedWorkspace } from "../components/studio/UnifiedWorkspace";
import {
  loadQuizEditorData,
  handleQuizEditorAction,
} from "../lib/quizEditorIO.server";
import prisma from "../db.server";
import { aggregateAllAbFunnels, type FunnelCounts } from "../lib/abAnalytics";

// Embedded Studio route — runs inside the Shopify admin iframe. The builder UI
// itself lives in the server-free <StudioBuilder> so the standalone /studio
// surface can render the identical editor (see app/routes/studio.$id.tsx).

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const { id } = params;
  if (!id) throw new Response("Missing quiz id", { status: 400 });
  const data = await loadQuizEditorData(request, id);
  // Per-variant funnels for every ab_split branch, used by the Optimize tab's
  // A/B cards. Events carry the assigned slot in payload.ab (set by q.$id.tsx).
  let abAnalytics: Record<string, Record<string, FunnelCounts>> = {};
  if (data.valid && data.doc) {
    const events = await prisma.event.findMany({
      where: { quizId: id },
      select: { sessionId: true, eventType: true, payload: true },
    });
    abAnalytics = aggregateAllAbFunnels(data.doc, events);
  }
  return json({ ...data, abAnalytics });
};

export const action = async ({ params, request }: ActionFunctionArgs) => {
  const { id } = params;
  if (!id) return json({ ok: false, error: "Missing id" }, { status: 400 });
  return handleQuizEditorAction(request, id);
};

export default function StudioRoute() {
  const data = useLoaderData<typeof loader>();
  // Unified P8: ONE workspace. Legacy ?mode=ai / ?mode=advanced / ?mode=next
  // URLs all land here (the param is simply ignored — bookmarks keep working).
  return <UnifiedWorkspace data={data} chrome="embedded" />;
}
