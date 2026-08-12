// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement } from "react";
import type { QuizNode } from "../../lib/quizSchema";
import type { BuilderCategory, BuilderCollection } from "../builder/stepProps";
import type { IndexedProduct } from "../../lib/recommendationEngine";
import { RulesTabBody } from "./ContextPanel";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// QRTZ-OB2 — the Build inspector's Rules tab (owner reversal 2026-08-12,
// GAPS.md §A item 6). These tests pin the contracts that matter:
// (1) the MOCK vocabulary ("Picks the result" / "Narrows on …" / "Maps to" /
//     "No filter") — the tab writes its own display strings (GAPS §A item 7);
// (2) READ-ONLY — no inputs/selects/role controls render, so the target_ids
//     one-write-path invariant cannot be violated from this surface;
// (3) the "Open in Logic" deep link passes the QUESTION's node id.

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function render(node: React.ReactElement): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(node);
  });
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

type QuestionNode = Extract<QuizNode, { type: "question" }>;

const questionNode = (
  role: "decides" | "filter" | "qualifier" | undefined,
  answers: Array<Record<string, unknown>>,
): QuestionNode =>
  ({
    id: "q1",
    type: "question",
    data: {
      text: "What are you shopping for?",
      question_type: "single_select",
      role,
      answers: answers.map((a, i) => ({ id: `a${i}`, text: `Answer ${i}`, tags: [], ...a })),
    },
  }) as unknown as QuestionNode;

const categories: BuilderCategory[] = [
  { id: "cat1", name: "Workwear Capsule", productIds: ["p1", "p2"] } as unknown as BuilderCategory,
];
const collections: BuilderCollection[] = [{ collectionId: "col1", title: "Sale" }];
const productIndex = [
  { product_id: "p1", tags: ["Fit:Slim"], collection_ids: [] },
  { product_id: "p2", tags: ["Fit:Regular"], collection_ids: [] },
] as unknown as IndexedProduct[];

describe("RulesTabBody (QRTZ-OB2)", () => {
  it("decider role reads 'Picks the result' and maps answers to their target Set", () => {
    const el = render(
      createElement(RulesTabBody, {
        node: questionNode("decides", [{ target_id: "cat1" }, {}]),
        categories,
        collections,
        productIndex,
      }),
    );
    expect(el.querySelector(".qz-obr-rolev")?.textContent).toBe("Picks the result");
    expect(el.textContent).toContain("Maps to");
    expect(el.textContent).toContain("Workwear Capsule");
    expect(el.textContent).toContain("Not mapped yet");
    // The one-decider sentence, mock-verbatim.
    expect(el.textContent).toContain("One question picks the result.");
  });

  it("narrowing role reads 'Narrows on {attribute}' with No filter for no_preference", () => {
    const el = render(
      createElement(RulesTabBody, {
        node: questionNode("filter", [{ tags: ["Fit:Slim"] }, { no_preference: true }]),
        categories,
        collections,
        productIndex,
      }),
    );
    // derivedNarrowLabel: one family field → its bare label.
    expect(el.querySelector(".qz-obr-rolev")?.textContent).toBe("Narrows on fit");
    expect(el.textContent).toContain("Slim");
    expect(el.textContent).toContain("No filter");
  });

  it("non-deciding role reads 'Info only' with no mapping rows", () => {
    const el = render(
      createElement(RulesTabBody, {
        node: questionNode("qualifier", [{}]),
        categories,
        collections,
        productIndex,
      }),
    );
    expect(el.querySelector(".qz-obr-rolev")?.textContent).toBe("Info only");
    expect(el.querySelectorAll(".qz-obr-row").length).toBe(0);
  });

  it("is READ-ONLY (no inputs/selects) and deep-links with the question's node id", () => {
    let linked: string | undefined;
    const el = render(
      createElement(RulesTabBody, {
        node: questionNode("decides", [{ target_id: "cat1" }]),
        categories,
        collections,
        productIndex,
        onOpenLogic: (id?: string) => {
          linked = id;
        },
      }),
    );
    expect(el.querySelectorAll("input, select, textarea").length).toBe(0);
    const btn = [...el.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Open in Logic"),
    );
    expect(btn).toBeTruthy();
    act(() => {
      btn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(linked).toBe("q1");
  });
});
