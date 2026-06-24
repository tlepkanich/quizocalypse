import { describe, it, expect } from "vitest";
import { reconcileDraft } from "./draftReconcile";
import { buildDemoQuiz } from "../../lib/demoQuiz";
import type { Quiz, QuizNode } from "../../lib/quizSchema";

// Deep clone so each leg of the 3-way merge is an independent doc (the merge
// must read structure, never alias it).
const clone = (q: Quiz): Quiz => JSON.parse(JSON.stringify(q)) as Quiz;

function node(doc: Quiz, id: string): QuizNode {
  const n = doc.nodes.find((x) => x.id === id);
  if (!n) throw new Error(`node ${id} not found`);
  return n;
}
const headline = (n: QuizNode): string | undefined =>
  (n.data as { headline?: string }).headline;
const qText = (n: QuizNode): string | undefined => (n.data as { text?: string }).text;

describe("reconcileDraft — autosave-vs-AI race", () => {
  it("keeps an edit typed DURING the call when the AI changed a different field", () => {
    // The reported repro: dispatch an AI edit, type a headline change while the
    // LLM runs, and the typed change must survive after the AI doc applies.
    const base = buildDemoQuiz("col_x");
    const q1 = base.nodes.find((n) => n.type === "question")!.id;

    // AI reworded the intro (a node the merchant did NOT touch).
    const ai = clone(base);
    (node(ai, "intro").data as { headline: string }).headline = "Discover your perfect match";

    // Merchant typed a new headline on q1 during the call.
    const local = clone(base);
    (node(local, q1).data as { text: string }).text = "What are you really after?";

    const out = reconcileDraft(base, ai, local);

    // The AI's intro rewrite survives…
    expect(headline(node(out, "intro"))).toBe("Discover your perfect match");
    // …AND the merchant's in-flight q1 edit survives (no silent clobber).
    expect(qText(node(out, q1))).toBe("What are you really after?");
  });

  it("prefers the merchant's value on a true same-field conflict", () => {
    const base = buildDemoQuiz("col_x");
    const ai = clone(base);
    const local = clone(base);
    (node(ai, "intro").data as { headline: string }).headline = "AI headline";
    (node(local, "intro").data as { headline: string }).headline = "Typed headline";

    const out = reconcileDraft(base, ai, local);
    expect(headline(node(out, "intro"))).toBe("Typed headline");
  });

  it("takes the AI's value where the merchant changed nothing", () => {
    const base = buildDemoQuiz("col_x");
    const ai = clone(base);
    (node(ai, "intro").data as { headline: string }).headline = "Only AI changed this";
    const local = clone(base); // merchant idle

    const out = reconcileDraft(base, ai, local);
    expect(headline(node(out, "intro"))).toBe("Only AI changed this");
  });

  it("merges concurrent top-level scalar edits to different fields", () => {
    const base = buildDemoQuiz("col_x");
    const ai = clone(base);
    ai.placement = "popup"; // AI restyled placement
    const local = clone(base);
    local.collect_email_on_result = true; // merchant toggled a flag

    const out = reconcileDraft(base, ai, local);
    expect(out.placement).toBe("popup");
    expect(out.collect_email_on_result).toBe(true);
  });

  it("keeps the AI's structural changes (added node + its edges)", () => {
    const base = buildDemoQuiz("col_x");
    const ai = clone(base);
    // AI appended a message node and wired an edge to it.
    const introId = "intro";
    ai.nodes.push({
      id: "n_added",
      type: "message",
      position: { x: 99, y: 99 },
      data: { text: "A quick note" },
    } as unknown as QuizNode);
    ai.edges.push({ id: "e_added", source: introId, target: "n_added" });

    const local = clone(base); // merchant idle structurally
    (node(local, introId).data as { headline: string }).headline = "Typed while AI added a node";

    const out = reconcileDraft(base, ai, local);
    // The AI-added node + edge are preserved verbatim (graph integrity)…
    expect(out.nodes.some((n) => n.id === "n_added")).toBe(true);
    expect(out.edges).toEqual(ai.edges);
    // …and the merchant's concurrent headline edit still survives.
    expect(headline(node(out, introId))).toBe("Typed while AI added a node");
  });

  it("re-applies an answer-list edit made during the call", () => {
    const base = buildDemoQuiz("col_x");
    const q = base.nodes.find(
      (n) => n.type === "question" && (n.data as { question_type: string }).question_type === "single_select",
    )!.id;

    const ai = clone(base); // AI left this question alone
    const local = clone(base);
    const answers = (node(local, q).data as { answers: { text: string }[] }).answers;
    answers[0]!.text = "Edited answer text";

    const out = reconcileDraft(base, ai, local);
    const outAnswers = (node(out, q).data as { answers: { text: string }[] }).answers;
    expect(outAnswers[0]!.text).toBe("Edited answer text");
  });

  it("returns a schema-valid doc", () => {
    const base = buildDemoQuiz("col_x");
    const ai = clone(base);
    ai.placement = "inline";
    const local = clone(base);
    (node(local, "intro").data as { headline: string }).headline = "valid?";

    const out = reconcileDraft(base, ai, local);
    // demoQuiz is built via Quiz.parse, so a structurally-valid merge round-trips.
    expect(out.nodes.length).toBe(base.nodes.length);
    expect(out.quiz_id).toBe(base.quiz_id);
  });
});
