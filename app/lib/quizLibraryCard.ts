import { resolveDesignTokens } from "./designTokens";
import { z } from "zod";
import { QuestionType } from "./quizSchema";

// Per-card facts + bounded thumbnail data for the Quizzes library.
// Pure + defensive: reads a loosely-typed quiz doc (draftJson) WITHOUT a full
// Zod parse, so a legacy/odd doc can never throw the library loader. Facts are
// cosmetic — a missing field just falls back.

interface LooseAnswer {
  target_id?: string;
}
interface LooseNode {
  type?: string;
  data?: {
    headline?: string;
    subtext?: string;
    button_label?: string;
    answers?: LooseAnswer[];
  };
}
interface LooseDoc {
  logic_model?: string;
  nodes?: LooseNode[];
  design_tokens?: {
    colors?: { primary?: string; background?: string; text?: string };
    typography?: { body?: { family?: string }; heading?: { family?: string } };
    logo?: { url?: string };
  };
}

export interface QuizCardThumb {
  /** Bounded, read-only sample of an authored decider question. */
  question?: QuizCardQuestion;
  // §R-7 card preview: the quiz's first screen rendered in the MERCHANT's brand.
  headline: string;
  subtext: string;
  buttonLabel: string;
  logoUrl: string | null;
  bg: string;
  primary: string;
  text: string;
  font: string | null;
  /** true = nothing built yet → the neutral "New quiz · Start" fallback. */
  isNew: boolean;
}
export interface QuizCardFacts {
  questions: number;
  personas: number;
  targetIds: string[];
  thumb: QuizCardThumb;
}

const DEFAULTS = resolveDesignTokens().colors ?? {};

const previewImage = z.string().refine((url) =>
  /^https?:\/\//i.test(url) || (url.startsWith("/") && !url.startsWith("//")),
).optional().catch(undefined);
const previewQuestion = z.object({
  type: z.literal("question"),
  data: z.object({
    text: z.string().trim().min(1),
    question_type: QuestionType,
    image_url: previewImage,
    answers: z.array(z.object({
      text: z.string().trim().min(1),
      image_url: previewImage,
    }).nullable().catch(null)).catch([]),
    input_config: z.object({ placeholder: z.string().optional() }).optional().catch(undefined),
    answer_display: z.object({
      mode: z.enum(["list", "icon", "cards", "tiles", "pills"]).optional(),
      show_media: z.boolean().optional(),
    }).optional().catch(undefined),
  }),
});

export interface QuizCardQuestion {
  text: string;
  type: z.infer<typeof QuestionType>;
  imageUrl?: string;
  answers: Array<{ text: string; imageUrl?: string }>;
  remainingAnswers: number;
  placeholder?: string;
  tiles: boolean;
}

function questionSample(nodes: LooseNode[]): QuizCardQuestion | undefined {
  for (const node of nodes) {
    const parsed = previewQuestion.safeParse(node);
    if (!parsed.success) continue;
    const q = parsed.data.data;
    const answers = q.answers.filter((a) => a !== null);
    const showMedia = q.answer_display?.show_media !== false;
    return {
      text: q.text,
      type: q.question_type,
      imageUrl: q.image_url,
      answers: answers.slice(0, 3).map((a) => ({ text: a.text, imageUrl: showMedia ? a.image_url : undefined })),
      remainingAnswers: Math.max(0, answers.length - 3),
      placeholder: q.input_config?.placeholder,
      tiles: showMedia && answers.some((a) => a.image_url) &&
        (q.answer_display?.mode === "tiles" || q.answer_display?.mode === "cards" ||
          (!q.answer_display?.mode && ["image_tile", "image_picker", "swatch"].includes(q.question_type))),
    };
  }
}

export function quizCardFacts(doc: unknown): QuizCardFacts {
  const d = (doc && typeof doc === "object" ? doc : {}) as LooseDoc;
  const nodes = Array.isArray(d.nodes) ? d.nodes : [];

  const questions = nodes.filter((n) => n?.type === "question").length;

  // Personas = distinct outcome targets an answer maps to (target_id). If the
  // doc has none yet (results bake at publish), fall back to result-node count.
  const targets = new Set<string>();
  let resultNodes = 0;
  for (const n of nodes) {
    if (n?.type === "result") resultNodes += 1;
    const answers = n?.data?.answers;
    if (Array.isArray(answers)) {
      for (const a of answers) if (a?.target_id) targets.add(a.target_id);
    }
  }
  const personas = targets.size > 0 ? targets.size : resultNodes;

  const intro = nodes.find((n) => n?.type === "intro");
  const c = d.design_tokens?.colors ?? {};
  const headline = intro?.data?.headline?.trim() || "";
  // A first screen that's still the default "New quiz" (or empty) with no brand
  // color set → the neutral placeholder, not a fake brand render.
  const isNew = (!headline || /^new quiz$/i.test(headline)) && !c.primary;
  const question = d.logic_model === "decider" ? questionSample(nodes) : undefined;
  return {
    questions,
    personas,
    targetIds: [...targets],
    thumb: {
      ...(question ? { question } : {}),
      headline: question?.text || headline || "New quiz",
      subtext: intro?.data?.subtext?.trim() || "",
      buttonLabel: intro?.data?.button_label?.trim() || "Start",
      logoUrl: d.design_tokens?.logo?.url ?? null,
      bg: c.background || DEFAULTS.background || "rgb(255,255,255)",
      primary: c.primary || DEFAULTS.primary || "rgb(109,90,230)",
      text: c.text || DEFAULTS.text || "rgb(26,26,26)",
      font: d.design_tokens?.typography?.heading?.family || d.design_tokens?.typography?.body?.family || null,
      isNew: question ? false : isNew,
    },
  };
}
