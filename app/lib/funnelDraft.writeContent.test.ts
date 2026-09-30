import { beforeEach, describe, expect, it, vi } from "vitest";

// Logic step P2-11 — the autosave PUT orders the writes of one editing
// session under the row lock: an older commit never overwrites a newer one.

const store: { draftJson: unknown; updates: unknown[] } = { draftJson: null, updates: [] };

vi.mock("../db.server", () => {
  const tx = {
    $queryRaw: async () => [],
    quiz: {
      findUnique: async () => (store.draftJson === null ? null : { draftJson: store.draftJson }),
      update: async ({ data }: { data: { draftJson: unknown } }) => {
        store.draftJson = data.draftJson;
        store.updates.push(data.draftJson);
      },
    },
  };
  return { default: { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } };
});

const { DraftWriteError, isStaleSave, writeContent } = await import("./funnelDraft.server");
const { Quiz } = await import("./quizSchema");

const doc = (title: string) =>
  Quiz.parse({
    quiz_id: "qz",
    scope: { collection_ids: [] },
    logic_model: "decider",
    title,
    nodes: [
      { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: title } },
      { id: "end1", type: "end", position: { x: 1, y: 0 }, data: { headline: "Bye" } },
    ],
    edges: [{ id: "e1", source: "intro", target: "end1" }],
  });
const headline = () =>
  (store.draftJson as { nodes: Array<{ data: { headline: string } }> }).nodes[0]!.data.headline;

beforeEach(() => {
  store.draftJson = doc("start");
  store.updates = [];
});

describe("writeContent save ordering (P2-11)", () => {
  it("refuses an older commit of the same session that lands after a newer one", async () => {
    expect(await writeContent("q", doc("new"), { id: "s1", seq: 6 })).toBe("written");
    expect(await writeContent("q", doc("old"), { id: "s1", seq: 5 })).toBe("stale");
    expect(headline()).toBe("new");
    expect(store.updates).toHaveLength(1);
  });

  it("writes an equal sequence (a retry), a new session, and an unstamped PUT", async () => {
    await writeContent("q", doc("a"), { id: "s1", seq: 3 });
    expect(await writeContent("q", doc("b"), { id: "s1", seq: 3 })).toBe("written");
    expect(await writeContent("q", doc("c"), { id: "s2", seq: 1 })).toBe("written");
    expect(await writeContent("q", doc("d"))).toBe("written");
    expect(headline()).toBe("d");
  });

  it("a missing or unreadable draft is a DraftWriteError, never a thrown Response", async () => {
    store.draftJson = null;
    await expect(writeContent("q", doc("x"))).rejects.toBeInstanceOf(DraftWriteError);
    store.draftJson = { nope: true };
    await expect(writeContent("q", doc("x"))).rejects.toMatchObject({ status: 422 });
  });

  it("isStaleSave only compares stamps of the same session", () => {
    expect(isStaleSave({ id: "a", seq: 2 }, { id: "a", seq: 1 })).toBe(true);
    expect(isStaleSave({ id: "a", seq: 2 }, { id: "b", seq: 1 })).toBe(false);
    expect(isStaleSave(undefined, { id: "a", seq: 1 })).toBe(false);
    expect(isStaleSave({ id: "a", seq: 2 }, undefined)).toBe(false);
  });
});
