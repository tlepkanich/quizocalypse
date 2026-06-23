import type { DesignDials, DesignTokens } from "./quizSchema";

// ════════════════════════════════════════════════════════════════════════════
// Step 2 — pure translation of the merchant's battle-card design DIALS into
// concrete build inputs: a DesignTokens patch (applied to the seed) + a prompt
// directive string (appended to the generation goalContext, exactly like
// directionAngle/sampleQuestionSeeds). `lines` is a direct token map; imagery /
// word_forward / graphics steer generation + a couple of layout tokens. No IO /
// AI — fully unit-testable.
// ════════════════════════════════════════════════════════════════════════════

// soft = pill (fully rounded), sharp = square edges, rounded = the middle ground.
const LINES_TO_RADIUS: Record<DesignDials["lines"], NonNullable<DesignTokens["radius"]>> = {
  soft: "pill",
  sharp: "square",
  rounded: "rounded",
};

export function dialsToBuildDirectives(dials: DesignDials): {
  tokenPatch: Partial<DesignTokens>;
  promptDirectives: string;
} {
  const tokenPatch: Partial<DesignTokens> = { radius: LINES_TO_RADIUS[dials.lines] };
  const lines: string[] = [];

  // Imagery → image-question / answer-image / hero frequency.
  if (dials.imagery === "high") {
    lines.push(
      "IMAGERY HIGH: lean on visual questions — prefer image_tile / image_picker / swatch where products are visual; recommend an answer image_url on most answers; product imagery is central.",
    );
  } else if (dials.imagery === "low") {
    lines.push(
      "IMAGERY LOW: text-forward — prefer single_select / multi_select; avoid image_tile / image_picker; do not require answer images.",
    );
  } else {
    lines.push("IMAGERY MEDIUM: mix text-primary questions with image support where it genuinely helps.");
  }

  // Word-Forward → education cards + helper_text + copy length.
  if (dials.word_forward === "high") {
    lines.push(
      "WORD-FORWARD HIGH: educational tone — add education_card_before on 2-3 questions, write reassuring helper_text under most questions, and explanatory (not terse) question copy.",
    );
  } else if (dials.word_forward === "low") {
    lines.push(
      "WORD-FORWARD LOW: minimal copy — no education_card_before, no helper_text, keep every question under ~12 words.",
    );
  } else {
    lines.push(
      "WORD-FORWARD MEDIUM: at most one education_card_before; helper_text only where shoppers might overthink.",
    );
  }

  // Graphics → section chapters + answer icons + spacing token.
  if (dials.graphics === "high") {
    lines.push(
      "GRAPHICS HIGH: group questions into chapters via section_label and add a fitting emoji icon to answers; spacious, decorated layout.",
    );
    tokenPatch.spacing = "spacious";
  } else if (dials.graphics === "low") {
    lines.push("GRAPHICS LOW: no section_label chapters, no answer icons; compact, unadorned layout.");
    tokenPatch.spacing = "compact";
  } else {
    lines.push("GRAPHICS MEDIUM: chapters and icons only where they aid comprehension.");
  }

  return {
    tokenPatch,
    promptDirectives: `Design direction (honor where natural):\n${lines.map((l) => `- ${l}`).join("\n")}`,
  };
}

// "Skin Routine" + 2026-06-11 → "Skin Routine 6/11/26". `now` is passed in (pure
// — no Date.now() / new Date(), so it stays workflow- and test-safe).
export function autoQuizName(label: string, now: Date): string {
  const clean = label.trim() || "New quiz";
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const yy = String(now.getFullYear()).slice(2);
  return `${clean} ${month}/${day}/${yy}`;
}

// The inverse of autoQuizName for shopper-facing copy: strip a trailing
// " M/D/YY" auto-name date so the intro headline reads clean ("Skin Routine")
// while the merchant's quiz NAME keeps the dated disambiguator. Idempotent on a
// name with no suffix. Kept next to autoQuizName so the pattern can't drift from
// the format that produces it.
export function stripAutoQuizDate(name: string): string {
  return name.replace(/\s+\d{1,2}\/\d{1,2}\/\d{2,4}$/, "").trim();
}
