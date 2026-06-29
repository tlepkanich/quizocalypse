// Questions & Logic spec §9 — the deterministic per-bucket colour palette + the
// per-answer letter-bullet colours. Buckets and answer letters are coloured by
// their INDEX (stable across renders), so the same bucket always reads the same
// colour in the answer-row pill, the Table view, and the Outcome-Coverage row.
// Pure data + tiny helpers — no React, no DOM.

export interface BucketColor {
  /** Solid accent (chip text / dot fill). */
  solid: string;
  /** Tinted background (chip fill). */
  bg: string;
  /** Mid tone (border / hover). */
  mid: string;
}

// The spec's o1/o2/o3 (green/blue/purple) extended with three more distinct hues
// so quizzes with >3 buckets stay legible. Cycles for any further buckets.
export const BUCKET_PALETTE: BucketColor[] = [
  { solid: "#059669", bg: "#ECFDF5", mid: "#6EE7B7" }, // green  (o1)
  { solid: "#0284C7", bg: "#F0F9FF", mid: "#7DD3FC" }, // blue   (o2)
  { solid: "#7C3AED", bg: "#F5F3FF", mid: "#C4B5FD" }, // purple (o3)
  { solid: "#D97706", bg: "#FFFBEB", mid: "#FCD34D" }, // amber
  { solid: "#DC2626", bg: "#FEF2F2", mid: "#FCA5A5" }, // red
  { solid: "#0EA5E9", bg: "#F0F9FF", mid: "#7DD3FC" }, // sky
];

export function bucketColor(index: number): BucketColor {
  const safe = ((index % BUCKET_PALETTE.length) + BUCKET_PALETTE.length) % BUCKET_PALETTE.length;
  return BUCKET_PALETTE[safe]!;
}

// Per-answer letter-bullet colours (spec §9 "Answer letter colors", index 0–5).
export const ANSWER_LETTER_COLORS = [
  "#3B82F6",
  "#D97706",
  "#7C3AED",
  "#059669",
  "#DC2626",
  "#0EA5E9",
] as const;

export function answerLetterColor(index: number): string {
  const n = ANSWER_LETTER_COLORS.length;
  return ANSWER_LETTER_COLORS[(((index % n) + n) % n)]!;
}

// A, B, C … Z, then wraps (AA-style not needed — answers cap at 8).
export function answerLetter(index: number): string {
  return String.fromCharCode(65 + (index % 26));
}
