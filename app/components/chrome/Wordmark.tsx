import { Link } from "@remix-run/react";

import { FoxMark } from "./FoxMark";

/* BRAND-2 closes the §14 "final logo lockup" open item: the wiskr fox sits in
   the rounded tile, with the product name in the display face (Quicksand).
   `compact` renders the tile alone (collapsed rail / small-scale contexts).
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
        <FoxMark size={22} variant="cream" feature="var(--qz-accent)" />
      </span>
      {compact ? null : <span className="qz-wordmark-name">{name}</span>}
    </Link>
  );
}
