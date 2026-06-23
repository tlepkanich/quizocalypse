import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { formatDate } from "../lib/formatDate";
import {
  QzPage,
  QzPageHeader,
  QzCard,
  QzField,
  QzInput,
  QzBanner,
} from "../components/qz";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    select: {
      id: true,
      shopDomain: true,
      scope: true,
      installedAt: true,
      lastSyncAt: true,
    },
  });
  return json({
    shop: shop
      ? {
          ...shop,
          installedAt: shop.installedAt.toISOString(),
          lastSyncAt: shop.lastSyncAt?.toISOString() ?? null,
        }
      : null,
  });
};

export default function Settings() {
  const { shop } = useLoaderData<typeof loader>();

  return (
    <QzPage>
      <TitleBar title="Settings" />

      <QzPageHeader
        eyebrow="Configuration"
        title="Settings"
        subtitle="Where Quizocalypse connects to your shop and other systems. Webhook delivery, real KMS for token encryption, and the public App Store billing setup all land here."
      />

      <div style={{ maxWidth: 720 }} className="qz-col qz-gap-24">
        <QzCard>
          <div className="qz-col qz-gap-12">
            <div>
              <div className="qz-label">Shop</div>
              <h2 className="qz-h1 qz-mt-8">Installation</h2>
            </div>
            {shop ? (
              <>
                <ReadOnly label="Domain" value={shop.shopDomain} />
                <ReadOnly
                  label="Installed"
                  value={formatDate(shop.installedAt)}
                />
                <ReadOnly
                  label="Granted scopes"
                  value={shop.scope ?? "(unknown)"}
                />
                <ReadOnly
                  label="Last catalog sync"
                  value={
                    shop.lastSyncAt
                      ? formatDate(shop.lastSyncAt)
                      : "Never"
                  }
                />
              </>
            ) : (
              <QzBanner tone="warn">
                Shop record not found. Try resyncing from the Dashboard.
              </QzBanner>
            )}
          </div>
        </QzCard>

        <QzCard>
          <div className="qz-col qz-gap-12">
            <div>
              <div className="qz-label">Marketing tools</div>
              <h2 className="qz-h1 qz-mt-8">Email capture webhook</h2>
              <p className="qz-muted qz-mt-8" style={{ maxWidth: "52ch" }}>
                Paste a webhook URL from Klaviyo (or any tool that accepts
                JSON POSTs) and we&apos;ll forward every email capture there
                with at-least-once delivery and 3× exponential backoff retry.
              </p>
            </div>
            <QzField
              label="Webhook URL"
              hint="Sending is not enabled yet — captures are stored locally only. This field is the plumbing for the next release."
            >
              <QzInput
                placeholder="https://a.klaviyo.com/api/track/..."
                disabled
              />
            </QzField>
            <QzBanner tone="default">
              Outbound webhook delivery ships next. Until then your captures
              are queryable on the Captures page.
            </QzBanner>
          </div>
        </QzCard>

        <QzCard>
          <div className="qz-col qz-gap-12">
            <div>
              <div className="qz-label">Security</div>
              <h2 className="qz-h1 qz-mt-8">Token encryption</h2>
            </div>
            <ReadOnly
              label="Encryption status"
              value="AES-256-GCM (local key) — wrapper deferred"
            />
            <p className="qz-muted" style={{ fontSize: 13, margin: 0 }}>
              The crypto module + roundtrip tests are in place. Wiring through
              PrismaSessionStorage is blocked on a transitive version conflict
              between shopify-app-remix and the Prisma session storage adapter.
              Pin both to v13 before launch and re-enable the wrapper.
            </p>
          </div>
        </QzCard>
      </div>
    </QzPage>
  );
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div className="qz-row qz-row-between" style={{ alignItems: "baseline" }}>
      <span
        className="qz-mono"
        style={{
          fontSize: 11,
          color: "var(--qz-ink-3)",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 13, color: "var(--qz-ink-2)" }}>{value}</span>
    </div>
  );
}
