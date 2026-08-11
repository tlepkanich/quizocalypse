/* Preview frames — what "Phone" and "Desktop" should actually show.
   Numbers come from the repo's own constants plus real device viewports. */

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { BASE_CSS } from "./base.mjs";
import { mark } from "./shared.mjs";
import { QUARTZ_TOKENS, QUARTZ_DARK, QUARTZ_CSS, FACE } from "./quartz.mjs";
import { DEFAULTS } from "./build.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
/* Output resolves relative to this file when it sits in _src (which is how
   the handoff package ships), so an unzipped copy rebuilds in place instead
   of writing to whoever generated it. WISKR_OUT overrides. */
const OUT_DIR = process.env.WISKR_OUT
  || (basename(HERE) === "_src" ? join(HERE, "..") : "/Users/chase/code/quizocalypse-builder/docs/design/brand-2026");
const OUT = join(OUT_DIR, "quartz-preview-frames.html");


/* The sticky demo's geometry is COMPUTED, not hand-typed, so the caption and
   the rendered box can never disagree. The phone is drawn at its true 390×745
   and scaled as a whole — never re-styled smaller, which is what produced a
   squat box that matched neither the ratio nor the stated zoom. */
const PHONE_W = 390, PHONE_H = 745;
const FRAME_W = PHONE_W;                      // borderless: the frame IS the screen
const FRAME_H = PHONE_H;
const DEMO_H = 620, DEMO_PAD = 20;
const AVAIL_H = DEMO_H - DEMO_PAD * 2;                  // 580 — no caption to reserve for
const ZOOM = Math.min(1, AVAIL_H / FRAME_H);            // 0.7227…
const SHOWN_W = Math.round(FRAME_W * ZOOM);
const SHOWN_H = Math.round(FRAME_H * ZOOM);
const PCT = Math.round(ZOOM * 100);

const OPTIONS = ["Tight and flaky", "Shiny all over", "Shiny T-zone only", "Reacts to most things"];

/* The shopper's question step, in the MERCHANT's palette. */
const quizStep = () => `
<div class="qz">
  <div class="qz-progress" aria-hidden="true"><span style="width:38%"></span></div>
  <h3 class="qz-q">How does your skin feel by midday?</h3>
  <ul class="qz-opts">
    ${OPTIONS.map((o) => `<li class="qz-opt"><span>${o}</span><span class="qz-radio" aria-hidden="true"></span></li>`).join("")}
  </ul>
  <button class="qz-next" type="button">Continue</button>
  <p class="qz-back">&#8592; Back</p>
</div>`;

const tokens = (sel, map) => `${sel} {\n${Object.entries(map).map(([k, v]) => `  ${k}: ${v};`).join("\n")}\n}`;

const light = { ...DEFAULTS, ...QUARTZ_TOKENS,
  "--font-display": FACE.figtree, "--font-ui": FACE.figtree,
  "--font-num": FACE.figtree, "--font-stat": FACE.figtree };

