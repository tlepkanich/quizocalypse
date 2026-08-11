import { homeBody } from "./home.mjs";
// Shared, brand-agnostic markup for the five brand directions.
// Same product screens in every file — the CSS is what differs, so the five
// can be compared on identical content.

export const mark = (variant = "solid") => {
  if (variant === "line")
    return `<svg class="mark" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M7.5 12.5V6l5.5 3.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <path d="M24.5 12.5V6L19 9.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <rect x="6.5" y="9.5" width="19" height="16.5" rx="8.25" fill="none" stroke="currentColor" stroke-width="2"/>
      <circle cx="12.5" cy="17" r="1.4" fill="currentColor"/>
      <circle cx="19.5" cy="17" r="1.4" fill="currentColor"/>
      <path d="M14.6 21h2.8l-1.4 1.6z" fill="currentColor"/>
    </svg>`;
  return `<svg class="mark" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M6 13V4.5L13 9z" fill="currentColor"/>
      <path d="M26 13V4.5L19 9z" fill="currentColor"/>
      <rect x="5" y="9" width="22" height="18" rx="9" fill="currentColor"/>
      <circle cx="12.4" cy="17" r="1.9" class="eye"/>
      <circle cx="19.6" cy="17" r="1.9" class="eye"/>
      <path d="M14.4 21.2h3.2L16 23z" class="eye"/>
    </svg>`;
};

const NAV = [
  ["Home", "home", true],
  ["Quizzes", "stack", false],
  ["Analytics", "chart", false],
  ["Brand &amp; design", "palette", false],
  ["Customer engagement", "people", false],
  ["Integrations", "plug", false],
  ["Email automation", "mail", false],
];

const ICONS = {
  home: `<path d="M3 8.5 9 3.5l6 5V15a1 1 0 0 1-1 1h-3v-4H7v4H4a1 1 0 0 1-1-1z"/>`,
  stack: `<path d="M9 2.5 16 6l-7 3.5L2 6z"/><path d="M2 9.5 9 13l7-3.5"/><path d="M2 12.8 9 16.3l7-3.5"/>`,
  chart: `<path d="M3 15V8"/><path d="M7.7 15V4"/><path d="M12.3 15v-5"/><path d="M17 15V6.5"/>`,
  palette: `<path d="M9 2.5a6.5 6.5 0 1 0 0 13c.9 0 1.4-.6 1.4-1.3 0-1.2 1-1.4 2-1.4h1.3A3.3 3.3 0 0 0 17 9.5C17 5.6 13.4 2.5 9 2.5z"/><circle cx="6.2" cy="7.4" r=".9"/><circle cx="9" cy="5.6" r=".9"/><circle cx="12" cy="7.2" r=".9"/>`,
  people: `<circle cx="7" cy="6.4" r="2.6"/><path d="M2.5 15.5c0-2.6 2-4.4 4.5-4.4s4.5 1.8 4.5 4.4"/><path d="M13 5.2a2.4 2.4 0 0 1 0 4.7"/><path d="M13.6 11.6c1.9.3 3 1.9 3 3.9"/>`,
  plug: `<path d="M7 2.5v4"/><path d="M11 2.5v4"/><path d="M4.6 6.5h8.8v2.9a4.4 4.4 0 0 1-8.8 0z"/><path d="M9 13.8v3.2"/>`,
  gear: `<circle cx="9" cy="9" r="2.6"/><path d="M9 1.8v2M9 14.2v2M16.2 9h-2M4 9H2M14.1 3.9l-1.4 1.4M5.3 12.7l-1.4 1.4M14.1 14.1l-1.4-1.4M5.3 5.3 3.9 3.9"/>`,
  mail: `<rect x="2.5" y="4" width="13" height="10" rx="1.6"/><path d="m2.9 5 6.1 4.6L15.1 5"/>`,
};

const icon = (k) =>
  `<svg class="ico" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k]}</svg>`;

export const rail = (markVariant) => `
<aside class="rail">
  <a class="brand" href="#0">${mark(markVariant)}<span class="brand-name">Wiskr</span></a>
  <nav class="nav" aria-label="Workspace">
    ${NAV.map(
      ([label, ic, active]) =>
        `<a class="nav-item${active ? " is-active" : ""}" href="#0"${active ? ' aria-current="page"' : ""}>${icon(ic)}<span>${label}</span></a>`,
    ).join("\n    ")}
  </nav>
  <div class="rail-foot">
    <a class="nav-item" href="#0">${icon("gear")}<span>Settings</span></a>
    <a class="nav-item" href="#0"><span class="avatar" aria-hidden="true">C</span><span>Chase L.</span></a>
  </div>
</aside>`;

/* Icon-only rail (Canvas layout) */
export const railIcons = (markVariant) => `
<aside class="rail rail-icons">
  <a class="brand" href="#0" aria-label="Wiskr — home">${mark(markVariant)}</a>
  <nav class="nav" aria-label="Workspace">
    ${NAV.map(
      ([label, ic, active]) =>
        `<a class="nav-item${active ? " is-active" : ""}" href="#0" title="${label}" aria-label="${label}"${active ? ' aria-current="page"' : ""}>${icon(ic)}</a>`,
    ).join("\n    ")}
  </nav>
  <div class="rail-foot">
    <a class="nav-item" href="#0" title="Settings" aria-label="Settings">${icon("gear")}</a>
    <a class="nav-item" href="#0" aria-label="Chase L."><span class="avatar" aria-hidden="true">C</span></a>
  </div>
</aside>`;

/* Horizontal masthead (Masthead layout) */
export const mastheadBar = (markVariant) => `
<header class="topbar">
  <a class="brand" href="#0">${mark(markVariant)}<span class="brand-name">Wiskr</span></a>
  <nav class="topnav" aria-label="Workspace">
    ${NAV.slice(0, 6)
      .map(
        ([label, , active]) =>
          `<a class="topnav-item${active ? " is-active" : ""}" href="#0"${active ? ' aria-current="page"' : ""}>${label}</a>`,
      )
      .join("\n    ")}
    <a class="topnav-item" href="#0">More</a>
  </nav>
  <div class="topbar-end">
    <button class="btn btn-quiet btn-small" type="button">New quiz</button>
    <a class="nav-item" href="#0"><span class="avatar" aria-hidden="true">C</span></a>
  </div>
</header>`;

/* Second pane — workspace context (Panes layout, home) */
export const workspacePane = () => `
<aside class="pane">
  <p class="pane-title">Quizzes</p>
  <ul class="pane-list">
    <li class="pane-item is-on"><span class="dot is-setup"></span><span class="pane-name">New quiz</span></li>
    <li class="pane-item"><span class="dot is-draft"></span><span class="pane-name">Your Skin, Decoded</span></li>
    <li class="pane-item"><span class="dot is-draft"></span><span class="pane-name">Visual Mood Routine</span></li>
    <li class="pane-item"><span class="dot is-live"></span><span class="pane-name">Find your board</span></li>
    <li class="pane-item"><span class="dot is-live"></span><span class="pane-name">Gift finder — winter</span></li>
  </ul>
  <p class="pane-title">Saved views</p>
  <ul class="pane-list">
    <li class="pane-item"><span class="pane-name">Needs a fix &nbsp;<b>2</b></span></li>
    <li class="pane-item"><span class="pane-name">Published this month &nbsp;<b>6</b></span></li>
  </ul>
</aside>`;

/* Second pane — vertical stepper (Panes layout, builder) */
export const stepsPane = (currentIndex) => `
<aside class="pane">
  <p class="pane-title">Build</p>
  <ol class="vsteps">
    ${STEPS.map(([label, , hint], i) => {
      const state = i < currentIndex ? "done" : i === currentIndex ? "current" : "todo";
      return `<li class="vstep is-${state}">
      <span class="step-num">${state === "done" ? "&#10003;" : String(i + 1).padStart(2, "0")}</span>
      <span class="vstep-main"><span class="step-name">${label}</span><span class="vstep-hint">${hint}</span></span>
    </li>`;
    }).join("\n    ")}
  </ol>
  <div class="pane-foot">
    <button class="btn btn-primary btn-block" type="button">Continue</button>
    <button class="btn btn-ghost btn-block" type="button">Save and exit</button>
  </div>
</aside>`;

