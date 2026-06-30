import type { CSSProperties } from "react";
import { updateNodeData } from "../studio/studioDoc";
import { setResultSectionCount, setResultStage } from "../../lib/quizMutations";
import { QzBadge, QzCollapse, QzField, QzInput, QzSegmented, QzSelect } from "../qz";
import type {
  MatchLadderStrategy,
  OosBehavior,
  Quiz,
  QuizNode,
  ResultRanking,
} from "../../lib/quizSchema";
import type { BuilderCategory, BuilderCollection } from "./stepProps";
import type { IndexedProduct } from "../../lib/recommendationEngine";

// ───────────────────────────────────────────────────────────────────────────
// ResultSettingsPanel — the per-page recommendation SETTINGS editor used by
// Step 3 (Results). Self-contained (does NOT import the canvas route's
// ResultLogicEditor) but mirrors its field semantics. The key control is the
// SOURCE/MATCH "bucket" binding: a category_id dropdown populated from the
// quiz-scoped categories, which ties a result page to a bucket. All edits go
// through updateNodeData(doc, nodeId, patch) and bubble up via onCommit.
//
// Sections are wrapped in QzCollapse so a long config folds into scannable
// groups (Source open by default); no editor logic changed.
// ───────────────────────────────────────────────────────────────────────────

type ResultNode = Extract<QuizNode, { type: "result" }>;
type ResultData = ResultNode["data"];

const ALL_STRATEGIES: readonly MatchLadderStrategy[] = [
  "conditional",
  "points",
  "category",
  "collection",
  "tag",
  "metafield",
] as const;

const STRATEGY_LABEL: Record<MatchLadderStrategy, string> = {
  conditional: "Conditional rules",
  points: "Points winner",
  category: "Bound bucket",
  collection: "Collection",
  tag: "Tag overlap",
  metafield: "Metafield match",
};

const STRATEGY_HINT: Record<MatchLadderStrategy, string> = {
  conditional: "Explicit “if these answers → these products” rules.",
  points: "Winning bucket by per-answer point tally.",
  category: "Products from the bound bucket below.",
  collection: "Products in the chosen Shopify collection.",
  tag: "Tag-overlap scoring against the shopper’s answers.",
  metafield: "Products whose metafield matches a value.",
};

// Sort-Order set (Rec-Page spec §1). "manual" (Manually curated) respects a
// collection's own Shopify sort and is only meaningful when a collection scopes
// the section — it's disabled below unless a collection / collection sub-filter
// is set. Relevance + Highest rated are kept for back-compat with existing quizzes.
const RANKING_OPTIONS: { value: ResultRanking; label: string }[] = [
  { value: "relevance", label: "Relevance (answer fit)" },
  { value: "best_seller", label: "Best selling" },
  { value: "newest", label: "Newest" },
  { value: "price_asc", label: "Price: Low → High" },
  { value: "price_desc", label: "Price: High → Low" },
  { value: "title_az", label: "Title: A → Z" },
  { value: "title_za", label: "Title: Z → A" },
  { value: "highest_rated", label: "Highest rated" },
  { value: "manual", label: "Manually curated" },
];

const OOS_OPTIONS: { value: OosBehavior; label: string }[] = [
  { value: "show_with_badge", label: "Show with badge" },
  { value: "hide", label: "Hide" },
  { value: "notify_me", label: "Show “Notify Me” button" },
  { value: "fallback", label: "Fallback collection" },
];

const ladderBtn: CSSProperties = {
  background: "transparent",
  border: "1px solid var(--qz-rule)",
  borderRadius: 4,
  width: 22,
  height: 22,
  cursor: "pointer",
  fontSize: 12,
  lineHeight: 1,
  color: "var(--qz-ink-2)",
};

const addChip: CSSProperties = {
  background: "var(--qz-cream-2)",
  border: "1px solid var(--qz-rule)",
  borderRadius: 999,
  padding: "3px 10px",
  fontSize: 11,
  cursor: "pointer",
  color: "var(--qz-ink-2)",
};

