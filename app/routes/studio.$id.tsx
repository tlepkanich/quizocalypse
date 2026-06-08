import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData, useRevalidator, useSearchParams } from "@remix-run/react";
import { useEffect, useState } from "react";
import { StudioBuilder } from "../components/studio/StudioBuilder";
import { AiEditWorkspace } from "../components/studio/AiEditWorkspace";
import { QzPage, QzCard, QzBanner } from "../components/qz";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import {
  loadQuizEditorDataForShop,
  handleQuizEditorActionForShop,
} from "../lib/quizEditorIO.server";
import { unauthenticated } from "../shopify.server";
import prisma from "../db.server";
import { aggregateAllAbFunnels, type FunnelCounts } from "../lib/abAnalytics";

// Standalone builder route — the SAME StudioBuilder the embedded route renders,
// but resolved from the configured dev shop (DEV_SHOP_DOMAIN) behind the shared
// access token, with NO App Bridge. loadQuizEditorDataForShop is shop-scoped
// (where: { id, shopId: shop.id }), so a quiz from any other shop 404s — no
// cross-shop access. The action uses an OFFLINE admin client only for the one
// publish-time Shopify call (discount creation, which degrades gracefully).

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const { id } = params;
  if (!id) throw new Response("Missing quiz id", { status: 400 });
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const data = await loadQuizEditorDataForShop(shop, id, new URL(request.url).origin);

  let abAnalytics: Record<string, Record<string, FunnelCounts>> = {};
  if (data.valid && data.doc) {
    const events = await prisma.event.findMany({
      where: { quizId: id },
      select: { sessionId: true, eventType: true, payload: true },
    });
    abAnalytics = aggregateAllAbFunnels(data.doc, events);
  }
  // Async-onboarding marker (separate tiny read — the shared editor loader
  // doesn't surface it). Drives the polling "Building…" overlay below.
  const buildRow = await prisma.quiz.findUnique({
    where: { id },
    select: { buildState: true },
  });
  return json({ ...data, abAnalytics, buildState: buildRow?.buildState ?? null });
};

export const action = async ({ params, request }: ActionFunctionArgs) => {
  const { id } = params;
  if (!id) return json({ ok: false, error: "Missing id" }, { status: 400 });
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  return handleQuizEditorActionForShop(shop, id, request, async () => {
    const { admin } = await unauthenticated.admin(shop.shopDomain);
    return admin;
  });
};

export default function StandaloneStudio() {
  const data = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const revalidator = useRevalidator();
  const buildState = data.buildState;
  // Escape hatch: ?force=1 bypasses the overlay (open the draft anyway, e.g. if
  // a build stalled). The detached build keeps writing in the background.
  const force = params.get("force") === "1";

  // While the detached AI build runs, poll until buildState clears (→ editor)
  // or flips to "error:". Re-validates the loader, which re-reads buildState.
  useEffect(() => {
    if (force || buildState !== "building") return;
    const t = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, 3000);
    return () => clearInterval(t);
  }, [force, buildState, revalidator]);

  if (!force && buildState === "building") return <BuildingOverlay />;
  if (!force && buildState?.startsWith("error:")) {
    return <BuildError message={buildState.slice("error:".length)} />;
  }

  // AI-first is the default surface; ?mode=advanced opens the full builder.
  return params.get("mode") === "advanced" ? (
    <StudioBuilder data={data} chrome="standalone" />
  ) : (
    <AiEditWorkspace data={data} chrome="standalone" />
  );
}

// Live "Building…" overlay shown while the detached AI onboarding build runs.
// The route polls (above), so this resolves itself the moment buildState clears.
const BUILD_STAGES = [
  "Reading your catalog…",
  "Mapping your products…",
  "Writing your quiz…",
];

function BuildingOverlay() {
  // Staged progress copy (Dev Spec §2 Step 4): advance through the stages, then
  // hold on the long-tail "Writing…" (AI generation dominates the wait). The
  // spinner keeps it animated so it never reads as frozen.
  const [stage, setStage] = useState(0);
  useEffect(() => {
    if (stage >= BUILD_STAGES.length - 1) return;
    const t = setTimeout(() => setStage((s) => s + 1), 3500);
    return () => clearTimeout(t);
  }, [stage]);
  return (
    <QzPage>
      <style>{`@keyframes qzspin{to{transform:rotate(360deg)}}`}</style>
      <QzCard
        style={{
          marginTop: 40,
          padding: 40,
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          gap: 16,
          alignItems: "center",
        }}
      >
        <div
          aria-hidden
          style={{
            width: 34,
            height: 34,
            borderRadius: "50%",
            border: "3px solid var(--qz-rule, #e5e5e5)",
            borderTopColor: "var(--qz-accent, #2a6df4)",
            animation: "qzspin 0.8s linear infinite",
          }}
        />
        <h2 className="qz-h1" style={{ margin: 0 }}>Building your quiz…</h2>
        <p
          className="qz-h2"
          style={{ margin: 0, maxWidth: 460, minHeight: 24, fontWeight: 600 }}
        >
          {BUILD_STAGES[stage]}
        </p>
        <p className="qz-dim" style={{ margin: 0, fontSize: 13, maxWidth: 460 }}>
          This usually takes about a minute.
        </p>
        <div className="qz-dim" style={{ fontSize: 13 }}>
          This page refreshes itself — no need to reload.{" "}
          <Link to="?force=1" className="qz-link">
            Taking too long? Open the builder →
          </Link>
        </div>
      </QzCard>
    </QzPage>
  );
}

// Shown when the detached build threw. The seed/degraded draft still exists, so
// the merchant can open it and finish manually, or start over.
function BuildError({ message }: { message: string }) {
  return (
    <QzPage>
      <QzCard style={{ marginTop: 40, padding: 32, display: "flex", flexDirection: "column", gap: 14 }}>
        <h2 className="qz-h1" style={{ margin: 0 }}>The build hit a snag</h2>
        <QzBanner tone="warn" title="AI couldn’t finish building this quiz">
          {message || "Something went wrong while generating. You can open the builder and finish manually, or start over."}
        </QzBanner>
        <div className="qz-row" style={{ gap: 8 }}>
          <Link to="/studio/onboarding" className="qz-btn qz-btn-accent">Try again</Link>
          <Link to="?force=1" className="qz-btn qz-btn-ghost">Open the builder anyway</Link>
        </div>
      </QzCard>
    </QzPage>
  );
}
