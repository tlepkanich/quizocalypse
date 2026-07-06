// BIC-2 C3a — decider-doc mutations (LOGIC v2): question roles, answer targets,
// moveDecider, and the decision-rule CRUD. All logic_model-gated so a stray
// call against a legacy doc no-ops. Pure move out of quizMutations.ts.
import { isFreeformType } from "../quizSchema";
import type { DecisionRule } from "../quizSchema";
import { uid, type QuizDoc } from "./shared";

// ── LOGIC v2 mutations (decider docs only) ──────────────────────────────────

// §2.1 — set a question's role. "decides" is EXCLUSIVE (exactly one per quiz):
// promoting a question demotes any other decider to qualifier, and forces
// required=true on the new decider (V3 — auto-enforced, locked in the UI).
// Multi-select questions can never decide (§2.2), and neither can freeform/open
// types (no discrete answers to direct-map) — those calls no-op. Pure.
export function setQuestionRole(
  doc: QuizDoc,
  nodeId: string,
  role: "decides" | "qualifier",
): QuizDoc {
  // Defense-in-depth: role is a decider-doc concept. A stray call against a
  // legacy doc would inject keys that violate legacy byte-stability — no-op.
  if (doc.logic_model !== "decider") return doc;
  const node = doc.nodes.find((n) => n.id === nodeId);
  if (!node || node.type !== "question") return doc;
  if (
    role === "decides" &&
    (node.data.question_type === "multi_select" || isFreeformType(node.data.question_type))
  )
    return doc;
  return {
    ...doc,
    nodes: doc.nodes.map((n) => {
      if (n.type !== "question") return n;
      if (n.id === nodeId) {
        return {
          ...n,
          data: {
            ...n.data,
            role,
            ...(role === "decides" ? { required: true } : {}),
          },
        };
      }
      // Demote any other decider — exactly one per quiz (V1).
      if (role === "decides" && n.data.role === "decides") {
        return { ...n, data: { ...n.data, role: "qualifier" } };
      }
      return n;
    }),
  };
}

// §2.1 — map a deciding answer directly to a recommendation target (a Step-1
// Category id). null clears the mapping (V4 then blocks publish until it's
// re-picked). Only meaningful on the decider; the v2 UI only offers it there.
export function setAnswerTarget(
  doc: QuizDoc,
  questionNodeId: string,
  answerId: string,
  targetId: string | null,
): QuizDoc {
  // Same defense-in-depth as setQuestionRole — target_id never touches legacy docs.
  if (doc.logic_model !== "decider") return doc;
  const node = doc.nodes.find((n) => n.id === questionNodeId);
  if (!node || node.type !== "question") return doc;
  return {
    ...doc,
    nodes: doc.nodes.map((n) =>
      n.id === questionNodeId && n.type === "question"
        ? {
            ...n,
            data: {
              ...n.data,
              answers: n.data.answers.map((a) => {
                if (a.id !== answerId) return a;
                if (targetId) return { ...a, target_id: targetId };
                const { target_id: _cleared, ...rest } = a;
                return rest;
              }),
            },
          }
        : n,
    ),
  };
}

