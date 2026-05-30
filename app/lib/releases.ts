// Hardcoded release history surfaced on the dashboard "What's new" card and
// the /app/releases page. Newest first. When you ship a new feature, add an
// entry at the top — the dashboard's LATEST_RELEASES helper picks it up
// automatically.
//
// Keep feature titles short (chip-sized, ~24 chars) and descriptions to
// 1–2 plain sentences so they fit inside a ~280px tooltip.

export interface ReleaseFeature {
  title: string;
  description: string;
}

export interface Release {
  version: string;
  name: string;
  date: string; // ISO yyyy-mm-dd
  summary: string;
  features: ReleaseFeature[];
}

export const RELEASES: Release[] = [
  {
    version: "v2.7",
    name: "Customize on creation",
    date: "2026-05-30",
    summary:
      "The New Quiz wizard now surfaces the v2 features in a one-click Customize panel.",
    features: [
      {
        title: "Theme presets at creation",
        description:
          "Pick Minimal, Editorial, Bold, Pastel, or Dark right from the New Quiz form — design tokens are applied to the draft on the way out.",
      },
      {
        title: "Tone steering",
        description:
          "Friendly, Editorial, Playful, or Professional — the AI's system prompt picks up your choice so the generated copy matches your voice.",
      },
      {
        title: "Flow extras",
        description:
          "Tick boxes for welcome message, email gate, mid-flow product preview, AI follow-up chat, end screen, or a mix of input types. The AI honors them when generating.",
      },
      {
        title: "Launcher + webhook stub",
        description:
          "Pre-enable the floating launcher with icon + corner, or pre-add an outbound webhook integration node — no canvas hopping required.",
      },
    ],
  },
  {
    version: "v2.6",
    name: "Backlog cleared",
    date: "2026-05-30",
    summary:
      "Final v2 spec items shipped: Klaviyo, two new question types, embed launcher, mobile admin.",
    features: [
      {
        title: "Klaviyo integration kind",
        description:
          "Push completed quiz responses to a Klaviyo list as profile properties. Discriminated union with the existing webhook kind so both can live on the same integration node.",
      },
      {
        title: "Question.Searchable",
        description:
          "Substring-filtered single-select with an autofocused search input — perfect for brand or country pickers with long answer lists.",
      },
      {
        title: "Question.ImagePicker",
        description:
          "Dense responsive thumbnail grid where the image dominates and the caption sits underneath. Distinct from image_tile's tall single-column cards.",
      },
      {
        title: "Floating launcher",
        description:
          "Embed a sparkle / star / chat button anywhere on your storefront — clicking opens the quiz in a modal iframe. Configurable corner, color, optional pill label.",
      },
      {
        title: "Mobile admin",
        description:
          "Sidebar collapses to a horizontal scroll strip under 900px and two-column page grids drop to one column. App Store ready.",
      },
    ],
  },
  {
    version: "v2.5",
    name: "Integrations + product showcases",
    date: "2026-05-29",
    summary:
      "Wire quiz completions into your stack and showcase hand-picked products mid-flow.",
    features: [
      {
        title: "Integration node",
        description:
          "Invisible auto-advancing node that fires outbound webhooks server-side when the shopper reaches it. 5-second timeout per action, continue_on_error gate.",
      },
      {
        title: "ProductCards node",
        description:
          "Showcase 1–6 merchant-picked products as themed cards anywhere in the flow. Distinct from result recommendations or the mid-quiz preview rail.",
      },
      {
        title: "Webhook signature header",
        description:
          "Outbound webhooks carry an optional X-Quizocalypse-Secret header so your receiver can verify the request came from this app.",
      },
    ],
  },
  {
    version: "v2.4",
    name: "Theme presets + freeform questions",
    date: "2026-05-29",
    summary:
      "Five curated theme packs and two new freeform question types.",
    features: [
      {
        title: "Theme presets library",
        description:
          "Minimal, Editorial, Bold, Pastel, and Dark — one-click apply from the brand design page. Each preset's text-on-background passes WCAG AA contrast.",
      },
      {
        title: "Question.Text",
        description:
          "Freeform text input for capturing names, preferences, or any short string. The typed value lands in the path with merge-tag support.",
      },
      {
        title: "Question.Email",
        description:
          "Text input with HTML5 email validation client-side — capture email mid-flow without a separate email_gate.",
      },
    ],
  },
  {
    version: "v2.3",
    name: "Conversational AskAI",
    date: "2026-05-28",
    summary:
      "Multi-turn AI chat grounded in the quiz path + product catalog.",
    features: [
      {
        title: "AskAI node",
        description:
          "Drop a chat step anywhere with persona, opening message, suggested questions, and a max-turn cap. Backend calls Claude with quiz path + catalog as system context.",
      },
      {
        title: "Safety rails",
        description:
          "Built-in instructions keep replies short, on-topic, and never invent SKUs. Merchant instructions stay verbatim unless they conflict with safety.",
      },
      {
        title: "Suggested question chips",
        description:
          "Seed the chat with quick-reply prompts that match your quiz topic — shown before the first user turn.",
      },
    ],
  },
  {
    version: "v2.2",
    name: "Branching + A/B + rules",
    date: "2026-05-28",
    summary:
      "Conditional routing and weighted A/B variants with sticky-per-session assignment.",
    features: [
      {
        title: "Branch node",
        description:
          "Invisible decision gate that auto-advances. Configure rules mode (first matching slot wins) or A/B split (weighted random).",
      },
      {
        title: "Per-edge rules",
        description:
          "Edges now support condition.answer_id, condition.tag, and condition.ab_slot. Legacy {answer_id} shape keeps working.",
      },
      {
        title: "Sticky A/B sessions",
        description:
          "Once a shopper is assigned a variant, sessionStorage keeps them on it across refreshes for honest attribution.",
      },
    ],
  },
  {
    version: "v2.1",
    name: "Builder rewrite",
    date: "2026-05-27",
    summary:
      "Three-tab drawer, breakpoint overrides, click-to-add module picker.",
    features: [
      {
        title: "3-tab drawer",
        description:
          "Preview / Content / Design replaces the old 5-tab layout. Preview renders the actual storefront step at the current breakpoint width.",
      },
      {
        title: "Breakpoint overrides",
        description:
          "Switch between Synced / Desktop / Mobile in the drawer to author per-breakpoint design tokens. Drifted nodes carry a ◐ badge.",
      },
      {
        title: "Module picker",
        description:
          "Every source handle on a node gets a + button that opens a pick-a-module popover. Drag-to-connect still works for power users.",
      },
      {
        title: "Welcome / Message / End",
        description:
          "Three new node types: a welcome-labeled intro, mid-flow chat messages with merge tags, and a terminal end screen with optional CTA.",
      },
    ],
  },
  {
    version: "v1.5",
    name: "Mid-quiz product previews",
    date: "2026-05-26",
    summary:
      "A refining product rail appears once the shopper answers a flagged question.",
    features: [
      {
        title: "show_preview_after toggle",
        description:
          "Flip the toggle on any question — the storefront opens a sticky product rail once that question is answered, refining with each subsequent pick.",
      },
      {
        title: "Featured collection fallback",
        description:
          "Cold-start when accumulated tags score zero against the catalog — falls back to the configured featured collection (best sellers, etc.).",
      },
    ],
  },
  {
    version: "v1.4",
    name: "Sidebar + top-level routes",
    date: "2026-05-26",
    summary:
      "Persistent in-iframe nav with Workspace / Design / Shop sections.",
    features: [
      {
        title: "Persistent sidebar",
        description:
          "Klaviyo-style left nav with Dashboard, Quizzes, New quiz, Brand, Analytics, Settings, Captures — counts come from the loader.",
      },
      {
        title: "Captures page",
        description:
          "All email captures across all quizzes with CSV export.",
      },
    ],
  },
  {
    version: "v1.3",
    name: "Grid Notebook redesign",
    date: "2026-05-25",
    summary:
      "Dashboard and quiz list ported to the editorial Grid Notebook look.",
    features: [
      {
        title: "Editorial typography",
        description:
          "Spectral display + Geist body + JetBrains Mono monospace. Cream paper backgrounds, persimmon accent.",
      },
      {
        title: "Qz design system",
        description:
          "Custom Qz primitives replace Polaris on every admin screen for a consistent brand feel.",
      },
    ],
  },
  {
    version: "v1.2",
    name: "Polish + version history",
    date: "2026-05-24",
    summary:
      "App Bridge nav, published version history, per-node design overrides.",
    features: [
      {
        title: "Version history",
        description:
          "Each publish snapshots the quiz JSON. Rollback to any previous version with one click. Last 10 versions retained.",
      },
      {
        title: "Per-node design overrides",
        description:
          "Override design tokens for one specific node — useful for tone-distinct screens like the email gate or result.",
      },
      {
        title: "Apply-to-all",
        description:
          "Bulk-apply a tokens set to every question or every result node in one go.",
      },
    ],
  },
  {
    version: "v1.1",
    name: "Theme App Extension + analytics",
    date: "2026-05-23",
    summary:
      "Embed the quiz inline on any storefront page; full funnel analytics; email capture.",
    features: [
      {
        title: "App Block",
        description:
          "Theme App Extension block — merchants drop the quiz inline on any storefront page via the theme editor.",
      },
      {
        title: "Per-quiz analytics",
        description:
          "Funnel chart from quiz_started → result_viewed → recommendation_clicked. Sliced by session.",
      },
      {
        title: "Email gate",
        description:
          "Capture email mid-flow with optional name field. Captures land in the shop's Captures page.",
      },
    ],
  },
  {
    version: "v1.0",
    name: "MVP launch",
    date: "2026-05-22",
    summary:
      "Catalog sync, AI quiz generator, visual flow builder, scored recommendations, hosted runtime.",
    features: [
      {
        title: "Catalog sync via Shopify bulk ops",
        description:
          "Pull every product, variant, image, and tag with one GraphQL bulk operation. Triggered from the dashboard.",
      },
      {
        title: "AI quiz generator",
        description:
          "Type a goal prompt, pick a collection scope — Claude drafts questions, answers, and tag mappings against your real catalog.",
      },
      {
        title: "Visual flow builder",
        description:
          "React Flow canvas with drag-and-drop nodes, drawer-based editing, auto-layout, and validation badges.",
      },
      {
        title: "Recommendation engine",
        description:
          "Tag-overlap scoring with in-stock + price ascending tie-breaks. Fallback ladder lands shoppers on the configured collection when nothing matches.",
      },
      {
        title: "Hosted storefront runtime",
        description:
          "Public /q/:id route renders the published quiz at full brand fidelity — no Polaris, no auth, just shoppers.",
      },
    ],
  },
];

// Compact dashboard card shows the most recent N releases. Anything beyond
// surfaces on /app/releases.
export const LATEST_RELEASES = RELEASES.slice(0, 4);
