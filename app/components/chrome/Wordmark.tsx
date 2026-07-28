import { Link } from "@remix-run/react";

import { FoxMark } from "./FoxMark";

/* BRAND-2 closes the §14 "final logo lockup" open item: the wiskr fox sits in
   the rounded tile, with the product name in the display face (Quicksand).
   `compact` renders the tile alone (collapsed rail / small-scale contexts). */
export function Wordmark({
  to = "/studio",
  name = "Wiskr",
  compact = false,
}: {
  to?: string;
  name?: string;
  compact?: boolean;
}) {
  return (
    <Link to={to} className="qz-wordmark" aria-label={`${name} — home`}>
      <span className="qz-wordmark-mono" aria-hidden="true">
        <FoxMark size={22} variant="cream" feature="var(--qz-accent)" />
      </span>
      {compact ? null : <span className="qz-wordmark-name">{name}</span>}
    </Link>
  );
}
