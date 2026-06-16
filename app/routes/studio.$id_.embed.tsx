import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { useState } from "react";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import prisma from "../db.server";
import { Quiz } from "../lib/quizSchema";
import { qrDataUrl } from "../lib/qrCode.server";
import { QzPage, QzPageHeader, QzCard, QzBanner, QzBadge } from "../components/qz";

// QD-7 — the standalone "Share & embed" surface. Quizell-style front door for
// getting a published quiz onto ANY website (not just a Shopify theme): the
// public link, a copy-paste <script> floating launcher, an inline <iframe>,
// and a QR code. `$id_` de-nests it from the builder route (the analytics
// precedent). Platform-neutral by construction — every snippet is a plain URL.
export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const { id } = params;
  if (!id) throw new Response("Missing quiz id", { status: 400 });

  const quiz = await prisma.quiz.findFirst({
    where: { id, shopId: shop.id },
    select: { id: true, name: true, status: true, publishedJson: true },
  });
  if (!quiz) throw new Response("Quiz not found", { status: 404 });

  const published = !!quiz.publishedJson;
  // Read the launcher toggle off the PUBLISHED doc — the floating-button
  // snippet only does anything once `launcher_config.enabled` is true.
  let launcherEnabled = false;
  if (quiz.publishedJson) {
    const parsed = Quiz.safeParse(quiz.publishedJson);
    if (parsed.success) launcherEnabled = parsed.data.launcher_config.enabled;
  }

  // Absolute origin so every snippet is paste-ready on a third-party site.
  const origin = new URL(request.url).origin;
  const publicUrl = `${origin}/q/${quiz.id}`;
  // QR encodes the public link; only worth rendering once the quiz is live.
  const qr = published ? await qrDataUrl(publicUrl) : null;

  return json({
    quizId: quiz.id,
    name: quiz.name,
    status: quiz.status,
    published,
    launcherEnabled,
    origin,
    publicUrl,
    qr,
  });
};

function CopyField({
  label,
  value,
  hint,
  multiline,
}: {
  label: string;
  value: string;
  hint?: string;
  multiline?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked (insecure context / permissions) — the field is
      // still selectable, so the merchant can copy by hand.
    }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div className="qz-row qz-row-between" style={{ alignItems: "baseline" }}>
        <span className="qz-label">{label}</span>
        <button type="button" className="qz-btn qz-btn-ghost qz-btn-sm" onClick={copy}>
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      {multiline ? (
        <textarea
          readOnly
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          className="qz-mono"
          rows={2}
          style={{
            width: "100%",
            resize: "none",
            fontSize: 12.5,
            padding: "10px 12px",
            borderRadius: "var(--qz-radius-sm)",
            border: "1px solid var(--qz-rule)",
            background: "var(--qz-rule-2)",
            color: "var(--qz-ink-2)",
          }}
        />
      ) : (
        <input
          readOnly
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          className="qz-mono"
          style={{
            width: "100%",
            fontSize: 12.5,
            padding: "10px 12px",
            borderRadius: "var(--qz-radius-sm)",
            border: "1px solid var(--qz-rule)",
            background: "var(--qz-rule-2)",
            color: "var(--qz-ink-2)",
          }}
        />
      )}
      {hint && (
        <p className="qz-dim" style={{ fontSize: 12, margin: 0 }}>
          {hint}
        </p>
      )}
    </div>
  );
}

export default function StudioEmbed() {
  const data = useLoaderData<typeof loader>();
  const scriptSnippet = `<script async src="${data.origin}/q/${data.quizId}/launcher.js"></script>`;
  const iframeSnippet = `<iframe src="${data.publicUrl}" title="${data.name}" style="width:100%;min-height:640px;border:0" loading="lazy"></iframe>`;

  return (
    <QzPage>
      <QzPageHeader
        eyebrow="Share & embed"
        title={data.name}
        subtitle="Put this quiz on any website — your store, a landing page, a link in bio, or a QR on packaging."
        actions={
          <div className="qz-row" style={{ gap: 8 }}>
            <QzBadge tone={data.status === "published" ? "ok" : "draft"}>{data.status}</QzBadge>
            <Link to={`/studio/${data.quizId}`} className="qz-btn qz-btn-ghost qz-btn-sm">
              ← Back to builder
            </Link>
          </div>
        }
      />

      {!data.published ? (
        <QzBanner tone="warn" title="Publish first">
          Embeds and the share link go live the moment you publish.{" "}
          <Link to={`/studio/${data.quizId}`}>Open the builder</Link> and hit Publish.
        </QzBanner>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 16,
          alignItems: "start",
        }}
      >
        <QzCard>
          <h2 className="qz-h2" style={{ marginTop: 0 }}>
            Direct link
          </h2>
          <p className="qz-muted" style={{ marginTop: 4 }}>
            Send it anywhere — email, social, SMS, a button on your site.
          </p>
          <div style={{ marginTop: 16 }}>
            <CopyField label="Quiz URL" value={data.publicUrl} />
          </div>
          <a
            href={data.publicUrl}
            target="_blank"
            rel="noreferrer"
            className="qz-btn qz-btn-ghost qz-btn-sm"
            style={{ marginTop: 12 }}
          >
            Open the live quiz ↗
          </a>
        </QzCard>

        <QzCard>
          <h2 className="qz-h2" style={{ marginTop: 0 }}>
            Floating launcher
          </h2>
          <p className="qz-muted" style={{ marginTop: 4 }}>
            A button in the corner of every page that opens the quiz in an overlay.
          </p>
          <div style={{ marginTop: 16 }}>
            <CopyField
              label="Paste before &lt;/body&gt;"
              value={scriptSnippet}
              multiline
              hint={
                data.launcherEnabled
                  ? "Works on any HTML page — no plugins needed."
                  : "Turn on the floating launcher in the builder, then re-publish, for this to render."
              }
            />
          </div>
        </QzCard>

        <QzCard>
          <h2 className="qz-h2" style={{ marginTop: 0 }}>
            Inline embed
          </h2>
          <p className="qz-muted" style={{ marginTop: 4 }}>
            Drop the quiz straight into a page — it sizes to its container.
          </p>
          <div style={{ marginTop: 16 }}>
            <CopyField label="Paste where you want the quiz" value={iframeSnippet} multiline />
          </div>
        </QzCard>

        <QzCard>
          <h2 className="qz-h2" style={{ marginTop: 0 }}>
            QR code
          </h2>
          <p className="qz-muted" style={{ marginTop: 4 }}>
            For packaging, print, or in-store signage — scans to the live quiz.
          </p>
          {data.qr ? (
            <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
              <img
                src={data.qr}
                alt={`QR code linking to ${data.name}`}
                width={176}
                height={176}
                style={{
                  width: 176,
                  height: 176,
                  borderRadius: "var(--qz-radius-sm)",
                  border: "1px solid var(--qz-rule)",
                  background: "#fff",
                  padding: 8,
                }}
              />
              <a
                href={data.qr}
                download={`${data.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-qr.png`}
                className="qz-btn qz-btn-ghost qz-btn-sm"
              >
                Download PNG
              </a>
            </div>
          ) : (
            <p className="qz-dim" style={{ marginTop: 16, fontSize: 13 }}>
              The QR appears once the quiz is published.
            </p>
          )}
        </QzCard>
      </div>
    </QzPage>
  );
}
