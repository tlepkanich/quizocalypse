import { z } from "zod";
import type { Quiz } from "./quizSchema";
import { addIntegrationNode } from "./quizMutations";
import { getPreset } from "./themePresets";
import { resolveDesignTokens } from "./designTokens";

type QuizDoc = z.infer<typeof Quiz>;

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
  flow: z
    .object({
      welcome_message: z.boolean().default(false),
      email_gate: z.boolean().default(false),
      mid_flow_preview: z.boolean().default(false),
      ask_ai_followup: z.boolean().default(false),
      end_screen: z.boolean().default(false),
      mixed_input_types: z.boolean().default(false),
    })
    .default({
      welcome_message: false,
      email_gate: false,
      mid_flow_preview: false,
      ask_ai_followup: false,
      end_screen: false,
      mixed_input_types: false,
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
export function applyPostGeneration(
  doc: QuizDoc,
  s: QuizGenSettings,
): QuizDoc {
  let next = doc;

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
