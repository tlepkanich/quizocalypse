import type { z } from "zod";
import type { Quiz } from "./quizSchema";

// ════════════════════════════════════════════════════════════════════════════
// Experiences E4 — "Because you chose: <answer>". Maps the tags a product
// matched on (ExplainedProduct.matched_tags from the D1 engine) back to the
// ANSWER TEXT that carried each tag, so the result page can attribute every
// recommendation to the shopper's own words. Pure + deterministic: when
// several selected answers carry the same tag, the FIRST in path order wins.
// ════════════════════════════════════════════════════════════════════════════

type QuizDoc = z.infer<typeof Quiz>;

/** tag → the selected answer's text that carried it (first selection wins). */
export function tagToAnswerText(
  doc: QuizDoc,
  selectedAnswerIds: string[],
): Map<string, string> {
  const byId = new Map<string, { text: string; tags: string[] }>();
  for (const node of doc.nodes) {
    if (node.type !== "question") continue;
    for (const a of node.data.answers) byId.set(a.id, { text: a.text, tags: a.tags });
  }
  const out = new Map<string, string>();
  for (const id of selectedAnswerIds) {
    const a = byId.get(id);
    if (!a) continue;
    for (const tag of a.tags) {
      // Lowercased keys to match the engine's case-insensitive tag matching
      // (a product tagged "Acne" must map back to the "acne" answer's text).
      const key = tag.toLowerCase();
      if (!out.has(key)) out.set(key, a.text);
    }
  }
  return out;
}

/**
 * The ≤max distinct answer texts that explain a product's match. Order follows
 * the product's matched_tags (strongest-first per the engine's tag bag walk);
 * duplicate answers collapse (one answer often carries several matched tags).
 */
export function reasonsForProduct(
  matchedTags: string[],
  tagAnswers: Map<string, string>,
  max = 2,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of matchedTags) {
    const text = tagAnswers.get(tag.toLowerCase());
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}
