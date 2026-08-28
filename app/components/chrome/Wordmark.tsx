import { Link } from "@remix-run/react";

import { FOX_PURPLE, FoxMark } from "./FoxMark";

/* BRAND-3 — the 2026-08 lockup: the purple fox mark beside the drawn
   lowercase "wiskr" logotype. Letters are stroked paths in currentColor (the
   chrome's ink, via .qz-wordmark); the whisker-flame accent over the dotless
   i is the brand purple. Replaces the Quartz cat + typeset name (QRTZ-G6).
   `compact` renders the mark alone (collapsed rail / small-scale contexts).
   `onClick` (one-line-chrome §1.1) lets the funnel intercept the home click
   with its leave-confirm dialog (preventDefault + open). */
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
          width={50}
          height={20}
          viewBox="0 0 548 220"
          aria-hidden="true"
          focusable="false"
        >
          <g
            fill="none"
            stroke="currentColor"
            strokeWidth={30}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M25 78 L57 178 L88 96 L119 178 L151 78" />
            <path d="M190 82 L190 178" />
            <path d="M290 92 C284 72 236 68 227 88 C218 110 290 112 294 138 C299 164 244 174 225 152" />
            <path d="M342 40 L342 178" />
            <path d="M342 120 C370 116 390 100 398 80" />
            <path d="M350 114 C378 118 396 140 404 178" />
            <path d="M446 82 L446 178" />
            <path d="M446 116 C452 88 488 76 506 94 C514 102 516 114 510 124" />
          </g>
          <path
            d="M176 62 C180 32 200 8 230 0 C212 20 208 36 206 56 C196 46 184 51 176 62 Z"
            fill={FOX_PURPLE}
          />
        </svg>
      )}
    </Link>
  );
}
