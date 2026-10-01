import { useEffect, useState } from "react";
import type { DiscountConfig } from "../../../lib/quizSchema";
import { apiUrl } from "../../../lib/apiBase";
import { offerCodeDisplay, offerLine, offerName } from "../../../lib/offerCopy";

// Results handoff §12.3–§12.4 — the shopper's offer on the decider results
// page. The code is NEVER in the public quiz file: the page asks /offer for
// it once the shopper has earned it (results reveal, or email submit when the
// email unlocks it). Rendered only for a discount saved in the Results editor
// (discount_config.configured), so every existing quiz is untouched.

export interface IssuedOffer {
  code: string;
  line: string;
  ends_at: string | null;
}

type OfferState =
  | { status: "idle" | "loading" | "none" }
  | { status: "issued"; offer: IssuedOffer };

const RETRIES = 4;
const RETRY_MS = 700;

/**
 * Ask the server for this session's code. `ready` is false while the email
 * that unlocks the offer has not been submitted. A 409 means the completion
 * POST is still in flight, so it retries; anything else settles quietly —
 * a missing offer never breaks the results page.
 */
export function useOffer(args: {
  enabled: boolean;
  ready: boolean;
  preview: boolean;
  quizId?: string;
  sessionId?: string;
  email?: string;
  discount: DiscountConfig | undefined;
}): OfferState {
  const { enabled, ready, preview, quizId, sessionId, email, discount } = args;
  const [state, setState] = useState<OfferState>({ status: "idle" });
  useEffect(() => {
    if (!enabled || !ready || !discount) return;
    if (preview) {
      // The builder preview never mints: a masked sample, like the editor's.
      setState({
        status: "issued",
        offer: { code: offerCodeDisplay(discount), line: offerLine(discount), ends_at: null },
      });
      return;
    }
    if (!quizId || !sessionId) return;
    let cancelled = false;
    setState({ status: "loading" });
    const attempt = async (left: number): Promise<void> => {
      try {
        const res = await fetch(apiUrl("/offer"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ quiz_id: quizId, session_id: sessionId, ...(email ? { email } : {}) }),
        });
        if (cancelled) return;
        if (res.status === 409 && left > 0) {
          window.setTimeout(() => void attempt(left - 1), RETRY_MS);
          return;
        }
        const data = (await res.json()) as { offer?: IssuedOffer | null };
        if (cancelled) return;
        setState(data.offer ? { status: "issued", offer: data.offer } : { status: "none" });
      } catch {
        if (!cancelled) setState({ status: "none" });
      }
    };
    void attempt(RETRIES);
    return () => {
      cancelled = true;
    };
    // The discount object's identity changes per render; its settings cannot
    // change mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ready, preview, quizId, sessionId, email]);
  return state;
}

/** "10% off your order · expires in 24h   QUIZ-7K2M9Q" */
export function OfferBar({ offer }: { offer: IssuedOffer }) {
  return (
    <div
      data-qz-offer="bar"
      role="status"
      style={{
        marginTop: 16,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 14px",
        borderRadius: "var(--qz-radius)",
        background: "var(--qz-color-text)",
        color: "var(--qz-color-bg)",
        fontFamily: "var(--qz-font-body)",
        fontSize: "calc(var(--qz-base-size) * 0.9)",
        textAlign: "left",
      }}
    >
      <span style={{ flex: 1 }}>{offer.line}</span>
      <b
        style={{
          fontVariantNumeric: "tabular-nums",
          padding: "3px 8px",
          borderRadius: 6,
          background: "color-mix(in srgb, var(--qz-color-bg) 18%, transparent)",
          whiteSpace: "nowrap",
        }}
      >
        {offer.code}
      </b>
    </div>
  );
}

/** The strip on top of the unlock form: what the address buys. The code is
 *  deliberately absent — it does not exist until the email is submitted. */
export function OfferLockStrip({ discount }: { discount: DiscountConfig }) {
  return (
    <div
      data-qz-offer="locked"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 14px",
        marginBottom: 12,
        borderRadius: "var(--qz-radius)",
        background: "color-mix(in srgb, var(--qz-color-primary) 12%, transparent)",
        color: "var(--qz-color-text)",
        fontFamily: "var(--qz-font-body)",
        fontWeight: 600,
        textAlign: "left",
      }}
    >
      <span aria-hidden>🔒</span>
      <span>{offerName(discount)}</span>
    </div>
  );
}
