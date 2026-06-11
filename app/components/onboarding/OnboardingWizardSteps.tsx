import type { useFetcher } from "@remix-run/react";
import { mergeHexIntoTokens, type DesignTokensT } from "../../lib/designTokens";
import { THEME_PRESETS } from "../../lib/themePresets";
import type { CatalogCompleteness } from "../../lib/catalogIndex";
import type { QuizTone } from "../../lib/claude";
import {
  QzCard,
  QzField,
  QzInput,
  QzTextarea,
  QzSelect,
  QzButton,
  QzBanner,
  QzBadge,
} from "../qz";

// The 5-step standalone AI onboarding wizard (Miro "AI-Guided Quiz Builder" setup
// flow, streamlined): Catalog → Brand → Goal → Incentives → Review. Pure UI — all
// state is lifted into the studio.onboarding route; these components are dumb.
// `mergeHexIntoTokens` is re-exported here for the route's effectiveTokens memo.
export { mergeHexIntoTokens };
export type { DesignTokensT };

export type Placement = "page" | "popup" | "inline" | "product_widget";

// Mirrors the placement options shown in the editor (AiEditWorkspace) — copied by
// value so the onboarding wizard doesn't depend on the editor component.
const PLACEMENTS: Array<{ value: Placement; label: string; hint: string }> = [
  { value: "page", label: "Dedicated page", hint: "Share the link, or add the App Block to any page." },
  { value: "popup", label: "Popup", hint: "App Block set to open as a modal (exit / scroll / time)." },
  { value: "inline", label: "Inline embed", hint: "Drop the App Block into a page section, in-flow." },
  { value: "product_widget", label: "Product page widget", hint: "A compact launcher on your product template." },
];

const EXAMPLE_PROMPTS = [
  "Help shoppers find the right moisturizer for their skin type and concerns.",
  "Match customers to the perfect coffee roast based on taste and brew method.",
  "Recommend a starter skincare routine by skin goal and budget.",
  "Find the ideal running shoe for a runner's distance, terrain, and gait.",
];

// The action's JSON reply to the logo-upload sub-form (intent=extract-design).
export type ExtractResp = {
  ok: boolean;
  intent?: string;
  tokens?: DesignTokensT | null;
  brandName?: string;
  error?: string;
};

// ── Step 1 · Catalog readiness ──────────────────────────────────────────────
export function CatalogStep({
  productCount,
  completeness,
  hasCollection,
  onNext,
}: {
  productCount: number;
  completeness: CatalogCompleteness;
  hasCollection: boolean;
  onNext: () => void;
}) {
  const pct = Math.round(completeness.score);
  return (
    <QzCard style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h2 className="qz-h1" style={{ margin: 0 }}>
          We scanned your {productCount} {productCount === 1 ? "product" : "products"}
        </h2>
        <p className="qz-dim" style={{ margin: "6px 0 0" }}>
          AI uses your catalog — tags, descriptions, variants, collections — to build the
          quiz. Here&rsquo;s how ready it is.
        </p>
      </div>

      <div>
        <div className="qz-row qz-row-between" style={{ marginBottom: 6, fontSize: 13 }}>
          <span style={{ fontWeight: 600 }}>Catalog readiness</span>
          <span className="qz-mono qz-tnum">{pct}%</span>
        </div>
        <div style={{ height: 8, borderRadius: 999, background: "#00000010", overflow: "hidden" }}>
          <div
            style={{
              height: "100%",
              width: `${pct}%`,
              background: pct >= 60 ? "var(--qz-accent, #2a6df4)" : "#d98a2b",
              transition: "width .3s",
            }}
          />
        </div>
      </div>

      {completeness.flags.slice(0, 3).map((f, i) => (
        <QzBanner key={i} tone="warn" title="Heads up">
          {f}
        </QzBanner>
      ))}
      {!hasCollection ? (
        <QzBanner tone="warn" title="No collections synced yet">
          AI builds best with at least one collection (it powers result-page fallbacks).
          You can still build — sync your catalog to improve it.
        </QzBanner>
      ) : null}

      <div className="qz-row qz-row-between" style={{ marginTop: 4 }}>
        <span />
        <QzButton size="sm" variant="primary" onClick={onNext}>
          Continue →
        </QzButton>
      </div>
    </QzCard>
  );
}

