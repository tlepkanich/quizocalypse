/* quiz-step3 v3 §5.3 → QRTZ-OA (owner call 2026-08-12, GAPS §A.2) — per-
   question section MARKERS. Categories are no longer hue-differentiated:
   every qualifier shares ONE neutral tone (cream-2 wash + the ink ladder)
   and is told apart by SHAPE AND LABEL — a compact left-edge marker drawn
   per PaletteKey in CSS (`data-qz-cat` on the section card; the QRTZ-OA
   section of quizocalypse.css). The 6-way marker vocabulary:

     green → solid bar        coral → dashed bar
     blue  → double rail      amber → dot column
     pink  → end caps         teal  → hairline

   Key names are POSITIONAL slots kept for API stability (consumers and
   tests speak PaletteKey) — they no longer imply a hue. The decider is the
   selection-critical category and keeps the ACCENT (solid accent bar +
   the accent pair — Decision 1's gold→violet move); it is NEVER assigned
   to a qualifier. Assignment stays pure + derived every render: the map is
   a function of (flow order, decider id), so moving the decider repaints
   on the next render for free. */

export type PaletteKey = "green" | "coral" | "blue" | "amber" | "pink" | "teal";
export type SectionColorKey = PaletteKey | "gold";

/** Fixed assignment order (spec §5.3 — "gold" (the decider slot) excluded
    by construction). */
export const QUALIFIER_PALETTE: readonly PaletteKey[] = [
  "green",
  "coral",
  "blue",
  "amber",
  "pink",
  "teal",
];

/** Assign a marker key per question node id, walking flow order: the decider
    gets the accent slot ("gold" — the legacy key name) at whatever position
    it sits; qualifiers take the marker slots in fixed order (wrapping
    past 6). */
export function assignSectionColors(
  orderedQuestionIds: readonly string[],
  deciderId: string | null,
): Map<string, SectionColorKey> {
  const out = new Map<string, SectionColorKey>();
  let i = 0;
  for (const id of orderedQuestionIds) {
    if (deciderId !== null && id === deciderId) {
      out.set(id, "gold");
    } else {
      out.set(id, QUALIFIER_PALETTE[i % QUALIFIER_PALETTE.length]!);
      i += 1;
    }
  }
  return out;
}

/** CSS custom-property values for a section (consumed as --sec-color /
    --sec-wash where inlined). QRTZ-OA: qualifiers all share the ONE neutral
    tone — differentiation is the marker shape, not the color; the decider
    keeps the accent pair. */
export function sectionColorVars(key: SectionColorKey): { color: string; wash: string } {
  if (key === "gold") return { color: "var(--qz-accent-ink)", wash: "var(--qz-accent-wash)" };
  return { color: "var(--qz-ink-3)", wash: "var(--qz-cream-2)" };
}
