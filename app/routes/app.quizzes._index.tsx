// app/routes/app.quizzes._index.tsx
// Quizzes list, redesigned in Grid Notebook style.
// Same loader/action contracts as the original — drop-in replacement.

import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  Link,
  useLoaderData,
  useNavigate,
  useSubmit,
  useNavigation,
} from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { formatDate } from "../lib/formatDate";
import {
  QzPage,
  QzPageHeader,
  QzButton,
  QzCard,
  QzBadge,
} from "../components/qz";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
  });
  if (!shop) {
    return json({ quizzes: [] });
  }
  const quizzes = await prisma.quiz.findMany({
    where: { shopId: shop.id },
    select: {
      id: true,
      name: true,
      status: true,
      version: true,
      updatedAt: true,
      createdAt: true,
    },
    orderBy: { updatedAt: "desc" },
  });
  return json({
    quizzes: quizzes.map((q) => ({
      ...q,
      updatedAt: q.updatedAt.toISOString(),
      createdAt: q.createdAt.toISOString(),
    })),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
  });
  if (!shop) return json({ ok: false, error: "Shop not found" }, { status: 404 });

  const form = await request.formData();
  const intent = form.get("intent");
  const id = String(form.get("id") ?? "");
  if (!id) return json({ ok: false, error: "Missing id" }, { status: 400 });

  const quiz = await prisma.quiz.findFirst({
    where: { id, shopId: shop.id },
    select: { id: true },
  });
  if (!quiz) return json({ ok: false, error: "Not found" }, { status: 404 });

  if (intent === "delete") {
    await prisma.quiz.delete({ where: { id } });
    return json({ ok: true });
  }
  return json({ ok: false, error: "Unknown intent" }, { status: 400 });
};

type Status = "all" | "published" | "draft";

