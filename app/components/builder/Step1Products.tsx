import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useRevalidator } from "@remix-run/react";
import {
  QzBadge,
  QzBanner,
  QzButton,
  QzCard,
  QzField,
  QzInput,
  QzSelect,
} from "../qz";
import { analyzeBucketBalance, bucketBalanceMessage } from "../../lib/bucketBalance";
import type { IndexedProduct } from "../../lib/recommendationEngine";
import type { BuilderCategory, StepProps } from "./stepProps";

// Step 1 — "Group your products into outcome buckets". The real bucket
// builder: a LEFT panel of unassigned products (title + thumb, tag filter
// chips) and a RIGHT area of editable bucket cards. Merchants assemble
// buckets manually (drag a product into a group, OR click a product then
// click a group) or seed them from a catalog dimension (Shopify
// collections, smart collections, tags, product type, metafields) or let
// Claude propose them. Each saved bucket is a quiz-scoped Category row and
// surfaces as a quiz result page (the shell reconciles buckets→result
// nodes on Next). Persistence goes through /api/categories/group and
// /api/categories/discover with quizId=props.quizId; on success we
// revalidate so the shell loader re-runs and props.categories refreshes.

type GroupMode =
  | "manual"
  | "collection"
  | "smart_collection"
  | "tag"
  | "product_type"
  | "metafield"
  | "ai";

const MODE_OPTIONS: ReadonlyArray<{ value: GroupMode; label: string }> = [
  { value: "manual", label: "Manual" },
  { value: "collection", label: "Shopify Collections" },
  { value: "smart_collection", label: "Smart Collections" },
  { value: "tag", label: "Existing tags" },
  { value: "product_type", label: "Shopify Product Type" },
  { value: "metafield", label: "Shopify metafields" },
  { value: "ai", label: "AI-assisted" },
];

// Shared response shape for both grouping endpoints.
interface GroupingResponse {
  ok: boolean;
  error?: string;
  runId?: string;
  categories?: Array<{
    id: string;
    name: string;
    description: string;
    tags: string[];
    productCount: number;
  }>;
}

// A manual bucket while the merchant is assembling it (pre-save). `key` is a
// stable client id; once saved, the persisted Category rows arrive back via
// props.categories.
interface ManualBucket {
  key: string;
  name: string;
  productIds: string[];
}

const MAX_TAG_CHIPS = 12;