// ── Step 2 · Brand (website + logo→tokens) ──────────────────────────────────
export function BrandStep({
  websiteUrl,
  setWebsiteUrl,
  baseTokens,
  setBaseTokens,
  hex,
  setHex,
  effectiveTokens,
  designFetcher,
  onNext,
  onBack,
}: {
  websiteUrl: string;
  setWebsiteUrl: (v: string) => void;
  baseTokens: DesignTokensT | null;
  setBaseTokens: (t: DesignTokensT | null) => void;
  hex: string;
  setHex: (v: string) => void;
  effectiveTokens: DesignTokensT | null;
  designFetcher: ReturnType<typeof useFetcher<ExtractResp>>;
  onNext: () => void;
  onBack: () => void;
}) {
  const extracting = designFetcher.state !== "idle";
  const colors = effectiveTokens?.colors ?? {};
  const swatches: Array<[string, string | undefined]> = [
    ["Primary", colors.primary],
    ["Accent", colors.accent],
    ["Background", colors.background],
    ["Text", colors.text],
  ];
  return (
    <QzCard style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h2 className="qz-h1" style={{ margin: 0 }}>Make it on-brand</h2>
        <p className="qz-dim" style={{ margin: "6px 0 0", fontSize: 13 }}>
          Optional — AI reads your site for on-brand copy and your logo for colors. You can
          fully restyle later in the editor.
        </p>
      </div>

      <QzField
        label="Your website (optional)"
        hint="AI reads your homepage / About for on-brand language — richer, less generic copy."
      >
        <QzInput
          value={websiteUrl}
          onChange={(e) => setWebsiteUrl(e.target.value)}
          placeholder="https://yourstore.com"
        />
      </QzField>

      <designFetcher.Form method="post" encType="multipart/form-data">
        <QzField label="Upload your logo" hint="PNG or JPG. AI extracts your palette.">
          <input
            type="file"
            name="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => {
              if (e.target.files?.length) designFetcher.submit(e.target.form);
            }}
          />
        </QzField>
      </designFetcher.Form>
      {extracting ? (
        <span className="qz-dim" style={{ fontSize: 12 }}>Reading your logo…</span>
      ) : null}
      {designFetcher.data && designFetcher.data.ok === false ? (
        <QzBanner tone="warn" title="Couldn't read that image">
          {designFetcher.data.error}
        </QzBanner>
      ) : null}

      <QzField label="Primary brand color" hint="Overrides the extracted primary.">
        <div className="qz-row" style={{ gap: 8, alignItems: "center" }}>
          <input
            type="color"
            value={hex || "#2a6df4"}
            onChange={(e) => setHex(e.target.value)}
            style={{ width: 40, height: 32, border: "none", background: "none" }}
          />
          <div style={{ width: 120 }}>
            <QzInput value={hex} onChange={(e) => setHex(e.target.value)} placeholder="#2a6df4" />
          </div>
        </div>
      </QzField>

      <div>
        <div className="qz-label" style={{ marginBottom: 8 }}>Or pick a starting look</div>
        <div className="qz-row" style={{ gap: 8, flexWrap: "wrap" }}>
          {THEME_PRESETS.map((p) => (
            <button
              key={p.id}
              className="qz-btn qz-btn-ghost qz-btn-sm"
              onClick={() => setBaseTokens(p.tokens)}
              title={p.description}
            >
              {p.name}
            </button>
          ))}
          {baseTokens || hex ? (
            <button
              className="qz-btn qz-btn-ghost qz-btn-sm"
              onClick={() => {
                setBaseTokens(null);
                setHex("");
              }}
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>

      {effectiveTokens ? (
        <div className="qz-row" style={{ gap: 14, flexWrap: "wrap" }}>
          {swatches.map(([label, val]) =>
            val ? (
              <div key={label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: val, border: "1px solid #00000018" }} />
                <span className="qz-dim" style={{ fontSize: 10.5 }}>{label}</span>
              </div>
            ) : null,
          )}
        </div>
      ) : null}

      <div className="qz-row qz-row-between" style={{ marginTop: 4 }}>
        <QzButton size="sm" variant="ghost" onClick={onBack}>← Back</QzButton>
        <QzButton size="sm" variant="primary" onClick={onNext}>Next →</QzButton>
      </div>
    </QzCard>
  );
}

