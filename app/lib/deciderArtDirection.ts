import type { Quiz } from "./quizSchema";

type CatalogVisual = {
  title: string;
  description?: string | null;
  tags?: string | string[] | null;
  productType?: string | null;
};

const ALPINE_HERO = "/art-directions/alpine-afterglow/hero.webp";
const ALPINE_CARVE = "/art-directions/alpine-afterglow/carve.webp";

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

/** Give a generated decider quiz one coherent, vetted campaign world. */
export function applyGeneratedArtDirection(doc: Quiz, products: CatalogVisual[]): Quiz {
  if (doc.logic_model !== "decider") return doc;

  const language = catalogLanguage(products);
  const isAlpine = /snowboard|snow board|skiing|\bski\b|powder|mountain|winter sport/.test(
    language,
  );
  if (!isAlpine) return doc;

  const intro = doc.nodes.find((node) => node.type === "intro");
  const questions = doc.nodes.filter((node) => node.type === "question");
  const messages = doc.nodes.filter((node) => node.type === "message");
  const results = doc.nodes.filter((node) => node.type === "result" || node.type === "end");
  const nodeBackgrounds: NonNullable<Quiz["node_backgrounds"]> = {
    ...(doc.node_backgrounds ?? {}),
  };

  if (intro) {
    nodeBackgrounds[intro.id] = {
      type: "image",
      image_url: ALPINE_HERO,
      fit: "cover",
      focal_x: 68,
      focal_y: 50,
      // The generated frame already carries the dark exposure. Keeping this at
      // zero avoids a separate overlay layer dimming foreground UI in embedded
      // stacking contexts.
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
  for (const message of messages) {
    nodeBackgrounds[message.id] = { type: "color", color: "#17362A" };
  }
  for (const result of results) {
    nodeBackgrounds[result.id] = { type: "color", color: "#F1EEE5" };
  }

  const artDirectedNodes = doc.nodes.map((node) => {
    if (node.type === "intro") {
      return { ...node, data: { ...node.data, hero_image_url: undefined } };
    }
    if (node.type !== "question") return node;
    const cleanAnswers = node.data.answers.map((answer) => {
      const next = { ...answer };
      delete next.image_url;
      delete next.reveal_image;
      return next;
    });
    return {
      ...node,
      data: {
        ...node.data,
        image_url: undefined,
        answers: cleanAnswers,
        // Environmental imagery establishes context; answers remain clear,
        // typographic choices. Catalog thumbnails here read as accidental ads.
        answer_display: {
          mode: "cards" as const,
          show_media: false,
          content_align: "left" as const,
          shape: "square" as const,
          pad: 18,
          spacing: 10,
          label_position: "below" as const,
          label_bold: true,
          selected_style: "fill" as const,
          motion: "lift" as const,
        },
      },
    };
  });

  return {
    ...doc,
    nodes: artDirectedNodes,
    design_tokens: {
      ...doc.design_tokens,
      colors: {
        ...doc.design_tokens.colors,
        primary: "#D56A36",
        secondary: "#17362A",
        accent: "#D56A36",
        background: "#F1EEE5",
        text: "#14231C",
        muted: "#66716B",
        surface: "#E2E2DA",
      },
      typography: {
        heading: { family: "Barlow Condensed", source: "google", weight: 700 },
        body: {
          family: "Manrope",
          source: "google",
          weight: 500,
          base_size: 16,
          scale_ratio: 1.3,
        },
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
        concept:
          "A quiet expedition journal: dark mountain atmosphere, tactile snow, and a single ember accent.",
        composition: "immersive_intro_split_questions_editorial_result",
        hero_image_url: ALPINE_HERO,
        question_image_url: ALPINE_CARVE,
      },
    },
    node_backgrounds: nodeBackgrounds,
  };
}
