import { useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useFetcher, useLoaderData, useRevalidator } from "@remix-run/react";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import { quizVersionsForShop, restoreQuizVersionForShop } from "../lib/quizVersions.server";
import { QzPage, QzPageHeader, QzCard, QzButton, QzBadge } from "../components/qz";
import { QzModal } from "../components/qz-overlays";
import { formatDateTime } from "../lib/formatDate";

export const meta: MetaFunction = () => [{ title: "Published history · Wiskr" }];
export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  if (!params.id) throw new Response("Missing quiz id", { status: 400 });
  try {
    return json(await quizVersionsForShop(shop.id, params.id));
  } catch (error) {
    if (error instanceof Response) return json({ error: await error.text() }, { status: error.status });
    throw error;
  }
}
export async function action({ request, params }: ActionFunctionArgs) {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  if (!params.id) return json({ ok: false as const, error: "Missing quiz id." }, { status: 400 });
  const result = await restoreQuizVersionForShop(shop.id, params.id, await request.formData());
  return json(result, { status: result.status });
}
export default function PublishedHistory() {
  const data = useLoaderData<typeof loader>();
  const restore = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const [pending, setPending] = useState<{ id: string; version: number } | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const busy = restore.state !== "idle";
  if ("error" in data) return <QzPage><p role="alert">{data.error}</p><Link to="/studio/quizzes">Back to quizzes</Link></QzPage>;
  const { quiz, versions } = data;
  const editor = `/studio/${quiz.id}`;
  return <QzPage>
    <Link to={editor}>← Back to builder</Link>
    <QzPageHeader title="Published history" subtitle={`${quiz.name} — your last 10 published versions. Restore a version to your draft, then publish when ready.`} />
    {restore.data && !busy && <div className="qz-mb-24" role={restore.data.ok ? "status" : "alert"}>
      {restore.data.ok ? <p>Version {restore.data.restoredVersion} restored to draft. Your live quiz has not changed. <Link to={editor}>Review in builder</Link></p>
        : <p>{restore.data.error} <QzButton size="sm" onClick={() => revalidator.revalidate()}>Reload history</QzButton></p>}
    </div>}
    <QzCard>
      {versions.length === 0 ? <><h2 className="qz-h2">No published versions yet</h2><p>Publish this quiz to save its first version. Draft edits do not create versions.</p><Link to={editor}>Return to builder</Link></>
        : <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {versions.map(v => <li key={v.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16, padding: "20px 0", borderBottom: "1px solid var(--qz-rule)" }}>
            <div style={{ flex: "1 1 180px" }}><strong>Version {v.version}</strong>{" "}{v.version === quiz.version && <QzBadge tone={quiz.status === "published" ? "ok" : "draft"}>{quiz.status === "published" ? "Live" : "Last published"}</QzBadge>}<div className="qz-muted">Published {formatDateTime(v.publishedAt)} UTC</div></div>
            <QzButton size="sm" disabled={busy} onClick={() => setPending(v)}>Restore version {v.version}</QzButton>
          </li>)}
        </ul>}
    </QzCard>
    <QzModal open={pending !== null} onClose={() => setPending(null)} title={`Restore version ${pending?.version}?`} initialFocusRef={cancelRef} footer={<><button type="button" className="qz-btn" ref={cancelRef} onClick={() => setPending(null)}>Cancel</button><QzButton variant="accent" onClick={() => {
      if (!pending) return;
      restore.submit({ intent: "restore", versionId: pending.id, updatedAt: quiz.updatedAt }, { method: "POST" });
      setPending(null);
    }}>Restore draft</QzButton></>}>
      <p>This replaces your current draft, including unpublished edits. Your live quiz stays unchanged until you publish again.</p>
      <p>Close other editor tabs for this quiz before restoring so they cannot save over the restored draft.</p>
    </QzModal>
  </QzPage>;
}
