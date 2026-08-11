// Structural CSS shared by all five directions. Every value routes through a
// token, so a direction changes the system by redefining tokens + a personality
// layer — never by re-writing structure.

export const BASE_CSS = String.raw`
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--page);
  color: var(--ink);
  font-family: var(--font-ui);
  font-size: 15px;
  line-height: 1.55;
  font-weight: var(--fw-normal);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
img, svg { display: block; max-width: 100%; }
.mark .eye { fill: var(--mark-eye, var(--page)); }
.mh-mark { --mark-eye: var(--page); }
.brand { --mark-eye: var(--rail-bg); }
.stepper-brand { --mark-eye: var(--stepper-bg); }
button, input, textarea, select { font: inherit; color: inherit; }
button { cursor: pointer; }
h1, h2, h3, h4 { margin: 0; font-family: var(--font-display); text-wrap: balance; }
p { margin: 0; }
ul, ol, dl { margin: 0; padding: 0; list-style: none; }
a { color: inherit; }
code { font-family: var(--font-num); }
.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; border-radius: 2px; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
}

/* ══ Document shell ═════════════════════════════════════════════════ */
.doc { max-width: 1180px; margin: 0 auto; padding: 0 28px 96px; }
.masthead { padding: 72px 0 48px; }
.mh-top { display: flex; align-items: center; gap: 12px; margin-bottom: 40px; }
.mh-mark { display: grid; place-items: center; }
.mh-mark .mark { width: 34px; height: 34px; }
.mh-name { font-family: var(--font-display); font-weight: var(--fw-bold); font-size: 17px; letter-spacing: -0.01em; }
.mh-index { margin-left: auto; font-family: var(--font-num); font-size: 12px; color: var(--ink-3); letter-spacing: .04em; text-transform: uppercase; }
.mh-title { font-size: clamp(40px, 6.5vw, 68px); line-height: 1.02; letter-spacing: -0.03em; font-weight: var(--fw-bold); }
.mh-thesis { margin-top: 20px; max-width: 30em; font-size: 19px; line-height: 1.6; color: var(--ink-2); }
.mh-facts { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 32px; }
.mh-fact {
  font-family: var(--font-num); font-size: 12px; letter-spacing: .02em;
  padding: 7px 12px; border-radius: var(--r-pill);
  background: var(--surface-2); color: var(--ink-2); border: 1px solid var(--line);
}

.sec { padding: 56px 0 0; }
.sec-head { display: flex; align-items: baseline; gap: 14px; margin-bottom: 26px; padding-bottom: 14px; border-bottom: 1px solid var(--line); }
.sec-n { font-family: var(--font-num); font-size: 12px; color: var(--ink-3); letter-spacing: .06em; }
.sec-title { font-size: 26px; letter-spacing: -0.018em; font-weight: var(--fw-bold); }
.sec-note { margin-left: auto; font-size: 13px; color: var(--ink-3); text-align: right; max-width: 34ch; }
.lede { max-width: 66ch; font-size: 16.5px; line-height: 1.65; color: var(--ink-2); margin-bottom: 28px; }
.lede strong { color: var(--ink); font-weight: var(--fw-semi); }
.frame {
  border: 1px solid var(--line); border-radius: var(--r-lg); overflow: hidden;
  background: var(--page); box-shadow: var(--e-1);
}
.frame-cap {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 11px 16px; border-bottom: 1px solid var(--line); background: var(--surface-2);
  font-family: var(--font-num); font-size: 11.5px; letter-spacing: .05em; text-transform: uppercase; color: var(--ink-3);
}
.frame-cap b { color: var(--ink-2); font-weight: var(--fw-semi); }
/* The device toggle is interactive and easy to miss — say so in the caption. */
.cap-cta {
  padding: 3px 8px; border-radius: var(--r-sm); background: var(--accent-wash);
  color: var(--accent-ink); border: 1px solid var(--accent-line); font-weight: var(--fw-semi);
}
.frame-scroll { overflow-x: auto; }
.frame-scroll > .app { min-width: 940px; }
.frame-scroll > .app[data-layout="panes"] { min-width: 1080px; }

/* ══ Typeface switcher ══════════════════════════════════════════════ */
.fontbar {
  position: sticky; top: 0; z-index: 30; display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  padding: 10px 28px; margin: 0 -28px 0; background: color-mix(in srgb, var(--page) 88%, transparent);
  backdrop-filter: blur(10px); border-bottom: 1px solid var(--line);
}
.fontbar-label {
  font-size: 11px; letter-spacing: .09em; text-transform: uppercase; color: var(--ink-3);
  font-weight: var(--fw-semi);
}
.fontbar .seg { flex-wrap: wrap; }
.fontbar-note { margin-left: auto; font-size: 12px; color: var(--ink-3); }
@media (max-width: 720px) {
  .fontbar { padding: 10px 18px; margin: 0 -18px; }
  .fontbar-note { display: none; }
}

/* ══ Principles ═════════════════════════════════════════════════════ */
.principles { display: grid; gap: 18px; grid-template-columns: repeat(3, 1fr); }
.principle { padding: 22px; border-radius: var(--r-md); background: var(--surface); border: 1px solid var(--line); }
.principle h3 { font-size: 16.5px; letter-spacing: -0.01em; font-weight: var(--fw-semi); margin-bottom: 8px; }
.principle p { font-size: 14px; color: var(--ink-2); line-height: 1.6; }
.principle .p-n { display: block; font-family: var(--font-num); font-size: 11px; color: var(--accent-ink); letter-spacing: .08em; text-transform: uppercase; margin-bottom: 12px; }

/* ══ Type specimen ══════════════════════════════════════════════════ */
.spec-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; margin-bottom: 30px; }
.spec-card { padding: 26px; border-radius: var(--r-md); border: 1px solid var(--line); background: var(--surface); }
.spec-role { font-family: var(--font-num); font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-3); }
.spec-name { margin-top: 10px; font-size: 30px; letter-spacing: -0.02em; font-weight: var(--fw-bold); }
.spec-glyphs { margin-top: 14px; font-size: 30px; line-height: 1.3; color: var(--ink-2); word-break: break-word; }
.spec-why { margin-top: 16px; font-size: 14px; color: var(--ink-2); line-height: 1.62; }
.spec-why b { color: var(--ink); font-weight: var(--fw-semi); }
.ramp { display: grid; gap: 4px; margin: 26px 0; }
.ramp-line { display: flex; align-items: baseline; gap: 18px; padding: 9px 0; border-bottom: 1px solid var(--line); }
.ramp-tag { flex: none; width: 92px; font-family: var(--font-num); font-size: 11px; color: var(--ink-3); letter-spacing: .05em; text-transform: uppercase; }
.ramp-txt { flex: 1; letter-spacing: -0.02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* Tables set colour and face explicitly rather than relying on inheritance —
   a quirks-mode page (this file opened straight off disk, with no doctype
   wrapper) does not inherit either into <table>. */
table { color: var(--ink); font-family: var(--font-ui); line-height: 1.5; }
table.spec { width: 100%; border-collapse: collapse; font-size: 13.5px; }
table.spec th, table.spec td { text-align: left; padding: 10px 14px; border-bottom: 1px solid var(--line); vertical-align: top; }
table.spec thead th {
  font-family: var(--font-num); font-size: 11px; letter-spacing: .06em; text-transform: uppercase;
  color: var(--ink-3); font-weight: var(--fw-med); background: var(--surface-2);
}
table.spec tbody th { font-weight: var(--fw-semi); white-space: nowrap; }
table.spec .num { font-family: var(--font-num); font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
table.spec .muted { color: var(--ink-3); }

/* ══ Color ══════════════════════════════════════════════════════════ */
.swatches { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 14px; }
.swatch { margin: 0; }
.swatch-chip { display: block; height: 68px; border-radius: var(--r-md); border: 1px solid var(--line); }
.swatch figcaption { display: grid; gap: 2px; margin-top: 10px; }
.swatch figcaption b { font-size: 13.5px; font-weight: var(--fw-semi); }
.swatch figcaption code { font-size: 11.5px; color: var(--ink-2); font-variant-numeric: tabular-nums; }
.swatch figcaption span { font-size: 12px; color: var(--ink-3); line-height: 1.45; }
/* ══ Label & figure register ════════════════════════════════════════
   No monospace anywhere. Small uppercase labels are set in the interface
   face at 600 with open tracking; numbers use TABULAR figures, so counts
   still line up in a column without a typewriter face doing it. */
.eyebrow, .stat-label, .kit-label, .tile-label, .spec-role, .ramp-tag, .frame-cap,
.mh-index, .sec-n, .pop-head, .sugg-label, .q-eyebrow, .q-alt-head, .ribbon,
.ltable thead th, table.spec thead th, .op, .rule-kind, .role, .bar-day, .autosave,
.preview-note, .mh-fact {
  font-weight: var(--fw-semi);
}
.count, .tally, .tally b, .pick-count, .pick-count b, .facts dd, .stat-value,
.q-price, .q-alt-price, .bar-val, .seg-count, .akey, .ltable .num, table.spec .num,
.pop-meta, .swatch figcaption code, .stat-delta {
  font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1;
}

.contrast { margin-top: 30px; }
.verdict {
  font-family: var(--font-num); font-size: 9.5px; letter-spacing: .06em; text-transform: uppercase;
  padding: 2px 6px; border-radius: var(--r-sm); margin-left: 7px; font-weight: var(--fw-semi);
}
.verdict.is-ok { background: var(--ok-wash); color: var(--ok); }
.verdict.is-no { background: var(--crit-wash); color: var(--crit); }
.rule-list { display: grid; gap: 10px; margin-top: 22px; max-width: 74ch; }
.rule-list li { display: flex; gap: 12px; font-size: 14.5px; color: var(--ink-2); line-height: 1.6; }
.rule-list b { color: var(--ink); font-weight: var(--fw-semi); }
.rule-list .rl-n { flex: none; font-family: var(--font-num); font-size: 11px; color: var(--accent-ink); padding-top: 4px; letter-spacing: .06em; }

/* ══ Shape / space / motion ═════════════════════════════════════════ */
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 16px; }
.tile { padding: 20px; border-radius: var(--r-md); border: 1px solid var(--line); background: var(--surface); }
.tile-label { font-family: var(--font-num); font-size: 11px; letter-spacing: .07em; text-transform: uppercase; color: var(--ink-3); margin-bottom: 14px; }
.tile-demo { display: flex; align-items: flex-end; gap: 10px; height: 62px; margin-bottom: 12px; }
.radii-box { flex: 1; height: 44px; background: var(--accent-wash); border: 1px solid var(--accent); }
.space-bar { background: var(--accent); border-radius: 2px; width: 100%; }
.elev-box { flex: 1; height: 46px; background: var(--surface); border-radius: var(--r-md); border: 1px solid var(--line); }
.tile p { font-size: 13px; color: var(--ink-2); line-height: 1.55; }
.tile code { font-size: 11.5px; color: var(--ink-3); }

/* ══ Component kit ══════════════════════════════════════════════════ */
.kit { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 18px; }
.kit-cell { padding: 20px; border-radius: var(--r-md); border: 1px solid var(--line); background: var(--surface); }
.kit-label { font-family: var(--font-num); font-size: 11px; letter-spacing: .07em; text-transform: uppercase; color: var(--ink-3); margin-bottom: 14px; }
.kit-row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.kit-picks { gap: 8px; }

/* ══ PRODUCT UI — shared structure ══════════════════════════════════ */
.app {
  display: grid; grid-template-columns: var(--rail-w) 1fr;
  background: var(--page); color: var(--ink); min-height: 640px;
  font-size: var(--ui-size);
}
.app-flow { display: block; }

/* Rail */
.rail {
  display: flex; flex-direction: column; gap: 4px;
  padding: var(--rail-pad); background: var(--rail-bg); border-right: 1px solid var(--rail-line);
}
.brand { display: flex; align-items: center; gap: 10px; text-decoration: none; padding: 4px 8px 20px; color: var(--rail-brand-ink); }
.brand .mark { width: 28px; height: 28px; flex: none; }
.brand-name { font-family: var(--font-display); font-weight: var(--fw-bold); font-size: 17px; letter-spacing: -0.015em; }
.nav { display: flex; flex-direction: column; gap: 2px; }
.nav-item {
  display: flex; align-items: center; gap: 11px; text-decoration: none;
  padding: var(--nav-pad); border-radius: var(--nav-r);
  font-size: var(--nav-size); font-weight: var(--fw-med); color: var(--rail-ink);
  transition: background .12s ease, color .12s ease;
}
.nav-item .ico { width: 17px; height: 17px; flex: none; opacity: .85; }
.nav-item:hover { background: var(--rail-hover); color: var(--rail-ink-strong); }
.nav-item.is-active { background: var(--rail-active-bg); color: var(--rail-active-ink); font-weight: var(--fw-semi); }
.nav-item.is-active .ico { opacity: 1; }
.rail-foot { margin-top: auto; padding-top: 14px; border-top: 1px solid var(--rail-line); }
.avatar {
  width: 22px; height: 22px; flex: none; border-radius: var(--r-pill); display: grid; place-items: center;
  background: var(--accent); color: var(--on-accent); font-size: 11px; font-weight: var(--fw-bold);
}

/* ══ Layout shells ══════════════════════════════════════════════════
   Four arrangements of the same chrome. Everything below is structure —
   the palette and type are identical across all four. */

/* — Masthead: horizontal nav, content in a centred column — */
.app[data-layout="masthead"] { display: block; }
.topbar {
  display: flex; align-items: center; gap: 28px;
  padding: 0 26px; height: 58px;
  background: var(--rail-bg); border-bottom: 1px solid var(--rail-line);
}
.topbar .brand { padding: 0; margin-right: 4px; }
.topnav { display: flex; align-items: center; gap: 2px; flex: 1; min-width: 0; }
.topnav-item {
  padding: 7px 12px; border-radius: var(--nav-r); text-decoration: none;
  font-size: var(--nav-size); font-weight: var(--fw-med); color: var(--rail-ink); white-space: nowrap;
}
.topnav-item:hover { background: var(--rail-hover); color: var(--rail-ink-strong); }
.topnav-item.is-active { color: var(--accent-ink); font-weight: var(--fw-semi); position: relative; }
.topnav-item.is-active::after {
  content: ""; position: absolute; left: 12px; right: 12px; bottom: -18px; height: 2px; background: var(--accent);
}
.topbar-end { display: flex; align-items: center; gap: 10px; flex: none; }
.topbar-end .nav-item { padding: 4px; }
.app[data-layout="masthead"] .page { max-width: 1060px; margin: 0 auto; }
.app[data-layout="masthead"] .stepper { justify-content: center; }
.app[data-layout="masthead"] .stepper-brand { display: none; }
.app[data-layout="masthead"] .steps { flex: none; }
.app[data-layout="masthead"] .stepper-actions { position: absolute; right: 26px; }
.app[data-layout="masthead"] .stepper { position: relative; }

/* — Canvas: icon rail, content as one continuous sheet — */
.app[data-layout="canvas"] { grid-template-columns: 60px 1fr; background: var(--surface-2); }
.rail-icons { align-items: center; padding: 14px 8px; }
.rail-icons .brand { padding: 4px 0 18px; }
.rail-icons .nav-item { justify-content: center; padding: 9px; width: 40px; }
.rail-icons .nav-item span:not(.avatar) { display: none; }
.rail-icons .nav-item.is-active::before { display: none; }
.rail-icons .nav-item.is-active { background: var(--rail-active-bg); }
.app[data-layout="canvas"] .main { background: var(--surface-2); padding: 14px 14px 14px 0; }
.sheet {
  background: var(--surface); border: 1px solid var(--card-line); border-radius: var(--r-lg);
  min-height: calc(100% - 0px); overflow: hidden; box-shadow: var(--e-1);
}
.app[data-layout="canvas"] .card {
  border: 0; border-radius: 0; box-shadow: none;
  border-top: 1px solid var(--line); padding-top: 4px;
}
.app[data-layout="canvas"] .stats { gap: 0; }
.app[data-layout="canvas"] .stat {
  border: 0; border-right: 1px solid var(--line); border-radius: 0;
  box-shadow: none; padding: 4px 22px 0;
}
.app[data-layout="canvas"] .stats .stat:first-child { padding-left: 0; }
.app[data-layout="canvas"] .stats .stat:last-child { border-right: 0; padding-right: 0; }
.app[data-layout="canvas"] .stepper { border-bottom: 1px solid var(--line); }
.app[data-layout="canvas"] .stepper-brand { display: none; }
.app[data-layout="canvas"] .cols, .app[data-layout="canvas"] .two-up { gap: 0; }
.app[data-layout="canvas"] .cols > .card + .card,
.app[data-layout="canvas"] .two-up > * + * { border-left: 1px solid var(--line); }
.app[data-layout="canvas"] .page { gap: 0; padding-left: 0; padding-right: 0; }
.app[data-layout="canvas"] .hero, .app[data-layout="canvas"] .stats,
.app[data-layout="canvas"] .step-head, .app[data-layout="canvas"] .tip,
.app[data-layout="canvas"] .edit, .app[data-layout="canvas"] .preview,
.app[data-layout="canvas"] .popover { margin: 0 var(--page-pad-x); }
.app[data-layout="canvas"] .hero { padding-bottom: 26px; }
.app[data-layout="canvas"] .stats { padding-bottom: 26px; border-bottom: 1px solid var(--line); }
.app[data-layout="canvas"] .split { padding-left: 0; padding-right: 0; }

/* — Panes: rail + a context pane + the work area — */
.app[data-layout="panes"] { grid-template-columns: var(--rail-w) 258px 1fr; }
.pane {
  display: flex; flex-direction: column; gap: 6px; min-width: 0;
  padding: 18px 14px; background: var(--surface-2); border-right: 1px solid var(--line);
}
.pane-title {
  font-size: 11px; letter-spacing: .09em; text-transform: uppercase; color: var(--ink-3);
  font-weight: var(--fw-semi); padding: 10px 8px 6px;
}
.pane-list { display: grid; gap: 1px; margin-bottom: 8px; }
.pane-item {
  display: flex; align-items: center; gap: 9px; padding: 8px 9px;
  border-radius: var(--nav-r); font-size: 13.5px; color: var(--ink-2); cursor: default;
}
.pane-item:hover { background: var(--surface); }
.pane-item.is-on { background: var(--surface); color: var(--ink); font-weight: var(--fw-semi); box-shadow: inset 0 0 0 1px var(--line); }
.pane-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pane-name b { color: var(--ink); font-weight: var(--fw-semi); font-variant-numeric: tabular-nums; }
.dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.dot.is-live { background: var(--ok); } .dot.is-draft { background: var(--ink-25, var(--line-strong)); }
.dot.is-setup { background: var(--accent); }
.pane-foot { margin-top: auto; display: grid; gap: 6px; padding-top: 14px; }
.vsteps { display: grid; gap: 2px; }
.vstep { display: flex; align-items: flex-start; gap: 10px; padding: 10px 9px; border-radius: var(--nav-r); }
.vstep.is-current { background: var(--accent-wash); }
.vstep.is-done .step-num { background: var(--ok-wash); border-color: var(--ok-line); color: var(--ok); }
.vstep.is-current .step-num { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.vstep-main { display: grid; gap: 2px; min-width: 0; }
.vstep.is-current .step-name { color: var(--ink); font-weight: var(--fw-semi); }
.vstep.is-done .step-name { color: var(--ink-2); }
.vstep-hint { font-size: 11.5px; color: var(--ink-3); }
.app[data-layout="panes"] .stepper { display: none; }
.app[data-layout="panes"] .page { padding: 22px 24px 32px; }

/* Main */
.main { min-width: 0; background: var(--page); }
.page { padding: var(--page-pad); display: grid; gap: var(--page-gap); }
.page-narrow { max-width: 1000px; margin: 0 auto; }

/* Type roles inside the product UI */
.eyebrow { font-family: var(--font-num); font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-3); }
.hero-title, .step-title { font-size: var(--h1-size); line-height: 1.12; letter-spacing: -0.025em; font-weight: var(--fw-bold); }
.hero-sub, .step-sub { margin-top: 10px; font-size: 15px; line-height: 1.6; color: var(--ink-2); max-width: 52ch; }
.card-title { font-size: 16px; letter-spacing: -0.01em; font-weight: var(--fw-semi); }
.card-meta { font-size: 12.5px; color: var(--ink-3); }

/* Buttons */
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  padding: var(--btn-pad); border-radius: var(--btn-r); border: 1px solid transparent;
  font-size: var(--btn-size); font-weight: var(--fw-semi); letter-spacing: var(--btn-track);
  transition: background .13s ease, border-color .13s ease, color .13s ease, box-shadow .13s ease, transform .13s ease;
  white-space: nowrap;
}
.btn-primary { background: var(--accent); color: var(--on-accent); box-shadow: var(--btn-shadow); }
.btn-primary:hover { background: var(--accent-ink); }
.btn-primary[disabled] { background: var(--surface-2); color: var(--ink-3); border-color: var(--line); box-shadow: none; cursor: not-allowed; }
.btn-quiet { background: var(--surface); color: var(--ink); border-color: var(--line-strong); }
.btn-quiet:hover { background: var(--surface-2); }
.btn-ghost { background: transparent; color: var(--ink-2); }
.btn-ghost:hover { background: var(--surface-2); color: var(--ink); }
.btn-small { padding: var(--btn-pad-sm); font-size: 12.5px; }
.btn-block { width: 100%; }
.icon-btn {
  width: 26px; height: 26px; flex: none; display: grid; place-items: center;
  border: 0; background: transparent; color: var(--ink-3); border-radius: var(--r-sm); font-size: 16px; line-height: 1;
}
.icon-btn:hover { background: var(--surface-2); color: var(--ink); }
.link { font-size: 13px; font-weight: var(--fw-semi); color: var(--accent-ink); text-decoration: none; }
.link:hover { text-decoration: underline; text-underline-offset: 3px; }

/* Cards */
.card {
  background: var(--surface); border: 1px solid var(--card-line); border-radius: var(--card-r);
  box-shadow: var(--card-shadow); min-width: 0;
}
.card-head { display: flex; align-items: center; gap: 12px; padding: var(--card-pad); padding-bottom: 0; }
.card-head .btn, .card-head .link, .card-head .tally, .card-head .card-meta:last-child { margin-left: auto; }
.card-head .card-meta { flex: 1; min-width: 0; }
.block .card-head { padding-bottom: var(--card-pad); border-bottom: 1px solid var(--line); }

/* Hero */
.hero { display: grid; grid-template-columns: 1.35fr .65fr; gap: 34px; align-items: center; }
.hero-copy { min-width: 0; }
.hero-field { margin-top: 20px; max-width: 34em; }
.hero-actions { display: flex; gap: 10px; margin-top: 16px; }
.hero-art { display: grid; place-items: center; }
.art-card {
  width: 100%; max-width: 240px; display: grid; gap: 9px; padding: 18px;
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--card-r); box-shadow: var(--e-2);
}
.art-line { display: block; height: 8px; border-radius: 4px; background: var(--art-mute); }
.art-line-sm { width: 42%; } .art-line-md { width: 64%; } .art-line-lg { width: 88%; height: 11px; background: var(--art-strong); }
.art-opt { display: flex; align-items: center; gap: 9px; padding: 8px 10px; border: 1px solid var(--line); border-radius: var(--r-sm); }
.art-opt.is-picked { border-color: var(--accent); background: var(--accent-wash); }
.art-tick { width: 13px; height: 13px; border-radius: 50%; border: 1.5px solid var(--line-strong); flex: none; }
.art-opt.is-picked .art-tick { border-color: var(--accent); background: var(--accent); }
.art-btn { display: block; height: 26px; border-radius: var(--btn-r); background: var(--accent); }

/* Stats */
.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--stat-gap); }
.stat { padding: var(--card-pad); background: var(--stat-bg); border: 1px solid var(--card-line); border-radius: var(--card-r); box-shadow: var(--card-shadow); position: relative; overflow: hidden; }
.stat-label { font-family: var(--font-num); font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-3); }
.stat-value { margin-top: 6px; font-family: var(--font-stat); font-size: var(--stat-size); line-height: 1; letter-spacing: -0.03em; font-weight: var(--fw-bold); font-variant-numeric: tabular-nums; }
.stat-delta { margin-top: 7px; font-size: 12px; color: var(--ink-3); }
.stat-delta.is-up { color: var(--ok); }
.spark { width: 100%; height: 30px; margin-top: 12px; }
.spark-fill { fill: var(--accent-wash); }
.spark-line { stroke: var(--accent); stroke-width: 1.6; vector-effect: non-scaling-stroke; }
.spark-dot { fill: var(--accent); }

/* Two-column */
.cols { display: grid; grid-template-columns: 1.15fr .85fr; gap: var(--page-gap); align-items: start; }

/* Lists */
.list { display: grid; }
.row { display: flex; align-items: center; gap: 14px; padding: var(--row-pad); border-top: 1px solid var(--line); }
.list .row:first-child { border-top: 0; }
.row-main { display: grid; gap: 2px; min-width: 0; flex: 1; }
.row-name { font-size: 14px; font-weight: var(--fw-semi); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row-meta { font-size: 12px; color: var(--ink-3); }
.list { padding: 0 var(--card-pad) var(--card-pad); }
.card-head + .list { padding-top: 10px; }

.pill {
  flex: none; padding: 4px 10px; border-radius: var(--pill-r); font-size: 11.5px; font-weight: var(--fw-semi);
  letter-spacing: var(--pill-track); text-transform: var(--pill-case); border: 1px solid transparent; white-space: nowrap;
}
.pill.is-live { background: var(--ok-wash); color: var(--ok); border-color: var(--ok-line); }
.pill.is-draft { background: var(--surface-2); color: var(--ink-3); border-color: var(--line); }
.pill.is-setup { background: var(--accent-wash); color: var(--accent-ink); border-color: var(--accent-line); }
.pill.is-warn { background: var(--warn-wash); color: var(--warn); border-color: var(--warn-line); }

/* Bar chart */
.bars { display: flex; align-items: flex-end; gap: 10px; height: 150px; padding: 18px var(--card-pad) 0; }
.bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 8px; height: 100%; }
.bar { width: 100%; height: var(--h); background: var(--bar-bg); border-radius: var(--bar-r); position: relative; display: flex; justify-content: center; }
.bar-val { position: absolute; top: -17px; font-family: var(--font-num); font-size: 10.5px; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.bar-col:nth-child(6) .bar, .bar-col:nth-child(7) .bar { background: var(--accent); }
.bar-day { font-family: var(--font-num); font-size: 10.5px; color: var(--ink-3); letter-spacing: .03em; }
.card-foot { padding: 14px var(--card-pad) var(--card-pad); font-size: 12.5px; color: var(--ink-3); border-top: 1px solid var(--line); margin-top: 14px; }
.card-foot strong { color: var(--ink-2); font-weight: var(--fw-semi); }

/* Fields */
.field { display: grid; gap: 6px; }
.field-label { font-size: 12.5px; font-weight: var(--fw-semi); color: var(--ink-2); }
.field input, .field textarea {
  width: 100%; padding: var(--input-pad); border-radius: var(--input-r);
  border: 1px solid var(--line-strong); background: var(--input-bg); color: var(--ink);
  font-size: 14px; line-height: 1.5; resize: vertical;
  transition: border-color .13s ease, box-shadow .13s ease;
}
.field input::placeholder, .field textarea::placeholder { color: var(--ink-3); }
.field input:focus, .field textarea:focus { outline: 0; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-ring); }

/* The step bar is out of scope — a quiet strip marks its place only. */
.stepbar-out {
  display: flex; align-items: center; justify-content: center;
  padding: 9px 20px; background: var(--surface-2);
  border-bottom: 1px dashed var(--line-strong);
}
.stepbar-out span {
  font-size: 11.5px; letter-spacing: .06em; text-transform: uppercase;
  color: var(--ink-3); font-weight: var(--fw-semi);
}

.main-flow .page { padding: var(--flow-pad); }

.step-head { max-width: 60ch; }
.step-head .eyebrow { margin-bottom: 10px; }

/* Tip */
.tip {
  display: flex; align-items: center; gap: 12px; padding: var(--tip-pad);
  border-radius: var(--r-md); background: var(--tip-bg); border: 1px solid var(--tip-line);
}
.tip-mark { flex: none; color: var(--accent); font-size: 13px; }
.tip-copy { flex: 1; font-size: 13.5px; color: var(--ink-2); line-height: 1.5; }
.tip-copy strong { color: var(--ink); font-weight: var(--fw-semi); }

/* The AI result banner — neutral band, green tick. Green stays a STATE
   colour (this succeeded), it does not become a second brand surface. */
.ai-note {
  display: flex; align-items: flex-start; gap: 13px; padding: 15px 17px;
  border: 1px solid var(--line); border-radius: var(--r-lg); background: var(--surface-2);
}
.ai-check {
  flex: none; width: 22px; height: 22px; display: grid; place-items: center; margin-top: 1px;
  border-radius: var(--r-sm); background: var(--ok-wash); color: var(--ok);
  border: 1px solid var(--ok-line); font-size: 12px; font-weight: var(--fw-bold);
}
.ai-title { font-size: 14.5px; font-weight: var(--fw-semi); }
.ai-body { margin-top: 4px; font-size: 13.5px; line-height: 1.6; color: var(--ink-2); max-width: 78ch; }
.ai-note .btn { margin-left: auto; flex: none; }

/* Picker */
.two-up { display: grid; grid-template-columns: 1.4fr .6fr; gap: var(--page-gap); align-items: start; }
.picker { padding: var(--card-pad); display: grid; gap: 14px; }
.seg { display: inline-flex; gap: var(--seg-gap); padding: var(--seg-pad); background: var(--seg-bg); border-radius: var(--seg-r); border: 1px solid var(--seg-line); }
.seg-btn {
  border: 1px solid transparent; background: transparent; color: var(--ink-3);
  padding: 6px 12px; border-radius: var(--seg-btn-r); font-size: 13px; font-weight: var(--fw-med);
  display: inline-flex; align-items: center; gap: 6px; transition: background .12s ease, color .12s ease;
}
.seg-btn:hover { color: var(--ink); }
.seg-btn.is-on { background: var(--seg-on-bg); color: var(--seg-on-ink); font-weight: var(--fw-semi); border-color: var(--seg-on-line); box-shadow: var(--seg-on-shadow); }
.seg-count { font-family: var(--font-num); font-size: 11px; opacity: .7; font-variant-numeric: tabular-nums; }
.seg-sm .seg-btn { padding: 5px 10px; font-size: 12px; }

.search { display: flex; align-items: center; gap: 9px; padding: var(--input-pad); border: 1px solid var(--line-strong); border-radius: var(--input-r); background: var(--input-bg); }
.search .ico { width: 16px; height: 16px; color: var(--ink-3); flex: none; }
.search input { border: 0; background: transparent; width: 100%; font-size: 14px; }
.search input:focus { outline: 0; }
.search:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-ring); }

.pick-list { display: grid; gap: var(--pick-gap); }
.pick {
  display: flex; align-items: center; gap: 12px; padding: var(--pick-pad);
  border: 1px solid var(--line); border-radius: var(--pick-r); background: var(--surface);
  transition: border-color .12s ease, background .12s ease;
}
.pick:hover { border-color: var(--line-strong); }
.pick.is-on { border-color: var(--pick-on-line); background: var(--pick-on-bg); }
.check { width: 18px; height: 18px; flex: none; border-radius: var(--check-r); border: 1.5px solid var(--line-strong); background: var(--surface); }
.pick.is-on .check { background: var(--accent); border-color: var(--accent); position: relative; }
.pick.is-on .check::after {
  content: ""; position: absolute; inset: 0; margin: auto; width: 5px; height: 9px;
  border: solid var(--on-accent); border-width: 0 2px 2px 0; transform: translateY(-1px) rotate(45deg);
}
.pick-main { flex: 1; display: grid; gap: 1px; min-width: 0; }
.pick-name { font-size: 14px; font-weight: var(--fw-semi); }
.pick-meta { font-size: 11.5px; color: var(--ink-3); }
.pick-count { font-family: var(--font-num); font-size: 12px; color: var(--ink-3); font-variant-numeric: tabular-nums; white-space: nowrap; }
.pick-count b { color: var(--ink-2); font-weight: var(--fw-semi); }

.summary { padding: var(--card-pad); display: grid; gap: 16px; }
.summary .card-head { padding: 0; }
.tally { font-family: var(--font-num); font-size: 12px; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.tally b { color: var(--ink); font-weight: var(--fw-bold); }
.chips { display: flex; flex-wrap: wrap; gap: 7px; }
.chip {
  display: inline-flex; align-items: center; gap: 5px; padding: 5px 6px 5px 10px;
  background: var(--accent-wash); color: var(--accent-ink); border: 1px solid var(--accent-line);
  border-radius: var(--pill-r); font-size: 12px; font-weight: var(--fw-med);
}
.chip-x { border: 0; background: transparent; color: inherit; opacity: .6; font-size: 14px; line-height: 1; padding: 0 3px; }
.chip-x:hover { opacity: 1; }
.facts { display: grid; gap: 0; }
.facts > div { display: flex; justify-content: space-between; gap: 12px; padding: 9px 0; border-bottom: 1px solid var(--line); font-size: 13px; }
.facts dt { color: var(--ink-3); }
.facts dd { margin: 0; font-family: var(--font-num); font-variant-numeric: tabular-nums; color: var(--ink); font-weight: var(--fw-med); }
.note {
  padding: 12px 14px; border-radius: var(--r-sm); font-size: 13px; line-height: 1.55;
  background: var(--warn-wash); color: var(--warn-ink); border: 1px solid var(--warn-line);
}
.note strong { font-weight: var(--fw-semi); }

/* ── Logic ── */
.block { padding: 0; }
.rules { padding: 6px var(--card-pad) var(--card-pad); }
.rule { display: flex; align-items: flex-start; gap: 12px; padding: 11px 0; border-bottom: 1px solid var(--line); }
.rules .rule:last-child { border-bottom: 0; }
.rule-n {
  flex: none; width: 22px; height: 22px; display: grid; place-items: center; border-radius: var(--r-sm);
  font-family: var(--font-num); font-size: 11px; color: var(--ink-3); background: var(--surface-2); border: 1px solid var(--line);
}
.rule-copy { flex: 1; font-size: 14px; line-height: 1.7; color: var(--ink-2); }
.rule-when { color: var(--ink-3); }
.arrow { color: var(--ink-3); padding: 0 3px; }
.ans { font-weight: var(--fw-semi); color: var(--ink); background: var(--surface-2); border: 1px solid var(--line); border-radius: var(--r-sm); padding: 1px 6px; }
.op { font-family: var(--font-num); font-size: 10.5px; text-transform: uppercase; letter-spacing: .07em; color: var(--ink-3); padding: 0 2px; }
.verb { font-weight: var(--fw-semi); }
.verb.is-show { color: var(--ok); }
.verb.is-exclude { color: var(--crit); }
.rule-kind { font-family: var(--font-num); font-size: 10.5px; color: var(--ink-3); }

.table-wrap { overflow-x: auto; }
.ltable { width: 100%; border-collapse: collapse; font-size: var(--table-size); min-width: 780px; }
.ltable thead th {
  position: sticky; top: 0; text-align: left; padding: var(--th-pad); background: var(--th-bg);
  font-family: var(--font-num); font-size: 10.5px; letter-spacing: .07em; text-transform: uppercase;
  color: var(--ink-3); font-weight: var(--fw-med); border-bottom: 1px solid var(--line-strong); white-space: nowrap;
}
.ltable td, .ltable tbody th { padding: var(--td-pad); border-bottom: 1px solid var(--line); vertical-align: middle; text-align: left; }
.qgroup + .qgroup > tr:first-child > * { border-top: var(--group-rule); }
.qgroup > tr:last-child > td, .qgroup > tr:last-child > th { border-bottom: 0; }
/* The rowspan question cell lives in tr:first-child, so the reset above
   cannot reach it — without this the last group leaves a 1px stub under
   the Question column and nowhere else. */
.ltable tbody.qgroup:last-child > tr:first-child > .qcell { border-bottom: 0; }
.ltable .qcell { width: 210px; vertical-align: top; background: var(--qcell-bg); border-right: 1px solid var(--line); }
.qtext { display: block; font-size: 14px; font-weight: var(--fw-semi); line-height: 1.35; margin-bottom: 9px; }
.role {
  display: inline-flex; align-items: center; gap: 6px; padding: 3px 8px; border-radius: var(--pill-r);
  font-family: var(--font-num); font-size: 10.5px; letter-spacing: .05em; text-transform: uppercase;
  border: 1px solid var(--line); background: var(--surface); color: var(--ink-3);
}
.role:hover { border-color: var(--line-strong); color: var(--ink-2); }
.role.is-decider { background: var(--accent-wash); border-color: var(--accent-line); color: var(--accent-ink); font-weight: var(--fw-semi); }
.role { white-space: nowrap; }

/* The attribute is a SEPARATE field under the role, not part of its label.
   Real metafield keys are long and often ugly — custom.fit_profile_primary
   is not something a pill can hold — so it gets its own line, truncates at
   the column edge, and carries the full value in a tooltip. */
.role-stack { display: grid; gap: 5px; justify-items: start; min-width: 0; max-width: 100%; }
/* "Narrows" is the choice; the slot beneath it holds what was chosen.
   Real metafield keys are long, so the slot truncates at the column edge
   and carries the full value in a tooltip. */
/* The chosen attribute. It is a value, not a heading — so it sits quiet:
   the wash, a hairline, normal weight, secondary ink. Only the truncating
   key flexes; the caret keeps its width. */
.attr-slot {
  display: inline-flex; align-items: center; gap: 5px; max-width: 100%; min-width: 0;
  padding: 4px 8px; border-radius: var(--r-sm); border: 1px solid var(--line);
  background: var(--surface-2); color: var(--ink-2); text-align: left;
  font-size: 11.5px; font-weight: var(--fw-normal); letter-spacing: .005em;
}
.attr-slot:hover { border-color: var(--line-strong); background: var(--surface); color: var(--ink); }
.attr-slot > span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.attr-slot .caret { flex: none; font-size: 8px; opacity: .6; }
.attr-x { border: 0; background: transparent; color: var(--ink-3); font-size: 13px; line-height: 1; padding: 0 3px; flex: none; }
.attr-x:hover { color: var(--crit); }
.attr-slot.is-empty {
  padding: 3px 8px; border-style: dashed; border-color: var(--line-strong);
  background: transparent; color: var(--ink-3);
}
.attr-slot.is-empty:hover { border-style: solid; border-color: var(--accent); color: var(--accent-ink); background: var(--accent-wash); }
.role-tag { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
.role-tag .caret { font-size: 8px; opacity: .65; }

/* ── The attribute picker ─────────────────────────────────────────────
   Narrows → this → the chosen key lands in the slot. Coverage is the
   number that actually decides the choice: an attribute only 9 of 23
   products carry will silently drop the other 14 from every result. */
.ap {
  max-width: 620px; border-radius: var(--r-lg); background: var(--surface);
  border: 1px solid var(--line-strong); box-shadow: var(--e-2); overflow: hidden;
  justify-self: start; margin: 20px;
}
.ap-head { display: flex; align-items: flex-start; gap: 14px; padding: 16px 18px 14px; }
.ap-title { font-size: 15.5px; font-weight: var(--fw-semi); }
.ap-sub { margin-top: 4px; font-size: 12.5px; color: var(--ink-3); line-height: 1.5; max-width: 52ch; }
.ap-head .icon-btn { margin-left: auto; }
.ap-search {
  display: flex; align-items: center; gap: 9px; margin: 0 18px 12px;
  padding: var(--input-pad); border: 1px solid var(--line-strong); border-radius: var(--input-r);
}
.ap-search .ico { width: 16px; height: 16px; color: var(--ink-3); flex: none; }
.ap-search input { border: 0; background: transparent; width: 100%; font-size: 13.5px; }
.ap-search input:focus { outline: 0; }
.ap-tabs { margin: 0 18px 10px; }
.ap-list { max-height: 260px; overflow-y: auto; padding: 0 10px 10px; display: grid; gap: 2px; }
.ap-row {
  display: flex; align-items: center; gap: 11px; padding: 9px 10px; border-radius: var(--r-md);
  cursor: default;
}
.ap-row:hover { background: var(--surface-2); }
.ap-row.is-on { background: var(--accent-wash); }
.ap-row.is-on .radio { border-color: var(--accent); background: var(--accent); box-shadow: inset 0 0 0 3px var(--surface); }
.ap-main { flex: 1; min-width: 0; display: grid; gap: 2px; }
.ap-key { font-size: 13.5px; font-weight: var(--fw-semi); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ap-row.is-on .ap-key { color: var(--accent-ink); }
.ap-vals { font-size: 11.5px; color: var(--ink-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ap-kind {
  flex: none; padding: 2px 7px; border-radius: var(--r-sm); font-size: 10.5px; font-weight: var(--fw-semi);
  background: var(--surface-2); color: var(--ink-3); border: 1px solid var(--line);
}
.ap-cov { flex: none; font-size: 12px; color: var(--ink-2); font-variant-numeric: tabular-nums; width: 62px; text-align: right; }
.ap-cov.is-thin { color: var(--warn); font-weight: var(--fw-semi); }
.ap-row.is-thin .ap-key::after {
  content: "low coverage"; margin-left: 8px; padding: 1px 6px; border-radius: var(--r-sm);
  background: var(--warn-wash); color: var(--warn); border: 1px solid var(--warn-line);
  font-size: 10px; font-weight: var(--fw-semi);
}
.ap-foot {
  display: flex; align-items: center; gap: 12px; padding: 12px 18px;
  border-top: 1px solid var(--line); background: var(--surface-2);
}
.ap-note { flex: 1; font-size: 12px; color: var(--ink-3); line-height: 1.5; }
.ap-note b { color: var(--ink-2); font-weight: var(--fw-semi); }
.caret { font-size: 8px; opacity: .7; }
.atext { font-weight: var(--fw-med); }
.akey {
  display: inline-block; width: 18px; margin-right: 10px;
  font-size: 11px; font-weight: var(--fw-semi); color: var(--ink-3);
  font-variant-numeric: tabular-nums;
}
/* The count is a control: it opens the products behind the trigger. */
.count-btn {
  display: inline-flex; align-items: baseline; gap: 5px; padding: 4px 9px; border-radius: var(--r-sm);
  border: 1px solid transparent; background: transparent; color: var(--ink);
  font-size: 14px; font-weight: var(--fw-semi); font-variant-numeric: tabular-nums;
}
.count-btn span { font-size: 11.5px; font-weight: var(--fw-normal); color: var(--ink-3); }
.count-btn:hover { background: var(--accent-wash); border-color: var(--accent-line); color: var(--accent-ink); }
.count-btn:hover span { color: var(--accent-ink); }
.acts { width: 34%; }
.tag {
  display: inline-block; padding: 3px 8px; border-radius: var(--r-sm); font-size: 12px; font-weight: var(--fw-med);
  border: 1px solid transparent; margin: 1px 0;
}
.tag.is-col { background: var(--accent-wash); color: var(--accent-ink); border-color: var(--accent-line); }
.tag.is-a { background: var(--tag-a-bg); color: var(--tag-a-ink); border-color: var(--tag-a-line); }
.tag.is-b { background: var(--tag-b-bg); color: var(--tag-b-ink); border-color: var(--tag-b-line); }
.tag.is-none { background: transparent; color: var(--ink-3); border-color: var(--line); font-style: var(--tag-none-style); }
.ltable .num { text-align: right; white-space: nowrap; }
.count { font-family: var(--font-num); font-size: 12.5px; font-variant-numeric: tabular-nums; color: var(--ink-2); font-weight: var(--fw-med); }
.goto { width: 158px; }
.goto-val { font-size: 12.5px; color: var(--ink-3); display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.goto-val::before { content: "→"; color: var(--line-strong); }

/* Products behind a trigger — opened from the count. Pulled from Shopify
   for whatever the answer maps to (collection, tag, metafield). */
.pp {
  max-width: 720px; border-radius: var(--r-lg); background: var(--surface);
  border: 1px solid var(--line-strong); box-shadow: var(--e-2); overflow: hidden; justify-self: start;
}
.pp-head { display: flex; align-items: flex-start; gap: 14px; padding: 16px 18px; border-bottom: 1px solid var(--line); }
.pp-title { font-size: 15.5px; font-weight: var(--fw-semi); display: flex; align-items: center; gap: 9px; }
.pp-sub { margin-top: 4px; font-size: 12.5px; color: var(--ink-3); }
.pp-sub b { color: var(--ink-2); font-weight: var(--fw-semi); font-variant-numeric: tabular-nums; }
.pp-head .icon-btn { margin-left: auto; }
.pp-grid {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; padding: 16px 18px;
  max-height: 340px; overflow-y: auto;
}
.pp-card { min-width: 0; }
.pp-img {
  aspect-ratio: 1; border-radius: var(--r-md); position: relative; overflow: hidden;
  border: 1px solid var(--line);
}
.pp-img-1 { background: linear-gradient(150deg, var(--q-art-a), var(--q-art-b)); }
.pp-img-2 { background: linear-gradient(150deg, var(--q-art-b), var(--q-art-c)); }
.pp-img-3 { background: linear-gradient(150deg, var(--q-art-c), var(--q-art-a)); }
.pp-img::before {
  content: ""; position: absolute; left: 50%; top: 16%; bottom: 16%; width: 28%;
  transform: translateX(-50%) rotate(-10deg); border-radius: 999px;
  background: linear-gradient(180deg, rgba(255,255,255,.9), rgba(255,255,255,.5));
  box-shadow: 0 6px 16px rgba(0,0,0,.18);
}
.pp-name {
  margin-top: 8px; font-size: 12.5px; font-weight: var(--fw-semi); line-height: 1.35;
  overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
}
.pp-meta { margin-top: 3px; font-size: 11.5px; color: var(--ink-3); display: grid; gap: 3px; font-variant-numeric: tabular-nums; }
.pp-stock { font-size: 10.5px; font-weight: var(--fw-semi); }
.pp-stock.is-ok { color: var(--ok); }
.pp-stock.is-low { color: var(--warn); }
.pp-stock.is-out { color: var(--crit); }
.pp-foot {
  display: flex; align-items: center; gap: 14px; padding: 12px 18px;
  border-top: 1px solid var(--line); background: var(--surface-2); font-size: 12.5px; color: var(--ink-3);
}
.pp-foot b { color: var(--ink-2); font-weight: var(--fw-semi); }
.pp-foot .btn { margin-left: auto; }

/* Popover */
.popover {
  max-width: 330px; padding: 8px; border-radius: var(--r-md); background: var(--surface);
  border: 1px solid var(--line-strong); box-shadow: var(--e-2); justify-self: start;
}
.pop-head { padding: 6px 10px 8px; font-family: var(--font-num); font-size: 10.5px; letter-spacing: .07em; text-transform: uppercase; color: var(--ink-3); }
.pop-list { display: grid; gap: 1px; }
.pop-item { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: var(--r-sm); }
.pop-item.is-on { background: var(--accent-wash); }
.pop-item:not(.is-on):hover { background: var(--surface-2); }
.radio { width: 15px; height: 15px; flex: none; border-radius: 50%; border: 1.5px solid var(--line-strong); }
.pop-item.is-on .radio { border-color: var(--accent); background: var(--accent); box-shadow: inset 0 0 0 3px var(--surface); }
.pop-label { flex: 1; font-size: 13.5px; font-weight: var(--fw-med); }
.pop-item.is-on .pop-label { color: var(--accent-ink); font-weight: var(--fw-semi); }
.pop-meta { font-family: var(--font-num); font-size: 11px; color: var(--ink-3); }
.pop-foot { padding: 10px; margin-top: 6px; border-top: 1px solid var(--line); font-size: 12px; color: var(--ink-3); line-height: 1.5; }

/* Shopper progress — P4 Chapters. Never carries the Wiskr accent; it is
   always the merchant's own colour, because progress is a shopper feeling. */
.pg-phases { display: flex; gap: 10px; }
.pg-phases li { flex: 1; display: grid; gap: 6px; min-width: 0; }
.pg-phases span {
  font-size: 9.5px; letter-spacing: .04em; text-transform: uppercase; font-weight: 700;
  color: var(--q-mute); opacity: .55; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.pg-phases li.is-now span { opacity: 1; color: var(--q-ink); }
.pg-phases i { display: block; height: 5px; border-radius: 3px; background: var(--q-line); overflow: hidden; }
.pg-phases b { display: block; height: 100%; border-radius: 3px; background: var(--q-cta-bg); }

/* ── Results ── */
/* Compact by design: the editing column is capped so fields never stretch
   to the window. A 480px field is already wider than any headline anyone
   writes, and the pair sits centred rather than pinned to the left edge. */
.split {
  grid-template-columns: minmax(0, 460px) minmax(0, 420px);
  gap: 44px; align-items: start; justify-content: center;
  max-width: 960px; margin: 0 auto;
}
/* Switching to Desktop gives the preview the room instead of shrinking it:
   the inline band is 960 wide, so a column sized for a phone would render
   it at barely half scale. */
.split:has(.preview[data-device="desktop"]) {
  grid-template-columns: minmax(0, 340px) minmax(0, 700px);
  gap: 32px; max-width: 1072px;
}
.edit { display: grid; gap: 10px; min-width: 0; }
.progress { display: flex; gap: 4px; margin-bottom: 4px; max-width: 260px; }
.pip { height: 3px; flex: 1; border-radius: 2px; background: var(--line); }
.pip.is-on { background: var(--accent); }
.edit .step-title { margin-top: 3px; font-size: calc(var(--h1-size) - 5px); }
.edit .step-sub { margin-bottom: 4px; font-size: 14px; max-width: 44ch; }
.edit .field-label { margin-bottom: -1px; }
.sugg { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: -3px; }
.sugg-label { font-family: var(--font-num); font-size: 10.5px; letter-spacing: .07em; text-transform: uppercase; color: var(--ink-3); }
.sugg-btn {
  padding: 4px 10px; border-radius: var(--pill-r); border: 1px dashed var(--line-strong);
  background: transparent; color: var(--ink-2); font-size: 12.5px;
}
.sugg-btn:hover { border-style: solid; border-color: var(--accent); color: var(--accent-ink); background: var(--accent-wash); }
.edit-foot { display: flex; align-items: center; gap: 14px; margin-top: 6px; }
.autosave { font-family: var(--font-num); font-size: 11px; color: var(--ok); letter-spacing: .04em; }
.autosave::before { content: "● "; font-size: 8px; vertical-align: 2px; }

/* ── Preview device frames ────────────────────────────────────────────
   Phone renders at TRUE size (390 viewport). The modal is 720 wide — your
   launcher's own max-width — so it is scaled to fit and the zoom is printed,
   which is what every design tool does and what stops a merchant misjudging
   type size. The split re-proportions rather than shrinking the modal into
   a stamp. */
.preview { display: grid; gap: 12px; justify-items: center; min-width: 0; }
.preview-bar { display: flex; align-items: center; gap: 12px; width: 100%; }
.preview .seg, .canvas-bar .seg:first-of-type { box-shadow: 0 0 0 2px var(--accent-wash); }
.dev-zoom {
  margin-left: auto; font-size: 11px; color: var(--ink-3); letter-spacing: .04em;
  font-weight: var(--fw-semi); font-variant-numeric: tabular-nums;
}

/* ══ PREVIEW SIZING — one mechanism, every screen ═════════════════════
   Three intrinsic sizes, and only three, used everywhere:
       phone   390 × 745
       modal   720 × 620
       inline  960 × 700
   .devbox carries the intrinsic size. The frame inside is drawn at that
   exact size and scaled as a whole, so the aspect ratio can never drift.
   The box takes the SCALED size, so nothing beside it is ever overlapped.
   --z is computed at runtime from the space actually available, capped at
   1, which is what makes it "as large as it can be without distorting".
   The phone is borderless; the modal and inline embeds keep their frames. */
.devbox {
  --z: 1; flex: none; overflow: hidden;
  width: calc(var(--w) * var(--z) * 1px);
  height: calc(var(--h) * var(--z) * 1px);
}
.devbox > :first-child {
  width: calc(var(--w) * 1px); height: calc(var(--h) * 1px);
  flex: none; transform: scale(var(--z)); transform-origin: top left;
}
.devbox[data-dev="phone"]  { --w: 390; --h: 745; }
/* The launcher modal is a real embed mode but is no longer a preview the
   builder offers — Desktop means the inline band. Its geometry stays
   declared so a modal preview can be added without re-deriving the size. */
.devbox[data-dev="modal"]  { --w: 720; --h: 620; }
.devbox[data-dev="inline"] { --w: 960; --h: 700; }

/* Sticky so it never leaves the screen while the editor column scrolls. */
.preview { position: sticky; top: 16px; align-self: start; }
.preview[data-device="phone"] .devbox[data-dev="inline"],
.preview[data-device="desktop"] .devbox[data-dev="phone"] { display: none; }

/* ── Inline embed — the merchant's background runs the full width of the
     band and only the CONTENT is capped, exactly as the live runtime
     centres a column inside a full-bleed section. ─────────────────────── */
.embed-frame {
  background: var(--q-bg); color: var(--q-ink);
  display: grid; align-content: center; gap: 16px; padding: 40px 48px;
  font-family: var(--q-font); overflow: hidden;
}
.embed-frame > * { width: 100%; max-width: 760px; margin-inline: auto; }
.embed-frame .q-title { font-size: 30px; }
.embed-frame .q-sub { font-size: 15px; }
/* Hero: image beside its copy, not above it. */
.embed-frame .q-hero { display: grid; grid-template-columns: 1.05fr 1fr; align-items: stretch; }
.embed-frame .q-hero .q-img { aspect-ratio: auto; height: 100%; min-height: 210px; }
.embed-frame .q-body { padding: 20px 22px; align-content: center; gap: 9px; }
.embed-frame .q-name { font-size: 19px; }
.embed-frame .q-alts { grid-template-columns: 1fr 1fr; margin-top: 0; }
.embed-frame .q-alt .q-img { aspect-ratio: 16 / 10; }


/* No device frame. The screen is the object — it runs off the bottom of its
   holder and fades out, which reads as a live surface rather than a photo of
   a handset in a bezel. */
.phone {
  width: 390px; height: 745px; flex: none; padding: 0; border: 0;
  border-radius: 20px 20px 0 0; background: none;
  box-shadow: 0 22px 50px -26px rgba(32,28,46,.30);
}
/* A phone screen is a fixed viewport — 745px, and content that exceeds it
   clips at the fold exactly as it would on the device. min-height let tall
   content stretch the frame, which is how the results preview ended up
   taller than any phone. */
/* The phone alone is borderless — no bezel, no chrome, no outline. It is a
   solid screen with a modern radius, opaque to all four edges. Framed
   embeds (modal, inline) keep their frames; those are real containers. */
.devbox[data-dev="phone"] {
  border-radius: var(--phone-r); overflow: hidden;
  box-shadow: 0 10px 30px -14px rgba(32,28,46,.42), 0 2px 6px -2px rgba(32,28,46,.10);
}
.devbox[data-dev="inline"] {
  border-radius: var(--r-md); overflow: hidden;
  box-shadow: 0 10px 30px -14px rgba(32,28,46,.42), 0 2px 6px -2px rgba(32,28,46,.10);
}
/* The stage the preview stands on. With the bezel gone this recessed panel
   is the ONLY thing separating the merchant's screen from the page — and a
   merchant whose brand is white would otherwise see nothing at all. The
   other preview surfaces (.qedit-stage, .canvas-stage, .ed-canvas) already
   carry this ground; the results aside was the one that did not. */
.preview {
  background: var(--surface-2); border: 1px solid var(--line);
  border-radius: var(--r-lg); padding: 12px 12px 16px;
}
/* ONE .phone-screen rule. It was declared twice at equal specificity, so
   source order — not intent — was deciding both the height and the radius. */
.phone-screen {
  height: 745px; overflow: hidden; border-radius: var(--phone-r);
  background: var(--q-bg); padding: 22px 18px 26px; display: grid; gap: 16px;
  font-family: var(--q-font); color: var(--q-ink);
}
.q-eyebrow { font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--q-mute); font-family: var(--font-num); }
.q-title { font-size: 23px; line-height: 1.15; letter-spacing: -0.02em; font-weight: var(--fw-bold); margin-top: 7px; font-family: var(--q-display); }
.q-sub { margin-top: 8px; font-size: 13px; line-height: 1.55; color: var(--q-mute); }
.q-hero { border-radius: var(--q-r); overflow: hidden; background: var(--q-card); border: 1px solid var(--q-line); }
.q-img { aspect-ratio: 4 / 3; position: relative; overflow: hidden; }
/* Abstract product stand-in — a board silhouette, so the card reads as a
   product card rather than a colour block. */
.q-img::before {
  content: ""; position: absolute; left: 50%; top: 9%; bottom: 9%; width: 21%;
  transform: translateX(-50%) rotate(-13deg); border-radius: 999px;
  background: linear-gradient(180deg, rgba(255,255,255,.92), rgba(255,255,255,.5));
  box-shadow: 0 8px 22px rgba(0,0,0,.20);
}
.q-img::after {
  content: ""; position: absolute; left: 50%; top: 9%; bottom: 9%; width: 21%;
  transform: translateX(-50%) rotate(-13deg); border-radius: 999px;
  background: linear-gradient(180deg, transparent 18%, rgba(0,0,0,.06) 50%, transparent 82%);
}
.q-alt .q-img::before, .q-alt .q-img::after { top: 12%; bottom: 12%; width: 26%; }
.q-img-1 { background: linear-gradient(150deg, var(--q-art-a) 0%, var(--q-art-b) 55%, var(--q-art-c) 100%); }
.q-img-2 { background: linear-gradient(150deg, var(--q-art-b) 0%, var(--q-art-c) 100%); }
.q-img-3 { background: linear-gradient(150deg, var(--q-art-c) 0%, var(--q-art-a) 100%); }
.ribbon {
  position: absolute; z-index: 2; top: 10px; left: 10px; padding: 4px 9px; border-radius: var(--pill-r);
  background: var(--q-ribbon-bg); color: var(--q-ribbon-ink); font-size: 10px; font-weight: var(--fw-bold);
  letter-spacing: .06em; text-transform: uppercase; font-family: var(--font-num);
}
.q-body { padding: 14px; display: grid; gap: 7px; }
.q-name { font-size: 16px; font-weight: var(--fw-bold); letter-spacing: -0.01em; font-family: var(--q-display); }
.q-why { font-size: 12.5px; line-height: 1.5; color: var(--q-mute); }
.q-why b { color: var(--q-ink); font-weight: var(--fw-semi); }
.q-price { font-family: var(--font-num); font-size: 15px; font-weight: var(--fw-semi); font-variant-numeric: tabular-nums; }
.q-cta {
  margin-top: 4px; width: 100%; padding: 11px; border: 0; border-radius: var(--q-btn-r);
  background: var(--q-cta-bg); color: var(--q-cta-ink); font-weight: var(--fw-bold); font-size: 14px;
}
.q-alt-head { font-size: 11px; letter-spacing: .07em; text-transform: uppercase; color: var(--q-mute); font-family: var(--font-num); }
.q-alts { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: -8px; }
.q-alt { background: var(--q-card); border: 1px solid var(--q-line); border-radius: var(--q-r); overflow: hidden; }
.q-alt .q-img { aspect-ratio: 1; }
.q-alt-name { padding: 9px 10px 0; font-size: 12px; font-weight: var(--fw-semi); font-family: var(--q-display); }
.q-alt-price { padding: 1px 10px 10px; font-family: var(--font-num); font-size: 11.5px; color: var(--q-mute); }

/* ══ The Questions tab ══════════════════════════════════════════════
   Fixes carried over from the current screen:
   · question text is clamped to two lines at a word boundary, never cut
     mid-word — you have to be able to tell seven questions apart;
   · the type control moved out of the canvas and onto the question it
     belongs to, so nothing floats over the shopper preview;
   · "Add answer" and reorder live OUTSIDE the phone. Editing chrome inside
     the frame teaches merchants their shoppers will see it;
   · the repeated "SINGLE SELECT" on every row is gone — the row shows the
     answer count, which differs, and the accent is spent only on the one
     question that decides the result;
   · reorder is one grip on hover, not two stacked arrows on every row. */
.qtab { display: grid; grid-template-rows: auto 1fr; min-height: 620px; }
.qtab-bar {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  padding: 12px 18px; border-bottom: 1px solid var(--line); background: var(--surface);
}
.qtab-hint { margin-left: auto; font-size: 12.5px; color: var(--ink-3); }
.qtab-body { display: grid; grid-template-columns: 340px 1fr; min-height: 0; }

.qflow {
  display: flex; flex-direction: column; gap: 2px; padding: 14px 12px;
  border-right: 1px solid var(--line); background: var(--surface); min-width: 0;
}
.qflow-head {
  display: flex; align-items: baseline; gap: 8px; padding: 4px 8px 12px;
  font-size: 11px; letter-spacing: .09em; text-transform: uppercase;
  color: var(--ink-3); font-weight: var(--fw-semi);
}
.qflow-head span { letter-spacing: 0; text-transform: none; font-weight: var(--fw-normal); font-size: 12px; }
.fq-list, .fq-extra { display: grid; gap: 2px; }
.fq, .fq-step {
  display: flex; align-items: flex-start; gap: 11px; padding: 10px 10px;
  border-radius: var(--r-md); cursor: default; position: relative;
}
.fq:hover, .fq-step:hover { background: var(--surface-2); }
.fq.is-on { background: var(--accent-wash); box-shadow: inset 2px 0 0 var(--accent); }
.fq-n, .fq-ico {
  flex: none; width: 20px; height: 20px; display: grid; place-items: center; margin-top: 1px;
  border-radius: var(--r-sm); font-size: 11px; font-weight: var(--fw-semi);
  background: var(--surface-2); color: var(--ink-3); border: 1px solid var(--line);
  font-variant-numeric: tabular-nums;
}
.fq.is-on .fq-n { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.fq-main { display: grid; gap: 3px; min-width: 0; flex: 1; }
/* Two lines, clamped at a word boundary — never a mid-word cut. */
.fq-text {
  font-size: 13.5px; line-height: 1.4; font-weight: var(--fw-med); color: var(--ink);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.fq-meta { font-size: 11.5px; color: var(--ink-3); display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.fq-role {
  padding: 1px 6px; border-radius: var(--r-sm); font-size: 10.5px; font-weight: var(--fw-semi);
  background: var(--accent-wash); color: var(--accent-ink); border: 1px solid var(--accent-line);
}
.fq-grip { display: grid; gap: 2px; padding: 4px 2px; opacity: 0; flex: none; align-self: center; }
.fq:hover .fq-grip, .fq:focus-within .fq-grip { opacity: 1; }
.fq-grip i { display: block; width: 12px; height: 1.5px; background: var(--line-strong); border-radius: 1px; }
.fq-extra { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--line); }
.fq-step .fq-text { font-weight: var(--fw-med); color: var(--ink-2); }

.qedit { display: grid; grid-template-rows: auto 1fr; min-width: 0; background: var(--surface-2); }
.qedit-bar {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  padding: 11px 18px; border-bottom: 1px solid var(--line); background: var(--surface);
}
.qedit-label { font-size: 13px; font-weight: var(--fw-semi); }
.qedit-type select, .ovw-type select {
  padding: 6px 10px; border-radius: var(--r-md); border: 1px solid var(--line-strong);
  background: var(--surface); font-size: 13px; color: var(--ink);
}
.qedit-dev { margin-left: auto; }
.qedit-stage { display: grid; justify-items: center; gap: 12px; padding: 22px 20px 26px; }
/* A true 390×745 screen, scaled as a whole. The previous version set
   min-height:0 and let content decide the height, which produced a 400×570
   box — ratio 1.44 against a phone's 1.91. That is the exact failure the
   sizing rule exists to prevent, so the rule is enforced here in one place
   and the zoom is printed under the frame. */

.qphone-screen { padding: 30px 20px; gap: 14px; align-content: start;
  --m-bg: #FBF4ED; --m-ink: #2A211A; --m-mute: #6E5D4E; --m-line: #E7DACE; --m-cta: #A6462A;
  background: var(--m-bg); color: var(--m-ink);
}
.qz-progress { height: 5px; border-radius: 3px; background: #E7DACE; overflow: hidden; }
.qz-progress span { display: block; height: 100%; background: var(--m-cta); border-radius: 3px; }
.qq { font-size: 19px; line-height: 1.3; font-weight: 700; letter-spacing: -0.012em; }
.qa-list { display: grid; gap: 8px; }
.qa {
  padding: 13px 15px; border-radius: 10px; background: #FFFFFF; border: 1px solid var(--m-line);
  font-size: 14px; line-height: 1.4;
}
.qa.is-on { border-color: var(--m-cta); box-shadow: 0 0 0 1px var(--m-cta); }
.qz-next {
  margin-top: 2px; padding: 14px; border: 0; border-radius: 10px;
  background: var(--m-cta); color: #FFF7F2; font-size: 15px; font-weight: 700;
}

/* ── Overview ─────────────────────────────────────────────────────────
   The role moves to the far LEFT, next to the number, so "which question
   decides the result" is answered before you read a word of the question.
   Nothing has an edit button: question and answer cells are edited in
   place, so the affordance is the hover outline and the caret. */
/* No count column — the answer list is right there. Role sits with Type on
   the right, and everything else shifts left. */
.ovw-head, .ovw-row {
  display: grid; grid-template-columns: 42px minmax(210px, 1fr) minmax(280px, 1.45fr) 168px;
  gap: 20px; align-items: start;
}
.ovw-head {
  padding: 10px 20px; border-bottom: 1px solid var(--line-strong); background: var(--surface-2);
  font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-3);
  font-weight: var(--fw-semi); position: sticky; top: 0; z-index: 2;
}
.ovw-row { padding: 16px 20px; border-bottom: 1px solid var(--line); position: relative; background: var(--surface); }
.ovw-row:hover { background: var(--surface-2); }
.ovw-row::after {
  content: "+ Insert question here"; position: absolute; left: 20px; right: 20px; bottom: -11px; z-index: 1;
  height: 22px; display: grid; place-items: center; opacity: 0;
  font-size: 11px; font-weight: var(--fw-semi); color: var(--accent-ink);
  background: var(--accent-wash); border: 1px dashed var(--accent-line); border-radius: var(--r-sm);
}
.ovw-row:hover::after { opacity: 1; }

.ovw-n {
  width: 24px; height: 24px; display: grid; place-items: center; border-radius: var(--r-sm);
  background: var(--surface-2); border: 1px solid var(--line); color: var(--ink-3);
  font-size: 11.5px; font-weight: var(--fw-semi); font-variant-numeric: tabular-nums;
}
.ovw-row.is-decider .ovw-n { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.role-tag {
  padding: 4px 9px; border-radius: var(--r-sm); font-size: 11px; font-weight: var(--fw-semi);
  letter-spacing: .04em; line-height: 1.35;
  background: var(--surface-2); color: var(--ink-2); border: 1px solid var(--line);
}
.role-tag.is-decider { background: var(--accent-wash); color: var(--accent-ink); border-color: var(--accent-line); }

/* Edited in place — the outline is the affordance, there is no edit button. */
.ovw-text, .ovw-answers li:not(.ovw-add) {
  border-radius: var(--r-sm); cursor: text;
  box-shadow: inset 0 0 0 1px transparent; transition: box-shadow .12s ease, background .12s ease;
}
.ovw-text { font-size: 14.5px; line-height: 1.45; font-weight: var(--fw-semi); padding: 5px 8px; margin: -5px -8px; }
.ovw-text:hover, .ovw-answers li:not(.ovw-add):hover { box-shadow: inset 0 0 0 1px var(--line-strong); }
.ovw-text:focus, .ovw-answers li:not(.ovw-add):focus {
  outline: 0; background: var(--surface); box-shadow: inset 0 0 0 2px var(--accent);
}
.ovw-answers { display: grid; gap: 4px; font-size: 13px; color: var(--ink-2); }
.ovw-answers li { padding: 6px 9px; background: var(--surface-2); line-height: 1.4; }
.ovw-row:hover .ovw-answers li:not(.ovw-add) { background: var(--surface); }
.ovw-add { background: transparent !important; padding: 2px 0 0 !important; }
.ovw-add button {
  border: 1px dashed var(--line-strong); background: transparent; color: var(--ink-2);
  padding: 5px 11px; border-radius: var(--r-sm); font-size: 12.5px; width: 100%;
}
.ovw-add button:hover { border-style: solid; border-color: var(--accent); color: var(--accent-ink); background: var(--accent-wash); }
.ovw-type { display: grid; gap: 9px; justify-items: start; }
.ovw-more {
  width: 100%; padding: 14px; border: 0; border-top: 1px solid var(--line); background: var(--surface);
  font-size: 13.5px; font-weight: var(--fw-semi); color: var(--accent-ink);
}
.ovw-more:hover { background: var(--accent-wash); }
.frame-scroll > .app[data-screen="overview"], .frame-scroll > .app[data-screen="questions"] { min-width: 1040px; }

/* ══ Generating — the drafting state ════════════════════════════════
   Was a spinner alone in a full-height white field. Now a bounded card
   that shows the four real gen_progress checkpoints, so the wait has a
   shape and a merchant can tell a slow job from a stuck one. */
.gen-wrap { display: grid; place-items: center; padding: 44px 0 56px; }
.gen-card {
  width: min(520px, 100%); padding: 30px 30px 26px; text-align: center;
  background: var(--surface); border: 1px solid var(--card-line); border-radius: var(--r-lg);
  box-shadow: var(--e-1);
}
/* The loading ring is §A3 (LOCKED) in the existing system — reproduced here
   exactly: one conic-sweep ring, masked to an 8px band, spinning at 1.1s
   linear while the wrapper breathes 0.85 → 1.1 over 2.8s. The only change is
   that the sweep stays inside the violet family, because Quartz has one
   accent and the original's coral stop would be a second one. */
.gen-ring { width: 78px; height: 78px; margin: 0 auto 22px; position: relative; }
.gen-ring-wrap {
  display: block; width: 100%; height: 100%;
  animation: qz-breathe 2.8s ease-in-out infinite;
}
.gen-ring-core {
  display: block; width: 100%; height: 100%; border-radius: 50%;
  background: conic-gradient(from 0deg,
    var(--accent), var(--accent-line), var(--accent-ink), var(--accent));
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 8px), black calc(100% - 8px));
  mask: radial-gradient(farthest-side, transparent calc(100% - 8px), black calc(100% - 8px));
  animation: qz-ring-spin 1.1s linear infinite;
}
@keyframes qz-ring-spin { to { transform: rotate(360deg); } }
@keyframes qz-breathe { 0%, 100% { transform: scale(.85); } 50% { transform: scale(1.1); } }

/* The ✦ that orbit it — the existing qz-bb-hero-twinkle curve. */
.gen-spark { position: absolute; color: var(--accent); line-height: 1; opacity: .12; }
.gen-spark::before { content: "\2726"; }
.gen-spark.s1 { top: -6px;  left: 4px;   font-size: 13px; animation: qz-twinkle 4.5s ease-in-out infinite; }
.gen-spark.s2 { top: 2px;   right: -2px; font-size: 9px;  animation: qz-twinkle 3.8s ease-in-out infinite 1s; }
.gen-spark.s3 { bottom: 4px; right: -10px; font-size: 15px; animation: qz-twinkle 4.1s ease-in-out infinite .5s; }
.gen-spark.s4 { bottom: -8px; left: -6px; font-size: 8px;  animation: qz-twinkle 5s ease-in-out infinite 1.6s; }
@keyframes qz-twinkle {
  0%, 100% { opacity: .12; transform: scale(.8); }
  50%      { opacity: .75; transform: scale(1.12); }
}
@media (prefers-reduced-motion: reduce) {
  .gen-ring-core, .gen-ring-wrap, .gen-spark { animation: none; transform: scale(1); }
}
.gen-title { font-size: 19px; font-weight: var(--fw-bold); letter-spacing: -0.015em; }
.gen-steps {
  margin-top: 22px; display: grid; gap: 2px; text-align: left;
  width: max-content; max-width: 100%; margin-inline: auto;
}
.gen-step {
  display: flex; align-items: center; gap: 11px; padding: 9px 12px;
  border-radius: var(--r-md); font-size: 13.5px; color: var(--ink-3);
}
.gen-step.is-done { color: var(--ink-2); }
.gen-step.is-now { background: var(--accent-wash); color: var(--accent-ink); font-weight: var(--fw-semi); }
.gen-dot {
  flex: none; width: 17px; height: 17px; border-radius: var(--r-sm); display: grid; place-items: center;
  border: 1px solid var(--line-strong); font-size: 10px; font-weight: var(--fw-bold);
}
.gen-step.is-done .gen-dot { background: var(--ok-wash); border-color: var(--ok-line); color: var(--ok); }
.gen-step.is-now .gen-dot { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.gen-step.is-now .gen-dot::after {
  content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--on-accent);
  animation: gen-pulse 1.2s ease-in-out infinite;
}
@keyframes gen-pulse { 0%,100% { opacity: .35; } 50% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .gen-step.is-now .gen-dot::after { animation: none; } }

/* ══ The editor canvas ══════════════════════════════════════════════
   Four regions: sections rail · flow panel · stage · inspector. The one
   screen where the system has to hold up under real density. */
.main-bleed { padding: 0; }

/* THE EDITOR STANDS DOWN.
   Inside the builder the merchant is looking at THEIR brand. Our accent would
   compete with it — a violet selection ring next to their terracotta button is
   two brands arguing. So the whole editor surface re-points the accent tokens
   at the ink ladder: selection, focus, active nav and the primary action all go
   neutral, and the only saturated colour left on the screen is the design in
   the preview. Every component below is unchanged; only the tokens moved. */
.editor {
  --accent: var(--ink);
  --accent-ink: var(--ink);
  --accent-wash: var(--surface-2);
  --accent-line: var(--line-strong);
  --accent-ring: rgba(0, 0, 0, .14);
  --on-accent: var(--surface);
  --focus: var(--ink);
}
/* The preview carries the merchant's palette, not ours — shown here with a
   warm cream-and-terracotta brand so the separation is visible at a glance. */
.stage-screen {
  --q-bg: #FBF4ED; --q-ink: #2A211A; --q-mute: #6E5D4E;
  --q-cta-bg: #B4462A; --q-cta-ink: #FFF7F2; --q-btn-r: 8px;
}
.stage-phone { background: #EFE6DC; border-color: #E0D3C6; }

.editor { display: grid; grid-template-rows: auto 1fr; min-height: 620px; background: var(--surface-2); }

.ed-top {
  display: flex; align-items: center; gap: 14px; padding: 0 16px; height: 52px;
  background: var(--surface); border-bottom: 1px solid var(--line);
}
.crumbs { display: flex; align-items: center; gap: 8px; font-size: 14px; color: var(--ink-3); }
.crumbs a { text-decoration: none; }
.crumbs a:hover { color: var(--ink); }
.crumbs b { color: var(--ink); font-weight: var(--fw-semi); }
.crumb-sep { color: var(--ink-3); }
.saved { font-size: 12.5px; color: var(--ok); }
.saved::before { content: "\2713\00a0"; }
.ed-top-end { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.icon-btn.is-ai { color: var(--accent); }
.icon-btn.is-ai:hover { background: var(--accent-wash); }

.ed-body { display: grid; grid-template-columns: 76px 244px 1fr 288px; min-height: 0; }

.ed-rail {
  display: flex; flex-direction: column; gap: 2px; padding: 10px 6px;
  background: var(--surface); border-right: 1px solid var(--line);
}
.ed-rail-item {
  display: grid; justify-items: center; gap: 5px; padding: 9px 4px; border-radius: var(--nav-r);
  text-decoration: none; font-size: 10.5px; font-weight: var(--fw-semi); color: var(--ink-3);
  letter-spacing: .01em;
}
.ed-rail-item .ico { width: 18px; height: 18px; }
.ed-rail-item:hover { background: var(--surface-2); color: var(--ink); }
.ed-rail-item.is-active { background: var(--accent-wash); color: var(--accent-ink); }

.ed-panel {
  display: flex; flex-direction: column; gap: 10px; padding: 12px 10px; min-width: 0;
  background: var(--surface); border-right: 1px solid var(--line);
}
.ed-tabs { width: 100%; }
.ed-tabs .seg-btn { flex: 1; justify-content: center; }
.tree { display: grid; gap: 1px; min-width: 0; }
.tree-row {
  display: flex; align-items: center; gap: 8px; padding: 8px 8px; border-radius: var(--nav-r);
  font-size: 13.5px; cursor: default; min-width: 0;
}
.tree-row:hover { background: var(--surface-2); }
.tree-row.is-open { background: var(--surface-2); }
.tw { font-size: 8px; color: var(--ink-3); width: 8px; flex: none; }
.tree-n {
  flex: none; width: 17px; height: 17px; display: grid; place-items: center; border-radius: 3px;
  font-size: 10px; font-weight: var(--fw-semi); color: var(--ink-3); background: var(--surface);
  border: 1px solid var(--line); font-variant-numeric: tabular-nums;
}
.tree-row.is-open .tree-n { background: var(--surface); }
.tree-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: var(--fw-med); }
.tree-sub { color: var(--ink-3); font-weight: var(--fw-normal); font-size: 12px; }
.tree-flag { width: 7px; height: 7px; border-radius: 50%; background: var(--warn); flex: none; }
.tree-kids { display: grid; gap: 1px; padding: 2px 0 2px 30px; }
.tree-kid {
  display: flex; align-items: center; gap: 9px; padding: 6px 8px; border-radius: var(--nav-r);
  font-size: 13px; color: var(--ink-2);
}
.tree-kid:hover { background: var(--surface-2); }
.tree-kid.is-sel { background: var(--accent-wash); color: var(--accent-ink); font-weight: var(--fw-semi); }
.kid-g {
  width: 15px; flex: none; font-size: 10px; font-weight: var(--fw-semi);
  color: var(--ink-3); text-align: center;
}
.tree-kid.is-sel .kid-g { color: var(--accent-ink); }
.add-step {
  margin-top: auto; padding: 9px; border: 1px dashed var(--line-strong); border-radius: var(--btn-r);
  background: transparent; color: var(--ink-2); font-size: 13px; font-weight: var(--fw-med);
}
.add-step:hover { border-style: solid; border-color: var(--accent); color: var(--accent-ink); background: var(--accent-wash); }

.ed-canvas { display: grid; grid-template-rows: auto 1fr; min-width: 0; background: var(--surface-2); }
.canvas-bar {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 10px 16px; background: var(--surface); border-bottom: 1px solid var(--line);
}
.canvas-name { font-size: 13.5px; font-weight: var(--fw-semi); margin-right: auto; }
.canvas-stage { display: flex; align-items: flex-start; justify-content: center; gap: 14px; padding: 26px 20px 30px; }

.canvas-stage[data-device="phone"] .stage-desktop { display: none; }
.canvas-stage[data-device="desktop"] .devbox[data-dev="phone"] { display: none; }
.canvas-stage[data-device="desktop"] .stage-tools { margin-top: 90px; }
.stage-tools {
  flex: none; margin-top: 58px; display: grid; gap: 2px; padding: 4px; border-radius: var(--r-md);
  background: var(--ink); box-shadow: var(--e-2);
}
.stage-tools button {
  width: 26px; height: 26px; display: grid; place-items: center; border: 0; border-radius: var(--r-sm);
  background: transparent; color: #FFFFFF; font-size: 12px; opacity: .8;
}
.stage-tools button:hover { background: rgba(255,255,255,.16); opacity: 1; }


.stage-screen {
  border-radius: 20px 20px 0 0; background: var(--q-bg); padding: 44px 22px 22px; height: 100%;
  display: grid; gap: 12px; align-content: start; text-align: center; position: relative; overflow: hidden;
}
/* The editor's inline variant. .stage-screen carries the merchant palette,
   .embed-frame carries the band geometry; this decides which one owns the
   box rather than leaving it to source order. */
.embed-frame.stage-screen {
  border-radius: 0; padding: 40px 48px;
  align-content: center; gap: 12px; text-align: center; overflow: hidden;
}
.embed-frame .blk-h { font-size: 30px; }
.embed-frame .blk-t { font-size: 15px; }
.blk { position: relative; border: 1px dashed transparent; border-radius: var(--r-sm); padding: 6px 8px; }
.blk:hover { border-color: var(--line-strong); }
.blk-h { font-size: 21px; line-height: 1.2; letter-spacing: -0.02em; font-weight: var(--fw-bold); color: var(--q-ink); }
.blk-t { font-size: 13.5px; line-height: 1.55; color: var(--q-mute); }
.blk-t.is-sel { border: 1px solid var(--accent); background: var(--accent-wash); color: var(--q-ink); }
.sel-tag {
  position: absolute; top: -9px; left: 8px; padding: 1px 6px; border-radius: 3px;
  background: var(--accent); color: var(--on-accent); font-size: 9.5px; font-weight: var(--fw-semi);
  letter-spacing: .05em; text-transform: uppercase;
}
.blk-b {
  border: 0; border-radius: var(--q-btn-r); padding: 12px; background: var(--q-cta-bg); color: var(--q-cta-ink);
  font-size: 14px; font-weight: var(--fw-bold);
}
.blk-back { font-size: 12.5px; color: var(--q-mute); }
.fold {
  position: absolute; left: 0; right: 0; bottom: 78px; border-top: 1px dashed var(--line-strong);
  font-size: 9.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-3);
  text-align: right; padding: 3px 10px 0; font-weight: var(--fw-semi);
}

.ed-inspect { background: var(--surface); border-left: 1px solid var(--line); padding: 12px 12px 20px; min-width: 0; }
.insp { display: grid; gap: 4px; }
.insp-head { margin-top: 14px; font-size: 14px; font-weight: var(--fw-semi); }
.insp-note { font-size: 12.5px; color: var(--ink-3); line-height: 1.5; margin-bottom: 6px; }
.insp-group { padding: 14px 0; border-top: 1px solid var(--line); display: grid; gap: 9px; }
.insp-title {
  font-size: 11px; letter-spacing: .09em; text-transform: uppercase; color: var(--ink-3);
  font-weight: var(--fw-semi);
}
.ctl { display: flex; align-items: center; gap: 10px; }
.ctl-label { flex: none; width: 46px; font-size: 12.5px; color: var(--ink-2); }
.ctl-name { flex: 1; font-size: 12.5px; color: var(--ink-2); }
.slider { position: relative; flex: 1; height: 4px; border-radius: 2px; background: var(--line); }
.slider-fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 2px; background: var(--accent); }
.slider-knob {
  position: absolute; top: 50%; width: 14px; height: 14px; margin-left: -7px; border-radius: 50%;
  transform: translateY(-50%); background: var(--surface); border: 2px solid var(--accent); box-shadow: var(--e-1);
}
.ctl-val {
  flex: none; min-width: 46px; padding: 5px 8px; border: 1px solid var(--line-strong); border-radius: var(--r-sm);
  font-size: 12.5px; text-align: right; font-variant-numeric: tabular-nums; color: var(--ink);
}
.ctl-val.is-code { min-width: 78px; letter-spacing: .01em; }
.sw { width: 20px; height: 20px; flex: none; border-radius: var(--r-sm); border: 1px solid var(--line-strong); }
.insp-seg { width: 100%; }
.insp-seg .seg-btn { flex: 1; justify-content: center; }
.insp-more {
  justify-self: start; border: 0; background: transparent; padding: 2px 0;
  font-size: 12.5px; color: var(--accent-ink); font-weight: var(--fw-semi);
}
.insp-more:hover { text-decoration: underline; text-underline-offset: 3px; }
.insp-hint { font-size: 12px; color: var(--ink-3); line-height: 1.5; }

.frame-scroll > .app[data-screen="editor"] { min-width: 1180px; }
.app[data-layout="canvas"] .editor { border-radius: var(--r-lg); overflow: hidden; }
.app[data-layout="canvas"] .main:has(.editor) { padding: 0; }
.app[data-layout="canvas"] .sheet:has(.editor) { border: 0; border-radius: 0; box-shadow: none; }

/* ══ Explainers ══════════════════════════════════════════════════════
   Both sections get one, and the trigger carries the ✦ that already means
   "we can explain this". Every panel is sized to ONE fixed body height, so
   no step scrolls — the chains that used to run vertically and get cut off
   now run horizontally. */
.explain-btn {
  display: inline-flex; align-items: center; gap: 7px; padding: 6px 12px;
  border-radius: var(--r-md); border: 1px solid var(--accent-line);
  background: var(--accent-wash); color: var(--accent-ink);
  font-size: 12.5px; font-weight: var(--fw-semi); white-space: nowrap;
}
.explain-btn:hover { background: var(--surface); border-color: var(--accent); }
.explain-ico { font-size: 11px; }

.ex-wrap { display: grid; gap: 26px; }
.ex {
  width: 100%; max-width: 880px; border-radius: var(--r-lg); background: var(--surface);
  border: 1px solid var(--line-strong); box-shadow: var(--e-2); overflow: hidden;
  display: grid; grid-template-rows: auto auto 1fr auto;
}
.ex-head { display: flex; align-items: center; gap: 14px; padding: 14px 18px; }
.ex-tag {
  display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: var(--r-sm);
  background: var(--accent-wash); color: var(--accent-ink); border: 1px solid var(--accent-line);
  font-size: 10.5px; font-weight: var(--fw-semi); letter-spacing: .07em; text-transform: uppercase;
}
.ex-title { font-size: 16px; font-weight: var(--fw-bold); }
.ex-head .icon-btn { margin-left: auto; }

.ex-steps {
  display: flex; align-items: center; gap: 4px; padding: 0 14px 12px; flex-wrap: wrap;
  border-bottom: 1px solid var(--line);
}
.ex-step {
  display: flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: var(--r-md);
  font-size: 12.5px; font-weight: var(--fw-med); color: var(--ink-3); cursor: pointer;
}
.ex-step:hover { background: var(--surface-2); color: var(--ink-2); }
.ex-step-n {
  width: 19px; height: 19px; flex: none; display: grid; place-items: center; border-radius: var(--r-sm);
  border: 1px solid var(--line-strong); font-size: 10px; font-weight: var(--fw-semi);
  font-variant-numeric: tabular-nums;
}
.ex-step.is-done .ex-step-n { background: var(--ok-wash); border-color: var(--ok-line); color: var(--ok); }
.ex-step.is-done { color: var(--ink-2); }
.ex-step.is-now { background: var(--accent-wash); color: var(--accent-ink); font-weight: var(--fw-semi); }
.ex-step.is-now .ex-step-n { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }

/* ONE fixed body height. Nothing inside may scroll. */
.ex-body { height: 340px; padding: 20px 22px; position: relative; }
.ex-panel { display: none; height: 100%; grid-template-rows: auto 1fr auto; gap: 14px; }
.ex-panel.is-on { display: grid; }
.ex-lede { font-size: 14.5px; line-height: 1.6; color: var(--ink-2); max-width: 76ch; }
.ex-lede b { color: var(--ink); font-weight: var(--fw-semi); }
.ex-foot { font-size: 12.5px; color: var(--ink-3); line-height: 1.5; }
.ex-foot b { color: var(--ink-2); font-weight: var(--fw-semi); }

/* Horizontal chain — this is what stops step 1 and step 4 running off. */
.ex-chain { display: flex; align-items: stretch; gap: 10px; align-self: center; }
.ex-node {
  flex: 1 1 0; min-width: 0; display: grid; gap: 3px; align-content: start;
  padding: 13px 14px; border-radius: var(--r-md); border: 1px solid var(--line); background: var(--surface-2);
}
.ex-node.is-in { border-color: var(--accent-line); background: var(--accent-wash); }
.ex-node.is-out { border-color: var(--ok-line); background: var(--ok-wash); }
/* The rule node carries a full conditional, so it needs more room. */
.ex-node.is-rule { flex: 1.45 1 0; border-color: var(--accent-line); }
.ex-node.is-rule .ex-node-label { color: var(--accent-ink); }
.ex-then { display: block; margin-top: 4px; }
.ex-then b { color: var(--accent-ink); }
.ex-node-label {
  font-size: 10px; letter-spacing: .08em; text-transform: uppercase; font-weight: var(--fw-semi);
  color: var(--ink-3);
}
.ex-node.is-in .ex-node-label { color: var(--accent-ink); }
.ex-node.is-out .ex-node-label { color: var(--ok); }
.ex-node-main { font-size: 15px; font-weight: var(--fw-semi); line-height: 1.3; }
.ex-node-main em { font-style: normal; color: var(--ink-3); font-weight: var(--fw-normal); }
.ex-node-sub { font-size: 11.5px; color: var(--ink-3); line-height: 1.4; }
.ex-arrow { align-self: center; color: var(--ink-3); flex: none; }
.ex-verb {
  display: inline-block; padding: 3px 9px; border-radius: var(--r-sm); font-size: 12.5px;
  font-weight: var(--fw-semi); border: 1px solid;
}
.ex-verb.is-show { color: var(--accent-ink); border-color: var(--accent); background: var(--surface); }
.ex-verb.is-exclude { color: var(--crit); border-color: var(--crit); background: var(--surface); }
.ex-verb.is-highlight { color: var(--ok); border-color: var(--ok); background: var(--surface); }

/* Step 1 — the shape stated once as column headings, then three real rules
   under it, then the top one written out as a sentence. "To these" was the
   unclear label: it named a direction, not a thing. "Which products" answers
   the question the column actually answers. */
.ex-grid { align-self: center; display: grid; gap: 6px; }
.ex-grid-head, .ex-grid-row {
  display: grid; grid-template-columns: minmax(0,1.15fr) 18px minmax(0,.8fr) 18px minmax(0,1.3fr);
  gap: 10px; align-items: center;
}
.ex-grid-head span {
  font-size: 10px; letter-spacing: .08em; text-transform: uppercase;
  font-weight: var(--fw-semi); color: var(--ink-3);
}
.ex-grid-row { padding: 10px 12px; border-radius: var(--r-md); background: var(--surface-2); }
.ex-when { font-size: 14px; font-weight: var(--fw-semi); color: var(--ink); }
.ex-when em, .ex-what em { font-style: normal; color: var(--ink-3); font-weight: var(--fw-normal); }
.ex-what { font-size: 14px; font-weight: var(--fw-semi); color: var(--ink); min-width: 0; }
.ex-what em { display: block; font-size: 11px; letter-spacing: .04em; }
.ex-grid .ex-arrow { justify-self: center; }
.ex-grid .ex-verb { justify-self: start; }
.ex-say {
  font-size: 13px; line-height: 1.55; color: var(--ink-2);
  padding: 11px 14px; border-radius: var(--r-md);
  background: var(--accent-wash); border: 1px solid var(--accent-line);
}
.ex-say b { color: var(--accent-ink); font-weight: var(--fw-semi); }

/* Rule lists */
.ex-rules { display: grid; gap: 4px; align-self: center; }
.ex-rules li {
  display: flex; align-items: center; gap: 12px; padding: 9px 12px; border-radius: var(--r-md);
  font-size: 13.5px; color: var(--ink-3); border: 1px solid transparent; background: var(--surface-2);
}
.ex-rules li em { font-style: normal; color: var(--ink-3); }
.ex-rules li b { color: var(--ink); font-weight: var(--fw-semi); }
.ex-rules li > span:nth-child(2) { flex: 1; min-width: 0; }
.ex-rules li.is-win { background: var(--ok-wash); border-color: var(--ok-line); color: var(--ink); }
.ex-n {
  width: 20px; height: 20px; flex: none; display: grid; place-items: center; border-radius: var(--r-sm);
  background: var(--surface); border: 1px solid var(--line); font-size: 10.5px;
  font-weight: var(--fw-semi); font-variant-numeric: tabular-nums; color: var(--ink-3);
}
.ex-rules li.is-win .ex-n { background: var(--ok); border-color: var(--ok); color: var(--surface); }
.ex-verdict { flex: none; font-size: 11.5px; color: var(--ink-3); }
.ex-verdict.is-win { color: var(--ok); font-weight: var(--fw-semi); }
.ex-target { flex: none; font-size: 12px; color: var(--ink-3); width: 190px; text-align: right; }

/* Narrowing list */
.ex-narrow { display: grid; gap: 4px; align-self: center; }
.ex-narrow li {
  display: flex; align-items: center; gap: 12px; padding: 8px 12px; border-radius: var(--r-md);
  background: var(--surface-2); font-size: 13px;
}
.ex-narrow li.is-start { background: var(--accent-wash); box-shadow: inset 2px 0 0 var(--accent); }
.ex-q { flex: 1; min-width: 0; font-weight: var(--fw-med); color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ex-badge {
  flex: none; padding: 3px 9px; border-radius: var(--r-sm); font-size: 11px; font-weight: var(--fw-semi);
  background: var(--surface); border: 1px solid var(--line); color: var(--ink-2);
}
.ex-badge.is-start { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.ex-badge.is-off { color: var(--ink-3); }
.ex-src { flex: none; width: 150px; font-size: 11.5px; color: var(--ink-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ex-left { flex: none; width: 66px; text-align: right; font-size: 13.5px; font-weight: var(--fw-semi); font-variant-numeric: tabular-nums; }
.ex-left em { font-style: normal; color: var(--crit); font-size: 12px; margin-right: 5px; }

/* Rules vs questions */
.ex-two { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; align-self: center; }
.ex-card { padding: 16px 18px; border-radius: var(--r-md); border: 1px solid var(--line); display: grid; gap: 5px; }
.ex-card.is-rules { border-left: 3px solid var(--ok); }
.ex-card.is-questions { border-left: 3px solid var(--accent); }
.ex-card-kind { font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; font-weight: var(--fw-semi); }
.ex-card.is-rules .ex-card-kind { color: var(--ok); }
.ex-card.is-questions .ex-card-kind { color: var(--accent-ink); }
.ex-card-title { font-size: 16px; font-weight: var(--fw-bold); }
.ex-card-body { font-size: 13px; color: var(--ink-3); line-height: 1.55; }
/* The movement graphic. Rules ADD a product to the set; questions DROP one.
   The token animates so the direction is shown, not just labelled. */
.ex-move { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
.ex-slots {
  display: flex; gap: 5px; padding: 6px; border-radius: var(--r-sm);
  border: 1px solid var(--line); width: max-content; background: var(--surface);
}
.ex-slots i { width: 15px; height: 15px; border-radius: 4px; background: var(--surface-2); }
.ex-end { position: relative; border: 1px dashed var(--line-strong); background: transparent !important; }
.ex-token { position: absolute; inset: -1px; border-radius: 4px; }
.is-in .ex-token { background: var(--ok); animation: ex-in 2.8s ease-in-out infinite; }
.is-out .ex-token { background: var(--accent); animation: ex-out 2.8s ease-in-out infinite; }
@keyframes ex-in {
  0%        { transform: translateX(38px); opacity: 0; }
  26%, 74%  { transform: translateX(0);    opacity: 1; }
  100%      { transform: translateX(38px); opacity: 0; }
}
@keyframes ex-out {
  0%, 24%   { transform: translateX(0);    opacity: 1; }
  62%, 100% { transform: translateX(38px); opacity: 0; }
}
.ex-dir { font-size: 15px; line-height: 1; }
.is-in .ex-dir { color: var(--ok); }
.is-out .ex-dir { color: var(--accent); }
.ex-move-cap { font-size: 11.5px; color: var(--ink-3); }
@media (prefers-reduced-motion: reduce) {
  .ex-token { animation: none !important; transform: none; opacity: 1; }
  .is-out .ex-token { opacity: .25; }
}

/* A panel with a single child centres it. */
.ex-panel > :only-child { align-self: center; }

.ex-foot-bar {
  display: flex; align-items: center; gap: 10px; padding: 12px 18px;
  border-top: 1px solid var(--line); background: var(--surface-2);
}
.ex-count { font-size: 12.5px; color: var(--ink-3); margin-right: auto; font-variant-numeric: tabular-nums; }
.ex-count b { color: var(--ink-2); font-weight: var(--fw-semi); }

/* ══ Footer ═════════════════════════════════════════════════════════ */
.foot { margin-top: 72px; padding-top: 32px; border-top: 1px solid var(--line); display: grid; gap: 26px; }
.foot-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 34px; }
.foot h3 { font-size: 15px; font-weight: var(--fw-semi); margin-bottom: 12px; }
.foot li { font-size: 13.5px; color: var(--ink-2); line-height: 1.6; padding: 5px 0; display: flex; gap: 9px; }
.foot li::before { content: "—"; color: var(--ink-3); flex: none; }
.sources { font-size: 12.5px; color: var(--ink-3); line-height: 1.7; }
.sources a { color: var(--accent-ink); text-decoration: underline; text-underline-offset: 2px; }

/* Only the DOCUMENT reflows. The embedded product screens keep their desktop
   layout and scroll horizontally inside .frame-scroll — collapsing them would
   show a layout that doesn't exist. */
@media (max-width: 1080px) {
  .spec-pair, .principles, .foot-cols { grid-template-columns: 1fr; }
}
@media (max-width: 720px) {
  .doc { padding: 0 18px 64px; }
  .masthead { padding: 44px 0 30px; }
  .mh-top { flex-wrap: wrap; }
  .mh-index { margin-left: 0; width: 100%; }
  .sec-note { display: none; }
  .sec-head { flex-wrap: wrap; gap: 8px; }
  .ramp-tag { width: 66px; }
  .frame-cap { font-size: 10.5px; }
}
`;

