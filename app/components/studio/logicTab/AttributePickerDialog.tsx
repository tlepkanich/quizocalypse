import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { IndexedProduct } from "../../../lib/recommendationEngine";
import { useFocusTrap } from "../../qz-overlays";
import {
  fieldValues,
  narrowFieldOptions,
  type NarrowFieldOption,
} from "./logicTabFields";

// ════════════════════════════════════════════════════════════════════════════
// QRTZ-H2 (mock .ap, _src/shared.mjs 888–919 + base.mjs 622–671) — the
// attribute picker: "Narrows → this → the chosen key lands in the slot."
// A question narrows by ONE product attribute; this dialog picks it.
//
// Select-then-commit: the radio is local state, Use commits (the caller owns
// the write), Cancel / × / Esc discard — NOTHING is written until Use, so a
// cancelled fresh-flip leaves no half-state (no role write to revert).
// Scrim-click deliberately does NOT discard (CreateRuleModal §4.5 precedent).
//
// The rows are the LIVE field inventory (logicTabFields.narrowFieldOptions
// over the draft product index — the same derivation the Logic window's
// field bank groups by), kind-tabbed with real counts. The mock's Collections
// tab is NOT portable: a collection has no per-answer values, so it is not a
// narrow-field in the live model (collection picks are the Logic window's
// "anything" mode). Coverage below 50% flags low (QRTZ-D2's threshold).
// ════════════════════════════════════════════════════════════════════════════

const KIND_ORDER = ["metafield", "tag", "variant", "ptype"] as const;
type FieldKind = (typeof KIND_ORDER)[number];

/** Mock .ap-tabs labels (Options = variant options; Types replaces the mock's
 *  unportable Collections slot). */
const TAB_LABEL: Record<FieldKind, string> = {
  metafield: "Metafields",
  tag: "Tags",
  variant: "Options",
  ptype: "Types",
};

/** Mock .ap-kind tag, singular. */
const KIND_TAG: Record<FieldKind, string> = {
  metafield: "Metafield",
  tag: "Tag",
  variant: "Option",
  ptype: "Type",
};

/** Mock .ap-key — mf rows show the RAW key ("custom.skin_type"); tag rows the
 *  family label ("Concern"); vo rows the option name; ptype its label. */
const rowKey = (f: NarrowFieldOption): string =>
  f.kind === "metafield" ? f.field.slice(3) : f.kind === "variant" ? f.field.slice(3) : f.label;

interface ApRow {
  f: NarrowFieldOption;
  key: string;
  /** First 3–4 values, display-cased, " · "-joined (mock .ap-vals). */
  vals: string;
  /** Lowercased haystack for search (key + label + every value). */
  hay: string;
  thin: boolean;
}

