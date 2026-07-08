import { useMemo, useState } from "react";
import { Link } from "@remix-run/react";
import type { Quiz } from "../../lib/quizSchema";
import { LogicView } from "../logic/LogicView";
import { PathTester } from "../logic/PathTester";
import { LogicScroll } from "../onboarding/questionsLogicV3/logic/LogicScroll";
import { LogicPathsTab } from "./LogicPathsTab";
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
//     questionsLogicV3 LogicScroll (sections per question, distributed rules)
//     with the Try-a-path tester below; legacy docs keep LogicView.
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
  const [activeId, setActiveId] = useState<string>("");
  // QZY-R8 (LV1) — Map · Paths · Table tabs over ONE dataset (the doc). Map owns
  // add/remove structure; Paths/Table are live projections (R1's engine).
  const [logicTab, setLogicTab] = useState<"map" | "paths" | "table">("map");

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

  const tabs: Array<{ key: "map" | "paths" | "table"; label: string }> = [
    { key: "map", label: "Map" },
    { key: "paths", label: "Paths" },
    { key: "table", label: "Table" },
  ];

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 22, letterSpacing: "-0.01em" }}>Logic</h2>
        <p className="qz-dim" style={{ fontSize: 13, margin: "6px 0 0", maxWidth: 640 }}>
          Every answer&rsquo;s route, per question — the deciding question picks the result,
          rules override it. The Map edits structure; Paths and Table are live views of the
          same flow.
        </p>
      </div>
      <div className="qz-logic-tabs" role="tablist" aria-label="Logic views">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={logicTab === t.key}
            className={`qz-logic-tab${logicTab === t.key ? " is-active" : ""}`}
            onClick={() => setLogicTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {logicTab === "map" ? (
        <>
          <LogicScroll
            doc={doc}
            questions={questions}
            deciderId={decider?.id ?? null}
            categories={data.categories}
            collections={data.collections}
            productIndex={data.productIndex}
            captureOn={doc.rec_page_settings?.global?.captureEmail !== false}
            activeId={activeId}
            onActiveChange={setActiveId}
            onCommit={commit}
          />
          {/* PathTester renders its own "Try a path" header. */}
          <PathTester doc={doc} productIndex={data.productIndex} categories={data.categories} />
        </>
      ) : null}

      {logicTab === "paths" ? (
        <LogicPathsTab
          doc={doc}
          questions={questions}
          deciderId={decider?.id ?? null}
          categories={data.categories}
          onSelectNode={onSelectNode}
        />
      ) : null}

      {logicTab === "table" ? (
        <div className="qz-card" style={{ padding: 16 }}>
          <p className="qz-dim" style={{ margin: 0, fontSize: 13 }}>
            The Table view — one row per result, expandable to every path, with
            override-writes-a-rule — lands next (QZY-R9).
          </p>
        </div>
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
}: {
  data: StudioBuilderData;
  doc: QuizDoc;
  commit: (doc: QuizDoc) => void;
  onSelectNode: (nodeId: string | null) => void;
  /** Pre-selects the Custom-CSS step picker (the Build view's selection). */
  selectedNodeId?: string | null;
}) {
  const placement = doc.placement ?? "page";
  // The old Code rail tool, folded in: per-step scoped custom CSS.
  const [cssNodeId, setCssNodeId] = useState<string>(
    selectedNodeId ?? doc.nodes[0]?.id ?? "",
  );
  const cssNode = doc.nodes.find((n) => n.id === cssNodeId) ?? null;

  return (
    <div style={{ display: "grid", gap: 22, maxWidth: 720 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 22, letterSpacing: "-0.01em" }}>Settings</h2>
        <p className="qz-dim" style={{ fontSize: 13, margin: "6px 0 0", maxWidth: 640 }}>
          Everything that isn&rsquo;t the quiz itself — experience &amp; scoring, where it
          appears, sharing &amp; embedding, translation, and custom code.
        </p>
      </div>

      <section>
        <div className="qz-label" style={{ fontSize: 11, marginBottom: 8 }}>
          Experience &amp; scoring
        </div>
        <ExperiencePanel doc={doc} onCommit={commit} onSelectNode={onSelectNode} />
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