/* Compose a screen inside the chrome its layout calls for. */
const shell = (layout, screenId, step, body, pageClass = "") => {
  const flow = step != null;
  const page = `<div class="page ${pageClass}">${body}</div>`;
  if (layout === "masthead")
    return `<div class="app" data-layout="masthead" data-screen="${screenId}">
  ${mastheadBar("solid")}
  ${flow ? stepper(step) : ""}
  <main class="main">${page}</main>
</div>`;
  if (layout === "canvas")
    return `<div class="app" data-layout="canvas" data-screen="${screenId}">
  ${railIcons("solid")}
  <main class="main"><div class="sheet">${flow ? stepper(step) : ""}${page}</div></main>
</div>`;
  if (layout === "panes")
    return `<div class="app" data-layout="panes" data-screen="${screenId}">
  ${rail("solid")}
  ${flow ? stepsPane(step) : workspacePane()}
  <main class="main">${page}</main>
</div>`;
  /* rail — the builder deliberately drops the nav and goes full-bleed */
  return `<div class="app${flow ? " app-flow" : ""}" data-layout="rail" data-screen="${screenId}">
  ${flow ? stepper(step) : rail("solid")}
  <main class="main${flow ? " main-flow" : ""}">${page}</main>
</div>`;
};

/* ── Screen 1 — Studio home ─────────────────────────────────────────── */

const SPARKS = [
  [4, 6, 5, 9, 8, 12, 11, 15],
  [9, 8, 10, 9, 11, 10, 12, 13],
  [2, 3, 3, 5, 4, 6, 7, 7],
  [6, 7, 7, 9, 10, 10, 12, 14],
];

const spark = (i) => {
  const d = SPARKS[i];
  const max = Math.max(...d);
  const pts = d.map((v, x) => `${(x / (d.length - 1)) * 100},${28 - (v / max) * 24}`);
  return `<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
      <polygon class="spark-fill" points="0,30 ${pts.join(" ")} 100,30"/>
      <polyline class="spark-line" points="${pts.join(" ")}" fill="none"/>
      <circle class="spark-dot" cx="100" cy="${28 - (d[d.length - 1] / max) * 24}" r="2.4"/>
    </svg>`;
};

const STATS = [
  ["Quiz starts", "65", "+18% vs last week", "up"],
  ["Completion rate", "46%", "+4 pts vs last week", "up"],
  ["Emails captured", "10", "+3 vs last week", "up"],
  ["Published quizzes", "27", "2 added this week", "flat"],
];

const QUIZZES = [
  ["New quiz", "Edited 2 hours ago", "setup", "Setup"],
  ["Your Skin, Decoded — Visual Regimen Builder", "Edited 4 hours ago", "draft", "Draft"],
  ["Visual Mood Routine Builder", "Edited yesterday", "draft", "Draft"],
  ["Find your board — terrain &amp; skill", "Live · 41 starts this week", "live", "Live"],
];

const WEEK = [
  ["Sun", 2], ["Mon", 3], ["Tue", 2], ["Wed", 4], ["Thu", 3], ["Fri", 26], ["Sat", 25],
];

export const screenHome = (layout = "rail", state = "none") =>
  shell(layout, "home", null, homeBody(state), `home2 is-${state}`);

/* ── Screen 2 — Recommendations step ────────────────────────────────── */

/* The shipped flow, unchanged: four steps in this order. */
const STEPS = [
  ["Recommendations", "done", "31 products in the pool"],
  ["Questions", "done", "7 questions drafted"],
  ["Logic", "current", "4 rules · 1 decider"],
  ["Results", "todo", "Copy, cards, follow-up"],
];

/* OUT OF SCOPE. The step bar is not part of this revamp — it ships as it is
   today. A neutral strip marks where it sits so nobody reads its absence as
   a deletion, and so no screen below implies a design for it. */
export const stepper = () => `
<div class="stepbar-out" role="presentation">
  <span>Existing step bar &mdash; unchanged, not part of this revamp</span>
</div>`;

const COLLECTIONS = [
  ["Snowboards", 15, true],
  ["All-mountain", 13, true],
  ["Powder &amp; freeride", 3, true],
  ["Beginner-friendly", 8, false],
  ["Park &amp; freestyle", 6, false],
];

export const screenRecs = (layout = "rail") => shell(layout, "recs", 0, `
      <div class="step-head">
        <p class="eyebrow">Step 1 of 4</p>
        <h1 class="step-title">What should this quiz recommend?</h1>
        <p class="step-sub">Pick the pool of products the quiz chooses from. You can narrow it later with questions and rules.</p>
      </div>

      <div class="ai-note">
        <span class="ai-check" aria-hidden="true">&#10003;</span>
        <div>
          <p class="ai-title">Wiskr picked 9 products for your goal</p>
          <p class="ai-body">These cover the core routine — cleanse, tone, serum, eye cream and moisturise — so a first-time buyer gets a complete regimen the quiz can match to their skin type. Adjust the selection below, then generate.</p>
        </div>
        <button class="btn btn-quiet btn-small" type="button">Why these?</button>
      </div>

      <div class="tip">
        <span class="tip-mark" aria-hidden="true">&#9733;</span>
        <p class="tip-copy"><strong>Your 4 collections already match how you merchandise.</strong> Starting there usually beats hand-picking products.</p>
        <button class="btn btn-small btn-primary" type="button">Use collections</button>
        <button class="icon-btn" type="button" aria-label="Dismiss tip">&#215;</button>
      </div>

      <div class="two-up">
        <section class="card picker">
          <div class="seg" role="tablist" aria-label="Source">
            <button class="seg-btn" role="tab" aria-selected="false" type="button">Products <span class="seg-count">125</span></button>
            <button class="seg-btn" role="tab" aria-selected="false" type="button">Tags <span class="seg-count">32</span></button>
            <button class="seg-btn is-on" role="tab" aria-selected="true" type="button">Collections <span class="seg-count">5</span></button>
          </div>
          <div class="search">
            <svg class="ico" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="8" cy="8" r="5"/><path d="m12 12 3.5 3.5" stroke-linecap="round"/></svg>
            <input type="search" placeholder="Search collections" aria-label="Search collections">
          </div>
          <ul class="pick-list">
            ${COLLECTIONS.map(
              ([name, n, on]) => `<li class="pick${on ? " is-on" : ""}">
              <span class="check" aria-hidden="true"></span>
              <span class="pick-main">
                <span class="pick-name">${name}</span>
                <span class="pick-meta">Collection</span>
              </span>
              <span class="pick-count"><b>${n}</b> products</span>
            </li>`,
            ).join("\n            ")}
          </ul>
        </section>

        <aside class="card summary">
          <header class="card-head">
            <h2 class="card-title">In the pool</h2>
            <span class="tally"><b>31</b> products</span>
          </header>
          <ul class="chips">
            <li class="chip">Snowboards <button class="chip-x" type="button" aria-label="Remove Snowboards">&#215;</button></li>
            <li class="chip">All-mountain <button class="chip-x" type="button" aria-label="Remove All-mountain">&#215;</button></li>
            <li class="chip">Powder &amp; freeride <button class="chip-x" type="button" aria-label="Remove Powder and freeride">&#215;</button></li>
          </ul>
          <dl class="facts">
            <div><dt>With images</dt><dd>31 of 31</dd></div>
            <div><dt>In stock</dt><dd>28 of 31</dd></div>
            <div><dt>Price range</dt><dd>$429 – $886</dd></div>
          </dl>
          <p class="note"><strong>3 products are out of stock.</strong> They stay hidden from shoppers until they're back.</p>
          <button class="btn btn-quiet btn-block" type="button">Preview results page</button>
        </aside>
      </div>
`, "page-narrow");

