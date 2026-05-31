// app/routes/app.quizzes.$id.pages.tsx
// "Pages gallery" — a grid of a quiz's result pages as thumbnail cards.
// Each card shows whether the page is "On template" (inheriting the shared
// result layout) or "Customized" (diverged from it), with one-click
// Break out / Re-sync controls. Backs the v3 result_layout_mode posture:
// "shared" = every result node inherits design_overrides["__shared_result__"];
// "custom" = each result node is independently editable.

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useFetcher, useLoaderData } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { Quiz } from "../lib/quizSchema";
import {
  QzPage,
  QzPageHeader,
  QzCard,
  QzButton,
  QzBadge,
  QzBanner,
} from "../components/qz";

// The shared result template lives under this reserved key in
// design_overrides. Result nodes in "shared" mode inherit it; "Break out"
// copies it into the node's own override, "Re-sync" deletes the node override.
const SHARED_RESULT_KEY = "__shared_result__";

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { id } = params;
  if (!id) throw new Response("Missing quiz id", { status: 400 });

  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
  });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  const quiz = await prisma.quiz.findFirst({
    where: { id, shopId: shop.id },
  });
  if (!quiz) throw new Response("Quiz not found", { status: 404 });

  const parsed = Quiz.safeParse(quiz.draftJson);
  if (!parsed.success) {
    return json({
      quizId: quiz.id,
      name: quiz.name,
      layoutMode: "custom" as const,
      pages: [],
      invalid: true,
    });
  }

  const doc = parsed.data;
  const layoutMode = doc.result_layout_mode;
  const overrides = doc.design_overrides;

  const pages = doc.nodes
    .filter((n) => n.type === "result")
    .map((n) => {
      // A page is "Customized" when each result node is independently styled
      // (custom mode) OR when this node has its own override entry — i.e. it
      // has diverged from the shared template. Otherwise it's "On template".
      const hasOverride = Object.prototype.hasOwnProperty.call(
        overrides,
        n.id,
      );
      const customized = layoutMode === "custom" || hasOverride;
      return {
        id: n.id,
        headline: n.data.headline,
        subtext: n.data.subtext,
        customized,
      };
    });

  return json({
    quizId: quiz.id,
    name: quiz.name,
    layoutMode,
    pages,
    invalid: false,
  });
};

interface LoaderData {
  quizId: string;
  name: string;
  layoutMode: "shared" | "custom";
  pages: Array<{
    id: string;
    headline: string;
    subtext: string;
    customized: boolean;
  }>;
  invalid: boolean;
}

export const action = async ({ params, request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { id } = params;
  if (!id) return json({ ok: false, error: "Missing id" }, { status: 400 });

  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
  });
  if (!shop) {
    return json({ ok: false, error: "Shop not found" }, { status: 404 });
  }

  const quiz = await prisma.quiz.findFirst({
    where: { id, shopId: shop.id },
  });
  if (!quiz) return json({ ok: false, error: "Quiz not found" }, { status: 404 });

  const parsed = Quiz.safeParse(quiz.draftJson);
  if (!parsed.success) {
    return json({ ok: false, error: "Invalid quiz document" }, { status: 400 });
  }
  const doc = parsed.data;

  const form = await request.formData();
  const intent = form.get("intent");

  let nextDoc: typeof doc;

  if (intent === "break-out") {
    const nodeId = String(form.get("nodeId") ?? "");
    if (!nodeId) {
      return json({ ok: false, error: "Missing nodeId" }, { status: 400 });
    }
    // Seed the node's own override from the shared baseline so the page starts
    // customized from where the shared template left off (empty object if the
    // shared template was never configured).
    const shared = doc.design_overrides[SHARED_RESULT_KEY] ?? {};
    nextDoc = {
      ...doc,
      design_overrides: {
        ...doc.design_overrides,
        [nodeId]: shared,
      },
    };
  } else if (intent === "re-sync") {
    const nodeId = String(form.get("nodeId") ?? "");
    if (!nodeId) {
      return json({ ok: false, error: "Missing nodeId" }, { status: 400 });
    }
    // Drop the node's own override so it inherits the shared template again,
    // discarding any custom design.
    const nextOverrides = { ...doc.design_overrides };
    delete nextOverrides[nodeId];
    nextDoc = {
      ...doc,
      design_overrides: nextOverrides,
    };
  } else if (intent === "set-layout-mode") {
    const mode = String(form.get("mode") ?? "");
    if (mode !== "shared" && mode !== "custom") {
      return json({ ok: false, error: "Invalid mode" }, { status: 400 });
    }
    nextDoc = {
      ...doc,
      result_layout_mode: mode,
    };
  } else {
    return json({ ok: false, error: "Unknown intent" }, { status: 400 });
  }

  const reparsed = Quiz.safeParse(nextDoc);
  if (!reparsed.success) {
    return json(
      {
        ok: false,
        error: "Update failed schema validation",
        issues: reparsed.error.issues.slice(0, 5),
      },
      { status: 400 },
    );
  }

  await prisma.quiz.update({
    where: { id },
    data: { draftJson: reparsed.data as never },
  });

  return json({ ok: true });
};

