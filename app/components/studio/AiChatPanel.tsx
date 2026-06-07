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
export function AiChatPanel({ onApply }: { onApply: (doc: Quiz) => void }) {
  const fetcher = useFetcher<AiEditResponse>();
  const [transcript, setTranscript] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const appliedRef = useRef<AiEditResponse | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Apply each response exactly once (the fetcher.data identity changes per call).
  useEffect(() => {
    const d = fetcher.data;
    if (fetcher.state !== "idle" || !d || appliedRef.current === d) return;
    appliedRef.current = d;
    if (d.ok && d.doc) {
      onApply(d.doc);
      setTranscript((t) => [
        ...t,
        { role: "assistant", content: d.assistant_message || "Done — I updated your quiz." },
      ]);
    } else if (d.ok === false) {
      setTranscript((t) => [
        ...t,
        { role: "assistant", content: `⚠ ${d.error || "I couldn't apply that — try rephrasing."}` },
      ]);
    }
  }, [fetcher.state, fetcher.data, onApply]);

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
      const form = new FormData();
      form.set("intent", "ai-edit");
      form.set("message", msg);
      form.set("history", JSON.stringify(history));
      fetcher.submit(form, { method: "POST" });
    },
    [busy, transcript, fetcher],
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
