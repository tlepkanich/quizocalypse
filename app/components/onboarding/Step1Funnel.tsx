import { lazy, Suspense, useEffect, useState } from "react";
import { Link, useFetcher, useRevalidator } from "@remix-run/react";
import { QzPage, QzCard, QzBanner, StagedProgress } from "../qz";
import { QzModal } from "../qz-overlays";
import { QuestionBuilderStage } from "./QuestionBuilderStage";
import { RecommendationStage } from "./RecommendationStage";
import { TopBar } from "../chrome/TopBar";
import { StepNav, type StepNavStep } from "../chrome/StepNav";
import { ClientOnly, BuilderSkeleton } from "../studio/ClientOnly";
import { RecommendationBucketsStage } from "./stages/RecommendationBucketsStage";
import { ShapeStage } from "./stages/ShapeStage";
import { DesignStage } from "./stages/DesignStage";
import { RecPageStage } from "./stages/RecPageStage";
import { Step4Results } from "./stages/Step4Results";
import { FUNNEL_STAGES, type ActionResult, type FunnelData } from "./stages/stagesShared";

// BIC-2 C2 — the loader shape (and the other cross-stage types) moved to
// stages/stagesShared.ts; re-exported here so importers of this module keep
// their contract.
export type { FunnelData } from "./stages/stagesShared";

// Builder Re-work Step 1 — the shared, server-free creation funnel. Renders one
// of four stages off the draft's build_session and drives every transition
// through ONE fetcher (the nested route's action). Mirrors how BrandIdentityReview
// is shared verbatim by the studio + embedded brand routes; the embedded twin
// (S6) wraps this same component with an admin-backed loader.


// BIC-2 C2 — the four RETIRED stage UIs (goal / battle-card "configuring" /
// overview / templates+done) are reachable only by pre-flip in-flight drafts,
// so they live in a lazy chunk the active funnel path never downloads.
const LegacyFunnelStages = lazy(() => import("./stages/LegacyFunnelStages"));
const LEGACY_STAGE_KEYS: ReadonlySet<FunnelData["stage"]> = new Set([
  "goal",
  "configuring",
  "overview",
  "templates",
  "done",
]);

