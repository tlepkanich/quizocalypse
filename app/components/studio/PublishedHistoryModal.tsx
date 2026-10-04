import { useEffect, useRef, useState } from "react";
import { useFetcher } from "@remix-run/react";
import type { action, loader } from "../../routes/studio.$id_.versions";
import { QzBadge, QzButton } from "../qz";
import { QzModal } from "../qz-overlays";
import { formatDateTime } from "../../lib/formatDate";

/** Mounted only after the builder's pending saves settle. The modal makes the
 * editor inert until dismissal; a successful restore reloads its local draft
 * and undo stack together, without issuing another autosave of the old doc. */
export function PublishedHistoryModal({ quizId, onClose, returnFocus }: { quizId: string; onClose: () => void; returnFocus: () => void }) {
  const history = useFetcher<typeof loader>();
  const restore = useFetcher<typeof action>();
  const [pending, setPending] = useState<{ id: string; version: number } | null>(null);
  const [showRestoreError, setShowRestoreError] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const loaded = useRef(false);
  const endpoint = `/studio/${quizId}/versions`;
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    history.load(endpoint);
  }, [history, endpoint]);
  const restored = restore.data?.ok === true;
  const busy = restore.state !== "idle" || restored;
  useEffect(() => {
    if (busy) return;
    if (pending) cancelRef.current?.focus();
    else closeRef.current?.focus();
  }, [pending, busy]);
  useEffect(() => {
    if (restored && restore.state === "idle") window.location.reload();
  }, [restored, restore.state]);
  const data = history.data;
  const ready = data && !("error" in data) ? data : null;
  const loading = history.state !== "idle" || !data;
  const close = () => { if (!busy) onClose(); };
  return <QzModal open onClose={close} size="md" lockScroll draftSafe
    title={pending ? `Restore version ${pending.version}?` : "Published history"}
    initialFocusRef={closeRef} returnFocus={returnFocus}
    footer={pending ? <>
      <button type="button" className="qz-btn" ref={cancelRef} disabled={busy} onClick={() => setPending(null)}>Cancel</button>
      <QzButton variant="accent" disabled={busy || loading || !ready} onClick={() => {
        if (!ready) return;
        setShowRestoreError(true);
        restore.submit({ intent: "restore", versionId: pending.id, updatedAt: ready.quiz.updatedAt }, { method: "POST", action: endpoint });
      }}>{busy ? "Restoring…" : "Restore draft"}</QzButton>
    </> : <button type="button" className="qz-btn" ref={closeRef} onClick={close}>Done</button>}>
    {showRestoreError && restore.data && !restore.data.ok && !busy && <p role="alert">{restore.data.error}{" "}
      <QzButton size="sm" disabled={loading} onClick={() => { setPending(null); setShowRestoreError(false); history.load(endpoint); }}>Reload history</QzButton>
    </p>}
    {restored ? <p role="status">Draft restored. Reloading the builder…</p> : pending ? <>
      <p>This replaces your current draft, including unpublished edits. Your live quiz stays unchanged until you publish again.</p>
      <p>Close other editor tabs for this quiz before restoring so they cannot save over the restored draft.</p>
    </> : <>
      <p className="qz-muted">Your last 10 published versions. Restore to your draft, then publish when ready.</p>
      {loading ? <p role="status">Loading history…</p> : data && "error" in data ? <p role="alert">{data.error} <QzButton size="sm" onClick={() => history.load(endpoint)}>Try again</QzButton></p>
        : ready && (ready.versions.length === 0 ? <><h3 className="qz-h3">No published versions yet</h3><p>Publish this quiz to save its first version. Draft edits do not create versions.</p></>
          : <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {ready.versions.map(v => <li key={v.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16, padding: "20px 0", borderBottom: "1px solid var(--qz-rule)" }}>
              <div style={{ flex: "1 1 180px" }}><strong>Version {v.version}</strong>{" "}{v.version === ready.quiz.version && <QzBadge tone={ready.quiz.status === "published" ? "ok" : "draft"}>{ready.quiz.status === "published" ? "Live" : "Last published"}</QzBadge>}<div className="qz-muted">Published {formatDateTime(v.publishedAt)} UTC</div></div>
              <QzButton size="sm" onClick={() => setPending(v)}>Restore version {v.version}</QzButton>
            </li>)}
          </ul>)}
    </>}
  </QzModal>;
}
