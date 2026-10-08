// What a quiz sends to Klaviyo about one shopper (ANALYTICS-HANDOFF.md, Data
// work 8 "Profile data"). Pure, so the shapes are pinned by tests.
//
// - Profile properties keep the existing `quiz_q_<id>` keys (flows already
//   read them) and ADD one readable property per answer, named with the
//   question text exactly as the merchant wrote it.
// - `quiz_result` is the result name — the same name analytics shows.
// - The "Completed Quiz" event carries the quiz id, the result, every answer
//   under its question text (as a list) and the recommended product ids:
//   "Create Klaviyo segment" filters on exactly these (klaviyoSegment.ts).
// - Consent decides the list: yes ⇒ subscribed (to the list when one is set);
//   no ⇒ left off the list; not asked ⇒ added to the list as a profile, with
//   no marketing consent recorded.

import { EVENT_PROPS } from "./klaviyoSegment";

export interface AnsweredQuestion {
  question_id: string;
  question_text: string;
  answer_texts: string[];
}

/** Klaviyo reserves some property names; a question can't overwrite them. */
const RESERVED = new Set([
  "email",
  "first_name",
  "last_name",
  "phone_number",
  "external_id",
  "organization",
  "title",
  "image",
  "location",
  EVENT_PROPS.quizId,
  EVENT_PROPS.result,
  EVENT_PROPS.products,
]);

/** The question text as a property name; empty or reserved text gets a suffix. */
export function questionPropertyName(text: string): string {
  const t = text.trim().slice(0, 200);
  if (!t) return "Quiz question";
  return RESERVED.has(t.toLowerCase()) || t.startsWith("quiz_") ? `${t} (quiz)` : t;
}

export function profileAnswerProperties(answers: AnsweredQuestion[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of answers) {
    out[`quiz_q_${a.question_id}`] = a.answer_texts.join(", ");
    out[questionPropertyName(a.question_text)] = a.answer_texts.join(", ");
  }
  return out;
}

export function eventAnswerProperties(answers: AnsweredQuestion[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const a of answers) out[questionPropertyName(a.question_text)] = a.answer_texts;
  return out;
}

export type ListAction = "subscribe" | "skip" | "add_profile";

export function listActionFor(consent: boolean | null): ListAction {
  if (consent === true) return "subscribe";
  if (consent === false) return "skip";
  return "add_profile";
}