export function Step1Funnel({ data }: { data: FunnelData }) {
  const fetcher = useFetcher<ActionResult>();
  const revalidator = useRevalidator();
  const pendingIntent =
    fetcher.state !== "idle" ? String(fetcher.formData?.get("intent") ?? "") : null;
  const result = fetcher.state === "idle" ? fetcher.data ?? null : null;
  const errorMsg = result && result.ok === false ? result.error : null;

  // The brand identity is a tap-to-open overlay (kept out of the header so the
  // page leads with the actual task, not a paragraph of summary).
  const [showIdentity, setShowIdentity] = useState(false);
  const [leaveSetupOpen, setLeaveSetupOpen] = useState(false);

  // QL3-P5 — the Step-3 v3 shell is active for EVERY decider doc on the
  // question_builder stage (the ?step3=v3 flag is retired). It renders its OWN
  // floating top bar (TopBar3, same wordmark + step pills), so the standard
  // sticky bar steps aside — the spec's Step-3 has exactly one bar.
  const step3V3Active =
    data.stage === "question_builder" &&
    data.questionBuilder?.doc.logic_model === "decider";

  // Poll the loader while a detached generation job runs (typing/templating);
  // the job writes the next stage, the revalidate picks it up, the poll stops.
  // FAST F3 — 1500ms (was 3000): the loader is cheap and this halves both the
  // stage-flip latency and the gen_progress checkpoint latency.
  const isGenerating = data.stage === "typing" || data.stage === "templating";
  useEffect(() => {
    if (!isGenerating) return;
    const t = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, 1500);
    return () => clearInterval(t);
  }, [isGenerating, revalidator]);

  // §7.6 — the bar's right zone carries the PRIMARY Continue. Step-3 adopted
  // this with TopBar3 (◆ Continue, destination-named); steps 4 and 5 had kept
  // their pre-DS in-page footers (a bottom-left ← Back · Continue row that
  // scrolled out of view, and step 5's said "Open builder →"). Their primary
  // action moves here — same anatomy as step 3's — and the footers retire.
  const navBusy = fetcher.state !== "idle";
  const shapeVisible = visibleStageKey(data.stage) === "types";
  const stageNav =
    data.stage === "rec_page" ? (
      <>
        <button
          type="button"
          className="qz-btn qz-btn-ghost qz-btn-sm"
          disabled={navBusy}
          onClick={() => fetcher.submit({ intent: "to-question-builder" }, { method: "post" })}
        >
          ← Back
        </button>
        <button
          type="button"
          className="qz-btn qz-btn-sm qz-s3-continue qz-btn-accent"
          disabled={navBusy}
          onClick={() => fetcher.submit({ intent: "to-design" }, { method: "post" })}
        >
          {pendingIntent === "to-design" ? "Saving…" : "◆ Continue to Design"}
        </button>
      </>
    ) : data.stage === "design" ? (
      <>
        <button
          type="button"
          className="qz-btn qz-btn-ghost qz-btn-sm"
          disabled={navBusy}
          onClick={() => fetcher.submit({ intent: "to-rec-page" }, { method: "post" })}
        >
          ← Back
        </button>
        <button
          type="button"
          className="qz-btn qz-btn-sm qz-s3-continue qz-btn-accent"
          disabled={navBusy}
          onClick={() => fetcher.submit({ intent: "generate-build" }, { method: "post" })}
        >
          {pendingIntent === "generate-build" ? "Opening builder…" : "◆ Open builder"}
        </button>
      </>
    ) : null;

  return (
    <>
      {/* Design-system-V2 §7.6 — the creation flow's sticky top bar: wordmark ·
          step-nav pills · ancillary actions + the stage's primary Continue.
          Replaces the old QzPageHeader + FunnelProgress dots (each stage
          renders its own page-title zone). Hidden while the Step-3 v3 shell
          renders its own floating bar. */}
      {step3V3Active ? null : (
      <TopBar
        center={<FunnelStepNav stage={data.stage} />}
        right={
          <>
            {data.identitySummary && !shapeVisible ? (
              <button
                type="button"
                className="qz-btn qz-btn-ghost qz-btn-sm"
                onClick={() => setShowIdentity(true)}
              >
                ✦ Brand identity
              </button>
            ) : null}
            {shapeVisible ? (
              <button type="button" className="qz-btn qz-btn-ghost qz-btn-sm" onClick={() => setLeaveSetupOpen(true)}>
                ← Homepage
              </button>
            ) : (
              <Link to="/studio" className="qz-btn qz-btn-ghost qz-btn-sm">
                ← All quizzes
              </Link>
            )}
            {stageNav}
          </>
        }
      />
      )}
    <QzPage wide>
      {showIdentity && data.identitySummary ? (
        <BrandIdentityModal summary={data.identitySummary} onClose={() => setShowIdentity(false)} />
      ) : null}
      {leaveSetupOpen ? (
        <QzModal
          open
          onClose={() => setLeaveSetupOpen(false)}
          size="sm"
          title="Leave setup?"
          footer={
            <>
              <button type="button" className="qz-btn qz-btn-ghost" onClick={() => setLeaveSetupOpen(false)}>Stay here</button>
              <Link to="/studio" className="qz-btn qz-btn-accent">Go to homepage</Link>
            </>
          }
        >
          <p className="qz-dim" style={{ margin: 0 }}>
            Your quiz is saved as a draft. You can return and finish setup at any time.
          </p>
        </QzModal>
      ) : null}

      {errorMsg ? (
        <QzBanner tone="crit" title="That didn't go through">
          {errorMsg}
        </QzBanner>
      ) : null}

      {/* An AI generation job failed (e.g. the AI is unavailable). Surface it
          honestly with a template fallback instead of silently stranding the
          merchant on a stage that won't advance. */}
      {data.genError ? (
        <QzBanner tone="warn" title="AI generation didn't finish">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <span>{data.genError}</span>
            <Link to="/studio/new" className="qz-btn qz-btn-accent qz-btn-sm" style={{ alignSelf: "flex-start" }}>
              Start from a template →
            </Link>
          </div>
        </QzBanner>
      ) : null}

      {/* The detached AI job stopped writing without throwing — almost always a
          server restart that KILLED the job mid-run, which no try/catch can
          catch. The poll would otherwise spin forever on the spinner below, so
          offer an honest re-run (re-kicks the same job from the saved session)
          plus the reliable template escape. */}
      {data.genStalled && !data.genError ? (
        <QzBanner tone="warn" title="This is taking longer than it should">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <span>
              The generation step seems to have stalled — the server may have
              restarted while it was working. Re-run it, or start from a
              ready-made template.
            </span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="qz-btn qz-btn-accent qz-btn-sm"
                disabled={pendingIntent === "retry-gen"}
                onClick={() => fetcher.submit({ intent: "retry-gen" }, { method: "post" })}
              >
                {pendingIntent === "retry-gen" ? "Restarting…" : "Try again"}
              </button>
              <Link to="/studio/new" className="qz-btn qz-btn-ghost qz-btn-sm">
                Start from a template →
              </Link>
            </div>
          </div>
        </QzBanner>
      ) : null}

      {data.stage === "grouping" ? (
        <RecommendationBucketsStage
          data={data}
          fetcher={fetcher}
          pendingIntent={pendingIntent}
          result={result}
        />
      ) : null}

      {/* Legacy stages — in-flight drafts from before the funnel re-sequence.
          Lazy: a resumed legacy draft may show one brief blank frame while the
          chunk loads (fallback null); the active path never fetches it. */}
      {LEGACY_STAGE_KEYS.has(data.stage) ? (
        <Suspense fallback={null}>
          <LegacyFunnelStages
            stage={data.stage}
            data={data}
            fetcher={fetcher}
            pendingIntent={pendingIntent}
          />
        </Suspense>
      ) : null}

      {data.stage === "typing" ? (
        <GeneratingScreen kind="typing" progress={data.genProgress} />
      ) : null}

      {data.stage === "types" ? (
        <ShapeStage data={data} fetcher={fetcher} pendingIntent={pendingIntent} />
      ) : null}

      {data.stage === "templating" ? (
        <GeneratingScreen kind="templating" progress={data.genProgress} />
      ) : null}

      {/* Question Builder — the pre-config editing step. Client-only: it composes
          the heavy builder panels (FlowRail / ContextPanel / live preview) which
          throw hydration errors when SSR'd (the admin-builder lesson). */}
      {data.stage === "question_builder" && data.questionBuilder ? (
        <ClientOnly fallback={<BuilderSkeleton />}>
          {() => (
            <QuestionBuilderStage
              quizId={data.quizId}
              initialDoc={data.questionBuilder!.doc}
              categories={data.questionBuilder!.categories}
              productIndex={data.questionBuilder!.productIndex}
              collections={data.collections}
              fetcher={fetcher}
              pendingIntent={pendingIntent}
              designTokens={data.designTokens}
            />
          )}
        </ClientOnly>
      ) : null}


      {data.stage === "design" ? (
        <DesignStage data={data} fetcher={fetcher} pendingIntent={pendingIntent} />
      ) : null}

      {/* Results reveal — QZY-5: decider drafts get the LIGHT step-4 surface
          (quiz-results-step4 v1.0); legacy built drafts keep the heavy
          RecommendationStage (now the dashboard-class advanced editor), and
          unbuilt legacy drafts the lean RecPageStage. All client-only. */}
      {data.stage === "rec_page" && data.recPage ? (
        <ClientOnly fallback={<BuilderSkeleton />}>
          {() =>
            data.recPage!.doc.logic_model === "decider" ? (
              <Step4Results
                quizId={data.quizId}
                initialDoc={data.recPage!.doc}
                categories={data.recPage!.categories}
                productIndex={data.recPage!.productIndex}
                designTokens={data.designTokens}
              />
            ) : (
              <RecommendationStage
                quizId={data.quizId}
                initialDoc={data.recPage!.doc}
                categories={data.recPage!.categories}
                productIndex={data.recPage!.productIndex}
                collections={data.collections}
              />
            )
          }
        </ClientOnly>
      ) : data.stage === "rec_page" ? (
        <RecPageStage data={data} fetcher={fetcher} pendingIntent={pendingIntent} />
      ) : null}

    </QzPage>
    </>
  );
}

