/* ═══════════════════════════════════════════════════════════════════════
   THE HANDOFF — one document, everything the dev needs.

   Composed from the SAME source as the mocks (base.mjs, shared.mjs,
   home.mjs), not copied from them, so the spec and the screens cannot
   drift apart. Everything that exists only here — the token map, the
   states, the decision log — lives in handoff-content.mjs.
   ═══════════════════════════════════════════════════════════════════════ */

import { writeFileSync, readFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

import { BASE_CSS, HOME_CSS } from "./base.mjs";
import { DEFAULTS, tokensBlock, contrast, contrastTable, sec, framed, SHARED_SCRIPTS } from "./build.mjs";
import { QUARTZ_TOKENS, QUARTZ_CSS, FACE } from "./quartz.mjs";
import { MELD_CSS, MELD_SCALE, meldRamp, FIGTREE_WHY, FIGURES_WHY } from "./meld.mjs";
import {
  mark, swatchRow, scaleTable, components,
  screenHome, screenRecs, screenDrafting, screenQuestions, screenOverview,
  screenExplainers, screenLogic, screenResults, screenEditor,
} from "./shared.mjs";
import { STATE_GALLERY_CSS, stateGallery } from "./states.mjs";
import { TOKEN_MAP, TOKEN_STATS, TOKEN_TRAPS, STATES, DECISIONS_CLOSED, DECISIONS_OPEN, FRAME_SPEC } from "./handoff-content.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
/* Output resolves relative to this file when it sits in _src (which is how
   the handoff package ships), so an unzipped copy rebuilds in place instead
   of writing to whoever generated it. WISKR_OUT overrides. */
const OUT_DIR = process.env.WISKR_OUT
  || (basename(HERE) === "_src" ? join(HERE, "..") : "/Users/chase/code/quizocalypse-builder/docs/design/brand-2026");
const OUT = join(OUT_DIR, "wiskr-handoff.html");
const F = FACE.figtree;
const L = "rail";

const light = {
  ...DEFAULTS, ...QUARTZ_TOKENS,
  "--font-display": F, "--font-ui": F, "--font-num": F,
};

/* Contrast is COMPUTED from the token values at build time. If a value
   changes, the number in the table changes with it — it is never typed. */
const PAIRS = [
  ["Ink on page", "--ink", "--page", 4.5, "§1.4.3 body text"],
  ["Ink 2 on page", "--ink-2", "--page", 4.5, "§1.4.3 body text"],
  ["Ink 3 on page", "--ink-3", "--page", 4.5, "§1.4.3 — the floor for text"],
  ["Ink 3 on surface 2", "--ink-3", "--surface-2", 4.5, "§1.4.3 on the recessed fill"],
  ["White on accent", "--on-accent", "--accent", 4.5, "§1.4.3 — primary button label"],
  ["Accent-ink on page", "--accent-ink", "--page", 4.5, "§1.4.3 — accent used AS TEXT"],
  ["Rule-strong on page", "--line-strong", "--page", 3, "§1.4.11 control boundary"],
  ["Accent on page", "--accent", "--page", 3, "§1.4.11 — focus ring / active bar"],
  ["Ok on page", "--ok", "--page", 4.5, "§1.4.3 status text"],
  ["Warn on page", "--warn", "--page", 4.5, "§1.4.3 status text"],
  ["Crit on page", "--crit", "--page", 4.5, "§1.4.3 status text"],
];

const HANDOFF_CSS = String.raw`
/* Handoff-only chrome: the token table, the state grid, the decision log. */
.tok-group { margin-top: 26px; }
.tok-group > h3 {
  font-size: 11px; font-weight: var(--fw-bold); letter-spacing: .1em; text-transform: uppercase;
  color: var(--ink-3); margin-bottom: 9px;
}
.tok-table { width: 100%; border-collapse: collapse; font-size: 13.5px;
  color: var(--ink); font-family: var(--font-ui); }
.tok-table th {
  text-align: left; padding: 8px 12px; font-size: 10.5px; font-weight: var(--fw-bold);
  letter-spacing: .09em; text-transform: uppercase; color: var(--ink-3);
  border-bottom: 1px solid var(--line-strong); background: var(--surface-2);
}
.tok-table td { padding: 9px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
.tok-table tr:last-child td { border-bottom: 0; }
.tok-name { font-weight: var(--fw-semi); white-space: nowrap; }
.tok-val { white-space: nowrap; color: var(--ink-2); font-variant-numeric: tabular-nums; }
.tok-v { display: inline-block; vertical-align: middle; }
.tok-ratio {
  display: inline-block; margin-left: 8px; padding: 1px 5px; border-radius: 3px;
  background: var(--ok-wash); border: 1px solid var(--ok-line); color: var(--ok);
  font-size: 10.5px; font-weight: var(--fw-bold); vertical-align: middle;
}
.tok-ratio.is-low { background: var(--warn-wash); border-color: var(--warn-line); color: var(--warn-ink); }
.tok-ratio.is-dec { background: var(--surface-2); border-color: var(--line); color: var(--ink-3); }
.trap { display: grid; gap: 10px; margin-top: 24px; }
.trap-row {
  padding: 13px 16px; border: 1px solid var(--line); border-left: 2px solid var(--warn);
  border-radius: var(--r-md); background: var(--surface);
}
.trap-row b { display: block; font-size: 14px; font-weight: var(--fw-semi); margin-bottom: 4px; }
.trap-row p { font-size: 13.5px; line-height: 1.6; color: var(--ink-2); }
.stat-line {
  display: flex; flex-wrap: wrap; gap: 26px; margin: 20px 0 4px; padding: 15px 18px;
  border: 1px solid var(--line); border-radius: var(--r-lg); background: var(--surface-2);
}
.stat-line div { display: grid; gap: 2px; }
.stat-line b { font-size: 25px; line-height: 1; letter-spacing: -0.03em;
  font-weight: var(--fw-heavy, 800); font-variant-numeric: tabular-nums; color: var(--ink); }
.stat-line span { font-size: 11px; font-weight: var(--fw-bold); letter-spacing: .08em;
  text-transform: uppercase; color: var(--ink-3); }
.tok-sites { text-align: right; font-variant-numeric: tabular-nums; color: var(--ink-3); white-space: nowrap; }
.tok-what { color: var(--ink-2); line-height: 1.5; }
.tok-chip {
  display: inline-block; width: 15px; height: 15px; border-radius: 3px;
  border: 1px solid var(--line); vertical-align: -3px; margin-right: 7px;
}
.tok-new {
  display: inline-block; margin-left: 7px; padding: 1px 5px; border-radius: 3px;
  background: var(--accent-wash); border: 1px solid var(--accent-line);
  color: var(--accent-ink); font-size: 9.5px; font-weight: var(--fw-bold);
  letter-spacing: .07em; text-transform: uppercase; vertical-align: 1px;
}

.states { display: grid; gap: 16px; }
.state-card { border: 1px solid var(--line); border-radius: var(--r-lg); overflow: hidden; }
.state-card > h3 {
  padding: 11px 15px; font-size: 14px; font-weight: var(--fw-semi);
  background: var(--surface-2); border-bottom: 1px solid var(--line);
}
.state-row { display: grid; grid-template-columns: 130px 1fr; gap: 14px;
  padding: 10px 15px; border-bottom: 1px solid var(--line); font-size: 13.5px; }
.state-row:last-child { border-bottom: 0; }
.state-row b { font-weight: var(--fw-semi); }
.state-row span { color: var(--ink-2); line-height: 1.55; }

.dec { display: grid; gap: 10px; }
.dec-row { display: grid; grid-template-columns: 190px 1fr auto; gap: 14px; align-items: baseline;
  padding: 11px 14px; border: 1px solid var(--line); border-radius: var(--r-md); background: var(--surface); }
.dec-row b { font-weight: var(--fw-semi); font-size: 14px; }
.dec-row p { color: var(--ink-2); font-size: 13.5px; line-height: 1.55; }
.dec-when { font-size: 11.5px; color: var(--ink-3); font-variant-numeric: tabular-nums; white-space: nowrap; }
.dec-open { border-left: 2px solid var(--warn); }
.dec-open .dec-when { color: var(--warn-ink); font-weight: var(--fw-semi); }
.dec-rec { margin-top: 6px; font-size: 13px; color: var(--ink); }
.dec-rec b { font-weight: var(--fw-bold); }

.frame-table { width: 100%; border-collapse: collapse; font-size: 13.5px;
  color: var(--ink); font-family: var(--font-ui); }
.frame-table th { text-align: left; padding: 9px 13px; font-size: 10.5px; font-weight: var(--fw-bold);
  letter-spacing: .09em; text-transform: uppercase; color: var(--ink-3);
  border-bottom: 1px solid var(--line-strong); background: var(--surface-2); }
.frame-table td { padding: 10px 13px; border-bottom: 1px solid var(--line); vertical-align: top; }
.frame-table .n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.frame-table tr:last-child td { border-bottom: 0; }
.frame-table .muted { color: var(--ink-2); line-height: 1.5; }

.toc { display: grid; grid-template-columns: repeat(auto-fit, minmax(215px, 1fr)); gap: 3px;
  margin-top: 22px; padding: 16px; border: 1px solid var(--line);
  border-radius: var(--r-lg); background: var(--surface-2); }
.toc a { display: flex; gap: 10px; padding: 6px 9px; border-radius: var(--r-sm);
  font-size: 13.5px; color: var(--ink-2); text-decoration: none; }
.toc a:hover { background: var(--surface); color: var(--ink); }
.toc i { font-style: normal; color: var(--ink-3); font-variant-numeric: tabular-nums;
  font-weight: var(--fw-semi); min-width: 20px; }

.callout {
  margin: 22px 0; padding: 15px 18px; border-radius: var(--r-lg);
  border: 1px solid var(--line); border-left: 2px solid var(--accent);
  background: var(--surface-2); font-size: 14px; line-height: 1.65; color: var(--ink-2);
}
.callout b { color: var(--ink); font-weight: var(--fw-semi); }
.callout code, .lede code, .tok-what code, .state-row code, .dec-row code {
  font-family: var(--font-ui); font-weight: var(--fw-semi); color: var(--accent-ink);
  font-variant-numeric: tabular-nums;
}
@media (max-width: 760px) {
  .dec-row, .state-row { grid-template-columns: 1fr; }
  .dec-when { order: -1; }
}
`;

/* Now → Then. The ratio badge appears ONLY on tokens that actually carry
   text — putting "1.00:1" beside a page background would read as a failure
   when it is simply not a question. --qz-accent is measured the other way
   round (white ON it), because that is how it is used. */
const isColor = v => /^#[0-9A-Fa-f]{6}$/.test(v);
const TEXT_GROUPS = new Set(["Ink", "Status"]);
const DECORATIVE = new Set(["--qz-ink-25"]);

const ratioCell = (group, token, v) => {
  if (!isColor(v)) return "";
  const onWhite = TEXT_GROUPS.has(group) || token === "--qz-accent-ink";
  const whiteOn = token === "--qz-accent";
  if (!onWhite && !whiteOn) return "";
  const r = whiteOn ? contrast("#FFFFFF", v) : contrast(v, "#FFFFFF");
  /* ink-25 is decoration by definition, so it is marked, not failed. */
  const cls = DECORATIVE.has(token) ? " is-dec" : (r >= 4.5 ? "" : " is-low");
  return `<span class="tok-ratio${cls}" title="${whiteOn ? "white on this colour" : "this colour on white"}">${r.toFixed(2)}:1</span>`;
};
const swatch = (v) => isColor(v) ? `<span class="tok-chip" style="background:${v}"></span>` : "";
const trim = (v) => v.length > 34 ? v.slice(0, 32) + "\u2026" : v;

const tokenSection = () => TOKEN_MAP.map(([group, rows]) => `
  <div class="tok-group">
    <h3>${group}</h3>
    <div class="table-wrap">
      <table class="tok-table">
        <thead><tr>
          <th scope="col">Token</th>
          <th scope="col">Now</th>
          <th scope="col">Then</th>
          <th scope="col">What it is</th>
          <th scope="col" class="tok-sites">Sites</th>
        </tr></thead>
        <tbody>
          ${rows.map(([name, now, then, what, sites]) => `<tr>
            <td class="tok-name">${name}</td>
            <td class="tok-val">${swatch(now)}<span class="tok-v">${trim(now)}</span>${ratioCell(group, name, now)}</td>
            <td class="tok-val">${swatch(then)}<span class="tok-v">${trim(then)}</span>${ratioCell(group, name, then)}</td>
            <td class="tok-what">${what}</td>
            <td class="tok-sites">${sites}</td>
          </tr>`).join("\n          ")}
        </tbody>
      </table>
    </div>
  </div>`).join("\n");

const html = `<title>Wiskr — design handoff</title>
<style>
${readFileSync(join(HERE, "fonts", "figtree.css"), "utf8")}

${BASE_CSS}

${HOME_CSS}

${tokensBlock(":root", light)}

/* Single-theme by owner decision (2026-08-09). */
:root { color-scheme: light; }

${QUARTZ_CSS}
${MELD_CSS}
${HANDOFF_CSS}
${STATE_GALLERY_CSS}
</style>

<div class="doc">

  <header class="masthead">
    <div class="mh-top">
      <span class="mh-mark">${mark("solid")}</span>
      <span class="mh-name">Wiskr</span>
      <span class="mh-index">Design handoff &middot; v1 &middot; 9 Aug 2026</span>
    </div>
    <h1 class="mh-title">Everything, in one document</h1>
    <p class="mh-thesis">The admin surface, specified: one typeface, one accent, one spacing scale, and a token map that says exactly what to change and how many places to change it. The screens below are not pictures &mdash; they are built from the same CSS the spec describes, so the two cannot disagree.</p>
    <div class="mh-facts">
      <span class="mh-fact">Figtree, self-hosted</span>
      <span class="mh-fact">Violet accent, one</span>
      <span class="mh-fact">99 tokens mapped</span>
      <span class="mh-fact">Light only</span>
      <span class="mh-fact">4 decisions open</span>
    </div>
    <nav class="toc" aria-label="Contents">
      <a href="#s01"><i>01</i>How to read this</a>
      <a href="#s02"><i>02</i>Typeface</a>
      <a href="#s03"><i>03</i>Colour &amp; contrast</a>
      <a href="#s04"><i>04</i>Shape, space &amp; depth</a>
      <a href="#s05"><i>05</i>The parts</a>
      <a href="#s06"><i>06</i>Token map</a>
      <a href="#s07"><i>07</i>Component states</a>
      <a href="#s08"><i>08</i>Phone &amp; desktop</a>
      <a href="#s09"><i>09</i>Home</a>
      <a href="#s10"><i>10</i>Build &mdash; the pool</a>
      <a href="#s11"><i>11</i>Generating</a>
      <a href="#s12"><i>12</i>Questions</a>
      <a href="#s13"><i>13</i>Explainers</a>
      <a href="#s14"><i>14</i>Logic</a>
      <a href="#s15"><i>15</i>Results &amp; preview</a>
      <a href="#s16"><i>16</i>The editor</a>
      <a href="#s17"><i>17</i>Live states</a>
      <a href="#s18"><i>18</i>Decisions</a>
    </nav>
  </header>

  <div id="s01">${sec("01", "How to read this", "Start here — it changes what the rest of the document means.", `
    <p class="lede">This is a <strong>value swap, not a rename</strong>. The 99 <code>--qz-*</code> token names in the admin sheet today are the same 99 names after this change &mdash; only their values move. That is the whole reason this can ship incrementally instead of as a rewrite. Three tokens are genuinely new (<code>--qz-rule-strong</code>, <code>--qz-phone-r</code>, <code>--qz-home-ground</code>) and one is scheduled for removal (<code>--qz-font-mono</code>, 35 sites, still an open decision).</p>
    <div class="callout">
      <b>Every screen below is live CSS, not a screenshot.</b> They are assembled from the same <code>base.mjs</code> that generates this document's own styles, so a rule described in section 03 and the pixels in section 15 are guaranteed to be the same rule. Where a screen is interactive &mdash; the device toggles, the explainer steppers, the composer &mdash; it actually works. Click it.
    </div>
    <ul class="rule-list">
      <li><span class="rl-n">R1</span><span><b>One accent, and it always means the same thing.</b> Violet marks somewhere you can act. It is never decoration, never a category colour, never a second brand. Status colours (ok / warn / crit) are a separate axis and never substitute for it.</span></li>
      <li><span class="rl-n">R2</span><span><b>Contrast is measured, never asserted.</b> Every pair in section 03 is computed from the token values at build time. If someone changes a value, the number moves with it.</span></li>
      <li><span class="rl-n">R3</span><span><b>Inside the builder, our colour stands down.</b> The merchant is looking at their own brand; a violet selection ring beside their terracotta button is two brands arguing. The editor re-points the accent tokens at the ink ladder &mdash; components do not change, only tokens.</span></li>
      <li><span class="rl-n">R4</span><span><b>White is the page. Home is the one exception</b> (<code>--qz-home-ground</code>). A fully tinted variant was built and rejected &mdash; see section 17.</span></li>
    </ul>`)}</div>

  <div id="s02">${sec("02", "Typeface", "One family, no monospace anywhere.", `
    <div class="spec-pair">
      <div class="spec-card">
        <p class="spec-role">Display &amp; headings</p>
        <p class="spec-name" style="font-family:var(--font-display)">Figtree</p>
        <p class="spec-glyphs" style="font-family:var(--font-display)">Aa Gg Rk 0123456789 $886 46% 20/23</p>
        <p class="spec-why">${FIGTREE_WHY}</p>
      </div>
      <div class="spec-card">
        <p class="spec-role">Figures &amp; labels</p>
        <p class="spec-name" style="font-family:var(--font-num)">Figtree &middot; tabular</p>
        <p class="spec-glyphs" style="font-family:var(--font-num);font-variant-numeric:tabular-nums">$886.00 &middot; 20/23 &middot; 46%</p>
        <p class="spec-why">${FIGURES_WHY}</p>
      </div>
    </div>
    <div class="ramp">
      ${meldRamp(F).map(([tag, style, text]) => `<div class="ramp-line"><span class="ramp-tag">${tag}</span><span class="ramp-txt" style="${style}">${text}</span></div>`).join("\n      ")}
    </div>
    ${scaleTable(MELD_SCALE)}
    <div class="callout">
      <b>Self-hosted, base64-inlined.</b> Figtree is SIL OFL. Nothing here loads from a font CDN, so there is no silent-fallback failure mode and no third-party request on the admin's critical path.
    </div>`)}</div>

  <div id="s03">${sec("03", "Colour &amp; contrast", "One accent. Every ratio below is computed, not typed.", `
    <p class="lede">The palette is a violet accent over a neutral with a slight violet bias &mdash; a pure grey next to a violet accent reads as unconsidered, and the bias is what makes the neutrals look chosen. <strong>The accent is used as a fill and as a boundary, but only <code>--qz-accent-ink</code> is used as body text</strong>: the accent itself is 5.6:1 on white, which passes for large text and fails the 4.5:1 body minimum, so the darker step exists specifically for that.</p>
    ${swatchRow([
      ["Page", light["--page"], "--qz-bg"],
      ["Home ground", light["--home-ground"], "--qz-home-ground"],
      ["Surface 2", light["--surface-2"], "--qz-surface-2"],
      ["Ink", light["--ink"], "--qz-ink"],
      ["Ink 3", light["--ink-3"], "--qz-ink-3"],
      ["Rule", light["--line"], "--qz-rule"],
      ["Rule strong", light["--line-strong"], "--qz-rule-strong"],
      ["Accent", light["--accent"], "--qz-accent"],
      ["Accent ink", light["--accent-ink"], "--qz-accent-ink"],
      ["Accent wash", light["--accent-wash"], "--qz-accent-wash"],
    ])}
    <div class="contrast">${contrastTable(
      PAIRS.map(([label, fg, bg, need, rule]) => [label, contrast(light[fg] ?? fg, light[bg] ?? bg), need, rule]),
    )}</div>`)}</div>

  <div id="s04">${sec("04", "Shape, space &amp; depth", "Squared, tight, and almost flat.", `
    <p class="lede">Radii are <strong>4 / 6 / 8</strong> and the pill is 6px &mdash; <strong>nothing in this system is a full pill</strong>, which is the single biggest reason it reads more grown-up than the current admin. Depth is two elevations and both are structural: <code>--qz-e-1</code> for a resting card, <code>--qz-e-2</code> for anything that floats above the page. Nothing else casts a shadow. The one deliberate exception is the Home composer, which takes a 14px radius and a real shadow because it is the one thing on that page you are meant to type into.</p>
    <div class="tiles">
      <article class="tile"><p class="tile-label">Radius</p><div class="tile-demo">
        <span class="r-demo" style="border-radius:4px"></span><span class="r-demo" style="border-radius:6px"></span><span class="r-demo" style="border-radius:8px"></span>
      </div><p>4px marks, 6px controls, 8px containers. One step per role.</p></article>
      <article class="tile"><p class="tile-label">Elevation</p><div class="tile-demo">
        <span class="elev-box" style="box-shadow:var(--e-1)"></span><span class="elev-box" style="box-shadow:var(--e-2)"></span>
      </div><p>Resting, and floating. There is no third.</p></article>
      <article class="tile"><p class="tile-label">Rules</p><div class="tile-demo">
        <span class="line-demo" style="background:var(--line)"></span><span class="line-demo" style="background:var(--line-strong)"></span>
      </div><p>Hairline separates; strong bounds a control at 3:1.</p></article>
    </div>`)}</div>

  <div id="s05">${sec("05", "The parts", "Every screen in this document is assembled from only these.", components())}</div>

  <div id="s06">${sec("06", "Token map", "What to change, and how many places it lands.", `
    <p class="lede">Every row below was <strong>counted from the real stylesheets</strong>, not estimated: <code>app/styles/quizocalypse.css</code> and <code>quiz-runtime.css</code> define ${TOKEN_STATS.defined} <code>--qz-*</code> tokens with ${TOKEN_STATS.sites.toLocaleString()} <code>var()</code> references between them. <strong>The ${TOKEN_MAP.reduce((n, [, r]) => n + r.length, 0)} rows here carry ${TOKEN_STATS.mapped.toLocaleString()} of those &mdash; ${Math.round(TOKEN_STATS.mapped / TOKEN_STATS.sites * 100)}% of every call site in the product.</strong> That is the whole argument for this being a value swap rather than a rewrite: change these and most of the admin moves.</p>
    <div class="stat-line">
      <div><b>${TOKEN_STATS.defined}</b><span>Tokens defined</span></div>
      <div><b>${TOKEN_STATS.sites.toLocaleString()}</b><span>Call sites</span></div>
      <div><b>${Math.round(TOKEN_STATS.mapped / TOKEN_STATS.sites * 100)}%</b><span>Covered by this table</span></div>
      <div><b>${TOKEN_STATS.dead}</b><span>Defined but never used</span></div>
    </div>
    <p class="lede"><b>Now</b> is what the sheet holds today; <b>Then</b> is Quartz. Ratio badges appear only on tokens that <strong>carry text</strong>, computed at build time &mdash; amber means under 4.5:1, so it cannot be body copy. <code>--qz-accent</code> is measured the other way round (white on it), because that is how it is used; <code>--qz-ink-25</code> is grey because it is decoration by definition.</p>
    ${tokenSection()}

    <h3 class="tok-group" style="margin-bottom:4px">What the count turned up</h3>
    <p class="lede">Five findings that are not colour choices, and that a swap done row-by-row would miss.</p>
    <div class="trap">
      ${TOKEN_TRAPS.map(([what, why]) => `<div class="trap-row"><b>${what}</b><p>${why}</p></div>`).join("\n      ")}
    </div>

    <div class="callout">
      <b>One addition that is not cosmetic: a 3:1 boundary token.</b> There is no such token in the sheet today, so control borders use <code>--qz-rule</code> &mdash; a hairline that fails WCAG §1.4.11, which requires 3:1 for the boundary of anything you can operate. Add <code>--qz-rule-strong: #948EA6</code> (3.14:1) and move inputs, checkboxes and radios onto it; decorative separators stay on <code>--qz-rule</code>.
    </div>`)}</div>

  <div id="s07">${sec("07", "Component states", "The mocks show rest. This is everything else.", `
    <p class="lede">A component is not specified until its states are. Two rules run through all of them: <strong>focus is never removed</strong> and never replaced by colour alone, and <strong>a disabled control stays readable</strong> &mdash; disabled means unavailable, not invisible, so it keeps 5.6:1 rather than fading to grey.</p>
    <div class="states">
      ${STATES.map(([name, rows]) => `<article class="state-card">
        <h3>${name}</h3>
        ${rows.map(([state, spec]) => `<div class="state-row"><b>${state}</b><span>${spec}</span></div>`).join("\n        ")}
      </article>`).join("\n      ")}
    </div>`)}</div>

  <div id="s08">${sec("08", "Phone &amp; desktop", "Two frames, exact sizes, and one fit rule.", `
    <p class="lede">The quiz is never a web page &mdash; it is a modal over someone's storefront or a block inside it. So the preview shows <strong>the container, not a browser window</strong>: simulating one invents space that will not exist and hides the only question a merchant has, which is whether it fits where they are putting it.</p>
    <div class="table-wrap">
      <table class="frame-table">
        <thead><tr><th scope="col">Frame</th><th scope="col" class="n">Width</th><th scope="col" class="n">Height</th><th scope="col" class="n">Clamp</th><th scope="col" class="n">Tokens</th><th scope="col">Where the number comes from</th></tr></thead>
        <tbody>
          ${FRAME_SPEC.map(([n, w, h, clamp, tok, src]) => `<tr>
            <th scope="row">${n}</th><td class="n">${w}</td><td class="n">${h}</td>
            <td class="n">${clamp}</td><td class="n">${tok}</td><td class="muted">${src}</td>
          </tr>`).join("\n          ")}
        </tbody>
      </table>
    </div>
    <ul class="rule-list">
      <li><span class="rl-n">F1</span><span><b>The phone is borderless and solid.</b> No bezel, no chrome, no caption, 20px radius, opaque to all four edges. The device drawing was decoration around a number that was already doing the job.</span></li>
      <li><span class="rl-n">F2</span><span><b>Fit, never stretch.</b> <code>z = min(1, availW/w, availH/h)</code>, applied as <code>transform: scale()</code>, with the layout box set to the <em>scaled</em> size so the painted box and the layout box agree. Recomputed on resize and whenever the toggle flips. Never larger than life size.</span></li>
      <li><span class="rl-n">F3</span><span><b>The preview never leaves the screen.</b> <code>position: sticky</code> with a <code>dvh</code>-based cap, so it stays visible while the editor column scrolls.</span></li>
      <li><span class="rl-n">F4</span><span><b>A borderless preview needs a ground it cannot match.</b> The merchant's palette is theirs and can legitimately be pure white, so the stage behind it is recessed and the frame carries a soft elevation. Without both, a white-brand merchant sees nothing at all.</span></li>
      <li><span class="rl-n">F5</span><span><b>The zoom readout reads the applied <code>--z</code>.</b> Never a hardcoded percentage &mdash; that is how it came to print &ldquo;100%&rdquo; over a preview painting at 92%.</span></li>
    </ul>
    <div class="callout">
      <b>The launcher modal is 720px wide and the runtime breakpoint is 900px.</b> So a quiz opened from the floating launcher renders <b>mobile</b> tokens on a desktop machine, always. That is either deliberate or a bug nobody has looked at, but either way a &ldquo;Desktop&rdquo; toggle showing desktop tokens for a modal-mode quiz would be showing the merchant something their shoppers never see. Desktop therefore means the 960 &times; 700 inline band. The modal's geometry stays declared so a third preview mode is cheap to add &mdash; <b>and it should be added</b>, because a merchant embedding via the launcher currently cannot preview what ships.
    </div>`)}</div>

  <div id="s09">${sec("09", "Home", "One page, two states. The composer is the anchor.", `
    <p class="lede">Before the first quiz: the composer, optically centred, nothing else. After it: <strong>the same composer, unchanged</strong>, with sections below. It never moves horizontally, resizes, or restyles between the two &mdash; that is what lets the page grow around it without reading as a different screen. The heading is the only thing that resizes, because 37px is a welcome on a blank page and the same 37px above a checklist is the page shouting over its own content.</p>
    <p class="lede"><strong>Home is the one tinted page in the product</strong> (<code>--qz-home-ground</code>, #F5F4F8). The checklist is ordered by distance to revenue: a built-but-unpublished quiz earns nothing, a published-but-unreachable quiz earns nothing, captured emails with nowhere to go are being lost, and design is polish that cascades. All of it in ink &mdash; no alarm colour on the first screen after sign-in.</p>
    ${framed(`<b>Home</b> &middot; first run, before any quiz exists`, screenHome(L, "none"))}
    ${framed(`<b>Home</b> &middot; the same composer, once there is work to come back to`, screenHome(L, "has"))}`)}</div>

  <div id="s10">${sec("10", "Build &mdash; the product pool", "Chrome drops to a step bar; you are building now, not browsing.", framed(`<b>Build &middot; step 1</b> &middot; what the quiz recommends`, screenRecs(L)))}</div>

  <div id="s11">${sec("11", "While it generates", "Was a spinner alone in an empty field.", `
    <p class="lede">Four real <code>gen_progress</code> checkpoints in a bounded card, so the wait has a shape instead of a spinner. <strong>The card deliberately offers no way out</strong> &mdash; no elapsed timer, no &ldquo;you can leave this page&rdquo;. The escape appears only when it is actually warranted, at the 200s <code>genStalled</code> threshold, which is drawn in <a class="link" href="#s17">Live states</a>. Until then the checkpoints are the whole message.</p>
  ` + framed(`<b>Build &middot; generating</b> &middot; bounded card, the four real gen_progress checkpoints`, screenDrafting(L)))}</div>

  <div id="s12">${sec("12", "Questions &mdash; flow, preview &amp; overview", "Editing chrome stays out of the shopper's frame.", `
    <p class="lede">Six fixes against the current screen: question text clamps to <strong>two lines at a word boundary</strong> instead of cutting mid-word, so seven questions are actually distinguishable; the answer-type control moved <strong>out of the canvas onto the question it belongs to</strong>; <strong>Add answer and reorder live outside the phone</strong>, because edit chrome inside the frame teaches merchants their shoppers will see it; the &ldquo;SINGLE SELECT&rdquo; repeated on all seven rows is replaced by the answer count, which actually differs; reorder is <strong>one grip on hover</strong> rather than two stacked arrows on every row; and the accent is spent once, on the question that decides the result.</p>
    ${framed(`<b>Build &middot; questions</b> &middot; flow on the left, the merchant's brand on the right`, screenQuestions(L))}
    <p class="lede" style="margin-top:26px">The overview was cards that left roughly 40% of every row empty and buried <em>Add answer</em> in the bottom-right corner. This is a <strong>real grid</strong> &mdash; number, question, answers, count, type and role &mdash; with a sticky header, answers that fill the space they were given, and an insert affordance that appears <strong>on the divider</strong> rather than floating in the gutter. The decider is marked once, in the number.</p>
    ${framed(`<b>Build &middot; questions &middot; overview</b> &middot; every column earns its width`, screenOverview(L))}`)}</div>

  <div id="s13">${sec("13", "The explainers", "Both sections get one. No step scrolls.", `
    <p class="lede">Rules and Questions each get a <strong>How it works</strong> button carrying the &#10022; that already means &ldquo;we can explain this&rdquo; in the system. Both are four steps, and <strong>every panel is sized to one fixed body height</strong> &mdash; the chains that used to run vertically and get clipped now run horizontally, and each step is trimmed to a single idea. Click the chips or Next.</p>
    ${framed(`<b>Explainers</b> &middot; click through &mdash; nothing scrolls`, screenExplainers())}`)}</div>

  <div id="s14">${sec("14", "The hard screen &mdash; logic", "Rules run first, in order. Then every question narrows on one attribute.", framed(`<b>Build &middot; step 3</b> &middot; rules and question roles`, screenLogic(L)))}</div>

  <div id="s15">${sec("15", "Results &amp; the live preview", "The one screen where both frames matter.", framed(`<b>Build &middot; step 4</b> &middot; <span class="cap-cta">click Phone / Desktop in the preview &rarr;</span> 390&times;745 phone, or the 960&times;700 inline band`, screenResults(L)))}</div>

  <div id="s16">${sec("16", "The editor", "Where our colour stands down.", `
    <p class="lede"><strong>Inside the builder, our colour stands down.</strong> The merchant is looking at their own brand in the preview &mdash; a violet selection ring next to their terracotta button is two brands arguing over the same screen. So the editor re-points the accent tokens at the ink ladder: selection, focus, the active section and the Publish button all go neutral, and the only saturated colour left is the design being made. <strong>Nothing about the components changes; only the tokens move.</strong> In the sheet this is one <code>[data-qz-surface="editor"]</code> block.</p>
    ${framed(`<b>Editor</b> &middot; <span class="cap-cta">click Phone / Desktop above the stage &rarr;</span> our chrome neutral, the merchant's brand in the preview`, screenEditor(L))}`)}</div>

  <div id="s17">${sec("17", "Live states", "Found by auditing the code, not by imagining what might exist.", `
    <p class="lede">Every screen above is drawn at rest. <strong>These are the states the product actually enters and that nothing had a design for</strong> &mdash; each one was found by reading the code, and each cites the line that produces it. They are the difference between a spec that looks complete and one that is.</p>
    <div class="callout">
      <b>Two rules run through all of them.</b> A failure that risks the merchant's work &mdash; a failed save, a blocked publish &mdash; <b>never auto-dismisses and never fades</b>; it persists until it is resolved, because the only copy of that work is the open tab. And <b>every error names its way out</b>: a retry, an escape, or a specific node to go fix. An error that only reports is an error the merchant cannot act on.
    </div>
    ${stateGallery()}`)}</div>

  <div id="s18">${sec("18", "Decisions", "Settled, and still open.", `
    <p class="lede">Everything settled, with the date it was settled, so nothing gets relitigated by accident. <strong>The four open rows are the only things standing between this and a complete spec</strong> &mdash; none of them blocks starting, and three of them are counting exercises rather than design questions.</p>
    <h3 class="tok-group" style="margin-bottom:9px">Settled</h3>
    <div class="dec">
      ${DECISIONS_CLOSED.map(([what, why, when]) => `<div class="dec-row">
        <b>${what}</b><p>${why}</p><span class="dec-when">${when}</span>
      </div>`).join("\n      ")}
    </div>
    <h3 class="tok-group" style="margin-bottom:9px">Open &mdash; needs an owner call</h3>
    <div class="dec">
      ${DECISIONS_OPEN.map(([what, sites, why, rec]) => `<div class="dec-row dec-open">
        <b>${what}</b>
        <p>${why}<span class="dec-rec"><b>Recommend:</b> ${rec}</span></p>
        <span class="dec-when">${sites ? sites + " sites" : "design call"}</span>
      </div>`).join("\n      ")}
    </div>`)}</div>

  <footer class="foot">
    <div class="foot-cols">
      <div>
        <h3>What this fixes about today's UI</h3>
        <ul>
          <li>Removes the typewriter look: no monospace anywhere, figures are Figtree with tabular numerals so columns still align.</li>
          <li>Gives control boundaries a token that actually meets 3:1 &mdash; today they are hairlines at 1.3:1.</li>
          <li>Stops our accent competing with the merchant's brand inside the builder.</li>
          <li>Makes every preview an exact, undistorted size that always fits and never leaves the screen.</li>
          <li>Cuts the pill: 4/6/8 radii throughout, which is most of why the current admin reads younger than the product is.</li>
        </ul>
      </div>
      <div>
        <h3>Where it could bite</h3>
        <ul>
          <li>The four open decisions touch 88 call sites between them; none is a blind find-and-replace.</li>
          <li>A merchant embedding via the floating launcher currently has no way to preview the modal &mdash; the geometry is declared but no toggle reaches it.</li>
          <li>Dark mode is cut, not deferred. Reviving it needs a fresh contrast pass; it was never audited against the real call sites.</li>
          <li>The shopper progress bar is unspecified, and it appears on every question screen.</li>
        </ul>
      </div>
    </div>
    <p class="sources"><b>Grounded in:</b> WCAG 2.2 §1.4.3 contrast-minimum (4.5:1 body, 3:1 large) and §1.4.11 non-text contrast (3:1 for control boundaries) &mdash; every pair in section 03 is measured from the token values at build time, not eyeballed; NN/g on minimizing cognitive load and on progressive disclosure; and the working consensus across current product design systems that one spacing scale, one type ramp and a restrained accent are what make new screens feel native. Typefaces are open-licence (SIL OFL) and self-hosted, so nothing here depends on a font CDN.</p>
  </footer>

</div>
${SHARED_SCRIPTS}
`;

writeFileSync(OUT, html);
console.log(`handoff → ${OUT}  ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB`);
