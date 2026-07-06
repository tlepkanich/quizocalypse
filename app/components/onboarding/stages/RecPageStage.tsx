// BIC-2 C2 — the lean Rec-Page stage (stage "rec_page" WITHOUT a built draft —
// the legacy-draft fallback; built drafts render RecommendationStage instead)
// extracted from Step1Funnel.tsx as a PURE MOVE. Only the imports are new.
import type { useFetcher } from "@remix-run/react";
import { QzCard, QzField, QzInput, QzSelect } from "../../qz";
import type { RecDefaults } from "../../../lib/quizSchema";
import { OOS_LABEL, type ActionResult, type FunnelData } from "./stagesShared";

// ── Recommendation Page — tune how results show (per the Rec-Page spec) ───────
// First cut: the global rec defaults (products-per-result + OOS behavior) that the
// BattleCard used to hold, now a discrete step. Writes picked_template.rec_defaults
// via the existing set-rec intent; the build applies it. (Per-bucket sections,
// sort, sub-filter, discount, etc. are later cuts.)
export function RecPageStage({
  data,
  fetcher,
  pendingIntent,
}: {
  data: FunnelData;
  fetcher: ReturnType<typeof useFetcher<ActionResult>>;
  pendingIntent: string | null;
}) {
  // Built draft → edit the result NODES directly (set-result-rec); the build
  // already baked rec_defaults onto them, so editing picked_template would no-op.
  // Legacy in-flight draft (no build yet) → edit picked_template.rec_defaults.
  const onNodes = data.recNodeDefaults;
  const picked = data.pickedTemplate;
  const rec: RecDefaults | undefined = onNodes
    ? { max_products: onNodes.max_products, oos_behavior: onNodes.oos_behavior, fallback_collection_id: "" }
    : picked?.rec_defaults;
  const saveIntent = onNodes ? "set-result-rec" : "set-rec";
  const saving = pendingIntent === saveIntent;
  const setRec = (patch: Partial<RecDefaults>) => {
    if (!rec) return;
    fetcher.submit({ intent: saveIntent, rec: JSON.stringify({ ...rec, ...patch }) }, { method: "post" });
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <QzCard style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div className="qz-label">Recommendation</div>
          <h2 className="qz-h2" style={{ margin: 0 }}>How should results show?</h2>
          <p className="qz-dim" style={{ margin: 0, fontSize: 13 }}>
            Set how many products to recommend and what happens when one is out of stock. Fine-tune
            per-page details later in the builder.
          </p>
        </div>
        {rec ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <QzField label="Products per result">
              <QzInput
                type="number"
                min={1}
                max={12}
                value={rec.max_products}
                disabled={saving}
                onChange={(e) =>
                  setRec({ max_products: Math.max(1, Math.min(12, Number(e.target.valueAsNumber) || 3)) })
                }
              />
            </QzField>
            <QzField label="When a product is out of stock">
              <QzSelect
                value={rec.oos_behavior}
                disabled={saving}
                onChange={(e) => setRec({ oos_behavior: e.target.value as RecDefaults["oos_behavior"] })}
              >
                {(Object.entries(OOS_LABEL) as Array<[RecDefaults["oos_behavior"], string]>).map(
                  ([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ),
                )}
              </QzSelect>
            </QzField>
          </div>
        ) : (
          <p className="qz-dim" style={{ margin: 0, fontSize: 13 }}>No template selected yet.</p>
        )}
      </QzCard>
      {/* §7.6 — Back/Continue live in the funnel top bar now (stageNav). */}
    </div>
  );
}