const EXTRA = String.raw`
/* ── The merchant's quiz — one palette, used in both frames ───────── */
.qz {
  --m-bg: #FBF2EA; --m-ink: #2A211A; --m-mute: #6E5D4E; --m-card: #FFFFFF;
  --m-line: #E7DACE; --m-cta: #A6462A; --m-cta-ink: #FFF7F2; --m-r: 10px;
  background: var(--m-bg); color: var(--m-ink); font-family: var(--font-ui);
  display: grid; align-content: center; gap: 16px; height: 100%;
}
.qz-progress { height: 5px; border-radius: 3px; background: #E7DACE; overflow: hidden; }
.qz-progress span { display: block; height: 100%; background: var(--m-cta); border-radius: 3px; }
.qz-q { font-size: 22px; line-height: 1.25; font-weight: 700; text-align: center; letter-spacing: -0.015em; }
.qz-opts { display: grid; gap: 10px; }
.qz-opt {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 15px 18px; background: var(--m-card); border: 1px solid var(--m-line);
  border-radius: var(--m-r); font-size: 15px;
}
.qz-radio { width: 17px; height: 17px; flex: none; border-radius: 50%; border: 1.5px solid #CDBBAB; }
.qz-next {
  padding: 16px; border: 0; border-radius: var(--m-r);
  background: var(--m-cta); color: var(--m-cta-ink); font-size: 15.5px; font-weight: 700;
}
.qz-back { font-size: 13px; color: var(--m-mute); }

/* ── Mobile — borderless. No bezel, no chrome, no caption, and solid to
     every edge. Everything else on this page is a framed embed and keeps
     its frame; the phone is the one that stands alone. — */
.dev { display: grid; justify-items: center; gap: 12px; }
.dev-mobile {
  width: ${PHONE_W}px; height: ${PHONE_H}px; flex: none; overflow: hidden;
  border-radius: var(--phone-r);
}
.dev-mobile .screen { height: 100%; overflow: hidden; }
.dev-mobile .qz { padding: 28px 20px; }

/* ── Desktop = an EMBED, not a browser window ────────────────────── */
.host {
  width: 960px; flex: none; border-radius: var(--r-lg); overflow: hidden;
  border: 1px solid var(--line); background: #FFFFFF; box-shadow: var(--e-2);
}
.host-bar {
  display: flex; align-items: center; gap: 22px; padding: 0 26px; height: 54px;
  border-bottom: 1px solid #EFE9E3; background: #FFFFFF;
}
.host-logo { font-size: 16px; font-weight: 800; letter-spacing: -0.02em; color: #2A211A; }
.host-nav { display: flex; gap: 20px; font-size: 13.5px; color: #6E5D4E; }
.host-cart { margin-left: auto; font-size: 13.5px; color: #6E5D4E; }
.host-lede { padding: 26px 26px 0; text-align: center; }
.host-lede h4 { font-size: 24px; font-weight: 800; letter-spacing: -0.02em; color: #2A211A; }
.host-lede p { margin-top: 6px; font-size: 14px; color: #6E5D4E; }
.host-slot { padding: 20px 26px 26px; }
.embed {
  height: 700px; min-height: 560px; max-height: 780px;
  border-radius: var(--r-lg); overflow: hidden; border: 1px solid #EFE1D6;
}
/* The merchant's background fills the whole band; only the CONTENT is
   capped — same as the live runtime, which centres a column inside a
   full-bleed section. */
.embed .qz { padding: 40px 48px; }
.embed .qz > * { width: 100%; max-width: 620px; margin-left: auto; margin-right: auto; }
.embed .qz-q { font-size: 26px; }
.host-foot {
  padding: 16px 26px; border-top: 1px solid #EFE9E3; font-size: 12.5px; color: #9C8B7C;
}
.slot-tag {
  display: inline-flex; align-items: center; gap: 7px; margin-bottom: 10px;
  font-size: 11px; font-weight: var(--fw-semi); letter-spacing: .08em; text-transform: uppercase;
  color: var(--ink-3);
}
.slot-tag::before { content: ""; width: 10px; height: 10px; border: 1px dashed var(--line-strong); border-radius: 2px; }

/* Callouts on the frames */
.dim {
  display: inline-flex; align-items: center; gap: 8px; padding: 5px 10px; border-radius: var(--r-sm);
  background: var(--surface-2); border: 1px solid var(--line); font-size: 12px; color: var(--ink-2);
  font-variant-numeric: tabular-nums;
}
.dim b { color: var(--ink); font-weight: var(--fw-semi); }
.dims { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }

/* ── Modal / launcher — the product's own constants ──────────────── */
.scrim {
  width: 1120px; flex: none; border-radius: var(--r-lg); overflow: hidden;
  border: 1px solid var(--line); box-shadow: var(--e-2); position: relative;
  background: #FFFFFF;
}
.scrim-page { filter: saturate(.5); opacity: .5; pointer-events: none; }
.scrim-dim {
  position: absolute; inset: 0; background: rgba(28, 22, 16, 0.46);
  display: grid; place-items: center; padding: 24px;
}
.modal-card {
  width: 100%; max-width: 720px; height: 620px; max-height: 100%;
  border-radius: 14px; overflow: hidden; box-shadow: 0 28px 70px -18px rgba(0,0,0,.5);
  position: relative;
}
.modal-x {
  position: absolute; top: 16px; right: 16px; z-index: 2;
  width: 36px; height: 36px; display: grid; place-items: center; border: 0; border-radius: 8px;
  background: #2A211A; color: #FFF; font-size: 16px; line-height: 1;
}
.modal-card .qz { padding: 30px 34px; align-content: center; gap: 14px; }
.modal-card .qz-q { font-size: 25px; }
.modal-count { text-align: center; font-size: 13px; color: var(--m-mute); }


/* ── Sizing rules — never stretch, never overflow, always on screen ─── */
.rules-demo {
  display: grid; grid-template-columns: 1fr auto; gap: 24px;
  height: ${DEMO_H}px; overflow-y: auto; padding: ${DEMO_PAD}px;
  border: 1px solid var(--line); border-radius: var(--r-lg); background: var(--surface-2);
}
.rules-editor { display: grid; gap: 12px; align-content: start; max-width: 460px; }
.rules-block { padding: 16px 18px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-md); }
.rules-block p { font-size: 13.5px; color: var(--ink-2); line-height: 1.6; }
.rules-block b { color: var(--ink); font-weight: var(--fw-semi); font-size: 14px; display: block; margin-bottom: 5px; }

/* Sticky, capped, scaled — in that order. */
.rules-preview { position: sticky; top: 0; align-self: start; display: grid; gap: 10px; justify-items: center; }
/* The holder takes the SCALED size, so the layout box matches the painted box. */
.rules-hold { width: ${SHOWN_W}px; height: ${SHOWN_H}px; }
.rules-frame {
  width: ${FRAME_W}px; height: ${FRAME_H}px; overflow: hidden;
  transform: scale(${ZOOM.toFixed(4)}); transform-origin: top left;
  border-radius: var(--phone-r);
}
/* True 390-wide phone content — real type sizes, then scaled as a whole. */
.rules-frame .qz { height: 100%; padding: 30px 20px; }
.formula {
  margin-top: 22px; padding: 18px 20px; border-radius: var(--r-lg);
  border: 1px solid var(--line); background: var(--surface-2);
  font-size: 13.5px; line-height: 1.75; color: var(--ink-2); overflow-x: auto;
}
.formula code { color: var(--accent-ink); font-weight: var(--fw-semi); }
.formula b { color: var(--ink); font-weight: var(--fw-semi); }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 26px; align-items: start; }
@media (max-width: 900px) { .two { grid-template-columns: 1fr; } }
.bad { border-left: 2px solid var(--crit); padding-left: 12px; }
.good { border-left: 2px solid var(--ok); padding-left: 12px; }
`;