/* ═══ Studio home — the composer page, two states ══════════════════════
   Everything here is prefixed `hm-`. The doc already owns .stat, .card,
   .chip and .row; an unprefixed merge would have silently restyled six
   other screens.
   The composer is the anchor: identical in both states, so the page can
   grow around it without reading as a different screen. It keeps two
   scoped departures from the system — a 14px radius and a real shadow —
   because it is the one thing on the page you are meant to type into.
   ══════════════════════════════════════════════════════════════════════ */
export const HOME_CSS = String.raw`
/* The ONE tinted surface in the product. Everything else is white paper.
   This was var(--wash, var(--surface-2)) — it worked only because --wash
   happened to be undefined, so defining --wash later would silently have
   changed it. Named, so the decision is legible. */
.page.home2 { display: flex; flex-direction: column; padding: 0; background: var(--home-ground); }
.home2 .hm-col { max-width: 640px; margin: 0 auto; }
.home2 .hm-top { text-align: center; }

/* Empty: the composer sits optically centred — heavier padding below than
   above, so it lands slightly high, which is where the eye expects it. */
.home2.is-none { justify-content: center; min-height: 620px; }
.home2.is-none .hm-top { padding: 28px 30px 84px; }
.home2.is-has  .hm-top { padding: 46px 30px 0; }

/* Size is a function of state, not a setting: 37px is a welcome on a blank
   page, and the same 37px above a checklist is the page shouting over its
   own content. */
.home2 .hm-h1 { max-width: 720px; margin: 0 auto; text-wrap: balance; }
.home2.is-none .hm-h1 { font-size: 37px; line-height: 1.14; letter-spacing: -0.031em; font-weight: var(--fw-bold); }
.home2.is-has  .hm-h1 { font-size: 27px; line-height: 1.2; letter-spacing: -0.022em; font-weight: var(--fw-semi); }

.home2 .hm-composer {
  margin-top: 20px; text-align: left; background: var(--surface);
  border: 1px solid var(--line); border-radius: 14px;
  box-shadow: 0 1px 2px rgba(32,28,46,.05), 0 10px 28px -12px rgba(32,28,46,.20);
  transition: box-shadow 200ms var(--ease, ease), border-color 130ms var(--ease, ease);
}
.home2 .hm-composer:focus-within {
  border-color: var(--accent);
  box-shadow: 0 1px 2px rgba(32,28,46,.05), 0 16px 40px -14px rgba(32,28,46,.26);
}
.home2 .hm-composer textarea {
  display: block; width: 100%; border: 0; background: none; resize: none;
  padding: 18px 18px 2px; font: inherit; font-size: 16px; line-height: 1.5;
  color: var(--ink); outline: none; min-height: 56px; font-family: var(--font-ui);
}
.home2 .hm-composer textarea::placeholder { color: var(--ink-3); }
.home2 .hm-bar { display: flex; align-items: center; gap: 10px; padding: 8px 9px 9px 11px; }
.home2 .hm-grow { margin-left: auto; }

.home2 .hm-addmore {
  display: inline-flex; align-items: center; gap: 6px; border: 1px solid transparent;
  background: none; border-radius: var(--r-md); padding: 7px 9px; font-size: 13px;
  font-weight: var(--fw-med); color: var(--ink-3); cursor: pointer;
}
.home2 .hm-addmore:hover { background: var(--surface-2); color: var(--ink); }
.home2 .hm-addmore svg { width: 14px; height: 14px; flex: none; }
.home2 .hm-chev { transition: transform 200ms var(--ease, ease); }
.home2 .hm-addmore[aria-expanded="true"] .hm-chev { transform: rotate(180deg); }

/* The brief is collapsed by default — the goal alone is enough to draft. */
.home2 .hm-brief { display: none; border-top: 1px solid var(--line); padding: 14px 18px 0; gap: 13px; }
.home2 .hm-addmore[aria-expanded="true"] ~ .hm-brief,
.home2 .hm-brief.is-open { display: grid; }
.home2 .hm-brief-row { display: grid; gap: 5px; }
.home2 .hm-brief-row label {
  font-size: 11px; font-weight: var(--fw-bold); letter-spacing: .09em;
  text-transform: uppercase; color: var(--ink-3);
}
.home2 .hm-brief-row input {
  border: 1px solid var(--rule-strong, var(--line-strong)); border-radius: var(--r-md);
  background: var(--surface); padding: 9px 11px; font: inherit; font-size: 14px;
  color: var(--ink); outline: none; font-family: var(--font-ui);
}
.home2 .hm-brief-row input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-wash); }
.home2 .hm-brief-note { font-size: 12.5px; color: var(--ink-3); margin-top: 1px; }

/* Idle until there is something to send — the button reports state rather
   than inviting a click that cannot do anything. */
.home2 .hm-go {
  flex: none; width: 34px; height: 34px; display: grid; place-items: center;
  border: 1px solid var(--line); border-radius: var(--r-lg);
  background: var(--surface-2); color: var(--ink-3); cursor: pointer;
}
.home2 .hm-go svg { width: 16px; height: 16px; }
.home2 .hm-go.is-ready { background: var(--accent); border-color: var(--accent); color: #FFFFFF; }
.home2 .hm-go.is-ready:hover { background: var(--accent-ink); border-color: var(--accent-ink); }

/* The other ways in — weightless, so the composer keeps the page. */
.home2 .hm-modes { margin-top: 15px; display: flex; justify-content: center; flex-wrap: wrap; gap: 3px; }
.home2 .hm-mode {
  display: inline-flex; align-items: center; gap: 7px; padding: 7px 11px;
  border: 1px solid transparent; background: none; border-radius: var(--r-md);
  font-size: 13.5px; font-weight: var(--fw-med); color: var(--ink-3); cursor: pointer;
}
.home2 .hm-mode:hover { color: var(--ink); background: var(--surface); border-color: var(--line); }
.home2 .hm-mode svg { width: 14px; height: 14px; flex: none; }

/* Empty state only — once the checklist exists, global design is a row in
   it, and this line would be the same prompt twice. */
.home2 .hm-nudge {
  display: inline-flex; align-items: center; gap: 7px; margin-top: 22px;
  border: 0; background: none; padding: 7px 11px; border-radius: var(--r-md);
  font-size: 13.5px; font-weight: var(--fw-med); color: var(--accent-ink); cursor: pointer;
}
.home2 .hm-nudge:hover { background: var(--accent-wash); }
.home2 .hm-nudge svg { width: 15px; height: 15px; flex: none; }

.home2 .hm-below { padding: 0 30px 56px; }
.home2 .hm-section { padding-top: 26px; margin-top: 26px; border-top: 1px solid var(--line); }
.home2 .hm-sec-head { display: flex; align-items: baseline; gap: 12px; margin-bottom: 12px; }
.home2 .hm-sec-head h2 {
  font-size: 11px; font-weight: var(--fw-bold); letter-spacing: .1em;
  text-transform: uppercase; color: var(--ink-3);
}
.home2 .hm-count { font-size: 12.5px; color: var(--ink-3); }
.home2 .hm-sec-head .link { margin-left: auto; font-size: 13px; }

.home2 .hm-card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-lg); overflow: hidden; }

.home2 .hm-todo {
  display: flex; align-items: center; gap: 12px; width: 100%; text-align: left;
  padding: 13px 15px; border: 0; border-bottom: 1px solid var(--line);
  background: none; cursor: pointer;
}
.home2 .hm-todo:last-child { border-bottom: 0; }
.home2 .hm-todo:hover { background: var(--surface-2); }
.home2 .hm-todo-ico {
  flex: none; width: 30px; height: 30px; display: grid; place-items: center;
  border-radius: var(--r-md); background: var(--surface-2);
  border: 1px solid var(--line); color: var(--ink-2);
}
.home2 .hm-todo-ico svg { width: 15px; height: 15px; }
.home2 .hm-todo-main { min-width: 0; display: grid; gap: 1px; }
.home2 .hm-todo-main b { font-size: 14px; font-weight: var(--fw-semi); color: var(--ink);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.home2 .hm-todo-main span { font-size: 12.5px; line-height: 1.45; color: var(--ink-3); }
.home2 .hm-todo-chev { flex: none; margin-left: auto; color: var(--ink-3); }
.home2 .hm-todo:hover .hm-todo-chev { transform: translateX(2px); }

.home2 .hm-stats {
  display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid var(--line);
  border-radius: var(--r-lg); background: var(--surface); overflow: hidden;
}
.home2 .hm-stat { padding: 14px 15px; border-right: 1px solid var(--line); }
.home2 .hm-stat:last-child { border-right: 0; }
.home2 .hm-stat-label {
  font-size: 10px; font-weight: var(--fw-bold); letter-spacing: .08em;
  text-transform: uppercase; color: var(--ink-3);
}
.home2 .hm-stat-value {
  margin-top: 6px; font-size: 27px; line-height: 1; letter-spacing: -0.035em;
  font-weight: var(--fw-heavy, 800); font-variant-numeric: tabular-nums; color: var(--ink);
}
.home2 .hm-stat-delta { margin-top: 6px; font-size: 12px; color: var(--ink-3); }
.home2 .hm-stat-delta.is-up { color: var(--ok); font-weight: var(--fw-med); }

.home2 .hm-qrow { display: flex; align-items: center; gap: 12px; padding: 12px 15px; border-bottom: 1px solid var(--line); }
.home2 .hm-qrow:last-child { border-bottom: 0; }
.home2 .hm-qrow:hover { background: var(--surface-2); }
.home2 .hm-qrow-main { min-width: 0; display: grid; gap: 1px; }
.home2 .hm-qrow-main b { font-size: 14px; font-weight: var(--fw-semi); color: var(--ink);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.home2 .hm-qrow-main span { font-size: 12.5px; color: var(--ink-3); }
.home2 .hm-chip {
  margin-left: auto; flex: none; padding: 3px 8px; border-radius: var(--r-md); font-size: 10px;
  font-weight: var(--fw-bold); letter-spacing: .07em; text-transform: uppercase;
  border: 1px solid var(--line); background: var(--surface-2); color: var(--ink-3);
}
.home2 .hm-chip.is-live { background: var(--ok-wash); border-color: var(--ok-line); color: var(--ok); }
.home2 .hm-chip.is-setup { background: var(--accent-wash); border-color: var(--accent-line, var(--line)); color: var(--accent-ink); }

@media (max-width: 760px) {
  .home2.is-none .hm-top { padding: 20px 16px 56px; }
  .home2.is-has .hm-top { padding: 28px 16px 0; }
  .home2 .hm-below { padding: 0 16px 44px; }
  .home2.is-none .hm-h1 { font-size: 27px; }
  .home2.is-has .hm-h1 { font-size: 22px; }
  .home2 .hm-stats { grid-template-columns: 1fr 1fr; }
}
`;
