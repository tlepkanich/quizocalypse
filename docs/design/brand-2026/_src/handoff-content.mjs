/* Content that exists ONLY in the handoff: the token map the dev implements
   against, the component states the mocks cannot show at rest, and the
   decision log. Everything else in the handoff is composed from the same
   source as the mocks, so the two cannot drift. */

/* ── The 99 --qz-* tokens, grouped by what they answer ────────────────
   Shape: [token, value, whatItIs, callSites]. `callSites` is the count in
   the current admin sheet, so the dev can size each swap before starting. */
export const TOKEN_MAP = [
  [
    "Ground &amp; surface",
    [
      [
        "--qz-paper",
        "#FFFFFF",
        "#FFFFFF",
        "The page. Unchanged &mdash; white stays the ground.",
        128
      ],
      [
        "--qz-cream",
        "#FFFFFF",
        "#FFFFFF",
        "Was already white. Fold into --qz-paper.",
        19
      ],
      [
        "--qz-cream-2",
        "#F2F1F5",
        "#F5F4F8",
        "Recesses and hover. The violet bias is the only change.",
        66
      ],
      [
        "--qz-rule-2",
        "#F1EFF6",
        "#F5F4F8",
        "Duplicate of cream-2 at a different value. Collapse the two.",
        19
      ]
    ]
  ],
  [
    "Ink",
    [
      [
        "--qz-ink",
        "#2E2740",
        "#201C2E",
        "Body and headings.",
        74
      ],
      [
        "--qz-ink-2",
        "#2E2740",
        "#201C2E",
        "Identical to --qz-ink today. Either give it 4E4860 or retire it.",
        24
      ],
      [
        "--qz-ink-3",
        "#5A5470",
        "#4E4860",
        "Secondary copy.",
        133
      ],
      [
        "--qz-ink-4",
        "#7C7791",
        "#645E78",
        "Meta and captions &mdash; the floor for text.",
        55
      ],
      [
        "--qz-ink-25",
        "#B6B0C8",
        "#B4AFC4",
        "Decoration ONLY &mdash; never text a user must read.",
        17
      ]
    ]
  ],
  [
    "Line",
    [
      [
        "--qz-rule",
        "#E9E7EF",
        "#E4E1EC",
        "Hairlines. Separation, not a boundary.",
        143
      ]
    ]
  ],
  [
    "Accent",
    [
      [
        "--qz-accent",
        "#6D5AE6",
        "#5B45D6",
        "One accent. Ratio shown is white ON it.",
        167
      ],
      [
        "--qz-accent-ink",
        "#3C3489",
        "#4A36B8",
        "Accent AS TEXT. The accent itself fails at body size.",
        28
      ],
      [
        "--qz-accent-wash",
        "#EDEBFC",
        "#EFECFD",
        "Accent-tinted fills.",
        36
      ],
      [
        "--qz-accent-tint",
        "color-mix(in srgb, var(--qz-accent) 10%, var(--qz-paper))",
        "#EFECFD",
        "Second wash at a near-identical value. Collapse into accent-wash.",
        17
      ]
    ]
  ],
  [
    "Status",
    [
      [
        "--qz-ok",
        "#158A5A",
        "#0F6B45",
        "Success / live / published.",
        24
      ],
      [
        "--qz-warn",
        "#B04A2E",
        "#8A5300",
        "Needs attention, not broken.",
        26
      ],
      [
        "--qz-crit",
        "#C53B32",
        "#A5241C",
        "Blocking.",
        27
      ]
    ]
  ],
  [
    "Shape",
    [
      [
        "--qz-radius-pill",
        "999px",
        "6px",
        "Was 999px. This single row is most of why the admin reads young.",
        35
      ],
      [
        "--qz-radius",
        "20px",
        "6px",
        "Buttons, inputs, nav. The default.",
        30
      ]
    ]
  ],
  [
    "Depth &amp; motion",
    [
      [
        "--qz-lift-1",
        "0 0 0 1px rgba(120, 110, 150, 0.06), 0 6px 18px rgba(120, 110, 150, 0.13)",
        "0 1px 2px rgba(32,28,46,.05)",
        "Resting cards.",
        31
      ],
      [
        "--qz-lift-2",
        "0 0 0 1px rgba(120, 110, 150, 0.07), 0 12px 30px rgba(120, 110, 150, 0.16)",
        "0 12px 30px -10px rgba(32,28,46,.26)",
        "Floating: popovers, drawers, preview.",
        12
      ]
    ]
  ],
  [
    "Type",
    [
      [
        "--qz-font-display",
        "\"Quicksand\", \"Mona Sans\", \"Mona Sans Fallback\", -apple-system, \"Segoe UI\", \"Helvetica Neue\", sans-serif",
        "Figtree",
        "One family for everything.",
        13
      ],
      [
        "--qz-font-mono",
        "\"JetBrains Mono\", ui-monospace, monospace",
        "&mdash; remove",
        "The typewriter look. Open decision 3.",
        16
      ]
    ]
  ],
  [
    "Open decisions live here",
    [
      [
        "--qz-gold",
        "#8C6D1F",
        "&mdash;",
        "Open decision 1. Quartz has one accent and no gold.",
        10
      ],
      [
        "--qz-priority",
        "#D4537E",
        "&mdash;",
        "A second saturated hue. Same question as the gold.",
        5
      ]
    ]
  ]
];