export function Step1Products(props: StepProps) {
  const { quizId, productIndex, collections, categories } = props;
  const fetcher = useFetcher<GroupingResponse>();
  const revalidator = useRevalidator();
  const isWorking = fetcher.state !== "idle" && fetcher.formMethod === "POST";

  // Default to AI-assisted grouping on a fresh quiz (delivers the product-first
  // "pull your catalog in one click" promise), but land returning merchants who
  // already grouped products on Manual so we don't hide their existing buckets.
  const [mode, setMode] = useState<GroupMode>(categories.length === 0 ? "ai" : "manual");

  // Once groupings exist, the step leads with a read-only summary of them; the
  // setup editor (source controls / manual builder) is revealed via "Edit
  // groupings". A fresh quiz with no groups opens straight in the editor.
  const [editing, setEditing] = useState(categories.length === 0);

  // Optional narrowing inputs per non-manual source.
  const [collectionRef, setCollectionRef] = useState("");
  const [tagRef, setTagRef] = useState("");
  const [typeRef, setTypeRef] = useState("");
  const [metafieldKey, setMetafieldKey] = useState("");

  // Manual builder state: in-progress buckets + the currently-picked product
  // (click-to-assign) and the product being dragged (HTML5 DnD).
  const [buckets, setBuckets] = useState<ManualBucket[]>(() =>
    seedBucketsFromCategories(categories),
  );
  const [selectedProductId, setSelectedProductId] = useState<string | null>(
    null,
  );
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  const productById = useMemo(() => {
    const map = new Map<string, IndexedProduct>();
    for (const p of productIndex) map.set(p.product_id, p);
    return map;
  }, [productIndex]);

  const assignedProductIds = useMemo(() => {
    const set = new Set<string>();
    for (const bucket of buckets) {
      for (const id of bucket.productIds) set.add(id);
    }
    return set;
  }, [buckets]);

  // Tag filter chips: the most-common tags across the catalog. Tags are the
  // reliable type-like dimension carried by every IndexedProduct.
  const tagChips = useMemo(() => topTags(productIndex, MAX_TAG_CHIPS), [
    productIndex,
  ]);

  const unassignedProducts = useMemo(() => {
    return productIndex.filter((p) => {
      if (assignedProductIds.has(p.product_id)) return false;
      if (tagFilter && !p.tags.includes(tagFilter)) return false;
      return true;
    });
  }, [productIndex, assignedProductIds, tagFilter]);

  // After a successful save, revalidate so the shell loader re-runs and
  // props.categories refreshes. Fire once per distinct run id (each grouping
  // invocation returns a fresh one) — tracked in a ref so re-renders don't
  // re-trigger.
  const revalidatedRunId = useRef<string | null>(null);
  useEffect(() => {
    if (fetcher.state !== "idle") return;
    const runId = fetcher.data?.ok ? fetcher.data.runId : undefined;
    if (!runId || revalidatedRunId.current === runId) return;
    revalidatedRunId.current = runId;
    revalidator.revalidate();
    // Saving completes the edit — drop back to the groupings summary so the
    // merchant sees what they just created.
    setEditing(false);
  }, [fetcher.state, fetcher.data, revalidator]);

  // ---- manual bucket mutations -------------------------------------------

  const addBucket = () => {
    setBuckets((prev) => [
      ...prev,
      {
        key: `b_${Date.now().toString(36)}_${prev.length}`,
        name: "",
        productIds: [],
      },
    ]);
  };

  const renameBucket = (key: string, name: string) => {
    setBuckets((prev) => prev.map((b) => (b.key === key ? { ...b, name } : b)));
  };

  const removeBucket = (key: string) => {
    setBuckets((prev) => prev.filter((b) => b.key !== key));
  };

  // Add a product to a bucket (used by both click-to-assign and drop). No-op
  // if it's already in that bucket.
  const addProductToBucket = (key: string, productId: string) => {
    setBuckets((prev) =>
      prev.map((b) =>
        b.key === key && !b.productIds.includes(productId)
          ? { ...b, productIds: [...b.productIds, productId] }
          : b,
      ),
    );
  };

  // Click-to-assign: a product is selected, click a bucket to drop it in.
  const assignSelectedToBucket = (key: string) => {
    if (!selectedProductId) return;
    addProductToBucket(key, selectedProductId);
    setSelectedProductId(null);
  };

  const unassignProduct = (key: string, productId: string) => {
    setBuckets((prev) =>
      prev.map((b) =>
        b.key === key
          ? { ...b, productIds: b.productIds.filter((id) => id !== productId) }
          : b,
      ),
    );
  };

  // ---- persistence -------------------------------------------------------

  const saveManual = () => {
    const groups = buckets
      .map((b) => ({ name: b.name.trim(), productIds: b.productIds }))
      .filter((g) => g.name !== "" || g.productIds.length > 0);
    fetcher.submit(
      { source: "manual", groups: JSON.stringify(groups), quizId },
      { method: "POST", action: "/api/categories/group" },
    );
  };

  const generateGroups = () => {
    const body: Record<string, string> = { source: mode, quizId };
    if (mode === "collection" || mode === "smart_collection") {
      if (collectionRef) body.sourceRef = collectionRef;
    } else if (mode === "tag") {
      if (tagRef.trim()) body.sourceRef = tagRef.trim();
    } else if (mode === "product_type") {
      if (typeRef.trim()) body.sourceRef = typeRef.trim();
    } else if (mode === "metafield") {
      body.metafieldKey = metafieldKey.trim();
    }
    fetcher.submit(body, { method: "POST", action: "/api/categories/group" });
  };

  const discover = () => {
    fetcher.submit(
      { quizId },
      { method: "POST", action: "/api/categories/discover" },
    );
  };

  const manualCanSave = buckets.some(
    (b) => b.name.trim() !== "" || b.productIds.length > 0,
  );
  const tooFewProducts = productIndex.length < 5;

  // Once groups exist we lead with the read-only summary; the setup editor is
  // only shown while actively editing (or on a fresh, ungrouped quiz).
  const hasGroups = categories.length > 0;
  const showEditor = editing || !hasGroups;

  // Imbalance signal — one bucket swallowing the catalog (or an empty bucket)
  // skews recommendations. Surfaced as a banner + per-card badges so it's
  // visible right where the groups are shown, not just in the Optimize tab.
  const balanceMessage = hasGroups
    ? bucketBalanceMessage(categories.map((c) => ({ name: c.name, count: c.productIds.length })))
    : null;
  const oversizedIds = useMemo(() => {
    const counts = categories.map((c) => c.productIds.length);
    return new Set(analyzeBucketBalance(counts).oversized.map((i) => categories[i]!.id));
  }, [categories]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        className="qz-row qz-row-between"
        style={{ alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}
      >
        <div>
          <h2 className="qz-h1" style={{ margin: 0 }}>
            {showEditor ? "Group your products into outcome buckets" : "Your product groupings"}
          </h2>
          <p className="qz-dim" style={{ marginTop: 6 }}>
            {showEditor
              ? "Drag products from the left into a group, or click a product then click a group. Each group becomes a quiz result."
              : "These groups power your quiz results — each becomes its own recommendation. Edit them anytime."}
          </p>
        </div>
        {hasGroups ? (
          <QzButton
            variant={showEditor ? "ghost" : "primary"}
            onClick={() => setEditing((e) => !e)}
          >
            {showEditor ? "Done editing" : "Edit groupings →"}
          </QzButton>
        ) : null}
      </div>

      {fetcher.data?.ok === false && (
        <QzBanner tone="crit" title="Couldn’t save groups">
          {fetcher.data.error ?? "Unknown error"}
        </QzBanner>
      )}

      {balanceMessage ? (
        <QzBanner tone="warn" title="Groups are unbalanced">
          {balanceMessage}
        </QzBanner>
      ) : null}

      {showEditor ? (
        <>
          {/* Group-by segmented control */}
          <div className="qz-row" style={{ gap: 6, flexWrap: "wrap" }}>
            {MODE_OPTIONS.map((opt) => {
              const active = opt.value === mode;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setMode(opt.value)}
                  className="qz-badge"
                  aria-pressed={active}
                  style={{
                    cursor: "pointer",
                    fontSize: 12,
                    border: "1px solid",
                    borderColor: active ? "var(--qz-ink)" : "var(--qz-rule)",
                    background: active ? "var(--qz-ink)" : "transparent",
                    color: active ? "var(--qz-paper)" : "var(--qz-ink-2)",
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          {tooFewProducts && (
            <QzBanner tone="warn" title="Sync products first">
              We need at least 5 synced products to build meaningful groups. Run a
              catalog sync, then come back.
            </QzBanner>
          )}

          {/* Non-manual source controls */}
          {mode !== "manual" && (
            <QzCard>
              <SourceControls
                mode={mode}
                collections={collections}
                collectionRef={collectionRef}
                tagRef={tagRef}
                typeRef={typeRef}
                metafieldKey={metafieldKey}
                isWorking={isWorking}
                tooFewProducts={tooFewProducts}
                hasCategories={categories.length > 0}
                onCollectionRef={setCollectionRef}
                onTagRef={setTagRef}
                onTypeRef={setTypeRef}
                onMetafieldKey={setMetafieldKey}
                onGenerate={generateGroups}
                onDiscover={discover}
              />
            </QzCard>
          )}

          {/* Manual two-pane builder */}
          {mode === "manual" && (
            <ManualBuilder
              unassignedProducts={unassignedProducts}
              buckets={buckets}
              productById={productById}
              selectedProductId={selectedProductId}
              tagChips={tagChips}
              tagFilter={tagFilter}
              isWorking={isWorking}
              canSave={manualCanSave}
              onSetTagFilter={setTagFilter}
              onSelectProduct={(id) =>
                setSelectedProductId((cur) => (cur === id ? null : id))
              }
              onAddBucket={addBucket}
              onRenameBucket={renameBucket}
              onRemoveBucket={removeBucket}
              onAssignSelected={assignSelectedToBucket}
              onDropProduct={addProductToBucket}
              onUnassignProduct={unassignProduct}
              onSave={saveManual}
            />
          )}
        </>
      ) : (
        // Read view — the active groupings, shown once setup is done.
        <ActiveGroupings
          categories={categories}
          productById={productById}
          oversizedIds={oversizedIds}
        />
      )}

      {/* BLD-5 — builder-native footer (the "Step 1 of 4" wizard framing leaked
          from the retired 4-step builder; there are no steps here). */}
      <p className="qz-dim" style={{ fontSize: 12 }}>
        {hasGroups
          ? `${categories.length} group${categories.length === 1 ? "" : "s"} ready — each becomes a result page in the Results view.`
          : "Group your products — each group becomes a result page shoppers can land on."}
      </p>
    </div>
  );
}

// Seed in-progress manual buckets from already-saved quiz categories so the
// merchant continues editing rather than starting from a blank slate.
function seedBucketsFromCategories(
  categories: BuilderCategory[],
): ManualBucket[] {
  return categories.map((c, i) => ({
    key: `seed_${c.id}_${i}`,
    name: c.name,
    productIds: [...c.productIds],
  }));
}

// Most-common tags across the catalog, capped, for the left-panel filter
// chips. Ties broken alphabetically.
function topTags(products: IndexedProduct[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const p of products) {
    for (const tag of p.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0].localeCompare(b[0])))
    .slice(0, limit)
    .map(([tag]) => tag);
}

// ---- Source controls (non-manual modes) ----------------------------------

interface SourceControlsProps {
  mode: Exclude<GroupMode, "manual">;
  collections: StepProps["collections"];
  collectionRef: string;
  tagRef: string;
  typeRef: string;
  metafieldKey: string;
  isWorking: boolean;
  tooFewProducts: boolean;
  hasCategories: boolean;
  onCollectionRef: (v: string) => void;
  onTagRef: (v: string) => void;
  onTypeRef: (v: string) => void;
  onMetafieldKey: (v: string) => void;
  onGenerate: () => void;
  onDiscover: () => void;
}

function SourceControls({
  mode,
  collections,
  collectionRef,
  tagRef,
  typeRef,
  metafieldKey,
  isWorking,
  tooFewProducts,
  hasCategories,
  onCollectionRef,
  onTagRef,
  onTypeRef,
  onMetafieldKey,
  onGenerate,
  onDiscover,
}: SourceControlsProps) {
  if (mode === "ai") {
    return (
      <div className="qz-row" style={{ gap: 12, alignItems: "center" }}>
        <QzButton
          variant="accent"
          onClick={onDiscover}
          disabled={isWorking || tooFewProducts}
        >
          {isWorking
            ? "Discovering…"
            : hasCategories
              ? "Re-discover"
              : "Discover buckets"}
        </QzButton>
        <span className="qz-muted" style={{ fontSize: 13 }}>
          Claude reads your catalog and proposes 5–9 outcome buckets.
        </span>
      </div>
    );
  }

  if (mode === "collection" || mode === "smart_collection") {
    return (
      <div className="qz-col qz-gap-12">
        <QzField
          label="Collection (optional)"
          hint="Leave on “All collections” to make one group per collection, or pick one to generate just that group."
        >
          <QzSelect
            value={collectionRef}
            onChange={(e) => onCollectionRef(e.target.value)}
          >
            <option value="">All collections</option>
            {collections.map((c) => (
              <option key={c.collectionId} value={c.collectionId}>
                {c.title}
              </option>
            ))}
          </QzSelect>
        </QzField>
        <GenerateButton
          isWorking={isWorking}
          disabled={isWorking || tooFewProducts}
          onClick={onGenerate}
        />
      </div>
    );
  }

  if (mode === "tag") {
    return (
      <div className="qz-col qz-gap-12">
        <QzField
          label="Tag (optional)"
          hint="Leave blank to group by every tag (top 12 by size), or type one tag to make a single group."
        >
          <QzInput
            value={tagRef}
            placeholder="e.g. waterproof"
            onChange={(e) => onTagRef(e.target.value)}
          />
        </QzField>
        <GenerateButton
          isWorking={isWorking}
          disabled={isWorking || tooFewProducts}
          onClick={onGenerate}
        />
      </div>
    );
  }

  if (mode === "product_type") {
    return (
      <div className="qz-col qz-gap-12">
        <QzField
          label="Product type (optional)"
          hint="Leave blank to group by every product type, or type one to make a single group."
        >
          <QzInput
            value={typeRef}
            placeholder="e.g. Serum"
            onChange={(e) => onTypeRef(e.target.value)}
          />
        </QzField>
        <GenerateButton
          isWorking={isWorking}
          disabled={isWorking || tooFewProducts}
          onClick={onGenerate}
        />
      </div>
    );
  }

  // metafield
  return (
    <div className="qz-col qz-gap-12">
      <QzField
        label="Metafield key"
        hint="Namespace + key, e.g. custom.skin_type. One group per distinct value."
      >
        <QzInput
          value={metafieldKey}
          placeholder="custom.skin_type"
          onChange={(e) => onMetafieldKey(e.target.value)}
        />
      </QzField>
      <GenerateButton
        isWorking={isWorking}
        disabled={isWorking || tooFewProducts || metafieldKey.trim() === ""}
        onClick={onGenerate}
      />
    </div>
  );
}

function GenerateButton({
  isWorking,
  disabled,
  onClick,
}: {
  isWorking: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <div>
      <QzButton variant="accent" onClick={onClick} disabled={disabled}>
        {isWorking ? "Generating…" : "Generate groups"}
      </QzButton>
    </div>
  );
}

// ---- Manual two-pane builder ---------------------------------------------

interface ManualBuilderProps {
  unassignedProducts: IndexedProduct[];
  buckets: ManualBucket[];
  productById: Map<string, IndexedProduct>;
  selectedProductId: string | null;
  tagChips: string[];
  tagFilter: string | null;
  isWorking: boolean;
  canSave: boolean;
  onSetTagFilter: (tag: string | null) => void;
  onSelectProduct: (id: string) => void;
  onAddBucket: () => void;
  onRenameBucket: (key: string, name: string) => void;
  onRemoveBucket: (key: string) => void;
  onAssignSelected: (key: string) => void;
  onDropProduct: (key: string, productId: string) => void;
  onUnassignProduct: (key: string, productId: string) => void;
  onSave: () => void;
}

const DND_MIME = "application/x-quizocalypse-product";

function ManualBuilder({
  unassignedProducts,
  buckets,
  productById,
  selectedProductId,
  tagChips,
  tagFilter,
  isWorking,
  canSave,
  onSetTagFilter,
  onSelectProduct,
  onAddBucket,
  onRenameBucket,
  onRemoveBucket,
  onAssignSelected,
  onDropProduct,
  onUnassignProduct,
  onSave,
}: ManualBuilderProps) {
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  const selectedTitle = selectedProductId
    ? (productById.get(selectedProductId)?.title ?? "product")
    : null;

  return (
    <div className="qz-col qz-gap-12">
      <p className="qz-muted" style={{ fontSize: 13, margin: 0 }}>
        Drag a product into a group, or click a product to select it then click
        a group to assign it.{" "}
        {selectedTitle ? (
          <strong>Selected: {selectedTitle}</strong>
        ) : (
          "No product selected."
        )}
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(240px, 320px) 1fr",
          gap: 16,
          alignItems: "start",
        }}
      >
        {/* LEFT — unassigned products + tag filter chips */}
        <div
          style={{
            border: "1px solid var(--qz-rule)",
            borderRadius: "var(--qz-radius)",
            padding: 12,
            maxHeight: 520,
            overflowY: "auto",
          }}
        >
          <div className="qz-label" style={{ marginBottom: 8 }}>
            Your products — unassigned ({unassignedProducts.length})
          </div>

          {tagChips.length > 0 && (
            <div
              className="qz-row"
              style={{ gap: 4, flexWrap: "wrap", marginBottom: 10 }}
            >
              <FilterChip
                label="All"
                active={tagFilter === null}
                onClick={() => onSetTagFilter(null)}
              />
              {tagChips.map((tag) => (
                <FilterChip
                  key={tag}
                  label={tag}
                  active={tagFilter === tag}
                  onClick={() =>
                    onSetTagFilter(tagFilter === tag ? null : tag)
                  }
                />
              ))}
            </div>
          )}

          <div className="qz-col qz-gap-4">
            {unassignedProducts.length === 0 ? (
              <span className="qz-dim" style={{ fontSize: 12 }}>
                {tagFilter
                  ? "No unassigned products match this filter."
                  : "Everything is assigned."}
              </span>
            ) : (
              unassignedProducts.map((p) => (
                <ProductRow
                  key={p.product_id}
                  product={p}
                  selected={p.product_id === selectedProductId}
                  onSelect={() => onSelectProduct(p.product_id)}
                />
              ))
            )}
          </div>
        </div>

        {/* RIGHT — bucket cards */}
        <div className="qz-col qz-gap-12">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: 12,
            }}
          >
            {buckets.map((bucket) => (
              <BucketCard
                key={bucket.key}
                bucket={bucket}
                productById={productById}
                selectedProductId={selectedProductId}
                isDragOver={dragOverKey === bucket.key}
                onRename={(name) => onRenameBucket(bucket.key, name)}
                onRemove={() => onRemoveBucket(bucket.key)}
                onAssignSelected={() => onAssignSelected(bucket.key)}
                onDragOver={(over) =>
                  setDragOverKey((cur) =>
                    over ? bucket.key : cur === bucket.key ? null : cur,
                  )
                }
                onDrop={(productId) => {
                  setDragOverKey(null);
                  onDropProduct(bucket.key, productId);
                }}
                onUnassign={(productId) =>
                  onUnassignProduct(bucket.key, productId)
                }
              />
            ))}

            {/* + Add group affordance */}
            <button
              type="button"
              onClick={onAddBucket}
              className="qz-card qz-dash"
              style={{
                padding: 14,
                cursor: "pointer",
                textAlign: "left",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                minHeight: 120,
                color: "var(--qz-ink-2)",
                background: "transparent",
                fontSize: 14,
              }}
            >
              + Add group
            </button>
          </div>

          <div className="qz-row" style={{ gap: 12 }}>
            <QzButton
              variant="accent"
              onClick={onSave}
              disabled={isWorking || !canSave}
            >
              {isWorking ? "Saving…" : "Save groups"}
            </QzButton>
            <span className="qz-dim" style={{ fontSize: 12, alignSelf: "center" }}>
              Saving makes each non-empty group a quiz result.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        fontSize: 11,
        padding: "2px 8px",
        borderRadius: 999,
        cursor: "pointer",
        border: "1px solid",
        borderColor: active ? "var(--qz-ink)" : "var(--qz-rule)",
        background: active ? "var(--qz-ink)" : "transparent",
        color: active ? "var(--qz-paper)" : "var(--qz-ink-2)",
      }}
    >
      {label}
    </button>
  );
}

