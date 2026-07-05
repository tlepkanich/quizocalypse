import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import { Link, useFetcher, useRevalidator, useSearchParams } from "@remix-run/react";
import {
  QzPage,
  QzCard,
  QzBanner,
  QzBadge,
  QzField,
  QzInput,
  QzSelect,
  QzTextarea,
  QzSegmented,
  QzTooltip,
  QzProgress,
  QzExpandCard,
  StagedProgress,
} from "../qz";
import { QzModal, QzDrawer } from "../qz-overlays";
import type {
  Quiz,
  TemplateOption,
  BuildSession,
  QuizType,
  RichTemplateOption,
  PickedTemplate,
  DesignDials,
  RecDefaults,
  RecommendedGroup,
  DesignTokens,
} from "../../lib/quizSchema";
import type { BuilderCategory } from "../builder/stepProps";
import type { IndexedProduct } from "../../lib/recommendationEngine";
import { VibeTemplateSelector } from "../studio/VibeTemplateSelector";
import { StyleBar } from "../studio/StyleBar";
import { BrandIdentityPanel } from "../studio/BrandIdentityPanel";
import { QuestionBuilderStage } from "./QuestionBuilderStage";
import { RecommendationStage } from "./RecommendationStage";
import { TopBar } from "../chrome/TopBar";
import { StepNav, type StepNavStep } from "../chrome/StepNav";
import { ClientOnly, BuilderSkeleton } from "../studio/ClientOnly";
import type { BucketSuggestion } from "../../lib/bucketDetect";
import { THEME_PRESETS, type ThemePreset } from "../../lib/themePresets";
import { resolveDesignTokens, tokensToCssVars, suggestContrastText } from "../../lib/designTokens";
import { googleFontsUrl } from "../runtime/runtimeStyles";

// Recommendation Buckets (RB Step 1) — the three browser tabs / bucket kinds.
type BucketType = "product" | "tag" | "collection";

// Builder Re-work Step 1 — the shared, server-free creation funnel. Renders one
// of four stages off the draft's build_session and drives every transition
// through ONE fetcher (the nested route's action). Mirrors how BrandIdentityReview
// is shared verbatim by the studio + embedded brand routes; the embedded twin
// (S6) wraps this same component with an admin-backed loader.

// The loader's serialized shape (kept local to avoid a route⇄component type cycle).
export interface FunnelData {
  quizId: string;
  name: string;
  stage: BuildSession["stage"]; // sourced from the schema so it can't drift
  // LOGIC v2 (L2-10d) — the creation stamp. "decider" drafts get the
  // direct-only Shape (Manual card hidden); null = legacy in-flight drafts,
  // which render today's four-card UI byte-identically.
  logicModel: "decider" | null;
  minGoalChars: number;
  productCount: number;
  identitySummary: string | null;
  suggestedGoal: string;
  detection: {
    dimension: string;
    rationale: string;
    groups: Array<{ key: string; name: string; count: number }>;
  };
  confirmed: {
    dimension: string;
    confirmed_category_ids: string[];
    detected_rationale: string;
  } | null;
  goal: { goal_text: string; struggle_text: string } | null;
  templateOptions: TemplateOption[];
  pickedOptionId: string | null;
  // ── Step 2 ──
  quizTypes: QuizType[];
  pickedTypeId: string | null;
  richTemplates: RichTemplateOption[];
  pickedTemplate: PickedTemplate | null;
  webResearchSummary: string | null;
  genError: string | null;
  genStalled: boolean;
  productGroups: Array<{ id: string; name: string; products: Array<{ id: string; title: string }> }>;
  collections: Array<{ collectionId: string; title: string }>;
  savedTemplates: Array<{ id: string; name: string; template: RichTemplateOption }>;
  // ── Recommendation Buckets (RB Step 1) ──
  catalog: {
    products: Array<{
      id: string;
      title: string;
      imageUrl: string | null;
      price: number | null;
      description: string | null;
      tagKeys: string[];
      collectionIds: string[];
    }>;
    tags: Array<{ key: string; label: string; count: number }>;
    collections: Array<{ key: string; label: string; count: number }>;
  };
  suggestion: BucketSuggestion;
  buckets: Array<{
    key: string;
    type: BucketType;
    name: string;
    count: number;
    thumbnailUrl: string | null;
  }>;
  activeTab: BucketType;
  bannerDismissed: boolean;
  // Step-1 spec §6 — "type:key" ids of selections the draft's questions/rules
  // already reference; removing one warns before orphaning Step-3 mappings.
  referencedKeys: string[];
  backHref: string;
  // Question Builder (the pre-config editing step) — emitted ONLY when
  // stage === "question_builder": the built draft + the builder's category /
  // productIndex shapes, so QuestionBuilderStage composes FlowRail + ContextPanel
  // over the SAME draftJson the main builder edits.
  questionBuilder: {
    doc: Quiz;
    categories: BuilderCategory[];
    productIndex: IndexedProduct[];
  } | null;
  // Rec Page on the BUILT draft — the current result-node rec settings. Present
  // only at stage "rec_page" once the quiz is built; RecPageStage edits the nodes
  // directly (via set-result-rec). Null → legacy draft → edit picked_template.
  recNodeDefaults: { max_products: number; oos_behavior: RecDefaults["oos_behavior"] } | null;
  // Recommendation step on the BUILT draft — the full doc + catalog shapes so
  // RecommendationStage mounts the per-bucket ResultSettingsPanel + RecPageDiagram.
  // Present only at stage "rec_page" with ≥1 result node; null → legacy draft
  // (RecPageStage edits picked_template instead).
  recPage: {
    doc: Quiz;
    categories: BuilderCategory[];
    productIndex: IndexedProduct[];
  } | null;
  // Design step (Drive 1_p1V) — the draft's current design tokens, so the Design
  // stage can show the selected vibe template + the "modified" indicator.
  designTokens: DesignTokens;
  designLinked: boolean;
  recPageDesign: DesignTokens | null;
}

type ActionResult =
  | { intent: string; ok: boolean; error?: string }
  | { intent: "resync"; ok: boolean; error?: string };

// The staged generation copy (Step 1 notes — "not a spinner"). S5 reuses these
// four beats for the detached full build's overlay.
const BUILD_STAGES = [
  "Reading your catalog",
  "Mapping your products",
  "Writing your questions",
  "Building your results page",
];

