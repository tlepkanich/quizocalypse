// BIC-2 C3a — result-node mutations (add, per-section stages) and the sparse
// rec_page_settings writers. Pure move out of quizMutations.ts.
import { ResultData, ResultStage } from "../quizSchema";
import type { z } from "zod";
import { uid, nextPosition, type QuizDoc, type QuizNodeDoc } from "./shared";

export function addResultNode(
  doc: QuizDoc,
  anchorId: string | null,
  fallbackCollectionId: string,
  anchorHandle?: string,
): QuizDoc {
  const id = uid("r");
  const node: QuizNodeDoc = {
    id,
    type: "result",
    position: nextPosition(doc, anchorId),
    // Parse through ResultData so all the v3 defaults (match_ladder,
    // ranking, min/max, oos_behavior, stages, …) are filled in.
    data: ResultData.parse({
      headline: "Your match",
      subtext: "",
      slot_count: 3,
      cta_label: "Shop now",
      fallback_collection_id: fallbackCollectionId,
    }),
  };
  const edges = anchorId
    ? [
        ...doc.edges,
        {
          id: uid("e"),
          source: anchorId,
          target: id,
          ...(anchorHandle ? { source_handle: anchorHandle } : {}),
        },
      ]
    : doc.edges;
  return {
    ...doc,
    nodes: [...doc.nodes, node],
    edges,
    results_pages: [
      ...doc.results_pages,
      { id, headline: "Your match", subtext: "", product_ids: [], match_strategy: "top_n" as const },
    ],
  };
}

// ── Rec-Page spec §1 — multi-section (1/2/3 sections per bucket) ───────────────
// Sections map to ResultData.stages[]: stages.length === 0 → ONE section (the
// node's top-level config, rendered by ResultView). stages.length === N (N≥2) →
// N sections (rendered by MultiStageResultView). Each stage carries its own
// heading / sub-filter / sort / count and resolves the SAME bound bucket pool
// (category_id inherited), narrowed by the section's sub-filter.

function resultNodeAt(doc: QuizDoc, nodeId: string) {
  const node = doc.nodes.find((n) => n.id === nodeId);
  return node && node.type === "result" ? node : null;
}

// Immutable patch of a result node's data (quizMutations is studioDoc-free).
function patchResultData(
  doc: QuizDoc,
  nodeId: string,
  patch: Record<string, unknown>,
): QuizDoc {
  return {
    ...doc,
    nodes: doc.nodes.map((n) =>
      n.id === nodeId && n.type === "result" ? { ...n, data: { ...n.data, ...patch } } : n,
    ),
  };
}

// Patch a single section's fields (heading, sub_filter_tag/collection, ranking,
// min/max_products). No-op if the node or stage index is absent.
export function setResultStage(
  doc: QuizDoc,
  nodeId: string,
  index: number,
  patch: Partial<z.infer<typeof ResultStage>>,
): QuizDoc {
  const node = resultNodeAt(doc, nodeId);
  if (!node) return doc;
  const stages = [...node.data.stages];
  if (!stages[index]) return doc;
  stages[index] = { ...stages[index]!, ...patch };
  return patchResultData(doc, nodeId, { stages });
}

// Set the number of sections to n (1, 2, or 3). n<=1 clears stages (single
// section = the node's top-level config). n>=2 ensures exactly n stages, padding
// new ones that inherit the node's bucket binding (so each section resolves the
// same pool, then narrows by its own sub-filter) and trimming extras.
export function setResultSectionCount(doc: QuizDoc, nodeId: string, n: number): QuizDoc {
  const node = resultNodeAt(doc, nodeId);
  if (!node) return doc;
  const data = node.data;
  let stages = [...data.stages];
  if (n <= 1) {
    stages = [];
  } else {
    while (stages.length < n) {
      stages.push(
        ResultStage.parse({
          id: uid("stage"),
          headline: stages.length === 0 ? "Recommended for you" : "Complete your routine",
          match_ladder: data.match_ladder,
          category_id: data.category_id,
          ranking: data.ranking,
          min_products: 1,
          max_products: 4,
        }),
      );
    }
    stages = stages.slice(0, n);
  }
  return patchResultData(doc, nodeId, { stages });
}

