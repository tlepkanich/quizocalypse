import { AsyncLocalStorage } from "node:async_hooks";

// BIC-2 A3 — the usage-observation seam between claude.ts and the persistence
// layer. claude.ts must stay prisma-free AND node-builtin-free (it sits in the
// isomorphic module graph — a `node:async_hooks` import there fails the client
// build at rollup bind-time), so the wiring is inverted: this SERVER-ONLY
// module holds the AsyncLocalStorage, and aiBudget.server.ts installs
// `emitAiUsage` into claude.ts via its setAiUsageEmitter hook at module load.
// Server callers that know the shopId wrap their generator call in
// `withAiSpendRecording(shopId, …)` (aiBudget.server.ts) and claude.ts's single
// `createMessage` wrapper emits each response's token usage into whatever
// observer is on the async context. No observer (an unwrapped caller, tests)
// → emit is a no-op.

export interface ObservedAiUsage {
  input_tokens: number;
  output_tokens: number;
}

type AiUsageObserver = (usage: ObservedAiUsage) => void;

const observerStorage = new AsyncLocalStorage<AiUsageObserver>();

/** Run `fn` with `observer` receiving every Anthropic response's token usage
 *  emitted (transitively) inside it. Nesting replaces the observer for the
 *  inner scope — emits fire exactly once per response either way. */
export function withAiUsageObserver<T>(
  observer: AiUsageObserver,
  fn: () => Promise<T>,
): Promise<T> {
  return observerStorage.run(observer, fn);
}

/** Called by claude.ts after each messages.create response. NEVER throws —
 *  usage observation must not be able to break a generation that already
 *  succeeded. */
export function emitAiUsage(usage: ObservedAiUsage): void {
  const observer = observerStorage.getStore();
  if (!observer) return;
  try {
    observer(usage);
  } catch {
    // Observer bugs are the observer's problem; the generator result stands.
  }
}
