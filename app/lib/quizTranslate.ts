import type { z } from "zod";
import type { Quiz } from "./quizSchema";
import { CHROME_TOKENS } from "../components/runtime/chromeStrings";

// ════════════════════════════════════════════════════════════════════════════
// Phase K — pure translation engine. Three jobs, no IO:
//
//   extractTranslatableStrings(doc)  → the canonical [{key, text}] list of
//     every shopper-visible string, over a STABLE key grammar (below). Fed to
//     the AI for translation and hashed for staleness detection.
//   applyTranslations(doc, strings)  → a new doc with translated copy swapped
//     in wherever a key exists; everything else (ids, edges, tags, routing,
//     design) untouched by construction. Missing keys fall back to English
//     PER-STRING. Translations that LOST a merge tag present in the source
//     are skipped (warn-level safety — a broken @answer.<id> would render
//     literally).
//   sourceHashOf(extracted)          → a deterministic fingerprint of the
//     English copy so the editor can flag stale locales after edits.
//
// Key grammar (flat, collision-safe):
//   node.<nodeId>.<field>                    single text fields per node type
//   answer.<nodeId>.<answerId>.<field>      text | tooltip_text
//   stage.<stageId>.<field>                  headline | subtext
//   bullets.<ownerId>.<index>                why_bullets (owner = node or stage)
//   suggested.<nodeId>.<index>               ask_ai quick replies
//   placeholder.<nodeId>                     freeform input placeholder
//   block.<nodeId>.<blockId>.<field>        UNBOUND literal layout blocks
//   chrome.<token>                           runtime interface strings
//   launcher.label                           floating launcher label
//
// NOT extracted: branch/integration labels (invisible nodes), ask_ai
// system_prompt (merchant instructions), legacy results_pages copy (nothing
// renders it), bound blocks (they read node data → translated via node keys).
// ════════════════════════════════════════════════════════════════════════════

type QuizDoc = z.infer<typeof Quiz>;

export interface TranslatableString {
  key: string;
  text: string;
}

// Per-node-type single text fields (mirrors the runtime's render surface).
const NODE_TEXT_FIELDS: Record<string, readonly string[]> = {
  intro: ["headline", "subtext", "button_label"],
  question: ["text", "education_card_before"],
  email_gate: ["headline", "subtext"],
  result: ["headline", "subtext", "cta_label"],
  message: ["text"],
  end: ["headline", "subtext", "cta_label"],
  ask_ai: ["persona_name", "opening_message", "continue_label"],
  product_cards: ["headline", "subtext", "cta_label", "continue_label"],
};

function push(out: TranslatableString[], key: string, text: unknown): void {
  if (typeof text === "string" && text.trim().length > 0) out.push({ key, text });
}

export function extractTranslatableStrings(doc: QuizDoc): TranslatableString[] {
  const out: TranslatableString[] = [];

  for (const node of doc.nodes) {
    const fields = NODE_TEXT_FIELDS[node.type];
    if (fields) {
      const d = node.data as Record<string, unknown>;
      for (const f of fields) push(out, `node.${node.id}.${f}`, d[f]);
    }
    if (node.type === "question") {
      for (const a of node.data.answers) {
        push(out, `answer.${node.id}.${a.id}.text`, a.text);
        push(out, `answer.${node.id}.${a.id}.tooltip_text`, a.tooltip_text);
      }
      push(out, `placeholder.${node.id}`, node.data.input_config?.placeholder);
    }
    if (node.type === "result") {
      node.data.why_bullets.forEach((b, i) => push(out, `bullets.${node.id}.${i}`, b));
      for (const stage of node.data.stages) {
        push(out, `stage.${stage.id}.headline`, stage.headline);
        push(out, `stage.${stage.id}.subtext`, stage.subtext);
        stage.why_bullets.forEach((b, i) => push(out, `bullets.${stage.id}.${i}`, b));
      }
    }
    if (node.type === "ask_ai") {
      node.data.suggested_questions.forEach((q, i) =>
        push(out, `suggested.${node.id}.${i}`, q),
      );
    }
  }

  // Unbound literal layout blocks render their own copy.
  for (const [nodeId, blocks] of Object.entries(doc.node_layouts)) {
    for (const b of blocks) {
      if ((b.type === "heading" || b.type === "text") && b.bind === "none") {
        push(out, `block.${nodeId}.${b.id}.text`, b.text);
      }
      if (b.type === "button" && b.bind === "none") {
        push(out, `block.${nodeId}.${b.id}.label`, b.label);
      }
      if (b.type === "image") {
        push(out, `block.${nodeId}.${b.id}.alt`, b.alt);
      }
    }
  }

  push(out, "launcher.label", (doc.launcher_config as { label?: unknown })?.label);

  // The runtime's interface strings — translated alongside the doc so a
  // locale's map is complete from its first generation.
  for (const [token, english] of Object.entries(CHROME_TOKENS)) {
    out.push({ key: `chrome.${token}`, text: english });
  }

  return out;
}

// The same @tag pattern resolveMergeTags substitutes at render time.
const MERGE_TAG = /@[a-zA-Z0-9_.]+/g;
export function mergeTagsOf(text: string): string[] {
  return text.match(MERGE_TAG) ?? [];
}

/** Every merge tag in the source must survive into the translation. */
function tagsSurvive(source: string, translated: string): boolean {
  return mergeTagsOf(source).every((tag) => translated.includes(tag));
}