// ── LOGIC v2 rec-page-spec-V2 §3 — rec_page_settings (decider docs only) ────
// SPARSE storage discipline: defaults are applied at READ time (REC_PAGE_
// DEFAULTS in recommendDecider), so these writers persist ONLY merchant-set
// fields. A patch value of `undefined` REMOVES the key (clear-to-default), and
// when everything empties out the rec_page_settings root itself is dropped —
// the H3 harness pins it absent-when-unset on the published wire.

type RecPageGlobalPatch = Partial<
  NonNullable<NonNullable<QuizDoc["rec_page_settings"]>["global"]>
>;
type RecPageOverridePatch = Partial<
  NonNullable<NonNullable<QuizDoc["rec_page_settings"]>["overrides"]>[string]
>;

function applySparse<T extends Record<string, unknown>>(
  base: T | undefined,
  patch: Record<string, unknown>,
): T {
  const next: Record<string, unknown> = { ...(base ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete next[k];
    else next[k] = v;
  }
  return next as T;
}

function packRecPageSettings(
  doc: QuizDoc,
  global: Record<string, unknown>,
  overrides: Record<string, Record<string, unknown>>,
): QuizDoc {
  const empty =
    Object.keys(global).length === 0 && Object.keys(overrides).length === 0;
  if (empty) {
    const { rec_page_settings: _dropped, ...rest } = doc;
    return rest as QuizDoc;
  }
  return { ...doc, rec_page_settings: { global, overrides } as QuizDoc["rec_page_settings"] };
}

/** Patch the GLOBAL rec-page config (§3.1). `undefined` clears a key. Pure. */
export function setRecPageGlobal(doc: QuizDoc, patch: RecPageGlobalPatch): QuizDoc {
  if (doc.logic_model !== "decider") return doc;
  const cur = doc.rec_page_settings;
  const global = applySparse<NonNullable<typeof cur>["global"]>(
    cur?.global,
    patch as Record<string, unknown>,
  );
  // §7.1 — name/phone capture require email (/captures persists nothing
  // without one, and the capture screen can't submit them alone). The
  // read-time default of captureEmail is TRUE, so a stored `false` IS the
  // effective off state — when email is off, drop the name/phone keys so no
  // writer (this panel or a future one) can persist an unservable config.
  if (global.captureEmail === false) {
    delete global.captureName;
    delete global.capturePhone;
  }
  return packRecPageSettings(doc, global, { ...(cur?.overrides ?? {}) });
}

/** Patch ONE target's sparse override (§3.2 — "Give this its own page").
 *  `undefined` clears a key; an override that empties out is removed (the
 *  target fully inherits global again). Pure. */
export function setRecPageOverride(
  doc: QuizDoc,
  targetId: string,
  patch: RecPageOverridePatch,
): QuizDoc {
  if (doc.logic_model !== "decider" || !targetId) return doc;
  const cur = doc.rec_page_settings;
  const overrides = { ...(cur?.overrides ?? {}) };
  const next = applySparse(overrides[targetId], patch as Record<string, unknown>);
  if (Object.keys(next).length === 0) delete overrides[targetId];
  else overrides[targetId] = next as (typeof overrides)[string];
  return packRecPageSettings(doc, { ...(cur?.global ?? {}) }, overrides);
}

/** Drop a target's override entirely (the toggle going OFF → inherit global). */
export function removeRecPageOverride(doc: QuizDoc, targetId: string): QuizDoc {
  if (doc.logic_model !== "decider") return doc;
  const cur = doc.rec_page_settings;
  if (!cur?.overrides?.[targetId]) return doc;
  const overrides = { ...cur.overrides };
  delete overrides[targetId];
  return packRecPageSettings(doc, { ...(cur.global ?? {}) }, overrides);
}
