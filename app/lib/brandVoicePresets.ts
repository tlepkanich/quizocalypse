import type { BrandGuidelines } from "./brandGuidelines";

// Hand-curated brand voice presets. Each is a fully-formed BrandGuidelines
// object so the rest of the pipeline (system prompt injection, wizard
// pill, AskAI runtime) doesn't care whether the merchant uploaded a brand
// book or picked an archetype here.
//
// IP posture (intentional):
// - Labels are archetypes, not brand names. We're naming the *pattern*,
//   not claiming endorsement.
// - The inspiration field plainly cites the brands the pattern leans on
//   so merchants get the shorthand.
// - sample_phrases are hand-authored generic exemplars of the archetype.
//   They are NOT verbatim copy from any source brand.
// - No brand assets (logos, trademarked taglines) ship in this file.

export interface BrandVoicePreset {
  id: string;
  label: string;
  inspiration: string;
  guidelines: BrandGuidelines;
}

const STAMP = {
  uploaded_at: new Date(0).toISOString(),
  file_kind: "preset" as const,
  extraction_model: "hand-curated",
};

export const BRAND_VOICE_PRESETS: BrandVoicePreset[] = [
  {
    id: "minimalist-precision",
    label: "Minimalist precision",
    inspiration: "Inspired by Apple, Muji, Tesla",
    guidelines: {
      name: "Minimalist precision",
      voice: {
        tone_description:
          "Spare, exact, and confident. Every word earns its place. Lets the product speak by stating only what's true and necessary.",
        do_list: [
          "Use short, declarative sentences",
          "Lead with the product, not the marketing",
          "Strip adjectives until only the essential one remains",
          "Trust the reader to fill in tone",
          "Use sentence-case headlines",
        ],
        dont_list: [
          "No exclamation marks",
          "No hype words (amazing, revolutionary)",
          "No emoji",
          "No second-person hard sells",
          "No clutter — every word has to defend its existence",
        ],
        sample_phrases: [
          "Designed for daily use.",
          "Fewer parts. Less to think about.",
          "Made to last. Made to use.",
        ],
        forbidden_phrases: [],
      },
      visual_suggestions: {
        tokens: {
          colors: {
            primary: "#111111",
            secondary: "#555555",
            accent: "#0066FF",
            background: "#FFFFFF",
            text: "#111111",
            muted: "#777777",
          },
          typography: {
            heading: { family: "Inter", source: "google", weight: 600 },
            body: {
              family: "Inter",
              source: "google",
              base_size: 16,
              scale_ratio: 1.2,
            },
          },
          radius: "rounded",
          button_style: "filled",
          spacing: "normal",
        },
        notes: [],
      },
      source: { ...STAMP, file_name: "minimalist-precision" },
    },
  },
  {
    id: "warm-and-knowing",
    label: "Warm & knowing",
    inspiration: "Inspired by Patagonia, Aesop, Allbirds",
    guidelines: {
      name: "Warm & knowing",
      voice: {
        tone_description:
          "Thoughtful, grown-up, and genuinely informed. Speaks like a friend who happens to be the expert. Acknowledges trade-offs honestly.",
        do_list: [
          "Use second person to draw the reader in",
          "Acknowledge nuance and trade-offs",
          "Lead with how it feels, follow with how it works",
          "Reference materials, makers, or origin when relevant",
          "Pace longer sentences with crisp ones",
        ],
        dont_list: [
          "No corporate speak",
          "No false urgency",
          "No talking down to the reader",
          "No over-promising",
          "Don't lean on hype adjectives — let the details do the work",
        ],
        sample_phrases: [
          "Built to last, made to be worn in.",
          "Honest about what it is, honest about what it isn't.",
          "A small thing that adds up over years.",
        ],
        forbidden_phrases: [],
      },
      visual_suggestions: {
        tokens: {
          colors: {
            primary: "#3F2E1D",
            secondary: "#7E6B57",
            accent: "#C2410C",
            background: "#FAF5EF",
            text: "#1B1A17",
            muted: "#7E6B57",
          },
          typography: {
            heading: { family: "Fraunces", source: "google", weight: 500 },
            body: {
              family: "Lora",
              source: "google",
              base_size: 17,
              scale_ratio: 1.25,
            },
          },
          radius: "rounded",
          button_style: "outline",
          spacing: "spacious",
        },
        notes: [],
      },
      source: { ...STAMP, file_name: "warm-and-knowing" },
    },
  },
  {
    id: "confident-and-cheeky",
    label: "Confident & cheeky",
    inspiration: "Inspired by Wendy's, Innocent, Liquid Death",
    guidelines: {
      name: "Confident & cheeky",
      voice: {
        tone_description:
          "Self-aware, playfully blunt, and unwilling to take itself too seriously. Pokes fun at category clichés while still selling. Lean into voice — never bland.",
        do_list: [
          "Be playfully blunt",
          "Use punchy two-beat sentences",
          "Wink at category clichés",
          "Earn the joke before going for it",
          "Mix high and low register",
        ],
        dont_list: [
          "Don't punch down",
          "No tired memes",
          "No corporate hedging",
          "Don't be cute about safety or quality claims",
          "Avoid jokes that age badly",
        ],
        sample_phrases: [
          "Yeah, it's that good.",
          "We tried. It worked. Sue us.",
          "Same stuff, fewer lies.",
        ],
        forbidden_phrases: [],
      },
      visual_suggestions: {
        tokens: {
          colors: {
            primary: "#FF3D00",
            secondary: "#1A1A1A",
            accent: "#FFD600",
            background: "#FFFFFF",
            text: "#0A0A0A",
            muted: "#525252",
          },
          typography: {
            heading: { family: "Space Grotesk", source: "google", weight: 700 },
            body: {
              family: "Space Grotesk",
              source: "google",
              base_size: 16,
              scale_ratio: 1.25,
            },
          },
          radius: "pill",
          button_style: "filled",
          spacing: "compact",
        },
        notes: [],
      },
      source: { ...STAMP, file_name: "confident-and-cheeky" },
    },
  },
  {
    id: "editorial-and-considered",
    label: "Editorial & considered",
    inspiration: "Inspired by The New Yorker, Casper journals, Glossier essays",
    guidelines: {
      name: "Editorial & considered",
      voice: {
        tone_description:
          "Magazine-cadenced and literate. Treats the reader as curious and capable. Sentences breathe; ideas connect. Sparing on punctuation, generous on rhythm.",
        do_list: [
          "Write paragraphs, not bullet bursts",
          "Use semicolons and em-dashes thoughtfully",
          "Let one idea flow into the next",
          "Reference cultural shorthand when it earns the space",
          "Title-case major headlines; sentence-case the rest",
        ],
        dont_list: [
          "No marketing-speak adjectives",
          "No clickbait phrasing",
          "Avoid all-caps emphasis",
          "Don't fragment for drama",
          "Skip the buzzwords",
        ],
        sample_phrases: [
          "A small ritual, daily.",
          "It's the kind of thing you don't notice until you would.",
          "Made the way it used to be — for the same reason it still works.",
        ],
        forbidden_phrases: [],
      },
      visual_suggestions: {
        tokens: {
          colors: {
            primary: "#1B1A17",
            secondary: "#7E6B57",
            accent: "#C2410C",
            background: "#FAF5EF",
            text: "#1B1A17",
            muted: "#7E6B57",
          },
          typography: {
            heading: { family: "Playfair Display", source: "google", weight: 600 },
            body: {
              family: "Lora",
              source: "google",
              base_size: 17,
              scale_ratio: 1.333,
            },
          },
          radius: "square",
          button_style: "outline",
          spacing: "spacious",
        },
        notes: [],
      },
      source: { ...STAMP, file_name: "editorial-and-considered" },
    },
  },
  {
    id: "premium-and-restrained",
    label: "Premium & restrained",
    inspiration: "Inspired by Hermès, Loro Piana, RH",
    guidelines: {
      name: "Premium & restrained",
      voice: {
        tone_description:
          "Quiet luxury. Whispers rather than shouts. Confident enough to leave silence. The product's craft and provenance carry the weight.",
        do_list: [
          "Lead with material, craft, or origin",
          "Use formal but unstuffy register",
          "Let white space do work",
          "Reference the maker when meaningful",
          "Choose precise verbs over big adjectives",
        ],
        dont_list: [
          "No sale language",
          "No urgency tactics",
          "No exclamation marks",
          "No emoji",
          "Avoid 'experience' and 'journey' clichés",
        ],
        sample_phrases: [
          "Cut by hand in the Marche.",
          "A single linen, a single season.",
          "Quietly made. Quietly worn.",
        ],
        forbidden_phrases: [],
      },
      visual_suggestions: {
        tokens: {
          colors: {
            primary: "#1F2228",
            secondary: "#5C5347",
            accent: "#A88B5A",
            background: "#F4EFE8",
            text: "#1F2228",
            muted: "#85786A",
          },
          typography: {
            heading: { family: "Cormorant Garamond", source: "google", weight: 500 },
            body: {
              family: "Inter",
              source: "google",
              base_size: 16,
              scale_ratio: 1.25,
            },
          },
          radius: "square",
          button_style: "ghost",
          spacing: "spacious",
        },
        notes: [],
      },
      source: { ...STAMP, file_name: "premium-and-restrained" },
    },
  },
  {
    id: "energetic-and-playful",
    label: "Energetic & playful",
    inspiration: "Inspired by Mailchimp, Duolingo, Notion",
    guidelines: {
      name: "Energetic & playful",
      voice: {
        tone_description:
          "Warm and a little goofy without being childish. Optimistic, helpful, and quick on its feet. The product is your enthusiastic teammate.",
        do_list: [
          "Use friendly second person",
          "Sprinkle in a little play — never force it",
          "Be encouraging without being saccharine",
          "Use crisp action verbs",
          "Acknowledge effort warmly",
        ],
        dont_list: [
          "Don't write like a kids' show",
          "Avoid overusing emoji",
          "Don't fake enthusiasm",
          "No condescension dressed as cheer",
          "Don't undermine seriousness when it matters",
        ],
        sample_phrases: [
          "Nice — that's the trickiest one out of the way.",
          "You've got this. (And we've got the rest.)",
          "Quick check before we go — sound good?",
        ],
        forbidden_phrases: [],
      },
      visual_suggestions: {
        tokens: {
          colors: {
            primary: "#E879A4",
            secondary: "#A78BFA",
            accent: "#FBBF24",
            background: "#FFF6F8",
            text: "#3F2A38",
            muted: "#8B6B7C",
          },
          typography: {
            heading: { family: "Fraunces", source: "google", weight: 500 },
            body: {
              family: "Inter",
              source: "google",
              base_size: 16,
              scale_ratio: 1.2,
            },
          },
          radius: "rounded",
          button_style: "filled",
          spacing: "normal",
        },
        notes: [],
      },
      source: { ...STAMP, file_name: "energetic-and-playful" },
    },
  },
  {
    id: "authoritative-and-trustworthy",
    label: "Authoritative & trustworthy",
    inspiration: "Inspired by REI, Allbirds, Vermont Country Store",
    guidelines: {
      name: "Authoritative & trustworthy",
      voice: {
        tone_description:
          "Plain-spoken expertise. Treats the reader as an equal making a real decision. Names trade-offs honestly because trust is the only sale that matters.",
        do_list: [
          "State plainly what the product is for",
          "Name the trade-off, then explain the choice",
          "Use specific numbers when possible",
          "Reference how it's tested or made",
          "Use sentence-case headlines",
        ],
        dont_list: [
          "No hype adjectives",
          "No vague superlatives",
          "Don't hide the trade-off",
          "No false scarcity",
          "Don't sell what it isn't",
        ],
        sample_phrases: [
          "It's heavier than the ultralight option — and that's the point.",
          "Made of two materials, both repairable.",
          "Recommended for cool, dry conditions. Not the right tool for everything.",
        ],
        forbidden_phrases: [],
      },
      visual_suggestions: {
        tokens: {
          colors: {
            primary: "#2F4F33",
            secondary: "#5C6F4A",
            accent: "#B5651D",
            background: "#F5F1E8",
            text: "#1A2419",
            muted: "#6E7868",
          },
          typography: {
            heading: { family: "Inter", source: "google", weight: 600 },
            body: {
              family: "Inter",
              source: "google",
              base_size: 16,
              scale_ratio: 1.2,
            },
          },
          radius: "rounded",
          button_style: "filled",
          spacing: "normal",
        },
        notes: [],
      },
      source: { ...STAMP, file_name: "authoritative-and-trustworthy" },
    },
  },
  {
    id: "bold-and-disruptive",
    label: "Bold & disruptive",
    inspiration: "Inspired by Liquid Death, Oatly, Away",
    guidelines: {
      name: "Bold & disruptive",
      voice: {
        tone_description:
          "Loud-mouthed and unbothered. Calls out the category's nonsense. Voice does the heavy lifting; the product is the reason the joke lands.",
        do_list: [
          "Take a stand",
          "Use one short sentence per beat",
          "Mix declarative and provocative",
          "Earn the swagger with the product detail",
          "Let one strong line carry the page",
        ],
        dont_list: [
          "No corporate hedging",
          "Don't punch down",
          "No empty controversy",
          "Avoid jokes that age badly",
          "Don't out-talk the product",
        ],
        sample_phrases: [
          "The category needed this. You're welcome.",
          "Everyone else made it weird. We just made it work.",
          "Not for everyone. That's kind of the point.",
        ],
        forbidden_phrases: [],
      },
      visual_suggestions: {
        tokens: {
          colors: {
            primary: "#FFD600",
            secondary: "#0A0A0A",
            accent: "#FF3D00",
            background: "#0A0A0A",
            text: "#FFFFFF",
            muted: "#B0B0B0",
          },
          typography: {
            heading: { family: "Space Grotesk", source: "google", weight: 700 },
            body: {
              family: "Space Grotesk",
              source: "google",
              base_size: 16,
              scale_ratio: 1.3,
            },
          },
          radius: "pill",
          button_style: "filled",
          spacing: "compact",
        },
        notes: [],
      },
      source: { ...STAMP, file_name: "bold-and-disruptive" },
    },
  },
];

export function getPreset(id: string): BrandVoicePreset | undefined {
  return BRAND_VOICE_PRESETS.find((p) => p.id === id);
}
