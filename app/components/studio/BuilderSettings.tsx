import { useState } from "react";
import type { Quiz } from "../../lib/quizSchema";
import { LogicView } from "../logic/LogicView";
import { PathTester } from "../logic/PathTester";
import { TranslationsPanel } from "./TranslationsPanel";
import { ExperiencePanel } from "./ExperiencePanel";
import { ComingSoon } from "./ComingSoon";
import { PLACEMENTS, type StudioBuilderData } from "./studioShared";

// QB-3 — Quizell's Settings is a full-width screen with its own top-tabs. We map
// the 5 tabs backed by real features to existing surfaces and stub the 3 we
// don't have yet (Currency / Trivia / UTM) as honest "Coming soon" panels — the
// user chose all-8-with-stubs for tab-row fidelity.

type QuizDoc = Quiz;

type TabKey =
  | "product_match"
  | "jump_logic"
  | "translation"
  | "score"
  | "currency"
  | "trivia"
  | "notification"
  | "utm";

const TABS: { key: TabKey; label: string; help?: string }[] = [
  { key: "product_match", label: "Product match", help: "How each answer maps to the products you recommend." },
  { key: "jump_logic", label: "Jump logic", help: "Branch the flow and route each answer to the right step." },
  { key: "translation", label: "Translation", help: "Serve the quiz in multiple languages." },
  { key: "score", label: "Score", help: "The experience type and how answers are scored." },
  { key: "currency", label: "Currency" },
  { key: "trivia", label: "Trivia" },
  { key: "notification", label: "Notification", help: "Email capture and marketing integrations." },
  { key: "utm", label: "UTM" },
];

export function BuilderSettings({
  data,
  doc,
  commit,
  onSelectNode,
}: {
  data: StudioBuilderData;
  doc: QuizDoc;
  commit: (doc: QuizDoc) => void;
  onSelectNode: (nodeId: string | null) => void;
}) {
  const [tab, setTab] = useState<TabKey>("product_match");
  const active = TABS.find((t) => t.key === tab) ?? TABS[0]!;
  const placement = doc.placement ?? "page";

  return (
    <div>
      <div className="qz-settings-head">
        <nav className="qz-settings-tabs" aria-label="Settings sections">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`qz-settings-tab${tab === t.key ? " is-active" : ""}`}
              aria-current={tab === t.key ? "page" : undefined}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        {active.help ? (
          <span className="qz-help-pill" title={active.help}>
            <span aria-hidden="true">?</span> What is {active.label}?
          </span>
        ) : null}
      </div>

      <div style={{ paddingTop: 18 }}>
        {tab === "product_match" ? (
          <LogicView
            quizId={data.quizId}
            doc={doc}
            onCommit={commit}
            productIndex={data.productIndex}
            categories={data.categories}
            abAnalytics={data.abAnalytics}
          />
        ) : tab === "jump_logic" ? (
          <div style={{ display: "grid", gap: 16 }}>
            <div className="qz-card" style={{ padding: 16 }}>
              <strong style={{ fontSize: 14 }}>Routing &amp; branching</strong>
              <p className="qz-dim" style={{ fontSize: 13, margin: "6px 0 0" }}>
                Every answer can jump to a different step. To re-point an answer, open the{" "}
                <strong>Editor</strong>, select a question, and use its <strong>Routing</strong> tab.
                Add a <strong>Branch</strong> step to split the flow by score or selection. Test any
                path below.
              </p>
            </div>
            <PathTester doc={doc} productIndex={data.productIndex} categories={data.categories} />
          </div>
        ) : tab === "translation" ? (
          <TranslationsPanel doc={doc} onApply={commit} previewUrl={data.previewUrl} />
        ) : tab === "score" ? (
          <ExperiencePanel doc={doc} onCommit={commit} onSelectNode={onSelectNode} />
        ) : tab === "notification" ? (
          <div style={{ display: "grid", gap: 16 }}>
            <div className="qz-card" style={{ padding: 16 }}>
              <strong style={{ fontSize: 14 }}>Where the quiz appears</strong>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
                  gap: 8,
                  marginTop: 10,
                }}
              >
                {PLACEMENTS.map((p) => {
                  const sel = p.value === placement;
                  return (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => commit({ ...doc, placement: p.value })}
                      title={p.hint}
                      style={{
                        textAlign: "left",
                        padding: "8px 10px",
                        borderRadius: "var(--qz-radius)",
                        cursor: "pointer",
                        fontSize: 12.5,
                        fontWeight: sel ? 600 : 400,
                        border: sel ? "2px solid var(--qz-accent)" : "1px solid var(--qz-rule)",
                        background: sel ? "var(--qz-accent-tint)" : "var(--qz-paper)",
                      }}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="qz-card" style={{ padding: 16 }}>
              <strong style={{ fontSize: 14 }}>Integrations &amp; notifications</strong>
              <p className="qz-dim" style={{ fontSize: 13, margin: "6px 0 0" }}>
                Send captured emails/phones to Klaviyo or your own webhook by adding an{" "}
                <strong>Integration</strong> step in the Editor. Captured contacts also appear under{" "}
                <strong>Customers</strong>.
              </p>
            </div>
          </div>
        ) : tab === "currency" ? (
          <ComingSoon
            title="Currency"
            blurb="Per-market currency formatting for product prices is coming soon. Prices currently show in your store's default currency."
          />
        ) : tab === "trivia" ? (
          <ComingSoon
            title="Trivia mode"
            blurb="Right/wrong scoring with a reveal — turn any quiz into a trivia game — is coming soon."
          />
        ) : (
          <ComingSoon
            title="UTM tracking"
            blurb="Auto-appending UTM parameters to recommended product links for campaign attribution is coming soon."
          />
        )}
      </div>
    </div>
  );
}