export default function QuizPagesGallery() {
  const data = useLoaderData<typeof loader>() as LoaderData;
  const { quizId, layoutMode, pages, invalid } = data;
  const modeFetcher = useFetcher<{ ok: boolean }>();

  // Optimistic layout mode — reflect the in-flight choice immediately so the
  // segmented control feels responsive while the action persists.
  const pendingMode = modeFetcher.formData?.get("mode");
  const effectiveMode =
    pendingMode === "shared" || pendingMode === "custom"
      ? pendingMode
      : layoutMode;

  const setMode = (mode: "shared" | "custom") => {
    if (mode === effectiveMode) return;
    modeFetcher.submit(
      { intent: "set-layout-mode", mode },
      { method: "POST" },
    );
  };

  return (
    <QzPage>
      <TitleBar title="Result pages" />
      <QzPageHeader
        eyebrow="Pages"
        title={
          <>
            Result <span className="qz-serif-italic">pages</span>.
          </>
        }
        subtitle="Every result screen in this quiz. On a shared template, pages inherit one design so a single edit cascades everywhere. Break a page out to style it on its own, or re-sync it to snap back to the template."
        actions={
          <Link to={`/app/quizzes/${quizId}/studio`} className="qz-link">
            <QzButton size="sm">← Back to builder</QzButton>
          </Link>
        }
      />

      <div className="qz-mt-16">
        <LayoutModeControl
          mode={effectiveMode}
          onSelect={setMode}
          busy={modeFetcher.state !== "idle"}
        />
      </div>

      {invalid && (
        <div className="qz-mt-16">
          <QzBanner tone="crit" title="This quiz has validation errors">
            We couldn&apos;t read the quiz document. Fix the issues in the
            builder, then come back to manage result pages.
          </QzBanner>
        </div>
      )}

      {!invalid && pages.length === 0 ? (
        <div className="qz-mt-32">
          <QzCard dashed>
            <div className="qz-label">No result pages yet</div>
            <p
              className="qz-h3 qz-mt-8"
              style={{ lineHeight: 1.4, maxWidth: "52ch" }}
            >
              This quiz has no result screens. Add a{" "}
              <strong>result node</strong> in the builder and it will show up
              here as a page you can keep on-template or customize.
            </p>
            <div className="qz-mt-16">
              <Link to={`/app/quizzes/${quizId}/studio`} className="qz-link">
                <QzButton variant="accent" size="sm">
                  Open the builder
                </QzButton>
              </Link>
            </div>
          </QzCard>
        </div>
      ) : (
        !invalid && (
          <section
            className="qz-mt-24"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: 16,
            }}
          >
            {pages.map((page) => (
              <PageCard key={page.id} page={page} />
            ))}
          </section>
        )
      )}
    </QzPage>
  );
}

