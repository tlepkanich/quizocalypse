import { looksLikeRatingScale } from "./smartBuild";
import { experienceTypeOf } from "./quizSchema";
import type { Quiz } from "./quizSchema";
import type { z } from "zod";

type QuizDoc = z.infer<typeof Quiz>;

export interface NodeIssue {
  nodeId: string;
  kind:
    | "orphan"
    | "dead_end"
    | "missing_fallback"
    | "intro_missing_outbound"
    // Experiences E1 — type-aware structure rules (quiz-level, pinned to intro):
    | "missing_result"
    | "missing_terminal"
    // Routing — per-answer result branching authored on the node but never
    // wired onto the edges (every answer falls through to a result-less path):
    | "dead_answer_routing"
    // LOGIC v2 (quiz-questions-logic-spec §6) — decider-model BLOCK rules,
    // only ever emitted for docs with logic_model === "decider":
    | "missing_decider" // V1 — not exactly one role="decides" question
    | "decider_bypass" // V2 — a reachable path can finish without the decider
    | "decider_optional" // V3 — the deciding question is not Required
    | "unmapped_decider_answer" // V4 (doc half) — a deciding answer has no target
    | "broken_rule_reference"; // V6 (doc half) — a rule points at a missing question/answer
  message: string;
}

// Static "can the runtime ever land here" walk from a start node. Follows every
// outbound edge regardless of source_handle — same shape as the intro
// reachability below, but rooted anywhere. Used to ask "does the fallback path
// reach a result page at all?".
function reachableFrom(doc: QuizDoc, startId: string): Set<string> {
  const seen = new Set<string>();
  const queue: string[] = [startId];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of doc.edges) {
      if (e.source === id) queue.push(e.target);
    }
  }
  return seen;
}

