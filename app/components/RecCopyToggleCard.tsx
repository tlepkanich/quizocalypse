import { useFetcher } from "@remix-run/react";
import { QzCard } from "./qz";

// LOGIC v2 L2-12d — the per-shop kill switch for the runtime rec-copy feature
// (Shop.aiRecCopyEnabled). Shared by the standalone (studio.integrations) and
// embedded (app.settings) settings pages; both host a `toggle-rec-copy` action
// that writes the column. Read LIVE by the /q loader + re-checked by the
// endpoint, so a flip takes effect with NO republish.
export function RecCopyToggleCard({ enabled }: { enabled: boolean }) {
  const fetcher = useFetcher<{ ok: boolean; aiRecCopyEnabled: boolean }>();
  // Optimistic: reflect the in-flight submit immediately.
  const on = fetcher.formData ? fetcher.formData.get("enabled") === "true" : enabled;
  return (
    <QzCard>
      <div className="qz-col qz-gap-12">
        <div>
          <div className="qz-label">Shopper AI</div>
          <h2 className="qz-h2" style={{ margin: "6px 0 0" }}>
            Personalized recommendation copy
          </h2>
        </div>
        <label className="qz-rp2-field qz-rp2-check" style={{ alignItems: "flex-start" }}>
          <input
            type="checkbox"
            checked={on}
            disabled={fetcher.state !== "idle"}
            onChange={(e) =>
              fetcher.submit(
                { intent: "toggle-rec-copy", enabled: String(e.target.checked) },
                { method: "post" },
              )
            }
          />
          <span>
            Generate a fresh “why we recommend this” paragraph for each shopper
            <span className="qz-dim" style={{ display: "block", fontSize: 11.5, maxWidth: "56ch" }}>
              On (default): decider quizzes personalize the result copy per shopper at quiz time,
              grounded in the matched product. Off: shoppers see your saved copy — zero per-shopper
              AI cost. Flips instantly; no republish needed.
            </span>
          </span>
        </label>
      </div>
    </QzCard>
  );
}
