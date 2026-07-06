import { useContext, useEffect, useRef, useState } from "react";
import type { Quiz } from "../../../lib/quizSchema";
import type { PathStep } from "../../../lib/mergeTags";
import type { stylesFor } from "../runtimeStyles";
import { useChrome } from "../chromeStrings";
import { RuntimePreviewContext } from "../runtimeContexts";

type QuizDoc = Quiz;

// Transient step. Fires the integration node's configured actions
// server-side, then advances. The shopper sees a brief "Saving…" while the
// fetch runs. continue_on_error (true by default) lets the runtime move on
// even if every webhook failed — better than dead-ending on a broken Zap.
export function IntegrationView({
  node,
  quizId,
  sessionId,
  path,
  contact,
  styles,
  onDone,
}: {
  node: Extract<
    QuizDoc["nodes"][number],
    { type: "integration" }
  >;
  quizId: string;
  sessionId?: string;
  path: PathStep[];
  contact?: { email?: string; name?: string; phone?: string };
  styles: ReturnType<typeof stylesFor>;
  onDone: () => void;
}) {
  const tc = useChrome();
  const isPreviewMode = useContext(RuntimePreviewContext);
  const fired = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    if (isPreviewMode) {
      onDone(); // preview: skip the webhook/Klaviyo POST, just advance
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/q/${quizId}/integration`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nodeId: node.id,
            path,
            ...(sessionId ? { session_id: sessionId } : {}),
            ...(contact?.email ? { email: contact.email } : {}),
            ...(contact?.name ? { name: contact.name } : {}),
            ...(contact?.phone ? { phone: contact.phone } : {}),
          }),
        });
        const body = (await res.json()) as { ok?: boolean; error?: string };
        if (cancelled) return;
        if (!res.ok || !body.ok) {
          if (!node.data.continue_on_error) {
            setError(body.error ?? tc("integration_failed"));
            return;
          }
        }
        onDone();
      } catch (err) {
        if (cancelled) return;
        if (!node.data.continue_on_error) {
          setError(err instanceof Error ? err.message : tc("network_error"));
          return;
        }
        onDone();
      }
    })();
    return () => {
      cancelled = true;
    };
    // `contact` is read but intentionally not a dep — the effect fires once
    // (guarded by fired.current) with whatever contact was captured by then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id, node.data.continue_on_error, quizId, path, onDone]);

  return (
    <div style={styles.card}>
      <h2 style={styles.h2}>{error ? tc("something_went_wrong") : tc("saving")}</h2>
      {error ? (
        <>
          <p style={styles.muted}>{error}</p>
          <button style={styles.primaryBtn} onClick={onDone}>
            Continue anyway
          </button>
        </>
      ) : (
        <p style={styles.muted}>{tc("sending_answers")}</p>
      )}
    </div>
  );
}
