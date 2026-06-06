import type { CSSProperties } from "react";
import { updateNodeData } from "../studio/studioDoc";
import { QzBadge, QzCollapse, QzField, QzInput, QzSelect } from "../qz";
import type {
  MatchLadderStrategy,
  OosBehavior,
  Quiz,
  QuizNode,
  ResultRanking,
} from "../../lib/quizSchema";
import type { BuilderCategory, BuilderCollection } from "./stepProps";

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

const RANKING_OPTIONS: { value: ResultRanking; label: string }[] = [
  { value: "relevance", label: "Relevance" },
  { value: "newest", label: "Newest" },
  { value: "best_seller", label: "Best seller" },
  { value: "highest_rated", label: "Highest rated" },
];

const OOS_OPTIONS: { value: OosBehavior; label: string }[] = [
  { value: "show_with_badge", label: "Show with badge" },
  { value: "hide", label: "Hide" },
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
  onCommit,
}: {
  doc: Quiz;
  node: ResultNode;
  categories: BuilderCategory[];
  collections: BuilderCollection[];
  onCommit: (doc: Quiz) => void;
}) {
  const data: ResultData = node.data;

  // Single immutable write path for every control in the panel.
  const set = (patch: Partial<ResultData>) => {
    onCommit(updateNodeData(doc, node.id, patch as Record<string, unknown>));
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

  return (
    <div className="qz-col qz-gap-8">
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
            <QzField label="Ranking">
              <QzSelect
                value={data.ranking}
                onChange={(e) => set({ ranking: e.target.value as ResultRanking })}
              >
                {RANKING_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
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
        </div>
      </QzCollapse>

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
    </div>
  );
}