// A draggable, click-selectable product row (title + small thumb).
function ProductRow({
  product,
  selected,
  onSelect,
}: {
  product: IndexedProduct;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DND_MIME, product.product_id);
        e.dataTransfer.setData("text/plain", product.product_id);
        e.dataTransfer.effectAllowed = "copy";
      }}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 8px",
        borderRadius: 6,
        border: "1px solid",
        borderColor: selected ? "var(--qz-ink)" : "var(--qz-rule)",
        background: selected ? "var(--qz-cream-2)" : "transparent",
        cursor: "grab",
      }}
    >
      <Thumb url={product.image_url} alt={product.title} />
      <span
        style={{
          fontSize: 12,
          color: "var(--qz-ink-2)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {product.title}
      </span>
    </div>
  );
}

function Thumb({ url, alt }: { url: string | null; alt: string }) {
  const box: React.CSSProperties = {
    width: 28,
    height: 28,
    borderRadius: 4,
    flex: "0 0 auto",
    objectFit: "cover",
    border: "1px solid var(--qz-rule)",
    background: "var(--qz-cream-2)",
  };
  if (!url) {
    return <span style={box} aria-hidden="true" />;
  }
  // Plain <img>: this is a Remix app (no next/image). Thumbs are tiny and
  // come straight from Shopify CDN URLs already baked into the index.
  return <img src={url} alt={alt} style={box} />;
}

