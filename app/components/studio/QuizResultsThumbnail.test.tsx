import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { quizCardFacts } from "../../lib/quizLibraryCard";
import { QuizResultsThumbnail } from "./QuizResultsThumbnail";

const products = [
  { id: "1", title: "Alpine board", imageUrl: "/board.jpg" },
  { id: "2", title: "Riding gloves", imageUrl: null },
  { id: "3", title: "Snow goggles", imageUrl: "/goggles.jpg" },
];

describe("QuizResultsThumbnail", () => {
  it("renders real products with no invented rating, score, or interactive controls", () => {
    const { thumb } = quizCardFacts({ logic_model: "decider", nodes: [] });
    const html = renderToStaticMarkup(<QuizResultsThumbnail thumb={thumb} products={products} />);
    expect(html).toContain("Alpine board");
    expect(html).toContain('src="/board.jpg"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain("Results preview");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("Question preview");
    expect(html).not.toContain("% match");
  });

  it("respects the single-product results layout", () => {
    const { thumb } = quizCardFacts({ logic_model: "decider", nodes: [], rec_page_settings: { global: { layout: "single_hero" } } });
    const html = renderToStaticMarkup(<QuizResultsThumbnail thumb={thumb} products={products} />);
    expect(html).toContain("Alpine board");
    expect(html).not.toContain("Riding gloves");
  });

  it("has an honest empty state instead of sample store products", () => {
    const { thumb } = quizCardFacts({ logic_model: "decider", nodes: [] });
    const html = renderToStaticMarkup(<QuizResultsThumbnail thumb={thumb} products={[]} />);
    expect(html).toContain("Your product collection");
    expect(html).not.toContain("<img");
  });
});
