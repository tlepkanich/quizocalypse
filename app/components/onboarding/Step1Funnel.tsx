import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Link, useFetcher, useRevalidator } from "@remix-run/react";
import {
  QzPage,
  QzPageHeader,
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
import { ClientOnly, BuilderSkeleton } from "../studio/ClientOnly";
import type { BucketSuggestion } from "../../lib/bucketDetect";
import { THEME_PRESETS, type ThemePreset } from "../../lib/themePresets";

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
    <QzPage>
      <QzPageHeader
        eyebrow="AI-first setup · Step 1"
        title="Shape your quiz"
        subtitle="We read your catalog, group your products, and draft a few quiz directions to pick from."
        actions={
          <div className="qz-row" style={{ gap: 8 }}>
            {data.identitySummary ? (
              <button
                type="button"
                className="qz-btn qz-btn-ghost qz-btn-sm"
                onClick={() => setShowIdentity(true)}
              >
                ✦ Current brand identity
              </button>
            ) : null}
            <Link to="/studio" className="qz-btn qz-btn-ghost qz-btn-sm">
              ← All quizzes
            </Link>
          </div>
        }
      />

      {showIdentity && data.identitySummary ? (
        <BrandIdentityModal summary={data.identitySummary} onClose={() => setShowIdentity(false)} />
      ) : null}

      <FunnelProgress stage={data.stage} />

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
  );
}

