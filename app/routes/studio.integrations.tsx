import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import prisma from "../db.server";
import { Quiz } from "../lib/quizSchema";
import { QzPage, QzPageHeader, QzCard, QzBadge } from "../components/qz";
import { RecCopyToggleCard } from "../components/RecCopyToggleCard";

// QD-8 — Integrations: every place a quiz sends data when a shopper reaches an
// integration node — Klaviyo profile syncs and outbound webhooks. Scans each
// quiz's working draft. SECRETS NEVER LEAVE THE SERVER: we surface the kind +
// a redacted target (the webhook host, the Klaviyo list), never the api_key or
// webhook secret. Platform-neutral — these are generic HTTP, so they work the
// same standalone or on Shopify.
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

// L2-12d — the per-shop runtime rec-copy kill switch lives here (the standalone
// settings surface). Writing it is the ONLY thing this route's action does.
export const action = async ({ request }: ActionFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const form = await request.formData();
  if (form.get("intent") === "toggle-rec-copy") {
    const enabled = form.get("enabled") === "true";
    await prisma.shop.update({ where: { id: shop.id }, data: { aiRecCopyEnabled: enabled } });
    return json({ ok: true, aiRecCopyEnabled: enabled });
  }
  return json({ ok: false, error: "unknown intent" }, { status: 400 });
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const quizzes = await prisma.quiz.findMany({
    where: { shopId: shop.id, OR: [{ buildState: null }, { buildState: { not: "step1" } }] },
    select: { id: true, name: true, status: true, draftJson: true },
    orderBy: { updatedAt: "desc" },
  });

  type Conn = { kind: "klaviyo" | "webhook"; label: string; target: string };
  const rows: Array<{ id: string; name: string; status: string; connections: Conn[] }> = [];
  let klaviyoCount = 0;
  let webhookCount = 0;

  for (const q of quizzes) {
    const parsed = Quiz.safeParse(q.draftJson);
    if (!parsed.success) continue;
    const connections: Conn[] = [];
    for (const node of parsed.data.nodes) {
      if (node.type !== "integration") continue;
      for (const action of node.data.actions) {
        if (action.kind === "klaviyo") {
          klaviyoCount++;
          connections.push({
            kind: "klaviyo",
            label: action.label,
            target: action.list_id ? `List ${action.list_id}` : "Profile sync",
          });
        } else {
          webhookCount++;
          connections.push({ kind: "webhook", label: action.label, target: hostOf(action.url) });
        }
      }
    }
    if (connections.length > 0) {
      rows.push({ id: q.id, name: q.name, status: q.status, connections });
    }
  }

  return json({ rows, klaviyoCount, webhookCount, aiRecCopyEnabled: shop.aiRecCopyEnabled });
};

const KIND_META: Record<string, { label: string; emoji: string }> = {
  klaviyo: { label: "Klaviyo", emoji: "✉️" },
  webhook: { label: "Webhook", emoji: "🔗" },
};

export default function StudioIntegrations() {
  const data = useLoaderData<typeof loader>();
  return (
    <QzPage>
      <QzPageHeader
        eyebrow="Integrations"
        title="Where your quiz data flows"
        subtitle="Sync captured contacts and answers to Klaviyo, or POST them to any webhook. Add or edit connections from a quiz's Logic view."
      />

      <div style={{ marginBottom: 16 }}>
        <RecCopyToggleCard enabled={data.aiRecCopyEnabled} />
      </div>

      {data.rows.length === 0 ? (
        <QzCard>
          <h2 className="qz-h2" style={{ marginTop: 0 }}>Connect your stack</h2>
          <p className="qz-muted" style={{ marginTop: 4 }}>
            No connections yet. Open a quiz, drop an <strong>Integration</strong> node into the
            flow, and point it at Klaviyo or your own webhook endpoint. Answers and contacts
            POST automatically when a shopper reaches that step.
          </p>
          <div className="qz-row" style={{ gap: 8, marginTop: 16 }}>
            {["✉️ Klaviyo", "🔗 Webhook"].map((p) => (
              <span
                key={p}
                style={{
                  fontSize: 13,
                  padding: "4px 12px",
                  borderRadius: "var(--qz-radius-pill)",
                  border: "1px solid var(--qz-rule)",
                  color: "var(--qz-ink-2)",
                }}
              >
                {p}
              </span>
            ))}
          </div>
        </QzCard>
      ) : (
        <>
          <div className="qz-row" style={{ gap: 8, marginBottom: 16 }}>
            <span className="qz-dim" style={{ fontSize: 13 }}>
              {data.klaviyoCount} Klaviyo · {data.webhookCount} webhook
              {data.webhookCount === 1 ? "" : "s"} across {data.rows.length} quiz
              {data.rows.length === 1 ? "" : "zes"}
            </span>
          </div>
          <div style={{ display: "grid", gap: 16 }}>
            {data.rows.map((r) => (
              <QzCard key={r.id}>
                <div className="qz-row qz-row-between" style={{ alignItems: "center", gap: 16 }}>
                  <div className="qz-row" style={{ gap: 8, alignItems: "center", minWidth: 0 }}>
                    <h2 className="qz-h2" style={{ margin: 0 }}>{r.name}</h2>
                    <QzBadge tone={r.status === "published" ? "ok" : "draft"}>{r.status}</QzBadge>
                  </div>
                  <Link to={`/studio/${r.id}`} className="qz-btn qz-btn-ghost qz-btn-sm">
                    Edit
                  </Link>
                </div>
                <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                  {r.connections.map((c, i) => {
                    const meta = KIND_META[c.kind] ?? { label: c.kind, emoji: "🔗" };
                    return (
                      <div
                        key={i}
                        className="qz-row qz-row-between"
                        style={{
                          padding: "10px 12px",
                          borderRadius: "var(--qz-radius)",
                          border: "1px solid var(--qz-rule)",
                          background: "var(--qz-paper)",
                          gap: 12,
                        }}
                      >
                        <span style={{ fontSize: 14 }}>
                          <span aria-hidden="true">{meta.emoji}</span>{" "}
                          <strong>{meta.label}</strong>
                          <span className="qz-dim"> · {c.label}</span>
                        </span>
                        <span className="qz-mono" style={{ fontSize: 12, color: "var(--qz-ink-3)" }}>
                          {c.target}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </QzCard>
            ))}
          </div>
        </>
      )}
    </QzPage>
  );
}