// quiz-step3 v3 §5.4 — MOVE the decider (the flag-tab's radio semantics).
// "Moving the decider clears its current mappings" (locked behavior): the old
// decider demotes to qualifier AND every one of its answers DROPS target_id
// (destructure-drop — the same absent-when-unset shape as setAnswerTarget's
// clear path), while the new decider promotes with required forced true.
// decision_rules are deliberately UNTOUCHED — the spec wipes MAPPINGS only;
// rules referencing the old decider's answers survive and surface through the
// V7/V8 diagnostics (the confirm dialog says rules are kept). Also covers
// first-promotion (no current decider): a pure promote, nothing to wipe.
export function moveDecider(doc: QuizDoc, toNodeId: string): QuizDoc {
  if (doc.logic_model !== "decider") return doc;
  const target = doc.nodes.find((n) => n.id === toNodeId);
  if (!target || target.type !== "question") return doc;
  if (
    target.data.question_type === "multi_select" ||
    isFreeformType(target.data.question_type)
  )
    return doc;
  if (target.data.role === "decides") return doc;
  return {
    ...doc,
    nodes: doc.nodes.map((n) => {
      if (n.type !== "question") return n;
      if (n.id === toNodeId) {
        // Review-caught (cross-UI resurrection): a question demoted through the
        // OLD UI's setQuestionRole keeps its answers' target_id invisibly (the
        // qualifier row renders no target select) — promoting it here would
        // bring months-old mappings back to life as live routing while the
        // confirm dialog says mappings were cleared, with V4/publish all green.
        // So the promote branch ALSO drops any pre-existing target_id: the new
        // decider always arrives UNMAPPED ("Choose…" per §5.4). No-op for
        // v3-pure docs (our own demote already wipes).
        return {
          ...n,
          data: {
            ...n.data,
            role: "decides" as const,
            required: true,
            answers: n.data.answers.map((a) => {
              if (!("target_id" in a)) return a;
              const { target_id: _stale, ...rest } = a;
              return rest;
            }),
          },
        };
      }
      if (n.data.role === "decides") {
        return {
          ...n,
          data: {
            ...n.data,
            role: "qualifier" as const,
            answers: n.data.answers.map((a) => {
              if (!("target_id" in a)) return a;
              const { target_id: _cleared, ...rest } = a;
              return rest;
            }),
          },
        };
      }
      return n;
    }),
  };
}

// ── LOGIC v2 §4 — advanced decision rules (decider docs only) ───────────────
// Priority = ARRAY ORDER (top→bottom, first full match wins — the engine's
// resolveTarget contract). All four are pure + logic_model-gated like
// setQuestionRole: a stray call against a legacy doc no-ops so decision_rules
// never appears on the legacy wire.

/** Append a new rule at the BOTTOM (lowest priority). Starts with zero
 *  conditions — half-built (V9), so it can never fire until the merchant adds
 *  one. `defaultTargetId` seeds the required target (schema min(1)); the UI
 *  passes the first bucket. */
export function addDecisionRule(doc: QuizDoc, defaultTargetId: string): QuizDoc {
  if (doc.logic_model !== "decider" || !defaultTargetId) return doc;
  const rule: DecisionRule = { id: uid("rule"), conditions: [], target_id: defaultTargetId };
  return { ...doc, decision_rules: [...(doc.decision_rules ?? []), rule] };
}

export function removeDecisionRule(doc: QuizDoc, ruleId: string): QuizDoc {
  if (doc.logic_model !== "decider") return doc;
  const rules = doc.decision_rules ?? [];
  if (!rules.some((r) => r.id === ruleId)) return doc;
  return { ...doc, decision_rules: rules.filter((r) => r.id !== ruleId) };
}

/** Move a rule to `toIndex` (clamped) — the §4.1 priority reorder. */
export function moveDecisionRule(doc: QuizDoc, ruleId: string, toIndex: number): QuizDoc {
  if (doc.logic_model !== "decider") return doc;
  const rules = [...(doc.decision_rules ?? [])];
  const from = rules.findIndex((r) => r.id === ruleId);
  if (from < 0) return doc;
  const to = Math.max(0, Math.min(rules.length - 1, toIndex));
  if (to === from) return doc;
  const [rule] = rules.splice(from, 1);
  rules.splice(to, 0, rule!);
  return { ...doc, decision_rules: rules };
}

/** Patch a rule's conditions and/or target. The UI builds the whole conditions
 *  array (dropdown-built, §4.1 — never free text), so one setter suffices. An
 *  empty-string target patch is ignored (schema requires min(1)). */
export function updateDecisionRule(
  doc: QuizDoc,
  ruleId: string,
  patch: Partial<Pick<DecisionRule, "conditions" | "target_id">>,
): QuizDoc {
  if (doc.logic_model !== "decider") return doc;
  const rules = doc.decision_rules ?? [];
  if (!rules.some((r) => r.id === ruleId)) return doc;
  return {
    ...doc,
    decision_rules: rules.map((r) =>
      r.id === ruleId
        ? {
            ...r,
            ...(patch.conditions ? { conditions: patch.conditions } : {}),
            ...(patch.target_id ? { target_id: patch.target_id } : {}),
          }
        : r,
    ),
  };
}
