import type { Quiz } from "./quizSchema";
import type { z } from "zod";
import { nextNodeFor } from "./recommendationEngine";

type QuizDoc = z.infer<typeof Quiz>;

// BIC-2 B2e — collect the images of the MOST LIKELY next step so the runtime
// can preload them while the shopper reads the current one (tapping an answer
// then paints instantly). "Most likely" = the straight-through default target:
// nextNodeFor(…, null) — the unconditional (or first) outbound edge, exactly
// what gotoNextFrom resolves when no per-answer handle diverges. Divergent
// per-answer routes and branch nodes are deliberately skipped (resolving them
// needs a BranchContext we don't want to speculate on); only a QUESTION next
// step yields URLs (its header image + answer images — the only images the
// question renderers paint). Pure + doc-only so it's unit-testable and safe to
// call from a render-adjacent effect.

/** Hard ceiling on preloads per step — never stampede the network. */
export const NEXT_STEP_IMAGE_CAP = 4;

/**
 * Image URLs of the straight-through next step from `nodeId`, deduped,
 * https-only (data:/blob:/relative URLs are pointless or unsafe to preload),
 * capped at `cap` (default 4). Empty array whenever the next step is not a
 * question (branch/gate/result/…), missing, or image-less.
 */
export function collectNextStepImages(
  quiz: QuizDoc,
  nodeId: string,
  cap: number = NEXT_STEP_IMAGE_CAP,
): string[] {
  if (cap <= 0) return [];
  const nextId = nextNodeFor(quiz, nodeId, null);
  if (!nextId) return [];
  const next = quiz.nodes.find((n) => n.id === nextId);
  if (!next || next.type !== "question") return [];
  const urls: string[] = [];
  const push = (url: string | undefined) => {
    if (urls.length >= cap) return;
    if (typeof url !== "string") return;
    if (!/^https:\/\//i.test(url)) return;
    if (urls.includes(url)) return;
    urls.push(url);
  };
  push(next.data.image_url);
  for (const answer of next.data.answers) {
    if (urls.length >= cap) break;
    push(answer.image_url);
  }
  return urls;
}