const XTYPE_LABEL: Record<string, string> = {
  product_match: "Product match",
  personality: "Personality",
  lead_capture: "Lead capture",
  survey: "Survey",
};

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

  // QL3-P1 — when the Step-3 v3 shell is active (decider doc + ?step3=v3) it
  // renders its OWN floating top bar (TopBar3, same wordmark + step pills), so
  // the standard sticky bar steps aside — the spec's Step-3 has exactly one bar.
  const [searchParams] = useSearchParams();
  const step3V3Active =
    searchParams.get("step3") === "v3" &&
    data.stage === "question_builder" &&
    data.questionBuilder?.doc.logic_model === "decider";

  // Poll the loader while a detached generation job runs (typing/templating);
  // the job writes the next stage, the revalidate picks it up, the poll stops.
  const isGenerating = data.stage === "typing" || data.stage === "templating";
  useEffect(() => {
    if (!isGenerating) return;
    const t = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, 3000);
    return () => clearInterval(t);
  }, [isGenerating, revalidator]);

  return (
    <>
      {/* Design-system-V2 §7.6 — the creation flow's sticky top bar: wordmark ·
          step-nav pills · ancillary actions. Replaces the old QzPageHeader +
          FunnelProgress dots (each stage renders its own page-title zone).
          Hidden while the Step-3 v3 shell renders its own floating bar. */}
      {step3V3Active ? null : (
      <TopBar
        center={<FunnelStepNav stage={data.stage} />}
        right={
          <>
            {data.identitySummary ? (
              <button
                type="button"
                className="qz-btn qz-btn-ghost qz-btn-sm"
                onClick={() => setShowIdentity(true)}
              >
                ✦ Brand identity
              </button>
            ) : null}
            <Link to="/studio" className="qz-btn qz-btn-ghost qz-btn-sm">
              ← All quizzes
            </Link>
          </>
        }
      />
      )}
    <QzPage wide>
      {showIdentity && data.identitySummary ? (
        <BrandIdentityModal summary={data.identitySummary} onClose={() => setShowIdentity(false)} />
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

      {data.stage === "goal" ? (
        <GoalStage data={data} fetcher={fetcher} pendingIntent={pendingIntent} />
      ) : null}

      {data.stage === "typing" ? <GeneratingScreen kind="typing" /> : null}

      {data.stage === "types" ? (
        <ShapeStage data={data} fetcher={fetcher} pendingIntent={pendingIntent} />
      ) : null}

      {data.stage === "templating" ? <GeneratingScreen kind="templating" /> : null}

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

      {data.stage === "configuring" ? (
        <BattleCardStage data={data} fetcher={fetcher} pendingIntent={pendingIntent} />
      ) : null}

      {data.stage === "design" ? (
        <DesignStage data={data} fetcher={fetcher} pendingIntent={pendingIntent} />
      ) : null}

      {/* Recommendation — the full per-bucket config editor over the built draft.
          Client-only (ResultSettingsPanel + RecPageDiagram + useQuizDraft). Falls
          back to the lean RecPageStage for legacy drafts with no result nodes. */}
      {data.stage === "rec_page" && data.recPage ? (
        <ClientOnly fallback={<BuilderSkeleton />}>
          {() => (
            <RecommendationStage
              quizId={data.quizId}
              initialDoc={data.recPage!.doc}
              categories={data.recPage!.categories}
              productIndex={data.recPage!.productIndex}
              collections={data.collections}
              fetcher={fetcher}
              pendingIntent={pendingIntent}
            />
          )}
        </ClientOnly>
      ) : data.stage === "rec_page" ? (
        <RecPageStage data={data} fetcher={fetcher} pendingIntent={pendingIntent} />
      ) : null}

      {data.stage === "overview" ? (
        <OverviewStage data={data} fetcher={fetcher} pendingIntent={pendingIntent} />
      ) : null}

      {/* Legacy Step-1 directions — in-flight drafts from before Step 2. */}
      {data.stage === "templates" || data.stage === "done" ? (
        <TemplatesStage data={data} fetcher={fetcher} pendingIntent={pendingIntent} />
      ) : null}
    </QzPage>
    </>
  );
}

// The funnel's visible step order — shared by the top-bar step pills AND the
// Step-N-of-M stepper inside each stage, so the "of N" count can't drift.
// The re-sequenced visible order: Buckets → Shape → Questions → Rec Page → Design.
// Goal is folded INTO Shape (the "write your goal" card); the early question build
// runs right after Shape and lands on Questions; Design's Continue opens the main
// builder directly (Overview + Generate are retired from the flow).
// Step-1 spec §1 — "bucket" is dead in merchant UI: Step 1 is "Recommendations"
// and Step 4 is "Results page" (avoiding a collision with this step's noun).
const FUNNEL_STAGES: Array<{ key: string; label: string }> = [
  { key: "grouping", label: "Recommendations" },
  { key: "types", label: "Shape" },
  { key: "question_builder", label: "Questions" },
  { key: "rec_page", label: "Results page" },
  { key: "design", label: "Design" },
];

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

// A small segmented control row for the Design step's fine-tune options.
function FineTuneRow({
  label,
  options,
  active,
  onPick,
  busy,
}: {
  label: string;
  options: Array<[string, string]>;
  active: string | undefined;
  onPick: (value: string) => void;
  busy: boolean;
}) {
  return (
    <div className="qz-row" style={{ gap: 8, alignItems: "center" }}>
      <span className="qz-dim" style={{ fontSize: 12, flex: "0 0 64px" }}>{label}</span>
      <div className="qz-row" style={{ gap: 4 }}>
        {options.map(([value, lbl]) => (
          <button
            key={value}
            type="button"
            disabled={busy}
            onClick={() => onPick(value)}
            className={`qz-btn qz-btn-sm ${active === value ? "qz-btn-accent" : "qz-btn-ghost"}`}
            style={{ fontSize: 11, padding: "2px 8px" }}
            aria-pressed={active === value}
          >
            {lbl}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Design — pick a theme (the design-settings step, first cut) ───────────────
// Applies a theme preset's tokens to the draft doc via set-design; the build
// threads doc.design_tokens as its base, so the choice survives generation.
// (Logo / curated fonts / style sliders / formatting toggles are later cuts.)
function DesignStage({
  data,
  fetcher,
  pendingIntent,
}: {
  data: FunnelData;
  fetcher: ReturnType<typeof useFetcher<ActionResult>>;
  pendingIntent: string | null;
}) {
  const [appliedId, setAppliedId] = useState<string | null>(null);
  // §5/D6 — quiz↔rec-page design link. When de-linked, a Quiz/Rec switch routes EVERY
  // design edit below (brand identity, template, style bar, formatting) to whichever
  // design via `scope`; the panels read that design's tokens (`panelTokens`).
  const [designScope, setDesignScope] = useState<"quiz" | "rec_page">("quiz");
  const recScope = data.designLinked === false && designScope === "rec_page";
  const brandScope = recScope ? "rec_page" : "quiz";
  const panelTokens = recScope ? (data.recPageDesign ?? data.designTokens) : data.designTokens;

  const applying = pendingIntent === "set-design";
  const apply = (preset: ThemePreset) => {
    setAppliedId(preset.id);
    fetcher.submit(
      { intent: "set-design", tokens: JSON.stringify(preset.tokens), scope: brandScope },
      { method: "post" },
    );
  };
  const applyingField = pendingIntent === "set-design-field";
  const applyField = (field: string, value: string) =>
    fetcher.submit({ intent: "set-design-field", field, value, scope: brandScope }, { method: "post" });
  // §4 per-quiz formatting (answer layout / progress bar / question image).
  const applyingFormat = pendingIntent === "set-format";
  const applyFormat = (key: string, value: string) =>
    fetcher.submit({ intent: "set-format", key, value, scope: brandScope }, { method: "post" });
  const applyProgress = (patch: Record<string, unknown>) =>
    fetcher.submit(
      { intent: "set-format", key: "progress_bar", value: JSON.stringify(patch), scope: brandScope },
      { method: "post" },
    );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <QzCard style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div className="qz-label">Design · Brand identity</div>
          <h2 className="qz-h2" style={{ margin: 0 }}>Your brand</h2>
          <p className="qz-dim" style={{ margin: 0, fontSize: 13 }}>
            Colors and fonts apply across every quiz. The template and style bar below fine-tune
            the rest.
          </p>
        </div>

        {/* §5 — link the rec page's design to the quiz, or de-link to give it its
            own colors/fonts/logo (the Quiz/Rec switch routes the edits below). */}
        <div
          className="qz-row qz-gap-12"
          style={{ alignItems: "center", flexWrap: "wrap", fontSize: 13 }}
        >
          <label className="qz-row qz-gap-4" style={{ alignItems: "center", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={data.designLinked !== false}
              onChange={(e) => {
                const linked = e.target.checked;
                if (linked && !window.confirm("Reset the recommendation page’s design back to the quiz design?")) {
                  return;
                }
                if (linked) setDesignScope("quiz");
                fetcher.submit({ intent: "set-design-linked", linked: String(linked) }, { method: "post" });
              }}
            />
            Link the recommendation page’s design to the quiz
          </label>
          {data.designLinked === false ? (
            <FineTuneRow
              label="Editing"
              options={[
                ["quiz", "Quiz"],
                ["rec_page", "Rec page"],
              ]}
              active={designScope}
              onPick={(v) => setDesignScope(v as "quiz" | "rec_page")}
              busy={false}
            />
          ) : null}
        </div>
        {recScope ? (
          <p className="qz-dim" style={{ margin: 0, fontSize: 12 }}>
            Editing the recommendation page’s design — colors, fonts, logo, template, style bar &
            formatting all apply to the rec page until you re-link.
          </p>
        ) : null}

        <BrandIdentityPanel
          tokens={panelTokens}
          onColor={(key, hex) =>
            fetcher.submit(
              { intent: "set-design-color", key, value: hex, scope: brandScope },
              { method: "post" },
            )
          }
          onFont={(slot, family) =>
            fetcher.submit(
              { intent: "set-design-font", slot, family, scope: brandScope },
              { method: "post" },
            )
          }
          onLogoFile={(file) => {
            const fd = new FormData();
            fd.append("intent", "set-design-logo");
            fd.append("logo", file);
            fd.append("scope", brandScope);
            fetcher.submit(fd, { method: "post", encType: "multipart/form-data" });
          }}
          onLogoUrl={(url) =>
            fetcher.submit({ intent: "set-design-logo", url, scope: brandScope }, { method: "post" })
          }
          onLogoMeta={(field, value) =>
            fetcher.submit(
              { intent: "set-design-logo", [field]: value, scope: brandScope },
              { method: "post" },
            )
          }
          onLogoClear={() =>
            fetcher.submit({ intent: "set-design-logo", clear: "1", scope: brandScope }, { method: "post" })
          }
          onReset={() => fetcher.submit({ intent: "reset-design", scope: brandScope }, { method: "post" })}
          onResync={() =>
            fetcher.submit({ intent: "resync-design", scope: brandScope }, { method: "post" })
          }
        />
        <hr style={{ border: "none", borderTop: "1px solid var(--qz-rule)", margin: "2px 0" }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div className="qz-label">Design · Template</div>
          <h2 className="qz-h2" style={{ margin: 0 }}>Pick a template</h2>
          <p className="qz-dim" style={{ margin: 0, fontSize: 13 }}>
            Start from a vibe — it sets imagery, shape, spacing, and type. Fine-tune colors, fonts,
            and the style bar next; everything’s editable in the builder.
          </p>
        </div>
        <VibeTemplateSelector
          currentTokens={panelTokens}
          busy={applying}
          onApply={(t) =>
            fetcher.submit(
              { intent: "set-design", tokens: JSON.stringify(t.tokens), scope: brandScope },
              { method: "post" },
            )
          }
        />
        <div className="qz-label" style={{ marginTop: 4 }}>More themes</div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
            gap: 12,
          }}
        >
          {THEME_PRESETS.map((p) => {
            const active = appliedId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => apply(p)}
                disabled={applying}
                className="qz-card qz-interactive"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  padding: 12,
                  cursor: "pointer",
                  textAlign: "left",
                  outline: active ? "2px solid var(--qz-accent)" : "none",
                  outlineOffset: 2,
                }}
              >
                <span aria-hidden style={{ display: "flex", gap: 5 }}>
                  {[
                    p.tokens.colors?.background ?? "#ffffff",
                    p.tokens.colors?.primary ?? "#111111",
                    p.tokens.colors?.accent ?? "#888888",
                    p.tokens.colors?.text ?? "#111111",
                  ].map((c, i) => (
                    <span
                      key={i}
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: 5,
                        background: c,
                        border: "1px solid var(--qz-ink-4)",
                      }}
                    />
                  ))}
                </span>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</span>
                {active ? <span className="qz-dim" style={{ fontSize: 11.5 }}>Applied ✓</span> : null}
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 2 }}>
          <FineTuneRow
            label="Shape"
            options={[["square", "Square"], ["rounded", "Rounded"], ["pill", "Pill"]]}
            active={panelTokens.radius}
            onPick={(v) => applyField("radius", v)}
            busy={applyingField}
          />
          <FineTuneRow
            label="Buttons"
            options={[["filled", "Filled"], ["outline", "Outline"], ["ghost", "Ghost"]]}
            active={panelTokens.button_style}
            onPick={(v) => applyField("button_style", v)}
            busy={applyingField}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
          <div className="qz-label">Style bar</div>
          <p className="qz-dim" style={{ margin: 0, fontSize: 12 }}>
            Fine-tune the template — slide to taste. Changes apply on top of the chosen vibe.
          </p>
          <StyleBar
            value={panelTokens.style_bar}
            onCommit={(sb) =>
              fetcher.submit(
                { intent: "set-style-bar", style_bar: JSON.stringify(sb), scope: brandScope },
                { method: "post" },
              )
            }
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
          <div className="qz-label">Formatting</div>
          <p className="qz-dim" style={{ margin: 0, fontSize: 12 }}>
            Per-quiz layout. Applies on top of the theme — leave on Auto to keep the default.
          </p>
          <FineTuneRow
            label="Answers"
            options={[
              ["auto", "Auto"],
              ["list", "List"],
              ["grid", "Grid"],
            ]}
            active={panelTokens.answer_layout ?? "auto"}
            onPick={(v) => applyFormat("answer_layout", v)}
            busy={applyingFormat}
          />
          {panelTokens.answer_layout === "grid" ? (
            <FineTuneRow
              label="Columns"
              options={[
                ["2", "2"],
                ["3", "3"],
              ]}
              active={String(panelTokens.answer_grid_columns ?? 2)}
              onPick={(v) => applyFormat("answer_grid_columns", v)}
              busy={applyingFormat}
            />
          ) : null}
          <FineTuneRow
            label="Progress"
            options={[
              ["on", "On"],
              ["off", "Off"],
            ]}
            active={panelTokens.progress_bar?.enabled === false ? "off" : "on"}
            onPick={(v) => applyProgress({ enabled: v === "on" })}
            busy={applyingFormat}
          />
          {panelTokens.progress_bar?.enabled !== false ? (
            <>
              <FineTuneRow
                label="Style"
                options={[
                  ["bar", "Bar"],
                  ["dots", "Dots"],
                  ["steps", "Steps"],
                ]}
                active={panelTokens.progress_bar?.style ?? "bar"}
                onPick={(v) => applyProgress({ style: v })}
                busy={applyingFormat}
              />
              <FineTuneRow
                label="At"
                options={[
                  ["top", "Top"],
                  ["bottom", "Bottom"],
                ]}
                active={panelTokens.progress_bar?.position ?? "top"}
                onPick={(v) => applyProgress({ position: v })}
                busy={applyingFormat}
              />
            </>
          ) : null}
          <FineTuneRow
            label="Image"
            options={[
              ["top", "Top"],
              ["side", "Side"],
              ["none", "None"],
            ]}
            active={panelTokens.question_image_position ?? "top"}
            onPick={(v) => applyFormat("question_image_position", v)}
            busy={applyingFormat}
          />
        </div>
      </QzCard>
      <div className="qz-row" style={{ gap: 8 }}>
        <button
          type="button"
          className="qz-btn qz-btn-ghost"
          onClick={() => fetcher.submit({ intent: "to-rec-page" }, { method: "post" })}
        >
          ← Back
        </button>
        <button
          type="button"
          className="qz-btn qz-btn-accent"
          disabled={pendingIntent === "generate-build"}
          onClick={() => fetcher.submit({ intent: "generate-build" }, { method: "post" })}
        >
          {pendingIntent === "generate-build" ? "Opening builder…" : "Open builder →"}
        </button>
      </div>
    </div>
  );
}

// ── Recommendation Page — tune how results show (per the Rec-Page spec) ───────
// First cut: the global rec defaults (products-per-result + OOS behavior) that the
// BattleCard used to hold, now a discrete step. Writes picked_template.rec_defaults
// via the existing set-rec intent; the build applies it. (Per-bucket sections,
// sort, sub-filter, discount, etc. are later cuts.)
function RecPageStage({
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
      <div className="qz-row" style={{ gap: 8 }}>
        <button
          type="button"
          className="qz-btn qz-btn-ghost"
          onClick={() => fetcher.submit({ intent: "to-question-builder" }, { method: "post" })}
        >
          ← Back
        </button>
        <button
          type="button"
          className="qz-btn qz-btn-accent"
          onClick={() => fetcher.submit({ intent: "to-design" }, { method: "post" })}
        >
          Continue →
        </button>
      </div>
    </div>
  );
}

// ── Overview — review everything before the build (the new flow's tail) ───────
// A read-only summary of what we'll generate. "Generate quiz →" fires the SAME
// detached build (generate-build) the battle card used to trigger directly, so
// the build inputs are unchanged. In the re-sequenced flow this sits last before
// Generate (… → Design → Overview → Generate → the builder).
function OverviewStage({
  data,
  fetcher,
  pendingIntent,
}: {
  data: FunnelData;
  fetcher: ReturnType<typeof useFetcher<ActionResult>>;
  pendingIntent: string | null;
}) {
  const picked = data.pickedTemplate;
  const buckets = data.productGroups;
  const building = pendingIntent === "generate-build";

  const rows: Array<{ label: string; value: string }> = [
    { label: "Quiz name", value: picked?.quiz_name || data.name },
    {
      label: "Recommendations",
      value: buckets.length
        ? `${buckets.length} — ${buckets.map((b) => b.name).join(" · ")}`
        : "None yet",
    },
  ];
  if (picked) {
    rows.push({ label: "Questions", value: `~${picked.question_count}` });
    rows.push({ label: "Products per result", value: String(picked.rec_defaults.max_products) });
    rows.push({ label: "Out of stock", value: OOS_LABEL[picked.rec_defaults.oos_behavior] });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <QzCard style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div className="qz-label">Review</div>
          <h2 className="qz-h2" style={{ margin: 0 }}>Ready to build your quiz</h2>
          <p className="qz-dim" style={{ margin: 0, fontSize: 13 }}>
            Here’s what we’ll generate. Go back to change anything, or generate when it looks right.
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((r) => (
            <div
              key={r.label}
              className="qz-row qz-row-between"
              style={{ gap: 12, alignItems: "baseline" }}
            >
              <span className="qz-dim" style={{ fontSize: 12.5, minWidth: 160 }}>{r.label}</span>
              <span style={{ fontSize: 14, fontWeight: 500, textAlign: "right" }}>{r.value}</span>
            </div>
          ))}
        </div>
      </QzCard>
      <div className="qz-row" style={{ gap: 8 }}>
        <button
          type="button"
          className="qz-btn qz-btn-ghost"
          disabled={building}
          onClick={() => fetcher.submit({ intent: "to-design" }, { method: "post" })}
        >
          ← Back
        </button>
        <button
          type="button"
          className="qz-btn qz-btn-accent"
          disabled={building}
          onClick={() => fetcher.submit({ intent: "generate-build" }, { method: "post" })}
        >
          {building ? "Building…" : "Generate quiz →"}
        </button>
      </div>
    </div>
  );
}

// ── Stage 1 — Recommendation Buckets (the quiz's possible OUTCOMES) ───────────
// The brand defines what the quiz can recommend: each bucket is an individual
// product, a tag, or a collection. An AI pre-analysis (bucketDetect) suggests
// the best bucketing strategy; selections continuously auto-save (each toggle is
// one server write, optimistically reflected). Desktop-first; Shopify data is
// read-only.
type BucketCard = {
  key: string;
  type: BucketType;
  name: string;
  count: number;
  thumbnailUrl: string | null;
};

const idOf = (type: BucketType, key: string) => `${type}:${key}`;

const TAB_META: Array<{ type: BucketType; label: string }> = [
  { type: "product", label: "Individual products" },
  { type: "tag", label: "Tags" },
  { type: "collection", label: "Collections" },
];

const TYPE_BADGE: Record<BucketType, "draft" | "ok" | "warn"> = {
  product: "draft",
  tag: "ok",
  collection: "warn",
};

const TYPE_GLYPH: Record<BucketType, string> = { product: "📦", tag: "🏷️", collection: "🗂️" };

// Merchant-facing nouns for the switch-confirm copy ("You have 4 collections
// selected…") — the tab labels are display-cased/pluralized, so counts need
// their own singular/plural forms.
const TYPE_NOUN: Record<BucketType, [string, string]> = {
  product: ["product", "products"],
  tag: ["tag", "tags"],
  collection: ["collection", "collections"],
};

function RecommendationBucketsStage({
  data,
  fetcher,
  pendingIntent,
  result,
}: {
  data: FunnelData;
  fetcher: ReturnType<typeof useFetcher<ActionResult>>;
  pendingIntent: string | null;
  result: ActionResult | null;
}) {
  const [activeTab, setActiveTab] = useState<BucketType>(data.activeTab);
  // §4 — "Not now" dismisses the banner for THIS SESSION only (sessionStorage,
  // no server write); a legacy persisted dismissal is still honored.
  const [dismissed, setDismissed] = useState(data.bannerDismissed);
  useEffect(() => {
    if (typeof window !== "undefined" && sessionStorage.getItem(`qz-rb-nb-${data.quizId}`)) {
      setDismissed(true);
    }
  }, [data.quizId]);
  // §4 — the auto-apply Applied state; `prior` is what Undo restores (the
  // selection is always homogeneous, so one type + keys captures it; `tab`
  // restores the pre-apply picker tab when the prior selection was empty).
  const [applied, setApplied] = useState<{
    prior: { type: BucketType | null; keys: string[]; tab: BucketType };
  } | null>(null);
  const [search, setSearch] = useState("");
  const q = useDeferredValue(search).trim().toLowerCase();
  // Overlays: the switch-confirm (a type change with selections) + the §5
  // results-page preview drawer + the §6 referenced-removal warnings (single
  // toggle + the bulk paths — review-caught: Use-this / Clear-visible could
  // otherwise silently remove referenced selections).
  const [lockTarget, setLockTarget] = useState<BucketType | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [removeWarn, setRemoveWarn] = useState<BucketCard | null>(null);
  const [bulkWarn, setBulkWarn] = useState<{ count: number; run: () => void } | null>(null);
  // Start-routing spec §1 — Continue opens the "How do you want to start?"
  // intercept (decider drafts only; legacy Continue submits directly as today).
  // Dismissal returns here unchanged; it re-opens on the next Continue.
  const [interceptOpen, setInterceptOpen] = useState(false);
  const isDecider = data.logicModel === "decider";
  const referencedSet = useMemo(() => new Set(data.referencedKeys), [data.referencedKeys]);

  // Optimistic overlay over the server's selection: id → card (added) | null
  // (removed). Cleared once the fetcher settles (the loader is then fresh).
  const [overlay, setOverlay] = useState<Map<string, BucketCard | null>>(() => new Map());
  useEffect(() => {
    if (fetcher.state === "idle") setOverlay(new Map());
  }, [fetcher.state, data.buckets]);

  const selected = useMemo(() => {
    const m = new Map<string, BucketCard>();
    for (const b of data.buckets) m.set(idOf(b.type, b.key), b);
    for (const [id, card] of overlay) {
      if (card === null) m.delete(id);
      else m.set(id, card);
    }
    return m;
  }, [data.buckets, overlay]);

  const isOn = (type: BucketType, key: string) => selected.has(idOf(type, key));
  const overlaySet = (id: string, val: BucketCard | null) =>
    setOverlay((prev) => new Map(prev).set(id, val));

  // One toggle = one optimistic overlay write + one server write. The grid row
  // and the rail row share this, so removing in either place is the same op.
  const doToggle = (card: BucketCard) => {
    const on = !isOn(card.type, card.key);
    overlaySet(idOf(card.type, card.key), on ? card : null);
    fetcher.submit(
      { intent: "toggle-bucket", type: card.type, key: card.key, on: String(on) },
      { method: "post" },
    );
  };

  // §6 downstream integrity — removing a selection the draft's questions/rules
  // already reference gets a warn-first confirm (Step 3's V5/V6 still catch
  // anything broken; this is the courtesy at the source).
  const toggle = (card: BucketCard) => {
    const removing = isOn(card.type, card.key);
    if (removing && referencedSet.has(idOf(card.type, card.key))) {
      setRemoveWarn(card);
      return;
    }
    doToggle(card);
  };

  // Tab switch persists active_tab. Selections are homogeneous to one type, so
  // switching with ≥1 selection prompts the switch-confirm modal first
  // (confirm → clear all, then switch). Per §4, tab clicks no longer dismiss
  // the AI banner — only "Not now" does.
  const doSwitchTab = (type: BucketType, clear: boolean) => {
    setActiveTab(type);
    setSearch("");
    if (clear) {
      setApplied(null); // a manual restart invalidates the Applied/Undo state
      // Optimistically empty the selection (mark every current id removed).
      setOverlay(() => {
        const next = new Map<string, BucketCard | null>();
        for (const c of selected.values()) next.set(idOf(c.type, c.key), null);
        return next;
      });
    }
    fetcher.submit(
      { intent: "switch-tab", type, ...(clear ? { clear: "true" } : {}) },
      { method: "post" },
    );
  };

  // §4 auto-apply — "Use this" clears any current selection, selects the
  // recommended set, and locks the type; the banner morphs to Applied + Undo.
  // Optimistic cards resolve names/counts from the already-loaded catalog.
  const cardFor = (type: BucketType, key: string): BucketCard => {
    if (type === "product") {
      const p = data.catalog.products.find((x) => x.id === key);
      return { key, type, name: p?.title ?? key, count: 1, thumbnailUrl: p?.imageUrl ?? null };
    }
    const src = type === "tag" ? data.catalog.tags : data.catalog.collections;
    const g = src.find((x) => x.key === key);
    return { key, type, name: g?.label ?? key, count: g?.count ?? 0, thumbnailUrl: null };
  };

  const setSelection = (type: BucketType, keys: string[]) => {
    setSearch("");
    setActiveTab(type);
    setOverlay(() => {
      const next = new Map<string, BucketCard | null>();
      for (const c of selected.values()) next.set(idOf(c.type, c.key), null);
      for (const k of keys) next.set(idOf(type, k), cardFor(type, k));
      return next;
    });
    fetcher.submit({ intent: "set-buckets", type, keys: keys.join(",") }, { method: "post" });
  };

  const useThis = () => {
    const apply = data.suggestion.apply;
    if (!apply) return;
    const current = [...selected.values()];
    const run = () => {
      setApplied({
        prior: { type: current[0]?.type ?? null, keys: current.map((c) => c.key), tab: activeTab },
      });
      setSelection(apply.type, apply.keys);
    };
    // Applying removes every current selection NOT in the recommended set —
    // warn first when any of those are referenced by the draft's questions
    // (the server keeps ids for keys present in BOTH sets, so those survive).
    const applySet = new Set(apply.keys.map((k) => idOf(apply.type, k)));
    const leavingReferenced = current.filter(
      (c) => referencedSet.has(idOf(c.type, c.key)) && !applySet.has(idOf(c.type, c.key)),
    );
    if (leavingReferenced.length > 0) setBulkWarn({ count: leavingReferenced.length, run });
    else run();
  };

  const undoApply = () => {
    const prior = applied?.prior;
    setApplied(null);
    if (!prior) return;
    if (prior.type) setSelection(prior.type, prior.keys);
    else setSelection(prior.tab, []); // empty prior: clear + land back on the pre-apply tab
  };

  const notNow = () => {
    setDismissed(true);
    if (typeof window !== "undefined") sessionStorage.setItem(`qz-rb-nb-${data.quizId}`, "1");
  };

  const switchTab = (type: BucketType) => {
    if (type === activeTab) return;
    if (selected.size > 0) {
      setLockTarget(type); // confirm via the modal
      return;
    }
    doSwitchTab(type, false);
  };

  // H4 a11y — roving-tabindex arrow-key navigation for the bucket-source tablist
  // (the ARIA tablist keyboard pattern). MANUAL activation: ←/→/Home/End move
  // focus only; the tab's native Enter/Space click activates — so arrowing never
  // trips the switch-tab confirm modal.
  const tablistRef = useRef<HTMLDivElement>(null);
  const onTabKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
    const tabs = Array.from(
      tablistRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])') ?? [],
    );
    if (tabs.length === 0) return;
    const currentIdx = tabs.findIndex((el) => el === document.activeElement);
    const base = currentIdx < 0 ? 0 : currentIdx;
    const nextIdx =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? tabs.length - 1
          : (base + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    e.preventDefault();
    tabs[nextIdx]?.focus();
  };

  const priceById = useMemo(
    () => new Map(data.catalog.products.map((p) => [p.id, p.price])),
    [data.catalog.products],
  );

  const cardsForTab = (type: BucketType): BucketCard[] => {
    if (type === "product")
      return data.catalog.products.map((p) => ({
        key: p.id,
        type,
        name: p.title,
        count: 1,
        thumbnailUrl: p.imageUrl,
      }));
    const src = type === "tag" ? data.catalog.tags : data.catalog.collections;
    return src.map((t) => ({ key: t.key, type, name: t.label, count: t.count, thumbnailUrl: null }));
  };

  const visible = useMemo(() => {
    const all = cardsForTab(activeTab);
    return q ? all.filter((c) => c.name.toLowerCase().includes(q)) : all;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, q, data.catalog]);

  const visibleKeys = visible.map((c) => c.key);
  const allVisibleOn = visibleKeys.length > 0 && visibleKeys.every((k) => isOn(activeTab, k));

  const selectAllVisible = () => {
    setOverlay((prev) => {
      const next = new Map(prev);
      for (const c of visible) next.set(idOf(c.type, c.key), c);
      return next;
    });
    fetcher.submit(
      { intent: "select-all", type: activeTab, keys: visibleKeys.join(",") },
      { method: "post" },
    );
  };

  const clearVisible = () => {
    const run = () => {
      setOverlay((prev) => {
        const next = new Map(prev);
        for (const k of visibleKeys) next.set(idOf(activeTab, k), null);
        return next;
      });
      fetcher.submit(
        { intent: "clear-visible", type: activeTab, keys: visibleKeys.join(",") },
        { method: "post" },
      );
    };
    // §6 — a filtered bulk clear can remove referenced selections a single
    // toggle would have warned about; gate it the same way.
    const referencedCleared = visibleKeys.filter(
      (k) => isOn(activeTab, k) && referencedSet.has(idOf(activeTab, k)),
    );
    if (referencedCleared.length > 0) setBulkWarn({ count: referencedCleared.length, run });
    else run();
  };

  const selectedList = [...selected.values()];
  const count = selectedList.length;
  const continuing = pendingIntent === "continue-buckets";
  const resyncing = pendingIntent === "resync";
  const resyncResult = result && result.intent === "resync" ? result : null;
  const stepCount = FUNNEL_STAGES.length;
  const tabCounts: Record<BucketType, number> = {
    product: data.catalog.products.length,
    tag: data.catalog.tags.length,
    collection: data.catalog.collections.length,
  };
  const activeLabel = TAB_META.find((t) => t.type === activeTab)?.label ?? "";

  const lockedType = count > 0 ? selectedList[0]?.type ?? null : null;
  const typeChip = lockedType ? TAB_META.find((t) => t.type === lockedType)?.label ?? null : null;

  return (
    <div className="qz-rb">
      <div className="qz-rb-head">
        <div className="qz-label">Step 1 of {stepCount} · Recommendations</div>
        <h2 className="qz-h2" style={{ margin: 0 }}>
          What can your quiz recommend?
        </h2>
        <p className="qz-dim" style={{ margin: 0 }}>
          Pick the outcomes shoppers can land on — individual products, tags, or whole
          collections. We&rsquo;ll route the quiz toward whichever fits each shopper.
        </p>
      </div>

      {/* §4 — AI recommendation banner (an action, not advice) */}
      {applied ? (
        <div className="qz-rb-banner is-applied">
          <span className="qz-rb-banner-icon" aria-hidden>
            ✓
          </span>
          <div className="qz-rb-banner-body">
            <div className="qz-rb-banner-head">
              <strong>Applied — {data.suggestion.message.replace(/^Use |^Start with /, "using ")}</strong>
            </div>
            <p className="qz-dim" style={{ margin: 0, fontSize: 13 }}>
              You can adjust the set below, or undo to get your previous selection back.
            </p>
          </div>
          <button type="button" className="qz-btn qz-btn-ghost qz-btn-sm" onClick={undoApply}>
            Undo
          </button>
        </div>
      ) : !dismissed ? (
        <RbBanner suggestion={data.suggestion} onUse={useThis} onNotNow={notNow} />
      ) : null}

      <div className="qz-rb-split">
        <div className="qz-rb-main">
          {/* §2.1 — the picker */}
          <QzCard flush className="qz-rb-browser">
        <div
          className="qz-rb-tabs"
          role="tablist"
          aria-label="Recommendation type"
          ref={tablistRef}
          onKeyDown={onTabKeyDown}
        >
          {TAB_META.map((t) => {
            const n = tabCounts[t.type];
            const on = t.type === activeTab;
            // §3 — selecting anything locks the type: the other tabs MUTE (no
            // lock icon) but stay CLICKABLE — the click opens the switch-confirm
            // modal, which is the path to switching, not a dead end.
            const muted = count > 0 && !on;
            return (
              <button
                key={t.type}
                type="button"
                role="tab"
                aria-selected={on}
                // Roving tabindex: only the selected tab is in the Tab order; ←/→
                // move between tabs (onTabKeyDown focuses the others programmatically).
                tabIndex={on ? 0 : -1}
                className={`qz-rb-tab${on ? " is-active" : ""}${muted ? " is-muted" : ""}`}
                disabled={n === 0 && t.type !== "product"}
                onClick={() => switchTab(t.type)}
              >
                {t.label}
                <span className="qz-rb-tab-n">{n}</span>
              </button>
            );
          })}
        </div>

        <div className="qz-rb-toolbar">
          <QzInput
            type="search"
            placeholder={`Search ${activeLabel.toLowerCase()}…`}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            aria-label="Search the catalog"
          />
          <button
            type="button"
            className="qz-btn qz-btn-ghost qz-btn-sm"
            onClick={allVisibleOn ? clearVisible : selectAllVisible}
            disabled={visible.length === 0}
          >
            {allVisibleOn ? "Clear visible" : `Select all (${visible.length})`}
          </button>
        </div>

        {visible.length === 0 ? (
          <div className="qz-rb-empty qz-dim">
            {q ? "No matches." : "Nothing here yet — sync your catalog to populate this tab."}
          </div>
        ) : (
          <div className={`qz-rb-grid${activeTab === "product" ? " is-products" : ""}`}>
            {visible.map((c) => {
              const on = isOn(c.type, c.key);
              const price = activeTab === "product" ? priceById.get(c.key) ?? null : null;
              return (
                <button
                  key={c.key}
                  type="button"
                  className={`qz-rb-card${on ? " is-on" : ""}`}
                  aria-pressed={on}
                  onClick={() => toggle(c)}
                >
                  {activeTab === "product" ? (
                    <span className="qz-rb-thumb">
                      {c.thumbnailUrl ? (
                        <img src={c.thumbnailUrl} alt="" loading="lazy" />
                      ) : (
                        <span aria-hidden>{TYPE_GLYPH.product}</span>
                      )}
                    </span>
                  ) : null}
                  <span className="qz-rb-card-body">
                    <span className="qz-rb-card-name">{c.name}</span>
                    <span className="qz-rb-card-meta qz-dim">
                      {activeTab === "product"
                        ? price != null
                          ? `$${price.toFixed(2)}`
                          : "—"
                        : `${c.count} product${c.count === 1 ? "" : "s"}`}
                    </span>
                  </span>
                  <span className={`qz-rb-check${on ? " is-on" : ""}`} aria-hidden>
                    {on ? "✓" : ""}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </QzCard>

          <div className="qz-rb-underrow">
            <Link to={data.backHref} className="qz-btn qz-btn-ghost qz-btn-sm">
              ← Back
            </Link>
            <button
              type="button"
              className="qz-btn qz-btn-ghost qz-btn-sm"
              onClick={() => fetcher.submit({ intent: "resync" }, { method: "post" })}
              disabled={resyncing}
            >
              {resyncing ? "Refreshing…" : "↻ Refresh catalog"}
            </button>
            {resyncResult ? (
              <span className="qz-dim" style={{ fontSize: 12 }}>
                {resyncResult.ok ? "Catalog refreshed." : "Couldn't refresh from here."}
              </span>
            ) : null}
          </div>
        </div>

        {/* §2.2 — "Your recommendations" rail (sticky) */}
        <aside className="qz-rb-rail" aria-label="Your recommendations">
          <div className="qz-rb-rail-head">
            <strong>Your recommendations</strong>
            <span className="qz-row" style={{ gap: 6 }}>
              {typeChip && lockedType ? (
                <QzBadge tone={TYPE_BADGE[lockedType]}>{typeChip}</QzBadge>
              ) : null}
              <span className="qz-rb-count">{count}</span>
            </span>
          </div>
          {count === 0 ? (
            <div className="qz-rb-empty qz-dim">
              Nothing added yet — pick {activeLabel.toLowerCase()} on the left to see them
              appear here.
            </div>
          ) : (
            <div className="qz-rb-rail-list">
              {selectedList.map((c) => (
                <div key={idOf(c.type, c.key)} className="qz-rb-rail-row">
                  <span className="qz-rb-chip-thumb">
                    {c.thumbnailUrl ? (
                      <img src={c.thumbnailUrl} alt="" loading="lazy" />
                    ) : (
                      <span aria-hidden>{TYPE_GLYPH[c.type]}</span>
                    )}
                  </span>
                  <span className="qz-rb-chip-body">
                    <span className="qz-rb-chip-name">{c.name}</span>
                    <span className="qz-rb-card-meta qz-dim">
                      {c.type === "product" ? "product" : `${c.count} product${c.count === 1 ? "" : "s"}`}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="qz-rb-chip-x"
                    aria-label={`Remove ${c.name}`}
                    onClick={() => toggle(c)}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          {count === 1 ? (
            <p className="qz-rb-warn">
              One recommendation means every shopper sees the same products. Add a few more so
              the quiz can actually differentiate.
            </p>
          ) : null}
          <div className="qz-rb-rail-foot">
            <button
              type="button"
              className="qz-btn qz-btn-ghost"
              disabled={count === 0}
              onClick={() => setPreviewOpen(true)}
            >
              ▷ Preview results page
            </button>
            {count === 0 ? (
              <QzTooltip content="Add at least one recommendation to continue.">
                <button type="button" className="qz-btn qz-btn-accent" disabled>
                  Continue →
                </button>
              </QzTooltip>
            ) : (
              <button
                type="button"
                className="qz-btn qz-btn-accent"
                onClick={() =>
                  isDecider
                    ? setInterceptOpen(true)
                    : fetcher.submit({ intent: "continue-buckets" }, { method: "post" })
                }
                disabled={continuing || pendingIntent === "shape-goal-build" || pendingIntent === "manual-build"}
              >
                {continuing ? "Saving…" : "Continue →"}
              </button>
            )}
          </div>
        </aside>
      </div>

      {/* overlays */}
      {lockTarget ? (
        <TabLockModal
          targetLabel={TAB_META.find((t) => t.type === lockTarget)?.label ?? ""}
          currentNoun={TYPE_NOUN[lockedType ?? activeTab][count === 1 ? 0 : 1]}
          count={count}
          onConfirm={() => {
            doSwitchTab(lockTarget, true);
            setLockTarget(null);
          }}
          onCancel={() => setLockTarget(null)}
        />
      ) : null}
      {removeWarn ? (
        <RemoveWarnModal
          name={removeWarn.name}
          onConfirm={() => {
            doToggle(removeWarn);
            setRemoveWarn(null);
          }}
          onCancel={() => setRemoveWarn(null)}
        />
      ) : null}
      {bulkWarn ? (
        <BulkWarnModal
          count={bulkWarn.count}
          onConfirm={() => {
            bulkWarn.run();
            setBulkWarn(null);
          }}
          onCancel={() => setBulkWarn(null)}
        />
      ) : null}
      {previewOpen && count > 0 ? (
        <ResultsPreviewDrawer
          selections={selectedList}
          products={data.catalog.products}
          designTokens={data.designTokens ?? null}
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}
      {interceptOpen ? (
        <StartInterceptModal
          suggestedGoal={data.goal?.goal_text || data.suggestedGoal}
          minGoalChars={data.minGoalChars}
          onAiTemplates={() => {
            setInterceptOpen(false);
            fetcher.submit({ intent: "continue-buckets" }, { method: "post" });
          }}
          onGoalBuild={(goal) => {
            setInterceptOpen(false);
            fetcher.submit({ intent: "shape-goal-build", goal }, { method: "post" });
          }}
          onManual={() => {
            setInterceptOpen(false);
            fetcher.submit({ intent: "manual-build" }, { method: "post" });
          }}
          onClose={() => setInterceptOpen(false)}
        />
      ) : null}
    </div>
  );
}

// Start-routing spec §1.1 — the intercept modal: two primary choices side by
// side + one quiet tertiary. The AI choice carries the "Fastest" badge; the
// write-a-goal input lives IN the modal (the spec's own recommendation — one
// navigation, never a trapped state). Esc/scrim closes with nothing changed.
function StartInterceptModal({
  suggestedGoal,
  minGoalChars,
  onAiTemplates,
  onGoalBuild,
  onManual,
  onClose,
}: {
  suggestedGoal: string;
  minGoalChars: number;
  onAiTemplates: () => void;
  onGoalBuild: (goal: string) => void;
  onManual: () => void;
  onClose: () => void;
}) {
  const [screen, setScreen] = useState<"choose" | "goal">("choose");
  return (
    <QzModal
      open
      onClose={onClose}
      size="md"
      title={
        screen === "choose"
          ? "How do you want to start?"
          : "Describe what you want your quiz to do"
      }
    >
      {screen === "choose" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <span className="qz-dim" style={{ fontSize: 13 }}>
            Your recommendations are set — pick how to build the quiz itself.
          </span>
          <div className="qz-start-choices">
            <button type="button" className="qz-start-choice is-ai" onClick={onAiTemplates}>
              <span className="qz-row qz-row-between" style={{ gap: 8 }}>
                <span style={{ fontSize: 20 }} aria-hidden>
                  ✨
                </span>
                <QzBadge tone="ok">Fastest</QzBadge>
              </span>
              <strong>Generate AI templates</strong>
              <span className="qz-dim" style={{ fontSize: 12.5 }}>
                We read your catalog and draft two quiz directions — preview them live and
                pick one.
              </span>
            </button>
            <button
              type="button"
              className="qz-start-choice"
              onClick={() => setScreen("goal")}
            >
              <span style={{ fontSize: 20 }} aria-hidden>
                ✏
              </span>
              <strong>Write your goal</strong>
              <span className="qz-dim" style={{ fontSize: 12.5 }}>
                Describe what the quiz should do — we&rsquo;ll generate the questions from
                it and take you straight to editing.
              </span>
            </button>
          </div>
          <button type="button" className="qz-link-quiet" onClick={onManual}>
            Build from a blank quiz instead →
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <span className="qz-dim" style={{ fontSize: 13 }}>
            Your own words work best — we&rsquo;ll draft the questions from this.
          </span>
          <GoalPromptBody
            suggestedGoal={suggestedGoal}
            minGoalChars={minGoalChars}
            submitLabel="Generate from my goal →"
            onSubmit={onGoalBuild}
            onCancel={() => setScreen("choose")}
          />
        </div>
      )}
    </QzModal>
  );
}

// The shared write-a-goal form (the intercept modal's second screen + Shape's
// escape-link card). Prefilled with the store-derived suggestion so it's an
// approval, not a blank box; the merchant's own words always win.
function GoalPromptBody({
  suggestedGoal,
  minGoalChars,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  suggestedGoal: string;
  minGoalChars: number;
  submitLabel: string;
  onSubmit: (goal: string) => void;
  onCancel: () => void;
}) {
  const [goal, setGoal] = useState(suggestedGoal);
  const met = goal.trim().length >= minGoalChars;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <textarea
        className="qz-input"
        rows={3}
        autoFocus
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        placeholder={'e.g. "Help shoppers find the right board for how and where they ride"'}
        style={{ resize: "vertical", fontSize: 13 }}
      />
      <div className="qz-row" style={{ gap: 10 }}>
        <button
          type="button"
          className="qz-btn qz-btn-accent qz-btn-sm"
          disabled={!met}
          onClick={() => onSubmit(goal.trim())}
        >
          {submitLabel}
        </button>
        <button type="button" className="qz-btn qz-btn-ghost qz-btn-sm" onClick={onCancel}>
          ← Back
        </button>
      </div>
      {!met ? (
        <span className="qz-dim" style={{ fontSize: 11.5 }}>
          Add a little more detail (at least {minGoalChars} characters).
        </span>
      ) : null}
    </div>
  );
}

// Confirm switching the bucket source when buckets already exist (they're tied to
// the current source, so switching clears them).
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

function TabLockModal({
  targetLabel,
  currentNoun,
  count,
  onConfirm,
  onCancel,
}: {
  targetLabel: string;
  currentNoun: string;
  count: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // §3 — a modal, not a toast: it names the cost (your selections are removed)
  // and offers the path to yes in one gesture. Destructive-and-final → modal.
  return (
    <QzModal
      open
      onClose={onCancel}
      size="sm"
      title={<>Switch to {targetLabel}?</>}
      footer={
        <>
          <button type="button" className="qz-btn qz-btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="qz-btn qz-btn-accent" onClick={onConfirm}>
            Switch types
          </button>
        </>
      }
    >
      <p className="qz-dim" style={{ margin: 0, fontSize: 13.5 }}>
        You have {count} {currentNoun} selected. Switching will remove{" "}
        {count === 1 ? "it" : "them all"} and let you pick {targetLabel.toLowerCase()} instead.
      </p>
    </QzModal>
  );
}

// §6 for the bulk paths (Use-this / Clear-visible) — same consequence, plural
// framing. Confirming runs the deferred bulk action.
function BulkWarnModal({
  count,
  onConfirm,
  onCancel,
}: {
  count: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <QzModal
      open
      onClose={onCancel}
      size="sm"
      title={<>Remove {count} referenced recommendation{count === 1 ? "" : "s"}?</>}
      footer={
        <>
          <button type="button" className="qz-btn qz-btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="qz-btn qz-btn-accent" onClick={onConfirm}>
            Continue
          </button>
        </>
      }
    >
      <p className="qz-dim" style={{ margin: 0, fontSize: 13.5 }}>
        Your questions already point at {count === 1 ? "one of these" : "some of these"}{" "}
        recommendations. Continuing can leave broken mappings — the Questions step will flag
        anything that breaks so you can fix it there.
      </p>
    </QzModal>
  );
}

// §6 downstream integrity — removing a selection the draft's questions already
// reference gets a warn-first confirm (Step 3's validation catches anything
// broken on the next visit; this names the consequence at the source).
function RemoveWarnModal({
  name,
  onConfirm,
  onCancel,
}: {
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <QzModal
      open
      onClose={onCancel}
      size="sm"
      title={<>Remove &ldquo;{name}&rdquo;?</>}
      footer={
        <>
          <button type="button" className="qz-btn qz-btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="qz-btn qz-btn-accent" onClick={onConfirm}>
            Remove
          </button>
        </>
      }
    >
      <p className="qz-dim" style={{ margin: 0, fontSize: 13.5 }}>
        Your questions already point at this recommendation. Removing it can leave broken
        mappings — the Questions step will flag anything that breaks so you can fix it there.
      </p>
    </QzModal>
  );
}

// §5 — the results-page preview drawer: a brand-themed phone preview of what a
// shopper would see for each selected recommendation. The point is to make the
// DIFFERENCE between recommendation types felt: an individual product previews
// as a focused single-product screen; a collection/tag previews as a grid (no
// hero — hero selection is a Results-page decision the merchant hasn't made
// yet, so implying one here would be dishonest). Members resolve client-side
// from the catalog; the theme is the draft's resolved design tokens (the same
// tokens the eventual quiz renders with) — never admin styling.
function ResultsPreviewDrawer({
  selections,
  products,
  designTokens,
  onClose,
}: {
  selections: BucketCard[];
  products: FunnelData["catalog"]["products"];
  designTokens: DesignTokens | null;
  onClose: () => void;
}) {
  const [tabIdx, setTabIdx] = useState(0);
  const sel = selections[Math.min(tabIdx, selections.length - 1)];

  const resolved = useMemo(() => resolveDesignTokens(designTokens ?? undefined), [designTokens]);
  const cssVars = useMemo(() => tokensToCssVars(resolved) as CSSProperties, [resolved]);
  const fontUrl = useMemo(
    () =>
      googleFontsUrl([
        resolved.typography?.heading?.family ?? "",
        resolved.typography?.body?.family ?? "",
      ]),
    [resolved],
  );

  const members = useMemo(() => {
    if (!sel) return [];
    if (sel.type === "tag") return products.filter((p) => p.tagKeys.includes(sel.key));
    if (sel.type === "collection") return products.filter((p) => p.collectionIds.includes(sel.key));
    return products.filter((p) => p.id === sel.key);
  }, [sel, products]);

  if (!sel) return null;
  const isProduct = sel.type === "product";
  const hero = members[0] ?? null;
  const shown = members.slice(0, 6);
  const overflow = members.length - shown.length;
  const descriptor = isProduct
    ? "Single-product layout — one focused product screen"
    : `Multi-product layout — ${members.length} product${members.length === 1 ? "" : "s"} from this ${sel.type === "tag" ? "tag" : "collection"}`;
  // The CTA sits on the brand primary — pick a contrast-safe text color (the
  // runtime does the same; a hardcoded white fails on light brand primaries).
  const ctaText = suggestContrastText(resolved.colors?.primary ?? "#5563DE");

  return (
    <QzDrawer open onClose={onClose} title="Results page preview" width="min(496px, 94vw)">
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          height: "100%",
          overflow: "hidden",
        }}
      >
        {fontUrl ? <link rel="stylesheet" href={fontUrl} /> : null}
        {selections.length > 1 ? (
          <div className="qz-rb-pvtabs" role="tablist" aria-label="Previewed recommendation">
            {selections.map((s, i) => (
              <button
                key={idOf(s.type, s.key)}
                type="button"
                role="tab"
                aria-selected={i === tabIdx}
                className={`qz-rb-pvtab${i === tabIdx ? " is-active" : ""}`}
                onClick={() => setTabIdx(i)}
              >
                <span aria-hidden>{TYPE_GLYPH[s.type]}</span> {s.name}
              </button>
            ))}
          </div>
        ) : null}
        <p className="qz-dim" style={{ margin: 0, fontSize: 12 }}>
          Themed with your brand identity · real product data.
        </p>

        <div className="qz-rb-phone">
          <div className="qz-rb-phone-screen" style={cssVars}>
            {isProduct ? (
              hero ? (
                <div className="qz-rb-pv-single">
                  {hero.imageUrl ? (
                    <img className="qz-rb-pv-heroimg" src={hero.imageUrl} alt="" loading="lazy" />
                  ) : (
                    <div className="qz-rb-pv-heroimg qz-rb-pv-noimg" aria-hidden>
                      📦
                    </div>
                  )}
                  <strong className="qz-rb-pv-name">{hero.title}</strong>
                  {hero.description ? (
                    <p className="qz-rb-pv-desc">{hero.description}</p>
                  ) : null}
                  <p className="qz-rb-ghost">✦ AI personalizes at quiz time</p>
                  <div className="qz-rb-pv-buyrow">
                    <span className="qz-rb-pv-price">
                      {hero.price != null ? `$${hero.price.toFixed(2)}` : ""}
                    </span>
                    <span className="qz-rb-pv-cta" style={{ color: ctaText }}>
                      Add to cart
                    </span>
                  </div>
                </div>
              ) : (
                // The product left the catalog since selection — say so honestly
                // instead of rendering an empty grid.
                <div className="qz-rb-pv-single">
                  <p className="qz-rb-ghost">
                    This product is no longer in your synced catalog — refresh the catalog or
                    remove the selection.
                  </p>
                </div>
              )
            ) : (
              <div className="qz-rb-pv-multi">
                <strong className="qz-rb-pv-name">
                  {members.length} product{members.length === 1 ? "" : "s"} in {sel.name}
                </strong>
                <p className="qz-rb-ghost">✦ AI personalizes at quiz time</p>
                <div className="qz-rb-pvgrid">
                  {shown.map((p) => (
                    <div key={p.id} className="qz-rb-pvtile">
                      {p.imageUrl ? (
                        <img src={p.imageUrl} alt="" loading="lazy" />
                      ) : (
                        <div className="qz-rb-pv-noimg" aria-hidden>
                          📦
                        </div>
                      )}
                      <span className="qz-rb-pvtile-name">{p.title}</span>
                      <span className="qz-rb-pvtile-price">
                        {p.price != null ? `$${p.price.toFixed(2)}` : ""}
                      </span>
                    </div>
                  ))}
                </div>
                {overflow > 0 ? <p className="qz-rb-pv-more">+ {overflow} more →</p> : null}
              </div>
            )}
          </div>
        </div>

        <div className="qz-rb-pvfoot">
          <span className="qz-dim" style={{ fontSize: 12, minWidth: 0 }}>
            <strong style={{ fontWeight: 600 }}>{sel.name}</strong> · {descriptor}
          </span>
          <button type="button" className="qz-btn qz-btn-accent qz-btn-sm" onClick={onClose}>
            Looks good
          </button>
        </div>
      </div>
    </QzDrawer>
  );
}

// §4 — the AI recommendation banner: an ACTION, not advice. "Use this" applies
// the concrete recommended set in one click; "Not now" dismisses for the
// session. The why-line carries real catalog numbers.
function RbBanner({
  suggestion,
  onUse,
  onNotNow,
}: {
  suggestion: BucketSuggestion;
  onUse: () => void;
  onNotNow: () => void;
}) {
  return (
    <div className={`qz-rb-banner is-${suggestion.strength ?? "none"}`}>
      <span className="qz-rb-banner-icon" aria-hidden>
        ✨
      </span>
      <div className="qz-rb-banner-body">
        <div className="qz-rb-banner-head">
          <span className="qz-label">AI recommendation</span>
          {suggestion.strength ? (
            <QzBadge tone={suggestion.strength === "strong" ? "ok" : "warn"}>
              {suggestion.strength === "strong" ? "Strong signal" : "Worth a look"}
            </QzBadge>
          ) : null}
        </div>
        <strong style={{ fontSize: 14 }}>{suggestion.message}</strong>
        <p className="qz-dim" style={{ margin: 0, fontSize: 13 }}>
          {/* An empty catalog's why-line ("0 products across 0 collections…")
              just restates the sync prompt — skip it. */}
          {suggestion.counts.products > 0 ? `${suggestion.why} ` : ""}
          {suggestion.reason}
        </p>
      </div>
      <div className="qz-rb-banner-actions">
        {suggestion.apply ? (
          <button type="button" className="qz-btn qz-btn-accent qz-btn-sm" onClick={onUse}>
            Use this
          </button>
        ) : null}
        <button type="button" className="qz-btn qz-btn-ghost qz-btn-sm" onClick={onNotNow}>
          Not now
        </button>
      </div>
    </div>
  );
}

// ── Stage 2 — capture the goal + the struggle (gated by a min-char fill) ─────
function GoalStage({
  data,
  fetcher,
  pendingIntent,
}: {
  data: FunnelData;
  fetcher: ReturnType<typeof useFetcher<ActionResult>>;
  pendingIntent: string | null;
}) {
  // Pre-fill the goal with the store-derived suggestion (built-in templates +
  // brand identity) so this stage is an approval, not a blank box. A previously
  // saved goal always wins over the suggestion.
  const [goal, setGoal] = useState(data.goal?.goal_text || data.suggestedGoal || "");
  const [struggle, setStruggle] = useState(data.goal?.struggle_text ?? "");
  const showingSuggestion =
    !data.goal?.goal_text && goal.length > 0 && goal.trim() === data.suggestedGoal.trim();
  const goalLen = goal.trim().length;
  const met = goalLen >= data.minGoalChars;
  const generating = pendingIntent === "save-goal";

  // Advance the staged beats while the generation request is in flight.
  const [beat, setBeat] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (generating) {
      setBeat(0);
      timer.current = setInterval(() => {
        setBeat((b) => Math.min(b + 1, BUILD_STAGES.length - 1));
      }, 5000);
    } else if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [generating]);

  if (generating) {
    return (
      <QzCard style={{ padding: 28, display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div className="qz-label">Drafting your quiz directions</div>
          <p className="qz-dim" style={{ margin: 0, fontSize: 13 }}>
            Reading your brand identity and catalog to propose a few distinct ways to
            run this quiz. About 20 seconds.
          </p>
        </div>
        <StagedProgress stages={BUILD_STAGES} active={beat} />
      </QzCard>
    );
  }

  const submit = () => {
    fetcher.submit({ intent: "save-goal", goal, struggle }, { method: "post" });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <QzCard style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div className="qz-label">Step 2 of 3 · Goal</div>
          <h2 className="qz-h2" style={{ margin: 0 }}>
            What is the goal of this quiz?
          </h2>
        </div>

        <QzField label="The quiz should help shoppers…">
          <QzTextarea
            rows={3}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="e.g. Help winter-sports shoppers pick the right board and gear for their skill level and riding style."
          />
        </QzField>
        <QzProgress
          value={goalLen}
          max={data.minGoalChars}
          label={
            met
              ? "Enough to work with — add more if you like."
              : `${goalLen}/${data.minGoalChars} characters — a sentence or two helps the AI.`
          }
        />
        {showingSuggestion ? (
          <div
            className="qz-dim"
            style={{ fontSize: 12, marginTop: -4, display: "flex", alignItems: "center", gap: 6 }}
          >
            <span aria-hidden>✨</span>
            <span>Pre-filled from your store — edit it or keep it as-is.</span>
          </div>
        ) : null}

        <QzField
          label="What do customers struggle with when choosing? (optional)"
          hint="This feeds back into your brand identity so every future quiz remembers it."
        >
          <QzTextarea
            rows={2}
            value={struggle}
            onChange={(e) => setStruggle(e.target.value)}
            placeholder="e.g. Too many specs (flex, camber, sizing) and they can't tell what matters for them."
          />
        </QzField>
      </QzCard>

      <div className="qz-row qz-row-between" style={{ gap: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          className="qz-btn qz-btn-ghost qz-btn-sm"
          onClick={() => fetcher.submit({ intent: "back-to-grouping" }, { method: "post" })}
        >
          ← Back to grouping
        </button>
        <button type="button" className="qz-btn qz-btn-accent" onClick={submit} disabled={!met}>
          Draft quiz directions →
        </button>
      </div>
    </div>
  );
}

// ── Stage 3 — pick a direction (expandable AI-proposed cards) ────────────────
function TemplatesStage({
  data,
  fetcher,
  pendingIntent,
}: {
  data: FunnelData;
  fetcher: ReturnType<typeof useFetcher<ActionResult>>;
  pendingIntent: string | null;
}) {
  const picking = pendingIntent === "pick";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <QzCard style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div className="qz-label">Step 3 of 3 · Directions</div>
        <h2 className="qz-h2" style={{ margin: 0 }}>
          Pick a direction to build
        </h2>
        <p className="qz-dim" style={{ margin: 0 }}>
          Each is a different way to run your quiz. Choose one and we&rsquo;ll write the
          full thing — questions, logic, and result pages.
        </p>
      </QzCard>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {data.templateOptions.map((opt, i) => {
          return (
            <QzExpandCard
              key={opt.id}
              title={opt.title}
              angle={opt.angle}
              defaultOpen={i === 0}
              badge={<QzBadge tone="draft">{XTYPE_LABEL[opt.experience_type] ?? opt.experience_type}</QzBadge>}
              footer={
                <div className="qz-row" style={{ gap: 10, flexWrap: "wrap", marginTop: 4 }}>
                  <button
                    type="button"
                    className="qz-btn qz-btn-accent qz-btn-sm"
                    disabled={picking}
                    onClick={() => fetcher.submit({ intent: "pick", optionId: opt.id }, { method: "post" })}
                  >
                    {picking ? "Building…" : "Build this quiz →"}
                  </button>
                </div>
              }
            >
              {opt.rationale ? (
                <p className="qz-muted" style={{ margin: 0, fontSize: 13.5 }}>
                  {opt.rationale}
                </p>
              ) : null}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div className="qz-label">Sample questions</div>
                <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
                  {opt.sample_questions.map((q, i) => (
                    <li key={i} style={{ fontSize: 13.5 }}>
                      {q}
                    </li>
                  ))}
                </ul>
              </div>
            </QzExpandCard>
          );
        })}
      </div>

      <div className="qz-row" style={{ gap: 10 }}>
        <button
          type="button"
          className="qz-btn qz-btn-ghost qz-btn-sm"
          onClick={() => fetcher.submit({ intent: "back-to-goal" }, { method: "post" })}
        >
          ← Revise the goal
        </button>
      </div>
    </div>
  );
}

// ══ Step 2 ══════════════════════════════════════════════════════════════════

const TYPING_BEATS = ["Researching quiz strategies", "Reading your catalog", "Drafting tailored quiz types"];
const TEMPLATING_BEATS = ["Reading your brand identity", "Designing template variations", "Tuning the design dials"];

// The "AI in flight" screen for the detached typing/templating jobs. The parent
// polls the loader; this just animates the staged beats while we wait.
function GeneratingScreen({ kind }: { kind: "typing" | "templating" }) {
  const beats = kind === "typing" ? TYPING_BEATS : TEMPLATING_BEATS;
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (active >= beats.length - 1) return;
    const t = setTimeout(() => setActive((b) => b + 1), kind === "typing" ? 18000 : 12000);
    return () => clearTimeout(t);
  }, [active, beats.length, kind]);
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

// ── Stage: Type (tier-1) — pick a brand-tailored quiz type ───────────────────
// Shape-Your-Quiz spec — the "Shape your quiz" page that replaces the linear
// Types → Templates → BattleCard selection. Two AI quiz-type cards (generated
// to differ) + a Write-Your-Goal card; legacy drafts also get the
// Manual-Create card. Selecting an AI card expands it in place (siblings
// mute). Legacy drafts must pick a scoring model (no default) before
// Continue → the build; decider drafts are direct-only (no picker).
function ShapeStage({
  data,
  fetcher,
  pendingIntent,
}: {
  data: FunnelData;
  fetcher: ReturnType<typeof useFetcher<ActionResult>>;
  pendingIntent: string | null;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [scoring, setScoring] = useState<"direct" | "weighted" | null>(null);
  const [writingGoal, setWritingGoal] = useState(false);
  const [goalDraft, setGoalDraft] = useState(data.goal?.goal_text ?? "");
  // LOGIC v2 (L2-10d) — decider drafts: direct mapping is THE model (no
  // scoring picker) and Manual Creation is out of this flow (owner diagram
  // 2026-07-02). Legacy in-flight drafts keep the four-card UI unchanged.
  const isDecider = data.logicModel === "decider";
  // The spec shows exactly two AI suggestions, intentionally different in type.
  const aiTypes = data.quizTypes.slice(0, 2);
  const busy =
    pendingIntent === "shape-continue" ||
    pendingIntent === "shape-manual" ||
    pendingIntent === "shape-regenerate" ||
    pendingIntent === "shape-goal-build" ||
    // O-3 — the decider saved-template pick kicks the question build; keep the
    // other Shape affordances muted while it's in flight (isDecider-gated so
    // legacy render behavior is byte-identical).
    (isDecider && pendingIntent === "use-saved-template");
  // When one card is expanded (or the goal card is open), the others mute so the
  // merchant can still compare without losing focus.
  const somethingOpen = expandedId !== null || writingGoal;
  const muted = (mine: boolean): React.CSSProperties =>
    somethingOpen && !mine ? { opacity: 0.5, pointerEvents: "none" } : {};

  // Start-routing spec §2 — decider drafts get the template-picker Shape
  // (provenance banner, two thumbnail-led cards, the live preview drawer,
  // quiet escape links). Legacy in-flight drafts keep the four-card UI below
  // byte-identically.
  if (isDecider) {
    return (
      <DeciderShapeStage data={data} fetcher={fetcher} pendingIntent={pendingIntent} busy={busy} />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <QzCard style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div className="qz-row qz-row-between" style={{ alignItems: "center", gap: 8 }}>
          <h2 className="qz-h2" style={{ margin: 0 }}>Shape your quiz</h2>
          <QzBadge tone="draft">Brand ✦</QzBadge>
        </div>
        <p className="qz-dim" style={{ margin: 0 }}>
          We read your catalog, grouped your products, and drafted a few quiz directions to pick from.
        </p>
      </QzCard>

      <div className="qz-type-grid">
        {/* Cards 1 & 2 — AI-suggested quiz types */}
        {aiTypes.map((t) => {
          const expanded = expandedId === t.id;
          return (
            <div
              key={t.id}
              className="qz-card"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                borderColor: expanded ? "var(--qz-accent)" : undefined,
                ...muted(expanded),
              }}
            >
              <div className="qz-row qz-row-between" style={{ gap: 8, alignItems: "flex-start" }}>
                <span style={{ fontFamily: "var(--qz-font-display)", fontSize: 17, lineHeight: 1.2 }}>
                  {expanded ? `✓ ${t.name}` : t.name}
                </span>
                <QzBadge tone="draft">{XTYPE_LABEL[t.experience_type] ?? t.experience_type}</QzBadge>
              </div>
              <span className="qz-muted" style={{ fontSize: 13.5 }}>{t.achieves}</span>
              <span className="qz-label">{t.question_range.min}–{t.question_range.max} questions</span>
              {t.best_practice_note ? (
                <span className="qz-dim" style={{ fontSize: 12 }}>💡 {t.best_practice_note}</span>
              ) : null}

              {expanded ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
                  {isDecider ? (
                    // Decider drafts: direct mapping IS the model — a fixed
                    // descriptor replaces the retired scoring picker.
                    <span style={{ fontSize: 13 }}>
                      <strong>Direct mapping</strong>
                      <span className="qz-dim" style={{ display: "block", fontSize: 12 }}>
                        One question decides the result — each of its answers points at one
                        of your recommendations. You can refine it in the next step.
                      </span>
                    </span>
                  ) : (
                    <>
                      <div className="qz-label">How should we score this quiz?</div>
                      {(
                        [
                          ["direct", "Direct mapping", "Each answer maps to one recommendation. Simple, fast to configure."],
                          ["weighted", "Weighted scoring", "Answers contribute points to multiple recommendations. Better for overlapping attributes."],
                        ] as const
                      ).map(([val, label, desc]) => (
                        <label
                          key={val}
                          className="qz-row"
                          style={{ gap: 8, alignItems: "flex-start", fontSize: 13, cursor: "pointer" }}
                        >
                          <input
                            type="radio"
                            name={`scoring-${t.id}`}
                            checked={scoring === val}
                            onChange={() => setScoring(val)}
                            style={{ marginTop: 2 }}
                          />
                          <span>
                            <strong>{label}</strong>
                            <span className="qz-dim" style={{ display: "block", fontSize: 12 }}>{desc}</span>
                          </span>
                        </label>
                      ))}
                    </>
                  )}
                  <div className="qz-row" style={{ gap: 10, alignItems: "center" }}>
                    <button
                      type="button"
                      className="qz-btn qz-btn-primary qz-btn-sm"
                      disabled={(!isDecider && !scoring) || busy}
                      onClick={() => {
                        const effective = isDecider ? "direct" : scoring;
                        if (!effective) return;
                        fetcher.submit(
                          { intent: "shape-continue", typeId: t.id, scoring: effective },
                          { method: "post" },
                        );
                      }}
                    >
                      {pendingIntent === "shape-continue" ? "Building…" : "Continue →"}
                    </button>
                    <button
                      type="button"
                      className="qz-btn qz-btn-ghost qz-btn-sm"
                      disabled={busy}
                      onClick={() => {
                        setExpandedId(null);
                        setScoring(null);
                      }}
                    >
                      ← Change selection
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="qz-btn qz-btn-ghost qz-btn-sm"
                  style={{ alignSelf: "flex-start", color: "var(--qz-accent)", fontWeight: 600 }}
                  onClick={() => {
                    setWritingGoal(false);
                    setExpandedId(t.id);
                    setScoring(null);
                  }}
                >
                  Use this type →
                </button>
              )}
            </div>
          );
        })}

        {/* Card 3 — Write your goal */}
        <div className="qz-card" style={{ display: "flex", flexDirection: "column", gap: 8, ...muted(writingGoal) }}>
          <span style={{ fontFamily: "var(--qz-font-display)", fontSize: 17 }}>✏ Write your goal</span>
          {writingGoal ? (
            <>
              <textarea
                className="qz-input"
                rows={3}
                autoFocus
                value={goalDraft}
                onChange={(e) => setGoalDraft(e.target.value)}
                placeholder={'e.g. "Help shoppers find the right supplement stack for their fitness goals"'}
                style={{ resize: "vertical", fontSize: 13 }}
              />
              <div className="qz-row" style={{ gap: 10 }}>
                <button
                  type="button"
                  className="qz-btn qz-btn-primary qz-btn-sm"
                  disabled={goalDraft.trim().length < data.minGoalChars || busy}
                  onClick={() =>
                    fetcher.submit({ intent: "shape-goal-build", goal: goalDraft }, { method: "post" })
                  }
                >
                  {pendingIntent === "shape-goal-build" ? "Building…" : "Generate quiz →"}
                </button>
                <button
                  type="button"
                  className="qz-btn qz-btn-ghost qz-btn-sm"
                  disabled={busy}
                  onClick={() => setWritingGoal(false)}
                >
                  ← Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <span className="qz-muted" style={{ fontSize: 13.5 }}>
                Describe what you want your quiz to do — we&rsquo;ll generate a custom direction from it.
              </span>
              <button
                type="button"
                className="qz-btn qz-btn-ghost qz-btn-sm"
                style={{ alignSelf: "flex-start", color: "var(--qz-accent)", fontWeight: 600 }}
                onClick={() => {
                  setExpandedId(null);
                  setWritingGoal(true);
                }}
              >
                Write a goal →
              </button>
            </>
          )}
        </div>

        {/* Card 4 — Manual create. Removed from the decider flow (owner
            diagram 2026-07-02: a separate process later); legacy in-flight
            drafts keep the escape hatch. */}
        {!isDecider ? (
          <div className="qz-card" style={{ display: "flex", flexDirection: "column", gap: 8, ...muted(false) }}>
            <span style={{ fontFamily: "var(--qz-font-display)", fontSize: 17 }}>⚒ Manual create</span>
            <span className="qz-muted" style={{ fontSize: 13.5 }}>
              Start from a blank quiz and build every question yourself. You&rsquo;ll choose the scoring model in the builder.
            </span>
            <button
              type="button"
              className="qz-btn qz-btn-ghost qz-btn-sm"
              style={{ alignSelf: "flex-start", color: "var(--qz-accent)", fontWeight: 600 }}
              disabled={busy}
              onClick={() => fetcher.submit({ intent: "shape-manual" }, { method: "post" })}
            >
              {pendingIntent === "shape-manual" ? "Opening…" : "Build manually →"}
            </button>
          </div>
        ) : null}
      </div>

      {/* Saved templates — legacy drafts seed the battle card ("configuring");
          decider drafts (O-3, owner-approved 2026-07-03) kick the early
          question build directly and land in Questions & Logic. */}
      <SavedTemplatesRow
        templates={data.savedTemplates}
        fetcher={fetcher}
        pendingIntent={pendingIntent}
        isDecider={isDecider}
      />

      <div className="qz-row" style={{ gap: 10, alignItems: "center" }}>
        <button
          type="button"
          className="qz-btn qz-btn-ghost qz-btn-sm"
          disabled={busy}
          onClick={() => fetcher.submit({ intent: "shape-regenerate" }, { method: "post" })}
        >
          {pendingIntent === "shape-regenerate" ? "Regenerating…" : "↻ Regenerate suggestions"}
        </button>
        <button
          type="button"
          className="qz-btn qz-btn-ghost qz-btn-sm"
          disabled={busy}
          onClick={() => fetcher.submit({ intent: "back-to-grouping" }, { method: "post" })}
        >
          ← Back to recommendations
        </button>
      </div>
    </div>
  );
}

// ── Start-routing spec §2 — the decider Shape: a TEMPLATE PICKER whose single
// job is letting the merchant experience two drafted directions and pick one.
// Write-a-goal + manual live in the intercept modal; here they're quiet escape
// links only (the routing rule: Shape is only ever reached via AI templates).
function DeciderShapeStage({
  data,
  fetcher,
  pendingIntent,
  busy,
}: {
  data: FunnelData;
  fetcher: ReturnType<typeof useFetcher<ActionResult>>;
  pendingIntent: string | null;
  busy: boolean;
}) {
  const [previewTypeId, setPreviewTypeId] = useState<string | null>(null);
  const [writingGoal, setWritingGoal] = useState(false);
  const aiTypes = data.quizTypes.slice(0, 2);
  const previewType = aiTypes.find((t) => t.id === previewTypeId) ?? null;
  const resolved = useMemo(() => resolveDesignTokens(data.designTokens ?? undefined), [data.designTokens]);
  const cssVars = useMemo(() => tokensToCssVars(resolved) as CSSProperties, [resolved]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <QzCard style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div className="qz-row qz-row-between" style={{ alignItems: "center", gap: 8 }}>
          <h2 className="qz-h2" style={{ margin: 0 }}>Shape your quiz</h2>
          <QzBadge tone="draft">Brand ✦</QzBadge>
        </div>
        <p className="qz-dim" style={{ margin: 0 }}>
          Two quiz directions drafted from your catalog — see each one live, then pick.
        </p>
      </QzCard>

      {/* §2.1 provenance banner — the catalog-confidence signal, real counts. */}
      <div className="qz-shape-provenance">
        <span aria-hidden>✨</span>
        <span>
          Generated from your catalog — based on <strong>{data.productCount} products</strong>{" "}
          across <strong>{data.productGroups.length} recommendation target{data.productGroups.length === 1 ? "" : "s"}</strong>.
        </span>
      </div>

      <div className="qz-type-grid">
        {aiTypes.map((t, i) => (
          <button
            key={t.id}
            type="button"
            className={`qz-card qz-shape-card${previewTypeId === t.id ? " is-active" : ""}`}
            disabled={busy}
            onClick={() => setPreviewTypeId(t.id)}
          >
            {/* Gold moment #2 — the AI's top pick carries the ◆ Recommended ribbon. */}
            {i === 0 ? (
              <span className="qz-ribbon-recommended">
                <span className="qz-mark qz-mark--sm" aria-hidden />
                Recommended
              </span>
            ) : null}
            <TypeMiniThumb type={t} cssVars={cssVars} buckets={data.buckets} />
            <span className="qz-row qz-row-between" style={{ gap: 8, alignItems: "flex-start" }}>
              <span style={{ fontFamily: "var(--qz-font-display)", fontSize: 17, lineHeight: 1.2, textAlign: "left" }}>
                {t.name}
              </span>
              <QzBadge tone={t.experience_type === "personality" ? "ok" : "draft"}>
                {XTYPE_LABEL[t.experience_type] ?? t.experience_type}
              </QzBadge>
            </span>
            <span className="qz-muted" style={{ fontSize: 13.5, textAlign: "left" }}>{t.achieves}</span>
            <span className="qz-label">{t.question_range.min}–{t.question_range.max} questions</span>
            <span className="qz-shape-see" aria-hidden>See it live →</span>
          </button>
        ))}
      </div>

      {/* §2.1 escape links (quiet) — these re-route per §1.2; not cards. */}
      <div className="qz-row" style={{ gap: 6, fontSize: 12.5 }}>
        <span className="qz-dim">Prefer to start differently?</span>
        <button type="button" className="qz-link-quiet" disabled={busy} onClick={() => setWritingGoal((v) => !v)}>
          Write a goal
        </button>
        <span className="qz-dim" aria-hidden>·</span>
        <button
          type="button"
          className="qz-link-quiet"
          disabled={busy}
          onClick={() => fetcher.submit({ intent: "manual-build" }, { method: "post" })}
        >
          {pendingIntent === "manual-build" ? "Opening…" : "Build manually"}
        </button>
      </div>

      {writingGoal ? (
        <QzCard style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <strong style={{ fontSize: 14 }}>Describe what you want your quiz to do</strong>
          <GoalPromptBody
            suggestedGoal={data.goal?.goal_text || data.suggestedGoal}
            minGoalChars={data.minGoalChars}
            submitLabel={pendingIntent === "shape-goal-build" ? "Building…" : "Generate from my goal →"}
            onSubmit={(goal) => fetcher.submit({ intent: "shape-goal-build", goal }, { method: "post" })}
            onCancel={() => setWritingGoal(false)}
          />
        </QzCard>
      ) : null}

      <SavedTemplatesRow
        templates={data.savedTemplates}
        fetcher={fetcher}
        pendingIntent={pendingIntent}
        isDecider
      />

      <div className="qz-row" style={{ gap: 10, alignItems: "center" }}>
        <button
          type="button"
          className="qz-btn qz-btn-ghost qz-btn-sm"
          disabled={busy}
          onClick={() => fetcher.submit({ intent: "shape-regenerate" }, { method: "post" })}
        >
          {pendingIntent === "shape-regenerate" ? "Regenerating…" : "↻ Regenerate suggestions"}
        </button>
        <button
          type="button"
          className="qz-btn qz-btn-ghost qz-btn-sm"
          disabled={busy}
          onClick={() => fetcher.submit({ intent: "back-to-grouping" }, { method: "post" })}
        >
          ← Back to recommendations
        </button>
      </div>

      {previewType ? (
        <TemplatePreviewDrawer
          type={previewType}
          buckets={data.buckets}
          catalog={data.catalog}
          cssVars={cssVars}
          resolvedPrimary={resolved.colors?.primary ?? "#5563DE"}
          headingFamily={resolved.typography?.heading?.family ?? ""}
          bodyFamily={resolved.typography?.body?.family ?? ""}
          building={pendingIntent === "shape-continue"}
          onUse={() =>
            fetcher.submit(
              { intent: "shape-continue", typeId: previewType.id, scoring: "direct" },
              { method: "post" },
            )
          }
          onClose={() => setPreviewTypeId(null)}
        />
      ) : null}
    </div>
  );
}

// §2.1 — the card's LIVE mini-thumbnail: a small rendered quiz screen (progress
// bar, question, answers) themed with the draft's tokens — never an icon. The
// answers are the merchant's REAL recommendation targets.
function TypeMiniThumb({
  type,
  cssVars,
  buckets,
}: {
  type: QuizType;
  cssVars: CSSProperties;
  buckets: FunnelData["buckets"];
}) {
  const answers = buckets.slice(0, 3).map((b) => b.name);
  return (
    <span className="qz-shape-thumb" style={cssVars} aria-hidden>
      <span className="qz-shape-thumb-bar">
        <span style={{ width: type.experience_type === "personality" ? "45%" : "30%" }} />
      </span>
      <span className="qz-shape-thumb-q">What are you shopping for today?</span>
      <span className="qz-shape-thumb-answers">
        {(answers.length ? answers : ["Option A", "Option B", "Option C"]).map((a) => (
          <span key={a} className="qz-shape-thumb-chip">
            {a}
          </span>
        ))}
      </span>
    </span>
  );
}

// §2.2 — the live preview drawer: an interactive phone-frame walk of the
// template (Q1 → Q2 → result) on the merchant's REAL targets and products,
// brand-themed, ending on a result screen so the full arc is visible. "Use
// this template" applies it (the same shape-continue the old expanded card
// submitted) and the build takes over.
function TemplatePreviewDrawer({
  type,
  buckets,
  catalog,
  cssVars,
  resolvedPrimary,
  headingFamily,
  bodyFamily,
  building,
  onUse,
  onClose,
}: {
  type: QuizType;
  buckets: FunnelData["buckets"];
  catalog: FunnelData["catalog"];
  cssVars: CSSProperties;
  resolvedPrimary: string;
  headingFamily: string;
  bodyFamily: string;
  building: boolean;
  onUse: () => void;
  onClose: () => void;
}) {
  const [screen, setScreen] = useState(0);
  const [pick1, setPick1] = useState<number | null>(null);
  const [pick2, setPick2] = useState<number | null>(null);
  // Clicking the other card swaps the drawer content — reset the walk.
  useEffect(() => {
    setScreen(0);
    setPick1(null);
    setPick2(null);
  }, [type.id]);

  const fontUrl = useMemo(() => googleFontsUrl([headingFamily, bodyFamily]), [headingFamily, bodyFamily]);
  const ctaText = suggestContrastText(resolvedPrimary);
  const q1Answers = buckets.slice(0, 4).map((b) => b.name);
  const q2Answers = catalog.tags.slice(0, 3).map((t) => t.label);
  const q2Final = q2Answers.length >= 2 ? q2Answers : ["The best overall fit", "Something new"];
  // The tapped target drives the result — real interactivity on real data.
  const resultBucket = buckets[pick1 ?? 0] ?? buckets[0] ?? null;
  const resultProduct = useMemo(() => {
    if (!resultBucket) return catalog.products[0] ?? null;
    if (resultBucket.type === "tag")
      return catalog.products.find((p) => p.tagKeys.includes(resultBucket.key)) ?? catalog.products[0] ?? null;
    if (resultBucket.type === "collection")
      return (
        catalog.products.find((p) => p.collectionIds.includes(resultBucket.key)) ??
        catalog.products[0] ??
        null
      );
    return catalog.products.find((p) => p.id === resultBucket.key) ?? catalog.products[0] ?? null;
  }, [resultBucket, catalog.products]);

  const chip = (label: string, on: boolean, onClick: () => void) => (
    <button key={label} type="button" className={`qz-tpl-chip${on ? " is-on" : ""}`} onClick={onClick}>
      {label}
    </button>
  );

  return (
    <QzDrawer
      open
      onClose={onClose}
      title={type.name}
      subtitle={`${XTYPE_LABEL[type.experience_type] ?? type.experience_type} · tap through the preview`}
      width="min(496px, 94vw)"
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          height: "100%",
          overflow: "hidden",
        }}
      >
        {fontUrl ? <link rel="stylesheet" href={fontUrl} /> : null}
        <p className="qz-dim" style={{ margin: 0, fontSize: 12 }}>
          Themed with your brand identity · your real products.
        </p>

        <div className="qz-rb-phone">
          <div className="qz-rb-phone-screen" style={cssVars}>
            <span className="qz-shape-thumb-bar" style={{ marginBottom: 10 }}>
              <span style={{ width: `${((screen + 1) / 3) * 100}%` }} />
            </span>
            {screen === 0 ? (
              <div className="qz-tpl-q">
                <strong className="qz-rb-pv-name">What are you shopping for today?</strong>
                <div className="qz-tpl-chips">
                  {q1Answers.map((a, i) => chip(a, pick1 === i, () => setPick1(i)))}
                </div>
              </div>
            ) : screen === 1 ? (
              <div className="qz-tpl-q">
                <strong className="qz-rb-pv-name">Anything specific you&rsquo;re into?</strong>
                <div className="qz-tpl-chips">
                  {q2Final.map((a, i) => chip(a, pick2 === i, () => setPick2(i)))}
                </div>
              </div>
            ) : (
              <div className="qz-rb-pv-single">
                <span className="qz-label" style={{ color: "inherit", opacity: 0.6 }}>
                  Your match
                </span>
                {resultProduct?.imageUrl ? (
                  <img className="qz-rb-pv-heroimg" src={resultProduct.imageUrl} alt="" loading="lazy" />
                ) : (
                  <div className="qz-rb-pv-heroimg qz-rb-pv-noimg" aria-hidden>
                    📦
                  </div>
                )}
                <strong className="qz-rb-pv-name">{resultProduct?.title ?? "Your product"}</strong>
                <p className="qz-rb-ghost">✦ AI writes the &ldquo;why we recommend this&rdquo; at quiz time</p>
                <div className="qz-rb-pv-buyrow">
                  <span className="qz-rb-pv-price">
                    {resultProduct?.price != null ? `$${resultProduct.price.toFixed(2)}` : ""}
                  </span>
                  <span className="qz-rb-pv-cta" style={{ color: ctaText }}>
                    Add to cart
                  </span>
                </div>
              </div>
            )}
            {screen < 2 ? (
              <button
                type="button"
                className="qz-tpl-next"
                style={{ color: ctaText }}
                disabled={screen === 0 ? pick1 === null : pick2 === null}
                onClick={() => setScreen((s) => s + 1)}
              >
                Next
              </button>
            ) : (
              <button type="button" className="qz-tpl-next is-restart" onClick={() => setScreen(0)}>
                ↺ Start over
              </button>
            )}
          </div>
        </div>

        <div className="qz-rb-pvfoot">
          <span className="qz-dim" style={{ fontSize: 12 }}>
            Screen {screen + 1} of 3
          </span>
          <button
            type="button"
            className="qz-btn qz-btn-accent qz-btn-sm"
            disabled={building}
            onClick={onUse}
          >
            {building ? "Building…" : "Use this template →"}
          </button>
        </div>
      </div>
    </QzDrawer>
  );
}

// Saved templates (shop-scoped) surface as an alternative to the AI tiers.
// LEGACY drafts: pick one to skip straight to a pre-filled battle card (the
// use-saved-template intent seeds it as the sole tier-2 option + an auto-named
// working copy → configuring). DECIDER drafts (O-3): the pick kicks the early
// question build directly and lands at Questions & Logic — no battle card.
function SavedTemplatesRow({
  templates,
  fetcher,
  pendingIntent,
  isDecider,
}: {
  templates: FunnelData["savedTemplates"];
  fetcher: ReturnType<typeof useFetcher<ActionResult>>;
  pendingIntent: string | null;
  isDecider: boolean;
}) {
  if (templates.length === 0) return null;
  const using = pendingIntent === "use-saved-template";
  const usingId = using ? String(fetcher.formData?.get("templateId") ?? "") : null;
  return (
    <QzCard style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span className="qz-label">Or reuse a saved template</span>
        <span className="qz-dim" style={{ fontSize: 12 }}>
          {isDecider
            ? "Start from one you saved before — we’ll build your questions from it and take you straight to Questions & Logic."
            : "Start from one you saved before — its design dials and recommendation settings come along."}
        </span>
      </div>
      <div className="qz-template-rail">
        {templates.map((s) => (
          <button
            key={s.id}
            type="button"
            className="qz-template-pill"
            disabled={using}
            title={s.template.angle}
            onClick={() =>
              fetcher.submit({ intent: "use-saved-template", templateId: s.id }, { method: "post" })
            }
          >
            {isDecider && usingId === s.id ? "Building…" : <>♻ {s.name}</>}
          </button>
        ))}
      </div>
    </QzCard>
  );
}

// ── Stage: Configuring (tier-2) — the BATTLE CARD: pick a template, fine-tune
// the high-level design dials + recommendation settings, then generate. Edits
// autosave (optimistic + debounce) to the picked_template working copy.
const LEVEL_OPTS: { value: "low" | "medium" | "high"; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Med" },
  { value: "high", label: "High" },
];
const LINE_OPTS: { value: "soft" | "sharp" | "rounded"; label: string }[] = [
  { value: "soft", label: "Soft" },
  { value: "rounded", label: "Rounded" },
  { value: "sharp", label: "Sharp" },
];
const LEVEL_LABEL: Record<"low" | "medium" | "high", string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};
const LINE_LABEL: Record<"soft" | "sharp" | "rounded", string> = {
  soft: "Soft",
  rounded: "Rounded",
  sharp: "Sharp",
};
const OOS_LABEL: Record<RecDefaults["oos_behavior"], string> = {
  show_with_badge: "Show + badge",
  hide: "Hide",
  notify_me: "Notify me",
  fallback: "Fallback",
};

function BattleCardStage({
  data,
  fetcher,
  pendingIntent,
}: {
  data: FunnelData;
  fetcher: ReturnType<typeof useFetcher<ActionResult>>;
  pendingIntent: string | null;
}) {
  const picked = data.pickedTemplate;
  const templates = data.richTemplates;
  const [expandedId, setExpandedId] = useState<string>(picked?.template_id ?? templates[0]?.id ?? "");
  const [optDials, setOptDials] = useState<DesignDials | null>(null);
  const [optRec, setOptRec] = useState<RecDefaults | null>(null);
  const [optName, setOptName] = useState<string | null>(null);
  const [optGroups, setOptGroups] = useState<RecommendedGroup[] | null>(null);
  const dialTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The 3-module deep-dive target: which dial + which disclosure level (2=educate,
  // 3=examples). null = closed (Module 1, the battle card, is always visible).
  const [moduleTarget, setModuleTarget] = useState<{ dial: keyof DesignDials; module: 2 | 3 } | null>(null);

  // Clear the optimistic overlays once the autosave write lands (server canonical).
  useEffect(() => {
    if (fetcher.state === "idle") {
      setOptDials(null);
      setOptRec(null);
      setOptName(null);
      setOptGroups(null);
    }
  }, [fetcher.state]);

  const expanded = templates.find((t) => t.id === expandedId) ?? templates[0];
  const isPicked = Boolean(picked && expanded && picked.template_id === expanded.id);
  const dials: DesignDials | undefined = isPicked && picked ? optDials ?? picked.design_dials : expanded?.dials;
  const rec: RecDefaults | undefined = isPicked && picked ? optRec ?? picked.rec_defaults : expanded?.rec_defaults;
  const name = isPicked && picked ? optName ?? picked.quiz_name : "";
  const groups: RecommendedGroup[] = isPicked && picked ? optGroups ?? picked.recommended_groups : [];

  const saveDials = (next: DesignDials) => {
    setOptDials(next);
    if (dialTimer.current) clearTimeout(dialTimer.current);
    dialTimer.current = setTimeout(
      () => fetcher.submit({ intent: "set-dials", dials: JSON.stringify(next) }, { method: "post" }),
      600,
    );
  };
  const saveRec = (next: RecDefaults) => {
    setOptRec(next);
    if (recTimer.current) clearTimeout(recTimer.current);
    recTimer.current = setTimeout(
      () => fetcher.submit({ intent: "set-rec", rec: JSON.stringify(next) }, { method: "post" }),
      600,
    );
  };
  const saveName = (v: string) => {
    setOptName(v);
    if (nameTimer.current) clearTimeout(nameTimer.current);
    nameTimer.current = setTimeout(() => {
      if (v.trim()) fetcher.submit({ intent: "set-name", name: v }, { method: "post" });
    }, 600);
  };
  // Toggles are discrete (no debounce) — fire immediately, reflect optimistically.
  const toggleGroup = (groupId: string, enabled: boolean) => {
    setOptGroups(groups.map((g) => (g.group_id === groupId ? { ...g, enabled } : g)));
    fetcher.submit({ intent: "toggle-group", groupId, enabled: String(enabled) }, { method: "post" });
  };
  const toggleProduct = (groupId: string, productId: string, enabled: boolean) => {
    setOptGroups(
      groups.map((g) => {
        if (g.group_id !== groupId) return g;
        const set = new Set(g.product_ids);
        if (enabled) set.add(productId);
        else set.delete(productId);
        return { ...g, product_ids: Array.from(set) };
      }),
    );
    fetcher.submit(
      { intent: "toggle-product", groupId, productId, enabled: String(enabled) },
      { method: "post" },
    );
  };

  if (!expanded || !dials || !rec) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <QzCard style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div className="qz-label">Step 3 of 3 · Template</div>
        <h2 className="qz-h2" style={{ margin: 0 }}>Pick a template and fine-tune it</h2>
        <p className="qz-dim" style={{ margin: 0 }}>
          Each is a different way to run your quiz. Select one, adjust the high-level dials, then
          generate the full thing.
        </p>
      </QzCard>

      {isPicked && picked ? (
        <QuizNameBar
          name={name}
          saving={fetcher.state !== "idle"}
          saved={picked.saved_as_template}
          onName={saveName}
          onSaveTemplate={() => fetcher.submit({ intent: "save-template" }, { method: "post" })}
        />
      ) : null}

      <TemplateRail
        templates={templates}
        expandedId={expanded.id}
        pickedId={picked?.template_id ?? null}
        onExpand={setExpandedId}
      />

      <BattleCard
        template={expanded}
        isPicked={isPicked}
        dials={dials}
        rec={rec}
        collections={data.collections}
        recommendedGroups={groups}
        productGroups={data.productGroups}
        onDials={saveDials}
        onRec={(patch) => saveRec({ ...rec, ...patch })}
        onToggleGroup={toggleGroup}
        onToggleProduct={toggleProduct}
        onPick={() => fetcher.submit({ intent: "pick-template", templateId: expanded.id }, { method: "post" })}
        onGenerate={() => fetcher.submit({ intent: "to-design" }, { method: "post" })}
        onDeepDive={(dial) => setModuleTarget({ dial, module: 2 })}
        picking={pendingIntent === "pick-template"}
        generating={pendingIntent === "to-design"}
      />

      {moduleTarget ? (
        <DialModule
          dial={moduleTarget.dial}
          module={moduleTarget.module}
          currentValue={dials[moduleTarget.dial]}
          onSeeExamples={() => setModuleTarget({ dial: moduleTarget.dial, module: 3 })}
          onApply={(v) => saveDials({ ...dials, [moduleTarget.dial]: v } as DesignDials)}
          onClose={() => setModuleTarget(null)}
        />
      ) : null}

      <div className="qz-row" style={{ gap: 10 }}>
        <button
          type="button"
          className="qz-btn qz-btn-ghost qz-btn-sm"
          onClick={() => fetcher.submit({ intent: "back-to-types" }, { method: "post" })}
        >
          ← Back to types
        </button>
      </div>
    </div>
  );
}

function QuizNameBar({
  name,
  saving,
  saved,
  onName,
  onSaveTemplate,
}: {
  name: string;
  saving: boolean;
  saved: boolean;
  onName: (v: string) => void;
  onSaveTemplate: () => void;
}) {
  return (
    <QzCard style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="qz-row qz-row-between" style={{ gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 240px" }}>
          <QzField label="Quiz name" hint="Auto-named from your template — edit it, but you never start blank.">
            <QzInput value={name} onChange={(e) => onName(e.target.value)} />
          </QzField>
        </div>
        <div className="qz-row" style={{ gap: 8, alignItems: "center" }}>
          {saving ? <span className="qz-mono qz-dim" style={{ fontSize: 11 }}>Saving…</span> : null}
          {saved ? (
            <QzBadge tone="ok">Saved as template</QzBadge>
          ) : (
            <button type="button" className="qz-btn qz-btn-sm" onClick={onSaveTemplate}>
              Save as template
            </button>
          )}
        </div>
      </div>
    </QzCard>
  );
}

function TemplateRail({
  templates,
  expandedId,
  pickedId,
  onExpand,
}: {
  templates: RichTemplateOption[];
  expandedId: string;
  pickedId: string | null;
  onExpand: (id: string) => void;
}) {
  return (
    <div className="qz-template-rail">
      {templates.map((t) => (
        <QzTooltip key={t.id} content={t.angle}>
          <button
            type="button"
            className={t.id === expandedId ? "qz-template-pill is-active" : "qz-template-pill"}
            onClick={() => onExpand(t.id)}
          >
            {pickedId === t.id ? <span aria-hidden>✓ </span> : null}
            {t.title}
          </button>
        </QzTooltip>
      ))}
    </div>
  );
}

function DialRow<T extends string>({
  label,
  options,
  value,
  displayLabel,
  isPicked,
  onChange,
  onDeepDive,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  displayLabel: string;
  isPicked: boolean;
  onChange: (v: T) => void;
  onDeepDive?: () => void;
}) {
  return (
    <div className="qz-dial-row">
      <span className="qz-dial-row-label">{label}</span>
      {isPicked ? (
        <QzSegmented options={options} value={value} onChange={onChange} ariaLabel={label} />
      ) : (
        <QzBadge tone="draft">{displayLabel}</QzBadge>
      )}
      {onDeepDive ? (
        <button
          type="button"
          className="qz-btn qz-btn-ghost qz-btn-sm qz-dial-info"
          aria-label={`What does ${label} mean?`}
          onClick={onDeepDive}
        >
          ⓘ
        </button>
      ) : null}
    </div>
  );
}

function BattleCard({
  template,
  isPicked,
  dials,
  rec,
  collections,
  recommendedGroups,
  productGroups,
  onDials,
  onRec,
  onToggleGroup,
  onToggleProduct,
  onPick,
  onGenerate,
  onDeepDive,
  picking,
  generating,
}: {
  template: RichTemplateOption;
  isPicked: boolean;
  dials: DesignDials;
  rec: RecDefaults;
  collections: Array<{ collectionId: string; title: string }>;
  recommendedGroups: RecommendedGroup[];
  productGroups: FunnelData["productGroups"];
  onDials: (next: DesignDials) => void;
  onRec: (patch: Partial<RecDefaults>) => void;
  onToggleGroup: (groupId: string, enabled: boolean) => void;
  onToggleProduct: (groupId: string, productId: string, enabled: boolean) => void;
  onPick: () => void;
  onGenerate: () => void;
  onDeepDive: (dial: keyof DesignDials) => void;
  picking: boolean;
  generating: boolean;
}) {
  return (
    <QzCard className="qz-battle-card">
      <div className="qz-battle-section qz-row qz-row-between" style={{ alignItems: "flex-start", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="qz-label">{template.question_count} questions</span>
          <h3 className="qz-h2" style={{ margin: 0 }}>{template.title}</h3>
          <p className="qz-muted" style={{ margin: 0, fontSize: 13.5 }}>{template.angle}</p>
        </div>
        <QzBadge tone="draft">{XTYPE_LABEL[template.experience_type] ?? template.experience_type}</QzBadge>
      </div>

      <div className="qz-battle-section">
        <div className="qz-label" style={{ marginBottom: 6 }}>What makes this template</div>
        <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
          {template.feature_notes.map((n, i) => (
            <li key={i} style={{ fontSize: 13.5 }}>{n}</li>
          ))}
        </ul>
      </div>

      <div className="qz-battle-section">
        <div className="qz-row qz-row-between" style={{ marginBottom: 8, alignItems: "center" }}>
          <span className="qz-label">Design dials</span>
          {isPicked ? <span className="qz-dim" style={{ fontSize: 11.5 }}>Tap ⓘ to see what each does</span> : null}
        </div>
        <DialRow
          label="Imagery"
          options={LEVEL_OPTS}
          value={dials.imagery}
          displayLabel={LEVEL_LABEL[dials.imagery]}
          isPicked={isPicked}
          onChange={(v) => onDials({ ...dials, imagery: v })}
          onDeepDive={isPicked ? () => onDeepDive("imagery") : undefined}
        />
        <DialRow
          label="Graphics"
          options={LEVEL_OPTS}
          value={dials.graphics}
          displayLabel={LEVEL_LABEL[dials.graphics]}
          isPicked={isPicked}
          onChange={(v) => onDials({ ...dials, graphics: v })}
          onDeepDive={isPicked ? () => onDeepDive("graphics") : undefined}
        />
        <DialRow
          label="Word-forward"
          options={LEVEL_OPTS}
          value={dials.word_forward}
          displayLabel={LEVEL_LABEL[dials.word_forward]}
          isPicked={isPicked}
          onChange={(v) => onDials({ ...dials, word_forward: v })}
          onDeepDive={isPicked ? () => onDeepDive("word_forward") : undefined}
        />
        <DialRow
          label="Lines"
          options={LINE_OPTS}
          value={dials.lines}
          displayLabel={LINE_LABEL[dials.lines]}
          isPicked={isPicked}
          onChange={(v) => onDials({ ...dials, lines: v })}
          onDeepDive={isPicked ? () => onDeepDive("lines") : undefined}
        />
      </div>

      <div className="qz-battle-section">
        <div className="qz-label" style={{ marginBottom: 8 }}>Recommendation</div>
        {isPicked ? (
          <div className="qz-row" style={{ gap: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
            <QzField label="Max products">
              <QzInput
                type="number"
                min={1}
                max={12}
                value={rec.max_products}
                onChange={(e) =>
                  onRec({ max_products: Math.max(1, Math.min(12, Number(e.target.valueAsNumber) || 3)) })
                }
                style={{ width: 90 }}
              />
            </QzField>
            <QzField label="Out of stock">
              <QzSelect
                value={rec.oos_behavior}
                onChange={(e) => onRec({ oos_behavior: e.target.value as RecDefaults["oos_behavior"] })}
              >
                <option value="show_with_badge">Show + badge</option>
                <option value="hide">Hide</option>
                <option value="fallback">Fallback collection</option>
              </QzSelect>
            </QzField>
            {rec.oos_behavior === "fallback" ? (
              <QzField label="Fallback collection">
                <QzSelect
                  value={rec.fallback_collection_id}
                  onChange={(e) => onRec({ fallback_collection_id: e.target.value })}
                >
                  <option value="">Best sellers (default)</option>
                  {collections.map((c) => (
                    <option key={c.collectionId} value={c.collectionId}>{c.title}</option>
                  ))}
                </QzSelect>
              </QzField>
            ) : null}
          </div>
        ) : (
          <div className="qz-row" style={{ gap: 8, flexWrap: "wrap" }}>
            <QzBadge tone="draft">Max {rec.max_products}</QzBadge>
            <QzBadge tone="draft">OOS: {OOS_LABEL[rec.oos_behavior]}</QzBadge>
          </div>
        )}
      </div>

      {isPicked ? (
        <RecProductsEditor
          groups={recommendedGroups}
          catalog={productGroups}
          onToggleGroup={onToggleGroup}
          onToggleProduct={onToggleProduct}
        />
      ) : null}

      <div
        className="qz-battle-section qz-row"
        style={{ gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}
      >
        {isPicked ? (
          <button type="button" className="qz-btn qz-btn-accent" disabled={generating} onClick={onGenerate}>
            {generating ? "Loading…" : "Continue →"}
          </button>
        ) : (
          <button type="button" className="qz-btn qz-btn-primary" disabled={picking} onClick={onPick}>
            {picking ? "Selecting…" : "Select this template"}
          </button>
        )}
      </div>
    </QzCard>
  );
}

// ── Recommended products (the battle card's "N Recommended Products" editor) ──
// The confirmed buckets render as toggle-chip groups; de-selections are template-
// scoped overrides on picked_template.recommended_groups (applied to the quiz's
// Category.productIds at build time, never mutating other quizzes). A disabled
// group gets no result page; a de-selected product drops from its bucket.
function RecProductsEditor({
  groups,
  catalog,
  onToggleGroup,
  onToggleProduct,
}: {
  groups: RecommendedGroup[];
  catalog: FunnelData["productGroups"];
  onToggleGroup: (groupId: string, enabled: boolean) => void;
  onToggleProduct: (groupId: string, productId: string, enabled: boolean) => void;
}) {
  const catalogById = useMemo(() => new Map(catalog.map((c) => [c.id, c])), [catalog]);
  if (groups.length === 0) return null;
  const enabledCount = groups.filter((g) => g.enabled).length;
  return (
    <div className="qz-battle-section">
      <div className="qz-row qz-row-between" style={{ alignItems: "baseline", marginBottom: 4 }}>
        <span className="qz-label">Recommended products</span>
        <span className="qz-dim" style={{ fontSize: 11.5 }}>
          {enabledCount} of {groups.length} group{groups.length === 1 ? "" : "s"} on
        </span>
      </div>
      <p className="qz-muted" style={{ margin: "0 0 10px", fontSize: 13 }}>
        Which product groups this quiz can recommend — and which items inside them. A group that's off
        won't get a result page.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {groups.map((g) => {
          const all = catalogById.get(g.group_id)?.products ?? [];
          const selected = new Set(g.product_ids);
          const onCount = all.length ? all.filter((p) => selected.has(p.id)).length : selected.size;
          return (
            <div key={g.group_id} className={g.enabled ? "qz-rec-group" : "qz-rec-group is-off"}>
              <label className="qz-rec-group-head">
                <input
                  type="checkbox"
                  checked={g.enabled}
                  onChange={(e) => onToggleGroup(g.group_id, e.target.checked)}
                />
                <span className="qz-rec-group-name">{g.group_name || "Group"}</span>
                <span className="qz-dim" style={{ fontSize: 11.5 }}>
                  {g.enabled ? (all.length ? `${onCount}/${all.length} products` : "on") : "off"}
                </span>
              </label>
              {g.enabled && all.length > 0 ? (
                <div className="qz-rec-chips">
                  {all.map((p) => {
                    const on = selected.has(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        className={on ? "qz-chip-toggle is-on" : "qz-chip-toggle"}
                        aria-pressed={on}
                        title={on ? `Remove ${p.title}` : `Add ${p.title}`}
                        onClick={() => onToggleProduct(g.group_id, p.id, !on)}
                      >
                        {p.title}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── The 3-module progressive disclosure ──────────────────────────────────────
// Module 1 is the battle card itself (always visible). Module 2 ("educate")
// explains what a dial does in plain language; Module 3 ("deep-dive") shows the
// live before/after gallery and lets the merchant apply a level inline. Both are
// rendered by DialModule below, keyed off the BattleCardStage's moduleTarget.

const DIAL_EDU: Record<keyof DesignDials, { label: string; what: string; deep: string }> = {
  imagery: {
    label: "Imagery",
    what: "How often product and lifestyle photos appear inside the question flow. High leans on image-led questions (photo answer tiles, a hero up top); Low keeps questions clean and text-only.",
    deep: "Higher imagery suits visual, browse-driven catalogs where shoppers pick by look. Lower imagery suits spec- or needs-driven shopping where photos distract from the decision. Compare a few questions below, then apply the level that fits.",
  },
  graphics: {
    label: "Graphics",
    what: "Decorative weight — answer icons/emoji, section chapters, and overall spacing. High feels chaptered, icon-rich, and airy; Low is compact and unadorned.",
    deep: "More graphics make a longer quiz feel friendly and guided; fewer keep a short quiz fast and serious. This also nudges the layout's breathing room.",
  },
  word_forward: {
    label: "Word-forward",
    what: "How much text each question carries. High adds explainer copy and reassuring helper text (great for considered, educational categories); Low keeps every question short and punchy.",
    deep: "Educational categories (supplements, skincare, gear) convert better when the quiz teaches as it asks. Impulse and visual categories do better with minimal copy that gets out of the way.",
  },
  lines: {
    label: "Lines",
    what: "The edge style used throughout the quiz — Soft (fully rounded), Rounded (gentle corners), or Sharp (square, precise).",
    deep: "Soft reads playful and approachable; Sharp reads precise and premium/clinical; Rounded sits in between. This maps to the corner radius on every card, button, and answer tile.",
  },
};

interface ExampleTile {
  value: string;
  label: string;
  q: string;
  answers: string[];
  hero: boolean;
  overrides: CSSProperties;
}

const SAMPLE_Q = "What's your skill level?";
const SAMPLE_A = ["Beginner", "Intermediate"];

// Each tile is a tiny quiz-card mock rendered from the live --qz-* tokens with a
// per-dial CSS-custom-property override — no screenshots, no AI, rebrands for free.
const DIAL_EXAMPLES: Record<keyof DesignDials, ExampleTile[]> = {
  imagery: [
    { value: "high", label: "High", q: SAMPLE_Q, answers: SAMPLE_A, hero: true, overrides: {} },
    { value: "medium", label: "Med", q: SAMPLE_Q, answers: SAMPLE_A, hero: true, overrides: { "--tile-hero-h": "20px" } as CSSProperties },
    { value: "low", label: "Low", q: SAMPLE_Q, answers: SAMPLE_A, hero: false, overrides: {} },
  ],
  graphics: [
    { value: "high", label: "High", q: "🏔️ " + SAMPLE_Q, answers: ["🟢 Beginner", "🔵 Intermediate"], hero: false, overrides: { "--tile-pad": "13px" } as CSSProperties },
    { value: "medium", label: "Med", q: SAMPLE_Q, answers: SAMPLE_A, hero: false, overrides: {} },
    { value: "low", label: "Low", q: SAMPLE_Q, answers: SAMPLE_A, hero: false, overrides: { "--tile-pad": "7px" } as CSSProperties },
  ],
  word_forward: [
    { value: "high", label: "High", q: "Tell us about your experience so we can tailor every pick", answers: ["I'm just starting out and want guidance", "I know my way around"], hero: false, overrides: {} },
    { value: "medium", label: "Med", q: SAMPLE_Q, answers: SAMPLE_A, hero: false, overrides: {} },
    { value: "low", label: "Low", q: "Your level?", answers: ["New", "Pro"], hero: false, overrides: {} },
  ],
  lines: [
    { value: "soft", label: "Soft", q: SAMPLE_Q, answers: SAMPLE_A, hero: false, overrides: { "--tile-radius": "999px" } as CSSProperties },
    { value: "rounded", label: "Rounded", q: SAMPLE_Q, answers: SAMPLE_A, hero: false, overrides: { "--tile-radius": "12px" } as CSSProperties },
    { value: "sharp", label: "Sharp", q: SAMPLE_Q, answers: SAMPLE_A, hero: false, overrides: { "--tile-radius": "0px" } as CSSProperties },
  ],
};

// Values are level/edge words ("low"/"soft"/…) — capitalize for display.
const dialDisplay = (value: string): string => (value ? value.charAt(0).toUpperCase() + value.slice(1) : value);

function DialModule({
  dial,
  module,
  currentValue,
  onSeeExamples,
  onApply,
  onClose,
}: {
  dial: keyof DesignDials;
  module: 2 | 3;
  currentValue: string;
  onSeeExamples: () => void;
  onApply: (value: string) => void;
  onClose: () => void;
}) {
  const edu = DIAL_EDU[dial];
  return (
    <QzCard className={module === 3 ? "qz-module-card qz-module-card--deep" : "qz-module-card"}>
      <div className="qz-row qz-row-between" style={{ alignItems: "flex-start", gap: 10 }}>
        <div>
          <div className="qz-label">
            {edu.label} · {module === 2 ? "What this does" : "See the difference"}
          </div>
          <p className="qz-muted" style={{ margin: "4px 0 0", fontSize: 13.5, lineHeight: 1.45 }}>
            {module === 2 ? edu.what : edu.deep}
          </p>
        </div>
        <button type="button" className="qz-btn qz-btn-ghost qz-btn-sm" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </div>

      {module === 2 ? (
        <div className="qz-row" style={{ gap: 12, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span className="qz-dim" style={{ fontSize: 12.5 }}>
            Currently: <strong>{dialDisplay(currentValue)}</strong>
          </span>
          <button type="button" className="qz-link-btn" onClick={onSeeExamples}>
            See examples →
          </button>
        </div>
      ) : (
        <DialExampleGallery dial={dial} currentValue={currentValue} onApply={onApply} />
      )}
    </QzCard>
  );
}

function DialExampleGallery({
  dial,
  currentValue,
  onApply,
}: {
  dial: keyof DesignDials;
  currentValue: string;
  onApply: (value: string) => void;
}) {
  const tiles = DIAL_EXAMPLES[dial];
  return (
    <div className="qz-example-gallery" style={{ marginTop: 12 }}>
      {tiles.map((t) => {
        const active = t.value === currentValue;
        return (
          <div key={t.value} className={active ? "qz-example-tile is-active" : "qz-example-tile"}>
            <div className="qz-tile-render" style={t.overrides}>
              {t.hero ? <div className="qz-tile-hero" aria-hidden="true" /> : null}
              <div className="qz-tile-q">{t.q}</div>
              <div className="qz-tile-answers">
                {t.answers.map((a, i) => (
                  <span key={i} className="qz-tile-chip">
                    {a}
                  </span>
                ))}
              </div>
            </div>
            <div className="qz-tile-cap">
              {active ? (
                <QzBadge tone="ok">Current · {t.label}</QzBadge>
              ) : (
                <button type="button" className="qz-link-btn" onClick={() => onApply(t.value)}>
                  Update to {t.label}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
