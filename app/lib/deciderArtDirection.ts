import type { BrandIdentity } from "./brandIdentity";
import { contrastRatio, findContrastIssues, type DesignTokensT } from "./designTokens";
import { getPreset } from "./themePresets";
import type { ExperienceType, QuestionType, Quiz } from "./quizSchema";
import { experienceTypeOf } from "./quizSchema";

type CatalogVisual = {
  title: string;
  description?: string | null;
  tags?: string | string[] | null;
  productType?: string | null;
};

export interface ArtDirectionContext {
  /** Stable database id. Never use time or Math.random for visual selection. */
  quizId: string;
  brandIdentity?: BrandIdentity | null;
}

type Palette = {
  id: string;
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  text: string;
  muted: string;
  surface: string;
};

type TypePair = {
  heading: string;
  body: string;
  headingWeight: number;
  scale: number;
};

type Composition = NonNullable<
  NonNullable<Quiz["design_tokens"]["art_direction"]>["composition"]
>;
type BackgroundTreatment = NonNullable<
  NonNullable<Quiz["design_tokens"]["art_direction"]>["background_treatment"]
>;

const ALPINE_HERO = "/art-directions/alpine-afterglow/hero.webp";
const ALPINE_CARVE = "/art-directions/alpine-afterglow/carve.webp";
const ALPINE_ACCENTS = ["#AD4B2E", "#335E8A", "#53652F"] as const;

// Every pack is deliberately tinted rather than reflex-cream. The four
// findContrastIssues axes are asserted for every pack in the unit suite.
const PALETTES: readonly Palette[] = [
  {
    id: "lake",
    primary: "#146C68",
    secondary: "#6C7D75",
    accent: "#B24B27",
    background: "#F4F7F3",
    text: "#19302B",
    muted: "#596762",
    surface: "#E3EBE6",
  },
  {
    id: "cobalt",
    primary: "#2457A6",
    secondary: "#68758A",
    accent: "#B7481B",
    background: "#F7F8F3",
    text: "#17243A",
    muted: "#596474",
    surface: "#E5EAF0",
  },
  {
    id: "plum",
    primary: "#7D355C",
    secondary: "#88717F",
    accent: "#A64B19",
    background: "#FBF6F9",
    text: "#302029",
    muted: "#6B5D66",
    surface: "#EEE5EB",
  },
  {
    id: "forest",
    primary: "#255A3C",
    secondary: "#75816F",
    accent: "#A95317",
    background: "#F6F4EC",
    text: "#1C3025",
    muted: "#5D675F",
    surface: "#E5E9DE",
  },
  {
    id: "ocean",
    primary: "#096A82",
    secondary: "#667D83",
    accent: "#9C4B1B",
    background: "#F4F8F8",
    text: "#183239",
    muted: "#5A6668",
    surface: "#E2ECEC",
  },
  {
    id: "grape",
    primary: "#65528F",
    secondary: "#7C748A",
    accent: "#A54723",
    background: "#F7F5FA",
    text: "#282337",
    muted: "#655F6E",
    surface: "#E9E5F0",
  },
  {
    id: "brick",
    primary: "#A43B32",
    secondary: "#7E716C",
    accent: "#2C698D",
    background: "#FAF5F1",
    text: "#35221F",
    muted: "#6C5E59",
    surface: "#EEE5DF",
  },
  {
    id: "night",
    primary: "#8E3E2C",
    secondary: "#809087",
    accent: "#E5A44F",
    background: "#17211E",
    text: "#F1F4F0",
    muted: "#AAB4AE",
    surface: "#24302C",
  },
] as const;

const TYPE_PAIRS: readonly TypePair[] = [
  { heading: "Outfit", body: "Manrope", headingWeight: 650, scale: 1.28 },
  {
    heading: "Bricolage Grotesque",
    body: "Schibsted Grotesk",
    headingWeight: 700,
    scale: 1.26,
  },
  { heading: "Sora", body: "Figtree", headingWeight: 650, scale: 1.24 },
  { heading: "Syne", body: "Manrope", headingWeight: 650, scale: 1.3 },
  { heading: "Archivo", body: "Work Sans", headingWeight: 650, scale: 1.24 },
  { heading: "Newsreader", body: "Source Sans 3", headingWeight: 600, scale: 1.32 },
] as const;