/* ── Screen 3 — Logic ───────────────────────────────────────────────── */

const RULES = [
  [["Women", "Smart"], "show", "Workwear Capsule", "collection"],
  [["Relaxed"], "exclude", "Wool Trousers, Unstructured Blazer", null],
  [["Training kit", "Under $60"], "show", "Base Layer, Training Short, Running Tee", null],
  [["Women", "L–XL", "Athletic"], "show", "chiffon-lite", "tag"],
];

/* Counts are what the trigger MATCHES in the catalogue — not a narrowing
   fraction. Nothing has been chosen yet, so "20 / 23" claims a filter that
   has not happened. */
const QGROUPS = [
  {
    q: "What are you shopping for?",
    role: "Picks the result",
    attr: null,
    kind: "decider",
    rows: [
      ["A", "Work clothes", [["Workwear Capsule", "col"]], 8, "Next question"],
      ["B", "Weekend basics", [["Weekend Capsule", "col"]], 6, "Next question"],
      ["C", "Training kit", [["Performance Capsule", "col"]], 6, "Next question"],
    ],
  },
  {
    q: "Who are you shopping for?",
    role: "Narrows",
    attr: "custom.gender",
    kind: "narrow",
    rows: [
      ["A", "Men", [["Men", "a"], ["Unisex", "a"]], 20, "Next question"],
      ["B", "Women", [["Women", "a"], ["Unisex", "a"]], 20, "Next question"],
      ["C", "Doesn't matter", [["No filter", "none"]], 23, "Next question"],
    ],
  },
  {
    q: "How do you like things to fit?",
    role: "Narrows",
    attr: "custom.fit_profile_primary",
    kind: "narrow",
    rows: [
      ["A", "Slim", [["Slim", "b"]], 9, "Next question"],
      ["B", "Regular", [["Regular", "b"]], 17, "Next question"],
      ["C", "Relaxed", [["Relaxed", "b"]], 5, "Results"],
      ["D", "No preference", [["No filter", "none"]], 23, "Next question"],
    ],
  },
];

const rulePill = (t) => `<b class="ans">${t}</b>`;

export const screenLogic = (layout = "rail") => shell(layout, "logic", 2, `
      <section class="card block">
        <header class="card-head">
          <h2 class="card-title">Rules</h2>
          <p class="card-meta">Run first, in order. A rule that matches overrides the questions below.</p>
          <button class="explain-btn" type="button"><span class="explain-ico" aria-hidden="true">&#10022;</span>How rules work</button>
          <button class="btn btn-small btn-primary" type="button">Add rule</button>
        </header>
        <ol class="rules">
          ${RULES.map(
            ([answers, verb, target, kind], i) => `<li class="rule">
            <span class="rule-n">${i + 1}</span>
            <p class="rule-copy"><span class="rule-when">When they pick</span> ${answers.map(rulePill).join(' <span class="op">and</span> ')} <span class="arrow" aria-hidden="true">&#8594;</span> <span class="verb is-${verb}">${verb}</span> ${target}${kind ? ` <span class="rule-kind">${kind}</span>` : ""}</p>
            <button class="icon-btn" type="button" aria-label="Delete rule ${i + 1}">&#215;</button>
          </li>`,
          ).join("\n          ")}
        </ol>
      </section>

      <section class="card block">
        <header class="card-head">
          <h2 class="card-title">Questions</h2>
          <p class="card-meta">Each question either picks the result or narrows on one product attribute.</p>
          <button class="explain-btn" type="button"><span class="explain-ico" aria-hidden="true">&#10022;</span>How questions work</button>
        </header>

        <div class="table-wrap">
          <table class="ltable">
            <thead>
              <tr>
                <th scope="col">Question</th>
                <th scope="col">Answer</th>
                <th scope="col">Maps to</th>
                <th scope="col" class="num">Products</th>
                <th scope="col">Then go to</th>
              </tr>
            </thead>
            ${QGROUPS.map(
              (g) => `<tbody class="qgroup">
              ${g.rows
                .map(
                  (r, i) => `<tr>
                ${
                  i === 0
                    ? `<th scope="rowgroup" rowspan="${g.rows.length}" class="qcell">
                    <span class="qtext">${g.q}</span>
                    <div class="role-stack">
                      <button class="role is-${g.kind}" type="button">${g.role} <span class="caret" aria-hidden="true">&#9662;</span></button>
                      ${g.attr ? `<button class="attr-slot" type="button" title="${g.attr}"><span>${g.attr}</span><span class="caret" aria-hidden="true">&#9662;</span></button>` : ""}
                    </div>
                  </th>`
                    : ""
                }
                <td class="atext"><span class="akey">${r[0]}</span>${r[1]}</td>
                <td class="acts">${r[2].map(([t, tone]) => `<span class="tag is-${tone}">${t}</span>`).join(" ")}</td>
                <td class="num"><button class="count-btn" type="button">${r[3]}<span>products</span></button></td>
                <td class="goto"><span class="goto-val">${r[4]}</span></td>
              </tr>`,
                )
                .join("\n              ")}
            </tbody>`,
            ).join("\n            ")}
          </table>
        </div>
      </section>


      <div class="pp" role="dialog" aria-label="Products in Workwear Capsule">
        <header class="pp-head">
          <div>
            <p class="pp-title">Workwear Capsule <span class="tag is-col">collection</span></p>
            <p class="pp-sub"><b>8</b> products matched &middot; synced from Shopify 4 minutes ago</p>
          </div>
          <button class="icon-btn" type="button" aria-label="Close">&#215;</button>
        </header>
        <div class="pp-grid">
            <article class="pp-card"><div class="pp-img pp-img-1" aria-hidden="true"></div><p class="pp-name">Wool Trousers</p><p class="pp-meta">$189.00<span class="pp-stock is-ok">In stock</span></p></article>
            <article class="pp-card"><div class="pp-img pp-img-2" aria-hidden="true"></div><p class="pp-name">Unstructured Blazer</p><p class="pp-meta">$320.00<span class="pp-stock is-ok">In stock</span></p></article>
            <article class="pp-card"><div class="pp-img pp-img-3" aria-hidden="true"></div><p class="pp-name">Oxford Shirt</p><p class="pp-meta">$95.00<span class="pp-stock is-ok">In stock</span></p></article>
            <article class="pp-card"><div class="pp-img pp-img-1" aria-hidden="true"></div><p class="pp-name">Merino Crewneck</p><p class="pp-meta">$140.00<span class="pp-stock is-low">Low stock</span></p></article>
            <article class="pp-card"><div class="pp-img pp-img-2" aria-hidden="true"></div><p class="pp-name">Pleated Chino</p><p class="pp-meta">$120.00<span class="pp-stock is-ok">In stock</span></p></article>
            <article class="pp-card"><div class="pp-img pp-img-3" aria-hidden="true"></div><p class="pp-name">Silk Blouse</p><p class="pp-meta">$165.00<span class="pp-stock is-ok">In stock</span></p></article>
            <article class="pp-card"><div class="pp-img pp-img-1" aria-hidden="true"></div><p class="pp-name">Tailored Skirt</p><p class="pp-meta">$145.00<span class="pp-stock is-out">Out of stock</span></p></article>
            <article class="pp-card"><div class="pp-img pp-img-2" aria-hidden="true"></div><p class="pp-name">Knit Waistcoat</p><p class="pp-meta">$110.00<span class="pp-stock is-ok">In stock</span></p></article>
        </div>
        <footer class="pp-foot">
          <span>Answer <b>A &middot; Work clothes</b> shows this collection.</span>
          <button class="btn btn-quiet btn-small" type="button">Open in Shopify</button>
        </footer>
      </div>

      <div class="popover" role="dialog" aria-label="What Q1 does">
        <p class="pop-head">Question 1 does</p>
        <ul class="pop-list">
          <li class="pop-item is-on"><span class="radio" aria-hidden="true"></span><span class="pop-label">Picks the result</span><span class="pop-meta">1 allowed</span></li>
          <li class="pop-item"><span class="radio" aria-hidden="true"></span><span class="pop-label">Narrows by Gender</span><span class="pop-meta">20 of 20</span></li>
          <li class="pop-item"><span class="radio" aria-hidden="true"></span><span class="pop-label">Narrows by Fit</span><span class="pop-meta">also Q3</span></li>
          <li class="pop-item"><span class="radio" aria-hidden="true"></span><span class="pop-label">Narrows by Size</span><span class="pop-meta">also Q4</span></li>
        </ul>
        <p class="pop-foot">One question picks the result. Every other question narrows on a single attribute.</p>
      </div>
`);

