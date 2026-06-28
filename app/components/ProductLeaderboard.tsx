import type { CSSProperties } from "react";

// PP3 — the per-product performance table, shared by BOTH analytics dashboards
// (standalone /studio + embedded /app) so the two surfaces can't drift (they feed
// it the same productPerformance() output over the same Event rows). Read-only,
// server-rendered, no client JS.

export interface LeaderboardRow {
  productId: string;
  title: string;
  imageUrl: string | null;
  impressions: number;
  clicks: number;
  addToCart: number;
  ctr: number;
  atcRate: number;
}

export function ProductLeaderboard({ rows }: { rows: LeaderboardRow[] }) {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: "left", color: "var(--qz-ink-2, #666)" }}>
            <th style={{ padding: "10px 20px", fontWeight: 600 }}>Product</th>
            <th style={thNum}>Shown</th>
            <th style={thNum}>Clicks</th>
            <th style={thNum}>CTR</th>
            <th style={thNum}>Added</th>
            <th style={thNum}>Add rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.productId}>
              <td style={{ padding: "10px 20px", borderTop: "1px solid var(--qz-rule, #eee)" }}>
                <span className="qz-row qz-gap-8" style={{ alignItems: "center" }}>
                  {r.imageUrl ? (
                    <img
                      src={r.imageUrl}
                      alt={r.title}
                      width={36}
                      height={36}
                      loading="lazy"
                      style={{
                        borderRadius: 6,
                        objectFit: "cover",
                        border: "1px solid var(--qz-rule, #eee)",
                        flexShrink: 0,
                      }}
                    />
                  ) : (
                    <span
                      aria-hidden
                      style={{ width: 36, height: 36, borderRadius: 6, background: "var(--qz-cream-2, #f3efe6)", flexShrink: 0 }}
                    />
                  )}
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 280 }}>
                    {r.title}
                  </span>
                </span>
              </td>
              <td style={tdNum}>{r.impressions}</td>
              <td style={tdNum}>{r.clicks}</td>
              <td style={tdNum}>{pct(r.ctr)}</td>
              <td style={tdNum}>{r.addToCart}</td>
              <td style={tdNum}>{pct(r.atcRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const thNum: CSSProperties = { padding: "10px 20px", fontWeight: 600, textAlign: "right", whiteSpace: "nowrap" };
const tdNum: CSSProperties = {
  padding: "10px 20px",
  textAlign: "right",
  borderTop: "1px solid var(--qz-rule, #eee)",
  whiteSpace: "nowrap",
  fontVariantNumeric: "tabular-nums",
  fontWeight: 600,
};