interface BucketCardProps {
  bucket: ManualBucket;
  productById: Map<string, IndexedProduct>;
  selectedProductId: string | null;
  isDragOver: boolean;
  onRename: (name: string) => void;
  onRemove: () => void;
  onAssignSelected: () => void;
  onDragOver: (over: boolean) => void;
  onDrop: (productId: string) => void;
  onUnassign: (productId: string) => void;
}

function BucketCard({
  bucket,
  productById,
  selectedProductId,
  isDragOver,
  onRename,
  onRemove,
  onAssignSelected,
  onDragOver,
  onDrop,
  onUnassign,
}: BucketCardProps) {
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        onDragOver(true);
      }}
      onDragLeave={() => onDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        const id =
          e.dataTransfer.getData(DND_MIME) ||
          e.dataTransfer.getData("text/plain");
        if (id) onDrop(id);
      }}
      className="qz-card"
      style={{
        padding: 12,
        borderColor: isDragOver ? "var(--qz-ink)" : undefined,
        boxShadow: isDragOver ? "0 0 0 2px var(--qz-ink) inset" : undefined,
      }}
    >
      <div
        className="qz-row qz-row-between"
        style={{ alignItems: "center", marginBottom: 8, gap: 6 }}
      >
        <QzInput
          value={bucket.name}
          placeholder="Group name"
          onChange={(e) => onRename(e.target.value)}
          style={{ fontSize: 13 }}
        />
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove group"
          className="qz-mono qz-dim"
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            fontSize: 16,
            lineHeight: 1,
            padding: "0 4px",
          }}
        >
          ×
        </button>
      </div>

      <div
        className="qz-row qz-row-between"
        style={{ alignItems: "center", marginBottom: 8 }}
      >
        <QzBadge tone={bucket.productIds.length > 0 ? "ok" : "draft"}>
          {bucket.productIds.length} product
          {bucket.productIds.length === 1 ? "" : "s"}
        </QzBadge>
        <button
          type="button"
          onClick={onAssignSelected}
          disabled={!selectedProductId}
          style={{
            fontSize: 11,
            padding: "3px 8px",
            borderRadius: 6,
            border: "1px dashed var(--qz-rule)",
            background: "transparent",
            cursor: selectedProductId ? "pointer" : "not-allowed",
            color: "var(--qz-ink-2)",
          }}
        >
          + Assign selected
        </button>
      </div>

      <div className="qz-row" style={{ flexWrap: "wrap", gap: 4 }}>
        {bucket.productIds.length === 0 ? (
          <span className="qz-dim" style={{ fontSize: 11 }}>
            Drop or assign products here.
          </span>
        ) : (
          bucket.productIds.map((id) => {
            const title = productById.get(id)?.title ?? id;
            return (
              <span
                key={id}
                className="qz-row"
                style={{
                  alignItems: "center",
                  gap: 4,
                  background: "var(--qz-cream-2)",
                  border: "1px solid var(--qz-rule)",
                  borderRadius: 999,
                  padding: "2px 4px 2px 8px",
                  fontSize: 11,
                  color: "var(--qz-ink-2)",
                  maxWidth: "100%",
                }}
              >
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: 120,
                  }}
                >
                  {title}
                </span>
                <button
                  type="button"
                  onClick={() => onUnassign(id)}
                  aria-label={`Remove ${title}`}
                  className="qz-mono qz-dim"
                  style={{
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    fontSize: 12,
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              </span>
            );
          })
        )}
      </div>
    </div>
  );
}