const html = `<title>Quartz — preview frames: phone and the embed rectangle</title>
<style>
${readFileSync(join(HERE, "fonts", "figtree.css"), "utf8")}

${BASE_CSS}

${tokens(":root", light)}

/* Single-theme by owner decision — the sizing spec follows the system. */
:root { color-scheme: light; }

${QUARTZ_CSS}
${EXTRA}
</style>

<div class="doc">

  <header class="masthead">
    <div class="mh-top">
      <span class="mh-mark">${mark("solid")}</span>
      <span class="mh-name">Wiskr</span>
      <span class="mh-index">Quartz · preview frames</span>
    </div>
    <h1 class="mh-title">Phone, and the embed rectangle</h1>
    <p class="mh-thesis">The quiz is never a web page. It is a modal over someone's storefront, or a block inside it — and your launcher already fixes the modal at 720 &times; 800. The Desktop preview should show whichever one the merchant actually shipped, at that size.</p>
    <div class="mh-facts">
      <span class="mh-fact">Phone 390 &times; 745</span>
      <span class="mh-fact">Clamped 640–844</span>
      <span class="mh-fact">Modal 720 &times; 620</span>
      <span class="mh-fact">Inline 960 &times; 700</span>
      <span class="mh-fact">Breakpoint 900px</span>
    </div>
  </header>

  <section class="sec">
    <div class="sec-head">
      <span class="sec-n">01</span>
      <h2 class="sec-title">Where the numbers come from</h2>
      <p class="sec-note">Repo constants first, real device viewports second.</p>
    </div>
    <p class="lede">Nothing here is invented. <strong>390</strong> is already your mobile preset and the CSS viewport of an iPhone 14/15/16. <strong>720</strong> wide is not a guess either — it is the floating launcher's own CSS, <code>max-width: 720px; height: 90vh; max-height: 800px</code>. And <strong>900</strong> is <code>BREAKPOINT_PX</code>, the line the runtime crosses. Those three numbers settle the whole question, and they surface one problem worth reading twice.</p>

    <div class="note" style="max-width:74ch;margin-bottom:26px">
      <strong>The launcher modal is 720px wide. The breakpoint is 900px.</strong> So a quiz opened from the floating launcher renders <b>mobile</b> tokens on a desktop machine — always. That is either deliberate (a 720px modal really is phone-shaped) or a bug nobody has looked at. Either way, a “Desktop” toggle that shows desktop tokens for a modal-mode quiz is showing the merchant something their shoppers will never see.
    </div>

    <div class="table-wrap">
      <table class="spec">
        <thead><tr><th scope="col">Frame</th><th scope="col" class="num">Width</th><th scope="col" class="num">Height</th><th scope="col" class="num">Clamp</th><th scope="col" class="num">Tokens</th><th scope="col">Source</th></tr></thead>
        <tbody>
          <tr><th scope="row">Phone</th><td class="num">390</td><td class="num">745</td><td class="num">640 – 844</td><td class="num">mobile</td><td class="muted">Your <code>DEVICE_PRESETS.mobile</code>. 844 = iPhone 14/15 viewport, 640 = SE with chrome.</td></tr>
          <tr><th scope="row">Modal</th><td class="num">720</td><td class="num">620</td><td class="num">520 – 680</td><td class="num">mobile</td><td class="muted">The launcher's width, unchanged. The height comes DOWN from its 800px ceiling to 620 — squarer, and it removes the dead band above and below the questions.</td></tr>
          <tr><th scope="row">Inline</th><td class="num">960</td><td class="num">700</td><td class="num">560 – 780</td><td class="num">desktop</td><td class="muted">Above the 900 breakpoint, below the 1100 content cap. Squarer than a letterbox band, which is what stops it reading stretched.</td></tr>
          <tr><th scope="row">Tablet</th><td class="num">768</td><td class="num">920</td><td class="num">720 – 1024</td><td class="num">mobile</td><td class="muted">Unchanged. Still below 900, so still mobile tokens.</td></tr>
          <tr><th scope="row"><s>Desktop 1280</s></th><td class="num">1280</td><td class="num">—</td><td class="num">—</td><td class="num">—</td><td class="muted">Retire. The runtime never paints wider than 1100, so 180px of it is empty margin — that gap is what makes the current preview read as a huge stretched card.</td></tr>
        </tbody>
      </table>
    </div>
    <ul class="rule-list">
      <li><span class="rl-n">R1</span><span><b>The preview shows the container, not the browser.</b> Simulating a browser window invents space that will not exist and hides the only question a merchant has: does it fit where I am putting it?</span></li>
      <li><span class="rl-n">R2</span><span><b>The toggle should follow the embed mode.</b> A modal-mode quiz gets Phone and Modal. An inline quiz gets Phone and Inline. Offering a 1280px desktop view for a quiz that ships in a 720px modal is showing a screen that cannot happen.</span></li>
      <li><span class="rl-n">R3</span><span><b>Height is clamped, not viewport-relative.</b> The frame is <code>min(760px, 74vh)</code> today, so two merchants on different monitors see different previews of the same quiz. Fixed floors and ceilings fix that.</span></li>
      <li><span class="rl-n">R4</span><span><b>Squarer, not wider.</b> 960 &times; 700 reads as a considered block; 1120 &times; 640 reads as a letterbox with the content stranded in the middle.</span></li>
    </ul>
  </section>

  <section class="sec">
    <div class="sec-head">
      <span class="sec-n">02</span>
      <h2 class="sec-title">Phone</h2>
      <p class="sec-note">Full device, clamped to a real viewport.</p>
    </div>
    <p class="lede">No bezel, no rounded plastic, no caption underneath. The <strong>fixed 390 &times; 745 screen</strong> does the work the drawn phone used to do &mdash; it still shows the merchant exactly where the fold falls &mdash; and with no bezel, no outline and no drawn hardware around it, the screen itself is the whole object. The device drawing was decoration around a number that was already doing the job.</p>
    <div class="frame">
      <div class="frame-scroll" style="padding:26px 0;background:var(--surface-2)">
        <div class="dev">
          <div class="dev-mobile"><div class="screen">${quizStep()}</div></div>
        </div>
      </div>
    </div>
  </section>

  <section class="sec">
    <div class="sec-head">
      <span class="sec-n">03</span>
      <h2 class="sec-title">Desktop &mdash; modal</h2>
      <p class="sec-note">720 &times; 620, over a dimmed storefront. Squarer than the launcher ships today.</p>
    </div>
    <p class="lede">This is the one you pointed at, and it is already what your floating launcher ships: a <strong>720px card</strong> centred over a scrim on the merchant's page. The width is what your launcher already ships; the height comes <strong>down from 800 to 620</strong>, which removes the dead band above and below the questions and lands it at roughly 7:6 — square enough to read as a considered object rather than a tall panel with content stranded in the middle. Note the token badge &mdash; at 720px wide this is <strong>below the 900px breakpoint</strong>, so the quiz inside is running mobile tokens even though the shopper is on a laptop.</p>
    <div class="frame">
      <div class="frame-cap"><b>Desktop &middot; modal</b> &middot; 720 &times; 620 &middot; renders mobile tokens (720 &lt; 900)</div>
      <div class="frame-scroll" style="padding:26px 0;background:var(--surface-2)">
        <div class="dev">
          <div class="scrim">
            <div class="scrim-page">
              <div class="host-bar">
                <span class="host-logo">Aster &amp; Ash</span>
                <nav class="host-nav"><span>Shop</span><span>Routines</span><span>Journal</span><span>About</span></nav>
                <span class="host-cart">Cart (0)</span>
              </div>
              <div class="host-lede" style="padding-bottom:26px">
                <h4>Winter skin, sorted</h4>
                <p>Free shipping over $60 &middot; 30-day returns</p>
              </div>
              <div style="height:560px"></div>
            </div>
            <div class="scrim-dim">
              <div class="modal-card">
                <button class="modal-x" type="button" aria-label="Close">&#215;</button>
                ${quizStep()}
              </div>
            </div>
          </div>
          <div class="dims">
            <span class="dim"><b>720</b> card width</span>
            <span class="dim"><b>620</b> card height</span>
            <span class="dim">min <b>520</b> &middot; max <b>680</b></span>
            <span class="dim">renders <b>mobile</b> tokens</span>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="sec">
    <div class="sec-head">
      <span class="sec-n">04</span>
      <h2 class="sec-title">Desktop &mdash; inline</h2>
      <p class="sec-note">960 &times; 700 for merchants who embed it in a section.</p>
    </div>
    <p class="lede">The other embed mode: the quiz sits in a slot on the page rather than over it. <strong>960 wide keeps it above the 900px breakpoint</strong> so it genuinely renders desktop tokens, and <strong>700 tall</strong> makes it a block rather than a band &mdash; the 1120 &times; 640 version was the stretched one. The quiz keeps its own 620px content column inside, so the merchant's background fills the slot and the questions stay readable.</p>
    <div class="frame">
      <div class="frame-cap"><b>Desktop &middot; inline</b> &middot; 960 &times; 700 &middot; renders desktop tokens &middot; shown in a host page</div>
      <div class="frame-scroll" style="padding:26px 0;background:var(--surface-2)">
        <div class="dev">
          <div class="host">
            <div class="host-bar">
              <span class="host-logo">Aster &amp; Ash</span>
              <nav class="host-nav"><span>Shop</span><span>Routines</span><span>Journal</span><span>About</span></nav>
              <span class="host-cart">Cart (0)</span>
            </div>
            <div class="host-lede">
              <h4>Build your routine</h4>
              <p>Answer six quick questions and we'll match you to a regimen.</p>
            </div>
            <div class="host-slot">
              <span class="slot-tag">Wiskr embed slot</span>
              <div class="embed">${quizStep()}</div>
            </div>
            <div class="host-foot">Free shipping over $60 &middot; 30-day returns</div>
          </div>
          <div class="dims">
            <span class="dim"><b>960</b> frame width</span>
            <span class="dim"><b>620</b> content column</span>
            <span class="dim"><b>700</b> slot height</span>
            <span class="dim">min <b>560</b> &middot; max <b>780</b></span>
            <span class="dim">renders <b>desktop</b> tokens</span>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="sec">
    <div class="sec-head">
      <span class="sec-n">05</span>
      <h2 class="sec-title">Sizing rules</h2>
      <p class="sec-note">Never stretch. Never overflow. Always on screen.</p>
    </div>
    <p class="lede">Three rules, applied in order, and they settle every preview in the product — the builder steps and the editor stage included. <strong>Scroll the panel below</strong>: the editing column moves, the preview does not. It never grows past its intrinsic size, it never grows past the window, and it never leaves the screen.</p>

    <div class="rules-demo">
      <div class="rules-editor">
        <div class="rules-block"><b>Rule 1 &mdash; never stretch</b><p>Every frame has a fixed intrinsic size: phone 390&times;745, modal 720&times;620, inline 960&times;700. It does not grow with the window. A preview that stretches is showing a layout no shopper will ever load.</p></div>
        <div class="rules-block"><b>Rule 2 &mdash; never overflow</b><p>Height is capped at <code>min(intrinsic, 100dvh &minus; chrome)</code>. If the intrinsic height loses, the frame is <em>scaled</em>, not clipped &mdash; and the zoom is printed underneath so nobody misjudges type size.</p></div>
        <div class="rules-block"><b>Rule 3 &mdash; always on screen</b><p>The preview column is <code>position: sticky</code> under the step bar. Scroll the editor as far as you like; the preview stays put. This is the fix for the preview falling off the bottom on a laptop.</p></div>
        <div class="rules-block"><b>Why <code>dvh</code>, not <code>vh</code></b><p>On mobile Safari <code>vh</code> ignores the collapsing address bar, so a <code>100vh</code> preview is taller than the visible viewport and the bottom is unreachable. <code>dvh</code> tracks the real one.</p></div>
        <div class="rules-block"><b>Keep scrolling</b><p>The preview on the right has not moved. That is the whole rule.</p></div>
        <div class="rules-block"><b>Still here</b><p>This panel is ${DEMO_H}px tall, which leaves ${AVAIL_H}px for the phone. The phone is ${FRAME_H}px, so rule 2 scales it to <b>${PCT}%</b> &mdash; every number in that sentence and the CSS beside it come from the same four lines of arithmetic, so the drawn box and the stated size cannot drift apart. In the product this runs per-frame at load and on resize; here it is baked, because the panel height is fixed.</p></div>
      </div>
      <aside class="rules-preview">
        <div class="rules-hold"><div class="rules-frame">${quizStep()}</div></div>
      </aside>
    </div>

    <div class="formula">
      <b>The whole thing, in four lines.</b><br>
      <code>--frame-w</code>: 390 (phone) &middot; 720 (modal) &middot; 960 (inline) &mdash; fixed, never a percentage.<br>
      <code>--frame-h</code>: 745 &middot; 620 &middot; 700 &mdash; clamped to its own min/max, never <code>vh</code>-derived.<br>
      <code>--avail</code>: <code>calc(100dvh - var(--bar-h) - var(--gutter) * 2)</code><br>
      <code>--zoom</code>: <code>min(1, var(--avail) / var(--frame-h))</code> &rarr; applied as <code>transform: scale()</code>, printed as a percentage, and the layout box is set to the <em>scaled</em> size so nothing overlaps the editor beside it.
    </div>
  </section>

  <section class="sec">
    <div class="sec-head">
      <span class="sec-n">06</span>
      <h2 class="sec-title">What changes in the code</h2>
      <p class="sec-note">Small, and mostly in one file.</p>
    </div>
    <div class="two">
      <div>
        <h3 style="font-size:15px;font-weight:600;margin-bottom:10px">Change</h3>
        <ul class="rule-list">
          <li><span class="rl-n">1</span><span>Replace <code>DEVICE_PRESETS.desktop: 1280</code> with two presets: <b>modal 720&times;620</b> and <b>inline 960&times;700</b>. The launcher's own CSS also moves from <code>height: 90vh; max-height: 800px</code> to <code>height: min(86vh, 620px)</code>.</span></li>
          <li><span class="rl-n">2</span><span>Pick the preset from the quiz's embed mode rather than offering both. The mode is already known — <code>studio.$id_.embed</code> names three of them.</span></li>
          <li><span class="rl-n">3</span><span>Swap <code>min(760px, 74vh)</code> for the fixed clamps above, so the preview stops depending on the merchant's own monitor.</span></li>
          <li><span class="rl-n">4</span><span>Wrap each frame in its host context — scrim for modal, section strip for inline. Presentational only, no runtime change.</span></li>
        </ul>
      </div>
      <div>
        <h3 style="font-size:15px;font-weight:600;margin-bottom:10px">Check before shipping</h3>
        <ul class="rule-list">
          <li><span class="rl-n">!</span><span class="bad"><b>720 &lt; 900, so the launcher modal always renders mobile.</b> This is the one to settle first. If it is deliberate, the modal preview should say “mobile” and the Desktop toggle should not appear for launcher-mode quizzes at all. If it is not, either the modal grows past 900 or the breakpoint moves.</span></li>
          <li><span class="rl-n">?</span><span class="bad"><b>Do full-bleed themes give the inline embed more than 960?</b> Some will. Let the slot grow, but never the 620px content column with it.</span></li>
          <li><span class="rl-n">?</span><span class="good"><b>The 74vh problem goes away.</b> A fixed clamp means two merchants on different monitors see the same preview, which they do not today.</span></li>
        </ul>
      </div>
    </div>
  </section>

</div>`;

writeFileSync(OUT, html);
console.log(`frames → ${OUT}  ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB`);
