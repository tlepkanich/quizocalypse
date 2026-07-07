import { describe, expect, it } from "vitest";
import { bandCoverage, bandFor, sliderBandAnswers } from "./sliderBands";
import { buildTier1Report } from "./pathReport";
import { Quiz } from "./quizSchema";

// ── QZY-12 (build-tab §6.3) — range-band resolution + the V12 dead-end gate ──

const band = (id: string, min: number, max: number, extra: Record<string, unknown> = {}) => ({
  id,
  text: `${min}–${max}`,
  tags: [] as string[],
  edge_handle_id: `h_${id}`,
  range: { min, max },
  ...extra,
});
const seed = { id: "seed", text: "0", tags: [] as string[], edge_handle_id: "h_seed" };

describe("bandFor — inclusive bounds, authoring order wins on overlap", () => {
  const answers = [seed, band("b1", 0, 33), band("b2", 34, 66), band("b3", 67, 100)] as never[];
  it("routes a value to its band", () => {
    expect(bandFor(answers, 0)?.id).toBe("b1");
    expect(bandFor(answers, 33)?.id).toBe("b1");
    expect(bandFor(answers, 34)?.id).toBe("b2");
    expect(bandFor(answers, 100)?.id).toBe("b3");
  });
  it("no band → null (the seed fallback)", () => {
    expect(bandFor([seed] as never[], 50)).toBeNull();
    expect(sliderBandAnswers([seed] as never[])).toEqual([]);
  });
  it("overlap: first authored band wins", () => {
    const overlapping = [band("a", 0, 60), band("b", 40, 100)] as never[];
    expect(bandFor(overlapping, 50)?.id).toBe("a");
  });
});

describe("bandCoverage — gaps + overlaps against the scale", () => {
  it("contiguous integer bands cover fully (0-33 · 34-66 · 67-100)", () => {
    const cov = bandCoverage([band("a", 0, 33), band("b", 34, 66), band("c", 67, 100)] as never[], 0, 100, 1);
    expect(cov.gaps).toEqual([]);
    expect(cov.overlaps).toEqual([]);
  });
  it("a hole is a gap; head/tail holes count too", () => {
    expect(bandCoverage([band("a", 0, 33), band("b", 40, 100)] as never[], 0, 100).gaps).toEqual([[34, 39]]);
    expect(bandCoverage([band("a", 10, 100)] as never[], 0, 100).gaps).toEqual([[0, 9]]);
    expect(bandCoverage([band("a", 0, 90)] as never[], 0, 100).gaps).toEqual([[91, 100]]);
    expect(bandCoverage([] as never[], 0, 100).gaps).toEqual([[0, 100]]);
  });
  it("overlaps are reported (non-blocking)", () => {
    const cov = bandCoverage([band("a", 0, 60), band("b", 40, 100)] as never[], 0, 100);
    expect(cov.gaps).toEqual([]);
    expect(cov.overlaps.length).toBe(1);
  });
});

describe("V12 — a band gap is a BLOCKING dead end in the Tier-1 report", () => {
  const docWith = (answers: unknown[]) =>
    Quiz.parse({
      quiz_id: "qz",
      scope: { collection_ids: [] },
      logic_model: "decider",
      nodes: [
        { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
        {
          id: "qd",
          type: "question",
          position: { x: 0, y: 0 },
          data: {
            text: "Pick",
            question_type: "single_select",
            required: true,
            role: "decides",
            answers: [
              { id: "a1", text: "A", tags: [], edge_handle_id: "h1", target_id: "cat1" },
              { id: "a2", text: "B", tags: [], edge_handle_id: "h2", target_id: "cat1" },
            ],
          },
        },
        {
          id: "qs",
          type: "question",
          position: { x: 0, y: 0 },
          data: {
            text: "Flex?",
            question_type: "slider",
            role: "qualifier",
            scale_config: { min: 0, max: 100 },
            answers,
          },
        },
        { id: "r1", type: "result", position: { x: 0, y: 0 }, data: { headline: "R", fallback_collection_id: "c" } },
      ],
      edges: [
        { id: "e1", source: "intro", target: "qd" },
        { id: "e2", source: "qd", target: "qs" },
        { id: "e3", source: "qs", target: "r1" },
      ],
      results_pages: [],
    });
  const buckets = [{ id: "cat1", name: "Cat 1" }];

  it("full coverage → V12 clean; a gap → blocking", () => {
    const clean = buildTier1Report(
      docWith([band("a", 0, 50), band("b", 51, 100)]),
      buckets,
    );
    const v12clean = clean.checks.filter((c) => c.id === "V12" && c.severity === "block")[0];
    expect(v12clean?.findings.length ?? 0).toBe(0);

    const gappy = buildTier1Report(docWith([band("a", 0, 40), band("b", 60, 100)]), buckets);
    const v12 = gappy.checks.filter((c) => c.id === "V12" && c.severity === "block")[0];
    expect(v12?.findings.length).toBe(1);
    expect(v12?.findings[0]?.message).toContain("41–59");
    expect(gappy.verdict.blocking).toBeGreaterThan(0);
  });

  it("a slider WITHOUT bands stays legacy-valid (no V12 findings)", () => {
    const legacy = buildTier1Report(docWith([seed]), buckets);
    const v12 = legacy.checks.filter((c) => c.id === "V12" && c.severity === "block")[0];
    expect(v12?.findings.length ?? 0).toBe(0);
  });
});
