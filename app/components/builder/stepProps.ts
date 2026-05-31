import type { Quiz as QuizDoc } from "../../lib/quizSchema";
import type { IndexedProduct } from "../../lib/recommendationEngine";
import type { NodeIssue } from "../../lib/quizValidation";
import type { OrderedFlow } from "../../lib/flowOrder";

// Shared prop contract every step screen of the 5-step guided builder consumes.
// The shell (BuilderShell in app.quizzes.$id.studio.tsx) owns the doc + autosave
// and passes this down; steps mutate via onCommit.

export interface BuilderCollection {
  collectionId: string;
  title: string;
}

// Lean, client-safe bucket shape (a quiz-scoped Category row) from the loader.
export interface BuilderCategory {
  id: string;
  name: string;
  description: string;
  tags: string[];
  productIds: string[];
  source: string;
  sourceRef: string | null;
  quizId: string | null;
}

export interface StepProps {
  quizId: string;
  doc: QuizDoc;
  onCommit: (doc: QuizDoc) => void;
  productIndex: IndexedProduct[];
  collections: BuilderCollection[];
  categories: BuilderCategory[];
  fallbackCollection: string;
  allIssues: NodeIssue[];
  issuesByNode: Map<string, NodeIssue[]>;
  ordered: OrderedFlow;
  previewUrl: string;
  goToStep: (n: number) => void;
}
