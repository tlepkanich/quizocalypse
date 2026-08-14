import { useMemo, useState } from "react";
import { Link } from "@remix-run/react";
import type { Quiz } from "../../lib/quizSchema";
import { swapScoringModel } from "../../lib/quizMutations";
import { LogicView } from "../logic/LogicView";
import { LogicPathsTab } from "./LogicPathsTab";
import { LogicTabCard } from "./logicTab/LogicTabCard";
import {
  deciderQuestion,
  orderedQuestions,
} from "../../lib/questionOrder";
import { TranslationsPanel } from "./TranslationsPanel";
import { ExperiencePanel } from "./ExperiencePanel";
import { CssTab } from "./panels/CssTab";
import { PLACEMENTS, type StudioBuilderData } from "./studioShared";

// ════════════════════════════════════════════════════════════════════════════
// BLD-4 → QZY-6 — the never-was-logic surfaces:
//   • BuilderLogicView — the Logic workspace view. Decider docs get the
//     artifact's two stacked cards (Rules, Questions — QRTZ-G3); Paths keeps
//     a quiet link below them (probe-covered path exploration); legacy docs
//     keep LogicView. Try-a-path left this view (ContextPanel and the
//     diagnose modal still mount PathTester).
//   • QuizSettingsView — the rail's Settings SECTION (build-tab spec §1:
//     "Integrations/embed/code live in Settings"): Experience & scoring ·
//     placement · Share & embed · Translation · per-step Custom CSS (the old
//     Code rail tool) · the Currency/Trivia/UTM coming-soons. Replaces the
//     old ⋯-menu QuizSettingsDrawer.
// ════════════════════════════════════════════════════════════════════════════

type QuizDoc = Quiz;

