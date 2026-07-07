import { useMemo, useState } from "react";
import type { Quiz } from "../../lib/quizSchema";
import { LogicView } from "../logic/LogicView";
import { PathTester } from "../logic/PathTester";
import { LogicScroll } from "../onboarding/questionsLogicV3/logic/LogicScroll";
import {
  deciderQuestion,
  orderedQuestions,
} from "../../lib/questionOrder";
import { TranslationsPanel } from "./TranslationsPanel";
import { ExperiencePanel } from "./ExperiencePanel";
import { QzDrawer } from "../qz-overlays";
import { PLACEMENTS, type StudioBuilderData } from "./studioShared";

// ════════════════════════════════════════════════════════════════════════════
// BLD-4 — the old QB-3 "Settings" screen (Quizell's 8 top-tabs) split honestly
// in two:
//   • BuilderLogicView — the Logic workspace view. Decider docs get the
//     questionsLogicV3 LogicScroll (sections per question, distributed rules,
//     flag-tab) with the Try-a-path tester below; legacy docs keep LogicView
//     (mapping + its own path tester).
//   • QuizSettingsDrawer — everything that was never logic (Score/experience,
//     Translation, placement + notifications, and the Currency/Trivia/UTM
//     coming-soons compressed to one line) in a QzDrawer off the ⋯ menu.
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
    <div style={{ display: "grid", gap: 20 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 22, letterSpacing: "-0.01em" }}>Logic</h2>
        <p className="qz-dim" style={{ fontSize: 13, margin: "6px 0 0", maxWidth: 640 }}>
          Every answer&rsquo;s route, per question — the deciding question picks the result,
          rules override it. Edit a rule inline, or jump to a question&rsquo;s content in the
          Build view.
        </p>
      </div>
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
    </div>
  );
}

export function QuizSettingsDrawer({
  data,
  doc,
  commit,
  onSelectNode,
  open,
  onClose,
}: {
  data: StudioBuilderData;
  doc: QuizDoc;
  commit: (doc: QuizDoc) => void;
  onSelectNode: (nodeId: string | null) => void;
  open: boolean;
  onClose: () => void;
}) {
  const placement = doc.placement ?? "page";
  return (
    <QzDrawer open={open} onClose={onClose} title="Quiz settings" width="520px">
      <div style={{ display: "grid", gap: 22 }}>
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
            Translation
          </div>
          <TranslationsPanel doc={doc} onApply={commit} previewUrl={data.previewUrl} />
        </section>

        <p className="qz-dim" style={{ fontSize: 12, margin: 0 }}>
          Coming soon: per-market <strong>currency</strong> formatting · <strong>trivia</strong>{" "}
          mode · <strong>UTM</strong> campaign tagging on product links.
        </p>
      </div>
    </QzDrawer>
  );
}