// Map transient/legacy stages onto their owning visible step. `goal` is gone from
// the flow (folded into Shape) → it maps to Shape; `overview`/`generate`/`done`
// are retired → they map to Design (the new terminal visible step) so a legacy
// in-flight draft parked there still shows a sensible bar position.
function visibleStageKey(stage: FunnelData["stage"]): string {
  if (
    stage === "typing" ||
    stage === "templates" ||
    stage === "shape" ||
    stage === "goal"
  )
    return "types";
  // "templating" now spans template-gen AND the early question build → Questions.
  if (stage === "templating" || stage === "configuring") return "question_builder";
  if (stage === "overview" || stage === "done" || stage === "generate") return "design";
  return stage;
}

// The top bar's step pills (V2 §7.6): done ✓ · current gold-wash ◆ · upcoming
// muted. Renders through the shared StepNav; navigation stays with each
// stage's own Back/Continue intents for now (done-pill jumps are a later
// wiring — StepNav simply omits onStepClick so done pills are inert).
function FunnelStepNav({ stage }: { stage: FunnelData["stage"] }) {
  const activeIdx = FUNNEL_STAGES.findIndex((s) => s.key === visibleStageKey(stage));
  const steps: StepNavStep[] = FUNNEL_STAGES.map((s, i) => ({
    id: s.key,
    label: s.label,
    number: i + 1,
    state: i < activeIdx ? "done" : i === activeIdx ? "current" : "upcoming",
  }));
  return <StepNav steps={steps} />;
}

