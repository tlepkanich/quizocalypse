/* ── V2 — the tinted ground ───────────────────────────────────────────
   V1 is white paper: --page #FFFFFF, and every card is also #FFFFFF, so
   panels are told apart by their 1px border alone. V2 makes the page a
   tinted violet and lets white cards lift off it, which is the shift the
   home screen already made on its own.

   The whole elevation ladder has to move together. --surface-2 is used as
   a FILL 49 times — hover states, wells, the editor canvas, the table head
   — so simply painting the page with --surface-2 would have erased all of
   them into the ground. Each rung is therefore re-cut against the rung it
   actually sits on:

     page      #F3F1F9   the ground; nothing else is this colour
     surface   #FFFFFF   cards, rows, inputs — lift off the ground
     surface-2 #E9E6F2   recesses and hover, cut to read on WHITE cards
                         (that is where they mostly appear) and still to
                         differ from the ground when they sit on it
     line      #DDD8EB   deepened, or a hairline tuned for white would
                         disappear against a tinted page

   Text tokens are unchanged: they were chosen against white, and the
   ground only got darker, so every ratio moves in the safe direction —
   verified at build time, not assumed.
   ──────────────────────────────────────────────────────────────────── */

import { variant } from "./q-variants.mjs";

export const V2_TOKENS = {
  "--page": "#F3F1F9",
  "--surface": "#FFFFFF",
  "--surface-2": "#E9E6F2",
  "--line": "#DDD8EB",
  "--card-line": "#DDD8EB",
  "--rail-line": "#DDD8EB",

  /* The rail stays white so it reads as chrome the page sits beside,
     not as another panel floating on the ground. */
  "--rail-bg": "#FFFFFF",
  "--rail-hover": "#F1EEF8",

  /* These all sat at #F5F4F8 — one step off white. On a tinted ground the
     same value reads as "same as the page", so each is re-cut against the
     surface it actually lives on. */
  "--tip-bg": "#FFFFFF",
  "--tip-line": "#DDD8EB",
  "--th-bg": "#F1EEF8",
  "--seg-bg": "#EDE9F6",
  "--seg-line": "#DDD8EB",
  "--seg-on-line": "#D6D0E6",
  "--qcell-bg": "#FBFAFD",
  "--stepper-bg": "#FFFFFF",

  /* Cards lift, so they earn a shadow the flat-white version did not need. */
  "--card-shadow": "0 1px 2px rgba(32,28,46,.04)",
  "--bar-bg": "#E4E0EF",
  "--tag-a-bg": "#FFFFFF", "--tag-a-line": "#DDD8EB",
  "--tag-b-bg": "#FFFFFF", "--tag-b-line": "#DDD8EB",
  "--art-mute": "#E6E2F0",
};

export const V2_DARK = {
  /* Dark mode already had a tinted ground — it only needs the same
     separation between the page and the panels that sit on it. */
  "--page": "#0F0D16", "--surface": "#191621", "--surface-2": "#242030",
  "--line": "#2E2839", "--card-line": "#2E2839", "--rail-line": "#241F2F",
  "--rail-bg": "#141119", "--rail-hover": "#201C2B",
  "--tip-bg": "#201C2B", "--th-bg": "#201C2B",
  "--seg-bg": "#201C2B", "--seg-line": "#2E2839",
  "--stepper-bg": "#141119", "--card-shadow": "0 1px 2px rgba(0,0,0,.4)",
};

export const railV2 = variant({
  id: "quartz-1-rail-v2", idx: 1, name: "Rail", layout: "rail", face: "figtree",
  title: "Rail · V2",
  thesis:
    "The same layout and the same type, on a tinted ground. White is no longer the page — it is what cards are made of, which is the only thing that changed and it changes how every screen reads.",
  facts: ["Tinted ground #F3F1F9", "Cards lift in white", "Ladder re-cut, 3 rungs", "Rail stays white", "Same type, same accent"],
  ideaNote: "V1 is white paper with hairlines. V2 is a tinted ground with white cards on it.",
  lede:
    "Only the elevation ladder moved. In V1 the page and every card are both <code>#FFFFFF</code>, so a panel is told apart from the page by a single hairline — which works, but makes dense screens read as one continuous sheet. Here the page is a tinted violet and cards stay white, so <strong>grouping is carried by the surface itself</strong> and the hairline becomes a refinement rather than the whole signal. <strong>The catch is that this is not a one-token change.</strong> <code>--surface-2</code> is used as a fill in 49 places — every hover state, the editor canvas, the table head — so painting the page with it would have erased all of them. Each rung is re-cut against the surface it actually sits on.",
  principles: [
    ["Choice 01", "Three rungs, not two", "Ground, card, recess — #F3F1F9, #FFFFFF, #E9E6F2. Nothing shares a value with the thing behind it, which is the rule that makes the ladder work at all."],
    ["Choice 02", "The rail stays white", "It reads as chrome the page sits beside rather than a panel floating on the ground. Tinting it too would flatten the distinction the ground exists to make."],
    ["Choice 03", "Borders deepen with the ground", "A hairline tuned for white vanishes on a tinted page. #E4E1EC becomes #DDD8EB so the refinement still lands."],
  ],
  notes: {
    homeNote: "The state this ground came from — the composer already sat on a tint.",
    recsNote: "Grouping now comes from the surface, so the panels need less border to read.",
    logicNote: "The densest screen, and the one that gains most: the table lifts clear of the page.",
    resultsNote: "A merchant whose brand is white now separates from the ground for free.",
    editorNote: "The stage reads as a distinct object without the accent doing the work.",
  },
  fixes: [
    "Dense screens stop reading as one continuous sheet — grouping is carried by surface, not by hairlines alone.",
    "A merchant whose quiz background is pure white now separates from the page without needing the shadow to do it.",
    "The home screen already sat on a tint; this makes the rest of the product agree with it instead of changing ground at the door.",
  ],
  risks: [
    "Any future component that fills with #FFFFFF and sits inside a white card becomes invisible — the ladder now has to be checked on every addition.",
    "Tinted grounds show banding on cheap panels more readily than flat white.",
    "It is a warmer, softer read overall; if the goal was clinical, V1 is closer to it.",
  ],
});

railV2.tokens = { ...railV2.tokens, ...V2_TOKENS };
railV2.dark = { ...railV2.dark, ...V2_DARK };
railV2.badge = "Rail · V2 · tinted ground";
railV2.docTitle = "Quartz Rail V2 — the tinted ground";
