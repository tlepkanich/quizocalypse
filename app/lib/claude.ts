// All Claude/Anthropic AI surfaces — BIC-2 C3c split the implementation into
// per-concern modules under ./ai/ (client / generation / editing / enrichment
// / askAi / translate); this file is the stable re-export barrel so the ~16
// importers (and the prompt-stability + byte-pin tests) keep their paths.
//
// ISOMORPHIC GRAPH — this barrel and every ./ai/* module stay free of prisma
// and node builtins (an async_hooks import here fails the client build); the
// A3 usage-recording seam works by aiBudget.server.ts installing its emitter
// through setAiUsageEmitter below.
//
// Model choices are code constants in ./ai/client.ts (MODEL / MODEL_FAST /
// MODEL_SPEED) and deliberately NOT re-exported — the Haiku middle passes are
// owner-approved (FAST F4); change them there, with a side-by-side.
export {
  QuizGenerationError,
  setAiUsageEmitter,
  type AiUsageEmitter,
} from "./ai/client";
export * from "./ai/generation";
export * from "./ai/editing";
export * from "./ai/enrichment";
export * from "./ai/askAi";
export * from "./ai/translate";
