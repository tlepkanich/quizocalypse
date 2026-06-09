import { useEffect, useState } from "react";
import { useFetcher } from "@remix-run/react";
import type { Quiz } from "../../lib/quizSchema";
import { QzButton } from "../qz";

// Reviews/FAQ enrichment panel (Dev Spec §3.2). Paste real review/FAQ text (or a
// URL) → posts the `enrich-reviews` intent → the AI rewrites answer wording,
// tooltips, and result why-bullets in customer language → onApply re-renders the
// live preview. Same apply path as the AI chat.
type EnrichResponse =
  | { ok: true; action: "enrich-reviews"; doc: Quiz; assistant_message?: string; changed?: number }
  | { ok: false; error?: string };

export function ReviewEnrichPanel({ onApply }: { onApply: (doc: Quiz) => void }) {
  const fetcher = useFetcher<EnrichResponse>();
  const [open, setOpen] = useState(false);
  const [reviews, setReviews] = useState("");
  const [url, setUrl] = useState("");
  const busy = fetcher.state !== "idle";
  const result = fetcher.data;

  useEffect(() => {
    if (fetcher.state === "idle" && result?.ok && result.doc) onApply(result.doc);
  }, [fetcher.state, result, onApply]);

  const submit = () => {
    const form = new FormData();
    form.set("intent", "enrich-reviews");
    form.set("reviews", reviews);
    if (url.trim()) form.set("reviewsUrl", url.trim());
    fetcher.submit(form, { method: "POST" });
  };

  const inputStyle = {
    width: "100%",
    font: "inherit",
    fontSize: 13,
    padding: 10,
    borderRadius: "var(--qz-radius)",
    border: "1px solid #00000022",
  } as const;

  return (
    <div className="qz-card" style={{ padding: 14, marginBottom: 16 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="qz-row qz-row-between"
        style={{ width: "100%", background: "none", border: "none", cursor: "pointer", padding: 0 }}
      >
        <strong style={{ fontSize: 14 }}>✨ Enrich from reviews</strong>
        <span className="qz-dim" style={{ fontSize: 12 }}>{open ? "▲" : "▼"}</span>
      </button>

      {open ? (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          <p className="qz-dim" style={{ fontSize: 12, margin: 0 }}>
            Paste real customer reviews or FAQ answers — AI rewrites your answer wording, tooltips,
            and result bullets in your customers&rsquo; own language.
          </p>
          <textarea
            value={reviews}
            onChange={(e) => setReviews(e.target.value)}
            placeholder="Paste reviews or FAQ text here…"
            rows={5}
            style={{ ...inputStyle, resize: "vertical" }}
          />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="…or a reviews / FAQ page URL (optional)"
            style={{ ...inputStyle, padding: "8px 10px" }}
          />
          <div className="qz-row qz-row-between" style={{ alignItems: "center" }}>
            <span className="qz-dim" style={{ fontSize: 12 }}>
              {result?.ok
                ? `✓ ${result.assistant_message ?? `Updated ${result.changed ?? 0} items`}`
                : result && !result.ok
                  ? `⚠ ${result.error}`
                  : ""}
            </span>
            <QzButton
              size="sm"
              variant="accent"
              onClick={submit}
              disabled={busy || reviews.trim().length + url.trim().length < 10}
            >
              {busy ? "Enriching…" : "Enrich"}
            </QzButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}
