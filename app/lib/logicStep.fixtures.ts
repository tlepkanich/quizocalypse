// Test-only fixtures for the Logic step redesign library layer (logicStyle,
// the new mutations, ruleStatus, recommendationCoverage, the describer and
// the style-aware checks). Imported ONLY by *.test.ts files.
import { Quiz } from "./quizSchema";
import type { DecisionRule } from "./quizSchema";

export type FixtureDoc = Quiz;

/** intro → q1 (single, DECIDES, mapped) → q2 (single, qualifier) →
 *  q3 (multi, FILTER, max 2, tag values) → q4 (rating 1..5) → result.
 *  Categories cat1..cat3 are the answer targets; catX is rule-only. */
export function logicDoc(
  opts: {
    rules?: DecisionRule[];
    logic_style?: "rules" | "attributes";
    legacy?: boolean;
  } = {},
): FixtureDoc {
  return Quiz.parse({
    quiz_id: "logic-fixture",
    ...(opts.legacy ? {} : { logic_model: "decider" }),
    ...(opts.logic_style ? { logic_style: opts.logic_style } : {}),
    scope: { collection_ids: [] },
    nodes: [
      { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
      {
        id: "q1",
        type: "question",
        position: { x: 1, y: 0 },
        data: {
          text: "Skin feel",
          question_type: "single_select",
          ...(opts.legacy ? {} : { role: "decides" }),
          required: true,
          answers: [
            { id: "a1", text: "Dry", edge_handle_id: "h1", ...(opts.legacy ? {} : { target_id: "cat1" }) },
            { id: "a2", text: "Oily", edge_handle_id: "h2", ...(opts.legacy ? {} : { target_id: "cat2" }) },
            { id: "a3", text: "Both", edge_handle_id: "h3", ...(opts.legacy ? {} : { target_id: "cat3" }) },
          ],
        },
      },
      {
        id: "q2",
        type: "question",
        position: { x: 2, y: 0 },
        data: {
          text: "Routine size",
          question_type: "single_select",
          ...(opts.legacy ? {} : { role: "qualifier" }),
          answers: [
            { id: "b1", text: "Short", edge_handle_id: "h4" },
            { id: "b2", text: "Long", edge_handle_id: "h5" },
            { id: "b3", text: "Yes", edge_handle_id: "h6" },
          ],
        },
      },
      {
        id: "q3",
        type: "question",
        position: { x: 3, y: 0 },
        data: {
          text: "Areas",
          question_type: "multi_select",
          max_selections: 2,
          ...(opts.legacy ? {} : { role: "filter" }),
          answers: [
            { id: "m1", text: "Cheeks", edge_handle_id: "h7", tags: ["cheeks"] },
            { id: "m2", text: "Nose", edge_handle_id: "h8", tags: ["nose"] },
            { id: "m3", text: "Yes", edge_handle_id: "h9", no_preference: true },
          ],
        },
      },
      {
        id: "q4",
        type: "question",
        position: { x: 4, y: 0 },
        data: {
          text: "Rate it",
          question_type: "rating",
          answers: [1, 2, 3, 4, 5].map((k) => ({
            id: `r${k}`,
            text: String(k),
            edge_handle_id: `hr${k}`,
          })),
        },
      },
      {
        id: "res",
        type: "result",
        position: { x: 5, y: 0 },
        data: { headline: "Done", fallback_collection_id: "col1" },
      },
    ],
    edges: [
      { id: "e1", source: "intro", target: "q1" },
      { id: "e2", source: "q1", target: "q2" },
      { id: "e3", source: "q2", target: "q3" },
      { id: "e4", source: "q3", target: "q4" },
      { id: "e5", source: "q4", target: "res" },
    ],
    ...(opts.rules ? { decision_rules: opts.rules } : {}),
  });
}

/** A rule builder: `rule("r1", [["q1","a1"],["q2","b1","is_not"]], "catX")`. */
export function rule(
  id: string,
  conds: Array<[string, string] | [string, string, "is" | "is_not"]>,
  targets: string | string[],
  extra: Partial<Pick<DecisionRule, "action" | "any_of" | "match">> = {},
): DecisionRule {
  const list = Array.isArray(targets) ? targets : [targets];
  return {
    id,
    conditions: conds.map(([question_id, answer_id, op]) => ({
      question_id,
      answer_id,
      op: op ?? "is",
    })),
    target_id: list[0]!,
    ...(list.length > 1 ? { target_ids: list } : {}),
    ...extra,
  };
}