// Compute soft validation issues. The Zod schema enforces hard contract;
// this layer surfaces semantic issues a merchant can fix in the builder.
export function validateQuiz(doc: QuizDoc): NodeIssue[] {
  const issues: NodeIssue[] = [];

  const intro = doc.nodes.find((n) => n.type === "intro");

  // Experiences E1 — the guard rails depend on what the quiz IS FOR.
  // product_match / personality are pointless without a result page; a
  // survey / lead-capture flow just needs SOME terminal (end or result) so
  // shoppers aren't dead-ended. Quiz-level issues pin to the intro node so
  // the rail can badge them.
  const xtype = experienceTypeOf(doc);
  const resultCount = doc.nodes.filter((n) => n.type === "result").length;
  const resultIds = new Set(
    doc.nodes.filter((n) => n.type === "result").map((n) => n.id),
  );
  const terminalCount = doc.nodes.filter(
    (n) => n.type === "result" || n.type === "end",
  ).length;
  const pinId = intro?.id ?? doc.nodes[0]?.id ?? "quiz";
  if ((xtype === "product_match" || xtype === "personality") && resultCount === 0) {
    issues.push({
      nodeId: pinId,
      kind: "missing_result",
      message:
        xtype === "personality"
          ? "A personality quiz needs at least one result page (the persona reveal)."
          : "A product-match quiz needs at least one result page to recommend from.",
    });
  }
  if ((xtype === "survey" || xtype === "lead_capture") && terminalCount === 0) {
    issues.push({
      nodeId: pinId,
      kind: "missing_terminal",
      message: "Add an end screen so the flow has somewhere to finish.",
    });
  }
  const incoming = new Set<string>();
  const outgoing = new Set<string>();
  for (const e of doc.edges) {
    outgoing.add(e.source);
    incoming.add(e.target);
  }

  // Build reachability set from the intro node.
  const reachable = new Set<string>();
  if (intro) {
    const queue: string[] = [intro.id];
    while (queue.length) {
      const id = queue.shift()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      for (const e of doc.edges) {
        if (e.source === id) queue.push(e.target);
      }
    }
  }

  // ── LOGIC v2 BLOCK rules (spec §6, L2-3) — decider docs only ──────────────
  // Gated on a field no legacy doc possesses, so legacy validateQuiz output is
  // byte-identical. V4/V5's DB half (targets actually exist as Category rows)
  // is enforced at publish time in quizPublish.ts, where categories are fetched.
  if (doc.logic_model === "decider") {
    const deciders = doc.nodes.filter(
      (n) => n.type === "question" && n.data.role === "decides",
    );

    // V1 — exactly one deciding question.
    if (deciders.length !== 1) {
      issues.push({
        nodeId: deciders[1]?.id ?? pinId,
        kind: "missing_decider",
        message:
          deciders.length === 0
            ? "Pick the one question that decides the result — no question has the “Decides result” role."
            : `Only one question can decide the result — ${deciders.length} are marked “Decides”.`,
      });
    }

    const decider = deciders[0];
    if (decider && decider.type === "question") {
      // V3 — the deciding question must be Required (auto-enforced by the
      // builder, re-checked here so a hand-edited doc can't slip through).
      if (decider.data.required === false) {
        issues.push({
          nodeId: decider.id,
          kind: "decider_optional",
          message: "The deciding question must be Required — a skipped decider means no result.",
        });
      }

      // V2 — every reachable path passes through the decider before the quiz
      // ends. Dominator check: walk from the intro WITHOUT traversing beyond
      // the decider; any terminal still reachable = a bypass path exists.
      if (intro) {
        const seen = new Set<string>();
        const queue: string[] = [intro.id];
        while (queue.length) {
          const id = queue.shift()!;
          if (seen.has(id)) continue;
          seen.add(id);
          if (id === decider.id) continue; // reach it, never pass beyond it
          for (const e of doc.edges) {
            if (e.source === id) queue.push(e.target);
          }
        }
        const bypassTerminal = doc.nodes.find(
          (n) => (n.type === "result" || n.type === "end") && seen.has(n.id),
        );
        if (bypassTerminal) {
          issues.push({
            nodeId: bypassTerminal.id,
            kind: "decider_bypass",
            message:
              "A path can finish the quiz without answering the deciding question — those shoppers would get no result. Re-route it through the decider.",
          });
        }
      }

      // V4 (doc half) — every deciding answer maps to a target.
      for (const a of decider.data.answers) {
        if (!a.target_id) {
          issues.push({
            nodeId: decider.id,
            kind: "unmapped_decider_answer",
            message: `Answer “${a.text}” on the deciding question has no result mapped.`,
          });
        }
      }
    }

    // V6 (doc half) — rules must reference questions/answers that still exist.
    // (V5's bucket-existence half runs at publish, where Category rows are known.)
    const answerIdsByQuestion = new Map<string, Set<string>>();
    for (const n of doc.nodes) {
      if (n.type === "question") {
        answerIdsByQuestion.set(n.id, new Set(n.data.answers.map((a) => a.id)));
      }
    }
    for (const rule of doc.decision_rules ?? []) {
      for (const c of rule.conditions) {
        const answers = answerIdsByQuestion.get(c.question_id);
        if (!answers || !answers.has(c.answer_id)) {
          issues.push({
            nodeId: pinId,
            kind: "broken_rule_reference",
            message: `A rule references a ${answers ? "deleted answer" : "deleted question"} — remove or rebuild the rule.`,
          });
          break; // one issue per rule is enough
        }
      }
    }
  }
  // ──────────────────────────────────────────────────────────────────────────

  for (const node of doc.nodes) {
    if (node.type === "intro") {
      if (!outgoing.has(node.id)) {
        issues.push({
          nodeId: node.id,
          kind: "intro_missing_outbound",
          message: "Intro has no outbound edge.",
        });
      }
      continue;
    }
    if (!reachable.has(node.id)) {
      issues.push({
        nodeId: node.id,
        kind: "orphan",
        message: "Not reachable from intro.",
      });
    }
    // Result and End are terminal — they aren't expected to have outbound edges.
    // Everything else should advance somewhere.
    const isTerminal = node.type === "result" || node.type === "end";
    if (!isTerminal && !outgoing.has(node.id)) {
      issues.push({
        nodeId: node.id,
        kind: "dead_end",
        message: "No outbound edge — flow would dead-end here.",
      });
    }
    if (node.type === "result" && !node.data.fallback_collection_id) {
      issues.push({
        nodeId: node.id,
        kind: "missing_fallback",
        message: "Result is missing a fallback collection.",
      });
    }
    // Question-specific: a multi_select min/max that can never be satisfied
    // (min > max, or min > the number of answers) would permanently disable the
    // Next button — a hard dead-end for the shopper.
    if (node.type === "question") {
      const min = node.data.min_selections;
      if (typeof min === "number") {
        const max = node.data.max_selections;
        if (typeof max === "number" && min > max) {
          issues.push({
            nodeId: node.id,
            kind: "dead_end",
            message: `Min picks (${min}) is greater than max picks (${max}).`,
          });
        }
        if (min > node.data.answers.length) {
          issues.push({
            nodeId: node.id,
            kind: "dead_end",
            message: `Min picks (${min}) exceeds the number of answers (${node.data.answers.length}).`,
          });
        }
      }

      // Routing — the "Your Skin Concern Report" defect class. The merchant
      // authored per-answer result branching (answers carry edge_handle_ids and
      // the node fans out to result pages), but the destinations were never
      // written onto the edges as source_handle. nextNodeFor (the runtime)
      // therefore matches NO answer handle and collapses every pick onto its
      // unconditional fallback. When that fallback reaches no result page at
      // all, 100% of shoppers exit with ZERO recommendations and every wired
      // result is runtime-dead. The intro-reachability check above can't catch
      // it — those result edges exist, so the results look "reachable" — so we
      // model the runtime's actual choice here.
      const outbound = doc.edges.filter((e) => e.source === node.id);
      const handles = new Set(
        outbound
          .map((e) => e.source_handle)
          .filter((h): h is string => !!h),
      );
      const someAnswerRoutes = node.data.answers.some((a) =>
        handles.has(a.edge_handle_id),
      );
      const pointsToResult = outbound.some((e) => resultIds.has(e.target));
      if (!someAnswerRoutes && pointsToResult) {
        // Mirror nextNodeFor exactly: first unconditional edge, else first edge.
        const fallback = outbound.find((e) => !e.source_handle) ?? outbound[0];
        const reachesResult =
          !!fallback &&
          [...reachableFrom(doc, fallback.target)].some((id) =>
            resultIds.has(id),
          );
        if (!reachesResult) {
          issues.push({
            nodeId: node.id,
            kind: "dead_answer_routing",
            message:
              "Answers branch to result pages, but no outbound edge carries an answer's handle — every shopper falls through to a path with no result, so the per-answer routing is dead. Connect each answer to its result (or route through a branch node).",
          });
        }
      }
    }
    // Branch-specific: every slot should have an outbound edge, otherwise
    // the runtime can land in a dead-end branch path.
    if (node.type === "branch") {
      for (const slot of node.data.slots) {
        const wired = doc.edges.some(
          (e) => e.source === node.id && e.source_handle === slot.id,
        );
        if (!wired) {
          issues.push({
            nodeId: node.id,
            kind: "dead_end",
            message: `Branch slot "${slot.label}" has no outbound edge.`,
          });
        }
      }
    }
  }

  return issues;
}