export function applyTranslations(
  doc: QuizDoc,
  strings: Record<string, string>,
): QuizDoc {
  // Resolve a key against the source text; drop translations that broke tags.
  const pick = (key: string, source: unknown): string | undefined => {
    const tr = strings[key];
    if (typeof tr !== "string" || !tr.trim()) return undefined;
    if (typeof source === "string" && !tagsSurvive(source, tr)) return undefined;
    return tr;
  };

  const nodes = doc.nodes.map((node) => {
    const fields = NODE_TEXT_FIELDS[node.type];
    let data = node.data as Record<string, unknown>;
    let changed = false;
    if (fields) {
      for (const f of fields) {
        const tr = pick(`node.${node.id}.${f}`, data[f]);
        if (tr !== undefined) {
          data = { ...data, [f]: tr };
          changed = true;
        }
      }
    }
    if (node.type === "question") {
      const answers = node.data.answers.map((a) => {
        const text = pick(`answer.${node.id}.${a.id}.text`, a.text);
        const tip = pick(`answer.${node.id}.${a.id}.tooltip_text`, a.tooltip_text);
        return text !== undefined || tip !== undefined
          ? { ...a, ...(text !== undefined ? { text } : {}), ...(tip !== undefined ? { tooltip_text: tip } : {}) }
          : a;
      });
      if (answers.some((a, i) => a !== node.data.answers[i])) {
        data = { ...data, answers };
        changed = true;
      }
      const ph = pick(`placeholder.${node.id}`, node.data.input_config?.placeholder);
      if (ph !== undefined && node.data.input_config) {
        data = { ...data, input_config: { ...node.data.input_config, placeholder: ph } };
        changed = true;
      }
    }
    if (node.type === "result") {
      const bullets = node.data.why_bullets.map(
        (b, i) => pick(`bullets.${node.id}.${i}`, b) ?? b,
      );
      const stages = node.data.stages.map((s) => ({
        ...s,
        headline: pick(`stage.${s.id}.headline`, s.headline) ?? s.headline,
        subtext: pick(`stage.${s.id}.subtext`, s.subtext) ?? s.subtext,
        why_bullets: s.why_bullets.map((b, i) => pick(`bullets.${s.id}.${i}`, b) ?? b),
      }));
      data = { ...data, why_bullets: bullets, stages };
      changed = true;
    }
    if (node.type === "ask_ai") {
      const sq = node.data.suggested_questions.map(
        (q, i) => pick(`suggested.${node.id}.${i}`, q) ?? q,
      );
      data = { ...data, suggested_questions: sq };
      changed = true;
    }
    return changed ? ({ ...node, data } as typeof node) : node;
  });

  const node_layouts = Object.fromEntries(
    Object.entries(doc.node_layouts).map(([nodeId, blocks]) => [
      nodeId,
      blocks.map((b) => {
        if ((b.type === "heading" || b.type === "text") && b.bind === "none") {
          const tr = pick(`block.${nodeId}.${b.id}.text`, b.text);
          if (tr !== undefined) return { ...b, text: tr };
        }
        if (b.type === "button" && b.bind === "none") {
          const tr = pick(`block.${nodeId}.${b.id}.label`, b.label);
          if (tr !== undefined) return { ...b, label: tr };
        }
        if (b.type === "image") {
          const tr = pick(`block.${nodeId}.${b.id}.alt`, b.alt);
          if (tr !== undefined) return { ...b, alt: tr };
        }
        return b;
      }),
    ]),
  );

  const launcherLabel = pick(
    "launcher.label",
    (doc.launcher_config as { label?: unknown })?.label,
  );

  return {
    ...doc,
    nodes,
    node_layouts,
    ...(launcherLabel !== undefined
      ? { launcher_config: { ...doc.launcher_config, label: launcherLabel } }
      : {}),
  };
}

/**
 * Deterministic fingerprint of the extracted English copy (FNV-1a over the
 * sorted key=text pairs). Non-cryptographic — it's a change detector, not a
 * security boundary.
 */
export function sourceHashOf(extracted: TranslatableString[]): string {
  const canonical = [...extracted]
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((s) => `${s.key}=${s.text}`)
    .join(" ");
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Locale resolution: exact (case-insensitive) → language prefix → null. */
export function resolveLocale(
  requested: string | null,
  available: string[],
): string | null {
  if (!requested) return null;
  const want = requested.toLowerCase();
  const exact = available.find((l) => l.toLowerCase() === want);
  if (exact) return exact;
  const lang = want.split("-")[0]!;
  return available.find((l) => l.toLowerCase().split("-")[0] === lang) ?? null;
}

export const LOCALE_RE = /^[a-z]{2}(-[a-z]{2,4})?$/i;

/**
 * Validate a raw `?locale=` query value at the public boundary before it reaches
 * resolveLocale. The incoming value is a full BCP-47 storefront tag — Shopify's
 * `request.locale.iso_code`, fed straight in by the theme extension — which can
 * carry MULTIPLE subtags (fr · pt-BR · zh-Hant-TW · es-419 · sr-Latn-RS), and
 * resolveLocale's language-prefix fallback is specifically built to narrow such
 * a tag down to a stored 2-subtag key. So this gate must accept ANY well-formed
 * tag (any number of subtags) and reject only characters no locale tag can
 * contain (injection / path / quote / space) plus a length cap. BYTE-STABLE:
 * every value resolveLocale could resolve still passes through unchanged; only
 * true garbage — which resolveLocale already maps to base — is short-circuited.
 * NB: deliberately BROADER than LOCALE_RE — LOCALE_RE governs the STORED key
 * (kept strict, 2-subtag); this governs the INCOMING request param, multi-subtag
 * by design. (HII-6; widened after an adversarial review caught zh-Hant-TW.)
 */
const REQUEST_LOCALE_RE = /^[a-z]{2,3}(-[a-z0-9]{1,8})*$/i;
export function parseLocaleParam(requested: string | null): string | null {
  return requested && requested.length <= 35 && REQUEST_LOCALE_RE.test(requested)
    ? requested
    : null;
}