export default function QuizList() {
  const { quizzes } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const submit = useSubmit();
  const navigation = useNavigation();
  const [filter, setFilter] = useState<Status>("all");
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);

  const isDeleting =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "delete";

  const counts: Record<Status, number> = {
    all: quizzes.length,
    published: quizzes.filter((q) => q.status === "published").length,
    draft: quizzes.filter((q) => q.status === "draft").length,
  };
  const filtered = quizzes.filter((q) =>
    filter === "all" ? true : q.status === filter,
  );

  const confirmDelete = () => {
    if (!pendingDelete) return;
    const form = new FormData();
    form.set("intent", "delete");
    form.set("id", pendingDelete.id);
    submit(form, { method: "POST" });
    setPendingDelete(null);
  };

  return (
    <QzPage>
      <TitleBar title="Quizzes" />

      <QzPageHeader
        eyebrow="All quizzes"
        title="Quizzes"
        subtitle="Every quiz on your storefront, plus drafts. Click one to open the flow editor."
        actions={
          <QzButton variant="accent" onClick={() => navigate("/app/quizzes/new")}>
            New AI quiz
          </QzButton>
        }
      />

      {/* Filter tabs */}
      <div className="qz-row qz-row-between" style={{ marginBottom: 18 }}>
        <div className="qz-row qz-gap-4">
          {(["all", "published", "draft"] as Status[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="qz-btn qz-btn-sm"
              style={{
                background: filter === f ? "var(--qz-ink)" : "transparent",
                color: filter === f ? "var(--qz-paper)" : "var(--qz-ink-3)",
                fontWeight: filter === f ? 600 : 500,
                textTransform: "capitalize",
                borderColor: filter === f ? "var(--qz-ink)" : "transparent",
              }}
            >
              {f}
              <span
                className="qz-mono"
                style={{
                  marginLeft: 4,
                  opacity: 0.7,
                  color: filter === f ? "var(--qz-paper)" : "var(--qz-ink-4)",
                }}
              >
                {counts[f]}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Table or empty */}
      {quizzes.length === 0 ? (
        <QzCard dashed>
          <div className="qz-label">No quizzes yet</div>
          <h2 className="qz-h1 qz-mt-8">Build your first quiz</h2>
          <p className="qz-muted qz-mt-8" style={{ maxWidth: "44ch" }}>
            Start from a vertical template, or let AI draft a quiz from your real
            catalog in a couple of minutes.
          </p>
          <div className="qz-row qz-mt-24" style={{ gap: 10, flexWrap: "wrap" }}>
            <Link to="/app/onboarding">
              <QzButton variant="accent">Guided setup →</QzButton>
            </Link>
            <Link to="/app/quizzes/new">
              <QzButton variant="ghost">Blank quiz</QzButton>
            </Link>
          </div>
        </QzCard>
      ) : (
        <QzCard flush>
          <table className="qz-table">
            <thead>
              <tr>
                <th style={{ width: "55%" }}>Name</th>
                <th>Status</th>
                <th>Version</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((q) => (
                <tr
                  key={q.id}
                  className="qz-clickable"
                  onClick={() => navigate(`/app/quizzes/${q.id}/studio`)}
                >
                  <td>
                    <Link
                      to={`/app/quizzes/${q.id}/studio`}
                      prefetch="intent"
                      style={{ textDecoration: "none", color: "inherit" }}
                    >
                      <div className="qz-cell-name">{q.name}</div>
                      <div className="qz-cell-sub qz-mono">
                        {q.id}
                      </div>
                    </Link>
                  </td>
                  <td>
                    <QzBadge tone={q.status === "published" ? "ok" : "draft"}>
                      {q.status}
                    </QzBadge>
                  </td>
                  <td className="qz-mono qz-tnum">v{q.version}</td>
                  <td className="qz-mono qz-dim">
                    {formatDate(q.updatedAt)}
                  </td>
                  <td className="qz-cell-actions" onClick={(e) => e.stopPropagation()}>
                    <div className="qz-row qz-gap-4" style={{ justifyContent: "flex-end" }}>
                      <Link to={`/app/quizzes/${q.id}/studio`}>
                        <QzButton variant="ghost" size="sm">Open</QzButton>
                      </Link>
                      <QzButton
                        variant="ghost"
                        size="sm"
                        onClick={() => setPendingDelete({ id: q.id, name: q.name })}
                        style={{ color: "var(--qz-crit)" }}
                      >
                        Delete
                      </QzButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </QzCard>
      )}

      <p className="qz-mono qz-dim qz-mt-16" style={{ fontSize: 11.5 }}>
        {filtered.length} of {quizzes.length} quizzes
      </p>

      {/* Tiny custom confirm dialog (replaces Polaris Modal) */}
      {pendingDelete && (
        <ConfirmModal
          title={`Delete "${pendingDelete.name}"?`}
          body={
            <>
              This permanently removes the quiz and all of its versions.
              There&apos;s no undo.
            </>
          }
          loading={isDeleting}
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
        />
      )}
    </QzPage>
  );
}

function ConfirmModal({
  title,
  body,
  loading,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: React.ReactNode;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(27, 26, 23, 0.4)",
        display: "grid",
        placeItems: "center",
        zIndex: 100,
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="qz-card"
        style={{
          maxWidth: 440,
          width: "calc(100% - 32px)",
          padding: 28,
        }}
      >
        <div className="qz-label">Delete</div>
        <h2 className="qz-h1 qz-mt-8">{title}</h2>
        <p className="qz-muted qz-mt-16" style={{ fontSize: 14 }}>{body}</p>
        <div className="qz-row qz-gap-8 qz-mt-24" style={{ justifyContent: "flex-end" }}>
          <QzButton onClick={onCancel}>Cancel</QzButton>
          <QzButton
            variant="accent"
            onClick={onConfirm}
            disabled={loading}
            style={{
              background: "var(--qz-crit)",
              borderColor: "var(--qz-crit)",
            }}
          >
            {loading ? "Deleting…" : "Delete"}
          </QzButton>
        </div>
      </div>
    </div>
  );
}
