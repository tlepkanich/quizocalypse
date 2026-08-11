/* Shared DNA for the three Ledger × current-Wiskr melds.
   All three: Figtree, tabular figures, squared geometry, one accent that only
   ever means "you can act here", and the stat tile where the figure leads. */

export const FIGTREE = `"Figtree", -apple-system, "Segoe UI", sans-serif`;

export const MELD_CSS = String.raw`
/* — The figure leads. Label underneath, trend under that. This is the tile
     that already works today; it just stops being a pastel block. — */
.stat { display: grid; }
.stat-value { order: 1; margin-top: 0; letter-spacing: -0.035em; }
.stat-label { order: 2; margin-top: 9px; }
.stat-delta { order: 3; margin-top: 5px; }
.spark { order: 4; }

/* — Squared, not round. Nothing in the system is a full pill; every corner is
     a small consistent radius, which is what reads as "modern square". — */
.pill, .chip, .role, .sugg-btn, .mh-fact, .verdict { border-radius: var(--pill-r); }
.avatar, .step-num { border-radius: var(--r-sm); }
.tally, .seg-count { letter-spacing: 0; }

/* — Readability: generous leading on anything that is a sentence. — */
.rule-copy { line-height: 1.75; }
.hero-sub, .step-sub, .card-foot, .note, .pick-meta { line-height: 1.6; }

/* — Structure, Ledger-style: the active nav is marked by a rule, tables get a
     firm head, groups get a firm divider. — */
.nav-item.is-active { position: relative; }
.nav-item.is-active::before {
  content: ""; position: absolute; left: 0; top: 6px; bottom: 6px;
  width: 3px; border-radius: 0 2px 2px 0; background: var(--accent);
}
.ltable tbody tr:hover td, .ltable tbody tr:hover th { background: var(--surface-2); }
.ltable thead th { border-bottom: 1px solid var(--line-strong); }
.frame-cap { letter-spacing: .07em; }
`;

/* Rows every meld shares, so the type section is consistent across the three. */
export const MELD_SCALE = [
  ["Page title", "Figtree 800", "42 / 30 px", "1.06", "−0.032em", "One per screen. Never inside a card."],
  ["Figure", "Figtree 800 · tabular", "38 px", "1.0", "−0.035em", "Stat values and prices. The tile's headline."],
  ["Section", "Figtree 700", "26 px", "1.16", "−0.022em", "Step titles and section heads."],
  ["Card title", "Figtree 700", "16.5 px", "1.3", "−0.012em", "Panel and card heads."],
  ["Body", "Figtree 400", "14.5 px", "1.6", "0", "Descriptions, help text, rule sentences."],
  ["UI", "Figtree 500 / 600", "14 px", "1.4", "0", "Buttons, nav, cells, field labels."],
  ["Data", "Figtree 600 · tabular", "13 px", "1.4", "0", "Counts and ratios. Same digit width, right-aligned."],
  ["Label", "Figtree 700", "11 px", "1.3", "+0.09em", "Eyebrows, column heads, roles, status."],
];

export const meldRamp = (F) => [
  ["Page title", `font-family:${F};font-size:42px;font-weight:800;letter-spacing:-.032em;line-height:1.06`, "Find your board"],
  ["Figure", `font-family:${F};font-size:38px;font-weight:800;letter-spacing:-.035em;font-variant-numeric:tabular-nums`, "65 · 46% · $886.00"],
  ["Section", `font-family:${F};font-size:26px;font-weight:700;letter-spacing:-.022em`, "What should this quiz recommend?"],
  ["Body", `font-family:${F};font-size:14.5px;font-weight:400;color:var(--ink-2);line-height:1.6`, "Each question either picks the result or narrows on one attribute."],
  ["Data", `font-family:${F};font-size:13px;font-weight:600;font-variant-numeric:tabular-nums`, "20 / 23 products"],
  ["Label", `font-family:${F};font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-3)`, "Narrows · gender"],
];

/* The type card copy is the same argument in all three — one family, no mono. */
export const FIGTREE_WHY =
  "A geometric sans with humanist warmth: circular bowls, a tall x-height, and terminals cut straight rather than rounded off. That last detail is the whole difference from Quicksand — it keeps the friendliness and loses the look that currently makes the admin read younger than the product is. Stable at 13px in a table cell, characterful at 42px.";

export const FIGURES_WHY =
  "<b>No monospace anywhere.</b> Every number is Figtree with <code>font-variant-numeric: tabular-nums</code>, so each digit takes the same width and “20 / 23” lines up over “9 / 23” down a column — while still reading as the same warm face as the rest of the product. Small labels are Figtree 700, uppercase, with open tracking.";
