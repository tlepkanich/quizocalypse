import { beforeEach, describe, expect, it, vi } from "vitest";
import { MODEL_PLAN, createMessage, setAiUsageEmitter, warmPromptCache } from "./client";

// QBUILD-FAST — prompt-cached input is billed outside usage.input_tokens
// (writes at 1.25×, reads at 0.1×). The usage emit folds it in at those
// weights so the per-shop ledger still counts every billed token.

const create = vi.hoisted(() => vi.fn());
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create };
  },
}));

const emitted = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  setAiUsageEmitter(emitted);
});

const params = { model: "m", max_tokens: 1, messages: [] } as never;

describe("createMessage — usage emit", () => {
  it("a response with no cache activity emits its raw token counts", async () => {
    create.mockResolvedValue({ usage: { input_tokens: 120, output_tokens: 45 } });
    await createMessage(params);
    expect(emitted).toHaveBeenCalledWith({
      input_tokens: 120,
      output_tokens: 45,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    });
  });

  it("a cache WRITE counts at 1.25× and a cache READ at 0.1× of input", async () => {
    create.mockResolvedValue({
      usage: {
        input_tokens: 400,
        output_tokens: 250,
        cache_creation_input_tokens: 3000,
        cache_read_input_tokens: 0,
      },
    });
    await createMessage(params);
    expect(emitted).toHaveBeenLastCalledWith(
      expect.objectContaining({ input_tokens: 400 + 3750, output_tokens: 250, cache_creation_input_tokens: 3000 }),
    );

    create.mockResolvedValue({
      usage: {
        input_tokens: 400,
        output_tokens: 250,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: 3000,
      },
    });
    await createMessage(params);
    expect(emitted).toHaveBeenLastCalledWith(
      expect.objectContaining({ input_tokens: 400 + 300, cache_read_input_tokens: 3000 }),
    );
  });

  // The ledger prices every token at the Sonnet rate; Opus 4.8 costs 5/3 of
  // it on input and output, so its tokens are emitted at that weight.
  it("a model priced above the ledger's Sonnet rate emits its tokens weighted", async () => {
    create.mockResolvedValue({
      usage: { input_tokens: 300, output_tokens: 300, cache_creation_input_tokens: 2400 },
    });
    await createMessage({ ...(params as object), model: MODEL_PLAN } as never);
    expect(emitted).toHaveBeenLastCalledWith({
      input_tokens: 5500, // (300 + 2400 × 1.25) × 5/3
      output_tokens: 500,
      cache_creation_input_tokens: 2400,
      cache_read_input_tokens: 0,
    });
  });

  it("an emitter that throws never fails a generation that succeeded", async () => {
    setAiUsageEmitter(() => {
      throw new Error("ledger down");
    });
    create.mockResolvedValue({ usage: { input_tokens: 1, output_tokens: 1 } });
    await expect(createMessage(params)).resolves.toMatchObject({ usage: { input_tokens: 1 } });
  });
});

describe("warmPromptCache", () => {
  it("sends the prefix for ONE output token and records its usage", async () => {
    create.mockResolvedValue({ usage: { input_tokens: 10, output_tokens: 1 } });
    await warmPromptCache({ model: "m", max_tokens: 4096, messages: [] } as never);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ model: "m", max_tokens: 1 }));
    expect(emitted).toHaveBeenCalledTimes(1);
  });

  it("never rejects: a failed warm-up only costs the cache discount", async () => {
    create.mockRejectedValue(new Error("529 overloaded"));
    await expect(warmPromptCache(params)).resolves.toBeUndefined();
  });
});
