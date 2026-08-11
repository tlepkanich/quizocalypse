import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { BASE_CSS, HOME_CSS } from "./base.mjs";
import {
  screenHome, screenRecs, screenLogic, screenResults,
  screenEditor, screenDrafting, screenQuestions, screenOverview, screenExplainers,
  components, scaleTable, swatchRow, mark,
} from "./shared.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
/* Output resolves relative to this file when it sits in _src (which is how
   the handoff package ships), so an unzipped copy rebuilds in place instead
   of writing to whoever generated it. WISKR_OUT overrides. */
const OUT_DIR = process.env.WISKR_OUT
  || (basename(HERE) === "_src" ? join(HERE, "..") : "/Users/chase/code/quizocalypse-builder/docs/design/brand-2026");

mkdirSync(OUT_DIR, { recursive: true });

export const fontCss = (names) =>
  names.map((n) => readFileSync(join(HERE, "fonts", `${n}.css`), "utf8")).join("\n");

/* Defaults every direction inherits; a direction overrides what it means. */
export const DEFAULTS = {
  "--fw-normal": "400", "--fw-med": "500", "--fw-semi": "600", "--fw-bold": "700",
  "--r-sm": "6px", "--r-md": "10px", "--r-lg": "14px", "--r-pill": "999px",
  /* The phone screen's own radius. Device geometry, not UI geometry — it is
     the corner of a handset, so it does not follow the --r-* scale. */
  "--phone-r": "20px",
  /* Home is the only tinted page; every other surface is --page white. */
  "--home-ground": "#F5F4F8",
  "--ui-size": "15px", "--h1-size": "30px",
  "--rail-w": "232px", "--rail-pad": "16px 12px",
  "--nav-pad": "8px 11px", "--nav-r": "8px", "--nav-size": "13.5px",
  "--page-pad": "30px 34px 40px", "--page-gap": "22px", "--flow-pad": "30px 34px 44px",
  "--btn-pad": "9px 16px", "--btn-pad-sm": "6px 12px", "--btn-r": "8px", "--btn-size": "13.5px",
  "--btn-track": "0", "--btn-shadow": "none",
  "--card-r": "12px", "--card-pad": "18px", "--card-shadow": "none",
  "--stat-gap": "14px", "--stat-size": "34px",
  "--row-pad": "12px 0", "--pill-r": "999px", "--pill-track": ".02em", "--pill-case": "none",
  "--bar-r": "4px 4px 0 0",
  "--input-pad": "9px 12px", "--input-r": "8px",
  "--stepper-pad": "12px 22px", "--steps-gap": "40px", "--step-r": "999px",
  "--tip-pad": "12px 14px",
  "--seg-gap": "2px", "--seg-pad": "3px", "--seg-r": "10px", "--seg-btn-r": "7px", "--seg-on-shadow": "none",
  "--pick-gap": "6px", "--pick-pad": "11px 13px", "--pick-r": "9px", "--check-r": "5px",
  "--table-size": "13.5px", "--th-pad": "9px 14px", "--td-pad": "10px 14px",
  "--page-pad-x": "30px",
  "--group-rule": "1px solid var(--line-strong)",
  "--tag-none-style": "italic",
  "--q-r": "12px", "--q-btn-r": "9px",
};

export const tokensBlock = (sel, map) =>
  `${sel} {\n${Object.entries(map).map(([k, v]) => `  ${k}: ${v};`).join("\n")}\n}`;

/* Measured, not asserted: ratios below are computed from the token values. */
const hex2rgb = (h) => {
  const s = h.trim().replace("#", "");
  const f = s.length === 3 ? s.split("").map((c) => c + c).join("") : s;
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16));
};
const lum = (h) =>
  hex2rgb(h)
    .map((v) => v / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0);
export const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

export const contrastTable = (rows) => `
<div class="table-wrap">
  <table class="spec">
    <thead><tr><th scope="col">Pair</th><th scope="col" class="num">Measured</th><th scope="col" class="num">Required</th><th scope="col">Rule it satisfies</th></tr></thead>
    <tbody>
      ${rows
        .map(([pair, got, need, rule]) => {
          const ok = got >= need;
          return `<tr><th scope="row">${pair}</th><td class="num"><b>${got.toFixed(2)}:1</b> <span class="verdict is-${ok ? "ok" : "no"}">${ok ? "pass" : "fail"}</span></td><td class="num">${need}:1</td><td class="muted">${rule}</td></tr>`;
        })
        .join("\n      ")}
    </tbody>
  </table>
</div>`;

