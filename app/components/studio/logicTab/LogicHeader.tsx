import { useEffect, useId, useState, type ReactNode } from "react";
import type { LogicStyle } from "../../../lib/logicStyle";
import { QzMenu } from "../../qz-overlays";
import {
  HINT_LESS,
  HINT_MORE,
  LOGIC_STYLE_MENU,
  LOGIC_STYLE_NAME,
  RULE_COPY,
  STYLE_HINT,
  VIEW_COPY,
} from "./logicCopy";

// ════════════════════════════════════════════════════════════════════════════
// Logic step redesign — the status header (mock statusHead / hintHTML /
// headRight / styleMenu; handoff "Screen shell"). One row that wraps:
//
//   [Title ▾]  description · More ▾      [actions by style/view] [Edit | Table]
//
// It reads NOTHING from a host: the style, the view and every action arrive
// as props, so the main-builder work (D6, parked) mounts it unchanged.
//   • onStyleChange absent → a static title with no ▾ (read-only card, and
//     the builder until the main-builder project wires it).
//   • Choosing a style ALWAYS calls onStyleChange, the style already shown
//     included: on a draft whose style is only inferred, that one click makes
//     it real (handoff "First entry"). Nothing is written on open.
//   • More / Less is remembered per viewer in localStorage "lg-hint" ('1' /
//     '0'), read after mount, every access in try/catch (Rail.tsx pattern).
// ════════════════════════════════════════════════════════════════════════════

export type LogicView = "edit" | "table";

const HINT_KEY = "lg-hint";

export type LogicHeaderProps = {
  /** Always resolved (resolveLogicStyle): there is no chooser state (D5). */
  style: LogicStyle;
  /** Absent: static title, no menu. */
  onStyleChange?: (style: LogicStyle) => void;
  view: LogicView;
  onViewChange: (view: LogicView) => void;
  /** Rules only + Edit: the "Paste rules" link. */
  onPasteRules?: () => void;
  /** Rules only + Edit: the primary "Create a rule". */
  onCreateRule?: () => void;
  /** Table view: the Import | Export pair (LogicImportExport renders it). */
  importExport?: ReactNode;
  /** Controlled open state of the "Logic style" menu (the check popover's
   *  style row opens it). Omit both for an uncontrolled menu. */
  styleMenuOpen?: boolean;
  onStyleMenuOpenChange?: (open: boolean) => void;
  /** The heading element that wraps the title (the funnel step has no other
   *  heading, so it passes "h1"). */
  headingLevel?: "h1" | "h2";
};

export function LogicHeader({
  style,
  onStyleChange,
  view,
  onViewChange,
  onPasteRules,
  onCreateRule,
  importExport,
  styleMenuOpen,
  onStyleMenuOpenChange,
  headingLevel = "h2",
}: LogicHeaderProps) {
  const hint = STYLE_HINT[style];
  const moreId = useId();
  const [hintOpen, setHintOpen] = useState(false);
  useEffect(() => {
    try {
      setHintOpen(window.localStorage.getItem(HINT_KEY) === "1");
    } catch {
      // Storage blocked (private mode / policy): the description stays closed.
    }
  }, []);
  const toggleHint = () => {
    const next = !hintOpen;
    setHintOpen(next);
    try {
      window.localStorage.setItem(HINT_KEY, next ? "1" : "0");
    } catch {
      // Storage blocked: the toggle still works for this page view.
    }
  };

  const name = LOGIC_STYLE_NAME[style];
  const Heading = headingLevel;
  const titleButton = (
    <button
      type="button"
      className="qz-lg-stitle"
      title={LOGIC_STYLE_MENU.titleTip}
      data-testid="logic-style-title"
    >
      {name}
      <span className="qz-lg-cv" aria-hidden>
        ▾
      </span>
    </button>
  );

  return (
    <div className="qz-lg-status">
      <Heading className="qz-lg-stitle-h">
        {onStyleChange ? (
          <QzMenu
            trigger={titleButton}
            title={LOGIC_STYLE_MENU.title}
            ariaLabel={LOGIC_STYLE_MENU.title}
            width={400}
            className="qz-lg-pop qz-lg-stylemenu"
            testId="logic-style-menu"
            offset={6}
            {...(styleMenuOpen !== undefined ? { open: styleMenuOpen } : {})}
            {...(onStyleMenuOpenChange ? { onOpenChange: onStyleMenuOpenChange } : {})}
            items={LOGIC_STYLE_MENU.items.map((it) => ({
              label: it.name,
              hint: it.hint,
              checked: it.style === style,
              onSelect: () => onStyleChange(it.style),
            }))}
          />
        ) : (
          <span className="qz-lg-stitle is-static" data-testid="logic-style-title">
            {name}
          </span>
        )}
      </Heading>
      <div className="qz-lg-sdesc">
        <p className="qz-lg-status-p">
          {hint.lead}
          {hint.more ? (
            <button
              type="button"
              className={`qz-lg-more${hintOpen ? " is-open" : ""}`}
              aria-expanded={hintOpen}
              aria-controls={moreId}
              onClick={toggleHint}
            >
              {hintOpen ? HINT_LESS : HINT_MORE}
              <span aria-hidden>▾</span>
            </button>
          ) : null}
        </p>
        {hint.more ? (
          <p className="qz-lg-status-p" id={moreId} hidden={!hintOpen}>
            {hint.more}
          </p>
        ) : null}
      </div>
      <div className="qz-lg-sact">
        {style === "rules" && view === "edit" && onPasteRules ? (
          <button type="button" className="qz-lg-link" onClick={onPasteRules}>
            {RULE_COPY.pasteRules}
          </button>
        ) : null}
        {style === "rules" && view === "edit" && onCreateRule ? (
          <button type="button" className="qz-lg-btn is-pri" onClick={onCreateRule}>
            {RULE_COPY.createARule}
          </button>
        ) : null}
        {view === "table" ? importExport : null}
        <span className="qz-lg-vseg2" role="group" aria-label={VIEW_COPY.group} data-testid="logic-view-toggle">
          <button type="button" aria-pressed={view === "edit"} onClick={() => onViewChange("edit")}>
            {VIEW_COPY.edit}
          </button>
          <button type="button" aria-pressed={view === "table"} onClick={() => onViewChange("table")}>
            {VIEW_COPY.table}
          </button>
        </span>
      </div>
    </div>
  );
}
