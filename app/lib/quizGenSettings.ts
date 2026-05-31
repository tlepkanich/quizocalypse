import { z } from "zod";
import type { Quiz } from "./quizSchema";
import { addIntegrationNode } from "./quizMutations";
import { getPreset } from "./themePresets";
import { resolveDesignTokens } from "./designTokens";

type QuizDoc = z.infer<typeof Quiz>;
type QuizNode = QuizDoc["nodes"][number];

// Seed per-answer category points by tag overlap: for each question answer,
// records points[categoryId] = count of the answer's tags found in that
// category's tags (only overlaps ≥1; answers with no tags / no overlap are
// left untouched). Pure. Shared by the wizard post-process (below) and Smart
// Build (app/lib/smartBuild.ts).
export function seedPointsFromCategories(
  nodes: QuizNode[],
  categories: Array<{ id: string; tags?: string[] }>,
): QuizNode[] {
  const categoryTagSets = categories.map((c) => ({
    id: c.id,
    tags: new Set((c.tags ?? []).map((t) => t.toLowerCase())),
  }));
  return nodes.map((n) => {
    if (n.type !== "question") return n;
    return {
      ...n,
      data: {
        ...n.data,
        answers: n.data.answers.map((answer) => {
          const answerTags = answer.tags.map((t) => t.toLowerCase());
          if (answerTags.length === 0) return answer;
          const points: Record<string, number> = {};
          for (const cat of categoryTagSets) {
            let overlap = 0;
            for (const tag of answerTags) {
              if (cat.tags.has(tag)) overlap += 1;
            }
            if (overlap >= 1) points[cat.id] = overlap;
          }
          if (Object.keys(points).length === 0) return answer;
          return { ...answer, points };
        }),
      },
    } as QuizNode;
  });
}

// Settings the merchant picks in the "Customize" panel of the New Quiz
// wizard. Two distinct jobs: (a) bias the AI's SYSTEM_PROMPT so generated
// flows include the new node types, and (b) deterministically post-process
// the generated doc so guarantees we can make (theme tokens, launcher
// config, integration stub) actually land regardless of AI behavior.
//
// Schema lives next to the code that uses it — kept lightweight (no zod
// refines) so the action handler can parse FormData JSON directly.

export const QuizGenSettings = z.object({
  // Empty string / undefined = no preset applied. Otherwise must match a
  // THEME_PRESETS[].id.
  theme_preset_id: z.string().optional(),
  tone: z
    .enum(["friendly", "editorial", "playful", "professional"])
    .default("friendly"),
  // v3 page-model posture. "shared" = all result nodes inherit one design
  // template; "custom" = each result node is independently editable (the
  // pre-v3 behavior). applyPostGeneration stamps this onto the generated
  // doc's top-level result_layout_mode. Default "custom" so existing flows
  // are unchanged.
  result_layout_mode: z.enum(["shared", "custom"]).default("custom"),
  flow: z
    .object({
      welcome_message: z.boolean().default(false),
      email_gate: z.boolean().default(false),
      mid_flow_preview: z.boolean().default(false),
      ask_ai_followup: z.boolean().default(false),
      end_screen: z.boolean().default(false),
      mixed_input_types: z.boolean().default(false),
      // Bind result pages to discovered categories instead of running
      // per-product tag scoring. The AI generator gets the category list
      // as context; applyPostGeneration matches each result page's name
      // back to a category id and flips match_strategy to "archetype".
      use_archetype_results: z.boolean().default(false),
      // v3 points scoring. When on, each result node's match_ladder is set
      // to ["points"] and every answer gets seeded with point weights
      // toward the discovered categories (computed deterministically from
      // tag overlap in applyPostGeneration). Requires categories to exist.
      use_points_results: z.boolean().default(false),
    })
    .default({
      welcome_message: false,
      email_gate: false,
      mid_flow_preview: false,
      ask_ai_followup: false,
      end_screen: false,
      mixed_input_types: false,
      use_archetype_results: false,
      use_points_results: false,
    }),
  launcher: z
    .object({
      enabled: z.boolean().default(false),
      icon: z.enum(["sparkle", "star", "chat"]).default("sparkle"),
      corner: z
        .enum(["bottom-right", "bottom-left", "top-right", "top-left"])
        .default("bottom-right"),
    })
    .default({
      enabled: false,
      icon: "sparkle",
      corner: "bottom-right",
    }),
  integrations: z
    .object({
      webhook_stub: z.boolean().default(false),
    })
    .default({ webhook_stub: false }),
});
export type QuizGenSettings = z.infer<typeof QuizGenSettings>;

export const DEFAULT_GEN_SETTINGS: QuizGenSettings = QuizGenSettings.parse({});

