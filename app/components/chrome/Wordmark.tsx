import { Link } from "@remix-run/react";

/* Design-system-V2 §7.6 — the wordmark: gold ◆ (a CSS-rendered rotated square,
   canonical gold moment #1) + the product name in Mona Sans 700. One hit
   target, returns to app home. `compact` renders the ◆ alone (collapsed rail /
   small-scale contexts — the diamond is the mark, the word is reinforcement).
   Product name is TBD per the spec; "Quizocalypse" is the working placeholder. */
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
      <span className="qz-mark" aria-hidden="true" />
      {compact ? null : <span className="qz-wordmark-name">{name}</span>}
    </Link>
  );
}