/* ── Screen 4 — Results builder ─────────────────────────────────────── */

export const screenResults = (layout = "rail") => shell(layout, "results", 3, `
      <section class="edit">
        <div class="progress" aria-label="Step 1 of 6">
          ${[1, 2, 3, 4, 5, 6].map((n) => `<span class="pip${n === 1 ? " is-on" : ""}"></span>`).join("")}
        </div>
        <p class="eyebrow">Step 1 of 6 · The page copy</p>
        <h1 class="step-title">What does the results page say?</h1>
        <p class="step-sub">The first thing a shopper reads after answering. Name what they got, not the quiz they took.</p>

        <label class="field">
          <span class="field-label">Headline</span>
          <input type="text" value="Your board is the Videographer">
        </label>
        <div class="sugg">
          <span class="sugg-label">Try</span>
          <button class="sugg-btn" type="button">We found your fit</button>
          <button class="sugg-btn" type="button">Made for how you ride</button>
          <button class="sugg-btn" type="button">Your match, in one board</button>
        </div>

        <label class="field">
          <span class="field-label">Intro line</span>
          <textarea rows="3">All-mountain, forgiving edge, built for the days you actually ride. Here's why it beat the other 30.</textarea>
        </label>
        <div class="sugg">
          <span class="sugg-label">Try</span>
          <button class="sugg-btn" type="button">Based on your answers…</button>
          <button class="sugg-btn" type="button">Matched to how and where you ride</button>
        </div>

        <div class="edit-foot">
          <button class="btn btn-primary" type="button">Next: the product card</button>
          <span class="autosave">Saved</span>
        </div>
      </section>

      <aside class="preview" data-device="phone">
        <div class="preview-bar">
          <div class="seg seg-sm" role="group" aria-label="Preview device">
            <button class="seg-btn is-on" type="button" data-device-set="phone" aria-pressed="true">Phone</button>
            <button class="seg-btn" type="button" data-device-set="desktop" aria-pressed="false">Desktop</button>
          </div>
          <span class="dev-zoom">100%</span>
        </div>

        <div class="devbox" data-dev="phone">
          <div class="phone"><div class="phone-screen">
            <div class="q-head">
              <p class="q-eyebrow">Your result</p>
              <h2 class="q-title">Your board is the Videographer</h2>
              <p class="q-sub">All-mountain, forgiving edge, built for the days you actually ride. Here's why it beat the other 30.</p>
            </div>
            <article class="q-hero">
              <div class="q-img q-img-1" aria-hidden="true"><span class="ribbon">Top pick</span></div>
              <div class="q-body">
                <h3 class="q-name">The Videographer Snowboard</h3>
                <p class="q-why">Matches <b>all-mountain</b> and <b>intermediate</b> — the two answers that mattered most.</p>
                <p class="q-price">$886.00</p>
                <button class="q-cta" type="button">Add to cart</button>
              </div>
            </article>
            <p class="q-alt-head">Also worth a look</p>
            <div class="q-alts">
              <article class="q-alt"><div class="q-img q-img-2" aria-hidden="true"></div><p class="q-alt-name">The Multi-managed</p><p class="q-alt-price">$629.00</p></article>
              <article class="q-alt"><div class="q-img q-img-3" aria-hidden="true"></div><p class="q-alt-name">Compass Wide</p><p class="q-alt-price">$549.00</p></article>
            </div>
          </div></div>
        </div>

        <div class="devbox" data-dev="inline">
          <div class="embed-frame">
            <div class="q-head">
              <p class="q-eyebrow">Your result</p>
              <h2 class="q-title">Your board is the Videographer</h2>
              <p class="q-sub">All-mountain, forgiving edge, built for the days you actually ride. Here's why it beat the other 30.</p>
            </div>
            <article class="q-hero">
              <div class="q-img q-img-1" aria-hidden="true"><span class="ribbon">Top pick</span></div>
              <div class="q-body">
                <h3 class="q-name">The Videographer Snowboard</h3>
                <p class="q-why">Matches <b>all-mountain</b> and <b>intermediate</b> &mdash; the two answers that mattered most.</p>
                <p class="q-price">$886.00</p>
                <button class="q-cta" type="button">Add to cart</button>
              </div>
            </article>
            <div class="q-alts">
              <article class="q-alt"><div class="q-img q-img-2" aria-hidden="true"></div><p class="q-alt-name">The Multi-managed</p><p class="q-alt-price">$629.00</p></article>
              <article class="q-alt"><div class="q-img q-img-3" aria-hidden="true"></div><p class="q-alt-name">Compass Wide</p><p class="q-alt-price">$549.00</p></article>
            </div>
          </div>
        </div>

      </aside>
`, "split");

/* ── Screen 5 — the editor canvas ───────────────────────────────────── */

const EDITOR_NAV = [
  ["Build", "stack", true],
  ["Design", "palette", false],
  ["Products", "plug", false],
  ["Logic", "chart", false],
  ["Analytics", "chart", false],
  ["Settings", "gear", false],
];

const FLOW_TREE = [
  { n: 1, name: "Intro page", open: true, sel: false, kids: [
    ["Heading", "H", false], ["Text", "T", true], ["Button", "B", false],
  ]},
  { n: 2, name: "Q1 · Skin type", open: false, sel: false, kids: [] },
  { n: 3, name: "Q2 · Concerns", open: false, sel: false, kids: [] },
  { n: 4, name: "Email signup", open: false, sel: false, kids: [], flag: true },
  { n: 5, name: "Results", open: false, sel: false, kids: [], sub: "2 pages" },
];

const slider = (label, value, pct) => `
<div class="ctl">
  <span class="ctl-label">${label}</span>
  <span class="slider" aria-hidden="true"><span class="slider-fill" style="width:${pct}%"></span><span class="slider-knob" style="left:${pct}%"></span></span>
  <span class="ctl-val">${value}</span>
</div>`;

