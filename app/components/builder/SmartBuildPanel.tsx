import { useState } from "react";
import { QzBadge, QzBanner, QzButton, QzCard, QzField, QzSelect, QzTextarea } from "../qz";

// Step 4 "Generate with AI" — product-first Smart Build. Given the merchant's
// goal + a few flow toggles, the server (intent=generate-questions) generates
// the question flow + a routing branch that maps shoppers to the buckets from
// Step 1. Re-running replaces the generated flow.

export interface SmartBuildParams {
  goalPrompt: string;
  questionCount: number;
  tone: "friendly" | "editorial" | "playful" | "professional";
  flow: { welcome_message: boolean; email_gate: boolean; mixed_input_types: boolean };
}

const TONES: SmartBuildParams["tone"][] = ["friendly", "editorial", "playful", "professional"];

export function SmartBuildPanel({
  onGenerate,
  generating,
  error,
  brandVoiceName,
  hasBuckets,
  bucketCount,
  defaultOpen,
}: {
  onGenerate: (p: SmartBuildParams) => void;
  generating: boolean;
  error?: string | null;
  brandVoiceName?: string | null;
  hasBuckets: boolean;
  bucketCount: number;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const [goalPrompt, setGoalPrompt] = useState("");
  const [questionCount, setQuestionCount] = useState(5);
  const [tone, setTone] = useState<SmartBuildParams["tone"]>("friendly");
  const [flow, setFlow] = useState({
    welcome_message: false,
    email_gate: false,
    mixed_input_types: false,
  });

  const toggle = (k: keyof typeof flow) => setFlow((f) => ({ ...f, [k]: !f[k] }));

  return (
    <QzCard flush style={{ marginBottom: 16, overflow: "hidden" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "12px 16px",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span className="qz-row" style={{ gap: 10, alignItems: "center" }}>
          <span style={{ fontSize: 18 }}>✦</span>
          <span style={{ display: "flex", flexDirection: "column" }}>
            <strong style={{ fontSize: 14 }}>Generate with AI</strong>
            <span className="qz-dim" style={{ fontSize: 12 }}>
              Build the question flow that routes shoppers to your {bucketCount} bucket
              {bucketCount === 1 ? "" : "s"}
            </span>
          </span>
        </span>
        <span className="qz-dim">{open ? "▾" : "▸"}</span>
      </button>

      {open ? (
        <div style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
          {!hasBuckets ? (
            <QzBanner tone="warn" title="No buckets yet">
              Group products into outcome buckets in Step 1 first — Smart Build routes the questions
              to those result pages.
            </QzBanner>
          ) : null}

          {brandVoiceName ? (
            <div>
              <QzBadge tone="ok">Brand voice: {brandVoiceName}</QzBadge>
            </div>
          ) : null}

          <QzField label="What should this quiz help shoppers find?" hint="Optional — we'll infer from your catalog + buckets if blank.">
            <QzTextarea
              value={goalPrompt}
              onChange={(e) => setGoalPrompt(e.target.value.slice(0, 500))}
              rows={2}
              placeholder="e.g. Help shoppers find the right skincare routine for their skin type"
            />
          </QzField>

          <div className="qz-row" style={{ gap: 16, flexWrap: "wrap" }}>
            <QzField label={`Questions: ${questionCount}`}>
              <input
                type="range"
                min={3}
                max={8}
                value={questionCount}
                onChange={(e) => setQuestionCount(Number(e.target.value))}
              />
            </QzField>
            <QzField label="Tone">
              <QzSelect value={tone} onChange={(e) => setTone(e.target.value as SmartBuildParams["tone"])}>
                {TONES.map((t) => (
                  <option key={t} value={t}>
                    {t[0]!.toUpperCase() + t.slice(1)}
                  </option>
                ))}
              </QzSelect>
            </QzField>
          </div>

          <div>
            <div className="qz-label" style={{ marginBottom: 6 }}>
              Add to the flow
            </div>
            <div className="qz-row" style={{ gap: 14, flexWrap: "wrap" }}>
              <Check label="Welcome message" on={flow.welcome_message} onClick={() => toggle("welcome_message")} />
              <Check label="Email capture" on={flow.email_gate} onClick={() => toggle("email_gate")} />
              <Check label="Mixed input types" on={flow.mixed_input_types} onClick={() => toggle("mixed_input_types")} />
            </div>
          </div>

          {error ? (
            <QzBanner tone="crit" title="Generation failed">
              {error}
            </QzBanner>
          ) : null}

          <div className="qz-row" style={{ gap: 10, alignItems: "center" }}>
            <QzButton
              variant="primary"
              size="sm"
              disabled={!hasBuckets || generating}
              onClick={() => onGenerate({ goalPrompt, questionCount, tone, flow })}
            >
              {generating ? "Generating…" : "Generate questions"}
            </QzButton>
            <span className="qz-dim" style={{ fontSize: 12 }}>
              Re-running replaces the generated flow (your manual steps are kept).
            </span>
          </div>
        </div>
      ) : null}
    </QzCard>
  );
}

function Check({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13 }}>
      <input type="checkbox" checked={on} onChange={onClick} />
      {label}
    </label>
  );
}