function LayoutModeControl({
  mode,
  onSelect,
  busy,
}: {
  mode: "shared" | "custom";
  onSelect: (mode: "shared" | "custom") => void;
  busy: boolean;
}) {
  return (
    <div className="qz-row qz-gap-12" style={{ alignItems: "center" }}>
      <span className="qz-label">Layout mode</span>
      <div
        className="qz-row"
        style={{
          gap: 2,
          background: "var(--qz-rule-2)",
          padding: 2,
          borderRadius: "var(--qz-radius)",
          width: "fit-content",
        }}
      >
        {(
          [
            ["shared", "Shared template"],
            ["custom", "Per-page custom"],
          ] as const
        ).map(([value, label]) => {
          const on = value === mode;
          return (
            <button
              key={value}
              type="button"
              disabled={busy}
              onClick={() => onSelect(value)}
              style={{
                background: on ? "var(--qz-paper)" : "transparent",
                border: "none",
                padding: "5px 12px",
                borderRadius: "var(--qz-radius)",
                fontSize: 12,
                fontFamily: "var(--qz-font-mono)",
                fontWeight: on ? 600 : 500,
                color: on ? "var(--qz-ink)" : "var(--qz-ink-3)",
                cursor: busy ? "default" : "pointer",
                boxShadow: on ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
      <span className="qz-mono qz-dim" style={{ fontSize: 11 }}>
        {mode === "shared"
          ? "Pages inherit one design unless broken out."
          : "Every page is styled independently."}
      </span>
    </div>
  );
}

function PageCard({
  page,
}: {
  page: { id: string; headline: string; subtext: string; customized: boolean };
}) {
  const fetcher = useFetcher<{ ok: boolean }>();
  const busy = fetcher.state !== "idle";

  // Optimistic posture: while a break-out / re-sync is in flight, render the
  // target state so the badge + buttons flip immediately.
  const inFlight = fetcher.formData?.get("intent");
  const customized =
    inFlight === "break-out"
      ? true
      : inFlight === "re-sync"
        ? false
        : page.customized;

  const breakOut = () => {
    fetcher.submit(
      { intent: "break-out", nodeId: page.id },
      { method: "POST" },
    );
  };

  const reSync = () => {
    const ok = window.confirm(
      "Re-sync this page to the shared template? Its custom design will be discarded and cannot be recovered.",
    );
    if (!ok) return;
    fetcher.submit(
      { intent: "re-sync", nodeId: page.id },
      { method: "POST" },
    );
  };

  return (
    <QzCard>
      <div className="qz-col qz-gap-12">
        {/* Thumbnail-ish header band standing in for a page preview. */}
        <div
          style={{
            height: 96,
            borderRadius: "var(--qz-radius)",
            border: "1px solid var(--qz-rule)",
            background: "var(--qz-cream-2)",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: "0 14px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              fontFamily: "var(--qz-font-mono)",
              fontSize: 10,
              color: "var(--qz-ink-4)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 4,
            }}
          >
            result page
          </div>
          <div
            style={{
              fontWeight: 600,
              fontSize: 15,
              color: "var(--qz-ink)",
              lineHeight: 1.2,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {page.headline || "Result"}
          </div>
        </div>

        <div
          className="qz-row qz-row-between"
          style={{ alignItems: "center" }}
        >
          {customized ? (
            <QzBadge tone="warn">Customized</QzBadge>
          ) : (
            <QzBadge tone="ok">On template</QzBadge>
          )}
          <span
            className="qz-mono qz-dim"
            style={{ fontSize: 11 }}
            title={page.id}
          >
            {page.id.slice(0, 10)}
          </span>
        </div>

        {page.subtext && (
          <p
            className="qz-muted"
            style={{
              fontSize: 13,
              lineHeight: 1.5,
              margin: 0,
            }}
          >
            {page.subtext}
          </p>
        )}

        <div
          className="qz-row qz-gap-8"
          style={{
            paddingTop: 8,
            borderTop: "1px solid var(--qz-rule)",
          }}
        >
          {customized ? (
            <QzButton size="sm" onClick={reSync} disabled={busy}>
              {busy ? "Re-syncing…" : "Re-sync"}
            </QzButton>
          ) : (
            <QzButton
              size="sm"
              variant="accent"
              onClick={breakOut}
              disabled={busy}
            >
              {busy ? "Breaking out…" : "Break out"}
            </QzButton>
          )}
        </div>
      </div>
    </QzCard>
  );
}
