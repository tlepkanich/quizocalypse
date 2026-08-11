/* The Quartz system — fixed across all four layout studies.
   Violet-only accent, rationed to action / selection / focus. Squared
   geometry. Figtree by default, but every file ships all four faces and a
   switcher, so layout and typeface can be judged separately. */

import { MELD_CSS, MELD_SCALE, meldRamp, FIGTREE_WHY, FIGURES_WHY } from "./meld.mjs";

export const FONTS = ["figtree", "jakarta", "onest", "manrope"];

export const FACE = {
  figtree: `"Figtree", -apple-system, "Segoe UI", sans-serif`,
  jakarta: `"Plus Jakarta Sans", -apple-system, "Segoe UI", sans-serif`,
  onest: `"Onest", -apple-system, "Segoe UI", sans-serif`,
  manrope: `"Manrope", -apple-system, "Segoe UI", sans-serif`,
};

export const FACE_COPY = {
  figtree: {
    name: "Figtree",
    why: "The one from your screenshot. A geometric sans with humanist warmth: circular bowls, a tall x-height, terminals cut straight rather than rounded off. That last detail is the whole difference from Quicksand — it keeps the friendliness and loses the look that reads younger than the product is. The most neutral of the four; it will never be the reason someone dislikes a screen.",
  },
  jakarta: {
    name: "Plus Jakarta Sans",
    why: "A shade warmer and slightly more written than Figtree — the <b>a</b>, <b>g</b> and <b>y</b> carry a little more personality, and it has more contrast between thick and thin. That makes headings feel more designed and long labels a touch friendlier. The trade is that at 13px in a dense table it is marginally busier than Figtree.",
  },
  onest: {
    name: "Onest",
    why: "The tightest and most modern of the four. Soft joins where strokes meet, a very large x-height, and unusually even colour at small sizes — it is the one that holds up best in the logic table, and the one that makes a screen feel most current. Slightly cooler in personality than the other three.",
  },
  manrope: {
    name: "Manrope",
    why: "Semi-geometric with subtly squared bowls, which is the closest of the four to the “modern square” idea in the shapes themselves. It has the most confident heavy weight — an 800 headline really lands — and the numerals are the widest and clearest. Slightly more engineered, slightly less cuddly.",
  },
};

export const QUARTZ_TOKENS = {
  "--page": "#FFFFFF", "--surface": "#FFFFFF", "--surface-2": "#F5F4F8",
  "--ink": "#201C2E", "--ink-2": "#4E4860", "--ink-3": "#645E78",
  "--ink-25": "#B4AFC4",
  "--line": "#E4E1EC", "--line-strong": "#948EA6",
  "--accent": "#5B45D6", "--accent-ink": "#4A36B8", "--accent-wash": "#EFECFD",
  "--accent-line": "#D5CDF8", "--accent-ring": "rgba(91,69,214,.22)", "--on-accent": "#FFFFFF",
  "--focus": "#5B45D6",
  "--ok": "#0F6B45", "--ok-wash": "#E7F3ED", "--ok-line": "#BEDCCC",
  "--warn": "#8A5300", "--warn-ink": "#6E4200", "--warn-wash": "#FBF3E4", "--warn-line": "#E9D9B5",
  "--crit": "#A5241C", "--crit-wash": "#FBECEA",
  "--e-1": "0 1px 2px rgba(32,28,46,.05)",
  "--e-2": "0 12px 30px -10px rgba(32,28,46,.26), 0 1px 2px rgba(32,28,46,.07)",
  "--r-sm": "4px", "--r-md": "6px", "--r-lg": "8px", "--r-pill": "6px",
  "--ui-size": "15px", "--h1-size": "29px",
  "--rail-w": "224px", "--rail-pad": "16px 10px",
  "--rail-bg": "#FFFFFF", "--rail-line": "#E4E1EC", "--rail-ink": "#4E4860",
  "--rail-ink-strong": "#201C2E", "--rail-hover": "#F5F4F8",
  "--rail-active-bg": "#EFECFD", "--rail-active-ink": "#4A36B8", "--rail-brand-ink": "#201C2E",
  "--nav-pad": "9px 12px", "--nav-r": "6px", "--nav-size": "14px",
  "--page-pad": "28px 30px 38px", "--page-pad-x": "30px",
  "--page-gap": "18px", "--flow-pad": "28px 30px 42px",
  "--btn-pad": "9px 17px", "--btn-pad-sm": "6px 12px", "--btn-r": "6px", "--btn-size": "14px",
  "--card-line": "#E4E1EC", "--card-r": "8px", "--card-pad": "18px", "--card-shadow": "none",
  "--art-mute": "#EDEBF3", "--art-strong": "#D6D1E4",
  "--stat-bg": "#FFFFFF", "--stat-gap": "12px", "--stat-size": "38px",
  "--row-pad": "11px 0", "--pill-track": ".05em", "--pill-case": "uppercase",
  "--bar-bg": "#E9E6F0", "--bar-r": "3px 3px 0 0",
  "--input-pad": "9px 12px", "--input-r": "6px", "--input-bg": "#FFFFFF",
  "--stepper-pad": "12px 22px", "--stepper-bg": "#FFFFFF", "--steps-gap": "40px", "--step-r": "5px",
  "--tip-pad": "12px 14px", "--tip-bg": "#F5F4F8", "--tip-line": "#E4E1EC",
  "--seg-gap": "2px", "--seg-pad": "3px", "--seg-bg": "#F1EFF6", "--seg-r": "7px", "--seg-line": "#E4E1EC",
  "--seg-btn-r": "5px", "--seg-on-bg": "#FFFFFF", "--seg-on-ink": "#201C2E", "--seg-on-line": "#DCD8E7",
  "--seg-on-shadow": "0 1px 1px rgba(32,28,46,.07)",
  "--pick-gap": "5px", "--pick-pad": "11px 13px", "--pick-r": "6px",
  "--pick-on-line": "#5B45D6", "--pick-on-bg": "#F4F2FE", "--check-r": "4px",
  "--table-size": "13.5px", "--th-pad": "9px 14px", "--th-bg": "#F5F4F8", "--td-pad": "10px 14px",
  "--group-rule": "1.5px solid #CFCADD", "--qcell-bg": "#FBFAFD",
  "--tag-a-bg": "#F2F1F6", "--tag-a-ink": "#453F58", "--tag-a-line": "#E1DEEA",
  "--tag-b-bg": "#F2F1F6", "--tag-b-ink": "#453F58", "--tag-b-line": "#E1DEEA",
  "--tag-none-style": "normal",
  "--q-bg": "#FFFFFF", "--q-ink": "#201C2E", "--q-mute": "#645E78", "--q-card": "#FFFFFF",
  "--q-line": "#E4E1EC", "--q-r": "8px", "--q-btn-r": "6px",
  "--q-cta-bg": "#201C2E", "--q-cta-ink": "#FFFFFF",
  "--q-ribbon-bg": "#5B45D6", "--q-ribbon-ink": "#FFFFFF",
  "--q-art-a": "#3A2E70", "--q-art-b": "#7B6BD0", "--q-art-c": "#D6CFF0",
};

