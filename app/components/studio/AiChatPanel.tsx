import { useCallback, useEffect, useRef, useState } from "react";
import { useFetcher } from "@remix-run/react";
import type { Quiz } from "../../lib/quizSchema";

type ChatTurn = { role: "user" | "assistant"; content: string };

interface AiEditResponse {
  ok: boolean;
  doc?: Quiz;
  assistant_message?: string;
  error?: string;
  warnings?: string[];
}

// Starter prompts shown before the merchant types anything. These mirror the
// Dev Spec's example edit flows.
const SUGGESTIONS = [
  "Make the intro warmer and shorter",
  "Add a question about budget",
  "Simplify the last question",
  "Make the results page friendlier",
];

// Inline AI chat for editing the WHOLE quiz by conversation (the Dev Spec's
// "Call 2"). Submits the `ai-edit` intent to the current route's action; on
// success it applies the returned doc via onApply (which re-renders the live
// preview, no reload) and shows the assistant's one-line summary. On failure the
// stored draft is untouched — the server gates every edit on Quiz.parse.
export function AiChatPanel({
  onApply,
  onAiStart,
  onAiError,
  selectedNodeId,
}: {
  onApply: (doc: Quiz) => void;
  // Single-flight seam (see useQuizDraft): onAiStart pauses autosave and returns
  // the doc the AI should edit (sent as `baseDoc`); onAiError resumes it when a
  // request fails. Both optional so the panel still works standalone.
  onAiStart?: () => Quiz;
  onAiError?: () => void;
  // Unified P5 — the workspace's current selection, so "this question" in
  // chat resolves to the step the merchant is looking at.
  selectedNodeId?: string | null;
}) {
  const fetcher = useFetcher<AiEditResponse>();
  const [transcript, setTranscript] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const wasBusyRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Settle each request exactly once, on the busy→idle transition — this pairs
  // with the beginAiEdit() in send() so autosave is always resumed (success via
  // onApply, every failure — including a no-payload network error — via onAiError).
  useEffect(() => {
    const busy = fetcher.state !== "idle";
    if (wasBusyRef.current && !busy) {
      const d = fetcher.data;
      if (d && d.ok && d.doc) {
        onApply(d.doc);
        setTranscript((t) => [
          ...t,
          { role: "assistant", content: d.assistant_message || "Done — I updated your quiz." },
        ]);
      } else {
        if (d && d.ok === false) {
          setTranscript((t) => [
            ...t,
            { role: "assistant", content: `⚠ ${d.error || "I couldn't apply that — try rephrasing."}` },
          ]);
        }
        onAiError?.();
      }
    }
    wasBusyRef.current = busy;
  }, [fetcher.state, fetcher.data, onApply, onAiError]);

  // Keep the transcript scrolled to the latest turn.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [transcript, fetcher.state]);

  const busy = fetcher.state !== "idle";

  const send = useCallback(
    (raw: string) => {
      const msg = raw.trim();
      if (!msg || busy) return;
      const history = transcript.slice(-10);
      setTranscript((t) => [...t, { role: "user", content: msg }]);
      setInput("");
      // Flush + pause autosave and grab the doc the AI should edit, so the LLM
      // applies its ops onto exactly what the merchant sees (not a stale draft).
      const base = onAiStart?.();
      const form = new FormData();
      form.set("intent", "ai-edit");
      form.set("message", msg);
      form.set("history", JSON.stringify(history));
      if (selectedNodeId) form.set("selected_node_id", selectedNodeId);
      if (base) form.set("baseDoc", JSON.stringify(base));
      fetcher.submit(form, { method: "POST" });
    },
    [busy, transcript, fetcher, selectedNodeId, onAiStart],
  );

  return (
    <div
      className="qz-card"
      style={{ display: "flex", flexDirection: "column", height: "min(78vh, 760px)", padding: 0, overflow: "hidden" }}
    >
      <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--qz-rule)" }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>Edit with AI</div>
        <div className="qz-dim" style={{ fontSize: 12 }}>
          Describe a change — the preview updates live.
        </div>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        {transcript.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <p className="qz-dim" style={{ fontSize: 13, margin: 0 }}>
              Try one of these, or type your own:
            </p>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => send(s)}
                disabled={busy}
                className="qz-card"
                style={{
                  textAlign: "left",
                  padding: "8px 10px",
                  fontSize: 13,
                  cursor: busy ? "default" : "pointer",
                  background: "var(--qz-paper)",
                }}
              >
                {s}
              </button>
            ))}
          </div>
        ) : (
          transcript.map((turn, i) => (
            <div
              key={i}
              style={{
                alignSelf: turn.role === "user" ? "flex-end" : "flex-start",
                maxWidth: "85%",
                padding: "8px 11px",
                borderRadius: 12,
                fontSize: 13,
                lineHeight: 1.4,
                whiteSpace: "pre-wrap",
                background:
                  turn.role === "user" ? "var(--qz-accent)" : "color-mix(in srgb, var(--qz-ink) 6%, transparent)",
                color: turn.role === "user" ? "#fff" : "inherit",
              }}
            >
              {turn.content}
            </div>
          ))
        )}
        {busy ? (
          <div className="qz-dim" style={{ fontSize: 12, alignSelf: "flex-start" }}>
            Thinking…
          </div>
        ) : null}
      </div>

      <div style={{ padding: 10, borderTop: "1px solid var(--qz-rule)", display: "flex", gap: 8, alignItems: "flex-end" }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          placeholder="e.g. add a question about skin type"
          rows={2}
          disabled={busy}
          style={{
            flex: 1,
            resize: "none",
            border: "1px solid var(--qz-rule)",
            borderRadius: 8,
            padding: "8px 10px",
            font: "inherit",
            fontSize: 13,
          }}
        />
        <button
          type="button"
          onClick={() => send(input)}
          disabled={busy || !input.trim()}
          className="qz-btn qz-btn-primary qz-btn-sm"
          style={{ flex: "0 0 auto" }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
