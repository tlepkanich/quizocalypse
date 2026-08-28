import { Link } from "@remix-run/react";

import { WORDMARK_H, WORDMARK_PNG, WORDMARK_W } from "./brandAssets";
import { FoxMark } from "./FoxMark";

/* BRAND-3 — the 2026-08 lockup: the purple fox mark beside the lowercase
   "wiskr" logotype (the whisker-flame accent over the dotless i). Both are
   the owner-supplied art rendered EXACTLY (brandAssets.ts data URIs) — never
   redrawn. The logotype is dark indigo on a transparent ground, so it reads
   on the light admin chrome only. Replaces the Quartz cat + typeset name
   (QRTZ-G6). `compact` renders the mark alone (collapsed rail / small-scale
   contexts). `onClick` (one-line-chrome §1.1) lets the funnel intercept the
   home click with its leave-confirm dialog (preventDefault + open). */

const NAME_H = 20; // rendered logotype height — ≈ the old 17px typeset name
const NAME_W = Math.round((WORDMARK_W / WORDMARK_H) * NAME_H);

export function Wordmark({
  to = "/studio",
  name = "Wiskr",
  compact = false,
  onClick,
}: {
  to?: string;
  name?: string;
  compact?: boolean;
  onClick?: (e: React.MouseEvent) => void;
}) {
  return (
    <Link to={to} className="qz-wordmark" aria-label={`${name} — home`} onClick={onClick}>
      <span className="qz-wordmark-mono" aria-hidden="true">
        <FoxMark size={28} />
      </span>
      {compact ? null : (
        <svg
          className="qz-wordmark-name"
          width={NAME_W}
          height={NAME_H}
          viewBox={`0 0 ${WORDMARK_W} ${WORDMARK_H}`}
          aria-hidden="true"
          focusable="false"
        >
          <image href={WORDMARK_PNG} width={WORDMARK_W} height={WORDMARK_H} />
        </svg>
      )}
    </Link>
  );
}
