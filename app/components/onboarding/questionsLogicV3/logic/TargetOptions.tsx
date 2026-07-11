import type { BuilderCategory } from "../../../builder/stepProps";

// Grouped <option>s for a Group/outcome target picker. Cognitive-load best
// practices: CHUNK the list by scope (this quiz's own outcomes vs reusable
// account-level Groups) with <optgroup> labels so the merchant reads scope at a
// glance (recognition over recall). But only label when BOTH kinds are present —
// a single-kind list gets no extra chrome (Hick's law: don't add structure the
// merchant has to parse when there's nothing to disambiguate).
export function TargetOptions({ categories }: { categories: BuilderCategory[] }) {
  const quizOutcomes = categories.filter((c) => c.quizId != null);
  const reusableGroups = categories.filter((c) => c.quizId == null);

  if (quizOutcomes.length === 0 || reusableGroups.length === 0) {
    return (
      <>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </>
    );
  }

  return (
    <>
      <optgroup label="This quiz">
        {quizOutcomes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </optgroup>
      <optgroup label="Reusable Groups">
        {reusableGroups.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </optgroup>
    </>
  );
}