// Bounds match the Zod schema (min_products 1..12, max_products 1..12).
function clampProductCount(raw: number): number {
  if (Number.isNaN(raw)) return 1;
  return Math.max(1, Math.min(12, Math.round(raw)));
}

export function ResultSettingsPanel({
  doc,
  node,
  categories,
  collections,
  productIndex,
  onCommit,
}: {
  doc: Quiz;
  node: ResultNode;
  categories: BuilderCategory[];
  collections: BuilderCollection[];
  productIndex?: IndexedProduct[];
  onCommit: (doc: Quiz) => void;
}) {
  const data: ResultData = node.data;

  // Single immutable write path for every control in the panel.
  const set = (patch: Partial<ResultData>) => {
    onCommit(updateNodeData(doc, node.id, patch as Record<string, unknown>));
  };

  // Rec-Page spec §7 — quiz-level Global Fallback (no-bucket-match). Doc-level,
  // not node-level (one config for the whole quiz), so it patches the doc like
  // back_in_stock_webhook_url below.
  const gf = doc.global_fallback;
  const setGf = (patch: Partial<typeof gf>) => {
    onCommit({ ...doc, global_fallback: { ...gf, ...patch } });
  };

  const ladder = data.match_ladder;

  const moveStrategy = (idx: number, dir: -1 | 1) => {
    const next = [...ladder];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    const a = next[idx];
    const b = next[j];
    if (a === undefined || b === undefined) return;
    next[idx] = b;
    next[j] = a;
    set({ match_ladder: next });
  };

  const removeStrategy = (s: MatchLadderStrategy) => {
    set({ match_ladder: ladder.filter((x) => x !== s) });
  };

  const addStrategy = (s: MatchLadderStrategy) => {
    if (ladder.includes(s)) return;
    set({ match_ladder: [...ladder, s] });
  };

  const boundCategory = data.category_id
    ? categories.find((c) => c.id === data.category_id)
    : undefined;

  const maxProducts = data.max_products ?? data.slot_count;

  // Rec-Page spec §1 — section structure. 0 stages = a single section driven by
  // the node's top-level Source/Ranking config; N stages = N stacked sections
  // (the runtime renders one MultiStageResultView section per stage).
  const stageList = data.stages;
  const sectionCount = stageList.length === 0 ? 1 : stageList.length;

  // "Manually curated" sort respects a collection's Shopify order, so it only
  // applies when a collection scopes the section (a collection sub-filter, the
  // bound collection, or the collection rung).
  const hasCollectionScope = Boolean(
    data.sub_filter_collection_id || data.collection_id,
  );

  // Mode B per-product blurbs (spec §3) — list the bucket's products: the bound
  // bucket's members intersected with the baked index, else the whole index
  // (capped so the editor stays manageable).
  const idx = productIndex ?? [];
  const bucketIds = boundCategory ? new Set(boundCategory.productIds) : null;
  const blurbProducts = (
    bucketIds ? idx.filter((p) => bucketIds.has(p.product_id)) : idx
  ).slice(0, 24);
  const setBlurb = (pid: string, text: string) => {
    const next = { ...data.product_blurbs };
    if (text) next[pid] = text;
    else delete next[pid];
    set({ product_blurbs: next });
  };

  return (
    <div className="qz-col qz-gap-8">
      {/* ── SECTION STRUCTURE (spec §1) — 1/2/3 stacked sections ──────── */}
      <QzCollapse
        title="Section structure"
        meta={sectionCount === 1 ? "1 section" : `${sectionCount} sections`}
        defaultOpen
      >
        <div className="qz-col qz-gap-8">
          <p className="qz-dim" style={{ fontSize: 12, margin: 0 }}>
            Split this page into up to three stacked product sections (e.g. “Your
            match”, then “Complete the routine”). Each extra section resolves the
            same bound bucket, then narrows by its own sub-filter and sort.
          </p>
          <QzSegmented
            ariaLabel="Number of sections"
            value={String(sectionCount)}
            onChange={(v) => onCommit(setResultSectionCount(doc, node.id, Number(v)))}
            options={[
              { value: "1", label: "1 section" },
              { value: "2", label: "2 sections" },
              { value: "3", label: "3 sections" },
            ]}
          />

          {sectionCount === 1 ? (
            <p className="qz-dim" style={{ fontSize: 12, margin: 0 }}>
              Single section — configured by the Source, Match, and Ranking
              settings below.
            </p>
          ) : (
            <div className="qz-col qz-gap-8">
              {stageList.map((stage, i) => {
                const stageHasCollection = Boolean(
                  stage.sub_filter_collection_id || stage.collection_id,
                );
                return (
                  <div
                    key={stage.id}
                    className="qz-col qz-gap-8"
                    style={{
                      padding: 10,
                      border: "1px solid var(--qz-rule)",
                      borderRadius: "var(--qz-radius)",
                      background: "var(--qz-paper)",
                    }}
                  >
                    <div className="qz-row qz-gap-8" style={{ alignItems: "center" }}>
                      <QzBadge tone="draft">Section {i + 1}</QzBadge>
                      <span className="qz-dim" style={{ fontSize: 11 }}>
                        {i === 0 ? "Primary match" : "Cross-sell / routine"}
                      </span>
                    </div>
                    <QzField label="Heading">
                      <QzInput
                        value={stage.headline}
                        placeholder={
                          i === 0 ? "Recommended for you" : "Complete your routine"
                        }
                        onChange={(e) =>
                          onCommit(
                            setResultStage(doc, node.id, i, { headline: e.target.value }),
                          )
                        }
                      />
                    </QzField>
                    <div className="qz-row qz-gap-8">
                      <QzField label="Sub-filter tag" hint="Within the bucket pool.">
                        <QzInput
                          value={stage.sub_filter_tag ?? ""}
                          placeholder="e.g. toners"
                          onChange={(e) =>
                            onCommit(
                              setResultStage(doc, node.id, i, {
                                sub_filter_tag: e.target.value || undefined,
                              }),
                            )
                          }
                        />
                      </QzField>
                      <QzField label="Max products">
                        <QzInput
                          type="number"
                          min={1}
                          max={12}
                          value={stage.max_products}
                          onChange={(e) =>
                            onCommit(
                              setResultStage(doc, node.id, i, {
                                max_products: clampProductCount(e.target.valueAsNumber),
                              }),
                            )
                          }
                        />
                      </QzField>
                    </div>
                    <div className="qz-row qz-gap-8">
                      <QzField
                        label="Sub-filter collection"
                        hint="Within the bucket pool."
                      >
                        <QzSelect
                          value={stage.sub_filter_collection_id ?? ""}
                          onChange={(e) =>
                            onCommit(
                              setResultStage(doc, node.id, i, {
                                sub_filter_collection_id: e.target.value || undefined,
                              }),
                            )
                          }
                        >
                          <option value="">No collection</option>
                          {collections.map((c) => (
                            <option key={c.collectionId} value={c.collectionId}>
                              {c.title}
                            </option>
                          ))}
                        </QzSelect>
                      </QzField>
                      <QzField label="Sort order">
                        <QzSelect
                          value={stage.ranking}
                          onChange={(e) =>
                            onCommit(
                              setResultStage(doc, node.id, i, {
                                ranking: e.target.value as ResultRanking,
                              }),
                            )
                          }
                        >
                          {RANKING_OPTIONS.map((o) => (
                            <option
                              key={o.value}
                              value={o.value}
                              disabled={o.value === "manual" && !stageHasCollection}
                            >
                              {o.value === "manual" && !stageHasCollection
                                ? `${o.label} (needs a collection)`
                                : o.label}
                            </option>
                          ))}
                        </QzSelect>
                      </QzField>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </QzCollapse>

      {/* ── SOURCE: the match ladder ──────────────────────────────────── */}
      <QzCollapse title="Source — match ladder" meta={`${ladder.length} active`} defaultOpen>
        <div className="qz-col qz-gap-8">
          <p className="qz-dim" style={{ fontSize: 12, margin: 0 }}>
            Products are resolved by trying each strategy top-to-bottom until one
            returns enough. Reorder to set priority.
          </p>

          <div className="qz-col qz-gap-4">
            {ladder.map((s, i) => (
              <div
                key={s}
                className="qz-row qz-gap-8"
                style={{
                  alignItems: "center",
                  padding: "6px 8px",
                  border: "1px solid var(--qz-rule)",
                  borderRadius: "var(--qz-radius)",
                  background: "var(--qz-paper)",
                }}
              >
                <span className="qz-mono qz-dim" style={{ fontSize: 11, width: 16 }}>
                  {i + 1}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13 }}>{STRATEGY_LABEL[s]}</span>
                  <span
                    className="qz-dim"
                    style={{ display: "block", fontSize: 11, lineHeight: 1.3 }}
                  >
                    {STRATEGY_HINT[s]}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => moveStrategy(i, -1)}
                  style={ladderBtn}
                  disabled={i === 0}
                  title="Move up"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => moveStrategy(i, 1)}
                  style={ladderBtn}
                  disabled={i === ladder.length - 1}
                  title="Move down"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => removeStrategy(s)}
                  style={{ ...ladderBtn, color: "var(--qz-crit)" }}
                  disabled={ladder.length <= 1}
                  title="Remove"
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <div className="qz-row qz-gap-4" style={{ flexWrap: "wrap" }}>
            {ALL_STRATEGIES.filter((s) => !ladder.includes(s)).map((s) => (
              <button key={s} type="button" onClick={() => addStrategy(s)} style={addChip}>
                + {STRATEGY_LABEL[s]}
              </button>
            ))}
          </div>
        </div>
      </QzCollapse>

      {/* ── MATCH: bind a bucket and/or a collection ──────────────────── */}
      <QzCollapse title="Match — bucket & collection">
        <div className="qz-col qz-gap-8">
          <QzField
            label="Bound bucket"
            hint={
              boundCategory
                ? `${boundCategory.productIds.length} product(s) in this bucket.`
                : "Tie this result page to a bucket so the “Bound bucket” strategy can pull its products."
            }
            meta={ladder.includes("category") ? "used by ladder" : undefined}
          >
            <QzSelect
              value={data.category_id ?? ""}
              onChange={(e) => set({ category_id: e.target.value || undefined })}
            >
              <option value="">No bucket</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.productIds.length})
                </option>
              ))}
            </QzSelect>
          </QzField>

          <QzField
            label="Collection"
            hint="Used by the “Collection” strategy."
            meta={ladder.includes("collection") ? "used by ladder" : undefined}
          >
            <QzSelect
              value={data.collection_id ?? ""}
              onChange={(e) => set({ collection_id: e.target.value || undefined })}
            >
              <option value="">No collection</option>
              {collections.map((c) => (
                <option key={c.collectionId} value={c.collectionId}>
                  {c.title}
                </option>
              ))}
            </QzSelect>
          </QzField>

          {ladder.includes("metafield") ? (
            <div className="qz-row qz-gap-8">
              <QzField label="Metafield key">
                <QzInput
                  value={data.metafield_key ?? ""}
                  placeholder="custom.skin_type"
                  onChange={(e) => set({ metafield_key: e.target.value || undefined })}
                />
              </QzField>
              <QzField label="Value">
                <QzInput
                  value={data.metafield_value ?? ""}
                  placeholder="oily"
                  onChange={(e) => set({ metafield_value: e.target.value || undefined })}
                />
              </QzField>
            </div>
          ) : null}
        </div>
      </QzCollapse>

      {/* ── RANKING + product counts ──────────────────────────────────── */}
      <QzCollapse title="Ranking & count">
        <div className="qz-col qz-gap-8">
          <div className="qz-row qz-gap-8">
            <QzField label="Sort order">
              <QzSelect
                value={data.ranking}
                onChange={(e) => set({ ranking: e.target.value as ResultRanking })}
              >
                {RANKING_OPTIONS.map((o) => (
                  <option
                    key={o.value}
                    value={o.value}
                    disabled={o.value === "manual" && !hasCollectionScope}
                  >
                    {o.value === "manual" && !hasCollectionScope
                      ? `${o.label} (needs a collection)`
                      : o.label}
                  </option>
                ))}
              </QzSelect>
            </QzField>
            <QzField label="Min products" hint="Ladder threshold to win.">
              <QzInput
                type="number"
                min={1}
                max={12}
                value={data.min_products}
                onChange={(e) => set({ min_products: clampProductCount(e.target.valueAsNumber) })}
              />
            </QzField>
            <QzField label="Max products" hint="Display cap.">
              <QzInput
                type="number"
                min={1}
                max={12}
                value={maxProducts}
                onChange={(e) => set({ max_products: clampProductCount(e.target.valueAsNumber) })}
              />
            </QzField>
          </div>

          {/* Sub-filter — narrow within the bucket's OWN pool (spec §1). */}
          <div className="qz-row qz-gap-8">
            <QzField
              label="Sub-filter tag"
              hint="Optional. Narrows this section to products that also carry this tag."
            >
              <QzInput
                value={data.sub_filter_tag ?? ""}
                placeholder="e.g. toners"
                onChange={(e) => set({ sub_filter_tag: e.target.value || undefined })}
              />
            </QzField>
            <QzField label="Sub-filter collection" hint="Optional. Within the bucket pool.">
              <QzSelect
                value={data.sub_filter_collection_id ?? ""}
                onChange={(e) =>
                  set({ sub_filter_collection_id: e.target.value || undefined })
                }
              >
                <option value="">No collection</option>
                {collections.map((c) => (
                  <option key={c.collectionId} value={c.collectionId}>
                    {c.title}
                  </option>
                ))}
              </QzSelect>
            </QzField>
          </div>
        </div>
      </QzCollapse>

      {/* ── PRODUCT DISPLAY (spec §2) ─────────────────────────────────── */}
      <QzCollapse title="Product display">
        <div className="qz-col qz-gap-8">
          <label
            className="qz-row qz-gap-8"
            style={{ alignItems: "center", fontSize: 13, cursor: "pointer" }}
          >
            <input
              type="checkbox"
              checked={data.show_variants}
              onChange={(e) => set({ show_variants: e.target.checked })}
            />
            Show variant selector on cards
          </label>
          <label
            className="qz-row qz-gap-8"
            style={{ alignItems: "center", fontSize: 13, cursor: "pointer" }}
          >
            <input
              type="checkbox"
              checked={data.show_descriptions}
              onChange={(e) => set({ show_descriptions: e.target.checked })}
            />
            Show product descriptions
          </label>
          <label
            className="qz-row qz-gap-8"
            style={{ alignItems: "center", fontSize: 13, cursor: "pointer" }}
          >
            <input
              type="checkbox"
              checked={data.urgency_enabled}
              onChange={(e) => set({ urgency_enabled: e.target.checked })}
            />
            Show “Only X left” urgency signal
          </label>
          {data.urgency_enabled ? (
            <QzField
              label="Urgency threshold"
              hint="Only show at or below this stock level. Hidden when inventory tracking is off."
            >
              <QzInput
                type="number"
                min={1}
                max={99}
                value={data.urgency_threshold}
                onChange={(e) =>
                  set({
                    urgency_threshold: Number.isNaN(e.target.valueAsNumber)
                      ? 5
                      : Math.max(1, Math.min(99, Math.round(e.target.valueAsNumber))),
                  })
                }
              />
            </QzField>
          ) : null}
          <label
            className="qz-row qz-gap-8"
            style={{ alignItems: "center", fontSize: 13, cursor: "not-allowed", opacity: 0.55 }}
            title="Coming soon — connect your reviews app"
          >
            <input type="checkbox" disabled checked={false} readOnly />
            Show star ratings
            <QzBadge tone="draft">Coming soon</QzBadge>
          </label>
        </div>
      </QzCollapse>

      {/* ── HERO PRODUCT (step4-dev-handoff §3.5/§6) ──────────────────── */}
      <QzCollapse title="Hero product" meta={data.hero_logic ? "On" : "Off"}>
        <div className="qz-col qz-gap-8">
          <label
            className="qz-row qz-gap-8"
            style={{ alignItems: "center", fontSize: 13, cursor: "pointer" }}
          >
            <input
              type="checkbox"
              checked={!!data.hero_logic}
              onChange={(e) =>
                set(
                  e.target.checked
                    ? { hero_logic: "match", hero_oos: data.hero_oos ?? "next" }
                    : { hero_logic: undefined, hero_oos: undefined },
                )
              }
            />
            Feature a hero product above the grid
          </label>
          {data.hero_logic ? (
            <>
              <QzField label="Hero ranking" hint="Which signal picks the featured product.">
                <div className="qz-col qz-gap-8" role="radiogroup" aria-label="Hero ranking">
                  <label
                    className="qz-row qz-gap-8"
                    style={{ alignItems: "center", fontSize: 13, cursor: "pointer" }}
                  >
                    <input
                      type="radio"
                      name="hero_logic"
                      checked={data.hero_logic === "match"}
                      onChange={() => set({ hero_logic: "match" })}
                    />
                    Best quiz match
                  </label>
                  <label
                    className="qz-row qz-gap-8"
                    style={{ alignItems: "center", fontSize: 13, cursor: "not-allowed", opacity: 0.55 }}
                    title="Coming soon — connect your reviews app"
                  >
                    <input type="radio" name="hero_logic" disabled checked={false} readOnly />
                    Highest rated
                    <QzBadge tone="draft">Coming soon</QzBadge>
                  </label>
                  <label
                    className="qz-row qz-gap-8"
                    style={{ alignItems: "center", fontSize: 13, cursor: "not-allowed", opacity: 0.55 }}
                    title="Coming soon — connect your sales data"
                  >
                    <input type="radio" name="hero_logic" disabled checked={false} readOnly />
                    Top seller
                    <QzBadge tone="draft">Coming soon</QzBadge>
                  </label>
                </div>
              </QzField>
              <QzField label="If the hero is sold out">
                <QzSegmented
                  ariaLabel="Hero out-of-stock behavior"
                  value={data.hero_oos ?? "next"}
                  onChange={(v) => set({ hero_oos: v as "next" | "grid" })}
                  options={[
                    { value: "next", label: "Use next best" },
                    { value: "grid", label: "Grid only" },
                  ]}
                />
              </QzField>
            </>
          ) : null}
        </div>
      </QzCollapse>

      {/* ── WHY WE RECOMMEND THIS (spec §3) ───────────────────────────── */}
      <QzCollapse title="Why we recommend this">
        <div className="qz-col qz-gap-8">
          <p className="qz-dim" style={{ fontSize: 12, margin: 0 }}>
            Use variables like <code>{"{{name}}"}</code>, <code>{"{{answers}}"}</code>,
            or <code>{"{{answer.<questionId>}}"}</code> — they resolve to the
            shopper’s answers at quiz time.
          </p>
          {/* Mode A — page intro */}
          <label
            className="qz-row qz-gap-8"
            style={{ alignItems: "center", fontSize: 13, cursor: "pointer" }}
          >
            <input
              type="checkbox"
              checked={data.why_intro_enabled}
              onChange={(e) =>
                set({
                  why_intro_enabled: e.target.checked,
                  // Seed a starting draft the merchant can edit (spec: AI drafts
                  // one; this is a sensible offline default until regenerated).
                  ...(e.target.checked && !data.why_intro
                    ? { why_intro: "Based on your answers ({{answers}}), here's what we recommend." }
                    : {}),
                })
              }
            />
            Page intro copy (Mode A)
          </label>
          {data.why_intro_enabled ? (
            <textarea
              value={data.why_intro}
              onChange={(e) => set({ why_intro: e.target.value })}
              rows={3}
              placeholder="Based on your answers, here's what your skin needs."
              style={{
                font: "inherit",
                fontSize: 13,
                padding: "8px 10px",
                borderRadius: "var(--qz-radius)",
                border: "1px solid var(--qz-rule)",
                resize: "vertical",
              }}
            />
          ) : null}
          {/* Mode B — per-product blurbs */}
          <label
            className="qz-row qz-gap-8"
            style={{ alignItems: "center", fontSize: 13, cursor: "pointer" }}
          >
            <input
              type="checkbox"
              checked={data.why_blurbs_enabled}
              onChange={(e) => set({ why_blurbs_enabled: e.target.checked })}
            />
            Per-product blurbs (Mode B)
          </label>
          {data.why_blurbs_enabled ? (
            blurbProducts.length > 0 ? (
              <div className="qz-col qz-gap-4">
                {blurbProducts.map((p) => (
                  <QzField key={p.product_id} label={p.title}>
                    <QzInput
                      value={data.product_blurbs[p.product_id] ?? ""}
                      placeholder="Short reason this product fits…"
                      onChange={(e) => setBlurb(p.product_id, e.target.value)}
                    />
                  </QzField>
                ))}
              </div>
            ) : (
              <p className="qz-dim" style={{ fontSize: 12, margin: 0 }}>
                Bind a bucket (or publish so products are indexed) to edit
                per-product blurbs here.
              </p>
            )
          ) : null}
        </div>
      </QzCollapse>

      {/* ── PAGE STRUCTURE (spec §6) ──────────────────────────────────── */}
      <QzCollapse title="Page structure">
        <div className="qz-col qz-gap-8">
          <label
            className="qz-row qz-gap-8"
            style={{ alignItems: "center", fontSize: 13, cursor: "pointer" }}
          >
            <input
              type="checkbox"
              checked={data.results_summary_bar}
              onChange={(e) => set({ results_summary_bar: e.target.checked })}
            />
            Results summary bar (shopper’s answers)
          </label>
          <label
            className="qz-row qz-gap-8"
            style={{ alignItems: "center", fontSize: 13, cursor: "pointer" }}
          >
            <input
              type="checkbox"
              checked={data.retake_link}
              onChange={(e) => set({ retake_link: e.target.checked })}
            />
            Retake-quiz link
          </label>
          <label
            className="qz-row qz-gap-8"
            style={{ alignItems: "center", fontSize: 13, cursor: "pointer" }}
          >
            <input
              type="checkbox"
              checked={data.share_results}
              onChange={(e) => set({ share_results: e.target.checked })}
            />
            Share-results button
          </label>
        </div>
      </QzCollapse>

      {/* Global no-match fallback was intentionally removed: the product goal is
          "no fit → no products". A no-match result renders a bare no-results
          state, never a fallback product grid. (global_fallback stays in the
          schema, parsed for back-compat, but is no longer editable or rendered.) */}

      {/* ── OUT-OF-STOCK behavior ─────────────────────────────────────── */}
      <QzCollapse title="Out of stock">
        <div className="qz-col qz-gap-8">
          <QzField label="When a product is out of stock">
            <QzSelect
              value={data.oos_behavior}
              onChange={(e) => set({ oos_behavior: e.target.value as OosBehavior })}
            >
              {OOS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </QzSelect>
          </QzField>
          {data.oos_behavior === "fallback" ? (
            <QzField label="Fallback collection">
              <QzSelect
                value={data.oos_fallback_collection_id ?? ""}
                onChange={(e) => set({ oos_fallback_collection_id: e.target.value || undefined })}
              >
                <option value="">No fallback</option>
                {collections.map((c) => (
                  <option key={c.collectionId} value={c.collectionId}>
                    {c.title}
                  </option>
                ))}
              </QzSelect>
            </QzField>
          ) : null}
          {data.oos_behavior === "notify_me" ? (
            <QzField
              label="Back-in-stock webhook (optional)"
              hint="“Notify Me” captures are always stored. Add a URL to also forward them to your back-in-stock tool."
            >
              <QzInput
                value={doc.back_in_stock_webhook_url ?? ""}
                placeholder="https://…"
                onChange={(e) =>
                  onCommit({
                    ...doc,
                    back_in_stock_webhook_url: e.target.value || undefined,
                  })
                }
              />
            </QzField>
          ) : null}
        </div>
      </QzCollapse>

      {/* ── PRICING toggles ───────────────────────────────────────────── */}
      <QzCollapse title="Pricing">
        <div className="qz-col qz-gap-8">
          <div className="qz-row qz-gap-16" style={{ flexWrap: "wrap" }}>
            <label
              className="qz-row qz-gap-8"
              style={{ alignItems: "center", fontSize: 13, cursor: "pointer" }}
            >
              <input
                type="checkbox"
                checked={data.include_discount}
                onChange={(e) => set({ include_discount: e.target.checked })}
              />
              Include discount
            </label>
            <label
              className="qz-row qz-gap-8"
              style={{ alignItems: "center", fontSize: 13, cursor: "pointer" }}
            >
              <input
                type="checkbox"
                checked={data.subscription_eligible}
                onChange={(e) => set({ subscription_eligible: e.target.checked })}
              />
              Subscription eligible
            </label>
          </div>
          {boundCategory ? <QzBadge tone="ok">Bound to “{boundCategory.name}”</QzBadge> : null}
        </div>
      </QzCollapse>

      {/* ── GLOBAL FALLBACK §7 — quiz-level no-bucket-match safety net ──────
          Doc-level (one config for the whole quiz). Off by default → a no-match
          shopper sees a graceful empty state (the engine still returns "no fit →
          no products" for the bucket match). On → a curated section shows. */}
      <QzCollapse title="Global fallback (no match)">
        <div className="qz-col qz-gap-8">
          <p className="qz-dim" style={{ fontSize: 12, margin: 0 }}>
            Shown only when a shopper can’t be matched to any bucket. Off → they
            see a graceful “no match” message (the default). Applies to the whole quiz.
          </p>
          <label
            className="qz-row qz-gap-8"
            style={{ alignItems: "center", fontSize: 13, cursor: "pointer" }}
          >
            <input
              type="checkbox"
              checked={gf.enabled}
              onChange={(e) => setGf({ enabled: e.target.checked })}
            />
            Show a fallback when nothing matches
          </label>
          {gf.enabled ? (
            <>
              <QzField label="Heading">
                <QzInput value={gf.heading} onChange={(e) => setGf({ heading: e.target.value })} />
              </QzField>
              <QzField label="Source collection">
                <QzSelect
                  value={gf.collection_id ?? ""}
                  onChange={(e) => setGf({ collection_id: e.target.value || undefined })}
                >
                  <option value="">— pick a collection —</option>
                  {collections.map((c) => (
                    <option key={c.collectionId} value={c.collectionId}>
                      {c.title}
                    </option>
                  ))}
                </QzSelect>
              </QzField>
              <QzField label="…or a tag" hint="Used when no collection is set.">
                <QzInput value={gf.tag ?? ""} onChange={(e) => setGf({ tag: e.target.value || undefined })} />
              </QzField>
              <QzField label="Products to show">
                <QzInput
                  type="number"
                  min={1}
                  max={12}
                  value={String(gf.count)}
                  onChange={(e) => setGf({ count: clampProductCount(Number(e.target.value)) })}
                />
              </QzField>
            </>
          ) : null}
        </div>
      </QzCollapse>
    </div>
  );
}
