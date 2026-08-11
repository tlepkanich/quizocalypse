import { variant } from "./q-variants.mjs";

/* ── 1 — RAIL ─────────────────────────────────────────────────────── */
export const rail = variant({
  id: "quartz-1-rail", idx: 1, name: "Rail", layout: "rail", face: "figtree",
  title: "Rail",
  thesis:
    "A permanent left column for the workspace, and a builder that drops it. Navigation is always one click away when you're managing; it gets out of the way entirely when you're making.",
  facts: ["Figtree by default", "Left nav rail · 224px", "Builder goes full-bleed", "Widest builder canvas", "The familiar one"],
  ideaNote: "The layout most merchants already have a mental model for.",
  lede:
    "This is the conventional SaaS arrangement, done carefully: a 224px column with labelled nav on the left, content to the right of it. <strong>The one real decision is what happens when you start building.</strong> Here the rail disappears and the builder takes the whole window — because building a quiz is a task you finish, not a place you browse. That gives the logic table and the editor stage more room than any other layout in this set, at the cost of a moment's disorientation when the chrome changes.",
  principles: [
    ["Choice 01", "Labelled nav, always visible", "Eight destinations with words, not icons. Nothing to learn and nothing to hover to discover — the right trade for a product most merchants open a few times a week."],
    ["Choice 02", "The builder drops the chrome", "Once you're in a quiz, the workspace nav is replaced by a step bar. You're in a task; the exits are “Back” and “Save and exit”, not eight sidebar links."],
    ["Choice 03", "Content gets the rest", "No max-width on the work area. On a wide monitor the logic table and the editor stage simply get wider, which is what people with wide monitors want."],
  ],
  notes: {
    homeNote: "The rail is the constant. Everything else is one column of content.",
    recsNote: "Chrome drops to a step bar — you're building now, not browsing.",
    logicNote: "The widest version of the hard screen in this set: no rail, no pane, full window.",
    resultsNote: "All the width goes to the editor and the preview side by side.",
    editorNote: "The builder's own four regions get the entire window. Most room for the stage.",
  },
  fixes: [
    "Matches the mental model merchants bring from Shopify admin, Klaviyo and every other tool in their stack.",
    "Full-bleed building gives the logic table roughly 220px more width than any layout that keeps the rail.",
    "Labelled nav means no icon-guessing, which is the most common complaint about collapsed rails.",
  ],
  risks: [
    "The chrome change on entering the builder is a real context switch — some people find it disorienting the first few times.",
    "224px of permanent nav is a lot of pixels on a 13-inch laptop for something you use a few times an hour.",
    "Nowhere to put a secondary list (all your quizzes, all your steps) without a page navigation.",
  ],
});

/* ── 2 — MASTHEAD ─────────────────────────────────────────────────── */
export const masthead = variant({
  id: "quartz-2-masthead", idx: 2, name: "Masthead", layout: "masthead", face: "jakarta",
  title: "Masthead",
  thesis:
    "Navigation across the top, content in a centred column. The calmest of the four, and the one that reads least like a control room and most like a place you'd happily start your morning.",
  facts: ["Plus Jakarta by default", "Top nav · 58px", "Centred 1060px column", "Least chrome", "Calmest"],
  ideaNote: "For a product people visit, rather than one they live in.",
  lede:
    "A horizontal masthead costs 58px of height and gives back every pixel of width. Content then sits in a <strong>centred 1060px column</strong>, which does two things: it caps the reading measure so help text can never sprawl, and it makes the app feel composed rather than sprawling on a large monitor. This is the layout that most reduces the sense that you're operating machinery — worth serious consideration given how much of the product is “describe your goal and let it draft”.",
  principles: [
    ["Choice 01", "Height is cheaper than width", "58px of masthead beats 224px of rail on a laptop, and the nav is still a single click. The whole window width becomes usable."],
    ["Choice 02", "A centred column, not a full bleed", "1060px max. Text has a bounded measure, cards keep a sensible proportion, and the app looks the same on a 13-inch laptop and a 32-inch display."],
    ["Choice 03", "Same chrome everywhere", "The masthead stays put through the builder, so there is no context switch when you start making something — the step bar simply appears beneath it."],
  ],
  notes: {
    homeNote: "The centred column does most of the work here — nothing sprawls.",
    recsNote: "The masthead stays, the stepper sits under it. No chrome change at all.",
    logicNote: "The trade-off screen: the table is centred and capped, so a very wide window doesn't help it.",
    resultsNote: "Editor and preview inside the column — the tightest of the four, and the calmest.",
    editorNote: "The one place the column cap is lifted: the editor goes full width beneath the masthead.",
  },
  fixes: [
    "Recovers 224px of width on every screen while keeping navigation one click away.",
    "The column cap makes long help text physically incapable of sprawling across a wide monitor.",
    "No chrome change between managing and building, so there's no moment of “where did the nav go?”.",
  ],
  risks: [
    "Only six or seven destinations fit comfortably across the top; the rest go under “More”, which buries them.",
    "The centred cap actively wastes space on a wide monitor for the two screens that could genuinely use it — logic and the editor.",
    "Horizontal nav has no natural room to grow. If the product adds sections, this layout is the first to break.",
  ],
});

