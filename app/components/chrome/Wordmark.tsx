import { Link } from "@remix-run/react";

/* Quizzy Master Design System §13 — there is NO pictorial brand mark (the gold
   diamond glyph was removed). Identity is typographic: a rounded monogram tile +
   the product name in the display face (Quicksand). `compact` renders the
   monogram alone (collapsed rail / small-scale contexts). The final logo lockup
   is a design open item (§14); the monogram is the interim mark. */
export function Wordmark({
  to = "/studio",
  name = "Quizocalypse",
  compact = false,
}: {
  to?: string;
  name?: string;
  compact?: boolean;
}) {
  return (
    <Link to={to} className="qz-wordmark" aria-label={`${name} — home`}>
      <span className="qz-wordmark-mono" aria-hidden="true">
        {name.charAt(0)}
      </span>
      {compact ? null : <span className="qz-wordmark-name">{name}</span>}
    </Link>
  );
}
