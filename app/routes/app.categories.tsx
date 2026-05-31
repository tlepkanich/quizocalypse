// app/routes/app.categories.tsx
// Admin page for shopper-archetype categories. v3 adds a "Group by"
// on-ramp above the resulting grid: merchants can let Claude discover
// archetypes (AI-assisted), partition the catalog along a deterministic
// dimension (collections / smart collections / tags / product type /
// metafield) via /api/categories/group, or hand-assemble buckets in a
// click-to-assign manual builder. The category grid below always reflects
// whatever was last saved.

import { useMemo, useState } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  QzPage,
  QzPageHeader,
  QzCard,
  QzButton,
  QzBanner,
  QzTooltip,
  QzSelect,
  QzField,
  QzInput,
} from "../components/qz";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
  });
  if (!shop) {
    return json({
      categories: [],
      productCount: 0,
      collections: [],
      products: [],
      hasProducts: false,
      shopDomain: session.shop,
    });
  }
  const [categories, productCount, collections, products] = await Promise.all([
    prisma.category.findMany({
      where: { shopId: shop.id },
      orderBy: { createdAt: "asc" },
    }),
    prisma.product.count({ where: { shopId: shop.id } }),
    prisma.collection.findMany({
      where: { shopId: shop.id },
      orderBy: { title: "asc" },
    }),
    // Lightweight id+title list powering the manual builder. Capped so the
    // page payload stays reasonable for large catalogs.
    prisma.product.findMany({
      where: { shopId: shop.id },
      orderBy: { title: "asc" },
      select: { productId: true, title: true },
      take: 500,
    }),
  ]);
  return json({
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      tags: c.tags,
      productCount: c.productIds.length,
      rationale: c.rationale,
      source: c.source,
      createdAt: c.createdAt.toISOString(),
    })),
    productCount,
    collections: collections.map((c) => ({
      id: c.collectionId,
      title: c.title,
    })),
    products: products.map((p) => ({ id: p.productId, title: p.title })),
    hasProducts: productCount > 0,
    shopDomain: session.shop,
  });
};

// Shared response shape for both /api/categories/discover and
// /api/categories/group — discover adds rationale, group adds source.
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
    rationale?: string | null;
    source?: string;
  }>;
}

type Mode =
  | "manual"
  | "collection"
  | "smart_collection"
  | "tag"
  | "product_type"
  | "metafield"
  | "ai";

const MODE_OPTIONS: Array<{ value: Mode; label: string }> = [
  { value: "manual", label: "Manual" },
  { value: "collection", label: "Shopify Collections" },
  { value: "smart_collection", label: "Smart Collections" },
  { value: "tag", label: "Existing tags" },
  { value: "product_type", label: "Product type" },
  { value: "metafield", label: "Metafields" },
  { value: "ai", label: "AI-assisted" },
];

interface ManualBucket {
  key: string;
  name: string;
  productIds: string[];
}

