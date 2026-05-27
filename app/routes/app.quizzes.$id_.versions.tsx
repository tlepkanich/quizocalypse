import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  Link,
  useLoaderData,
  useNavigation,
  useSubmit,
} from "@remix-run/react";
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
} from "../components/qz";

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
    select: { id: true, name: true, version: true, status: true },
  });
  if (!quiz) throw new Response("Quiz not found", { status: 404 });

  const versions = await prisma.quizVersion.findMany({
    where: { quizId: quiz.id },
    orderBy: { version: "desc" },
    select: { id: true, version: true, publishedAt: true },
  });

  return json({
    quiz,
    versions: versions.map((v) => ({
      ...v,
      publishedAt: v.publishedAt.toISOString(),
    })),
  });
};

export const action = async ({ params, request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { id } = params;
  if (!id) return json({ ok: false, error: "Missing id" }, { status: 400 });

  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
  });
  if (!shop) return json({ ok: false, error: "Shop not found" }, { status: 404 });

  const form = await request.formData();
  if (form.get("intent") !== "revert") {
    return json({ ok: false, error: "Unknown intent" }, { status: 400 });
  }

  const versionId = String(form.get("versionId") ?? "");
  const version = await prisma.quizVersion.findFirst({
    where: { id: versionId, quiz: { id, shopId: shop.id } },
  });
  if (!version) {
    return json({ ok: false, error: "Version not found" }, { status: 404 });
  }

  // publishedJson contains publish-only fields (product_index, published_at).
  // Zod's default `strip` discards them; we keep only the Quiz subset for draft.
  const parsed = Quiz.safeParse(version.publishedJson);
  if (!parsed.success) {
    return json(
      { ok: false, error: "Stored version doesn't match the current quiz schema." },
      { status: 400 },
    );
  }

  await prisma.quiz.update({
    where: { id },
    data: { draftJson: parsed.data as never },
  });

  return json({ ok: true, revertedTo: version.version });
};

export default function QuizVersions() {
  const { quiz, versions } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const [pending, setPending] = useState<{
    id: string;
    version: number;
  } | null>(null);
  const isReverting =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "revert";

  const confirmRevert = () => {
    if (!pending) return;
    const form = new FormData();
    form.set("intent", "revert");
    form.set("versionId", pending.id);
    submit(form, { method: "POST" });
    setPending(null);
  };

  return (
    <QzPage>
      <TitleBar title="Versions" />

      <QzPageHeader
        eyebrow={
          <>
            <Link
              to={`/app/quizzes/${quiz.id}`}
              style={{ color: "inherit", textDecoration: "none" }}
            >
              ← {quiz.name}
            </Link>
          </>
        }
        title="Versions"
        subtitle="Every published snapshot of this quiz, newest first. Revert replaces the current draft — you publish again to push that revision to your storefront."
        actions={
          <QzBadge tone={quiz.status === "published" ? "ok" : "draft"}>
            {quiz.status}
          </QzBadge>
        }
      />

      {versions.length === 0 ? (
        <QzCard dashed>
          <div className="qz-label">No versions yet</div>
          <h2 className="qz-h1 qz-mt-8">Publish to start tracking history</h2>
          <p className="qz-muted qz-mt-8" style={{ maxWidth: "44ch" }}>
            Once you publish, each release becomes a revert point. We keep the
            last ten and prune older ones automatically.
          </p>
          <div className="qz-mt-24">
            <Link to={`/app/quizzes/${quiz.id}`}>
              <QzButton variant="accent">Back to editor</QzButton>
            </Link>
          </div>
        </QzCard>
      ) : (
        <QzCard flush>
          <table className="qz-table">
            <thead>
              <tr>
                <th style={{ width: "30%" }}>Version</th>
                <th>Published</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id}>
                  <td>
                    <div className="qz-row qz-gap-8" style={{ alignItems: "center" }}>
                      <span className="qz-cell-name qz-mono qz-tnum">
                        v{v.version}
                      </span>
                      {v.version === quiz.version && (
                        <QzBadge tone="ok">active</QzBadge>
                      )}
                    </div>
                  </td>
                  <td className="qz-mono qz-dim">
                    {new Date(v.publishedAt).toLocaleString()}
                  </td>
                  <td className="qz-cell-actions">
                    <QzButton
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setPending({ id: v.id, version: v.version })
                      }
                      disabled={v.version === quiz.version}
                    >
                      Revert to this version
                    </QzButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </QzCard>
      )}

      <div className="qz-mt-24">
        <Link to={`/app/quizzes/${quiz.id}`}>
          <QzButton variant="ghost" size="sm">← Back to editor</QzButton>
        </Link>
      </div>

      {pending && (
        <ConfirmModal
          title={`Revert to v${pending.version}?`}
          body={
            <>
              This replaces your current draft with the contents of v
              {pending.version}. Any unsaved changes in the editor will be
              lost. You&apos;ll need to publish again to push the reverted
              version to your storefront.
            </>
          }
          loading={isReverting}
          onCancel={() => setPending(null)}
          onConfirm={confirmRevert}
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
        style={{ maxWidth: 480, width: "calc(100% - 32px)", padding: 28 }}
      >
        <div className="qz-label">Revert</div>
        <h2 className="qz-h1 qz-mt-8">{title}</h2>
        <p className="qz-muted qz-mt-16" style={{ fontSize: 14 }}>
          {body}
        </p>
        <div
          className="qz-row qz-gap-8 qz-mt-24"
          style={{ justifyContent: "flex-end" }}
        >
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
            {loading ? "Reverting…" : "Revert"}
          </QzButton>
        </div>
      </div>
    </div>
  );
}
