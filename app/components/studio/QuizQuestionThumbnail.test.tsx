import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { quizCardFacts } from "../../lib/quizLibraryCard";
import { QuizQuestionThumbnail } from "./QuizQuestionThumbnail";

describe("QuizQuestionThumbnail", () => {
  it.each(["text", "email", "numeric", "date", "slider"])("does not expose routing seed answers for %s questions", (type) => {
    const { thumb } = quizCardFacts({ logic_model: "decider", nodes: [{
      type: "question", data: { text: "Tell us about yourself", question_type: type, answers: [{ text: "Internal routing seed" }] },
    }] });
    const html = renderToStaticMarkup(<QuizQuestionThumbnail thumb={thumb} />);
    expect(html).toContain("Tell us about yourself");
    expect(html).not.toContain("Internal routing seed");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<button");
  });

  it("renders real answer labels and lazy images without selecting a response", () => {
    const { thumb } = quizCardFacts({ logic_model: "decider", nodes: [{
      type: "question", data: { text: "Your terrain?", question_type: "image_tile", answers: [{ text: "Powder", image_url: "/powder.jpg" }] },
    }] });
    const html = renderToStaticMarkup(<QuizQuestionThumbnail thumb={thumb} />);
    expect(html).toContain("Powder");
    expect(html).toContain('src="/powder.jpg"');
    expect(html).toContain('loading="lazy"');
    expect(html).not.toContain('aria-checked="true"');
  });
});