export const screenEditor = (layout = "rail") => {
  const body = `
<div class="editor">
  <header class="ed-top">
    <nav class="crumbs" aria-label="Breadcrumb">
      <a href="#0">Quizzes</a><span class="crumb-sep">/</span><b>Skin quiz</b>
    </nav>
    <span class="saved">All changes saved</span>
    <div class="ed-top-end">
      <button class="icon-btn" type="button" aria-label="Undo">&#8630;</button>
      <button class="icon-btn" type="button" aria-label="Redo">&#8631;</button>
      <button class="icon-btn is-ai" type="button" aria-label="Ask Wiskr">&#10022;</button>
      <span class="pill is-draft">Draft · 10 unpublished</span>
      <button class="btn btn-primary btn-small" type="button">Publish</button>
    </div>
  </header>

  <div class="ed-body">
    <nav class="ed-rail" aria-label="Editor sections">
      ${EDITOR_NAV.map(
        ([label, ic, active]) =>
          `<a class="ed-rail-item${active ? " is-active" : ""}" href="#0"${active ? ' aria-current="page"' : ""}>${icon(ic)}<span>${label}</span></a>`,
      ).join("\n      ")}
    </nav>

    <aside class="ed-panel">
      <div class="seg seg-sm ed-tabs">
        <button class="seg-btn is-on" type="button" aria-selected="true">Flow</button>
        <button class="seg-btn" type="button" aria-selected="false">Add</button>
        <button class="seg-btn" type="button" aria-selected="false">Templates</button>
      </div>
      <ul class="tree">
        ${FLOW_TREE.map(
          (s) => `<li>
          <div class="tree-row${s.open ? " is-open" : ""}">
            <span class="tw" aria-hidden="true">${s.open ? "&#9662;" : "&#9656;"}</span>
            <span class="tree-n">${s.n}</span>
            <span class="tree-name">${s.name}${s.sub ? ` <span class="tree-sub">${s.sub}</span>` : ""}</span>
            ${s.flag ? '<span class="tree-flag" title="Fix"></span>' : ""}
          </div>
          ${s.kids.length ? `<ul class="tree-kids">${s.kids
            .map(
              ([k, g, sel]) =>
                `<li class="tree-kid${sel ? " is-sel" : ""}"><span class="kid-g">${g}</span><span>${k}</span></li>`,
            )
            .join("")}</ul>` : ""}
        </li>`,
        ).join("\n        ")}
      </ul>
      <button class="add-step" type="button">Add a step</button>
    </aside>

    <section class="ed-canvas">
      <div class="canvas-bar">
        <span class="canvas-name">Intro page</span>
        <div class="seg seg-sm" role="group" aria-label="Preview device"><button class="seg-btn is-on" type="button" data-device-set="phone" aria-pressed="true">Phone</button><button class="seg-btn" type="button" data-device-set="desktop" aria-pressed="false">Desktop</button></div>
        <div class="seg seg-sm"><button class="seg-btn is-on" type="button">Edit</button><button class="seg-btn" type="button">Preview</button></div>
        <div class="seg seg-sm"><button class="seg-btn is-on" type="button">One screen</button><button class="seg-btn" type="button">All screens</button></div>
      </div>
      <div class="canvas-stage" data-device="phone">
        <div class="stage-tools" role="toolbar" aria-label="Selected block">
          <button type="button" aria-label="Move up">&#8593;</button>
          <button type="button" aria-label="Move down">&#8595;</button>
          <button type="button" aria-label="Duplicate">&#9099;</button>
          <button type="button" aria-label="Delete">&#215;</button>
        </div>
        <div class="devbox stage-desktop" data-dev="inline">
          <div class="embed-frame stage-screen embed-stage-screen">
            <h3 class="blk blk-h">Find your skincare routine</h3>
            <p class="blk blk-t is-sel">Six questions, about a minute. We'll match you to a routine that fits your skin &mdash; not someone else's.<span class="sel-tag">Text</span></p>
            <button class="blk blk-b" type="button">Start</button>
            <p class="blk blk-back">&#8592; Back</p>
          </div>
        </div>
        <div class="devbox" data-dev="phone"><div class="phone stage-phone">
          <div class="stage-screen">
            <h3 class="blk blk-h">Find your skincare routine</h3>
            <p class="blk blk-t is-sel">Six questions, about a minute. We'll match you to a routine that fits your skin — not someone else's.<span class="sel-tag">Text</span></p>
            <button class="blk blk-b" type="button">Start</button>
            <p class="blk blk-back">&#8592; Back</p>
            <p class="fold">fold</p>
          </div>
        </div></div>
      </div>
    </section>

    <aside class="ed-inspect">
      <div class="seg seg-sm ed-tabs">
        <button class="seg-btn" type="button" aria-selected="false">Content</button>
        <button class="seg-btn is-on" type="button" aria-selected="true">Design</button>
        <button class="seg-btn" type="button" aria-selected="false">Rules</button>
      </div>
      <div class="insp">
        <p class="insp-head">Text block</p>
        <p class="insp-note">One layout, and everything about it is below.</p>

        <div class="insp-group">
          <p class="insp-title">Space</p>
          ${slider("Above", "18", 34)}
          ${slider("Below", "0", 0)}
          ${slider("Sides", "0", 0)}
          <button class="insp-more" type="button">Each side on its own</button>
        </div>

        <div class="insp-group">
          <p class="insp-title">Alignment</p>
          <div class="seg seg-sm insp-seg"><button class="seg-btn" type="button">Left</button><button class="seg-btn is-on" type="button">Centre</button><button class="seg-btn" type="button">Right</button></div>
        </div>

        <div class="insp-group">
          <p class="insp-title">Type</p>
          ${slider("Size", "16", 22)}
          <div class="seg seg-sm insp-seg"><button class="seg-btn is-on" type="button">Regular</button><button class="seg-btn" type="button">Medium</button><button class="seg-btn" type="button">Bold</button></div>
        </div>

        <div class="insp-group">
          <p class="insp-title">Colour</p>
          <div class="ctl">
            <span class="ctl-label">Fill</span>
            <span class="sw" style="background:#2A211A" aria-hidden="true"></span>
            <span class="ctl-name">Espresso</span>
            <span class="ctl-val is-code">#2A211A</span>
          </div>
          <p class="insp-hint">From your brand palette. Change it here and only this block changes.</p>
        </div>
      </div>
    </aside>
  </div>
</div>`;

  if (layout === "masthead")
    return `<div class="app" data-layout="masthead" data-screen="editor">
  ${mastheadBar("solid")}
  <main class="main main-bleed">${body}</main>
</div>`;
  if (layout === "canvas")
    return `<div class="app" data-layout="canvas" data-screen="editor">
  ${railIcons("solid")}
  <main class="main"><div class="sheet">${body}</div></main>
</div>`;
  if (layout === "panes")
    return `<div class="app" data-layout="panes" data-screen="editor">
  ${rail("solid")}
  <main class="main main-bleed" style="grid-column: 2 / -1">${body}</main>
</div>`;
  return `<div class="app app-flow" data-layout="rail" data-screen="editor">
  <main class="main main-bleed">${body}</main>
</div>`;
};

/* ── Screen 6 — generating ──────────────────────────────────────────── */

const GEN = [
  ["Reading your catalog", "done"],
  ["Drafting tailored quiz types", "done"],
  ["Writing your questions", "now"],
  ["Building your results page", "todo"],
];

export const screenDrafting = (layout = "rail") =>
  shell(layout, "drafting", 1, `
      <div class="gen-wrap">
        <div class="gen-card">
          <div class="gen-ring" aria-hidden="true">
            <span class="gen-ring-wrap"><span class="gen-ring-core"></span></span>
            <i class="gen-spark s1"></i><i class="gen-spark s2"></i><i class="gen-spark s3"></i><i class="gen-spark s4"></i>
          </div>
          <h1 class="gen-title">Writing your questions</h1>
          <ol class="gen-steps">
            ${GEN.map(
              ([label, st]) =>
                `<li class="gen-step is-${st}"><span class="gen-dot" aria-hidden="true">${st === "done" ? "&#10003;" : ""}</span>${label}</li>`,
            ).join("\n            ")}
          </ol>
        </div>
      </div>
`);

/* ── Screen 7 — the Questions tab ───────────────────────────────────── */

/* [question, answers, isDecider, attribute|null] — attribute is what the
   question narrows on, chosen through the picker. null = not set yet. */
