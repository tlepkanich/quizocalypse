import { useRef, useState } from "react";
import { useChrome } from "../chromeStrings";

// An answer's label plus an optional always-visible helper caption
// (Answer.tooltip_text, baked at publish — Dev Spec §4.1) that explains the
// option's tradeoff in plain English. Always-visible rather than a hover/click
// popover because answer options are themselves <button>/<label> elements: a
// nested interactive tooltip would be invalid markup and unreliable on touch.
// A revealable info tooltip for an answer option (Answer.tooltip_text, baked at
// publish — Dev Spec §4.1/§8). The ⓘ chip is a SIBLING of the answer control,
// never nested inside the <button>/<label> (which would be invalid markup and
// unreliable on touch); it's absolutely positioned in the card corner, and its
// onClick stops propagation so revealing the tooltip never selects the answer.
// Fires tooltip_viewed once, on first reveal.
export function TooltipChip({ text, onReveal }: { text: string; onReveal: () => void }) {
  const tc = useChrome();
  const [open, setOpen] = useState(false);
  const seenRef = useRef(false);
  return (
    <span style={{ position: "absolute", top: 8, right: 8, zIndex: 2 }}>
      <button
        type="button"
        aria-label={tc("aria_more_info")}
        aria-expanded={open}
        onKeyDown={(e) => {
          // WAI-ARIA tooltip pattern: Escape dismisses (focus stays on the chip).
          if (e.key === "Escape" && open) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => {
            if (!o && !seenRef.current) {
              seenRef.current = true;
              onReveal();
            }
            return !o;
          });
        }}
        style={{
          width: 22,
          height: 22,
          borderRadius: "50%",
          border: "1px solid #00000033",
          background: "var(--qz-color-bg, #fff)",
          color: "var(--qz-color-muted, #777)",
          fontFamily: "Georgia, 'Times New Roman', serif",
          fontStyle: "italic",
          fontSize: 13,
          lineHeight: 1,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        i
      </button>
      {open ? (
        <span
          role="tooltip"
          style={{
            position: "absolute",
            top: 27,
            right: 0,
            width: 220,
            maxWidth: "70vw",
            zIndex: 5,
            background: "var(--qz-color-text, #1b1a17)",
            color: "var(--qz-color-bg, #fff)",
            fontSize: 12.5,
            fontWeight: 400,
            lineHeight: 1.4,
            padding: "8px 11px",
            borderRadius: 8,
            boxShadow: "0 6px 20px rgba(0,0,0,0.18)",
            textAlign: "left",
          }}
        >
          {text}
        </span>
      ) : null}
    </span>
  );
}
