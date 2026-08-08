import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Link, useFetcher, useRevalidator } from "@remix-run/react";
import { ChevronLeft } from "lucide-react";
import { QzPage, QzCard, QzBanner, QzTooltip } from "../qz";
import { QzModal } from "../qz-overlays";
import { FunnelBarContext, type FunnelBarOverride, type FunnelContinueSpec } from "./funnelChrome";
import { QuestionBuilderStage } from "./QuestionBuilderStage";
import { RecommendationStage } from "./RecommendationStage";
import { TopBar } from "../chrome/TopBar";
import { StepNav, type StepNavStep } from "../chrome/StepNav";
import { ClientOnly, BuilderSkeleton } from "../studio/ClientOnly";
import { RecommendationBucketsStage } from "./stages/RecommendationBucketsStage";
import { ShapeStage } from "./stages/ShapeStage";
import { RecPageStage } from "./stages/RecPageStage";
import { ResultsGuided } from "./resultsGuided/ResultsGuided";
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

  // One-line-chrome §1.6 — the ONE confirm in the flow: leaving the builder
  // (logo click, or back from step 1). Everything else navigates freely.
  const [leaveOpen, setLeaveOpen] = useState(false);

  // One-line-chrome — the bar is owned here (chrome stays full-bleed while the
  // page is capped); the autosaving editing stages publish their save chip /
  // health pill / Continue through this bridge instead of mounting their own
  // bars (TopBar3 is retired).
  const [barOverride, setBarOverride] = useState<FunnelBarOverride | null>(null);
  const barBridge = useMemo(() => ({ publish: setBarOverride }), []);

  // Poll the loader while a detached generation job runs (typing/templating);
  // the job writes the next stage, the revalidate picks it up, the poll stops.
  // FAST F3 — 1500ms (was 3000): the loader is cheap and this halves both the
  // stage-flip latency and the gen_progress checkpoint latency.
  const isGenerating =
    data.stage === "typing" ||
    data.stage === "templating" ||
    // FLOW-1 — the goal-first product pre-pick runs detached on the recs step;
    // poll the same way until it lands "ready"/"failed".
    (data.stage === "grouping" && data.goalFirst?.prepick === "picking");
  useEffect(() => {
    if (!isGenerating) return;
    const t = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, 1500);
    return () => clearInterval(t);
  }, [isGenerating, revalidator]);

  const navBusy = fetcher.state !== "idle";
  const visibleKey = visibleStageKey(data.stage);
  const visibleIdx = FUNNEL_STAGES.findIndex((s) => s.key === visibleKey);

  // §1.4 — finished steps are navigation: goto-stage jumps straight there, no
  // confirm (§1.5 — every step autosaves, so there is nothing to ask about).
  // Backwards-only is enforced server-side; while a generation job runs the
  // done nodes and back are inert (jumping would strand the detached job).
  const canJump = !isGenerating && !navBusy;
  const gotoStage = (stage: string) =>
    fetcher.submit({ intent: "goto-stage", stage }, { method: "post" });

  // §1.3 — back goes ONE step back; from step 1 it leaves the builder (the
  // one confirm). The label always names the destination.
  const backStep = visibleIdx > 0 ? FUNNEL_STAGES[visibleIdx - 1]! : null;
  const backLabel = backStep ? `Back to ${backStep.label}` : "Leave the builder";

  // The step's primary Continue — same place on every step. The editing
  // stages publish their own spec (autosave gates, intercepts, the Logic
  // step's fix-N-issues state); rec_page is fetcher-driven here, and the
  // fallback covers transient stages + the pre-hydration frame.
  // Design-step retirement: Results is the LAST step — its Continue opens
  // the builder directly (the look is brand-inherited; edited in the
  // builder's Design rail).
  const defaultContinue: FunnelContinueSpec =
    visibleKey === "rec_page" && !isGenerating
      ? {
          label: pendingIntent === "generate-build" ? "Opening builder…" : "Open builder",
          onClick: () => fetcher.submit({ intent: "generate-build" }, { method: "post" }),
          disabled: navBusy,
        }
      : { label: "Continue", onClick: () => {}, disabled: true };
  const cont = barOverride?.continueSpec ?? defaultContinue;

  const continueBtn = (
    <button
      type="button"
      className={`qz-topbar-continue${cont.disabled ? " is-off" : ""}${cont.blocked ? " is-blocked" : ""}`}
      disabled={cont.disabled}
      aria-haspopup={cont.blocked ? "dialog" : undefined}
      onClick={cont.disabled ? undefined : cont.onClick}
    >
      {cont.label}
    </button>
  );

  return (
    <FunnelBarContext.Provider value={barBridge}>
      {/* One-line-chrome §1 — ONE bar on all five steps: logo (home, confirms)
          · the step flow owning the free width · save chip + back + Continue.
          Replaces the two-row funnel chrome AND Step-3's floating TopBar3. */}
      <TopBar
        nav={<FunnelStepNav stage={data.stage} onStepClick={canJump ? gotoStage : undefined} />}
        onHomeClick={(e) => {
          e.preventDefault();
          setLeaveOpen(true);
        }}
        right={
          <>
            {/* Owner edit (2026-08-02) — no ambient "Saved" chip anywhere in
                the funnel; the step flow owns that width. Stages still publish
                saveChip, but FunnelSaveChip only materializes on a save ERROR
                (autosave stays silent-when-healthy, loud-when-not). */}
            {barOverride?.saveChip ?? null}
            {barOverride?.healthPill ?? null}
            <button
              type="button"
              className="qz-topbar-back"
              disabled={isGenerating || navBusy}
              title={backLabel}
              aria-label={backLabel}
              onClick={() => (backStep ? gotoStage(backStep.key) : setLeaveOpen(true))}
            >
              <ChevronLeft size={18} strokeWidth={2} aria-hidden />
            </button>
            {cont.disabled && cont.title ? (
              <QzTooltip content={cont.title}>{continueBtn}</QzTooltip>
            ) : (
              continueBtn
            )}
          </>
        }
      />
    <QzPage funnel>
      {leaveOpen ? (
        <QzModal
          open
          onClose={() => setLeaveOpen(false)}
          size="sm"
          title="Leave the builder?"
          footer={
            <>
              <button type="button" className="qz-btn qz-btn-ghost" onClick={() => setLeaveOpen(false)}>Stay here</button>
              <Link to="/studio" className="qz-btn qz-btn-accent">Leave →</Link>
            </>
          }
        >
          {/* one-line-chrome §1.6 copy (EXACT) */}
          <p className="qz-dim" style={{ margin: 0 }}>
            Everything is saved — this quiz will be waiting exactly as you left it in your
            quizzes list.
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
          merchant on a stage that won't advance. FLOW-2 — the escape targets
          /studio/templates (the Flow-3 template front door): /studio/new is a
          redirect-gated bounce back into this funnel, not a template surface. */}
      {data.genError ? (
        <QzBanner tone="warn" title="AI generation didn't finish">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <span>{data.genError}</span>
            <Link to="/studio/templates" className="qz-btn qz-btn-accent qz-btn-sm" style={{ alignSelf: "flex-start" }}>
              Start from a template →
            </Link>
          </div>
        </QzBanner>
      ) : null}

      {/* Stalled is now a full generating-screen state (generating-states
          mock), rendered by GeneratingScreen itself below — no banner here. */}

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

      {/* Owner edit (2026-08-02) — ONE load screen across the whole chain:
          typing and templating share a single mounted GeneratingScreen (the
          ring + a rotating caption), so the typing→templating hop doesn't
          swap screens or reset the rotation mid-generation. */}
      {data.stage === "typing" || data.stage === "templating" ? (
        <GeneratingScreen
          stalled={data.genStalled && !data.genError}
          retrying={pendingIntent === "retry-gen"}
          onRetry={() => fetcher.submit({ intent: "retry-gen" }, { method: "post" })}
        />
      ) : null}

      {data.stage === "types" ? (
        <ShapeStage data={data} fetcher={fetcher} pendingIntent={pendingIntent} />
      ) : null}

      {/* Question Builder + Logic — the pre-config editing steps over the SAME
          draft payload. One-line-chrome: Logic is the decider shell's former
          ▦ Overview view promoted to its own stage; `mode` picks the surface.
          Client-only: the heavy builder panels throw hydration errors when
          SSR'd (the admin-builder lesson). */}
      {(data.stage === "question_builder" || data.stage === "logic") && data.questionBuilder ? (
        <ClientOnly fallback={<BuilderSkeleton />}>
          {() => (
            <QuestionBuilderStage
              quizId={data.quizId}
              mode={data.stage === "logic" ? "logic" : "questions"}
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


      {/* Results reveal — QZY-5: decider drafts get the LIGHT step-4 surface
          (quiz-results-step4 v1.0); legacy built drafts keep the heavy
          RecommendationStage (now the dashboard-class advanced editor), and
          unbuilt legacy drafts the lean RecPageStage. All client-only.
          Design-step retirement: drafts parked at the retired terminals
          (design/overview/generate/done) fold onto Results here too. */}
      {visibleStageKey(data.stage) === "rec_page" && data.recPage ? (
        <ClientOnly fallback={<BuilderSkeleton />}>
          {() =>
            data.recPage!.doc.logic_model === "decider" ? (
              /* Results-guided handoff (UPDATE AREA 3) — the six-step guided
                 flow supersedes the Step4Results light surface for deciders. */
              <ResultsGuided
                quizId={data.quizId}
                initialDoc={data.recPage!.doc}
                productIndex={data.recPage!.productIndex}
                designTokens={data.designTokens}
                onOpenBuilder={() => fetcher.submit({ intent: "generate-build" }, { method: "post" })}
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
      ) : visibleStageKey(data.stage) === "rec_page" ? (
        <RecPageStage data={data} fetcher={fetcher} pendingIntent={pendingIntent} />
      ) : null}

    </QzPage>
    </FunnelBarContext.Provider>
  );
}

// Map transient/legacy stages onto their owning visible step. FLOW-3 — Shape
// is RETIRED from the visible map: the whole shape family (the legacy picker
// at "types"/"shape"/"goal"/"templates" and the transient typing/templating
// AI passes) routes FORWARD onto Questions, the step their flows land on.
// This also kills FLOW-1's known cosmetic (the rail highlighting Shape during
// the headless passes). Design-step retirement: `design` + the older
// `overview`/`generate`/`done` terminals fold onto Results (the last step).
function visibleStageKey(stage: FunnelData["stage"]): string {
  if (
    stage === "typing" ||
    stage === "templates" ||
    stage === "shape" ||
    stage === "goal" ||
    stage === "types" ||
    stage === "templating" ||
    stage === "configuring"
  )
    return "question_builder";
  if (
    stage === "design" ||
    stage === "overview" ||
    stage === "done" ||
    stage === "generate"
  )
    return "rec_page";
  return stage;
}

// The top bar's step flow (one-line-chrome §1.2): done ✓ tint pills · current
// accent dot · upcoming muted. Finished steps navigate through onStepClick
// (goto-stage); StepNav gates clicks to done nodes itself.
function FunnelStepNav({
  stage,
  onStepClick,
}: {
  stage: FunnelData["stage"];
  onStepClick?: (id: string) => void;
}) {
  const activeIdx = FUNNEL_STAGES.findIndex((s) => s.key === visibleStageKey(stage));
  const steps: StepNavStep[] = FUNNEL_STAGES.map((s, i) => ({
    id: s.key,
    label: s.label,
    number: i + 1,
    state: i < activeIdx ? "done" : i === activeIdx ? "current" : "upcoming",
  }));
  return <StepNav steps={steps} onStepClick={onStepClick} />;
}

// ══ Step 2 ══════════════════════════════════════════════════════════════════

// Owner edit (2026-08-02) — ONE load screen for the whole generation chain
// (typing AND templating): just the breathing ignite ring with a single
// rotating update line under it. The per-stage titles, subtitles, beat
// checklists, and the fast/slow layout split are all retired; the caption
// loops so the screen stays alive however long the chain runs.
const GEN_ROTATION = [
  "Drafting your quiz questions",
  "Mapping out the logic",
  "Tuning the results",
];

// The "AI in flight" screen for the detached typing/templating jobs. The
// parent polls the loader; this just breathes while we wait. STALLED keeps
// its dedicated state (halted grey ring + ◷, Try again + the template
// escape). The FAILED state stays the banner above the restored stage — the
// Gap-1 fix resets the stage on failure, so there is no generating screen
// left to park it on; the banner carries the mock's copy + actions.
function GeneratingScreen({
  stalled,
  retrying,
  onRetry,
}: {
  stalled: boolean;
  retrying: boolean;
  onRetry: () => void;
}) {
  const [rotIx, setRotIx] = useState(0);
  useEffect(() => {
    if (stalled) return;
    const t = setInterval(() => setRotIx((i) => (i + 1) % GEN_ROTATION.length), 5000);
    return () => clearInterval(t);
  }, [stalled]);

  if (stalled) {
    return (
      <QzCard style={{ padding: 0 }}>
        <div className="qz-gen">
          <div className="qz-gen-ringwrap" aria-hidden>
            <span className="qz-gen-glow is-halt" />
            <span className="qz-gen-ring is-halt" />
            <span className="qz-gen-haltglyph is-warn">◷</span>
          </div>
          <h2 className="qz-gen-title">This is taking longer than it should</h2>
          <p className="qz-gen-sub">
            The generation seems to have stalled. You can re-run it, or start
            from a ready-made template.
          </p>
          <div className="qz-gen-actions">
            <button type="button" className="qz-btn qz-btn-accent" disabled={retrying} onClick={onRetry}>
              {retrying ? "Restarting…" : "Try again"}
            </button>
            {/* FLOW-2 — the template escape goes to the real template front
                door; /studio/new only redirect-bounces back into the funnel. */}
            <Link to="/studio/templates" className="qz-btn qz-btn-ghost">
              Start from a template →
            </Link>
          </div>
          <div className="qz-gen-foot">
            Nothing you picked is lost — your recommendations are saved.
          </div>
        </div>
      </QzCard>
    );
  }

  return (
    <QzCard style={{ padding: 0 }}>
      <div className="qz-gen">
        <div className="qz-gen-ringwrap" aria-hidden>
          <span className="qz-gen-glow" />
          <span className="qz-gen-ring" />
          <i className="qz-gen-sp qz-gen-sp1">✦</i>
          <i className="qz-gen-sp qz-gen-sp2">✦</i>
          <i className="qz-gen-sp qz-gen-sp3">✦</i>
          <i className="qz-gen-sp qz-gen-sp4">✦</i>
        </div>
        {/* keyed by caption so each rotation re-runs the fade-in */}
        <p key={rotIx} className="qz-gen-rot" aria-live="polite">
          {GEN_ROTATION[rotIx]}
        </p>
      </div>
    </QzCard>
  );
}