/* Measured, not estimated: 117 --qz-* tokens are defined across
   app/styles/quizocalypse.css and quiz-runtime.css with 1,583 var()
   references between them. The 24 rows above carry 1,155 of those — 72% of
   every call site in the product — which is why this is a value swap and
   not a rewrite. */
export const TOKEN_STATS = { defined: 117, referenced: 113, sites: 1583, mapped: 1155, dead: 17 };

/* Things the count turned up that are not colour choices at all. */
export const TOKEN_TRAPS = [
  ["--qz-color-primary is referenced 31 times and never defined.",
   "Every one of those sites falls back to a hardcoded literal — <code>#5563de</code> in two places, <code>#111</code> in another. They will NOT move when the accent changes, so a swap that looks complete will leave 31 sites painting the old blue. Define it as an alias of <code>--qz-accent</code> and delete the fallbacks."],
  ["--qz-ink and --qz-ink-2 hold the same value today (#2E2740).",
   "So the ladder is really four steps wearing five names, and any screen using ink-2 for &ldquo;secondary&rdquo; has no visible hierarchy. Either give ink-2 its own step or retire it — do not swap it blind."],
  ["--qz-cream is #FFFFFF, identical to --qz-paper; --qz-rule-2 and --qz-cream-2 are two names for the same near-white.",
   "Three names for two surfaces. Collapsing them is a prerequisite for the surface ladder to mean anything."],
  ["Two tokens in the sheet today fail WCAG AA as body text.",
   "<code>--qz-ink-4</code> is 4.28:1 across <b>55 call sites</b> and <code>--qz-ok</code> is 4.36:1 across <b>24</b> — both under the 4.5:1 minimum. <code>--qz-warn</code> (5.43:1) and <code>--qz-crit</code> (5.19:1) do pass, but with little headroom. The Quartz values clear all four. This is a correctness fix that happens to arrive with a visual one."],
  ["17 tokens are defined and never referenced.",
   "<code>--qz-stage</code>, <code>--qz-graphite</code>, the four <code>--qz-pal-*-wash</code> entries, four spacing steps, two shadows, three z-indexes. Delete them rather than porting them."],
];

/* ── States. The mocks show rest; this is everything else. ──────────── */
export const STATES = [
  ["Button &middot; primary", [
    ["Rest", "--qz-accent fill, white text, 6.43:1"],
    ["Hover", "--qz-accent-ink fill. No lift, no scale."],
    ["Active", "--qz-accent-ink, inset 0 1px 2px rgba(0,0,0,.18)"],
    ["Focus", "3px --qz-accent-ring outside the border. Never removed, never replaced by colour alone."],
    ["Disabled", "--qz-surface-2 fill, --qz-ink-3 text, cursor default. Still 5.6:1 — a disabled control must stay readable."],
    ["Loading", "Label holds its width, a 14px ring replaces the first glyph. The button must not resize."],
  ]],
  ["Input", [
    ["Rest", "1px --qz-rule-strong. 3.14:1 — a hairline at --qz-rule fails §1.4.11 for a control boundary."],
    ["Focus", "border --qz-accent + 3px --qz-accent-ring"],
    ["Error", "border --qz-crit + message below in --qz-crit. Never colour alone — the message is required."],
    ["Disabled", "--qz-surface-2 fill, --qz-ink-3 text"],
  ]],
  ["Row / list item", [
    ["Rest", "transparent on --qz-surface"],
    ["Hover", "--qz-surface-2. On the Home page this is --qz-surface, because the ground is already tinted."],
    ["Selected", "--qz-accent-wash + 1px --qz-accent-line"],
  ]],
  ["Nav item", [
    ["Rest", "--qz-ink-2"],
    ["Hover", "--qz-surface-2 fill, --qz-ink text"],
    ["Active", "--qz-accent-wash fill, --qz-accent-ink text, 3px accent bar on the leading edge"],
  ]],
  ["Preview frame", [
    ["Phone", "390 &times; 745, borderless, solid, 20px radius, soft elevation"],
    ["Desktop", "960 &times; 700 inline band; content column capped at 760 and centred"],
    ["Fit", "z = min(1, availW/w, availH/h), recomputed on resize and on toggle"],
    ["Zoom readout", "Reads the applied --z. Never a hardcoded string."],
  ]],
];