export function BuilderLogicView({
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
  const isDecider = doc.logic_model === "decider";
  const questions = useMemo(() => orderedQuestions(doc), [doc]);
  const decider = useMemo(() => deciderQuestion(doc), [doc]);
  // QRTZ-G3 — the artifact draws no tabs on the Logic screen: the Logic|Paths
  // pair is gone. Paths (probe-covered path exploration, DECISIONS "surface
  // fate") stays reachable behind a quiet toggle link below the cards.
  const [showPaths, setShowPaths] = useState(false);

  if (!isDecider) {
    // Legacy scoring docs: the existing mapping surface (it embeds its own
    // flow map + Try-a-path) until they upgrade to decider logic.
    return (
      <LogicView
        quizId={data.quizId}
        doc={doc}
        onCommit={commit}
        productIndex={data.productIndex}
        categories={data.categories}
        abAnalytics={data.abAnalytics}
      />
    );
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <LogicTabCard
        doc={doc}
        questions={questions}
        categories={data.categories}
        collections={data.collections}
        productIndex={data.productIndex}
        commit={commit}
        quizId={data.quizId}
        lastSyncAt={data.lastSyncAt ?? null}
        shopifyAdminDomain={data.shopifyAdminDomain ?? null}
      />

      {/* QRTZ-G3 — Paths behind a quiet secondary affordance (no tabs). */}
      <div className="qz-ltab-pathsrow">
        <button
          type="button"
          className="qz-ltab-pathslink"
          aria-expanded={showPaths}
          onClick={() => setShowPaths((v) => !v)}
        >
          {showPaths ? "Hide the path explorer" : "Explore every path →"}
        </button>
      </div>
      {showPaths ? (
        <LogicPathsTab
          doc={doc}
          questions={questions}
          deciderId={decider?.id ?? null}
          categories={data.categories}
          onSelectNode={onSelectNode}
        />
      ) : null}
    </div>
  );
}

export function QuizSettingsView({
  data,
  doc,
  commit,
  onSelectNode,
  selectedNodeId,
  onUpgradeDecider,
}: {
  data: StudioBuilderData;
  doc: QuizDoc;
  commit: (doc: QuizDoc) => void;
  onSelectNode: (nodeId: string | null) => void;
  /** Pre-selects the Custom-CSS step picker (the Build view's selection). */
  selectedNodeId?: string | null;
  /** QRTZ-H4 — opens the legacy→decider upgrade wizard (host-owned modal).
   *  The scoring/decider cluster moved here from the top bar (the mock's
   *  .ed-top draws no badges — the info lives in Settings). */
  onUpgradeDecider?: () => void;
}) {
  const placement = doc.placement ?? "page";
  // The old Code rail tool, folded in: per-step scoped custom CSS.
  const [cssNodeId, setCssNodeId] = useState<string>(
    selectedNodeId ?? doc.nodes[0]?.id ?? "",
  );
  const cssNode = doc.nodes.find((n) => n.id === cssNodeId) ?? null;

  return (
    <div style={{ display: "grid", gap: 22, maxWidth: 720 }}>
      {/* BLD-3 — the page header now comes from the host's mock .tphd. */}
      <section>
        <div className="qz-label" style={{ fontSize: 11, marginBottom: 8 }}>
          Experience &amp; scoring
        </div>
        <ExperiencePanel doc={doc} onCommit={commit} onSelectNode={onSelectNode} />
        {/* QRTZ-H4 — the top-bar badges retired (the mock draws none): the
            scoring model + decider info live here. Decider docs read their
            one line; legacy docs keep the model swap + the explicit upgrade
            wizard entry (L2-10f), byte-identical behavior. */}
        {doc.logic_model === "decider" ? (
          <p className="qz-dim" style={{ fontSize: 12.5, margin: "10px 0 0" }}>
            <strong>Decider logic</strong> — one deciding question picks the
            result; advanced rules can override it.
          </p>
        ) : (
          (() => {
            const m = doc.scoring_model ?? "direct";
            const other = m === "direct" ? "weighted" : "direct";
            return (
              <div className="qz-row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="qz-btn qz-btn-ghost qz-btn-sm"
                  style={{ fontSize: 12 }}
                  title={`Scoring: ${m === "direct" ? "Direct mapping" : "Weighted scoring"} — click to switch (both models are saved)`}
                  onClick={() => commit(swapScoringModel(doc, other))}
                >
                  {m === "direct" ? "Direct mapping" : "Weighted scoring"}
                </button>
                {onUpgradeDecider ? (
                  <button
                    type="button"
                    className="qz-btn qz-btn-ghost qz-btn-sm"
                    style={{ fontSize: 12 }}
                    title="Convert this draft to Decider logic — one deciding question, rule overrides, a single configurable results page"
                    onClick={onUpgradeDecider}
                  >
                    ↑ Upgrade to Decider logic
                  </button>
                ) : null}
              </div>
            );
          })()
        )}
      </section>

      <section>
        <div className="qz-label" style={{ fontSize: 11, marginBottom: 8 }}>
          Where the quiz appears
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
            gap: 8,
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
        <p className="qz-dim" style={{ fontSize: 12.5, margin: "10px 0 0" }}>
          Send captured emails/phones to Klaviyo or your own webhook by adding an{" "}
          <strong>Integration</strong> step in the Editor. Captured contacts also appear
          under <strong>Customers</strong>.
        </p>
      </section>

      <section>
        <div className="qz-label" style={{ fontSize: 11, marginBottom: 8 }}>
          Share &amp; embed
        </div>
        <p className="qz-dim" style={{ fontSize: 12.5, margin: "0 0 8px" }}>
          The public quiz link, the storefront embed snippet, and QR sharing.
        </p>
        <Link
          to={`/studio/${data.quizId}/embed`}
          className="qz-btn qz-btn-ghost qz-btn-sm"
          style={{ textDecoration: "none", display: "inline-flex" }}
        >
          Open share &amp; embed →
        </Link>
      </section>

      <section>
        <div className="qz-label" style={{ fontSize: 11, marginBottom: 8 }}>
          Translation
        </div>
        <TranslationsPanel doc={doc} onApply={commit} previewUrl={data.previewUrl} />
      </section>

      <section>
        <div className="qz-label" style={{ fontSize: 11, marginBottom: 8 }}>
          Custom CSS
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          <select
            aria-label="Step to style"
            value={cssNodeId}
            onChange={(e) => setCssNodeId(e.target.value)}
            style={{
              font: "inherit",
              fontSize: 12.5,
              padding: "6px 8px",
              borderRadius: "var(--qz-radius)",
              border: "1px solid var(--qz-rule)",
              background: "var(--qz-paper)",
              maxWidth: 320,
            }}
          >
            {doc.nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {("headline" in n.data && n.data.headline) ||
                  ("text" in n.data && n.data.text) ||
                  n.type}
              </option>
            ))}
          </select>
          {cssNode ? <CssTab doc={doc} node={cssNode} onCommit={commit} /> : null}
        </div>
      </section>

      <p className="qz-dim" style={{ fontSize: 12, margin: 0 }}>
        Coming soon: per-market <strong>currency</strong> formatting · <strong>trivia</strong>{" "}
        mode · <strong>UTM</strong> campaign tagging on product links.
      </p>
    </div>
  );
}