const QUESTIONS = [
  ["Which skin concern is most pressing for you right now?", ["Dryness and dehydration — skin feels tight or dull", "Visible signs of aging — fine lines or uneven texture", "Sensitivity and reactivity — redness or irritation", "Congestion or uneven tone — pores, dullness, buildup", "Not sure yet — I'm new to skincare"], true, null],
  ["How does your skin feel a few hours after cleansing, with nothing applied?", ["Tight, flaky, or visibly dry", "Comfortable and balanced", "Oily or shiny across the forehead and nose", "Oily in some areas, dry in others", "Easily flushed, itchy, or reactive"], false, "custom.skin_type"],
  ["How would you describe your daily environment and activity level?", ["Mostly indoors — climate controlled", "Frequently outdoors — sun, wind, seasonal change", "High-activity — sweat and frequent cleansing", "Variable — it shifts week to week"], false, null],
  ["Which cleansing outcome matters most to you?", ["A deep clean that removes everything", "A gentle clean that never strips", "Something that doubles as makeup removal", "Fast — I want one step"], false, "custom.cleanser_texture_preference_v2"],
  ["When it comes to hydration, does your skin respond better to…", ["Lightweight gels", "Rich creams", "Layered serums", "I honestly don't know"], false, "custom.texture"],
  ["Which ingredient priority resonates most with you?", ["Proven actives, whatever the source", "Gentle and fragrance-free", "Naturally derived where possible", "Fewest ingredients overall"], false, null],
  ["How many steps are you realistically prepared to keep up?", ["Two — cleanse and moisturise", "Three or four", "Five or more, I enjoy the ritual"], false, "custom.routine_length"],
];

const flowRow = (q, i) => {
  const [text, answers] = q;
  return `<li class="fq${i === 0 ? " is-on" : ""}">
      <span class="fq-n">${i + 1}</span>
      <span class="fq-main">
        <span class="fq-text">${text}</span>
        <span class="fq-meta">${answers.length} answers</span>
      </span>
      <span class="fq-grip" aria-hidden="true"><i></i><i></i><i></i></span>
    </li>`;
};

export const screenQuestions = (layout = "rail") =>
  shell(layout, "questions", 1, `
      <div class="qtab">
        <header class="qtab-bar">
          <div class="seg seg-sm">
            <button class="seg-btn is-on" type="button">Questions</button>
            <button class="seg-btn" type="button">Overview</button>
          </div>
          <p class="qtab-hint">Click any text in the preview to edit it</p>
          <button class="btn btn-quiet btn-small" type="button">Question library</button>
          <button class="btn btn-primary btn-small" type="button">Add question</button>
        </header>

        <div class="qtab-body">
          <aside class="qflow">
            <p class="qflow-head">Flow <span>7 questions &middot; 2 extra steps</span></p>
            <ol class="fq-list">${QUESTIONS.map(flowRow).join("\n            ")}</ol>
            <ul class="fq-extra">
              <li class="fq-step"><span class="fq-ico" aria-hidden="true">&#9993;</span><span class="fq-main"><span class="fq-text">Email capture</span><span class="fq-meta">Optional &middot; before results</span></span></li>
              <li class="fq-step"><span class="fq-ico" aria-hidden="true">&#9673;</span><span class="fq-main"><span class="fq-text">Result reveal</span><span class="fq-meta">Step 4 &middot; results page</span></span></li>
            </ul>
          </aside>

          <section class="qedit">
            <div class="qedit-bar">
              <span class="qedit-label">Question 1</span>
              <label class="qedit-type">
                <span class="sr-only">Answer type</span>
                <select><option>Single select</option><option>Multi select</option><option>Image choice</option></select>
              </label>
              <div class="seg seg-sm qedit-dev">
                <button class="seg-btn is-on" type="button">Phone</button>
                <button class="seg-btn" type="button">Desktop</button>
              </div>
            </div>

            <div class="qedit-stage">
              <div class="devbox" data-dev="phone"><div class="phone qphone"><div class="phone-screen qphone-screen">
                <ol class="pg-phases" aria-label="Progress">
                  <li class="is-now"><span>Your skin</span><i><b style="width:34%"></b></i></li>
                  <li><span>Routine</span><i><b style="width:0"></b></i></li>
                  <li><span>Your match</span><i><b style="width:0"></b></i></li>
                </ol>
                <h3 class="qq">Which skin concern is most pressing for you right now?</h3>
                <ul class="qa-list">
                  ${QUESTIONS[0][1]
                    .map((a, j) => `<li class="qa${j === 0 ? " is-on" : ""}">${a}</li>`)
                    .join("\n                  ")}
                </ul>
                <button class="qz-next" type="button">Next</button>
              </div></div></div>
            </div>
          </section>
        </div>
      </div>
`);

/* ── Screen 8 — Questions · Overview ────────────────────────────────── */

export const screenOverview = (layout = "rail") =>
  shell(layout, "overview", 1, `
      <div class="qtab">
        <header class="qtab-bar">
          <div class="seg seg-sm">
            <button class="seg-btn" type="button">Questions</button>
            <button class="seg-btn is-on" type="button">Overview</button>
          </div>
          <p class="qtab-hint">Click any question or answer to edit it</p>
          <button class="btn btn-quiet btn-small" type="button">Question library</button>
          <button class="btn btn-primary btn-small" type="button">Add question</button>
        </header>

        <div class="ovw">
          <div class="ovw-head">
            <span>#</span><span>Question</span><span>Answers</span><span>Type &amp; role</span>
          </div>
          ${QUESTIONS.slice(0, 4)
            .map(
              (q, i) => `<article class="ovw-row${q[2] ? " is-decider" : ""}">
            <span class="ovw-n">${i + 1}</span>
            <div class="ovw-q"><p class="ovw-text" contenteditable="true" spellcheck="false" role="textbox" tabindex="0">${q[0]}</p></div>
            <ul class="ovw-answers">
              ${q[1].map((a) => `<li contenteditable="true" spellcheck="false" role="textbox" tabindex="0">${a}</li>`).join("")}
              <li class="ovw-add"><button type="button">Add answer</button></li>
            </ul>
            <div class="ovw-type">
              <label><span class="sr-only">Answer type</span><select><option>Single select</option><option>Multi select</option></select></label>
              <div class="role-stack">
                <button class="role-tag${q[2] ? " is-decider" : ""}" type="button">${q[2] ? "Decides" : "Narrows"}<span class="caret" aria-hidden="true">&#9662;</span></button>
                ${
                  q[2]
                    ? ""
                    : q[3]
                      ? `<span class="attr-slot" title="${q[3]}"><span>${q[3]}</span><button class="attr-x" type="button" aria-label="Clear attribute">&#215;</button></span>`
                      : `<button class="attr-slot is-empty" type="button">Choose attribute</button>`
                }
              </div>
            </div>
          </article>`,
            )
            .join("\n          ")}
          <button class="ovw-more" type="button">Show the other 3 questions</button>
        </div>

        <div class="ap" role="dialog" aria-label="Choose how this question narrows">
          <header class="ap-head">
            <div>
              <p class="ap-title">How should question 2 narrow?</p>
              <p class="ap-sub">Answers are matched against one product attribute. Everything that doesn't match is dropped for that shopper.</p>
            </div>
            <button class="icon-btn" type="button" aria-label="Close">&#215;</button>
          </header>
          <div class="ap-search">
            <svg class="ico" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="8" cy="8" r="5"/><path d="m12 12 3.5 3.5" stroke-linecap="round"/></svg>
            <input type="search" placeholder="Search metafields, tags, collections…" aria-label="Search attributes">
          </div>
          <div class="seg seg-sm ap-tabs">
            <button class="seg-btn is-on" type="button">Metafields <span class="seg-count">18</span></button>
            <button class="seg-btn" type="button">Tags <span class="seg-count">32</span></button>
            <button class="seg-btn" type="button">Collections <span class="seg-count">5</span></button>
            <button class="seg-btn" type="button">Options <span class="seg-count">4</span></button>
          </div>
          <ul class="ap-list">
            <li class="ap-row is-on"><span class="radio" aria-hidden="true"></span><span class="ap-main"><span class="ap-key">custom.skin_type</span><span class="ap-vals">Dry · Oily · Combination · Sensitive</span></span><span class="ap-kind">Metafield</span><span class="ap-cov">23 of 23</span></li>
            <li class="ap-row"><span class="radio" aria-hidden="true"></span><span class="ap-main"><span class="ap-key">custom.texture</span><span class="ap-vals">Gel · Cream · Serum · Balm</span></span><span class="ap-kind">Metafield</span><span class="ap-cov">21 of 23</span></li>
            <li class="ap-row"><span class="radio" aria-hidden="true"></span><span class="ap-main"><span class="ap-key">custom.routine_length</span><span class="ap-vals">2 steps · 3–4 · 5+</span></span><span class="ap-kind">Metafield</span><span class="ap-cov">19 of 23</span></li>
            <li class="ap-row"><span class="radio" aria-hidden="true"></span><span class="ap-main"><span class="ap-key">custom.cleanser_texture_preference_v2</span><span class="ap-vals">Foaming · Milk · Oil · Balm</span></span><span class="ap-kind">Metafield</span><span class="ap-cov">17 of 23</span></li>
            <li class="ap-row"><span class="radio" aria-hidden="true"></span><span class="ap-main"><span class="ap-key">Concern</span><span class="ap-vals">dryness · aging · sensitivity · congestion</span></span><span class="ap-kind">Tag</span><span class="ap-cov">23 of 23</span></li>
            <li class="ap-row is-thin"><span class="radio" aria-hidden="true"></span><span class="ap-main"><span class="ap-key">custom.ingredient_priority</span><span class="ap-vals">Actives · Gentle · Natural</span></span><span class="ap-kind">Metafield</span><span class="ap-cov is-thin">9 of 23</span></li>
          </ul>
          <footer class="ap-foot">
            <span class="ap-note"><b>Coverage matters.</b> An attribute only some products carry will drop the rest from every result.</span>
            <button class="btn btn-quiet btn-small" type="button">Cancel</button>
            <button class="btn btn-primary btn-small" type="button">Use</button>
          </footer>
        </div>

      </div>
`);