// ── Step 3 · Goal (objective + length + tone) ───────────────────────────────
// Experiences E2 — goal-first creation (the Jebbit pattern): merchants pick
// WHAT THEY WANT, we infer the experience type (overridable). The goals also
// flow into the AI prompt as context.
export const WIZARD_GOALS = [
  { id: "revenue", label: "Increase revenue", infers: "product_match" },
  { id: "leads", label: "Generate leads", infers: "lead_capture" },
  { id: "engagement", label: "Boost engagement", infers: "personality" },
  { id: "insights", label: "Capture insights", infers: "survey" },
] as const;
export type WizardGoalId = (typeof WIZARD_GOALS)[number]["id"];
export type WizardExperienceType = "product_match" | "personality" | "lead_capture" | "survey";

export function inferExperienceType(goals: WizardGoalId[]): WizardExperienceType {
  // Revenue dominates (products pay the bills); otherwise first-picked wins.
  if (goals.includes("revenue")) return "product_match";
  const first = WIZARD_GOALS.find((g) => goals.includes(g.id));
  return (first?.infers ?? "product_match") as WizardExperienceType;
}

export function GoalStep({
  name,
  setName,
  goalPrompt,
  setGoalPrompt,
  questionCount,
  setQuestionCount,
  tone,
  setTone,
  goals,
  setGoals,
  experienceType,
  setExperienceType,
  brandVoiceName,
  onNext,
  onBack,
}: {
  name: string;
  setName: (v: string) => void;
  goalPrompt: string;
  setGoalPrompt: (v: string) => void;
  questionCount: number;
  setQuestionCount: (n: number) => void;
  tone: QuizTone;
  setTone: (t: QuizTone) => void;
  goals: WizardGoalId[];
  setGoals: (g: WizardGoalId[]) => void;
  experienceType: WizardExperienceType;
  setExperienceType: (t: WizardExperienceType) => void;
  brandVoiceName: string | null;
  onNext: () => void;
  onBack: () => void;
}) {
  const canNext = goalPrompt.trim().length > 0;
  return (
    <QzCard style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="qz-row qz-row-between" style={{ alignItems: "center" }}>
        <h2 className="qz-h1" style={{ margin: 0 }}>What should the quiz do?</h2>
        {brandVoiceName ? <QzBadge tone="ok">Brand voice: {brandVoiceName}</QzBadge> : null}
      </div>

      <QzField label="Quiz name">
        <QzInput
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Find your skincare routine"
        />
      </QzField>

      <QzField label="What do you want to accomplish?" hint="Pick any that apply — we'll shape the experience around them.">
        <div className="qz-row" style={{ gap: 8, flexWrap: "wrap" }}>
          {WIZARD_GOALS.map((g) => {
            const on = goals.includes(g.id);
            return (
              <button
                key={g.id}
                type="button"
                aria-pressed={on}
                className="qz-btn qz-btn-sm"
                style={{
                  border: on ? "2px solid var(--qz-accent, #2a6df4)" : "1px solid var(--qz-rule, #e3ddd2)",
                  background: on ? "color-mix(in srgb, var(--qz-accent, #2a6df4) 8%, transparent)" : "var(--qz-paper, #fff)",
                }}
                onClick={() => {
                  const next = on ? goals.filter((x) => x !== g.id) : [...goals, g.id];
                  setGoals(next);
                  if (next.length > 0) setExperienceType(inferExperienceType(next));
                }}
              >
                {g.label}
              </button>
            );
          })}
        </div>
      </QzField>

      <QzField label="Experience type" hint="Inferred from your goals — override anytime. Sets the guard rails and what gets built.">
        <QzSelect
          value={experienceType}
          onChange={(e) => setExperienceType(e.target.value as WizardExperienceType)}
        >
          <option value="product_match">Product match — recommend from your catalog</option>
          <option value="personality">Personality — persona reveal + products</option>
          <option value="lead_capture">Lead capture — qualify, then collect the email</option>
          <option value="survey">Survey — learn from your audience, no products</option>
        </QzSelect>
      </QzField>

      <QzField
        label="What should this quiz help shoppers do?"
        hint="The clearer the goal, the better the questions AI writes."
      >
        <QzTextarea
          value={goalPrompt}
          onChange={(e) => setGoalPrompt(e.target.value)}
          rows={3}
          placeholder="e.g. Help shoppers find the right moisturizer for their skin type and concerns."
        />
      </QzField>
      <div className="qz-row" style={{ gap: 8, flexWrap: "wrap" }}>
        {EXAMPLE_PROMPTS.map((ex) => (
          <button
            key={ex}
            type="button"
            className="qz-btn qz-btn-ghost qz-btn-sm"
            style={{ fontSize: 12 }}
            onClick={() => setGoalPrompt(ex)}
          >
            {ex.length > 44 ? `${ex.slice(0, 44)}…` : ex}
          </button>
        ))}
      </div>

      <div className="qz-row" style={{ gap: 24, flexWrap: "wrap", alignItems: "flex-end" }}>
        <QzField label={`How many questions? (${questionCount})`} hint="5–8 works best for completion.">
          <input
            type="range"
            min={3}
            max={8}
            value={questionCount}
            onChange={(e) => setQuestionCount(Number(e.target.value))}
            style={{ width: 200 }}
          />
        </QzField>
        <QzField label="Tone">
          <QzSelect value={tone} onChange={(e) => setTone(e.target.value as QuizTone)}>
            <option value="friendly">Friendly</option>
            <option value="editorial">Editorial</option>
            <option value="playful">Playful</option>
            <option value="professional">Professional</option>
          </QzSelect>
        </QzField>
      </div>

      <div className="qz-row qz-row-between" style={{ marginTop: 4 }}>
        <QzButton size="sm" variant="ghost" onClick={onBack}>← Back</QzButton>
        <QzButton
          size="sm"
          variant="primary"
          onClick={onNext}
          disabled={!canNext}
          title={canNext ? undefined : "Add a goal to continue"}
        >
          Next →
        </QzButton>
      </div>
    </QzCard>
  );
}

