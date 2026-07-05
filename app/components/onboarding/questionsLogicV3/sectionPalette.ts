/* quiz-step3 v3 §5.3 — per-question section colors. Questions draw from the
   reserved palette set in FIXED flow order (green, coral, blue, amber, pink,
   teal); GOLD IS NEVER ASSIGNED — it belongs to the decider exclusively,
   wherever it sits. Pure + derived every render (nothing persisted): the map
   is a function of (flow order, decider id), so moving the decider repaints
   on the next render for free. Keys map to the --qz-pal-* / --qz-gold token
   families in quizocalypse.css. */

export type PaletteKey = "green" | "coral" | "blue" | "amber" | "pink" | "teal";
export type SectionColorKey = PaletteKey | "gold";

/** Fixed assignment order (spec §5.3 — gold excluded by construction). */
export const QUALIFIER_PALETTE: readonly PaletteKey[] = [
  "green",
  "coral",
  "blue",
  "amber",
  "pink",
  "teal",
];

/** Assign a color key per question node id, walking flow order: the decider
    gets GOLD at whatever position it sits; qualifiers take the palette in
    fixed order (wrapping past 6). */
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

/** CSS custom-property values for a section color (consumed as --sec-color /
    --sec-wash on the section card; every treatment — number chip, hover bar,
    tinted shadow, editable wash — reads these two). */
export function sectionColorVars(key: SectionColorKey): { color: string; wash: string } {
  if (key === "gold") return { color: "var(--qz-gold)", wash: "var(--qz-gold-wash)" };
  return { color: `var(--qz-pal-${key})`, wash: `var(--qz-pal-${key}-wash)` };
}