export function AttributePickerDialog({
  qIndex,
  productIndex,
  currentField,
  onCancel,
  onUse,
}: {
  /** The question's number — "How should question {N} narrow?". */
  qIndex: number;
  productIndex: IndexedProduct[];
  /** The currently-derived field (preselected radio), null when none. */
  currentField: string | null;
  onCancel: () => void;
  /** Use commits the chosen field — the caller applies role + values. */
  onUse: (field: string) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  useFocusTrap(boxRef, true);

  // Esc = Cancel (document listener — a scrim onKeyDown dies once focus
  // lands outside a focusable region; CreateRuleModal review L2-4).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const total = productIndex.length;
  const rows = useMemo<ApRow[]>(() => {
    return narrowFieldOptions(productIndex).map((f) => {
      const values = fieldValues(productIndex, f.field);
      const vals = values
        .slice(0, 4)
        .map((v) => v.label)
        .join(" · ");
      return {
        f,
        key: rowKey(f),
        vals,
        hay: `${rowKey(f)} ${f.label} ${values.map((v) => v.value).join(" ")}`.toLowerCase(),
        thin: total > 0 && f.coverage / total < 0.5,
      };
    });
  }, [productIndex, total]);

  const kinds = useMemo(
    () => KIND_ORDER.filter((k) => rows.some((r) => r.f.kind === k)),
    [rows],
  );
  const currentKind = rows.find((r) => r.f.field === currentField)?.f.kind ?? null;
  const [kind, setKind] = useState<FieldKind>(currentKind ?? kinds[0] ?? "metafield");
  const [selected, setSelected] = useState<string | null>(currentField);
  const [query, setQuery] = useState("");

  const qlc = query.trim().toLowerCase();
  const shown = rows.filter(
    (r) => r.f.kind === kind && (!qlc || r.hay.includes(qlc)),
  );

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="qz-modal-scrim">
      <div
        ref={boxRef}
        className="qz-ap"
        role="dialog"
        aria-modal="true"
        aria-label="Choose how this question narrows"
      >
        <header className="qz-ap-head">
          <div>
            {/* Mock .ap-title/.ap-sub verbatim (shared.mjs 891–892). */}
            <p className="qz-ap-title">How should question {qIndex} narrow?</p>
            <p className="qz-ap-sub">
              Answers are matched against one product attribute. Everything that
              doesn&rsquo;t match is dropped for that shopper.
            </p>
          </div>
          <button type="button" className="qz-ap-x" aria-label="Close" onClick={onCancel}>
            {"×"}
          </button>
        </header>
        <div className="qz-ap-search">
          <svg
            className="qz-ap-ico"
            viewBox="0 0 18 18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden
          >
            <circle cx="8" cy="8" r="5" />
            <path d="m12 12 3.5 3.5" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            placeholder="Search metafields, tags, options…"
            aria-label="Search attributes"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {/* Mock .seg.seg-sm.ap-tabs — kind tabs with REAL field counts. */}
        <div className="qz-ap-tabs" role="tablist" aria-label="Attribute kind">
          {kinds.map((k) => {
            const n = rows.filter((r) => r.f.kind === k).length;
            return (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={k === kind}
                className={`qz-ap-tab${k === kind ? " is-on" : ""}`}
                onClick={() => setKind(k)}
              >
                {TAB_LABEL[k]} <span className="qz-ap-tabn">{n}</span>
              </button>
            );
          })}
        </div>
        <ul className="qz-ap-list" role="radiogroup" aria-label="Product attributes">
          {rows.length === 0 ? (
            <li className="qz-ap-none">
              Your products don&rsquo;t carry any attributes a question can
              narrow by yet — add tags, metafields or options in Shopify, then
              sync.
            </li>
          ) : shown.length === 0 ? (
            <li className="qz-ap-none">
              Nothing matches{query.trim() ? ` “${query.trim()}”` : ""} under{" "}
              {TAB_LABEL[kind]}.
            </li>
          ) : (
            shown.map((r) => {
              const on = selected === r.f.field;
              return (
                <li key={r.f.field}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className={`qz-ap-row${on ? " is-on" : ""}${r.thin ? " is-thin" : ""}`}
                    onClick={() => setSelected(r.f.field)}
                  >
                    <span className="qz-ap-radio" aria-hidden />
                    <span className="qz-ap-main">
                      <span className="qz-ap-key">
                        {r.key}
                        {/* Reused low-coverage chip (QRTZ-D2's class) in place
                            of the mock's ::after — same flag, live class. */}
                        {r.thin ? <span className="qz-ltab-menu-thin">low coverage</span> : null}
                      </span>
                      <span className="qz-ap-vals">{r.vals}</span>
                    </span>
                    <span className="qz-ap-kind">{KIND_TAG[r.f.kind]}</span>
                    <span className={`qz-ap-cov${r.thin ? " is-thin" : ""}`}>
                      {r.f.coverage} of {total}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
        <footer className="qz-ap-foot">
          {/* Mock .ap-note verbatim (shared.mjs 915). */}
          <span className="qz-ltab-menu-apnote">
            <b>Coverage matters.</b> An attribute only some products carry will
            drop the rest from every result.
          </span>
          <button type="button" className="qz-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="qz-btn qz-btn-primary"
            disabled={!selected}
            onClick={() => {
              if (selected) onUse(selected);
            }}
          >
            Use
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
