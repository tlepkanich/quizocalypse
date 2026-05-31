import { useState } from "react";
import { StepPreview } from "../runtime/StepPreview";
import { QzBadge, QzBanner, QzButton, QzCard, QzField, QzInput, QzSelect } from "../qz";
import type { StepProps } from "./stepProps";

type Launcher = StepProps["doc"]["launcher_config"];

// Step 5 — "Quick walkthrough". Steps through the ordered flow rendering each
// node via the SAME StepPreview the builder uses, so it always reflects the
// current (unsaved) draft. A link to the live storefront preview is offered for
// the published version.

export function Step5Preview({
  doc,
  onCommit,
  productIndex,
  categories,
  ordered,
  previewUrl,
}: StepProps) {
  const steps = ordered.steps;
  const [idx, setIdx] = useState(0);
  const [bp, setBp] = useState<"desktop" | "mobile">("desktop");
  const width = bp === "mobile" ? 375 : 600;

  const lc = doc.launcher_config;
  const setLauncher = (patch: Partial<Launcher>) =>
    onCommit({ ...doc, launcher_config: { ...lc, ...patch } });

  const current = steps[Math.min(idx, steps.length - 1)];
  const node = current ? doc.nodes.find((n) => n.id === current.nodeId) ?? null : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="qz-row qz-row-between" style={{ alignItems: "center" }}>
        <div>
          <h2 className="qz-h1" style={{ margin: 0 }}>
            Quick walkthrough
          </h2>
          <p className="qz-dim" style={{ marginTop: 4 }}>
            Step {steps.length ? idx + 1 : 0} of {steps.length} ·{" "}
            {node ? node.type.replace("_", " ") : "—"}
          </p>
        </div>
        <div className="qz-row" style={{ gap: 6, alignItems: "center" }}>
          {(["desktop", "mobile"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setBp(m)}
              className={`qz-btn qz-btn-sm${bp === m ? " qz-btn-primary" : " qz-btn-ghost"}`}
            >
              {m === "desktop" ? "Desktop" : "Mobile"}
            </button>
          ))}
          <a href={previewUrl} target="_blank" rel="noreferrer" className="qz-btn qz-btn-ghost qz-btn-sm">
            Open live ↗
          </a>
        </div>
      </div>

      <QzBanner tone="default" title="This walkthrough reflects your current draft">
        The live link above shows the last <strong>published</strong> version. Publish to push these
        changes live.
      </QzBanner>

      <div className="qz-card" style={{ padding: 16, background: "#FAFAFA" }}>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <div style={{ width, maxWidth: "100%" }}>
            {node ? (
              <StepPreview doc={doc} node={node} productIndex={productIndex} categories={categories} breakpoint={bp} />
            ) : (
              <p className="qz-dim">No reachable steps to preview.</p>
            )}
          </div>
        </div>
      </div>

      <div className="qz-row qz-row-between" style={{ alignItems: "center" }}>
        <QzButton size="sm" variant="ghost" disabled={idx === 0} onClick={() => setIdx((i) => i - 1)}>
          ← Previous
        </QzButton>
        <div className="qz-row" style={{ gap: 4 }}>
          {steps.map((s, i) => (
            <span
              key={s.nodeId}
              title={s.type}
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: i === idx ? "var(--qz-ink, #222)" : "#00000022",
              }}
            />
          ))}
        </div>
        <QzButton
          size="sm"
          variant="ghost"
          disabled={idx >= steps.length - 1}
          onClick={() => setIdx((i) => i + 1)}
        >
          Next →
        </QzButton>
      </div>

      {ordered.orphans.length > 0 ? (
        <QzBadge tone="warn">{ordered.orphans.length} unreachable step(s) — fix in Page builder</QzBadge>
      ) : null}

      <QzCard style={{ padding: 16 }}>
        <div
          className="qz-row qz-row-between"
          style={{ alignItems: "center", marginBottom: lc.enabled ? 12 : 0 }}
        >
          <div>
            <strong style={{ fontSize: 14 }}>Floating launcher</strong>
            <div className="qz-dim" style={{ fontSize: 12 }}>
              Add a floating button that opens the quiz in a pop-up on your storefront (alongside
              the inline embed).
            </div>
          </div>
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13 }}>
            <input
              type="checkbox"
              checked={lc.enabled}
              onChange={(e) => setLauncher({ enabled: e.target.checked })}
            />
            Enabled
          </label>
        </div>
        {lc.enabled ? (
          <div className="qz-row" style={{ gap: 16, flexWrap: "wrap" }}>
            <QzField label="Icon">
              <QzSelect
                value={lc.icon}
                onChange={(e) => setLauncher({ icon: e.target.value as Launcher["icon"] })}
              >
                <option value="sparkle">Sparkle</option>
                <option value="star">Star</option>
                <option value="chat">Chat</option>
              </QzSelect>
            </QzField>
            <QzField label="Corner">
              <QzSelect
                value={lc.corner}
                onChange={(e) => setLauncher({ corner: e.target.value as Launcher["corner"] })}
              >
                <option value="bottom-right">Bottom right</option>
                <option value="bottom-left">Bottom left</option>
                <option value="top-right">Top right</option>
                <option value="top-left">Top left</option>
              </QzSelect>
            </QzField>
            <QzField label="Label (optional)">
              <QzInput
                value={lc.label}
                onChange={(e) => setLauncher({ label: e.target.value })}
                placeholder="Take the quiz"
              />
            </QzField>
          </div>
        ) : null}
      </QzCard>
    </div>
  );
}
