// Question Bank — a curated, static library of pre-built quiz questions the
// merchant can drop into a quiz (Question-Builder spec §Question Bank). No AI:
// just a vetted dataset grouped by industry, with "Universal" entries that suit
// any store. Adding one appends it to the quiz with default answer options the
// merchant then edits + maps. Keep entries short (≤150-char text, ≤60-char answers
// — appendBankQuestion clamps anyway).

export type BankQuestionType = "single_select" | "multi_select" | "rating";

export interface BankQuestion {
  id: string;
  category: string;
  text: string;
  question_type: BankQuestionType;
  answers: string[];
}

export const QUESTION_BANK: BankQuestion[] = [
  // ── Beauty / Skincare ──────────────────────────────────────────────
  {
    id: "skin-type",
    category: "Beauty & Skincare",
    text: "How would you describe your skin type?",
    question_type: "single_select",
    answers: ["Oily", "Dry", "Combination", "Sensitive", "Normal"],
  },
  {
    id: "skin-concerns",
    category: "Beauty & Skincare",
    text: "What are your top skin concerns?",
    question_type: "multi_select",
    answers: ["Acne & breakouts", "Fine lines", "Dullness", "Dark spots", "Redness", "Dryness"],
  },
  {
    id: "routine-depth",
    category: "Beauty & Skincare",
    text: "How involved is your ideal routine?",
    question_type: "single_select",
    answers: ["Keep it to 1–2 steps", "A balanced 3–4 steps", "I love a full ritual"],
  },
  {
    id: "fragrance-pref",
    category: "Beauty & Skincare",
    text: "How do you feel about fragrance in your products?",
    question_type: "single_select",
    answers: ["Love a scent", "Prefer subtle", "Fragrance-free only"],
  },

  // ── Apparel / Fashion ──────────────────────────────────────────────
  {
    id: "style-vibe",
    category: "Apparel & Fashion",
    text: "Which best describes your style?",
    question_type: "single_select",
    answers: ["Classic & timeless", "Trend-forward", "Minimal & clean", "Bold & statement"],
  },
  {
    id: "fit-pref",
    category: "Apparel & Fashion",
    text: "How do you like your fit?",
    question_type: "single_select",
    answers: ["Fitted", "Relaxed", "Oversized", "Depends on the piece"],
  },
  {
    id: "shopping-for",
    category: "Apparel & Fashion",
    text: "What are you shopping for today?",
    question_type: "multi_select",
    answers: ["Everyday basics", "A special occasion", "Workwear", "Active & outdoor", "Just browsing"],
  },

  // ── Supplements / Wellness ─────────────────────────────────────────
  {
    id: "wellness-goal",
    category: "Supplements & Wellness",
    text: "What's your primary wellness goal?",
    question_type: "single_select",
    answers: ["More energy", "Better sleep", "Immunity", "Focus", "Fitness & recovery"],
  },
  {
    id: "activity-level",
    category: "Supplements & Wellness",
    text: "How active are you in a typical week?",
    question_type: "single_select",
    answers: ["Mostly sedentary", "Lightly active", "Active 3–4× / week", "Very active / athlete"],
  },
  {
    id: "diet-pref",
    category: "Supplements & Wellness",
    text: "Any dietary preferences we should know?",
    question_type: "multi_select",
    answers: ["Vegan", "Vegetarian", "Gluten-free", "Dairy-free", "No restrictions"],
  },

  // ── Food & Beverage ────────────────────────────────────────────────
  {
    id: "flavor-pref",
    category: "Food & Beverage",
    text: "Which flavors do you gravitate toward?",
    question_type: "multi_select",
    answers: ["Sweet", "Savory", "Spicy", "Bitter", "Sour & tangy"],
  },
  {
    id: "occasion",
    category: "Food & Beverage",
    text: "When will you enjoy this most?",
    question_type: "single_select",
    answers: ["Morning ritual", "Afternoon pick-me-up", "Evening wind-down", "Special occasions"],
  },

  // ── Home & Lifestyle ───────────────────────────────────────────────
  {
    id: "home-style",
    category: "Home & Lifestyle",
    text: "What's your home aesthetic?",
    question_type: "single_select",
    answers: ["Modern & minimal", "Warm & cozy", "Eclectic & collected", "Natural & organic"],
  },
  {
    id: "room-focus",
    category: "Home & Lifestyle",
    text: "Which space are you focused on?",
    question_type: "single_select",
    answers: ["Living room", "Bedroom", "Kitchen & dining", "Bath", "Workspace"],
  },

  // ── Universal (suit any store) ─────────────────────────────────────
  {
    id: "budget",
    category: "Universal",
    text: "What's your budget comfort zone?",
    question_type: "single_select",
    answers: ["Best value", "Mid-range", "Premium", "Price isn't a factor"],
  },
  {
    id: "shopping-for-who",
    category: "Universal",
    text: "Who are you shopping for?",
    question_type: "single_select",
    answers: ["Myself", "A gift", "My household", "My business"],
  },
  {
    id: "priority",
    category: "Universal",
    text: "What matters most to you in a product?",
    question_type: "multi_select",
    answers: ["Quality & durability", "Sustainability", "Value for money", "Brand & design", "Fast shipping"],
  },
  {
    id: "experience-level",
    category: "Universal",
    text: "How familiar are you with this category?",
    question_type: "single_select",
    answers: ["Total beginner", "Some experience", "I know what I want"],
  },
  {
    id: "confidence",
    category: "Universal",
    text: "How confident are you in your choice right now?",
    question_type: "rating",
    answers: ["1", "2", "3", "4", "5"],
  },
];

// The distinct categories, in a sensible display order. "Universal" sinks to the
// bottom; an optional `priorityCategory` (e.g. from brand identity) floats to top.
export function bankCategories(priorityCategory?: string): string[] {
  const all = [...new Set(QUESTION_BANK.map((q) => q.category))];
  const universalLast = all.sort((a, b) =>
    a === "Universal" ? 1 : b === "Universal" ? -1 : 0,
  );
  if (priorityCategory && universalLast.includes(priorityCategory)) {
    return [priorityCategory, ...universalLast.filter((c) => c !== priorityCategory)];
  }
  return universalLast;
}

// Filter the bank by a free-text query (matches text or category) + an optional
// type filter. Pure — drives the drawer's search box.
export function filterBank(query: string, type: BankQuestionType | "all"): BankQuestion[] {
  const q = query.trim().toLowerCase();
  return QUESTION_BANK.filter((entry) => {
    if (type !== "all" && entry.question_type !== type) return false;
    if (!q) return true;
    return (
      entry.text.toLowerCase().includes(q) ||
      entry.category.toLowerCase().includes(q) ||
      entry.answers.some((a) => a.toLowerCase().includes(q))
    );
  });
}
