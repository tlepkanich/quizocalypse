import type { ResolvedEngagement } from "../../../lib/engagementSchema";

// §L L3 — small result-page engagement widgets, each renders ONLY when configured
// + real (ethics §L5: never fabricate). Brand-book themed via inherited tokens.

// Social-proof line under the persona banner. Hidden below the threshold or with
// no reviews source (E7). `matchedCount` is the baked, floored count (§L4).
export function SocialProofLine({
  config,
  matchedCount,
  rating,
}: {
  config: ResolvedEngagement["socialProof"];
  matchedCount?: number | null;
  rating?: number | null;
}) {
  const showCount =
    config.matchedCount && typeof matchedCount === "number" && matchedCount >= (config.threshold ?? 50);
  const showStars = config.reviewStars && Boolean(config.reviewSource) && typeof rating === "number";
  if (!showCount && !showStars) return null;
  return (
    <div className="qz-proof">
      {showCount ? (
        <span>
          <span aria-hidden>◍ </span>
          {matchedCount!.toLocaleString()} shoppers matched here
        </span>
      ) : null}
      {showCount && showStars ? <span aria-hidden> · </span> : null}
      {showStars ? <span>★ {rating!.toFixed(1)}</span> : null}
    </div>
  );
}

// Share row. Uses a PUBLIC share URL (E5 — never the session bearer). Native
// share sheet on mobile; per-channel buttons otherwise.
export function ShareRow({
  config,
  shareUrl,
  personaName,
}: {
  config: ResolvedEngagement["share"];
  shareUrl: string;
  personaName?: string;
}) {
  if (!config.enabled) return null;
  const channels = config.channels ?? ["copy", "x"];
  const text = personaName ? `I'm a ${personaName}! See your match:` : "See your match:";

  const onChannel = (ch: string) => {
    if (ch === "copy") {
      try {
        void navigator.clipboard?.writeText(shareUrl);
      } catch {
        /* clipboard unavailable — no-op */
      }
      return;
    }
    if (ch === "x") {
      window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(shareUrl)}`, "_blank", "noopener");
      return;
    }
    if (ch === "facebook") {
      window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`, "_blank", "noopener");
      return;
    }
    // ig_story has no web share intent — fall back to the native sheet / copy.
    if (typeof navigator !== "undefined" && navigator.share) {
      void navigator.share({ text, url: shareUrl }).catch(() => {});
    }
  };

  return (
    <div className="qz-share">
      {channels.map((ch) => (
        <button key={ch} type="button" className="qz-share-btn" onClick={() => onChannel(ch)}>
          {ch === "copy" ? "🔗 Copy" : ch === "x" ? "Share on X" : ch === "facebook" ? "Facebook" : "Story"}
        </button>
      ))}
    </div>
  );
}

// Scarcity badge on a product card. Real-only (E7): renders only when live stock
// is known AND ≤ threshold. `remaining` comes from the live /inventory endpoint.
export function ScarcityBadge({
  config,
  remaining,
}: {
  config: ResolvedEngagement["urgency"];
  remaining?: number | null;
}) {
  if (!config.lowStock) return null;
  if (typeof remaining !== "number" || remaining <= 0) return null;
  if (remaining > (config.lowStockThreshold ?? 5)) return null;
  return (
    <span className="qz-scarcity">
      <span aria-hidden>🔥 </span>Only {remaining} left
    </span>
  );
}
