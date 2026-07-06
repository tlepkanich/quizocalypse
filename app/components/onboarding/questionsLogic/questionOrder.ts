// BIC-2 C5 — relocated to app/lib/questionOrder.ts (shared by the legacy
// Questions & Logic surface, questionsLogicV3, the builder, and ruleSummary).
// This shim exists only for the legacy-folder importers, so the folder stays
// self-contained and deletable the day legacy docs die.
export * from "../../../lib/questionOrder";