export const sec = (n, title, note, body) => `
<section class="sec">
  <div class="sec-head">
    <span class="sec-n">${n}</span>
    <h2 class="sec-title">${title}</h2>
    ${note ? `<p class="sec-note">${note}</p>` : ""}
  </div>
  ${body}
</section>`;

export const framed = (cap, screen) =>
  `<div class="frame"><div class="frame-cap">${cap}</div><div class="frame-scroll">${screen}</div></div>`;

const FONT_STACKS = {
  figtree: `"Figtree", -apple-system, "Segoe UI", sans-serif`,
  jakarta: `"Plus Jakarta Sans", -apple-system, "Segoe UI", sans-serif`,
  onest: `"Onest", -apple-system, "Segoe UI", sans-serif`,
  manrope: `"Manrope", -apple-system, "Segoe UI", sans-serif`,
};
const FONT_LABELS = { figtree: "Figtree", jakarta: "Plus Jakarta", onest: "Onest", manrope: "Manrope" };

const fontBar = (current) => `
<div class="fontbar">
  <span class="fontbar-label">Typeface</span>
  <div class="seg seg-sm" role="group" aria-label="Typeface">
    ${Object.keys(FONT_STACKS)
      .map(
        (k) =>
          `<button class="seg-btn${k === current ? " is-on" : ""}" type="button" data-font="${k}" aria-pressed="${k === current}" style="font-family:${FONT_STACKS[k]}">${FONT_LABELS[k]}</button>`,
      )
      .join("\n    ")}
  </div>
  <span class="fontbar-note">Layout and typeface are independent — swap the face to judge them separately.</span>
</div>
<script>
(function () {
  var STACKS = ${JSON.stringify(FONT_STACKS)};
  var bar = document.currentScript.previousElementSibling;
  bar.addEventListener("click", function (e) {
    var b = e.target.closest("[data-font]");
    if (!b) return;
    var stack = STACKS[b.dataset.font];
    var r = document.documentElement.style;
    r.setProperty("--font-display", stack);
    r.setProperty("--font-ui", stack);
    r.setProperty("--font-num", stack);
    r.setProperty("--font-stat", stack);
    bar.querySelectorAll("[data-font]").forEach(function (x) {
      var on = x === b;
      x.classList.toggle("is-on", on);
      x.setAttribute("aria-pressed", String(on));
    });
  });
})();

/* Home composer — the brief expands; the send button reports whether there
   is anything to send rather than inviting a click that does nothing. */
(function () {
  document.addEventListener("click", function (e) {
    var b = e.target.closest(".hm-addmore");
    if (!b) return;
    var open = b.getAttribute("aria-expanded") === "true";
    b.setAttribute("aria-expanded", String(!open));
    var brief = b.closest(".hm-composer").querySelector(".hm-brief");
    if (brief) brief.classList.toggle("is-open", !open);
  });
  document.addEventListener("input", function (e) {
    var ta = e.target.closest(".hm-composer textarea");
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.max(ta.scrollHeight, 56) + "px";
    var go = ta.closest(".hm-composer").querySelector(".hm-go");
    if (go) go.classList.toggle("is-ready", ta.value.trim().length > 0);
  });
})();
</script>`;