/* ── Screen 9 — the two explainers ──────────────────────────────────
   Every panel is sized to the SAME fixed body height, so no step ever
   scrolls. Chains that ran vertically and got cut off are now
   horizontal. Copy trimmed to one idea per step. */

const chain = (items) => `
  <div class="ex-chain">
    ${items.map(([label, kind, main, sub], i) => `
      ${i ? '<span class="ex-arrow" aria-hidden="true">&#8594;</span>' : ""}
      <div class="ex-node is-${kind}">
        <span class="ex-node-label">${label}</span>
        <span class="ex-node-main">${main}</span>
        ${sub ? `<span class="ex-node-sub">${sub}</span>` : ""}
      </div>`).join("")}
  </div>`;

const RULES_STEPS = [
  ["A rule is one sentence", `
    <p class="ex-lede">Every rule reads the same way: <b>when they answer this, do this, to these products.</b> Three real ones:</p>
    <div class="ex-grid">
      <div class="ex-grid-head">
        <span>When they answer</span><span></span><span>Do this</span><span></span><span>Which products</span>
      </div>
      <div class="ex-grid-row">
        <span class="ex-when">Oily <em>and</em> Sensitive</span>
        <span class="ex-arrow" aria-hidden="true">&#8594;</span>
        <span class="ex-verb is-show">Show these</span>
        <span class="ex-arrow" aria-hidden="true">&#8594;</span>
        <span class="ex-what"><em>tag</em> quiz-gentle</span>
      </div>
      <div class="ex-grid-row">
        <span class="ex-when">Polos <em>or</em> Beachwear</span>
        <span class="ex-arrow" aria-hidden="true">&#8594;</span>
        <span class="ex-verb is-exclude">Exclude</span>
        <span class="ex-arrow" aria-hidden="true">&#8594;</span>
        <span class="ex-what"><em>collection</em> Plus Size Streetwear</span>
      </div>
      <div class="ex-grid-row">
        <span class="ex-when">Lemon <em>and</em> Hydration</span>
        <span class="ex-arrow" aria-hidden="true">&#8594;</span>
        <span class="ex-verb is-highlight">Highlight</span>
        <span class="ex-arrow" aria-hidden="true">&#8594;</span>
        <span class="ex-what"><em>product</em> IV Hydration</span>
      </div>
    </div>
    <p class="ex-say"><b>&ldquo;When they answer Oily and Sensitive, show the products tagged quiz-gentle.&rdquo;</b></p>`],

  ["The first match wins", `
    <p class="ex-lede">Rules are checked top to bottom. <b>The first one that matches applies and the rest are skipped.</b> Drag a rule up to give it the final word.</p>
    <ol class="ex-rules">
      <li class="is-win"><span class="ex-n">1</span><span>Low energy <em>and</em> Vegan &rarr; show <b>supp-iron-vegan</b></span><span class="ex-verdict is-win">wins</span></li>
      <li><span class="ex-n">2</span><span>Low energy &rarr; show <b>supp-b12</b></span><span class="ex-verdict">skipped</span></li>
      <li><span class="ex-n">3</span><span>Athlete &rarr; show <b>supp-electrolyte</b></span><span class="ex-verdict">skipped</span></li>
      <li><span class="ex-n">4</span><span>Sleep support &rarr; show <b>supp-magnesium</b></span><span class="ex-verdict">skipped</span></li>
    </ol>
    <p class="ex-foot">A vegan shopper with low energy matches rules 1 and 2. Only rule 1 runs.</p>`],

  ["Rules alone can run a quiz", `
    <p class="ex-lede">No question has to touch your products. If your catalogue is already grouped &mdash; capsules, tagged ranges, bundles &mdash; rules can do the whole job.</p>
    <ol class="ex-rules is-plain">
      <li><span class="ex-n">1</span><span>Petite <em>and</em> Slim fit</span><span class="ex-verb is-show">Show</span><span class="ex-target">tag <b>fit-petite-slim</b></span></li>
      <li><span class="ex-n">2</span><span>Wide leg <em>or</em> Relaxed</span><span class="ex-verb is-show">Show</span><span class="ex-target">tag <b>fit-roomy</b></span></li>
      <li><span class="ex-n">3</span><span>Sensitive skin</span><span class="ex-verb is-exclude">Exclude</span><span class="ex-target">tag <b>fabric-wool</b></span></li>
      <li><span class="ex-n">4</span><span>First order</span><span class="ex-verb is-highlight">Highlight</span><span class="ex-target">product <b>Starter Tee</b></span></li>
    </ol>
    <p class="ex-foot">Best when you already know which products go together.</p>`],

  ["Rules name products in", `
    <div class="ex-two">
      <article class="ex-card is-rules">
        <p class="ex-card-kind">Rules</p>
        <p class="ex-card-title">Name products in</p>
        <p class="ex-card-body">You pick them yourself, by name. Best for hero sets and exceptions.</p>
        <div class="ex-move is-in" aria-hidden="true">
          <span class="ex-slots"><i></i><i></i><i></i><i class="ex-end"><b class="ex-token"></b></i></span>
          <span class="ex-dir">&#8592;</span>
          <span class="ex-move-cap">one added</span>
        </div>
      </article>
      <article class="ex-card is-questions">
        <p class="ex-card-kind">Questions</p>
        <p class="ex-card-title">Rule products out</p>
        <p class="ex-card-body">Your product data does the work. Start wide, then narrow with tags and metafields.</p>
        <div class="ex-move is-out" aria-hidden="true">
          <span class="ex-slots"><i></i><i></i><i></i><i class="ex-end"><b class="ex-token"></b></i></span>
          <span class="ex-dir">&#8594;</span>
          <span class="ex-move-cap">one dropped</span>
        </div>
      </article>
    </div>`],
];

