import { QzBadge, QzInput } from "../qz";
import type { BranchNode, FunnelCounts } from "../../lib/abAnalytics";

// One A/B test (an ab_split branch) on the Logic tab: editable per-variant
// weights (e.g. 30/70), each variant's downstream page, and a per-variant
// funnel ("analytics on both"). Weight edits flow up via onSetWeight → the doc;
// the funnel is read-only (loader-supplied).

export interface SlotTarget {
  label: string;
  nodeId: string | null;
}

function pct(n: number, total: number): number {
  return total > 0 ? Math.round((n / total) * 100) : 0;
}

function rate(numer: number, denom: number): string {
  return denom > 0 ? `${Math.round((numer / denom) * 100)}%` : "—";
}

export function AbTestCard({
  branch,
  funnel,
  slotTargets,
  onSetWeight,
}: {
  branch: BranchNode;
  funnel: Record<string, FunnelCounts> | undefined;
  slotTargets: Record<string, SlotTarget>;
  onSetWeight: (slotId: string, weight: number) => void;
}) {
  const slots = branch.data.slots;
  const totalWeight = slots.reduce((s, sl) => s + sl.weight, 0);

  return (
    <div className="qz-card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="qz-row qz-row-between" style={{ alignItems: "center" }}>
        <strong style={{ fontSize: 14 }}>{branch.data.label || "A/B test"}</strong>
        <QzBadge tone="ok">A/B split</QzBadge>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {slots.map((slot) => {
          const f = funnel?.[slot.id];
          const target = slotTargets[slot.id];
          const share = pct(slot.weight, totalWeight);
          return (
            <div
              key={slot.id}
              style={{
                border: "1px solid #00000012",
                borderRadius: 10,
                padding: 10,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div className="qz-row qz-row-between" style={{ alignItems: "center", gap: 10 }}>
                <div className="qz-row" style={{ gap: 8, alignItems: "center", minWidth: 0 }}>
                  <span
                    aria-hidden
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 6,
                      background: "var(--qz-accent, #2a6df4)",
                      color: "#fff",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 12,
                      fontWeight: 700,
                      flex: "0 0 auto",
                    }}
                  >
                    {slot.label.slice(0, 1).toUpperCase()}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>Variant {slot.label}</div>
                    <div className="qz-dim" style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      → {target?.label ?? "Not wired"}
                    </div>
                  </div>
                </div>
                <div className="qz-row" style={{ gap: 8, alignItems: "center", flex: "0 0 auto" }}>
                  <div style={{ width: 64 }}>
                    <QzInput
                      type="number"
                      min={0}
                      value={String(slot.weight)}
                      onChange={(e) => onSetWeight(slot.id, Number(e.target.value))}
                      aria-label={`Variant ${slot.label} weight`}
                    />
                  </div>
                  <span className="qz-mono qz-tnum" style={{ fontSize: 13, fontWeight: 700, width: 40, textAlign: "right" }}>
                    {share}%
                  </span>
                </div>
              </div>

              {/* per-variant funnel — `entered` is the baseline (assignment
                  happens at the branch, so quiz_started isn't variant-tagged) */}
              <div className="qz-row" style={{ gap: 14, fontSize: 11.5 }}>
                <FunnelStat label="Entered" value={f?.entered ?? 0} />
                <FunnelStat label="Completed" value={f?.completed ?? 0} sub={rate(f?.completed ?? 0, f?.entered ?? 0)} />
                <FunnelStat label="Clicked" value={f?.clicked ?? 0} sub={rate(f?.clicked ?? 0, f?.entered ?? 0)} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="qz-dim" style={{ fontSize: 11 }}>
        Weights are whole numbers; shares are normalized. Re-publish to apply weight changes to live traffic.
      </div>
    </div>
  );
}

function FunnelStat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.3 }}>
      <span className="qz-dim" style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.3 }}>
        {label}
      </span>
      <span className="qz-mono qz-tnum" style={{ fontWeight: 700 }}>
        {value}
        {sub ? <span className="qz-dim" style={{ fontWeight: 400 }}> · {sub}</span> : null}
      </span>
    </div>
  );
}