// ── Step 4 · Incentive & surfaces ───────────────────────────────────────────
export function IncentiveStep({
  emailGate,
  setEmailGate,
  collectEmailOnResult,
  setCollectEmailOnResult,
  placement,
  setPlacement,
  onNext,
  onBack,
}: {
  emailGate: boolean;
  setEmailGate: (v: boolean) => void;
  collectEmailOnResult: boolean;
  setCollectEmailOnResult: (v: boolean) => void;
  placement: Placement;
  setPlacement: (p: Placement) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <QzCard style={{ padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>
      <div>
        <h2 className="qz-h1" style={{ margin: 0 }}>Capture &amp; placement</h2>
        <p className="qz-dim" style={{ margin: "6px 0 0", fontSize: 13 }}>
          Grow your list and choose where the quiz lives — all optional, all changeable in
          the editor.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="qz-label">Email capture</div>
        <label style={{ display: "inline-flex", gap: 8, alignItems: "center", fontSize: 13 }}>
          <input type="checkbox" checked={emailGate} onChange={(e) => setEmailGate(e.target.checked)} />
          Gate results behind an email (capture before showing results)
        </label>
        <label style={{ display: "inline-flex", gap: 8, alignItems: "center", fontSize: 13 }}>
          <input
            type="checkbox"
            checked={collectEmailOnResult}
            onChange={(e) => setCollectEmailOnResult(e.target.checked)}
          />
          Offer &ldquo;email me my results&rdquo; on the result page
        </label>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="qz-label">Where should it appear?</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
          {PLACEMENTS.map((p) => {
            const sel = p.value === placement;
            return (
              <button
                key={p.value}
                type="button"
                onClick={() => setPlacement(p.value)}
                style={{
                  textAlign: "left",
                  padding: 12,
                  borderRadius: "var(--qz-radius)",
                  cursor: "pointer",
                  border: sel ? "2px solid var(--qz-accent, #2a6df4)" : "1px solid #00000022",
                  background: sel
                    ? "color-mix(in srgb, var(--qz-accent, #2a6df4) 8%, transparent)"
                    : "#fff",
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 13 }}>{p.label}</div>
                <div className="qz-dim" style={{ fontSize: 11.5, marginTop: 2 }}>{p.hint}</div>
              </button>
            );
          })}
        </div>
        <p className="qz-dim" style={{ fontSize: 12, margin: 0 }}>
          A shareable link + QR code are generated automatically after you publish.
        </p>
      </div>

      <div className="qz-row qz-row-between" style={{ marginTop: 4 }}>
        <QzButton size="sm" variant="ghost" onClick={onBack}>← Back</QzButton>
        <QzButton size="sm" variant="primary" onClick={onNext}>Review →</QzButton>
      </div>
    </QzCard>
  );
}

// ── Step 5 · Review (rendered INSIDE the route's <Form>) ─────────────────────
export function ReviewStep({
  name,
  goalPrompt,
  questionCount,
  tone,
  emailGate,
  collectEmailOnResult,
  placement,
  websiteUrl,
  productCount,
  building,
  onBack,
}: {
  name: string;
  goalPrompt: string;
  questionCount: number;
  tone: QuizTone;
  emailGate: boolean;
  collectEmailOnResult: boolean;
  placement: Placement;
  websiteUrl: string;
  productCount: number;
  building: boolean;
  onBack: () => void;
}) {
  const placementLabel = PLACEMENTS.find((p) => p.value === placement)?.label ?? placement;
  const goal = goalPrompt.trim();
  const emailSummary =
    [emailGate ? "gate" : null, collectEmailOnResult ? "on result" : null]
      .filter(Boolean)
      .join(" + ") || "none";
  const rows: Array<[string, string]> = [
    ["Quiz", name.trim() || "My quiz"],
    ["Goal", goal.length > 60 ? `${goal.slice(0, 60)}…` : goal || "—"],
    ["Questions", String(questionCount)],
    ["Tone", tone],
    ...(websiteUrl.trim() ? ([["Website", websiteUrl.trim()]] as Array<[string, string]>) : []),
    ["Email capture", emailSummary],
    ["Placement", placementLabel],
  ];
  return (
    <QzCard style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 className="qz-h1" style={{ margin: 0 }}>Ready to build</h2>
      {productCount < 5 ? (
        <QzBanner tone="warn" title="Small catalog">
          With under 5 products the AI has little to recommend — results may be thin.
        </QzBanner>
      ) : null}
      <div>
        {rows.map(([k, v]) => (
          <div
            key={k}
            className="qz-row qz-row-between"
            style={{ fontSize: 13, padding: "6px 0", borderBottom: "1px solid #00000010" }}
          >
            <span className="qz-dim">{k}</span>
            <span style={{ fontWeight: 600, textAlign: "right" }}>{v}</span>
          </div>
        ))}
      </div>
      <div className="qz-row qz-row-between" style={{ marginTop: 4 }}>
        <QzButton size="sm" variant="ghost" type="button" onClick={onBack}>← Back</QzButton>
        <QzButton size="sm" variant="accent" type="submit" disabled={building}>
          ✨ Build my quiz
        </QzButton>
      </div>
    </QzCard>
  );
}
