import { useContext, useEffect, useRef, useState } from "react";
import type { Quiz } from "../../../lib/quizSchema";
import type { PathStep } from "../../../lib/mergeTags";
import type { stylesFor } from "../runtimeStyles";
import { useChrome } from "../chromeStrings";
import { RuntimeLocaleContext, RuntimePreviewContext } from "../runtimeContexts";
import type { InspectPart } from "../inspect";

type QuizDoc = Quiz;

// Conversational chat step. Renders an opening assistant turn, optional
// suggested-question quick-reply chips, the running transcript, and a text
// input. Each user send posts to /q/:id/ai-chat and appends the reply.
// "Continue" advances to the next quiz node. max_turns capped client-side
// to mirror the server-side enforcement.
export function AskAIView({
  node,
  quizId,
  path,
  styles,
  onContinue,
  inspect,
}: {
  node: Extract<
    QuizDoc["nodes"][number],
    { type: "ask_ai" }
  >;
  quizId: string;
  path: PathStep[];
  styles: ReturnType<typeof stylesFor>;
  onContinue: () => void;
  inspect?: (part: InspectPart) => React.HTMLAttributes<HTMLElement>;
}) {
  const tc = useChrome();
  const chatLocale = useContext(RuntimeLocaleContext);
  const isPreviewMode = useContext(RuntimePreviewContext);
  type Turn = { role: "user" | "assistant"; content: string };
  const [transcript, setTranscript] = useState<Turn[]>([
    { role: "assistant", content: node.data.opening_message },
  ]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcript, sending]);

  const assistantTurns = transcript.filter((t) => t.role === "assistant").length;
  // Opening message counts as turn 1, so cap allows max_turns total replies.
  const turnsRemaining = Math.max(0, node.data.max_turns - assistantTurns);
  const canSend = !sending && draft.trim().length > 0 && turnsRemaining > 0;

  async function send(message: string) {
    if (!message.trim()) return;
    if (turnsRemaining <= 0) return;
    setSending(true);
    setError(null);
    const nextTurn: Turn = { role: "user", content: message };
    // Build the history we forward — strip the synthetic opening message so
    // Claude doesn't re-see it; the system prompt already names the persona.
    const history = transcript
      .slice(1)
      .map((t) => ({ role: t.role, content: t.content }));
    setTranscript((prev) => [...prev, nextTurn]);
    setDraft("");
    if (isPreviewMode) {
      // Preview: stub a canned reply (no live Claude call).
      setTranscript((prev) => [
        ...prev,
        {
          role: "assistant",
          content: tc("chat_preview_stub"),
        },
      ]);
      setSending(false);
      return;
    }
    try {
      const res = await fetch(`/q/${quizId}/ai-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeId: node.id,
          path,
          history,
          userMessage: message,
          locale: chatLocale,
        }),
      });
      const body = (await res.json()) as { reply?: string; error?: string };
      if (!res.ok || !body.reply) {
        setError(body.error ?? "Something went wrong.");
        setTranscript((prev) => prev.slice(0, -1)); // roll back user turn
        return;
      }
      setTranscript((prev) => [
        ...prev,
        { role: "assistant", content: body.reply! },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : tc("network_error"));
      setTranscript((prev) => prev.slice(0, -1));
    } finally {
      setSending(false);
    }
  }

  const bubble = (turn: Turn): React.CSSProperties => ({
    maxWidth: "85%",
    padding: "10px 14px",
    borderRadius: "var(--qz-radius)",
    background:
      turn.role === "user" ? "var(--qz-color-primary)" : "#00000010",
    color: turn.role === "user" ? "#FFF" : "var(--qz-color-text)",
    alignSelf: turn.role === "user" ? "flex-end" : "flex-start",
    whiteSpace: "pre-wrap",
    fontSize: "var(--qz-base-size)",
    lineHeight: 1.4,
  });

  return (
    <div style={{ ...styles.card, display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 12,
        }}
      >
        <h2 style={{ ...styles.h2, margin: 0 }} {...(inspect?.("askai_persona") ?? {})}>
          {node.data.persona_name}
        </h2>
        <span
          style={{
            fontSize: 11,
            color: "var(--qz-color-muted)",
            fontFamily: "monospace",
          }}
        >
          {turnsRemaining > 0
            ? `${turnsRemaining} turn${turnsRemaining === 1 ? "" : "s"} left`
            : tc("chat_ended")}
        </span>
      </div>
      <div
        ref={scrollRef}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          maxHeight: 360,
          overflowY: "auto",
          paddingRight: 4,
        }}
      >
        {transcript.map((turn, i) => (
          <div key={i} style={bubble(turn)}>
            {turn.content}
          </div>
        ))}
        {sending && (
          <div
            style={{
              ...bubble({ role: "assistant", content: "" }),
              opacity: 0.6,
              fontStyle: "italic",
            }}
          >
            Thinking…
          </div>
        )}
      </div>
      {transcript.length === 1 && node.data.suggested_questions.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {node.data.suggested_questions.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => send(q)}
              disabled={!canSend && sending}
              style={{
                background: "transparent",
                border: "1px solid #00000020",
                borderRadius: "var(--qz-radius)",
                padding: "6px 10px",
                cursor: "pointer",
                fontSize: 12,
                color: "var(--qz-color-text)",
                fontFamily: "var(--qz-font-body)",
              }}
            >
              {q}
            </button>
          ))}
        </div>
      )}
      {error && (
        <div
          style={{
            background: "#C2410C20",
            color: "#C2410C",
            padding: 8,
            borderRadius: "var(--qz-radius)",
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSend) send(draft);
        }}
        style={{ display: "flex", gap: 8 }}
      >
        <input
          type="text"
          aria-label={tc("chat_placeholder")}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={sending || turnsRemaining <= 0}
          placeholder={turnsRemaining > 0 ? tc("chat_placeholder") : tc("chat_ended")}
          style={{
            flex: 1,
            padding: "10px 12px",
            border: "1px solid #00000022",
            borderRadius: "var(--qz-radius)",
            fontSize: "var(--qz-base-size)",
            fontFamily: "var(--qz-font-body)",
          }}
        />
        <button
          type="submit"
          disabled={!canSend}
          style={{
            ...styles.primaryBtn,
            marginTop: 0,
            opacity: canSend ? 1 : 0.5,
          }}
        >
          {tc("send")}
        </button>
      </form>
      <button
        type="button"
        onClick={onContinue}
        style={{
          ...styles.primaryBtn,
          marginTop: 0,
          background: "transparent",
          color: "var(--qz-color-primary)",
          border: "2px solid var(--qz-color-primary)",
        }}
      >
        {node.data.continue_label}
      </button>
    </div>
  );
}