// ---------- AI prompt steering ----------

const TONE_HINTS: Record<QuizGenSettings["tone"], string> = {
  friendly: "Warm, approachable, conversational. Like a knowledgeable friend.",
  editorial: "Polished, considered, magazine-style. Sparing punctuation.",
  playful: "Light, witty, energetic. Short sentences, occasional exclamation.",
  professional: "Precise, neutral, trustworthy. No slang.",
};

// Returns lines to append to SYSTEM_PROMPT. Empty string when nothing is
// toggled, so the prompt for the default New Quiz flow is byte-identical to
// before the wizard upgrade.
export function buildPromptAdditions(s: QuizGenSettings): string {
  const lines: string[] = [];

  // Tone is always present (defaults to "friendly").
  lines.push(`Tone: ${TONE_HINTS[s.tone]}`);

  const flowAdds: string[] = [];
  if (s.flow.welcome_message) {
    flowAdds.push(
      "After the intro, insert a `message` node that warmly welcomes the shopper in 1–2 short sentences before the first question.",
    );
  }
  if (s.flow.email_gate) {
    flowAdds.push(
      "Insert an `email_gate` node just before the result so we capture email before showing recommendations. headline: brief, subtext: explains we'll send a copy.",
    );
  }
  if (s.flow.mid_flow_preview) {
    flowAdds.push(
      "On exactly one mid-flow question (the most discriminating one), set `show_preview_after: true` so the storefront opens a refining product list once that question is answered.",
    );
  }
  if (s.flow.ask_ai_followup) {
    flowAdds.push(
      "After the result node, insert an `ask_ai` node with persona_name='Shopping assistant', a friendly opening_message that invites a follow-up question, and 2–3 suggested_questions tailored to this quiz's topic.",
    );
  }
  if (s.flow.end_screen) {
    flowAdds.push(
      "End the flow with an `end` node carrying a brand-toned thank-you headline. Wire the last visible step's edge into the end node.",
    );
  }
  if (s.flow.mixed_input_types) {
    flowAdds.push(
      "Use a mix of question_type values: include at least one `image_picker` (each answer carries an image_url placeholder URL like https://placehold.co/600x600?text=Style+A) AND at least one `searchable` or `single_select` in addition to multi-select where appropriate.",
    );
  }
  if (s.flow.use_archetype_results) {
    flowAdds.push(
      "Result pages must align with the merchant's discovered categories provided in the user message. Each result_page.headline should EXACTLY match one of the listed category names. Set each result page's match_strategy to 'archetype'. The runtime will inline the category's product list at publish time.",
    );
  }
  if (s.flow.use_points_results) {
    flowAdds.push(
      "Use points-based scoring: each answer should carry point weights toward the merchant's discovered categories (provided in the user message), and result pages should resolve via points-based matching rather than per-product tag overlap. The deterministic point weights are seeded after generation from answer/category tag overlap — focus on writing answers whose tags align with the category tags.",
    );
  }
  if (flowAdds.length > 0) {
    lines.push("");
    lines.push("Flow extensions (the merchant ticked these — honor them):");
    flowAdds.forEach((line) => lines.push(`- ${line}`));
    lines.push(
      "Every newly inserted node must be reachable via the edges array — splice them into the linear flow rather than leaving them disconnected.",
    );
  }

  return lines.length === 0 ? "" : `\n\n${lines.join("\n")}`;
}

// ---------- Deterministic post-processing ----------

// Apply the wizard settings to the generated doc *after* Claude returns.
// These are the guarantees: theme tokens land, launcher_config flips,
// integration stub gets wired. The function is defensive — if the AI
// produced a sparse doc (e.g. no result node), we skip the affected
// transforms rather than throwing.
export interface PostGenerationContext {
  // Discovered categories available for binding. When present + the
  // archetype flag is on, applyPostGeneration matches each result page's
  // headline (case-insensitive) against a category name and flips
  // match_strategy + category_id. When the points flag is on, the
  // optional `tags` are used to seed Answer.points by tag overlap.
  categories?: Array<{ id: string; name: string; tags?: string[] }>;
}

