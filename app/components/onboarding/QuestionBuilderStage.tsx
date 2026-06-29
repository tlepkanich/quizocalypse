import type { useFetcher } from "@remix-run/react";
import type { Quiz } from "../../lib/quizSchema";
import type { IndexedProduct } from "../../lib/recommendationEngine";
import type { BuilderCategory, BuilderCollection } from "../builder/stepProps";
import { useQuizDraft } from "../studio/useQuizDraft";
import { QuestionsLogicLayout } from "./questionsLogic/QuestionsLogicLayout";

// ════════════════════════════════════════════════════════════════════════════
// QuestionBuilderStage — Step 3 of the create funnel ("Questions & Logic"). The
// quiz is ALREADY built (the early question build ran right after Shape), so this
// is the editing surface. Rebuilt to the v1.0 dev-handoff (Drive
// "questions-logic-dev-handoff"): a two-panel page (260px left list + a scrolling
// column of question cards) with INLINE per-answer bucket mapping + skip-to,
// replacing the older 3-panel FlowRail | preview | ContextPanel composition. This
// shell owns useQuizDraft (JSON-PUT autosave, which lands on the funnel route's
// autosave branch and persists DOC CONTENT only — the stage is owned by the nav
// intents, so a debounced save can't rewind the step) + the Back/Continue
// navigation; the layout below is server-free. Client-only (ClientOnly-wrapped by
// the caller) — the editor uses IntersectionObserver + window APIs.
// ════════════════════════════════════════════════════════════════════════════

export function QuestionBuilderStage({
  quizId,
  initialDoc,
  categories,
  fetcher,
  pendingIntent,
}: {
  quizId: string;
  initialDoc: Quiz;
  categories: BuilderCategory[];
  productIndex: IndexedProduct[];
  collections: BuilderCollection[];
  fetcher: ReturnType<typeof useFetcher>;
  pendingIntent: string | null;
}) {
  const { doc, commit, isSaving, savedAt } = useQuizDraft(initialDoc);
  const navigating =
    pendingIntent === "to-rec-page" || pendingIntent === "back-to-types";

  return (
    <QuestionsLogicLayout
      doc={doc}
      onCommit={commit}
      isSaving={isSaving}
      savedAt={savedAt}
      categories={categories}
      quizId={quizId}
      navigating={navigating}
      onBack={() => fetcher.submit({ intent: "back-to-types" }, { method: "post" })}
      onContinue={() => fetcher.submit({ intent: "to-rec-page" }, { method: "post" })}
    />
  );
}
