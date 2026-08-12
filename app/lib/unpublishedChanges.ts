import { resolveDesignTokens, type DesignTokensT } from "./designTokens";
import type { Quiz } from "./quizSchema";

// ════════════════════════════════════════════════════════════════════════════
// QRTZ-F4 — the honest unpublished-change COUNT behind the top bar's
// "Draft · N unpublished" pill (mock s16). A pure doc-diff between the current
// draft and the last published doc, counting UNITS a merchant would recognize:
//
//   • per NODE — an added, removed, or content/style-changed step counts 1
//     (a node's per-id satellites — design_overrides, breakpoint_overrides,
//     node_layouts, node_backgrounds, node_css — fold into ITS unit, so a
//     text edit + a layout tweak on the same step still count 1);
//   • +1 for the DESIGN group (design_tokens, rec_page_design, design_linked,
//     and non-node keys of the per-node style records, e.g. the shared-result
//     template "__shared_result__");
//   • +1 for rec_page_settings;
//   • +1 for edges (routing) as one unit;
//   • +1 for everything else top-level ("settings": placement, engagement,
//     launcher/discount config, decision_rules, translations, …) as one unit.
//
// PUBLISH-BAKE TOLERANCE — a fresh publish must read 0, so every field the
// publish pipeline (quizPublish.ts) strips, rewrites, or fills is excluded or
// compared bake-aware:
//   • stripped draft-only scratch: build_session, review_enrichment_sources,
//     why_copy_meta, path_report_ai — never compared;
//   • publish-owned fields: chapters (re-derived), status ("published"),
//     currency (baked from the catalog), results_pages (product-id maps
//     injected + node entries synthesized; no editor surface writes it — the
//     editing surface for result content is the result NODES) — never
//     compared;
//   • bake-only additions (product_index, published_at, version, shop_domain,
//     platform, answer_weights, target_product_ids_map, target_index) are not
//     Quiz-schema fields, so the callers' Quiz.safeParse of publishedJson
//     already drops them — and this function reads only schema keys anyway;
//   • AI copy fills: publish fills result why_bullets and answer tooltip_text
//     ONLY when the draft's are empty — so when the draft side is empty, the
//     field is ignored on both sides (a merchant-authored value still diffs);
//   • design_tokens are REPLACED at publish by the resolved cascade
//     (shop brand → quiz overrides → defaults, + chrome:"minimal" for decider
//     docs), so the design unit compares raw-equal OR resolved-equal. Note
//     this means a SHOP brand change since publish honestly reads as one
//     unpublished design change (republishing would change the live look).
// ════════════════════════════════════════════════════════════════════════════

type QuizDoc = Quiz;
type QuizNodeT = QuizDoc["nodes"][number];

// Per-node satellite records, keyed by node id (plus the odd non-node key like
// "__shared_result__", which folds into the design unit instead).
const NODE_KEYED_RECORDS = [
  "design_overrides",
  "breakpoint_overrides",
  "node_layouts",
  "node_backgrounds",
  "node_css",
] as const;

// Top-level keys never compared by the catch-all settings unit — either they
// have their own unit above, or the publish bake owns/strips them (see the
// header comment).
const SETTINGS_EXCLUDED = new Set<string>([
  "nodes",
  "edges",
  "rec_page_settings",
  "design_tokens",
  "rec_page_design",
  "design_linked",
  ...NODE_KEYED_RECORDS,
  // stripped at publish (draft-only scratch)
  "build_session",
  "review_enrichment_sources",
  "why_copy_meta",
  "path_report_ai",
  // publish-owned / baked
  "chapters",
  "status",
  "currency",
  "results_pages",
]);

// Order-insensitive structural equality: sorted-key JSON, with undefined
// object values dropped (absent key === undefined value). Docs are Zod-parsed
// JSON, so this is exact for our shapes.
function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === "object") {
    const src = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) {
      if (src[k] !== undefined) out[k] = stable(src[k]);
    }
    return out;
  }
  return v;
}

