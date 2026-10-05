import { useFetcher } from "@remix-run/react";
import { CreditTag } from "./CreditTag";
import { QzCard } from "./qz";

// LOGIC v2 L2-12d — the per-shop switch for the runtime rec-copy feature
// (Shop.aiRecCopyEnabled). Opt-in: off unless the merchant turns it on. Shared by the standalone (studio.integrations) and
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
          <div className="qz-row" style={{ flexWrap: "wrap", gap: "6px 10px", marginTop: 6 }}>
            <h2 className="qz-h2">AI-written personalization</h2>
            <CreditTag feature="rec_copy" />
          </div>
        </div>
        <label className="qz-rp2-field qz-rp2-check" style={{ alignItems: "flex-start" }}>
          {/* The new design's on/off control (first-run handoff §5): a switch
              drawn on a real checkbox. */}
          <input
            type="checkbox"
            className="hm3-sw"
            checked={on}
            disabled={fetcher.state !== "idle"}
            onChange={(e) =>
              fetcher.submit(
                { intent: "toggle-rec-copy", enabled: String(e.target.checked) },
                { method: "post" },
              )
            }
          />
          <span style={{ display: "block" }}>
            Generate a fresh “why we recommend this” paragraph for each shopper
            <span className="qz-dim qz-reccopy-help">
              Off unless you turn it on. On: AI writes a “why we recommend this” paragraph for each
              shopper. Your product recommendations come from your quiz logic either way and use no
              credits.
            </span>
          </span>
        </label>
      </div>
    </QzCard>
  );
}