export const QUARTZ_DARK = {
  "--page": "#121019", "--surface": "#191621", "--surface-2": "#201C2B",
  "--ink": "#EFECF5", "--ink-2": "#B7B1C6", "--ink-3": "#928CA4", "--ink-25": "#6E6884",
  "--line": "#2A2536", "--line-strong": "#544D66",
  "--accent": "#9885F5", "--accent-ink": "#B6A8FA", "--accent-wash": "#241D45",
  "--accent-line": "#3B3070", "--accent-ring": "rgba(152,133,245,.28)", "--on-accent": "#15102B",
  "--focus": "#9885F5",
  "--ok": "#54C08D", "--ok-wash": "#0F2720", "--ok-line": "#204739",
  "--warn": "#DEA65F", "--warn-ink": "#E8B879", "--warn-wash": "#2B2114", "--warn-line": "#4A3A21",
  "--crit": "#F08A80", "--crit-wash": "#2C1615",
  "--rail-bg": "#121019", "--rail-line": "#241F2F", "--rail-ink": "#B7B1C6",
  "--rail-ink-strong": "#EFECF5", "--rail-hover": "#1D1927",
  "--rail-active-bg": "#241D45", "--rail-active-ink": "#B6A8FA", "--rail-brand-ink": "#EFECF5",
  "--card-line": "#2A2536", "--stat-bg": "#191621", "--input-bg": "#191621",
  "--stepper-bg": "#191621", "--th-bg": "#201C2B", "--qcell-bg": "#15121C",
  "--tip-bg": "#201C2B", "--tip-line": "#2A2536",
  "--seg-bg": "#201C2B", "--seg-line": "#2A2536", "--seg-on-bg": "#2C2639", "--seg-on-ink": "#EFECF5",
  "--seg-on-line": "#372F46", "--pick-on-bg": "#221B41", "--pick-on-line": "#9885F5",
  "--bar-bg": "#2A2536", "--art-mute": "#221D2E", "--art-strong": "#382F49",
  "--group-rule": "1.5px solid #3B3349",
  "--tag-a-bg": "#201C2B", "--tag-a-ink": "#B7B1C6", "--tag-a-line": "#2B2537",
  "--tag-b-bg": "#201C2B", "--tag-b-ink": "#B7B1C6", "--tag-b-line": "#2B2537",
  "--e-1": "0 1px 2px rgba(0,0,0,.5)",
  "--e-2": "0 14px 34px -10px rgba(0,0,0,.78), 0 1px 2px rgba(0,0,0,.6)",
  "--q-bg": "#191621", "--q-ink": "#EFECF5", "--q-mute": "#928CA4",
  "--q-card": "#201C2B", "--q-line": "#2A2536", "--q-cta-bg": "#EFECF5", "--q-cta-ink": "#121019",
  "--q-ribbon-bg": "#9885F5", "--q-ribbon-ink": "#15102B",
};