export function applyPostGeneration(
  doc: QuizDoc,
  s: QuizGenSettings,
  ctx: PostGenerationContext = {},
): QuizDoc {
  let next = doc;

  // Stamp the page-model posture onto the doc. Independent of any flow flag
  // — the picker always reflects the merchant's choice (default "custom").
  next = { ...next, result_layout_mode: s.result_layout_mode };

  if (s.theme_preset_id) {
    const preset = getPreset(s.theme_preset_id);
    if (preset) {
      // Layer preset on top of any tokens the AI/defaults set, then store
      // the resolved cascade in design_tokens. Using resolveDesignTokens
      // keeps the merge consistent with how the storefront resolves layers
      // at render time.
      const merged = resolveDesignTokens(next.design_tokens, preset.tokens);
      next = { ...next, design_tokens: merged };
    }
  }

  if (s.launcher.enabled) {
    next = {
      ...next,
      launcher_config: {
        ...next.launcher_config,
        enabled: true,
        icon: s.launcher.icon,
        corner: s.launcher.corner,
      },
    };
  }

  if (s.integrations.webhook_stub) {
    next = spliceIntegrationStub(next);
  }

  // Archetype binding: for each generated result page, find the
  // discovered category whose name matches (case-insensitive, normalized
  // whitespace). When a match is found, set match_strategy=archetype +
  // category_id. Unmatched result pages stay top_n. The publisher will
  // inline the category's product list at publish time.
  if (
    s.flow.use_archetype_results &&
    ctx.categories &&
    ctx.categories.length > 0
  ) {
    const byNormName = new Map(
      ctx.categories.map((c) => [normName(c.name), c]),
    );
    next = {
      ...next,
      results_pages: next.results_pages.map((rp) => {
        const match =
          byNormName.get(normName(rp.headline)) ??
          // Fallback: AI may have named after one of the listed
          // categories but with different casing/punctuation. Try
          // looking up by category name appearing inside the headline.
          ctx.categories!.find((c) =>
            normName(rp.headline).includes(normName(c.name)),
          );
        if (!match) return rp;
        return {
          ...rp,
          match_strategy: "archetype" as const,
          category_id: match.id,
        };
      }),
    };
  }

  // Points seeding: deterministically wire points-based scoring. For every
  // result node, set match_ladder=["points"]; for every question answer,
  // compute tag overlap against each category's tags and store the overlap
  // count as that category's point weight. Only categories with ≥1 overlap
  // are recorded, and only answers that have tags + at least one overlap
  // get a points map. Mirrors the archetype binding's category-driven shape.
  if (
    s.flow.use_points_results &&
    ctx.categories &&
    ctx.categories.length > 0
  ) {
    const seeded = seedPointsFromCategories(next.nodes, ctx.categories);
    next = {
      ...next,
      nodes: seeded.map((n) =>
        n.type === "result"
          ? { ...n, data: { ...n.data, match_ladder: ["points" as const] } }
          : n,
      ),
    };
  }

  // If the merchant asked for mid-flow product previews but the AI didn't
  // flag any question, flip the flag on the middle question as a safety
  // net. The instruction in buildPromptAdditions usually handles this —
  // this just makes the guarantee deterministic.
  if (s.flow.mid_flow_preview) {
    const questions = next.nodes
      .map((n, i) => ({ n, i }))
      .filter(({ n }) => n.type === "question");
    const alreadyFlagged = questions.some(
      ({ n }) => n.type === "question" && n.data.show_preview_after === true,
    );
    if (questions.length > 0 && !alreadyFlagged) {
      const mid = questions[Math.floor(questions.length / 2)]!;
      next = {
        ...next,
        nodes: next.nodes.map((n) => {
          if (n.id !== mid.n.id || n.type !== "question") return n;
          return { ...n, data: { ...n.data, show_preview_after: true } };
        }),
      };
    }
  }

  return next;
}

// Lowercase + collapse whitespace + strip non-letters so the archetype
// binder finds matches even when the AI altered casing or punctuation.
function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Splice an integration node onto every edge that targets the first result
// node so the webhook fires before the shopper sees their result. If there
// are no result nodes we no-op rather than fail.
function spliceIntegrationStub(doc: QuizDoc): QuizDoc {
  const firstResult = doc.nodes.find((n) => n.type === "result");
  if (!firstResult) return doc;

  // Create the integration node first; it lands at the end of nodes[].
  const withNode = addIntegrationNode(doc, null);
  const newNode = withNode.nodes[withNode.nodes.length - 1];
  if (!newNode || newNode.type !== "integration") return doc;

  // Position it visually between the result and whatever feeds it.
  newNode.position = {
    x: firstResult.position.x - 320,
    y: firstResult.position.y,
  };

  // Repoint every inbound edge of the result node to the integration, then
  // add one edge integration → result so the runtime auto-advances through.
  const rewiredEdges = withNode.edges.map((e) =>
    e.target === firstResult.id ? { ...e, target: newNode.id } : e,
  );
  const bridge = {
    id: `e_${newNode.id}_${firstResult.id}`,
    source: newNode.id,
    target: firstResult.id,
  };
  return {
    ...withNode,
    edges: [...rewiredEdges, bridge],
  };
}