const QUESTIONS_STEPS = [
  ["A question is one sentence", `
    <p class="ex-lede">A narrowing question does one thing: it matches the answer against your product data and <b>keeps only what matches.</b></p>
    ${chain([
      ["They pick", "in", "Women's", "one answer on &ldquo;Who is it for?&rdquo;"],
      ["Matched against", "mid", "custom.gender", "a metafield your products carry"],
      ["What survives", "out", "18 of 32", "the other 14 are gone for this shopper"],
    ])}
    <p class="ex-foot">One question, one or more attributes to narrow the results.</p>`],

  ["Each question narrows once", `
    <p class="ex-lede">One shopper, answering down the list. The count on the right is what is left after each question has had its turn.</p>
    <ol class="ex-narrow">
      <li class="is-start"><span class="ex-n">&#10022;</span><span class="ex-q">Electrolyte Range</span><span class="ex-badge is-start">Starting set</span><span class="ex-src">collection</span><span class="ex-left">18</span></li>
      <li><span class="ex-n">1</span><span class="ex-q">What are you using it for?</span><span class="ex-badge">Narrows</span><span class="ex-src">custom.use_case</span><span class="ex-left"><em>&minus;6</em> 12</span></li>
      <li><span class="ex-n">2</span><span class="ex-q">Any flavours to avoid?</span><span class="ex-badge">Narrows</span><span class="ex-src">tag flavor:*</span><span class="ex-left"><em>&minus;3</em> 9</span></li>
      <li><span class="ex-n">3</span><span class="ex-q">Powder or ready-to-drink?</span><span class="ex-badge">Narrows</span><span class="ex-src">tag &ldquo;foam&rdquo;</span><span class="ex-left"><em>&minus;3</em> 6</span></li>
      <li><span class="ex-n">4</span><span class="ex-q">How did you hear about us?</span><span class="ex-badge is-off">Asked only</span><span class="ex-src">changes nothing</span><span class="ex-left">6</span></li>
    </ol>
    <p class="ex-foot">This shopper reaches the results with <b>6 products</b> &mdash; and that is what your rules work with.</p>`],

  ["Questions rule products out", `
    <div class="ex-two">
      <article class="ex-card is-questions">
        <p class="ex-card-kind">Questions</p>
        <p class="ex-card-title">Rule products out</p>
        <p class="ex-card-body">Your product data does the work. Start wide, then narrow with tags and metafields.</p>
        <div class="ex-move is-out" aria-hidden="true">
          <span class="ex-slots"><i></i><i></i><i></i><i class="ex-end"><b class="ex-token"></b></i></span>
          <span class="ex-dir">&#8594;</span>
          <span class="ex-move-cap">one dropped</span>
        </div>
      </article>
      <article class="ex-card is-rules">
        <p class="ex-card-kind">Rules</p>
        <p class="ex-card-title">Name products in</p>
        <p class="ex-card-body">You pick them yourself, by name. Best for hero sets and exceptions.</p>
        <div class="ex-move is-in" aria-hidden="true">
          <span class="ex-slots"><i></i><i></i><i></i><i class="ex-end"><b class="ex-token"></b></i></span>
          <span class="ex-dir">&#8592;</span>
          <span class="ex-move-cap">one added</span>
        </div>
      </article>
    </div>`],

  ["Both together", `
    <p class="ex-lede">Questions cut the catalogue down. Rules then decide what to show out of what is left.</p>
    ${chain([
      ["Starting set", "in", "Summer Skincare", "collection &middot; 24 products"],
      ["Questions narrow", "mid", "Oily &middot; Sensitive", "&minus;15 &middot; 9 left"],
      ["Rules decide", "rule", '<em>If</em> Oily <em>and</em> Sensitive<span class="ex-then"><em>&rarr; show</em> tag <b>quiz-gentle</b></span>', "matched out of those 9"],
      ["Results", "out", "7 products", "what this shopper sees"],
    ])}
    <p class="ex-foot">The rule is specific on purpose: <b>two answers in, one tag out.</b> A <b>Show</b> rule replaces the set the questions built, so put it high only when you mean it.</p>`],
];

const explainer = (id, title, steps) => `
<div class="ex" data-ex="${id}" data-step="0">
  <header class="ex-head">
    <span class="ex-tag"><span class="explain-ico" aria-hidden="true">&#10022;</span>Explainer</span>
    <h3 class="ex-title">${title}</h3>
    <button class="icon-btn" type="button" aria-label="Close">&#215;</button>
  </header>
  <ol class="ex-steps">
    ${steps.map(([label], i) => `<li class="ex-step${i === 0 ? " is-now" : ""}" data-go="${i}"><span class="ex-step-n">${i + 1}</span>${label}</li>`).join("")}
  </ol>
  <div class="ex-body">
    ${steps.map(([, body], i) => `<section class="ex-panel${i === 0 ? " is-on" : ""}">${body}</section>`).join("")}
  </div>
  <footer class="ex-foot-bar">
    <span class="ex-count"><b>1</b> of ${steps.length}</span>
    <button class="btn btn-quiet btn-small ex-back" type="button" disabled>Back</button>
    <button class="btn btn-primary btn-small ex-next" type="button">Next</button>
  </footer>
</div>`;

export const screenExplainers = () => `
<div class="ex-wrap">
  ${explainer("rules", "How rules work", RULES_STEPS)}
  ${explainer("questions", "How questions work", QUESTIONS_STEPS)}
</div>`;

/* ── System sections ────────────────────────────────────────────────── */

export const swatchRow = (items) => `
<div class="swatches">
  ${items
    .map(
      ([name, hex, note, cls]) => `<figure class="swatch${cls ? ` ${cls}` : ""}">
    <span class="swatch-chip" style="background:${hex}"></span>
    <figcaption>
      <b>${name}</b>
      <code>${hex}</code>
      <span>${note}</span>
    </figcaption>
  </figure>`,
    )
    .join("\n  ")}
</div>`;

export const scaleTable = (rows) => `
<div class="table-wrap">
  <table class="spec">
    <thead><tr><th scope="col">Role</th><th scope="col">Face &amp; weight</th><th scope="col" class="num">Size</th><th scope="col" class="num">Line</th><th scope="col" class="num">Tracking</th><th scope="col">Used for</th></tr></thead>
    <tbody>
      ${rows.map(([role, face, size, line, track, use]) => `<tr><th scope="row">${role}</th><td>${face}</td><td class="num">${size}</td><td class="num">${line}</td><td class="num">${track}</td><td class="muted">${use}</td></tr>`).join("\n      ")}
    </tbody>
  </table>
</div>`;

export const components = () => `
<div class="kit">
  <div class="kit-cell">
    <p class="kit-label">Buttons</p>
    <div class="kit-row">
      <button class="btn btn-primary" type="button">Publish</button>
      <button class="btn btn-quiet" type="button">Preview</button>
      <button class="btn btn-ghost" type="button">Cancel</button>
      <button class="btn btn-primary" type="button" disabled>Publish</button>
    </div>
  </div>
  <div class="kit-cell">
    <p class="kit-label">Status</p>
    <div class="kit-row">
      <span class="pill is-live">Live</span>
      <span class="pill is-draft">Draft</span>
      <span class="pill is-setup">Setup</span>
      <span class="pill is-warn">Fix</span>
    </div>
  </div>
  <div class="kit-cell">
    <p class="kit-label">Field</p>
    <label class="field"><span class="field-label">Quiz name</span><input type="text" value="Find your board"></label>
  </div>
  <div class="kit-cell">
    <p class="kit-label">Segmented</p>
    <div class="seg"><button class="seg-btn is-on" type="button">Build</button><button class="seg-btn" type="button">Logic</button><button class="seg-btn" type="button">Design</button></div>
  </div>
  <div class="kit-cell">
    <p class="kit-label">Selection</p>
    <ul class="pick-list kit-picks">
      <li class="pick is-on"><span class="check" aria-hidden="true"></span><span class="pick-main"><span class="pick-name">Snowboards</span><span class="pick-meta">Collection</span></span><span class="pick-count"><b>15</b> products</span></li>
      <li class="pick"><span class="check" aria-hidden="true"></span><span class="pick-main"><span class="pick-name">Beginner-friendly</span><span class="pick-meta">Collection</span></span><span class="pick-count"><b>8</b> products</span></li>
    </ul>
  </div>
  <div class="kit-cell">
    <p class="kit-label">Message</p>
    <p class="note"><strong>3 products are out of stock.</strong> They stay hidden from shoppers until they're back.</p>
  </div>
</div>`;