/* ── Decisions. Closed ones are settled; open ones block nothing but
     need an owner call before the sheet can be finished. ────────────── */
export const DECISIONS_CLOSED = [
  ["Typeface", "Figtree, self-hosted OFL, base64-inlined. No CDN dependency.", "2026-08-08"],
  ["Accent", "Violet only. One accent, and it always means &ldquo;you can act here&rdquo;.", "2026-08-08"],
  ["No monospace in the UI", "Figures are Figtree with <code>font-variant-numeric: tabular-nums</code>. Columns still align; nothing reads as a typewriter.", "2026-08-08"],
  ["Layout", "Rail &mdash; 224px labelled nav, dropped to a step bar inside the builder.", "2026-08-08"],
  ["The editor stands down", "Inside the builder the accent tokens re-point at the ink ladder, so our violet never argues with the merchant's brand.", "2026-08-08"],
  ["Phone preview", "Borderless and SOLID. No bezel, no fade. The screen is the object.", "2026-08-09"],
  ["Desktop preview", "The 960 &times; 700 inline band, not the 720 &times; 620 launcher modal.", "2026-08-09"],
  ["Ground", "White everywhere. Home is the single tinted page (--qz-home-ground). A full tinted-ground variant was built and rejected.", "2026-08-09"],
  ["Dark mode", "CUT. No prefers-color-scheme block, no [data-theme] block; each page declares color-scheme: light.", "2026-08-09"],
];

export const DECISIONS_OPEN = [
  ["The gold signature", 22,
   "The gold &#9670; has five canonical moments today (wordmark, recommended template, decider question, loading mark, primary-CTA inline). Quartz has one accent and no gold. Either those five move to violet, or gold survives as a sixth colour and the one-accent rule is dead.",
   "Move them to violet, drop the &#9670; glyph."],
  ["The pastel set", 31,
   "24 call sites plus 7 on the per-template palettes. These drive the four pastel stat cards and the category surfaces. Quartz replaces the stat cards with one tone and a big figure, but the category surfaces still need some way to differ.",
   "Differentiate by shape and label, not hue &mdash; but this is a product call, not a CSS one."],
  ["--qz-font-mono", 35,
   "Cannot be swapped blind. Sites that used mono for ALIGNMENT (counts, prices, ratios, IDs) need <code>tabular-nums</code> added; sites that used it as a LABEL style become Figtree 700 uppercase +.09em. Two different fixes, and someone has to look at all 35.",
   "Split the list before touching any of it."],
  ["The shopper progress bar", 0,
   "Five variants were built (Fraction, Endowed, Segments, Chapters, Countdown) and none is chosen. It appears on every question screen, so it is the last thing blocking a complete spec.",
   "Chapters &mdash; it survives long labels and uneven question counts."],
];

/* ── Frames. The numbers, and where each one comes from. ─────────────── */
export const FRAME_SPEC = [
  ["Phone", 390, 745, "640 &ndash; 844", "mobile",
   "<code>DEVICE_PRESETS.mobile</code>. 844 = iPhone 14/15 viewport, 640 = SE with chrome."],
  ["Inline", 960, 700, "560 &ndash; 780", "desktop",
   "Above the 900 breakpoint, below the 1100 content cap. This is what Desktop shows."],
  ["Modal", 720, 620, "520 &ndash; 680", "mobile",
   "The launcher's own width. Declared, but NOT offered as a preview &mdash; see the note."],
  ["Tablet", 768, 920, "720 &ndash; 1024", "mobile",
   "Unchanged. Still below 900, so still mobile tokens."],
];