const COMPOSITIONS: Record<ExperienceType, readonly Composition[]> = {
  product_match: ["product_led_editorial", "field_guide", "poster_grid"],
  personality: ["poster_grid", "field_guide", "product_led_editorial"],
  lead_capture: ["quiet_form", "field_guide", "poster_grid"],
  survey: ["field_guide", "quiet_form", "poster_grid"],
};

const TREATMENTS: readonly BackgroundTreatment[] = [
  "solid",
  "ruled",
  "corner_block",
  "bands",
] as const;

const CARD_MEDIA_TYPES = new Set<QuestionType>(["image_tile", "image_picker", "swatch"]);

function stableHash(value: string): number {
  // FNV-1a: compact, deterministic across Node/browser versions, and adequate
  // for recipe selection. `>>> 0` keeps every downstream modulo positive.
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function pick<T>(values: readonly T[], hash: number, shift: number): T {
  return values[Math.abs((hash >>> shift) % values.length)]!;
}

function catalogLanguage(products: CatalogVisual[]): string {
  return products
    .flatMap((product) => [
      product.title,
      product.description ?? "",
      Array.isArray(product.tags) ? product.tags.join(" ") : (product.tags ?? ""),
      product.productType ?? "",
    ])
    .join(" ")
    .toLowerCase();
}

function hasRealBrandColorSignal(identity: BrandIdentity | null | undefined): boolean {
  if (!identity?.design.derived_tokens?.colors) return false;
  const hasColorProvenance = identity.sources.some(
    (source) => source.kind === "shop_brand" || source.kind === "theme",
  );
  if (!hasColorProvenance) return false;

  const presetColors = getPreset(identity.design.suggested_theme_preset_id)?.tokens.colors;
  const derived = identity.design.derived_tokens.colors;
  // The identity assembler always writes a complete preset copy. It only
  // becomes brand signal when primary/secondary differs from that preset.
  return (
    (Boolean(derived.primary) && derived.primary !== presetColors?.primary) ||
    (Boolean(derived.secondary) && derived.secondary !== presetColors?.secondary)
  );
}

function darkenForWhiteLabel(hex: string): string | null {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return null;
  if (contrastRatio("#FFFFFF", hex) >= 4.5) return hex.toUpperCase();
  const n = Number.parseInt(hex.slice(1), 16);
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  for (let factor = 0.9; factor >= 0.25; factor -= 0.05) {
    const next = rgb.map((channel) => Math.round(channel * factor));
    const candidate = `#${next.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
    if (contrastRatio("#FFFFFF", candidate) >= 4.5) return candidate;
  }
  return null;
}

function paletteWithRealBrandSignal(
  palette: Palette,
  identity: BrandIdentity | null | undefined,
): Palette {
  if (!hasRealBrandColorSignal(identity)) return palette;
  const brandColors = identity?.design.derived_tokens?.colors;
  const primary = brandColors?.primary ? darkenForWhiteLabel(brandColors.primary) : null;
  if (!primary) return palette;
  return {
    ...palette,
    primary,
    secondary:
      brandColors?.secondary && /^#[0-9a-f]{6}$/i.test(brandColors.secondary)
        ? brandColors.secondary.toUpperCase()
        : palette.secondary,
  };
}

function answerDisplayFor(questionType: QuestionType, treatment: BackgroundTreatment) {
  const showMedia = CARD_MEDIA_TYPES.has(questionType);
  return {
    mode: showMedia ? ("tiles" as const) : treatment === "bands" ? ("pills" as const) : ("cards" as const),
    show_media: showMedia,
    content_align: showMedia ? ("center" as const) : ("left" as const),
    shape: treatment === "solid" ? ("rounded" as const) : ("square" as const),
    pad: showMedia ? 10 : 17,
    spacing: treatment === "ruled" ? 6 : 10,
    label_position: "below" as const,
    label_bold: true,
    selected_style: "fill" as const,
    motion: "none" as const,
    ...(showMedia ? { columns: 2 as const, aspect: "4:3" as const, fit: "cover" as const } : {}),
  };
}

function backgroundForNode(
  node: Quiz["nodes"][number],
  palette: Palette,
  treatment: BackgroundTreatment,
  questionIndex: number,
): NonNullable<Quiz["node_backgrounds"]>[string] {
  if (node.type === "message") return { type: "color", color: palette.primary };
  if (node.type === "intro" && treatment === "bands") {
    return {
      type: "gradient",
      color: palette.background,
      color2: palette.surface,
      angle: 112,
    };
  }
  if (node.type === "intro" && treatment === "corner_block") {
    return { type: "color", color: palette.surface };
  }
  if (node.type === "question" && questionIndex % 2 === 1) {
    return { type: "color", color: palette.surface };
  }
  return { type: "color", color: palette.background };
}

function applyAlpineDirection(doc: Quiz, hash: number): Quiz {
  const accent = pick(ALPINE_ACCENTS, hash, 5);
  const seed = hash.toString(16).padStart(8, "0");
  const intro = doc.nodes.find((node) => node.type === "intro");
  const questions = doc.nodes.filter((node) => node.type === "question");
  const nodeBackgrounds: NonNullable<Quiz["node_backgrounds"]> = {
    ...(doc.node_backgrounds ?? {}),
  };

  if (intro) {
    nodeBackgrounds[intro.id] = {
      type: "image",
      image_url: ALPINE_HERO,
      fit: "cover",
      focal_x: 60 + (hash % 17),
      focal_y: 50,
      overlay: 0,
    };
  }
  for (const question of questions) {
    nodeBackgrounds[question.id] = {
      type: "partial",
      image_url: ALPINE_CARVE,
      fill_color: "#F1EEE5",
      band: "left",
      coverage: 46,
      overlay: 0,
    };
  }
  for (const node of doc.nodes) {
    if (node.type === "message") nodeBackgrounds[node.id] = { type: "color", color: "#17362A" };
    if (node.type === "result" || node.type === "end") {
      nodeBackgrounds[node.id] = { type: "color", color: "#F1EEE5" };
    }
  }

  const nodes = doc.nodes.map((node) => {
    if (node.type === "intro") return { ...node, data: { ...node.data, hero_image_url: undefined } };
    if (node.type !== "question") return node;
    return {
      ...node,
      data: {
        ...node.data,
        image_url: undefined,
        answers: node.data.answers.map((answer) => {
          const clean = { ...answer };
          delete clean.image_url;
          delete clean.reveal_image;
          return clean;
        }),
        answer_display: answerDisplayFor(node.data.question_type, "ruled"),
      },
    };
  });

  return {
    ...doc,
    nodes,
    design_tokens: {
      ...doc.design_tokens,
      colors: {
        ...doc.design_tokens.colors,
        primary: accent,
        secondary: "#17362A",
        accent,
        background: "#F1EEE5",
        text: "#14231C",
        muted: "#626C66",
        surface: "#E2E2DA",
      },
      typography: {
        heading: { family: "Barlow Condensed", source: "google", weight: 700 },
        body: { family: "Manrope", source: "google", weight: 500, base_size: 16, scale_ratio: 1.3 },
      },
      radius: "square",
      button_style: "filled",
      button_radius: 2,
      spacing: "spacious",
      shadow: "none",
      chrome: "minimal",
      answer_layout: "grid",
      answer_grid_columns: 2,
      progress_bar: { enabled: true, style: "bar", position: "top" },
      style_bar: { image_density: 88, lines: 8, spacing: 76 },
      art_direction: {
        id: "alpine-afterglow",
        name: "Alpine Afterglow",
        concept: "A quiet expedition journal: dark mountain atmosphere, tactile snow, and a single ember accent.",
        composition: "immersive_intro_split_questions_editorial_result",
        background_treatment: "solid",
        seed,
        motif_offset: 60 + (hash % 17),
        hero_image_url: ALPINE_HERO,
        question_image_url: ALPINE_CARVE,
      },
    },
    node_backgrounds: nodeBackgrounds,
  };
}

/**
 * Give every newly generated decider quiz a coherent, deterministic campaign
 * world. Legacy docs return by reference; the same quiz id always selects the
 * same recipe, while sibling ids rotate palette, typography, composition, and
 * background treatment independently.
 */
export function applyGeneratedArtDirection(
  doc: Quiz,
  products: CatalogVisual[],
  context?: ArtDirectionContext,
): Quiz {
  if (doc.logic_model !== "decider") return doc;

  const quizId = context?.quizId || doc.quiz_id;
  const hash = stableHash(quizId);
  const language = catalogLanguage(products);
  const isAlpine = /snowboard|snow board|skiing|\bski\b|powder|mountain|winter sport/.test(language);
  if (isAlpine) return applyAlpineDirection(doc, hash);

  const experience = experienceTypeOf(doc);
  const composition = pick(COMPOSITIONS[experience], hash, 0);
  const treatment = pick(TREATMENTS, hash, 7);
  const basePalette = pick(PALETTES, hash, 13);
  const palette = paletteWithRealBrandSignal(basePalette, context?.brandIdentity);
  const typePair = pick(TYPE_PAIRS, hash, 19);
  const seed = hash.toString(16).padStart(8, "0");
  const motifOffset = 12 + (hash % 77);
  const nodeBackgrounds: NonNullable<Quiz["node_backgrounds"]> = {
    ...(doc.node_backgrounds ?? {}),
  };
  let questionIndex = 0;
  for (const node of doc.nodes) {
    nodeBackgrounds[node.id] = backgroundForNode(node, palette, treatment, questionIndex);
    if (node.type === "question") questionIndex += 1;
  }

  const nodes = doc.nodes.map((node) => {
    if (node.type === "intro") {
      return { ...node, data: { ...node.data, hero_image_url: undefined } };
    }
    if (node.type !== "question") return node;
    const preserveMedia = CARD_MEDIA_TYPES.has(node.data.question_type);
    return {
      ...node,
      data: {
        ...node.data,
        ...(preserveMedia ? {} : { image_url: undefined }),
        answers: preserveMedia
          ? node.data.answers
          : node.data.answers.map((answer) => {
              const clean = { ...answer };
              delete clean.image_url;
              delete clean.reveal_image;
              return clean;
            }),
        answer_display: answerDisplayFor(node.data.question_type, treatment),
      },
    };
  });

  const colors: Palette = { ...palette };
  const tokens: DesignTokensT = {
    ...doc.design_tokens,
    colors,
    typography: {
      heading: { family: typePair.heading, source: "google", weight: typePair.headingWeight },
      body: {
        family: typePair.body,
        source: "google",
        weight: 500,
        base_size: 16,
        scale_ratio: typePair.scale,
      },
    },
    radius: treatment === "solid" ? "rounded" : "square",
    button_style: "filled",
    button_radius: treatment === "solid" ? 12 : 2,
    spacing: composition === "quiet_form" ? "normal" : "spacious",
    shadow: "none",
    chrome: "minimal",
    answer_layout: "grid",
    answer_grid_columns: 2,
    progress_bar: { enabled: true, style: treatment === "ruled" ? "steps" : "bar", position: "top" },
    style_bar: {
      image_density: experience === "product_match" ? 62 : 24,
      lines: treatment === "solid" ? 68 : 10,
      spacing: composition === "quiet_form" ? 60 : 78,
    },
    art_direction: {
      id: `${composition}-${basePalette.id}`,
      name:
        composition === "poster_grid"
          ? "Signal Poster"
          : composition === "quiet_form"
            ? "Quiet Invitation"
            : composition === "field_guide"
              ? "Field Notes"
              : "Object Study",
      concept:
        composition === "poster_grid"
          ? "A confident campaign poster softened by practical, tactile choices."
          : composition === "quiet_form"
            ? "A calm invitation with deliberate pacing and almost no visual noise."
            : composition === "field_guide"
              ? "An annotated field guide: useful, human, and quietly structured."
              : "A product-editorial study with offset type and generous negative space.",
      composition,
      background_treatment: treatment,
      seed,
      motif_offset: motifOffset,
    },
  };
  if (findContrastIssues(tokens).length > 0) {
    throw new Error(`Art direction ${seed} failed its contrast contract.`);
  }

  return { ...doc, nodes, design_tokens: tokens, node_backgrounds: nodeBackgrounds };
}
