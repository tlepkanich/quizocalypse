// PORT-10 — pure helpers for the global "starter" industry templates (the 8
// docs/design/strategy/quiz-templates/*.template.json skeletons, seeded as
// shopId=NULL SavedTemplate rows by scripts/seed-templates.mjs).
//
// No I/O here — the server seam stays in savedTemplates.server.ts /
// funnelLoader.server.ts; the client (ShapeStage) imports only the label
// helpers.
import type { IndustryTemplateMeta, RichTemplateOption } from "./quizSchema";

// A funnel-facing template list entry (FunnelData.savedTemplates item).
// `scope` labels the source: "shop" = merchant-saved, "starter" = global
// builtin; `category` is the starter's vertical (null for shop rows).
export interface TemplateListEntry {
  id: string;
  name: string;
  template: RichTemplateOption;
  scope: "shop" | "starter";
  category: string | null;
}

// Merge the shop's saved templates with the global starters — shop rows FIRST
// (the merchant's own work outranks builtins), starters after, each labeled.
export function mergeTemplateOptions(
  shopRows: Array<{ id: string; name: string; template: RichTemplateOption }>,
  starterRows: Array<{ id: string; name: string; template: RichTemplateOption }>,
): TemplateListEntry[] {
  return [
    ...shopRows.map((r) => ({ ...r, scope: "shop" as const, category: null })),
    ...starterRows.map((r) => ({
      ...r,
      scope: "starter" as const,
      category: r.template.industry?.category ?? null,
    })),
  ];
}

// "beauty/custom-formulation" → "Beauty" (the pill's compact vertical tag).
export function categoryLabel(category: string | null): string {
  if (!category) return "";
  const head = category.split("/")[0] ?? category;
  return head.charAt(0).toUpperCase() + head.slice(1);
}

// Render the stored industry metadata as structured build-prompt context.
// §I2 v1 posture: the maps_to keyword bindings are presented as AUTHORING
// GUIDANCE (attribute themes the questions should cover) — never hard
// bindings; the build's catalog grounding (scopeCatalogToChosen + the chosen
// buckets) always wins. Consumed by buildQuizFromPicked → runAiOnboardingBuild
// (templateGuidance), appended to the goal context; legacy/AI templates carry
// no `industry` block, so this never fires for them.
export function industryGuidanceText(meta: IndustryTemplateMeta): string {
  const lines: string[] = [];
  lines.push(
    `This quiz starts from a proven industry template (vertical: ${meta.category}` +
      (meta.variant ? `, pattern: ${meta.variant}` : "") +
      `). Use its structure as the skeleton — expand and adapt to THIS merchant's catalog.`,
  );
  if (meta.use_when) lines.push(`When this template applies: ${meta.use_when}`);
  if (meta.length) {
    const band = meta.length.band ? ` (${meta.length.band} band)` : "";
    const note = meta.length.note ? ` — ${meta.length.note}` : "";
    lines.push(`Target length: ${meta.length.min}–${meta.length.max} questions${band}${note}`);
  }
  if (meta.arc && meta.arc.length > 0) {
    lines.push(`Question arc (keep this ordering): ${meta.arc.join(" → ")}`);
  }
  if (meta.branching) lines.push(`Branching depth: ${meta.branching}`);
  if (meta.result_shape) lines.push(`Result shape: ${meta.result_shape.replaceAll("_", " ")}`);
  if (meta.gate?.placement) {
    const style = meta.gate.style ? `, ${meta.gate.style}` : "";
    const why = meta.gate.rationale ? ` — ${meta.gate.rationale}` : "";
    lines.push(`Contact gate: ${meta.gate.placement.replaceAll("_", " ")}${style}${why}`);
  }
  if (meta.questions && meta.questions.length > 0) {
    lines.push(
      "Skeleton questions (the proven arc — adapt wording and answers to the merchant's products; the maps_to keywords are attribute THEMES to cover where the catalog supports them, treat them as authoring guidance, not literal tags):",
    );
    for (const q of meta.questions) {
      const opts = (q.options ?? [])
        .map((o) => (o.maps_to ? `${o.label} (${o.maps_to})` : o.label))
        .join(" / ");
      const tier = q.weight_tier ? ` [${q.weight_tier}]` : "";
      lines.push(`- ${q.prompt}${tier}${opts ? ` — options: ${opts}` : ""}`);
    }
  }
  if (meta.recommendation?.tie_break || meta.recommendation?.empty_fallback) {
    const rec: string[] = [];
    if (meta.recommendation.architecture) rec.push(`architecture ${meta.recommendation.architecture}`);
    if (meta.recommendation.tie_break) rec.push(`tie-break: ${meta.recommendation.tie_break}`);
    if (meta.recommendation.empty_fallback)
      rec.push(`never-empty fallback: ${meta.recommendation.empty_fallback}`);
    lines.push(`Recommendation intent (guidance): ${rec.join("; ")}`);
  }
  if (meta.personalization_hooks && meta.personalization_hooks.length > 0) {
    lines.push(`Personalization hooks: ${meta.personalization_hooks.join("; ")}`);
  }
  lines.push(
    "Ground every question and recommendation in the merchant's chosen product groups — the template shapes structure, ordering and phrasing only. Ignore any template attribute that doesn't exist in this catalog.",
  );
  return `Industry template guidance:\n${lines.join("\n")}`;
}