// The brand identity summary, opened on demand from the funnel header so the page
// leads with the task instead of a paragraph of summary. Read-only here — the full
// view/edit lives on the Brand Identity tab.
function BrandIdentityModal({ summary, onClose }: { summary: string; onClose: () => void }) {
  return (
    <QzModal
      open
      onClose={onClose}
      size="md"
      title="Current brand identity"
      footer={
        <Link to="/studio/brand" className="qz-btn qz-btn-ghost qz-btn-sm">
          View &amp; edit full identity →
        </Link>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6 }}>{summary}</p>
        <p className="qz-dim" style={{ margin: 0, fontSize: 12 }}>
          The AI uses this to tailor every quiz it builds.
        </p>
      </div>
    </QzModal>
  );
}

// ══ Step 2 ══════════════════════════════════════════════════════════════════

const TYPING_BEATS = ["Researching quiz strategies", "Reading your catalog", "Drafting tailored quiz types"];
const TEMPLATING_BEATS = ["Reading your brand identity", "Designing template variations", "Tuning the design dials"];

// FAST F3 — map the jobs' REAL gen_progress checkpoints onto the beat indexes.
// typing: "research" = the live web-research pass; "types" = the type cards
// are being drafted. templating: "templates" = the battle-card pass;
// "questions" = the long question build. Unknown/absent → timed fallback.
const PROGRESS_BEAT: Record<"typing" | "templating", Record<string, number>> = {
  typing: { research: 0, types: 2 },
  templating: { templates: 1, questions: 2 },
};

// The "AI in flight" screen for the detached typing/templating jobs. The parent
// polls the loader; this just animates the staged beats while we wait.
// FAST F3 — when the loader reports a real gen_progress checkpoint, it drives
// the active beat; the timed cycle stays as the fallback for old in-flight
// sessions (and for the window before the first checkpoint lands).
function GeneratingScreen({
  kind,
  progress,
}: {
  kind: "typing" | "templating";
  progress: string | null;
}) {
  const beats = kind === "typing" ? TYPING_BEATS : TEMPLATING_BEATS;
  const progressBeat = progress !== null ? (PROGRESS_BEAT[kind][progress] ?? null) : null;
  const [timedActive, setTimedActive] = useState(0);
  useEffect(() => {
    if (timedActive >= beats.length - 1) return;
    const t = setTimeout(() => setTimedActive((b) => b + 1), kind === "typing" ? 18000 : 12000);
    return () => clearTimeout(t);
  }, [timedActive, beats.length, kind]);
  // A real checkpoint never moves backwards; once seen it wins over the timer.
  const active = progressBeat ?? timedActive;
  const title =
    kind === "typing"
      ? "Researching the best quiz types for your brand…"
      : "Designing your templates…";
  const sub =
    kind === "typing"
      ? "Pulling real best-practices for your category, then tailoring a few quiz types to your catalog. About a minute."
      : "Drafting a few distinct template directions for the type you picked. About 30 seconds.";
  return (
    <QzCard style={{ padding: 28, display: "flex", flexDirection: "column", gap: 18 }}>
      <style>{`@keyframes qzspin{to{transform:rotate(360deg)}}`}</style>
      <div className="qz-row" style={{ gap: 12, alignItems: "center" }}>
        <div
          aria-hidden
          style={{
            width: 26,
            height: 26,
            flex: "none",
            borderRadius: "50%",
            border: "3px solid var(--qz-rule, #e5e5e5)",
            borderTopColor: "var(--qz-accent)",
            animation: "qzspin .8s linear infinite",
          }}
        />
        <div style={{ display: "flex", flexDirection: "column" }}>
          <strong>{title}</strong>
          <span className="qz-dim" style={{ fontSize: 13 }}>{sub}</span>
        </div>
      </div>
      <div style={{ maxWidth: 340 }}>
        <StagedProgress stages={beats} active={active} />
      </div>
      <div className="qz-dim" style={{ fontSize: 12 }}>This page refreshes itself — no need to reload.</div>
    </QzCard>
  );
}
