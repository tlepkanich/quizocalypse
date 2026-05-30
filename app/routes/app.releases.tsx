// app/routes/app.releases.tsx
// Full release history page. Linked from the dashboard "What's new" card
// and the sidebar. Renders one card per release with feature pills whose
// descriptions appear on hover/tap.

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  QzPage,
  QzPageHeader,
  QzCard,
  QzBadge,
} from "../components/qz";
import { RELEASES } from "../lib/releases";
import { ReleaseFeatures } from "./app._index";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  // Releases are a module-level constant; nothing to fetch.
  return json({});
};

export default function ReleasesPage() {
  return (
    <QzPage>
      <TitleBar title="What's new" />
      <QzPageHeader
        eyebrow="Releases"
        title={
          <>
            What we&apos;ve <span className="qz-serif-italic">shipped</span>.
          </>
        }
        subtitle="Every feature added to Quizocalypse, newest first. Hover or tap any feature pill to see what it does."
      />

      <div className="qz-col qz-gap-24" style={{ maxWidth: 840 }}>
        {RELEASES.map((r) => (
          <QzCard key={r.version}>
            <div
              className="qz-row qz-gap-12"
              style={{ alignItems: "baseline", flexWrap: "wrap" }}
            >
              <QzBadge tone="ok">{r.version}</QzBadge>
              <h2
                className="qz-h2"
                style={{ margin: 0, fontSize: 20, color: "var(--qz-ink)" }}
              >
                {r.name}
              </h2>
              <span
                className="qz-mono qz-dim"
                style={{ fontSize: 11, marginLeft: "auto" }}
              >
                {formatDate(r.date)}
              </span>
            </div>
            <p
              className="qz-muted qz-mt-8"
              style={{ fontSize: 14, lineHeight: 1.5 }}
            >
              {r.summary}
            </p>
            <div className="qz-mt-16">
              <ReleaseFeatures features={r.features} />
            </div>
          </QzCard>
        ))}
      </div>
    </QzPage>
  );
}

// Compact human-readable date for the release header. Falls back to the
// raw ISO string if parsing fails.
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