/* ── 3 — CANVAS ───────────────────────────────────────────────────── */
export const canvas = variant({
  id: "quartz-3-canvas", idx: 3, name: "Canvas", layout: "canvas", face: "onest",
  title: "Canvas",
  thesis:
    "A 60px icon rail and one continuous white sheet. Sections are divided by rules rather than boxed into cards, so a busy screen carries roughly half the edges it does today.",
  facts: ["Onest by default", "Icon rail · 60px", "One sheet, no cards", "Fewest edges", "Most content width"],
  ideaNote: "Every card border is a line your eye has to resolve. Most of them aren't earning it.",
  lede:
    "Card-based layouts draw a box around everything, which means a screen with six regions has twenty-four borders on it. <strong>Canvas draws one.</strong> Content sits on a single white sheet floating on a soft grey stage, and regions are separated by full-bleed rules — the same structural job, a fraction of the visual noise. The nav collapses to a 60px icon rail, so this layout also gives the work the most horizontal room of the four.",
  principles: [
    ["Choice 01", "One sheet, ruled sections", "No card borders inside the sheet. A horizontal rule opens a section; a vertical rule splits a row. Structure stays, edges go."],
    ["Choice 02", "Icons only", "Six to eight destinations you visit constantly don't need labels after week one. 60px instead of 224px, and the difference goes to the table."],
    ["Choice 03", "The stage frames the work", "A soft grey ground around the sheet makes the content area read as a document — which is what a quiz actually is."],
  ],
  notes: {
    homeNote: "Same content, roughly 20 fewer visible borders.",
    recsNote: "Picker and summary are split by one vertical rule instead of two card outlines.",
    logicNote: "This is where it pays off — the densest screen with the fewest lines competing with the data.",
    resultsNote: "Editor and preview share the sheet, split by a single rule.",
    editorNote: "The editor breaks out of the sheet and fills the frame — it has its own regions already.",
  },
  fixes: [
    "Cuts roughly half the visible borders on a busy screen without losing any grouping.",
    "The icon rail gives the logic table about 165px more width than the labelled rail.",
    "Makes the product feel like a document you're editing rather than a dashboard you're monitoring.",
  ],
  risks: [
    "Icon-only nav has a real learning cost, and “Brand identity” versus “Design” is not obvious from a glyph.",
    "Without card edges, grouping depends entirely on spacing and rules being exactly right — there is less margin for error.",
    "Anything that needs to visually detach from the page (an empty state, a promo, an error) has nowhere to go.",
  ],
});

/* ── 4 — PANES ────────────────────────────────────────────────────── */
export const panes = variant({
  id: "quartz-4-panes", idx: 4, name: "Panes", layout: "panes", face: "manrope",
  title: "Panes",
  thesis:
    "Rail, then a context pane, then the work. Your quizzes are always listed; the builder's steps become a vertical stepper you can jump around in rather than a bar you march along.",
  facts: ["Manrope by default", "Three columns", "Vertical stepper", "Least jumping around", "Densest chrome"],
  ideaNote: "The step you want is rarely the next one.",
  lede:
    "The horizontal stepper in the other three implies a march: 1, then 2, then 3. In practice merchants bounce — tweak a question, check the logic, fix the results copy, go back. <strong>Panes replaces the bar with a vertical list</strong> that shows every step, its state and a line of what's in it, so jumping is a click instead of a back-and-forth. On the workspace side, the same column lists your quizzes, so switching between them never needs a page load.",
  principles: [
    ["Choice 01", "A second column that always knows where you are", "Workspace: your quizzes and saved views. Builder: the steps. It's the same slot doing the same job — showing you the set you're working within."],
    ["Choice 02", "Vertical steps carry detail", "“31 products in the pool”, “6 questions drafted”, “4 rules · 1 decider”. A horizontal bar has room for a label; a vertical list has room for the truth."],
    ["Choice 03", "Continue lives at the bottom of the pane", "The forward action sits with the steps rather than floating in a top bar — so “where am I” and “what's next” are answered in the same place."],
  ],
  notes: {
    homeNote: "The quiz list is permanent, so switching quizzes never costs a page.",
    recsNote: "Vertical steps with real detail under each, and Continue at the foot of the pane.",
    logicNote: "The tightest of the four — two columns of chrome before the table starts. Judge it here.",
    resultsNote: "Six sub-steps would sit in the pane too, which is where this layout earns its keep.",
    editorNote: "The editor already has its own panes, so the workspace rail stays and the context pane steps aside.",
  },
  fixes: [
    "Replaces a linear stepper with something you can actually navigate, which matches how the builder is really used.",
    "Step hints turn the stepper from a progress indicator into a summary of the quiz.",
    "Switching between quizzes stops being a round trip through a list page.",
  ],
  risks: [
    "Two columns of chrome is roughly 480px before the work starts. On a 13-inch laptop the logic table gets uncomfortably tight.",
    "It is the most app-like of the four and the least approachable on a first visit — good for operators, heavier for newcomers.",
    "The context pane needs a genuinely useful job on every screen, or it becomes 258px of decoration.",
    "In the editor it puts two rails side by side — the workspace nav and the editor's own sections. Look hard at that in section 10; it may need the workspace rail to collapse to icons there.",
  ],
  extraCss: `
/* Panes: the vertical stepper is the signature, so give it room to breathe. */
.vstep { align-items: flex-start; }
.vstep .step-num { margin-top: 1px; }
`,
});
