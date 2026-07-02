import type { Answer } from "./quizSchema";

export interface RegeneratedAnswer {
  text: string;
  tags: string[];
  collection_filter?: string;
  image_url?: string;
}

const norm = (t: string) => t.trim().toLowerCase();

// Questions & Logic spec §3.1/§7 — merge AI-regenerated answers with the question's
// PRIOR answers, preserving the bucket mapping (points / points_alt) — and, for
// LOGIC v2 decider docs, the answer's target_id — for answers whose TEXT the AI
// kept unchanged (text-keyed carry), while reusing the prior answer's id +
// edge_handle_id BY INDEX so aligned per-answer routing edges still resolve. Pure —
// the caller injects fresh id/handle generators for answers beyond the prior count
// (so this is deterministic + unit-testable).
//
// INTENTIONAL ASYMMETRY: id/handle reuse is POSITIONAL while points follow TEXT — so
// if the AI REORDERS answers, an existing per-answer skip edge stays bound to its
// index (may re-bind to a reordered answer) while bucket mappings correctly follow
// the text. The funnel's 10s undo restores the exact prior state if that's unwanted.
export function mergeRegeneratedAnswers(
  oldAnswers: Answer[],
  newAnswers: RegeneratedAnswer[],
  freshId: () => string,
  freshHandle: () => string,
): Answer[] {
  const carryByText = new Map<string, Pick<Answer, "points" | "points_alt" | "target_id">>();
  for (const a of oldAnswers) {
    carryByText.set(norm(a.text), {
      ...(a.points ? { points: a.points } : {}),
      ...(a.points_alt ? { points_alt: a.points_alt } : {}),
      ...(a.target_id ? { target_id: a.target_id } : {}),
    });
  }
  return newAnswers.map((newA, idx) => {
    const oldA = oldAnswers[idx];
    const carried = carryByText.get(norm(newA.text));
    return {
      id: oldA?.id ?? freshId(),
      text: newA.text,
      tags: newA.tags,
      ...(newA.collection_filter ? { collection_filter: newA.collection_filter } : {}),
      ...(newA.image_url ? { image_url: newA.image_url } : {}),
      edge_handle_id: oldA?.edge_handle_id ?? freshHandle(),
      ...(carried?.points ? { points: carried.points } : {}),
      ...(carried?.points_alt ? { points_alt: carried.points_alt } : {}),
      ...(carried?.target_id ? { target_id: carried.target_id } : {}),
    };
  });
}
