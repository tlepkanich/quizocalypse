import { useEffect, useState } from "react";
import type { ResolvedEngagement } from "../../../lib/engagementSchema";

// §M6 — the referrer's give-get share block on the result. Mints a stable share
// token from /referral (intent=mint) and shows "you and a friend both get X" +
// the copyable link. Renders only when the merchant enabled referral (gated at
// the call site → legacy docs byte-identical). In the builder preview it shows a
// static example (no mint side-effect).

function offer(type: string | undefined, value: number | undefined): string {
  if (type === "free_shipping") return "free shipping";
  if (type === "fixed") return `${value ?? ""} off`;
  return `${value ?? ""}% off`;
}

export function ReferralShare({
  config,
  quizId,
  sessionId,
  preview,
}: {
  config: ResolvedEngagement["referral"];
  quizId: string;
  sessionId: string;
  preview?: boolean;
}) {
  const [link, setLink] = useState<string | null>(preview ? `/q/${quizId}?ref=EXAMPLE` : null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (preview) return;
    let live = true;
    fetch("/referral", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent: "mint", quiz_id: quizId, session_id: sessionId }),
    })
      .then((r) => r.json())
      .then((d: { link?: string }) => {
        if (live && d.link) setLink(d.link);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [preview, quizId, sessionId]);

  if (!link) return null; // not minted yet, or referral not offered server-side

  const copy = () => {
    try {
      void navigator.clipboard?.writeText(link);
      setCopied(true);
    } catch {
      /* clipboard blocked — the link is still selectable */
    }
  };

  return (
    <div className="qz-referral">
      <div className="qz-referral-head">
        🎁 Share your result — you and a friend both get {offer(config.getType, config.getValue)}
      </div>
      <div className="qz-referral-linkrow">
        <input className="qz-referral-link" readOnly value={link} aria-label="Your referral link" onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="qz-referral-copy" onClick={copy}>
          {copied ? "Copied!" : "Copy link"}
        </button>
      </div>
    </div>
  );
}
