// ════════════════════════════════════════════════════════════════════════════
// Phase K — the runtime's CHROME strings: every hardcoded shopper-visible
// interface string, as a token table. English is the source of truth here;
// translations store `chrome.<token>` keys in the quiz's locale map, and the
// runtime resolves through ChromeContext (K2) with these defaults — so a
// missed call site or missing translation always falls back to today's copy.
//
// `{n}`-style placeholders are substituted by t() AFTER lookup, so translated
// templates keep their parameter slots.
// ════════════════════════════════════════════════════════════════════════════

import { createContext, useContext } from "react";

export const CHROME_TOKENS = {
  continue: "Continue",
  start_over: "Start over",
  add_to_cart: "Add to cart",
  shop_now: "Shop now",
  out_of_stock: "Out of stock",
  you_might_also_like: "You might also like",
  hero_badge: "Best quiz match",
  email_capture_heading: "Want your results emailed to you?",
  email_capture_button: "Email me",
  email_capture_sending: "Sending…",
  email_capture_thanks: "✓ Thanks — we'll email your results.",
  email_placeholder: "you@example.com",
  save_results_link: "🔖 Save my results — view them anytime, on any device",
  share_results: "↗ Share my results",
  copied: "Copied ✓",
  skip: "Skip",
  send: "Send",
  choose: "Choose…",
  search_placeholder: "Search…",
  gate_email_placeholder: "Email",
  gate_name_placeholder: "First name (optional)",
  gate_phone_placeholder: "Phone (optional)",
  chat_placeholder: "Type a question…",
  chat_ended: "Chat ended",
  chat_preview_stub: "This is a preview — the AI assistant replies for real in your published quiz.",
  saving: "Saving…",
  sending_answers: "One moment — sending your answers along.",
  something_went_wrong: "Something went wrong",
  network_error: "Network error.",
  integration_failed: "Integration failed.",
  continue_anyway: "Continue anyway",
  pick_more_answers: "Pick more answers to see refined picks.",
  no_products_configured: "None of the configured products are available right now.",
  no_results_match: "We couldn't find a perfect match for your answers. Try retaking the quiz with different choices.",
  quiz_unavailable: "Quiz unavailable",
  quiz_no_nodes: "This quiz has no nodes defined.",
  lost_the_thread: "Lost the thread",
  unknown_node: "Reached an unknown node — the quiz may have a missing edge.",
  your_results: "Your results",
  // Aria-only (still localized — screen readers speak them).
  aria_quiz_progress: "Quiz progress",
  aria_go_back_to: "Go back to question {n}: {label}",
  aria_more_info: "More info",
  aria_choose_variant: "Choose a variant",
  // Launcher (served via the script route, resolved from the same map).
  launcher_open: "Open quiz",
  launcher_close: "Close quiz",
  // My Results page (server-rendered; added at K2 — locales generated before
  // this fall back to English here until regenerated).
  saved_results: "Your saved results",
  saved_results_from: "Your saved results from {date}",
  results_gone: "Your results are no longer available.",
  take_again: "Take the quiz again →",
  // Experiences E4 — recap + reveal + match reasons.
  recap_heading: "Just making sure we're on the right track",
  recap_subtext: "Here's what you told us — tap any answer to change it.",
  recap_confirm: "Looks good →",
  recap_edit: "Change",
  reveal_weighing: "Weighing your answers…",
  reveal_factors: "What's counting: {factors}",
  reveal_matching: "Matching against {n} products…",
  because_you_chose: "Because you chose:",
  add_routine: "Add the full routine ({n} items)",
  // Buddy mode (Phase L2).
  invite_friend: "🤝 Compare with a friend",
  invite_copied: "Link copied — send it to a friend ✓",
  see_comparison: "See how you compare →",
  // MQ — minimal "Quizell" chrome: explicit Back/Next nav + the question counter.
  back: "Back",
  next: "Next",
  question_counter: "Question # {n}",
  // Rec-Page spec §2/§6.
  only_x_left: "Only {count} left in stock",
  your_answers: "Your answers",
  retake_quiz: "Not what you were looking for? Retake the quiz",
  share_results_cta: "↗ Share my results",
  share_copied: "Copied ✓",
  free_shipping: "Free shipping",
  notify_me: "Notify me",
  notify_done: "You're on the list — we'll email you when it's back.",
  notify_email_placeholder: "Email me when available",
  notify_section_prompt:
    "These picks are currently out of stock. Notify me when they're back.",
  // LOGIC v2 (L2-9) — the decider capture→loading→reveal flow. New tokens fall
  // back per-string to this English until a locale is regenerated (K1 contract).
  capture_headline: "Your results are ready",
  capture_subtext: "Enter your email and we'll reveal your personalized match.",
  decider_hero_badge: "⭐ Our top pick for you",
  decider_fallback_heading:
    "We couldn't find an exact match — here are our most-loved products.",
  all_out_of_stock: "These picks are temporarily out of stock — check back soon.",
  incentive_code_auto: "🎁 Code {code} — applied automatically at checkout",
  incentive_code_manual: "🎁 Use code {code} at checkout",
  // QZY-5 (results-step4 §2.3) — the bulk-add bar under the reveal grid.
  add_all_to_cart: "Add all {count} to cart · {total}",
} as const;

export type ChromeToken = keyof typeof CHROME_TOKENS;

/** The full chrome table for a locale: translated where available, English otherwise. */
export function chromeFor(
  strings?: Record<string, string> | null,
): Record<ChromeToken, string> {
  const out = { ...CHROME_TOKENS } as Record<ChromeToken, string>;
  if (strings) {
    for (const token of Object.keys(CHROME_TOKENS) as ChromeToken[]) {
      const v = strings[`chrome.${token}`];
      if (typeof v === "string" && v.trim()) out[token] = v;
    }
  }
  return out;
}

/** Lookup + `{n}` substitution. */
export function t(
  table: Record<ChromeToken, string>,
  token: ChromeToken,
  vars?: Record<string, string | number>,
): string {
  let s = table[token] ?? CHROME_TOKENS[token];
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  }
  return s;
}

// K2 — the runtime consumes the table via context (the RuntimePreviewContext
// precedent: one provider at the root beats threading a prop through every
// sub-component). Default = the English table, so a component rendered
// outside the provider — or a missing translation — shows today's copy.
export const ChromeContext = createContext<Record<ChromeToken, string>>(CHROME_TOKENS);

/** `const tc = useChrome();` → `tc("continue")`, `tc("aria_go_back_to", {n: 2, label})`. */
export function useChrome(): (token: ChromeToken, vars?: Record<string, string | number>) => string {
  const table = useContext(ChromeContext);
  return (token, vars) => t(table, token, vars);
}