// The funnel's visible step order — shared by FunnelProgress AND the Step-N-of-M
// stepper inside each stage, so the "of N" count can't drift from the dots.
// The re-sequenced visible order: Buckets → Shape → Questions → Rec Page → Design.
// Goal is folded INTO Shape (the "write your goal" card); the early question build
// runs right after Shape and lands on Questions; Design's Continue opens the main
// builder directly (Overview + Generate are retired from the flow).
const FUNNEL_STAGES: Array<{ key: string; label: string }> = [
  { key: "grouping", label: "Buckets" },
  { key: "types", label: "Shape" },
  { key: "question_builder", label: "Questions" },
  { key: "rec_page", label: "Recommendation" },
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

// A slim stage indicator across the funnel.
function FunnelProgress({ stage }: { stage: FunnelData["stage"] }) {
  const activeIdx = FUNNEL_STAGES.findIndex((s) => s.key === visibleStageKey(stage));
  return (
    <div className="qz-row" style={{ gap: 8, margin: "2px 0 18px", flexWrap: "wrap" }}>
      {FUNNEL_STAGES.map((s, i) => (
        <span
          key={s.key}
          className="qz-row"
          style={{ gap: 6, fontSize: 12.5, color: i <= activeIdx ? "var(--qz-ink)" : "var(--qz-ink-4)" }}
        >
          <span
            aria-hidden
            style={{
              width: 7,
              height: 7,
              borderRadius: 999,
              background: i <= activeIdx ? "var(--qz-accent)" : "var(--qz-ink-4)",
              opacity: i <= activeIdx ? 1 : 0.4,
            }}
          />
          {s.label}
          {i < FUNNEL_STAGES.length - 1 ? <span className="qz-dim" style={{ marginLeft: 2 }}>·</span> : null}
        </span>
      ))}
    </div>
  );
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
  const applying = pendingIntent === "set-design";
  const apply = (preset: ThemePreset) => {
    setAppliedId(preset.id);
    fetcher.submit({ intent: "set-design", tokens: JSON.stringify(preset.tokens) }, { method: "post" });
  };
  const [fields, setFields] = useState<Record<string, string>>({});
  const applyingField = pendingIntent === "set-design-field";
  const applyField = (field: string, value: string) => {
    setFields((f) => ({ ...f, [field]: value }));
    fetcher.submit({ intent: "set-design-field", field, value }, { method: "post" });
  };
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
        <BrandIdentityPanel
          tokens={data.designTokens}
          onColor={(key, hex) =>
            fetcher.submit({ intent: "set-design-color", key, value: hex }, { method: "post" })
          }
          onFont={(slot, family) =>
            fetcher.submit({ intent: "set-design-font", slot, family }, { method: "post" })
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
          currentTokens={data.designTokens}
          busy={applying}
          onApply={(t) =>
            fetcher.submit(
              { intent: "set-design", tokens: JSON.stringify(t.tokens) },
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
            active={fields.radius}
            onPick={(v) => applyField("radius", v)}
            busy={applyingField}
          />
          <FineTuneRow
            label="Buttons"
            options={[["filled", "Filled"], ["outline", "Outline"], ["ghost", "Ghost"]]}
            active={fields.button_style}
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
            value={data.designTokens.style_bar}
            onCommit={(sb) =>
              fetcher.submit(
                { intent: "set-style-bar", style_bar: JSON.stringify(sb) },
                { method: "post" },
              )
            }
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
      label: "Recommendation buckets",
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
  { type: "product", label: "Individual Products" },
  { type: "tag", label: "Tags" },
  { type: "collection", label: "Collections" },
];

const TYPE_BADGE: Record<BucketType, "draft" | "ok" | "warn"> = {
  product: "draft",
  tag: "ok",
  collection: "warn",
};

const TYPE_GLYPH: Record<BucketType, string> = { product: "📦", tag: "🏷️", collection: "🗂️" };

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
  const [dismissed, setDismissed] = useState(data.bannerDismissed);
  const [search, setSearch] = useState("");
  const q = useDeferredValue(search).trim().toLowerCase();
  // P3 overlays: the tab-lock confirm (a type change with buckets) + the
  // read-only "View products" drawer.
  const [lockTarget, setLockTarget] = useState<BucketType | null>(null);
  const [drawerGroup, setDrawerGroup] = useState<BucketCard | null>(null);

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

  // One toggle = one optimistic overlay write + one server write. The grid card
  // and the shelf chip share this, so removing in either place is the same op.
  const toggle = (card: BucketCard) => {
    const on = !isOn(card.type, card.key);
    overlaySet(idOf(card.type, card.key), on ? card : null);
    fetcher.submit(
      { intent: "toggle-bucket", type: card.type, key: card.key, on: String(on) },
      { method: "post" },
    );
  };

  // Tab switch persists active_tab; a non-suggested tab click also dismisses the
  // AI banner (folded into the one submit so a single fetcher does both). Buckets
  // are homogeneous to the active source, so switching with ≥1 bucket prompts the
  // TabLockModal first (confirm → clear all, then switch).
  const doSwitchTab = (type: BucketType, clear: boolean) => {
    const dismiss = !dismissed && type !== data.suggestion.suggestedType;
    setActiveTab(type);
    setSearch("");
    if (dismiss) setDismissed(true);
    if (clear) {
      // Optimistically empty the selection (mark every current id removed).
      setOverlay(() => {
        const next = new Map<string, BucketCard | null>();
        for (const c of selected.values()) next.set(idOf(c.type, c.key), null);
        return next;
      });
    }
    fetcher.submit(
      {
        intent: "switch-tab",
        type,
        ...(clear ? { clear: "true" } : {}),
        ...(dismiss ? { dismiss: "true" } : {}),
      },
      { method: "post" },
    );
  };

  const switchTab = (type: BucketType) => {
    if (type === activeTab) return;
    if (selected.size > 0) {
      setLockTarget(type); // confirm via the modal
      return;
    }
    doSwitchTab(type, false);
  };

  const dismissBanner = () => {
    setDismissed(true);
    fetcher.submit({ intent: "dismiss-banner" }, { method: "post" });
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

  return (
    <div className="qz-rb">
      <div className="qz-rb-head">
        <div className="qz-label">
          Step 1 of {stepCount} · Recommendation Buckets
        </div>
        <h2 className="qz-h2" style={{ margin: 0 }}>
          What can your quiz recommend?
        </h2>
        <p className="qz-dim" style={{ margin: 0 }}>
          Pick the outcomes shoppers can land on — individual products, tags, or whole
          collections. We&rsquo;ll route the quiz toward whichever fits each shopper.
        </p>
      </div>

      {/* 1 — AI suggestion banner */}
      {!dismissed ? <RbBanner suggestion={data.suggestion} onDismiss={dismissBanner} /> : null}

      {/* 2 — Catalog browser */}
      <QzCard flush className="qz-rb-browser">
        <div className="qz-rb-tabs" role="tablist" aria-label="Bucket source">
          {TAB_META.map((t) => {
            const n = tabCounts[t.type];
            const on = t.type === activeTab;
            return (
              <button
                key={t.type}
                type="button"
                role="tab"
                aria-selected={on}
                className={`qz-rb-tab${on ? " is-active" : ""}`}
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
                <div key={c.key} className="qz-rb-cardwrap">
                  <button
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
                  {activeTab !== "product" ? (
                    <button
                      type="button"
                      className="qz-rb-view"
                      aria-label={`View products in ${c.name}`}
                      onClick={() => setDrawerGroup(c)}
                    >
                      View ↗
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </QzCard>

      {/* 3 — Bucket shelf */}
      <div className="qz-rb-shelf">
        <div className="qz-row qz-row-between" style={{ flexWrap: "wrap", gap: 8 }}>
          <strong>Recommendation buckets</strong>
          <span className="qz-dim" style={{ fontSize: 13 }}>
            {count} selected
          </span>
        </div>
        {count === 0 ? (
          <div className="qz-rb-empty qz-dim">
            No buckets yet — pick products, tags, or collections above. These become the
            outcomes your quiz can recommend.
          </div>
        ) : (
          <div className="qz-rb-chips">
            {selectedList.map((c) => (
              <span key={idOf(c.type, c.key)} className="qz-rb-chip">
                <span className="qz-rb-chip-thumb">
                  {c.thumbnailUrl ? (
                    <img src={c.thumbnailUrl} alt="" loading="lazy" />
                  ) : (
                    <span aria-hidden>{TYPE_GLYPH[c.type]}</span>
                  )}
                </span>
                <span className="qz-rb-chip-body">
                  <span className="qz-rb-chip-name">{c.name}</span>
                  <QzBadge tone={TYPE_BADGE[c.type]}>{c.type}</QzBadge>
                </span>
                <button
                  type="button"
                  className="qz-rb-chip-x"
                  aria-label={`Remove ${c.name}`}
                  onClick={() => toggle(c)}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
        {count === 1 ? (
          <p className="qz-rb-warn">
            One bucket means every shopper sees the same products. Add a few more so the quiz
            can actually differentiate.
          </p>
        ) : null}
      </div>

      {/* 4 — Stepper */}
      <div className="qz-rb-stepper">
        <Link to={data.backHref} className="qz-btn qz-btn-ghost">
          ← Back
        </Link>
        <div className="qz-row" style={{ gap: 12, flexWrap: "wrap", justifyContent: "flex-end" }}>
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
          {count === 0 ? (
            <QzTooltip content="Add at least one recommendation bucket to continue.">
              <button type="button" className="qz-btn qz-btn-accent" disabled>
                Continue →
              </button>
            </QzTooltip>
          ) : (
            <button
              type="button"
              className="qz-btn qz-btn-accent"
              onClick={() => fetcher.submit({ intent: "continue-buckets" }, { method: "post" })}
              disabled={continuing}
            >
              {continuing ? "Saving…" : "Continue →"}
            </button>
          )}
        </div>
      </div>

      {/* P3 overlays */}
      {lockTarget ? (
        <TabLockModal
          targetLabel={TAB_META.find((t) => t.type === lockTarget)?.label ?? ""}
          count={count}
          onConfirm={() => {
            doSwitchTab(lockTarget, true);
            setLockTarget(null);
          }}
          onCancel={() => setLockTarget(null)}
        />
      ) : null}
      {drawerGroup ? (
        <ProductPreviewDrawer
          group={drawerGroup}
          products={data.catalog.products}
          onClose={() => setDrawerGroup(null)}
        />
      ) : null}
    </div>
  );
}

// Close an overlay on Escape (the QzTooltip pattern, listener-scoped to mount).
function useEscClose(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
}

// Confirm switching the bucket source when buckets already exist (they're tied to
// the current source, so switching clears them).
// The brand identity summary, opened on demand from the funnel header so the page
// leads with the task instead of a paragraph of summary. Read-only here — the full
// view/edit lives on the Brand Identity tab.
function BrandIdentityModal({ summary, onClose }: { summary: string; onClose: () => void }) {
  useEscClose(onClose);
  return (
    <div className="qz-rb-scrim" onClick={onClose}>
      <div
        className="qz-rb-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Current brand identity"
        style={{ width: "min(540px, 92vw)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="qz-row qz-row-between" style={{ alignItems: "flex-start", gap: 10 }}>
          <strong style={{ fontSize: 16 }}>Current brand identity</strong>
          <button
            type="button"
            className="qz-btn qz-btn-ghost qz-btn-sm"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6 }}>{summary}</p>
        <p className="qz-dim" style={{ margin: 0, fontSize: 12 }}>
          The AI uses this to tailor every quiz it builds.
        </p>
        <div className="qz-row" style={{ justifyContent: "flex-end" }}>
          <Link to="/studio/brand" className="qz-btn qz-btn-ghost qz-btn-sm">
            View &amp; edit full identity →
          </Link>
        </div>
      </div>
    </div>
  );
}

function TabLockModal({
  targetLabel,
  count,
  onConfirm,
  onCancel,
}: {
  targetLabel: string;
  count: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEscClose(onCancel);
  return (
    <div className="qz-rb-scrim" onClick={onCancel}>
      <div
        className="qz-rb-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Switch bucket source"
        onClick={(e) => e.stopPropagation()}
      >
        <strong style={{ fontSize: 16 }}>Switch to {targetLabel}?</strong>
        <p className="qz-dim" style={{ margin: 0, fontSize: 13.5 }}>
          Your {count} current bucket{count === 1 ? "" : "s"} {count === 1 ? "is" : "are"} tied to
          this source. Switching clears {count === 1 ? "it" : "them"} so you can start fresh.
        </p>
        <div className="qz-row" style={{ gap: 10, justifyContent: "flex-end" }}>
          <button type="button" className="qz-btn qz-btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="qz-btn qz-btn-accent" onClick={onConfirm}>
            Switch &amp; clear
          </button>
        </div>
      </div>
    </div>
  );
}

// Read-only right-side drawer: the products inside a tag/collection bucket,
// resolved client-side from the catalog (no server round-trip).
function ProductPreviewDrawer({
  group,
  products,
  onClose,
}: {
  group: BucketCard;
  products: FunnelData["catalog"]["products"];
  onClose: () => void;
}) {
  useEscClose(onClose);
  const members = useMemo(() => {
    if (group.type === "tag") return products.filter((p) => p.tagKeys.includes(group.key));
    if (group.type === "collection")
      return products.filter((p) => p.collectionIds.includes(group.key));
    return products.filter((p) => p.id === group.key);
  }, [group, products]);
  return (
    <div className="qz-rb-scrim" onClick={onClose}>
      <aside
        className="qz-rb-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Products in ${group.name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="qz-rb-drawer-head">
          <div style={{ minWidth: 0 }}>
            <div className="qz-label">{group.type}</div>
            <strong className="qz-rb-card-name" style={{ display: "block" }}>
              {group.name}
            </strong>
          </div>
          <button type="button" className="qz-rb-banner-x" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <p className="qz-dim" style={{ margin: "0 0 6px", fontSize: 12.5 }}>
          {members.length} product{members.length === 1 ? "" : "s"} · read-only preview
        </p>
        <div className="qz-rb-drawer-list">
          {members.map((p) => (
            <div key={p.id} className="qz-rb-drawer-row">
              <span className="qz-rb-thumb">
                {p.imageUrl ? (
                  <img src={p.imageUrl} alt="" loading="lazy" />
                ) : (
                  <span aria-hidden>📦</span>
                )}
              </span>
              <span className="qz-rb-card-body">
                <span className="qz-rb-card-name">{p.title}</span>
                <span className="qz-rb-card-meta qz-dim">
                  {p.price != null ? `$${p.price.toFixed(2)}` : "—"}
                </span>
              </span>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

// The AI suggestion banner — strong/weak signal + the data-backed reason.
function RbBanner({
  suggestion,
  onDismiss,
}: {
  suggestion: BucketSuggestion;
  onDismiss: () => void;
}) {
  const headline =
    suggestion.strength === "strong"
      ? "We found a clean way to bucket your catalog"
      : suggestion.strength === "weak"
        ? "A couple of ways could work"
        : "Pick the products to recommend";
  return (
    <div className={`qz-rb-banner is-${suggestion.strength ?? "none"}`}>
      <span className="qz-rb-banner-icon" aria-hidden>
        ✨
      </span>
      <div className="qz-rb-banner-body">
        <div className="qz-rb-banner-head">
          <strong>{headline}</strong>
          {suggestion.strength ? (
            <QzBadge tone={suggestion.strength === "strong" ? "ok" : "warn"}>
              {suggestion.strength === "strong" ? "Strong signal" : "Worth a look"}
            </QzBadge>
          ) : null}
        </div>
        <p className="qz-dim" style={{ margin: 0, fontSize: 13 }}>
          {suggestion.reason}
        </p>
      </div>
      <button
        type="button"
        className="qz-rb-banner-x"
        aria-label="Dismiss suggestion"
        onClick={onDismiss}
      >
        ✕
      </button>
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
// Shape-Your-Quiz spec — the four-card "Shape your quiz" page that replaces the
// linear Types → Templates → BattleCard selection. Two AI quiz-type cards
// (generated to differ), a Write-Your-Goal card, and a Manual-Create card.
// Selecting an AI card expands it in place (siblings mute) and REQUIRES a
// scoring-model choice (no default) before Continue → the build.
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
  // The spec shows exactly two AI suggestions, intentionally different in type.
  const aiTypes = data.quizTypes.slice(0, 2);
  const busy =
    pendingIntent === "shape-continue" ||
    pendingIntent === "shape-manual" ||
    pendingIntent === "shape-regenerate" ||
    pendingIntent === "shape-goal-build";
  // When one card is expanded (or the goal card is open), the others mute so the
  // merchant can still compare without losing focus.
  const somethingOpen = expandedId !== null || writingGoal;
  const muted = (mine: boolean): React.CSSProperties =>
    somethingOpen && !mine ? { opacity: 0.5, pointerEvents: "none" } : {};

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
                  <div className="qz-label">How should we score this quiz?</div>
                  {(
                    [
                      ["direct", "Direct mapping", "Each answer maps to one bucket. Simple, fast to configure."],
                      ["weighted", "Weighted scoring", "Answers contribute points to multiple buckets. Better for overlapping attributes."],
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
                  <div className="qz-row" style={{ gap: 10, alignItems: "center" }}>
                    <button
                      type="button"
                      className="qz-btn qz-btn-primary qz-btn-sm"
                      disabled={!scoring || busy}
                      onClick={() =>
                        scoring &&
                        fetcher.submit(
                          { intent: "shape-continue", typeId: t.id, scoring },
                          { method: "post" },
                        )
                      }
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

        {/* Card 4 — Manual create */}
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
      </div>

      <SavedTemplatesRow templates={data.savedTemplates} fetcher={fetcher} pendingIntent={pendingIntent} />

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
          ← Back to buckets
        </button>
      </div>
    </div>
  );
}

// Saved templates (shop-scoped) surface as an alternative to the AI tiers — pick
// one to skip straight to a pre-filled battle card (the use-saved-template intent
// seeds it as the sole tier-2 option + an auto-named working copy → configuring).
function SavedTemplatesRow({
  templates,
  fetcher,
  pendingIntent,
}: {
  templates: FunnelData["savedTemplates"];
  fetcher: ReturnType<typeof useFetcher<ActionResult>>;
  pendingIntent: string | null;
}) {
  if (templates.length === 0) return null;
  const using = pendingIntent === "use-saved-template";
  return (
    <QzCard style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span className="qz-label">Or reuse a saved template</span>
        <span className="qz-dim" style={{ fontSize: 12 }}>
          Start from one you saved before — its design dials and recommendation settings come along.
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
            ♻ {s.name}
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
