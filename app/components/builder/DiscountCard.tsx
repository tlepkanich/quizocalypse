import { QzBadge, QzCard, QzField, QzInput, QzSelect } from "../qz";
import type { StepProps } from "./stepProps";

// Quiz-level discount config (Phase 5). When enabled, publishing creates a real
// Shopify code discount; each result page opts into showing/applying it via its
// "Show discount" toggle (include_discount in ResultSettingsPanel). The badge +
// auto-applied code appear on the storefront after re-publishing.

type DiscountConfig = StepProps["doc"]["discount_config"];

export function DiscountCard({ doc, onCommit }: Pick<StepProps, "doc" | "onCommit">) {
  const cfg = doc.discount_config;
  const set = (patch: Partial<DiscountConfig>) =>
    onCommit({ ...doc, discount_config: { ...cfg, ...patch } });
  // Changing the value/kind/gate must invalidate an already-created code so the
  // next publish creates a fresh Shopify discount (otherwise the badge would
  // promise one amount while checkout applies the stale one).
  const setAmount = (patch: Partial<DiscountConfig>) => set({ ...patch, code: undefined });

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
              </QzSelect>
            </QzField>
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
            <QzField label="Code label">
              <QzInput value={cfg.title} onChange={(e) => set({ title: e.target.value })} placeholder="Quiz reward" />
            </QzField>
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
