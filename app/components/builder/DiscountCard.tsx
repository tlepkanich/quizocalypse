import { QzBadge, QzCard, QzField, QzInput, QzSelect } from "../qz";
import type { StepProps } from "./stepProps";

// Quiz-level discount config (Phase 5 + Rec-Page spec §4). When enabled,
// publishing creates a real Shopify code discount; each result page opts into
// showing/applying it via its "Show discount" toggle (include_discount in
// ResultSettingsPanel). The badge + auto-applied code appear on the storefront
// after re-publishing.

type DiscountConfig = StepProps["doc"]["discount_config"];

// A Shopify discount end date is ISO; the <input type="date"> wants YYYY-MM-DD.
const isoToDate = (iso?: string) => (iso ? iso.slice(0, 10) : "");
const dateToIso = (d: string) => (d ? new Date(`${d}T23:59:59Z`).toISOString() : undefined);

export function DiscountCard({
  doc,
  onCommit,
  collections,
}: Pick<StepProps, "doc" | "onCommit" | "collections">) {
  const cfg = doc.discount_config;
  const set = (patch: Partial<DiscountConfig>) =>
    onCommit({ ...doc, discount_config: { ...cfg, ...patch } });
  // Changing any term that affects the created code must invalidate an
  // already-created code so the next publish creates a fresh Shopify discount
  // (otherwise the badge would promise one thing while checkout applies a stale one).
  const setAmount = (patch: Partial<DiscountConfig>) => set({ ...patch, code: undefined });

  // Expiry/minimum modes are derived from which fields are set (no extra schema).
  const expiryMode = cfg.ends_at ? "date" : "none";
  const minMode = cfg.minimum_subtotal != null ? "subtotal" : cfg.minimum_quantity != null ? "quantity" : "none";

  return (
    <QzCard style={{ padding: 16 }}>
      <div className="qz-row qz-row-between" style={{ alignItems: "center", marginBottom: cfg.enabled ? 14 : 0, gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div className="qz-row" style={{ gap: 8, alignItems: "center" }}>
            <strong style={{ fontSize: 14 }}>Recommendation discount</strong>
            {cfg.code ? <QzBadge tone="ok">{cfg.code}</QzBadge> : null}
          </div>
          <div className="qz-dim" style={{ fontSize: 12, marginTop: 2 }}>
            Reward shoppers who finish the quiz. Turn it on per result page with “Show discount”.
          </div>
        </div>
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13, flex: "0 0 auto" }}>
          <input type="checkbox" checked={cfg.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          Enabled
        </label>
      </div>

      {cfg.enabled ? (
        <div className="qz-col qz-gap-12">
          <div className="qz-row" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <QzField label="Type">
              <QzSelect value={cfg.kind} onChange={(e) => setAmount({ kind: e.target.value as DiscountConfig["kind"] })}>
                <option value="percentage">Percentage off</option>
                <option value="amount">Fixed amount off</option>
                <option value="free_shipping">Free shipping</option>
              </QzSelect>
            </QzField>
            {cfg.kind !== "free_shipping" ? (
              <QzField label={cfg.kind === "percentage" ? "Percent" : "Amount"}>
                <div style={{ width: 110 }}>
                  <QzInput
                    type="number"
                    min={0}
                    max={cfg.kind === "percentage" ? 100 : undefined}
                    value={String(cfg.value)}
                    onChange={(e) => setAmount({ value: Math.max(0, Number(e.target.value) || 0) })}
                  />
                </div>
              </QzField>
            ) : null}
            <QzField label="Code label">
              <QzInput value={cfg.title} onChange={(e) => set({ title: e.target.value })} placeholder="Quiz reward" />
            </QzField>
          </div>

          {/* Applies to (spec §4) — free shipping ignores item scope. */}
          {cfg.kind !== "free_shipping" ? (
            <div className="qz-row" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
              <QzField label="Applies to">
                <QzSelect
                  value={cfg.applies_to}
                  onChange={(e) => setAmount({ applies_to: e.target.value as DiscountConfig["applies_to"] })}
                >
                  <option value="all">All products</option>
                  <option value="collections">Specific collections</option>
                  <option value="products">Specific products</option>
                </QzSelect>
              </QzField>
              {cfg.applies_to === "collections" ? (
                <QzField label="Collections" hint="Hold ⌘/Ctrl to pick several.">
                  <select
                    multiple
                    value={cfg.applies_collection_ids}
                    onChange={(e) =>
                      setAmount({
                        applies_collection_ids: Array.from(e.target.selectedOptions, (o) => o.value),
                      })
                    }
                    style={{ minWidth: 200, minHeight: 72, font: "inherit", fontSize: 13 }}
                  >
                    {collections.map((c) => (
                      <option key={c.collectionId} value={c.collectionId}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                </QzField>
              ) : null}
              {cfg.applies_to === "products" ? (
                <QzField label="Product IDs" hint="Comma-separated Shopify product GIDs.">
                  <QzInput
                    value={cfg.applies_product_ids.join(", ")}
                    placeholder="gid://shopify/Product/123, …"
                    onChange={(e) =>
                      setAmount({
                        applies_product_ids: e.target.value
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </QzField>
              ) : null}
            </div>
          ) : null}

          {/* Usage limits + expiry (spec §4). */}
          <div className="qz-row" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <QzField label="Total usage cap" hint="Blank = unlimited.">
              <div style={{ width: 130 }}>
                <QzInput
                  type="number"
                  min={1}
                  value={cfg.usage_limit != null ? String(cfg.usage_limit) : ""}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setAmount({ usage_limit: e.target.value && n >= 1 ? Math.round(n) : undefined });
                  }}
                />
              </div>
            </QzField>
            <QzField label="Expiry">
              <QzSelect
                value={expiryMode}
                onChange={(e) =>
                  setAmount({ ends_at: e.target.value === "date" ? dateToIso(isoToDate(cfg.ends_at) || new Date().toISOString().slice(0, 10)) : undefined })
                }
              >
                <option value="none">No expiry</option>
                <option value="date">Set date</option>
              </QzSelect>
            </QzField>
            {expiryMode === "date" ? (
              <QzField label="Ends on">
                <QzInput
                  type="date"
                  value={isoToDate(cfg.ends_at)}
                  onChange={(e) => setAmount({ ends_at: dateToIso(e.target.value) })}
                />
              </QzField>
            ) : null}
          </div>

          {/* Minimum order (spec §4). */}
          <div className="qz-row" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <QzField label="Minimum order">
              <QzSelect
                value={minMode}
                onChange={(e) => {
                  const m = e.target.value;
                  setAmount({
                    minimum_subtotal: m === "subtotal" ? (cfg.minimum_subtotal ?? 0) : undefined,
                    minimum_quantity: m === "quantity" ? (cfg.minimum_quantity ?? 1) : undefined,
                  });
                }}
              >
                <option value="none">None</option>
                <option value="subtotal">Minimum amount</option>
                <option value="quantity">Minimum quantity</option>
              </QzSelect>
            </QzField>
            {minMode === "subtotal" ? (
              <QzField label="Min. amount">
                <div style={{ width: 120 }}>
                  <QzInput
                    type="number"
                    min={0}
                    value={String(cfg.minimum_subtotal ?? 0)}
                    onChange={(e) => setAmount({ minimum_subtotal: Math.max(0, Number(e.target.value) || 0) })}
                  />
                </div>
              </QzField>
            ) : null}
            {minMode === "quantity" ? (
              <QzField label="Min. quantity">
                <div style={{ width: 120 }}>
                  <QzInput
                    type="number"
                    min={1}
                    value={String(cfg.minimum_quantity ?? 1)}
                    onChange={(e) => setAmount({ minimum_quantity: Math.max(1, Math.round(Number(e.target.value) || 1)) })}
                  />
                </div>
              </QzField>
            ) : null}
          </div>

          <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13 }}>
            <input
              type="checkbox"
              checked={cfg.once_per_customer}
              onChange={(e) => setAmount({ once_per_customer: e.target.checked })}
            />
            One use per customer (first purchase)
          </label>
          <p className="qz-dim" style={{ fontSize: 11.5, margin: 0 }}>
            {cfg.code
              ? "Discount code created. Re-publish after changes to keep it in sync."
              : "Publish to create the discount code in Shopify and bake it into the live quiz."}
          </p>
        </div>
      ) : null}
    </QzCard>
  );
}