export default function CategoriesPage() {
  const { categories, productCount, collections, products } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<GroupingResponse>();
  const isWorking = fetcher.state !== "idle" && fetcher.formMethod === "POST";

  const [mode, setMode] = useState<Mode>("manual");
  // Optional narrowing inputs per mode.
  const [collectionRef, setCollectionRef] = useState("");
  const [tagRef, setTagRef] = useState("");
  const [typeRef, setTypeRef] = useState("");
  const [metafieldKey, setMetafieldKey] = useState("");

  // Manual builder state.
  const [buckets, setBuckets] = useState<ManualBucket[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(
    null,
  );

  // Show the freshly-saved set when present (e.g. immediately after a
  // click), otherwise fall back to the loader's persisted list.
  const liveCategories =
    fetcher.data?.ok && fetcher.data.categories
      ? fetcher.data.categories.map((c) => ({
          ...c,
          createdAt: new Date().toISOString(),
        }))
      : categories;

  const hasCategories = liveCategories.length > 0;

  const assignedProductIds = useMemo(() => {
    const set = new Set<string>();
    for (const bucket of buckets) {
      for (const id of bucket.productIds) set.add(id);
    }
    return set;
  }, [buckets]);

  const unassignedProducts = useMemo(
    () => products.filter((p) => !assignedProductIds.has(p.id)),
    [products, assignedProductIds],
  );

  const productTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of products) map.set(p.id, p.title);
    return map;
  }, [products]);

  const discover = () => {
    fetcher.submit({}, { method: "POST", action: "/api/categories/discover" });
  };

  const generateGroups = () => {
    const body: Record<string, string> = { source: mode };
    if (mode === "collection" || mode === "smart_collection") {
      if (collectionRef) body.sourceRef = collectionRef;
    } else if (mode === "tag") {
      if (tagRef.trim()) body.sourceRef = tagRef.trim();
    } else if (mode === "product_type") {
      if (typeRef.trim()) body.sourceRef = typeRef.trim();
    } else if (mode === "metafield") {
      body.metafieldKey = metafieldKey.trim();
    }
    fetcher.submit(body, {
      method: "POST",
      action: "/api/categories/group",
    });
  };

  const saveManual = () => {
    const groups = buckets.map((b) => ({
      name: b.name,
      productIds: b.productIds,
    }));
    fetcher.submit(
      { source: "manual", groups: JSON.stringify(groups) },
      { method: "POST", action: "/api/categories/group" },
    );
  };

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
    setBuckets((prev) =>
      prev.map((b) => (b.key === key ? { ...b, name } : b)),
    );
  };

  const removeBucket = (key: string) => {
    setBuckets((prev) => prev.filter((b) => b.key !== key));
  };

  // Click-to-assign: pick a product on the left, then click a bucket to
  // drop it in. Clicking an already-selected product deselects it.
  const assignToBucket = (key: string) => {
    if (!selectedProductId) return;
    setBuckets((prev) =>
      prev.map((b) =>
        b.key === key && !b.productIds.includes(selectedProductId)
          ? { ...b, productIds: [...b.productIds, selectedProductId] }
          : b,
      ),
    );
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

  const manualCanSave = buckets.some(
    (b) => b.name.trim() !== "" || b.productIds.length > 0,
  );

  const tooFewProducts = productCount < 5;

  return (
    <QzPage>
      <TitleBar title="Categories" />
      <QzPageHeader
        eyebrow="Categories"
        title={
          <>
            Group your catalog into{" "}
            <span className="qz-serif-italic">archetypes</span>.
          </>
        }
        subtitle="Build the shopper buckets your quiz result pages point at. Let Claude discover them, partition along a catalog dimension you already maintain, or hand-assemble them yourself."
      />

      <section className="qz-mt-24">
        <QzCard>
          <div className="qz-col qz-gap-16">
            <QzField
              label="Group by"
              hint="Choose how to assemble your categories. Each source overwrites the current set."
            >
              <QzSelect
                value={mode}
                onChange={(e) => setMode(e.target.value as Mode)}
              >
                {MODE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </QzSelect>
            </QzField>

            {/* AI-assisted: the original discover path. */}
            {mode === "ai" && (
              <div className="qz-row" style={{ gap: 12, alignItems: "center" }}>
                <QzButton
                  variant="accent"
                  onClick={discover}
                  disabled={isWorking || tooFewProducts}
                >
                  {isWorking
                    ? "Discovering…"
                    : hasCategories
                      ? "Re-discover"
                      : "Discover categories"}
                </QzButton>
                <span className="qz-muted" style={{ fontSize: 13 }}>
                  Claude reads your catalog and proposes 5–9 archetypes.
                </span>
              </div>
            )}

            {/* Shopify / smart collections: optional single-collection narrow. */}
            {(mode === "collection" || mode === "smart_collection") && (
              <div className="qz-col qz-gap-12">
                <QzField
                  label="Collection (optional)"
                  hint="Leave on “All collections” to make one group per collection, or pick one to generate just that group."
                >
                  <QzSelect
                    value={collectionRef}
                    onChange={(e) => setCollectionRef(e.target.value)}
                  >
                    <option value="">All collections</option>
                    {collections.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </QzSelect>
                </QzField>
                <div>
                  <QzButton
                    variant="accent"
                    onClick={generateGroups}
                    disabled={isWorking || tooFewProducts}
                  >
                    {isWorking ? "Generating…" : "Generate groups"}
                  </QzButton>
                </div>
              </div>
            )}

            {/* Tags: optional single-tag narrow. */}
            {mode === "tag" && (
              <div className="qz-col qz-gap-12">
                <QzField
                  label="Tag (optional)"
                  hint="Leave blank to group by every tag (top 12 by size), or type one tag to make a single group."
                >
                  <QzInput
                    value={tagRef}
                    placeholder="e.g. waterproof"
                    onChange={(e) => setTagRef(e.target.value)}
                  />
                </QzField>
                <div>
                  <QzButton
                    variant="accent"
                    onClick={generateGroups}
                    disabled={isWorking || tooFewProducts}
                  >
                    {isWorking ? "Generating…" : "Generate groups"}
                  </QzButton>
                </div>
              </div>
            )}

            {/* Product type: optional single-type narrow. */}
            {mode === "product_type" && (
              <div className="qz-col qz-gap-12">
                <QzField
                  label="Product type (optional)"
                  hint="Leave blank to group by every product type, or type one to make a single group."
                >
                  <QzInput
                    value={typeRef}
                    placeholder="e.g. Serum"
                    onChange={(e) => setTypeRef(e.target.value)}
                  />
                </QzField>
                <div>
                  <QzButton
                    variant="accent"
                    onClick={generateGroups}
                    disabled={isWorking || tooFewProducts}
                  >
                    {isWorking ? "Generating…" : "Generate groups"}
                  </QzButton>
                </div>
              </div>
            )}

            {/* Metafields: key required. */}
            {mode === "metafield" && (
              <div className="qz-col qz-gap-12">
                <QzField
                  label="Metafield key"
                  hint="Namespace + key, e.g. custom.skin_type. One group per distinct value."
                >
                  <QzInput
                    value={metafieldKey}
                    placeholder="custom.skin_type"
                    onChange={(e) => setMetafieldKey(e.target.value)}
                  />
                </QzField>
                <div>
                  <QzButton
                    variant="accent"
                    onClick={generateGroups}
                    disabled={
                      isWorking || tooFewProducts || metafieldKey.trim() === ""
                    }
                  >
                    {isWorking ? "Generating…" : "Generate groups"}
                  </QzButton>
                </div>
              </div>
            )}

            {/* Manual: two-pane click-to-assign builder. */}
            {mode === "manual" && (
              <ManualBuilder
                unassignedProducts={unassignedProducts}
                buckets={buckets}
                selectedProductId={selectedProductId}
                productTitleById={productTitleById}
                isWorking={isWorking}
                canSave={manualCanSave}
                onSelectProduct={(id) =>
                  setSelectedProductId((cur) => (cur === id ? null : id))
                }
                onAddBucket={addBucket}
                onRenameBucket={renameBucket}
                onRemoveBucket={removeBucket}
                onAssignToBucket={assignToBucket}
                onUnassignProduct={unassignProduct}
                onSave={saveManual}
              />
            )}
          </div>
        </QzCard>
      </section>

      {tooFewProducts && (
        <div className="qz-mt-16">
          <QzBanner tone="warn" title="Sync products first">
            We need at least 5 synced products to build meaningful groups. Run a
            catalog sync from the dashboard, then come back.
          </QzBanner>
        </div>
      )}

      {fetcher.data?.ok === false && (
        <div className="qz-mt-16">
          <QzBanner tone="crit" title="Couldn’t build groups">
            {fetcher.data.error ?? "Unknown error"}
          </QzBanner>
        </div>
      )}

      {!hasCategories ? (
        <div className="qz-mt-32">
          <QzCard dashed>
            <div className="qz-label">No categories yet</div>
            <p
              className="qz-h3 qz-mt-8"
              style={{ lineHeight: 1.4, maxWidth: "52ch" }}
            >
              Pick a <strong>Group by</strong> source above to assemble your
              shopper buckets. Each quiz can then point its result pages at the
              right archetype.
            </p>
          </QzCard>
        </div>
      ) : (
        <section
          className="qz-mt-24"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 16,
          }}
        >
          {liveCategories.map((c) => (
            <QzCard key={c.id}>
              <div className="qz-col qz-gap-12">
                <div
                  className="qz-row qz-row-between"
                  style={{ alignItems: "baseline" }}
                >
                  <h2 className="qz-h2" style={{ margin: 0, fontSize: 18 }}>
                    {c.name}
                  </h2>
                  {"rationale" in c && c.rationale ? (
                    <QzTooltip content={c.rationale}>
                      <span
                        className="qz-mono qz-dim"
                        style={{ fontSize: 11, cursor: "help" }}
                      >
                        why?
                      </span>
                    </QzTooltip>
                  ) : null}
                </div>
                {c.description ? (
                  <p
                    className="qz-muted"
                    style={{ fontSize: 13, lineHeight: 1.5, margin: 0 }}
                  >
                    {c.description}
                  </p>
                ) : null}
                <div className="qz-row" style={{ flexWrap: "wrap", gap: 4 }}>
                  {c.tags.slice(0, 6).map((t) => (
                    <span
                      key={t}
                      style={{
                        background: "var(--qz-cream-2)",
                        border: "1px solid var(--qz-rule)",
                        borderRadius: 999,
                        padding: "2px 8px",
                        fontSize: 11,
                        color: "var(--qz-ink-2)",
                      }}
                    >
                      {t}
                    </span>
                  ))}
                  {c.tags.length > 6 && (
                    <span
                      className="qz-mono qz-dim"
                      style={{ fontSize: 11, padding: "2px 4px" }}
                    >
                      +{c.tags.length - 6}
                    </span>
                  )}
                </div>
                <div
                  className="qz-mono qz-dim"
                  style={{
                    fontSize: 11,
                    paddingTop: 4,
                    borderTop: "1px solid var(--qz-rule)",
                  }}
                >
                  {c.productCount} product
                  {c.productCount === 1 ? "" : "s"} assigned
                </div>
              </div>
            </QzCard>
          ))}
        </section>
      )}
    </QzPage>
  );
}

