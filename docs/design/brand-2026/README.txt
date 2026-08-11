WISKR — ADMIN DESIGN HANDOFF
9 August 2026


START HERE
──────────
  wiskr-handoff.html

Open it in any browser. It is the whole specification: type, colour,
the measured token map, component states, the live states the product
enters, the preview frame sizes, and every screen. 18 sections, with a
table of contents at the top.

Every file in this package is self-contained — fonts are base64-inlined
and there are no external requests, so it all works offline and behind a
VPN. Nothing here needs a server.


WHAT TO IMPLEMENT AGAINST
─────────────────────────
  quartz-tokens.css

The token sheet. Maps all the --qz-* names the admin already uses to
their new values. This is a VALUE SWAP, not a rename — the names in the
stylesheet today are the same names afterwards.

Three tokens are new:
  --qz-rule-strong    a 3:1 boundary for controls (there is none today,
                      so inputs currently fail WCAG 1.4.11)
  --qz-phone-r        the phone preview's corner; device geometry, and
                      deliberately not on the --radius scale
  --qz-home-ground    the one tinted page in the product

Read section 06 of the handoff before starting. It lists five findings
from counting the real stylesheets that a row-by-row swap would miss —
including --qz-color-primary, which is referenced 31 times and never
defined, so those sites will NOT move when the accent moves.


REFERENCE
─────────
  reference/quartz-preview-frames.html
      The phone/inline/modal sizing spec in full, with the reasoning and
      the arithmetic. Section 08 of the handoff is the summary; this is
      the long version.

  reference/quartz-1-rail.html
      The working mock set the handoff is composed from. Same screens,
      plus the alternate-typeface switcher used during selection.


ALTERNATES — context, not instructions
──────────────────────────────────────
  alternates/quartz-1-rail-v2.html
      A tinted-violet ground across the whole product. Built, measured,
      and REJECTED — white stays the page, and Home is the only tinted
      surface. Kept because the reasoning is useful if the question
      comes up again.

  alternates/quartz-2-masthead.html
  alternates/quartz-3-canvas.html
  alternates/quartz-4-panes.html
      The same system on three other layouts. Rail was chosen. These
      show what the tokens do when the shell changes.

Eight earlier direction explorations (Ledger, Atrium, Press, Workbench,
Signal, Beacon, Iris, and the first Quartz mix) are NOT in this package.
They were the selection process, not the outcome.


REBUILDING
──────────
  _src/

Every HTML file here is generated, not hand-written. If a value changes,
edit the source and regenerate rather than patching the HTML — the
screens and the spec are composed from the same CSS, which is what stops
them drifting apart.

    node run-q.mjs      the four Quartz layouts
    node handoff.mjs    the handoff document
    node frames.mjs     the preview frames spec
    node run-v2.mjs     the rejected tinted-ground variant

Requires Node 20+. No dependencies to install.


STILL OPEN
──────────
Four decisions need an owner call before this is a complete spec. They
are listed with recommendations in section 18 of the handoff:

  1. The gold signature      10 call sites
  2. The pastel set          19 call sites
  3. --qz-font-mono          16 call sites
  4. The shopper progress bar   five variants built, none chosen

None of them blocks starting. Three are counting exercises rather than
design questions.