// ---- Saved buckets summary ------------------------------------------------

// Read-only view of the active groupings, shown once setup is done. Each card
// is a group: name, product count, where it came from, and a few sample product
// titles so the merchant can sanity-check membership at a glance.
function ActiveGroupings({
  categories,
  productById,
  oversizedIds,
}: {
  categories: BuilderCategory[];
  productById: Map<string, IndexedProduct>;
  oversizedIds: Set<string>;
}) {
  if (categories.length === 0) {
    return (
      <QzBanner tone="warn" title="No groups yet">
        Assemble and save at least one group to continue. Each group becomes a
        quiz result page.
      </QzBanner>
    );
  }
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
        gap: 12,
      }}
    >
      {categories.map((c) => {
        const sample = c.productIds
          .map((id) => productById.get(id)?.title)
          .filter((t): t is string => Boolean(t))
          .slice(0, 3);
        const remainder = c.productIds.length - sample.length;
        const empty = c.productIds.length === 0;
        const oversized = oversizedIds.has(c.id);
        return (
          <div
            key={c.id}
            className="qz-card"
            style={{
              padding: 14,
              display: "flex",
              flexDirection: "column",
              gap: 8,
              border: oversized ? "1px solid var(--qz-warn, #c98a00)" : undefined,
            }}
          >
            <div
              className="qz-row qz-row-between"
              style={{ alignItems: "center", gap: 8 }}
            >
              <strong style={{ fontSize: 14 }}>{c.name || "Untitled"}</strong>
              <QzBadge tone={empty || oversized ? "warn" : "ok"}>
                {c.productIds.length} product{c.productIds.length === 1 ? "" : "s"}
              </QzBadge>
            </div>
            {oversized ? (
              <div className="qz-dim" style={{ fontSize: 11, color: "var(--qz-warn, #a8730a)" }}>
                Large group — may dominate recommendations.
              </div>
            ) : null}
            {c.source && c.source !== "manual" ? (
              <div className="qz-dim" style={{ fontSize: 11 }}>
                from {c.source.replace(/_/g, " ")}
              </div>
            ) : null}
            {empty ? (
              <div className="qz-dim" style={{ fontSize: 12 }}>
                No products yet — edit to add some.
              </div>
            ) : (
              <ul
                style={{
                  margin: 0,
                  paddingLeft: 16,
                  fontSize: 12,
                  color: "var(--qz-ink-2)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                }}
              >
                {sample.map((t, i) => (
                  <li
                    key={i}
                    style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {t}
                  </li>
                ))}
                {remainder > 0 ? (
                  <li style={{ listStyle: "none", marginLeft: -16 }} className="qz-dim">
                    +{remainder} more
                  </li>
                ) : null}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
