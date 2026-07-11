import { resolveDesignTokens } from "./designTokens";

// §R-7 — the per-card facts + screen-1 thumbnail data for the Quizzes library.
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
  nodes?: LooseNode[];
  design_tokens?: {
    colors?: { primary?: string; background?: string; text?: string };
    typography?: { body?: { family?: string }; heading?: { family?: string } };
    logo?: { url?: string };
  };
}

export interface QuizCardThumb {
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
  return {
    questions,
    personas,
    targetIds: [...targets],
    thumb: {
      headline: headline || "New quiz",
      subtext: intro?.data?.subtext?.trim() || "",
      buttonLabel: intro?.data?.button_label?.trim() || "Start",
      logoUrl: d.design_tokens?.logo?.url ?? null,
      bg: c.background || DEFAULTS.background || "rgb(255,255,255)",
      primary: c.primary || DEFAULTS.primary || "rgb(109,90,230)",
      text: c.text || DEFAULTS.text || "rgb(26,26,26)",
      font: d.design_tokens?.typography?.heading?.family || d.design_tokens?.typography?.body?.family || null,
      isNew,
    },
  };
}