export const SHARED_SCRIPTS = String.raw`<script>
/* PREVIEW FIT — the one place --z is decided.
   z = min(1, availableWidth / intrinsicWidth, availableHeight / intrinsicHeight)
   so a preview is always as large as it can be without distorting, and never
   larger than life size. Re-run on resize and when the device toggle flips. */
(function () {
  function fit(box) {
    var w = parseFloat(getComputedStyle(box).getPropertyValue("--w"));
    var h = parseFloat(getComputedStyle(box).getPropertyValue("--h"));
    if (!w || !h) return;
    var host = box.parentElement;
    if (!host) return;
    var availW = host.clientWidth || w;
    var cap = parseFloat(box.dataset.maxH || "0") || 0;
    var availH = cap || Math.max(260, Math.min(h, (window.innerHeight || 900) - 220));
    var z = Math.min(1, availW / w, availH / h);
    box.style.setProperty("--z", Math.round(z * 10000) / 10000);
  }
  function fitAll() { document.querySelectorAll(".devbox").forEach(fit); }
  window.addEventListener("resize", fitAll);
  document.addEventListener("click", function (e) {
    if (e.target.closest("[data-device-set]")) setTimeout(fitAll, 0);
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fitAll);
  else fitAll();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitAll);
})();

/* Explainer stepping — chips, Back and Next all drive the same state. */
(function () {
  function go(ex, i) {
    var panels = ex.querySelectorAll(".ex-panel"), chips = ex.querySelectorAll(".ex-step");
    i = Math.max(0, Math.min(panels.length - 1, i));
    ex.dataset.step = i;
    panels.forEach(function (p, n) { p.classList.toggle("is-on", n === i); });
    chips.forEach(function (c, n) {
      c.classList.toggle("is-now", n === i);
      c.classList.toggle("is-done", n < i);
    });
    ex.querySelector(".ex-count b").textContent = i + 1;
    ex.querySelector(".ex-back").disabled = i === 0;
    ex.querySelector(".ex-next").textContent = i === panels.length - 1 ? "Done" : "Next";
  }
  document.addEventListener("click", function (e) {
    var ex = e.target.closest(".ex");
    if (!ex) return;
    var i = parseInt(ex.dataset.step, 10) || 0;
    var chip = e.target.closest("[data-go]");
    if (chip) return go(ex, parseInt(chip.dataset.go, 10));
    if (e.target.closest(".ex-next")) return go(ex, i + 1);
    if (e.target.closest(".ex-back")) return go(ex, i - 1);
  });
})();

/* Device toggles — every [data-device-set] button flips data-device on the
   nearest .preview or .canvas-stage, and updates the zoom readout. */
(function () {
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-device-set]");
    if (!b) return;
    var mode = b.dataset.deviceSet;
    var host = b.closest(".preview") || b.closest(".ed-canvas")?.querySelector(".canvas-stage");
    if (!host) return;
    host.setAttribute("data-device", mode);
    var seg = b.closest(".seg");
    seg.querySelectorAll("[data-device-set]").forEach(function (x) {
      var on = x === b;
      x.classList.toggle("is-on", on);
      x.setAttribute("aria-pressed", String(on));
    });
    var z = (b.closest(".preview") || b.closest(".ed-canvas")).querySelector(".dev-zoom");
    if (z) setTimeout(function () {
      var shown = host.querySelector('.devbox:not([hidden])');
      var box = host.querySelector('.devbox[data-dev="' + (mode === "phone" ? "phone" : "inline") + '"]') || shown;
      var v = box ? parseFloat(getComputedStyle(box).getPropertyValue("--z")) : 1;
      z.textContent = Math.round((v || 1) * 100) + "%";
    }, 0);
  });
})();

/* Home composer — the brief expands; the send button reports whether there
   is anything to send rather than inviting a click that does nothing. */
(function () {
  document.addEventListener("click", function (e) {
    var b = e.target.closest(".hm-addmore");
    if (!b) return;
    var open = b.getAttribute("aria-expanded") === "true";
    b.setAttribute("aria-expanded", String(!open));
    var brief = b.closest(".hm-composer").querySelector(".hm-brief");
    if (brief) brief.classList.toggle("is-open", !open);
  });
  document.addEventListener("input", function (e) {
    var ta = e.target.closest(".hm-composer textarea");
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.max(ta.scrollHeight, 56) + "px";
    var go = ta.closest(".hm-composer").querySelector(".hm-go");
    if (go) go.classList.toggle("is-ready", ta.value.trim().length > 0);
  });
})();
</script>\`;
</script>`;

