import { Link } from "@remix-run/react";

import { CatMark } from "./CatMark";

/* QRTZ-G6 — the Quartz brand block (mock _src/shared.mjs `.brand`): the solid
   cat mark in ink with paper-knockout eyes, bare on the rail ground — the
   violet fox tile is retired on admin chrome (the shopper runtime badge keeps
   FoxMark, frozen). Name sits at 17/700/−.015em per the mock `.brand-name`.
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
        <CatMark size={28} />
      </span>
      {compact ? null : <span className="qz-wordmark-name">{name}</span>}
    </Link>
  );
}
