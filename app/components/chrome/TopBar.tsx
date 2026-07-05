import type { ReactNode } from "react";

import { Wordmark } from "./Wordmark";

/* Design-system-V2 §7.6 — the sticky top bar: 58px, paper + blur, bottom
   hairline, three zones with 1px dividers. Left is ALWAYS the wordmark; the
   center zone carries step-nav pills only inside the creation flow; the right
   zone carries save state / health pill / the primary Continue.
   `floating` renders the Step-3 variant (quiz-step3 spec §2): a rounded card
   that floats 10px from the viewport top with 14px side margins — still
   pinned, never scrolls away. */
export function TopBar({
  center,
  right,
  homeTo,
  floating = false,
}: {
  center?: ReactNode;
  right?: ReactNode;
  homeTo?: string;
  floating?: boolean;
}) {
  return (
    <header className={`qz-topbar${floating ? " qz-topbar--floating" : ""}`}>
      <div className="qz-topbar-zone qz-topbar-left">
        <Wordmark to={homeTo} />
      </div>
      <div className="qz-topbar-zone qz-topbar-center">{center}</div>
      <div className="qz-topbar-zone qz-topbar-right">{right}</div>
    </header>
  );
}
