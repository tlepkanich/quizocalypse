import type { ReactNode } from "react";

import { Wordmark } from "./Wordmark";

/* Design-system-V2 §7.6 + the one-line-chrome handoff — the sticky top bar:
   58px, paper + blur, bottom hairline.
   Default: three zones with 1px dividers (wordmark · center · right).
   `nav` renders the FUNNEL chrome instead — ONE line, three zones:
   the compact logo alone (home, the only control that confirms leaving),
   the step flow owning ALL free width (the only uncapped thing on the page),
   and the fixed-width right zone (save chip · back · Continue). `center` is
   ignored when `nav` is set. `onHomeClick` lets the funnel preventDefault()
   the logo's home link and open its leave-confirm dialog. */
export function TopBar({
  center,
  right,
  homeTo,
  nav,
  onHomeClick,
}: {
  center?: ReactNode;
  right?: ReactNode;
  homeTo?: string;
  nav?: ReactNode;
  onHomeClick?: (e: React.MouseEvent) => void;
}) {
  if (nav) {
    return (
      <header className="qz-topbar qz-topbar--flow">
        <div className="qz-topbar-zone qz-topbar-left">
          <Wordmark to={homeTo} compact onClick={onHomeClick} />
        </div>
        {/* 10px padding / -10px margin (CSS) keeps the current dot's ignite
            halo unclipped by the flow's overflow-x without growing the bar. */}
        <div className="qz-topbar-flow">{nav}</div>
        <div className="qz-topbar-zone qz-topbar-right">{right}</div>
      </header>
    );
  }
  return (
    <header className="qz-topbar">
      <div className="qz-topbar-zone qz-topbar-left">
        <Wordmark to={homeTo} />
      </div>
      <div className="qz-topbar-zone qz-topbar-center">{center}</div>
      <div className="qz-topbar-zone qz-topbar-right">{right}</div>
    </header>
  );
}