export const QUARTZ_CSS = MELD_CSS + String.raw`
/* Quartz: the violet is spent on action, selection and focus. Everything that
   only wants to look important stays in the grey ladder. */
.frame { border-radius: 4px; }
.btn-primary { box-shadow: none; }
.role.is-decider { background: var(--accent-wash); border-color: var(--accent-line); color: var(--accent-ink); }
.tag.is-col { background: var(--surface-2); color: var(--ink-2); border-color: var(--line); }
.chip { background: var(--surface-2); color: var(--ink-2); border-color: var(--line); }
.tip .btn-primary { background: var(--surface); color: var(--accent-ink); border-color: var(--accent); }
.tip .btn-primary:hover { background: var(--accent-wash); }
.tip-mark { color: var(--accent); }
`;

export const QUARTZ_COLOR = {
  colorNote: "Identical in all four. Two greys, one violet, three states.",
  colorLede:
    "This is the Quartz palette unchanged — the layout studies do not touch it. The neutrals are pulled slightly warm and slightly violet, the same bias as the accent, so the greys read as chosen and the product still feels purple even on screens with no purple on them. <strong>The violet is deepened one step</strong> from today's #6D5AE6 so white on a button clears AA.",
  swatches: [
    ["Paper", "#FFFFFF", "Page and card. The border does the separating.", ""],
    ["Wash", "#F5F4F8", "Table heads, segment tracks, the one inset tone.", ""],
    ["Ink", "#201C2E", "A violet-black. Headings, figures, values.", ""],
    ["Ink 2", "#4E4860", "Body copy and secondary UI text.", ""],
    ["Ink 3", "#645E78", "Meta, counts, labels. 5.6:1 — muted, still easy.", ""],
    ["Hairline", "#E4E1EC", "Row and card separators.", ""],
    ["Control edge", "#948EA6", "Input, checkbox and outline-button borders.", ""],
    ["Violet", "#5B45D6", "The one accent. Action, selection, focus.", ""],
    ["Violet ink", "#4A36B8", "Accent text and links — the darker step.", ""],
    ["Violet wash", "#EFECFD", "Selected rows, active nav, chips.", ""],
    ["Live", "#0F6B45", "Published state only.", ""],
    ["Attention", "#8A5300", "Needs a decision. Never decorative.", ""],
  ],
  contrastPairs: [
    ["Ink on paper", "--ink", "--page", 4.5, "1.4.3 AA body text"],
    ["Ink 2 on paper", "--ink-2", "--page", 4.5, "1.4.3 AA body text"],
    ["Ink 3 on wash", "--ink-3", "--surface-2", 4.5, "1.4.3 AA — muted text is still text"],
    ["White on violet", "#FFFFFF", "--accent", 4.5, "1.4.3 AA — primary button label"],
    ["Violet ink on wash", "--accent-ink", "--accent-wash", 4.5, "1.4.3 AA — selected-row label"],
    ["Control edge on paper", "--line-strong", "--page", 3, "1.4.11 non-text — input borders"],
    ["Live on live wash", "--ok", "--ok-wash", 4.5, "1.4.3 AA — status pill"],
    ["Attention on wash", "--warn", "--warn-wash", 4.5, "1.4.3 AA — inline warning"],
  ],
  colorRules: [
    "<b>Three uses, then stop.</b> Violet marks the primary action, the current selection and the focused field. Counting them on a screen should take one second.",
    "<b>Pastel stat cards are gone.</b> Four tiles in four pastels made you read all four to find the one that changed. One tone, big figures, and the number does the talking.",
    "<b>State colour is not brand colour.</b> Green live, amber decide, red destroy — never as a fill, never in a chart.",
    "<b>Two border weights.</b> A hairline separates rows; a 3:1 edge belongs to anything you can click or type into. That difference is a WCAG requirement, not a preference.",
    "<b>The editor stands down.</b> Inside the builder the accent is re-pointed at the ink ladder — selection, focus and the primary action all go neutral — so the merchant's own design is the only saturated thing on the screen. This is a token swap on one surface, not a second theme.",
  ],
};

export const quartzType = (faceKey) => {
  const F = FACE[faceKey];
  return {
    typeNote: "Four faces ship in this file — use the switcher at the top to swap them on any layout.",
    displayName: FACE_COPY[faceKey].name,
    displayWhy: FACE_COPY[faceKey].why,
    numRole: "Figures &amp; labels — same family",
    numName: "Tabular figures",
    numWhy: FIGURES_WHY,
    ramp: meldRamp(F),
    scaleRows: MELD_SCALE,
  };
};

export { FIGTREE_WHY };
