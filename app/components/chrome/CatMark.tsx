/* QRTZ-G6 — the Quartz cat mark, ported verbatim from
   docs/design/brand-2026/_src/shared.mjs mark("solid"): triangular ears, the
   rx-9 rounded head, eyes + nose knocked out to the ground the mark sits on.
   The head takes `currentColor` (the admin brand block sets ink), and the
   knockout defaults to paper — mock contract `.mark .eye { fill:
   var(--mark-eye, var(--page)) }` with `.brand { --mark-eye: var(--rail-bg) }`.
   That ink-solid + paper-knockout pairing is the "black and white cat logo".
   Admin chrome only — the shopper runtime badge keeps FoxMark (frozen).
   The mock also defines a "line" variant; the Rail layout ships solid, so
   only solid is ported. */

export function CatMark({
  size = 28,
  knockout = "var(--qz-paper)",
}: {
  size?: number;
  /** The ground the mark sits on — fills the punched-out eyes and nose. */
  knockout?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      style={{ display: "block", flex: "none" }}
    >
      <path d="M6 13V4.5L13 9z" fill="currentColor" />
      <path d="M26 13V4.5L19 9z" fill="currentColor" />
      <rect x="5" y="9" width="22" height="18" rx="9" fill="currentColor" />
      <circle cx="12.4" cy="17" r="1.9" fill={knockout} />
      <circle cx="19.6" cy="17" r="1.9" fill={knockout} />
      <path d="M14.4 21.2h3.2L16 23z" fill={knockout} />
    </svg>
  );
}