function eq(a: unknown, b: unknown): boolean {
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// Neutralize the publish-time AI copy fills so a fresh publish compares equal:
// when the DRAFT's why_bullets / tooltip_text are empty, publish may have
// filled them — ignore the field on both sides. Draft-authored values (non-
// empty on the draft side) still compare strictly.
function bakeTolerantNodePair(
  draftNode: QuizNodeT,
  publishedNode: QuizNodeT,
): [unknown, unknown] {
  if (draftNode.type !== publishedNode.type) return [draftNode, publishedNode];
  const d = clone(draftNode);
  const p = clone(publishedNode);
  if (d.type === "result" && p.type === "result") {
    if (d.data.why_bullets.length === 0) {
      p.data.why_bullets = [];
    }
  }
  if (d.type === "question" && p.type === "question") {
    const draftTooltipById = new Map(
      d.data.answers.map((a) => [a.id, a.tooltip_text]),
    );
    for (const a of p.data.answers) {
      if (draftTooltipById.has(a.id) && !draftTooltipById.get(a.id)) {
        delete a.tooltip_text;
      }
    }
    for (const a of d.data.answers) {
      if (!a.tooltip_text) delete a.tooltip_text;
    }
  }
  return [d, p];
}

function nodeRecord(
  doc: QuizDoc,
  key: (typeof NODE_KEYED_RECORDS)[number],
): Record<string, unknown> {
  return (doc[key] ?? {}) as Record<string, unknown>;
}

// Mirror quizPublish's design_tokens replacement: the resolved shop→quiz
// cascade, + chrome:"minimal" defaulted for decider docs (FIX-1).
function expectedPublishedTokens(
  draft: QuizDoc,
  layer: DesignTokensT | undefined,
  shopBrandTokens: DesignTokensT | null,
): DesignTokensT {
  const resolved = resolveDesignTokens(shopBrandTokens, layer);
  if (draft.logic_model === "decider" && !resolved.chrome) {
    resolved.chrome = "minimal";
  }
  return resolved;
}

/**
 * Count the units of unpublished change between a draft doc and the last
 * published doc (both Quiz-parsed). Returns 0 when a republish would be a
 * no-op the merchant could notice. See the header comment for the unit and
 * bake-tolerance rules.
 *
 * `shopBrandTokens` is the shop's brand token layer (Shop.brandTokens,
 * BrandTokens-parsed) — the same layer publish resolves design_tokens
 * against. Pass null when unavailable; the raw-equal arm still keeps
 * identical docs at 0.
 */
export function countUnpublishedChanges(
  draft: QuizDoc,
  published: QuizDoc,
  opts?: { shopBrandTokens?: DesignTokensT | null },
): number {
  let count = 0;
  const shopBrandTokens = opts?.shopBrandTokens ?? null;

  // ── per-node units ────────────────────────────────────────────────────────
  const draftById = new Map(draft.nodes.map((n) => [n.id, n]));
  const publishedById = new Map(published.nodes.map((n) => [n.id, n]));
  const nodeIds = new Set([...draftById.keys(), ...publishedById.keys()]);
  for (const id of nodeIds) {
    const d = draftById.get(id);
    const p = publishedById.get(id);
    if (!d || !p) {
      count += 1; // added or removed
      continue;
    }
    const [dn, pn] = bakeTolerantNodePair(d, p);
    if (!eq(dn, pn)) {
      count += 1;
      continue;
    }
    for (const key of NODE_KEYED_RECORDS) {
      if (!eq(nodeRecord(draft, key)[id], nodeRecord(published, key)[id])) {
        count += 1;
        break;
      }
    }
  }

  // ── design unit ───────────────────────────────────────────────────────────
  let designChanged =
    !eq(draft.design_tokens, published.design_tokens) &&
    !eq(
      expectedPublishedTokens(draft, draft.design_tokens, shopBrandTokens),
      published.design_tokens,
    );
  if (!designChanged) {
    const dHas = draft.rec_page_design !== undefined;
    const pHas = published.rec_page_design !== undefined;
    if (dHas !== pHas) designChanged = true;
    else if (dHas && pHas) {
      designChanged =
        !eq(draft.rec_page_design, published.rec_page_design) &&
        !eq(
          expectedPublishedTokens(draft, draft.rec_page_design, shopBrandTokens),
          published.rec_page_design,
        );
    }
  }
  if (!designChanged && draft.design_linked !== published.design_linked) {
    designChanged = true;
  }
  if (!designChanged) {
    // Non-node keys of the per-node style records (e.g. "__shared_result__").
    designChanged = NODE_KEYED_RECORDS.some((key) => {
      const dRec = nodeRecord(draft, key);
      const pRec = nodeRecord(published, key);
      return [...new Set([...Object.keys(dRec), ...Object.keys(pRec)])].some(
        (k) => !nodeIds.has(k) && !eq(dRec[k], pRec[k]),
      );
    });
  }
  if (designChanged) count += 1;

  // ── rec_page_settings unit ────────────────────────────────────────────────
  if (!eq(draft.rec_page_settings, published.rec_page_settings)) count += 1;

  // ── edges unit ────────────────────────────────────────────────────────────
  if (!eq(draft.edges, published.edges)) count += 1;

  // ── settings unit (everything else top-level) ─────────────────────────────
  const draftRec = draft as unknown as Record<string, unknown>;
  const publishedRec = published as unknown as Record<string, unknown>;
  const settingKeys = new Set(
    [...Object.keys(draftRec), ...Object.keys(publishedRec)].filter(
      (k) => !SETTINGS_EXCLUDED.has(k),
    ),
  );
  for (const k of settingKeys) {
    if (!eq(draftRec[k], publishedRec[k])) {
      count += 1;
      break;
    }
  }

  return count;
}