export function build(d) {
  const L = d.layout || "rail";
  const light = { ...DEFAULTS, ...d.tokens };
  const css = [
    fontCss(d.fonts),
    BASE_CSS,
    HOME_CSS,
    tokensBlock(":root", light),
    /* Single-theme by owner decision — see DARK MODE in the notes. The
       declaration stops the browser from inverting form controls for a
       viewer whose OS is set to dark. */
    ":root { color-scheme: light; }",
    d.css || "",
  ].join("\n\n");

  const badge = d.badge || `Direction ${d.idx} of 5 · ${d.name}`;
  const docTitle = d.docTitle || `${d.name} — Wiskr brand direction ${d.idx} of 5`;
  const html = `<title>${docTitle}</title>
<style>
${css}
</style>

<div class="doc">

  ${d.fontSwitcher ? fontBar(d.fontSwitcher) : ""}

  <header class="masthead">
    <div class="mh-top">
      <span class="mh-mark">${mark(d.markVariant)}</span>
      <span class="mh-name">Wiskr</span>
      <span class="mh-index">${badge}</span>
    </div>
    <h1 class="mh-title">${d.title}</h1>
    <p class="mh-thesis">${d.thesis}</p>
    <div class="mh-facts">
      ${d.facts.map((f) => `<span class="mh-fact">${f}</span>`).join("\n      ")}
    </div>
  </header>

  ${sec("01", "The idea", d.ideaNote, `
    <p class="lede">${d.lede}</p>
    <div class="principles">
      ${d.principles.map(([n, h, p]) => `<article class="principle"><span class="p-n">${n}</span><h3>${h}</h3><p>${p}</p></article>`).join("\n      ")}
    </div>`)}

  ${sec("02", "Typeface", d.typeNote, `
    <div class="spec-pair">
      <div class="spec-card">
        <p class="spec-role">Display &amp; headings</p>
        <p class="spec-name" style="font-family:var(--font-display)">${d.displayName}</p>
        <p class="spec-glyphs" style="font-family:var(--font-display)">Aa Gg Rk 0123456789 $886 46% 20/23</p>
        <p class="spec-why">${d.displayWhy}</p>
      </div>
      <div class="spec-card">
        <p class="spec-role">${d.numRole || "Figures &amp; labels"}</p>
        <p class="spec-name" style="font-family:var(--font-num)">${d.numName}</p>
        <p class="spec-glyphs" style="font-family:var(--font-num);font-variant-numeric:tabular-nums">$886.00 · 20/23 · 46%</p>
        <p class="spec-why">${d.numWhy}</p>
      </div>
    </div>
    <div class="ramp">
      ${d.ramp.map(([tag, style, text]) => `<div class="ramp-line"><span class="ramp-tag">${tag}</span><span class="ramp-txt" style="${style}">${text}</span></div>`).join("\n      ")}
    </div>
    ${scaleTable(d.scaleRows)}`)}

  ${sec("03", "Color", d.colorNote, `
    <p class="lede">${d.colorLede}</p>
    ${swatchRow(d.swatches)}
    <div class="contrast">${contrastTable(
      d.contrastPairs.map(([label, fg, bg, need, rule]) => [
        label,
        contrast(light[fg] ?? fg, light[bg] ?? bg),
        need,
        rule,
      ]),
    )}</div>
    <ul class="rule-list">
      ${d.colorRules.map((r, i) => `<li><span class="rl-n">R${i + 1}</span><span>${r}</span></li>`).join("\n      ")}
    </ul>`)}

  ${sec("04", "Shape, space &amp; depth", d.shapeNote, `
    <p class="lede">${d.shapeLede}</p>
    <div class="tiles">
      ${d.tiles.map(([label, demo, copy]) => `<article class="tile"><p class="tile-label">${label}</p><div class="tile-demo">${demo}</div><p>${copy}</p></article>`).join("\n      ")}
    </div>`)}

  ${sec("05", "The parts", "Every screen below is assembled from only these.", components())}

  ${sec("06", "Workspace home", d.homeNote, `
    ${framed(`<b>Home</b> · first run, before any quiz exists`, screenHome(L, "none"))}
    ${framed(`<b>Home</b> · the same composer, once there is work to come back to`, screenHome(L, "has"))}
  `)}

  ${sec("07", "Building — the product pool", d.recsNote, framed(`<b>Build · step 1</b> · what the quiz recommends`, screenRecs(L)))}

  ${sec("07b", "While it generates", d.draftNote || "Was a spinner alone in an empty field. Now the four real gen_progress checkpoints.", framed(`<b>Build · generating</b> · bounded card, the four real gen_progress checkpoints`, screenDrafting(L)))}

  ${sec("07c", "Questions — flow &amp; preview", d.questionsNote || "Editing chrome stays out of the shopper's frame.", `
    <p class="lede">Six fixes against the current screen: question text clamps to <strong>two lines at a word boundary</strong> instead of cutting mid-word, so seven questions are actually distinguishable; the answer-type control moved <strong>out of the canvas onto the question it belongs to</strong>; <strong>Add answer and reorder live outside the phone</strong>, because edit chrome inside the frame teaches merchants their shoppers will see it; the "SINGLE SELECT" repeated on all seven rows is replaced by the answer count, which actually differs; reorder is <strong>one grip on hover</strong> rather than two stacked arrows on every row; and the accent is spent once, on the question that decides the result.</p>
    ${framed(`<b>Build · questions</b> · flow on the left, the merchant's brand on the right`, screenQuestions(L))}`)}

  ${sec("07d", "Questions — overview", d.overviewNote || "A grid, so the width earns its keep.", `
    <p class="lede">The card version left roughly 40% of every row empty and buried <em>Add answer</em> in the bottom-right corner. This is a <strong>real grid</strong> — number, question, answers, count, type and role — with a sticky header, answers that fill the space they were given, and an insert affordance that appears <strong>on the divider</strong> rather than floating in the gutter between cards. The decider is marked once, in the number.</p>
    ${framed(`<b>Build · questions · overview</b> · every column earns its width`, screenOverview(L))}`)}

  ${sec("07e", "The explainers", d.exNote || "Both sections get one. No step scrolls.", `
    <p class="lede">Rules and Questions each get a <strong>How it works</strong> button carrying the ✦ that already means “we can explain this” in your system. Both explainers are four steps, and <strong>every panel is sized to one fixed body height</strong> — the chains that used to run vertically and get clipped now run horizontally, and each step is trimmed to a single idea. Click the step chips or Next to move through them.</p>
    ${framed(`<b>Explainers</b> · click through — nothing scrolls`, screenExplainers())}`)}

  ${sec("08", "The hard screen — logic", d.logicNote, framed(`<b>Build · step 3</b> · rules and question roles`, screenLogic(L)))}

  ${sec("09", "Results page &amp; live preview", d.resultsNote, framed(`<b>Build · step 4</b> · <span class="cap-cta">click Phone / Desktop in the preview &rarr;</span> 390&times;745 phone, or the 960&times;700 inline embed`, screenResults(L)))}

  ${sec("10", "The editor", d.editorNote, `
    <p class="lede"><strong>Inside the builder, our colour stands down.</strong> The merchant is looking at their own brand in the preview — a violet selection ring next to their terracotta button is two brands arguing over the same screen. So the editor re-points the accent tokens at the ink ladder: selection, focus, the active section and the Publish button all go neutral, and the only saturated colour left is the design being made. Nothing about the components changes; only the tokens move. ${d.editorLede || ""}</p>
    ${framed(`<b>Editor</b> · <span class="cap-cta">click Phone / Desktop above the stage &rarr;</span> our chrome neutral, the merchant's brand in the preview`, screenEditor(L))}`)}

  <footer class="foot">
    <div class="foot-cols">
      <div>
        <h3>What this fixes about today's UI</h3>
        <ul>${d.fixes.map((f) => `<li>${f}</li>`).join("")}</ul>
      </div>
      <div>
        <h3>Where it could bite</h3>
        <ul>${d.risks.map((f) => `<li>${f}</li>`).join("")}</ul>
      </div>
    </div>
    <p class="sources"><b>Grounded in:</b> WCAG 2.2 §1.4.3 contrast-minimum (4.5:1 body, 3:1 large) and §1.4.11 non-text contrast (3:1 for control boundaries) — every pair below is measured, not eyeballed; NN/g on minimizing cognitive load (cut visual clutter, lean on existing mental models, offload work off the user); NN/g progressive disclosure; and the working consensus across current product design systems that one spacing scale, one type ramp and a restrained accent are what make new screens feel native. Typefaces are open-licence (SIL OFL) and self-hosted, so nothing here depends on a font CDN.</p>
  </footer>

</div>
${SHARED_SCRIPTS}`;

  const path = join(OUT_DIR, `${d.id}.html`);
  writeFileSync(path, html);
  return { path, bytes: Buffer.byteLength(html) };
}
