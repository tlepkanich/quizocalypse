/* ── Studio home — one page, two states ─────────────────────────────────
   Before the first quiz: the composer, optically centred, nothing else.
   After it: the same composer, unchanged, with sections below.
   The composer never moves horizontally, resizes or restyles between the
   two — it is the anchor, so the page can grow around it without reading
   as a different screen.

   Every class is prefixed `hm-`. The doc already owns .stat, .card, .chip
   and .row, and an unprefixed merge would have silently restyled six other
   screens. Prefixing is the whole reason this can drop in safely. */

const ico = (d, extra = "") =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"${extra}>${d}</svg>`;

const I = {
  globe: `<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18Z"/>`,
  box: `<path d="M4 7.5 12 3.5l8 4v9l-8 4-8-4Z"/><path d="M4 7.5 12 11.5l8-4"/><path d="M12 11.5v9"/>`,
  mail: `<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.6 6.5 8.4 6 8.4-6"/>`,
  palette: `<path d="M12 3a9 9 0 1 0 0 18c1 0 1.6-.7 1.6-1.5 0-1.4-1-1.6-1-2.6 0-.8.7-1.4 1.5-1.4H16a5 5 0 0 0 5-5c0-4-4-7.5-9-7.5Z"/><circle cx="8" cy="11" r="1.1" fill="currentColor" stroke="none"/><circle cx="12" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="16" cy="10.5" r="1.1" fill="currentColor" stroke="none"/>`,
  grid: `<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>`,
  plus: `<path d="M12 4.5v15"/><path d="M4.5 12h15"/>`,
  copy: `<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 4.5h-9a2 2 0 0 0-2 2v9"/>`,
  chev: `<path d="m9 6 6 6-6 6"/>`,
};

/* Ordered by distance to revenue: a built-but-unpublished quiz earns
   nothing, captured emails going nowhere are being lost, and design is
   polish that cascades. All in ink — no alarm colour on this page. */
const TODOS = [
  [I.globe, `Publish &ldquo;Gift finder &mdash; holiday 2026&rdquo;`, "Finished 4 days ago · nothing is live until you publish"],
  [I.box, `Add &ldquo;Find your first snowboard&rdquo; to your store`, "Published, but no shopper has reached it yet"],
  [I.mail, "Send captured emails somewhere", "10 addresses collected, no destination connected"],
  [I.palette, "Set up your global design", "Colors and fonts flow into every quiz you build"],
];

const HOME_STATS = [
  ["Starts", "65", "+18%", true],
  ["Completion", "46%", "+4 pts", true],
  ["Emails", "10", "+3", true],
  ["Revenue", "$1,240", "9 orders", false],
];

const HOME_QUIZZES = [
  ["Find your first snowboard", "4,180 starts · 52% completion", "live", "Live"],
  ["Your Skin, Decoded &mdash; Regimen Builder", "Edited 4 hours ago", "", "Draft"],
  ["Which roast is yours?", "Edited 2 hours ago · 3 of 5 steps", "setup", "In setup"],
  ["Gift finder &mdash; holiday 2026", "Edited yesterday", "", "Draft"],
];

const MODES = [
  [I.grid, "Browse templates"],
  [I.plus, "Start from scratch"],
  [I.copy, "Duplicate a quiz"],
];

/* The composer is byte-identical between states — that is the point. */
const composer = () => `
        <div class="hm-composer">
          <label class="sr-only" for="hm-goal">Your goal</label>
          <textarea id="hm-goal" rows="1" placeholder="Help first-time buyers pick the right snowboard for their terrain and skill level"></textarea>
          <div class="hm-brief">
            <div class="hm-brief-row">
              <label>Who is it for</label>
              <input type="text" placeholder="First-time buyers, 18–34, buying their own board">
            </div>
            <div class="hm-brief-row">
              <label>What decides the answer</label>
              <input type="text" placeholder="Terrain, skill level, height and weight, budget">
            </div>
            <div class="hm-brief-row">
              <label>How long</label>
              <input type="text" value="5–7 questions">
              <p class="hm-brief-note">Defaulted from your goal. Change it or leave it &mdash; it never blocks the draft.</p>
            </div>
          </div>
          <div class="hm-bar">
            <button class="hm-addmore" type="button" aria-expanded="false">
              ${ico(I.plus, ' width="14" height="14"')}
              Audience, factors, length
              ${ico(`<path d="m6 9 6 6 6-6"/>`, ' class="hm-chev" width="13" height="13"')}
            </button>
            <span class="hm-grow"></span>
            <button class="hm-go" type="button" aria-label="Draft my quiz">
              ${ico(`<path d="M5 12h13"/><path d="m12.5 6 6 6-6 6"/>`)}
            </button>
          </div>
        </div>

        <div class="hm-modes">
          ${MODES.map(([d, label]) => `<button class="hm-mode" type="button">${ico(d)}${label}</button>`).join("\n          ")}
        </div>`;

/* `state` is "none" (before the first quiz) or "has" (after it). */
export const homeBody = (state) => `
      <div class="hm-top">
        <div class="hm-col">
          <h1 class="hm-h1">What should this quiz help someone decide?</h1>
${composer()}
${state === "none" ? `
          <button class="hm-nudge" type="button">
            ${ico(I.palette, ' aria-hidden="true"')}
            Set up your global design &mdash; colors and fonts flow into every quiz
          </button>` : ""}
        </div>
      </div>
${state === "has" ? `
      <div class="hm-below">
        <div class="hm-col">

          <section class="hm-section">
            <div class="hm-sec-head">
              <h2>Pick up where you left off</h2>
              <span class="hm-count">4 to do</span>
              <a class="link" href="#0">See all</a>
            </div>
            <div class="hm-card">
              ${TODOS.map(([d, title, sub]) => `<button class="hm-todo" type="button">
                <span class="hm-todo-ico">${ico(d)}</span>
                <span class="hm-todo-main"><b>${title}</b><span>${sub}</span></span>
                ${ico(I.chev, ' class="hm-todo-chev" width="16" height="16"')}
              </button>`).join("\n              ")}
            </div>
          </section>

          <section class="hm-section">
            <div class="hm-sec-head">
              <h2>Last 30 days</h2>
              <a class="link" href="#0">Full analytics</a>
            </div>
            <div class="hm-stats">
              ${HOME_STATS.map(([label, value, delta, up]) => `<div class="hm-stat">
                <p class="hm-stat-label">${label}</p>
                <p class="hm-stat-value">${value}</p>
                <p class="hm-stat-delta${up ? " is-up" : ""}">${delta}</p>
              </div>`).join("\n              ")}
            </div>
          </section>

          <section class="hm-section">
            <div class="hm-sec-head">
              <h2>Your quizzes</h2>
              <a class="link" href="#0">All 27</a>
            </div>
            <div class="hm-card">
              ${HOME_QUIZZES.map(([name, meta, cls, label]) => `<div class="hm-qrow">
                <div class="hm-qrow-main"><b>${name}</b><span>${meta}</span></div>
                <span class="hm-chip${cls ? ` is-${cls}` : ""}">${label}</span>
              </div>`).join("\n              ")}
            </div>
          </section>

        </div>
      </div>` : ""}
`;
