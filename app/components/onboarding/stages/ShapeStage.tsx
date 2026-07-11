// BIC-2 C2 — the Shape stage (stage "types") extracted from Step1Funnel.tsx as
// a PURE MOVE: the legacy four-card ShapeStage, the decider template-picker
// DeciderShapeStage, and their private pieces (TypeMiniThumb, the live
// TemplatePreviewDrawer, SavedTemplatesRow). Only the imports are new.
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { useFetcher } from "@remix-run/react";
import { QzCard, QzBadge } from "../../qz";
import { QzDrawer } from "../../qz-overlays";
import type { QuizType } from "../../../lib/quizSchema";
import { resolveDesignTokens, tokensToCssVars, suggestContrastText } from "../../../lib/designTokens";
import { googleFontsUrl } from "../../runtime/runtimeStyles";
import {
  GoalPromptBody,
  XTYPE_LABEL,
  type ActionResult,
  type FunnelData,
} from "./stagesShared";

// ── Stage: Type (tier-1) — pick a brand-tailored quiz type ───────────────────
// Shape-Your-Quiz spec — the "Shape your quiz" page that replaces the linear
// Types → Templates → BattleCard selection. Two AI quiz-type cards (generated
// to differ) + a Write-Your-Goal card; legacy drafts also get the
// Manual-Create card. Selecting an AI card expands it in place (siblings
// mute). Legacy drafts must pick a scoring model (no default) before
// Continue → the build; decider drafts are direct-only (no picker).
export function ShapeStage({
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
            {/* Soft Pastel §8.1 — the AI's top pick carries the violet Recommended
                ribbon (the diamond mark was removed; the accent leads). */}
            {i === 0 ? (
              <span className="qz-ribbon-recommended">Recommended</span>
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
