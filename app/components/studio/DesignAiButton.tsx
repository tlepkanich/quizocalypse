import { useEffect, useRef, useState } from "react";
import { useFetcher } from "@remix-run/react";
import type { Quiz } from "../../lib/quizSchema";
import { QzPopover } from "../qz-overlays";

type QuizDoc = Quiz;

// ════════════════════════════════════════════════════════════════════════════
// BLD-2 — the Design AI pill in the builder top bar: a small prompt popover
// ("warm editorial, cream background, serif headings, soft buttons") that
// submits the `design-ai` intent; the server returns the restyled doc and it
// applies through the SAME AI seam as per-question regenerate (pause autosave
// → 3-way merge apply → snapshot undo), so every All-screens card repaints
// live and the ~10s "Undo (Ns)" affordance (the ContentTab regenerate
// pattern) pops the ordinary snapshot stack.
//
// The popover is QzPopover — portal to document.body (the builder-overlay-
// portal lesson: in-flow fixed overlays get pointer-trapped by the preview
// pane's container-type/zoom transforms). Esc closes (QzPopover), Enter
// submits, and focus returns to the pill on close.
// ════════════════════════════════════════════════════════════════════════════

export interface DesignAiApi {
  /** beginAiEdit — flush + pause autosave; returns the doc to restyle. */
  start: () => QuizDoc;
  /** applyAi — 3-way merge the restyled doc + record an undo snapshot. */
  apply: (doc: QuizDoc) => void;
  /** endAiEdit — resume autosave after a failed call. */
  error: () => void;
  /** Pop the snapshot stack (reverts the restyle; persists via autosave). */
  undo: () => void;
}

interface DesignAiResponse {
  ok: boolean;
  doc?: QuizDoc;
  error?: string;
}

const UNDO_SECONDS = 10;
const PLACEHOLDER = "e.g. warm editorial, cream background, serif headings, soft buttons";

export function DesignAiButton({ api }: { api: DesignAiApi }) {
  const fetcher = useFetcher<DesignAiResponse>();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [undoLeft, setUndoLeft] = useState(0);
  const wasBusy = useRef(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const busy = fetcher.state !== "idle";

  // Settle once on the busy→idle edge (the AiChatPanel/RegenerateQuestion
  // contract): success applies + opens the undo window; EVERY failure —
  // including a no-payload network error — resumes autosave via api.error().
  useEffect(() => {
    if (wasBusy.current && !busy) {
      const d = fetcher.data;
      if (d?.ok && d.doc) {
        api.apply(d.doc);
        setErr(null);
        setPrompt("");
        setOpen(false);
        setUndoLeft(UNDO_SECONDS);
      } else {
        api.error();
        setErr(d?.error ?? "Styling failed — try again. Your design is unchanged.");
      }
    }
    wasBusy.current = busy;
  }, [busy, fetcher.data, api]);

  // Tick the undo countdown down to zero (the ContentTab regenerate pattern).
  useEffect(() => {
    if (undoLeft <= 0) return;
    const t = window.setTimeout(() => setUndoLeft((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [undoLeft]);

  // Keyboard contract: when the popover closes (Esc / outside click / apply),
  // focus returns to the pill so the merchant never loses their place.
  const prevOpen = useRef(false);
  useEffect(() => {
    if (prevOpen.current && !open) btnRef.current?.focus();
    prevOpen.current = open;
  }, [open]);

  const send = () => {
    const p = prompt.trim();
    if (!p || busy) return;
    setErr(null);
    setUndoLeft(0);
    const base = api.start();
    const form = new FormData();
    form.set("intent", "design-ai");
    form.set("prompt", p);
    form.set("baseDoc", JSON.stringify(base));
    fetcher.submit(form, { method: "POST" });
  };

  return (
    <>
      <QzPopover
        open={open}
        onOpenChange={setOpen}
        maxWidth={320}
        trigger={
          <button
            ref={btnRef}
            type="button"
            className="qz-bt-tbtn is-assist"
            data-testid="design-ai-btn"
          >
            {busy ? "✦ Styling…" : "✦ Design AI"}
          </button>
        }
        content={
          <div
            data-testid="design-ai-popover"
            style={{ display: "flex", flexDirection: "column", gap: 8, width: 288, padding: 4 }}
          >
            <div style={{ fontWeight: 600, fontSize: 13 }}>Restyle with AI</div>
            <div className="qz-dim" style={{ fontSize: 11.5 }}>
              Describe a look — colors, fonts, softness. Applied as design
              tokens; one Undo brings the old look back.
            </div>
            <textarea
              className="qz-textarea"
              style={{ minHeight: 72, fontSize: 13 }}
              rows={3}
              autoFocus
              placeholder={PLACEHOLDER}
              value={prompt}
              disabled={busy}
              aria-label="Describe the look you want"
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            {err ? (
              <div
                data-testid="design-ai-error"
                style={{ fontSize: 12, color: "var(--qz-crit)" }}
              >
                {err}
              </div>
            ) : null}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="qz-btn qz-btn-primary qz-btn-sm"
                disabled={busy || !prompt.trim()}
                onClick={send}
              >
                {busy ? "Styling…" : "Apply style"}
              </button>
            </div>
          </div>
        }
      />
      {undoLeft > 0 ? (
        <button
          type="button"
          className="qz-btn qz-btn-ghost qz-btn-sm"
          data-testid="design-ai-undo"
          onClick={() => {
            api.undo();
            setUndoLeft(0);
          }}
        >
          Undo ({undoLeft}s)
        </button>
      ) : null}
    </>
  );
}