// ---------- Suggestions (BIC P3) — NEVER block publishing ----------
// quizPublish.ts throws on ANY validateQuiz issue, so quality hints live in a
// SEPARATE export the publish gate never calls. Surfaced as a soft
// "Suggestions" banner in the editors.

export interface QuizSuggestion {
  nodeId: string;
  kind: "duplicate_question_text" | "type_content_mismatch" | "missing_capture";
  message: string;
}

export function validateQuizWarnings(doc: QuizDoc): QuizSuggestion[] {
  const suggestions: QuizSuggestion[] = [];

  // Experiences E1 — a lead-capture quiz that never captures anything is a
  // funnel to nowhere. Suggestion (not blocking): merchants may capture via
  // an integration webhook instead of the gate.
  if (experienceTypeOf(doc) === "lead_capture") {
    const captures = doc.nodes.some(
      (n) => n.type === "email_gate" || n.type === "integration",
    );
    if (!captures) {
      const pin = doc.nodes.find((n) => n.type === "intro") ?? doc.nodes[0];
      suggestions.push({
        nodeId: pin?.id ?? "quiz",
        kind: "missing_capture",
        message:
          "This lead-capture experience has no email gate or integration step — nothing is being captured.",
      });
    }
  }

  // Duplicate question text — confusing for shoppers and for funnel analytics
  // (per-branch duplicates may be intentional, hence a suggestion, not an error).
  const byText = new Map<string, string[]>();
  for (const n of doc.nodes) {
    if (n.type !== "question") continue;
    const key = n.data.text.trim().toLowerCase();
    byText.set(key, [...(byText.get(key) ?? []), n.id]);
  }
  for (const [, ids] of byText) {
    if (ids.length > 1) {
      const first = doc.nodes.find((n) => n.id === ids[0]);
      suggestions.push({
        nodeId: ids[0]!,
        kind: "duplicate_question_text",
        message: `“${first?.type === "question" ? first.data.text.slice(0, 48) : "Question"}” appears ${ids.length} times — shoppers on some paths may see what looks like a repeat.`,
      });
    }
  }

  // Type/content mismatch — same heuristics the Smart Build normalizer applies
  // to NEW generations, surfaced for existing docs (demo/template/manual paths).
  for (const n of doc.nodes) {
    if (n.type !== "question") continue;
    if (n.data.question_type === "rating" && !looksLikeRatingScale(n.data.answers)) {
      suggestions.push({
        nodeId: n.id,
        kind: "type_content_mismatch",
        message: `“${n.data.text.slice(0, 48)}” is a rating scale but its answers read like categories — single select would render better.`,
      });
    }
    if (n.data.question_type === "swatch" && n.data.answers.some((a) => !a.image_url)) {
      suggestions.push({
        nodeId: n.id,
        kind: "type_content_mismatch",
        message: `“${n.data.text.slice(0, 48)}” is a swatch picker but some answers have no image — they render as empty circles.`,
      });
    }
  }

  return suggestions;
}