interface ManualBuilderProps {
  unassignedProducts: Array<{ id: string; title: string }>;
  buckets: ManualBucket[];
  selectedProductId: string | null;
  productTitleById: Map<string, string>;
  isWorking: boolean;
  canSave: boolean;
  onSelectProduct: (id: string) => void;
  onAddBucket: () => void;
  onRenameBucket: (key: string, name: string) => void;
  onRemoveBucket: (key: string) => void;
  onAssignToBucket: (key: string) => void;
  onUnassignProduct: (key: string, productId: string) => void;
  onSave: () => void;
}

// Two-pane manual assigner. Left = unassigned products (click to select a
// product); right = bucket columns (click a bucket to drop the selected
// product in). Deliberately simple — no drag-drop required.
function ManualBuilder({
  unassignedProducts,
  buckets,
  selectedProductId,
  productTitleById,
  isWorking,
  canSave,
  onSelectProduct,
  onAddBucket,
  onRenameBucket,
  onRemoveBucket,
  onAssignToBucket,
  onUnassignProduct,
  onSave,
}: ManualBuilderProps) {
  return (
    <div className="qz-col qz-gap-12">
      <p className="qz-muted" style={{ fontSize: 13, margin: 0 }}>
        Click a product on the left to select it, then click a group on the
        right to assign it.{" "}
        {selectedProductId ? (
          <strong>
            Selected: {productTitleById.get(selectedProductId) ?? "product"}
          </strong>
        ) : (
          "No product selected."
        )}
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(220px, 280px) 1fr",
          gap: 16,
          alignItems: "start",
        }}
      >
        {/* Left: unassigned products */}
        <div
          style={{
            border: "1px solid var(--qz-rule)",
            borderRadius: "var(--qz-radius)",
            padding: 12,
            maxHeight: 420,
            overflowY: "auto",
          }}
        >
          <div className="qz-label" style={{ marginBottom: 8 }}>
            Unassigned ({unassignedProducts.length})
          </div>
          <div className="qz-col qz-gap-4">
            {unassignedProducts.length === 0 ? (
              <span className="qz-dim" style={{ fontSize: 12 }}>
                Everything is assigned.
              </span>
            ) : (
              unassignedProducts.map((p) => {
                const isSelected = p.id === selectedProductId;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onSelectProduct(p.id)}
                    style={{
                      textAlign: "left",
                      fontSize: 12,
                      padding: "6px 8px",
                      borderRadius: 6,
                      border: "1px solid",
                      borderColor: isSelected
                        ? "var(--qz-ink)"
                        : "var(--qz-rule)",
                      background: isSelected
                        ? "var(--qz-cream-2)"
                        : "transparent",
                      cursor: "pointer",
                      color: "var(--qz-ink-2)",
                    }}
                  >
                    {p.title}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right: bucket columns */}
        <div className="qz-col qz-gap-12">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
              gap: 12,
            }}
          >
            {buckets.map((bucket) => (
              <div
                key={bucket.key}
                style={{
                  border: "1px solid var(--qz-rule)",
                  borderRadius: "var(--qz-radius)",
                  padding: 12,
                }}
              >
                <div
                  className="qz-row qz-row-between"
                  style={{ alignItems: "center", marginBottom: 8 }}
                >
                  <QzInput
                    value={bucket.name}
                    placeholder="Group name"
                    onChange={(e) => onRenameBucket(bucket.key, e.target.value)}
                    style={{ fontSize: 13 }}
                  />
                  <button
                    type="button"
                    onClick={() => onRemoveBucket(bucket.key)}
                    aria-label="Remove group"
                    className="qz-mono qz-dim"
                    style={{
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      fontSize: 14,
                      padding: "0 4px",
                    }}
                  >
                    ×
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => onAssignToBucket(bucket.key)}
                  disabled={!selectedProductId}
                  style={{
                    width: "100%",
                    fontSize: 11,
                    padding: "4px 8px",
                    borderRadius: 6,
                    border: "1px dashed var(--qz-rule)",
                    background: "transparent",
                    cursor: selectedProductId ? "pointer" : "not-allowed",
                    color: "var(--qz-ink-2)",
                    marginBottom: 8,
                  }}
                >
                  + Assign selected
                </button>
                <div className="qz-col qz-gap-4">
                  {bucket.productIds.length === 0 ? (
                    <span className="qz-dim" style={{ fontSize: 11 }}>
                      No products yet.
                    </span>
                  ) : (
                    bucket.productIds.map((id) => (
                      <div
                        key={id}
                        className="qz-row qz-row-between"
                        style={{
                          alignItems: "center",
                          fontSize: 12,
                          gap: 6,
                        }}
                      >
                        <span style={{ color: "var(--qz-ink-2)" }}>
                          {productTitleById.get(id) ?? id}
                        </span>
                        <button
                          type="button"
                          onClick={() => onUnassignProduct(bucket.key, id)}
                          aria-label="Remove product"
                          className="qz-mono qz-dim"
                          style={{
                            background: "transparent",
                            border: "none",
                            cursor: "pointer",
                            fontSize: 13,
                          }}
                        >
                          ×
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="qz-row" style={{ gap: 12 }}>
            <QzButton variant="ghost" onClick={onAddBucket}>
              + Add group
            </QzButton>
            <QzButton
              variant="accent"
              onClick={onSave}
              disabled={isWorking || !canSave}
            >
              {isWorking ? "Saving…" : "Save groups"}
            </QzButton>
          </div>
        </div>
      </div>
    </div>
  );
}
