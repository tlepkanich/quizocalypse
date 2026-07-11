import { useContext, useEffect, useMemo, useRef, useState } from "react";
import type {
  ExplainedRecommendation,
  RecommendedProduct,
} from "../../../lib/recommendationEngine";
import type { DeciderFallback, ResolvedRecPageConfig } from "../../../lib/recommendDecider";
import { revealLineup, REC_PAGE_DEFAULTS } from "../../../lib/recommendDecider";
import type { ResolvedEngagement } from "../../../lib/engagementSchema";
import { FeedbackWidget } from "../engagement/FeedbackWidget";
import { RewardReveal } from "../engagement/RewardReveal";
import { ReferralShare } from "../engagement/ReferralShare";
import { ShareRow } from "../engagement/ResultExtras";
import { productHref } from "../../../lib/productHref";
import { cartPermalinkMulti } from "../../../lib/cartLink";
import { formatMoney } from "../../../lib/formatMoney";
import type { createAnalyticsClient } from "../../../lib/analytics";
import type { stylesFor } from "../runtimeStyles";
import { useChrome } from "../chromeStrings";
import {
  RuntimeChromeContext,
  RuntimeCurrencyContext,
  RuntimeLocaleContext,
  RuntimePlatformContext,
  RuntimePreviewContext,
} from "../runtimeContexts";
import { goToCartPermalink } from "../addToCart";
import { SaveResultsLink, BuddyRow } from "../bits/resultLinks";
import { ProductCard } from "./ProductCard";
import { postQuizSession } from "./postQuizSession";

// ════════════════════════════════════════════════════════════════════════════
// LOGIC v2 (L2-9) — the decider flow's capture → loading → reveal views.
// Deliberately their OWN components (NOT extensions of EmailGateView/
// RevealView/ResultView) so the superseded legacy mechanisms — node-driven
// gate copy, hero_logic="match", per-node result knobs — can never collide
// with the v2 semantics. Only docs with logic_model==="decider" mount these.
// ════════════════════════════════════════════════════════════════════════════

// §7 — the loading interstitial between capture and reveal. The reveal content
// itself is computed synchronously (cheap, pure), so this is the pacing device:
// two beats totalling ~1.6s (spec: min ~1.5s, cap ~5s). Reduced-motion paths
// skip it entirely (gated upstream, the legacy reveal's posture). Copy reuses
// the K1 reveal tokens so existing translations carry over unchanged.
export function DeciderLoadingView({
  poolSize,
  onDone,
  interstitial,
}: {
  poolSize: number;
  onDone: () => void;
  // §L L3 — optional engagement override. ABSENT for every existing decider doc
  // (engagement is opt-in), so the branch below keeps the exact legacy beats,
  // copy, and spinner: DOM-identical, no behavior change. Present + enabled →
  // the merchant's headline/steps/style/duration drive the interstitial.
  interstitial?: ResolvedEngagement["interstitial"];
}) {
  const tc = useChrome();
  const [beat, setBeat] = useState(0);
  const custom = interstitial?.enabled ? interstitial : null;
  // Copy: custom stepped-style uses the merchant's steps; otherwise the K1
  // reveal tokens (existing translations carry over unchanged).
  const lines =
    custom && custom.style === "stepped" && custom.steps && custom.steps.length > 0
      ? custom.steps
      : [
          tc("reveal_weighing"),
          poolSize > 0 ? tc("reveal_matching", { n: poolSize }) : tc("reveal_weighing"),
        ];
  // Legacy default: two fixed beats (~1.6s). Custom: split the merchant's total
  // delay evenly across its lines (clamped to the spec's 1.5–5s band). Memoized
  // on PRIMITIVES (not the `interstitial` object, whose identity changes every
  // parent render) so the beat timer below never resets mid-interstitial.
  const beats = useMemo(() => {
    if (!custom) return [900, 700];
    const total = Math.min(5000, Math.max(1500, custom.delayMs ?? 2500));
    const n = Math.max(1, lines.length);
    return Array.from({ length: n }, () => Math.round(total / n));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!custom, custom?.delayMs, lines.length]);
  // onDone is an inline arrow at the call site (new identity per parent
  // render) — hold it in a ref so a mid-beat parent re-render can't reset
  // the running beat timer and stretch the interstitial.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useEffect(() => {
    if (beat >= beats.length) {
      onDoneRef.current();
      return;
    }
    const t = setTimeout(() => setBeat((b) => b + 1), beats[beat]);
    return () => clearTimeout(t);
  }, [beat, beats]);
  const spinner = (
    <div
      aria-hidden
      style={{
        width: 34,
        height: 34,
        borderRadius: 999,
        border: "3px solid color-mix(in srgb, var(--qz-color-primary) 25%, transparent)",
        borderTopColor: "var(--qz-color-primary)",
        animation: "qz-spin 0.9s linear infinite",
      }}
    />
  );
  // §A3 — Variation-A conic ring (spin + breathe), runtime-themed via
  // --qz-color-primary. INLINE styles/keyframes because /q loads only
  // quiz-runtime.css (never the admin sheet). Used ONLY on the opted-in custom
  // interstitial; the legacy (no-config) path keeps the exact spinner below, so
  // existing published quizzes render byte/DOM-identical.
  const ring = (
    <div aria-hidden style={{ animation: "qz-breathe 2.8s ease-in-out infinite" }}>
      <div
        style={{
          width: 60,
          height: 60,
          borderRadius: 999,
          background:
            "conic-gradient(from 0deg, var(--qz-color-primary), color-mix(in srgb, var(--qz-color-primary) 55%, white), var(--qz-color-primary))",
          WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 7px), black calc(100% - 7px))",
          mask: "radial-gradient(farthest-side, transparent calc(100% - 7px), black calc(100% - 7px))",
          animation: "qz-spin 1.1s linear infinite",
        }}
      />
    </div>
  );
  // Progress-bar variant fills beat-by-beat (custom "progress" style only).
  const progressBar = (
    <div
      aria-hidden
      style={{
        width: "min(240px, 70%)",
        height: 6,
        borderRadius: 999,
        background: "color-mix(in srgb, var(--qz-color-primary) 15%, transparent)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${Math.round(((Math.min(beat, lines.length - 1) + 1) / lines.length) * 100)}%`,
          height: "100%",
          background: "var(--qz-color-primary)",
          borderRadius: 999,
          transition: "width 0.4s ease",
        }}
      />
    </div>
  );
  return (
    <div
      role="status"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 14,
        padding: "56px 24px",
        fontFamily: "var(--qz-font-body)",
        color: "var(--qz-color-text)",
        textAlign: "center",
      }}
    >
      {custom?.headline ? (
        <div style={{ fontSize: "1.25em", fontWeight: 700 }}>{custom.headline}</div>
      ) : null}
      {/* Gated: legacy (no interstitial config) → the exact original spinner
          (byte/DOM-identical). Opted-in custom → the §A3 ring (or progress). */}
      {custom ? (custom.style === "progress" ? progressBar : ring) : spinner}
      <div style={{ fontSize: "1.05em", fontWeight: 600 }}>
        {lines[Math.min(beat, lines.length - 1)]}
      </div>
      {/* Legacy keeps the EXACT original style block (byte-identical); the
          breathe keyframe is added only when the ring renders (custom). */}
      <style>{custom
        ? `@keyframes qz-spin { to { transform: rotate(360deg); } } @keyframes qz-breathe { 0%,100% { transform: scale(0.85); } 50% { transform: scale(1.1); } }`
        : `@keyframes qz-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// §7.1 — the pre-reveal capture screen. Renders only the fields the merchant
// enabled (email is default-ON via REC_PAGE_DEFAULTS and MANDATORY when on —
// no skip link, the spec's deliberate delta from the legacy gate). All-off
// never mounts this (the caller skips the screen). Preview never POSTs; the
// finally block always reveals, so a capture failure can't strand the shopper.
export function DeciderCaptureView({
  config,
  styles,
  quizId,
  sessionId,
  onDone,
}: {
  config: ResolvedRecPageConfig;
  styles: ReturnType<typeof stylesFor>;
  quizId: string;
  sessionId: string;
  onDone: (contact?: { email?: string; name?: string; phone?: string }) => void;
}) {
  const tc = useChrome();
  const minimal = useContext(RuntimeChromeContext) === "minimal";
  const isPreviewMode = useContext(RuntimePreviewContext);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  // QZY-3 — the optional terms & conditions consent: when the merchant turns
  // it on, the box must be TICKED before the reveal unlocks.
  const [termsChecked, setTermsChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const emailValid = /^\S+@\S+\.\S+$/.test(email);
  const canSubmit =
    (config.captureEmail ? emailValid : true) &&
    (!config.captureTermsOn || termsChecked) &&
    !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      // /captures requires an email; a name/phone-only config (email off) has
      // nothing to persist server-side. Preview never POSTs.
      if (!isPreviewMode && emailValid) {
        await fetch("/captures", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            quiz_id: quizId,
            session_id: sessionId,
            email,
            ...(name.trim() ? { first_name: name.trim() } : {}),
            ...(phone.trim() ? { phone: phone.trim() } : {}),
          }),
          keepalive: true,
        });
      }
    } catch {
      // Don't hold the reveal hostage to a capture failure.
    } finally {
      // Only PRESENT keys — an explicit-undefined spread would clobber
      // contact fields an earlier email_gate node already captured.
      onDone({
        ...(email ? { email } : {}),
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
      });
    }
  }
  const submitOnEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") void handleSubmit();
  };
  const inputStyle: React.CSSProperties = {
    padding: minimal ? "15px 16px" : "12px 14px",
    borderRadius: "var(--qz-radius)",
    border: minimal
      ? "1.5px solid color-mix(in srgb, var(--qz-color-text) 22%, transparent)"
      : "1px solid #00000022",
    fontSize: "var(--qz-base-size)",
    fontFamily: "var(--qz-font-body)",
    ...(minimal ? { textAlign: "left" as const, background: "var(--qz-color-bg)" } : {}),
  };
  return (
    <div style={styles.card}>
      {/* QZY-3 — merchant copy wins; absent falls through to the locale-
          aware chrome strings (translations keep working). */}
      <h2 style={styles.h2}>{config.captureHeadline || tc("capture_headline")}</h2>
      <p style={{ ...styles.muted, marginTop: 8 }}>
        {config.captureSubtext || tc("capture_subtext")}
      </p>
      <div style={{ marginTop: 20, display: "grid", gap: 12 }}>
        {config.captureEmail && (
          <>
            {/* A placeholder-only field loses its identity once the shopper
                types — visible label above, placeholder becomes an example.
                Decider-only view, so legacy gate DOM is untouched. */}
            <label
              htmlFor="qz-cap-email"
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--qz-color-muted)",
                marginBottom: -6,
                textAlign: "left",
                fontFamily: "var(--qz-font-body)",
              }}
            >
              {tc("gate_email_placeholder")}
            </label>
            <input
              id="qz-cap-email"
              type="email"
              aria-label={tc("gate_email_placeholder")}
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={submitOnEnter}
              style={inputStyle}
            />
          </>
        )}
        {config.captureName && (
          <input
            type="text"
            aria-label={tc("gate_name_placeholder")}
            placeholder={tc("gate_name_placeholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={submitOnEnter}
            style={inputStyle}
          />
        )}
        {config.capturePhone && (
          <input
            type="tel"
            aria-label={tc("gate_phone_placeholder")}
            placeholder={tc("gate_phone_placeholder")}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onKeyDown={submitOnEnter}
            style={inputStyle}
          />
        )}
        {config.captureTermsOn && (
          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              fontSize: "calc(var(--qz-base-size) * 0.85)",
              fontFamily: "var(--qz-font-body)",
              color: "var(--qz-color-muted)",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <input
              type="checkbox"
              checked={termsChecked}
              onChange={(e) => setTermsChecked(e.target.checked)}
              style={{ marginTop: 3 }}
            />
            <span>
              {config.captureTermsText ||
                "I agree to receive marketing messages and accept the terms & conditions."}
            </span>
          </label>
        )}
      </div>
      <button
        style={{
          ...styles.primaryBtn,
          opacity: canSubmit ? 1 : 0.5,
          marginTop: 20,
          transition:
            "opacity 180ms ease, transform 140ms cubic-bezier(0.23, 1, 0.32, 1)",
        }}
        disabled={!canSubmit}
        onClick={handleSubmit}
      >
        {submitting ? "…" : tc("continue")}
      </button>
    </div>
  );
}

// §4–§6 — the target-based reveal page: headline + why-copy from the effective
// (override-merged) config, the hero card, the grid, the incentive chip, and
// the §6 fallback section when the resolved target has nothing showable.
export function DeciderResultView({
  decider,
  fallback,
  quizId,
  sessionId,
  answerIds,
  resultNodeId,
  shopDomain,
  styles,
  startedAt,
  completed,
  analytics,
  buddySessionId,
  aiWhyCopy,
  engagement,
  onReset,
}: {
  decider: NonNullable<ExplainedRecommendation["decider"]>;
  fallback: DeciderFallback | null;
  quizId?: string;
  sessionId?: string;
  answerIds: string[];
  resultNodeId: string;
  shopDomain?: string;
  styles: ReturnType<typeof stylesFor>;
  startedAt: number;
  completed: React.MutableRefObject<boolean>;
  analytics: ReturnType<typeof createAnalyticsClient> | null;
  buddySessionId?: string | null;
  // L2-12b — the per-shopper AI paragraph, when it arrived before this paint.
  // Replaces (never stacks with) the merchant template inside the whyOn gate.
  aiWhyCopy?: string | null;
  // §L L3 — resolved engagement config (present only when the merchant opted in;
  // undefined → widgets don't render → existing quizzes unchanged).
  engagement?: ResolvedEngagement;
  onReset: () => void;
}) {
  const tc = useChrome();
  const isPreviewMode = useContext(RuntimePreviewContext);
  const platform = useContext(RuntimePlatformContext);
  const currency = useContext(RuntimeCurrencyContext);
  const locale = useContext(RuntimeLocaleContext);
  const minimal = useContext(RuntimeChromeContext) === "minimal";
  const cfg = decider.config;
  const hero = decider.hero;
  const grid = decider.grid;
  // QZY-5 §3 — the archetype lineup. Absent layout = hero_grid = the exact
  // pre-QZY rendering (heroBlock=hero, bodyItems=grid).
  const lineup = revealLineup(cfg.layout, hero, grid);
  const showFallback =
    !hero && grid.length === 0 && (fallback?.products.length ?? 0) > 0;
  const fallbackRecs: RecommendedProduct[] = showFallback
    ? fallback!.products.map((p) => ({ ...p, score: 0 }))
    : [];

  // Completion + view analytics, once (the legacy ResultView contract). The v2
  // payload additively carries the resolved target + matched rule — it rides
  // Event.payload Json, no migration.
  useEffect(() => {
    if (completed.current || !analytics) return;
    completed.current = true;
    const shownIds = [
      ...lineup.shown.map((p) => p.product_id),
      ...fallbackRecs.map((p) => p.product_id),
    ];
    analytics.track("quiz_completed", {
      duration_ms: Date.now() - (startedAt || Date.now()),
    });
    analytics.track("recommendation_viewed", {
      result_node_id: resultNodeId,
      product_ids: shownIds,
      secondary_product_ids: [],
      resolved_target_id: decider.targetId,
      matched_rule_id: decider.matchedRuleId,
      ...(showFallback ? { fallback_source: fallback?.source } : {}),
    });
    if (!isPreviewMode) {
      postQuizSession({
        quizId,
        sessionId,
        outcomeId: resultNodeId,
        answerIds,
        productIds: shownIds,
      });
    }
    // The guard ref makes this fire exactly once; array identities may churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analytics, completed, resultNodeId, startedAt, isPreviewMode, quizId, sessionId]);

  // §9.3 — display + auto-apply an EXISTING merchant-created code. Auto-apply
  // rides the cart permalink's discount param; manual codes display only.
  const incentiveActive = Boolean(cfg.incentiveOn && cfg.incentiveCode);
  const discountCode =
    incentiveActive && cfg.incentiveAutoApply ? cfg.incentiveCode : undefined;
  const incentiveChip = incentiveActive ? (
    <div
      style={{
        marginTop: 16,
        padding: "10px 14px",
        borderRadius: "var(--qz-radius)",
        background: "color-mix(in srgb, var(--qz-color-primary) 12%, transparent)",
        color: "var(--qz-color-text)",
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      {tc(cfg.incentiveAutoApply ? "incentive_code_auto" : "incentive_code_manual", {
        code: cfg.incentiveCode!,
      })}
    </div>
  ) : null;

  const gridStyle: React.CSSProperties = minimal
    ? {
        marginTop: 20,
        display: "grid",
        gap: 16,
        gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
      }
    : { marginTop: 20, ...styles.productGrid };
  // QZY-5 — "list" stacks full-width horizontal rows instead of the grid.
  const isList = cfg.layout === "list";
  const bodyStyle: React.CSSProperties = isList
    ? { marginTop: 20, display: "flex", flexDirection: "column", gap: 12 }
    : gridStyle;

  // QZY-5 §2.3 — the add-all bar: only when the toggle is on, 2+ products
  // show, and a cart exists (standalone has none). Multi-adds ride the
  // comma-pair permalink (the TAE postMessage contract is single-variant).
  // §M1.1 — an opt-in engagement bundle also enables it (with a configurable
  // min-items). Legacy docs carry no `engagement`, so the condition is
  // byte-identical: `cfg.showAddAll || false` and minItems 2.
  const bundle = engagement?.bundle;
  const addAllMinItems = bundle?.minItems ?? 2;
  const addAllUrl =
    (cfg.showAddAll || !!bundle?.enabled) && lineup.shown.length >= addAllMinItems && platform !== "standalone"
      ? cartPermalinkMulti(
          shopDomain,
          lineup.shown.map((p) => p.default_variant_id ?? p.variants?.[0]?.id),
          discountCode,
        )
      : null;
  const addAllTotal = lineup.shown.reduce(
    (sum, p) => sum + (Number(p.price) || 0),
    0,
  );

  // QZY-5 §2.5 — the light image controls; absent = the card's own defaults.
  const cardAspectCss =
    cfg.cardAspect === "portrait"
      ? "3 / 4"
      : cfg.cardAspect === "landscape"
        ? "4 / 3"
        : cfg.cardAspect === "square"
          ? "1 / 1"
          : undefined;

  const card = (p: RecommendedProduct, position: number, extra?: Record<string, unknown>) => (
    <ProductCard
      key={p.product_id}
      product={p}
      position={position}
      vertical={isList ? false : minimal}
      ctaLabel={tc("shop_now")}
      href={productHref(p, shopDomain, platform)}
      shopDomain={shopDomain}
      discountCode={discountCode}
      showDescriptions={cfg.showDesc}
      showPrice={cfg.showPrice}
      showCta={cfg.showAtc}
      imgFit={cfg.imgFit}
      imgAspect={cardAspectCss}
      imgRadius={cfg.cardRadius}
      quizId={quizId}
      sessionId={sessionId}
      styles={styles}
      onClick={() =>
        analytics?.track("recommendation_clicked", {
          product_id: p.product_id,
          position,
          ...extra,
        })
      }
      onAdd={() =>
        analytics?.track("add_to_cart", {
          product_id: p.product_id,
          position,
          ...extra,
        })
      }
    />
  );

  // §C4 — persona precedence: an explicit Results-page headline (≠ the default)
  // wins; otherwise the mapped Group's persona name; otherwise the plain default.
  // The persona image + description render only when the persona is the active
  // content (no headline override).
  const persona = decider.persona;
  const headlineOverridden = cfg.headline !== REC_PAGE_DEFAULTS.headline;
  const revealHeadline = headlineOverridden ? cfg.headline : persona?.name?.trim() || cfg.headline;
  const showPersona = Boolean(persona && !headlineOverridden);

  return (
    <div style={styles.card}>
      {cfg.incentivePos === "banner" ? incentiveChip : null}
      {showPersona && persona?.image ? (
        <img
          src={persona.image}
          alt=""
          style={{ width: 88, height: 88, borderRadius: "50%", objectFit: "cover", margin: "0 auto 12px", display: "block" }}
        />
      ) : null}
      <h2 style={styles.h2}>{revealHeadline}</h2>
      {/* Persona framing (§C4) and the why-copy are DIFFERENT content — render
          both. (An earlier else-if wrongly suppressed the AI why-copy when a
          persona had a description.) */}
      {showPersona && persona?.description?.trim() ? (
        <p style={{ ...styles.muted, marginTop: 8 }}>{persona.description}</p>
      ) : null}
      {cfg.whyOn && (aiWhyCopy?.trim() || cfg.whyCopy.trim()) ? (
        <p style={{ ...styles.muted, marginTop: 8 }}>
          {aiWhyCopy?.trim() || cfg.whyCopy}
        </p>
      ) : null}
      {cfg.incentivePos === "below-headline" ? incentiveChip : null}
      {decider.allOutOfStock ? (
        <p style={{ marginTop: 12, fontSize: 13, color: "var(--qz-color-muted)" }}>
          {tc("all_out_of_stock")}
        </p>
      ) : null}
      {showFallback ? (
        <p style={{ marginTop: 12, fontSize: 13, color: "var(--qz-color-muted)" }}>
          {tc("decider_fallback_heading")}
        </p>
      ) : null}
      {!hero && grid.length === 0 && !showFallback ? (
        <p style={{ marginTop: 16, color: "var(--qz-color-muted)" }}>
          {tc("no_results_match")}
        </p>
      ) : null}
      {lineup.heroBlock ? (
        // qz-rev-* — the reveal choreography (headline first, then badge+hero,
        // then the grid, then CTAs). Decider-only view, so legacy docs never
        // render these classes; keyframes+delays live in QuizRuntime's style block.
        <div className="qz-rev-1" style={{ marginTop: 20 }}>
          <div
            style={{
              display: "inline-block",
              marginBottom: 8,
              padding: "3px 12px",
              borderRadius: 999,
              background: "var(--qz-color-primary)",
              color: "var(--qz-color-bg)",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            {tc("decider_hero_badge")}
          </div>
          {card(lineup.heroBlock, 0, { hero: true })}
        </div>
      ) : null}
      {lineup.bodyItems.length > 0 ? (
        <div className="qz-rev-2" style={bodyStyle}>
          {lineup.bodyItems.map((p, i) => card(p, i + (lineup.heroBlock ? 1 : 0)))}
        </div>
      ) : null}
      {addAllUrl ? (
        <button
          type="button"
          className="qz-rev-3"
          onClick={() => {
            analytics?.track("add_to_cart", {
              product_ids: lineup.shown.map((p) => p.product_id),
              add_all: true,
            });
            if (isPreviewMode) return;
            goToCartPermalink(addAllUrl);
          }}
          style={{ ...styles.primaryBtn, marginTop: 16, width: "100%" }}
        >
          {tc("add_all_to_cart", {
            count: lineup.shown.length,
            total: formatMoney(addAllTotal, currency, locale),
          }) + (bundle?.discountValue ? ` — save ${bundle.discountValue}%` : "")}
        </button>
      ) : null}
      {showFallback ? (
        <div style={gridStyle}>
          {fallbackRecs.map((p, i) => card(p, i, { source: fallback!.source }))}
        </div>
      ) : null}
      {cfg.incentivePos === "bottom" ? incentiveChip : null}
      {/* §L L3 — engagement widgets (present only when the merchant opted in). */}
      {engagement?.reward.enabled && quizId && sessionId ? (
        <RewardReveal config={engagement.reward} quizId={quizId} sessionId={sessionId} />
      ) : null}
      {engagement?.referral.enabled && quizId && sessionId ? (
        <ReferralShare config={engagement.referral} quizId={quizId} sessionId={sessionId} preview={isPreviewMode} />
      ) : null}
      {engagement?.feedback.enabled && quizId && sessionId ? (
        <FeedbackWidget
          config={engagement.feedback}
          quizId={quizId}
          sessionId={sessionId}
          outcomeId={resultNodeId}
        />
      ) : null}
      {engagement?.share.enabled ? (
        <ShareRow
          config={engagement.share}
          shareUrl={typeof window !== "undefined" ? window.location.origin + window.location.pathname : ""}
          personaName={persona?.name}
        />
      ) : null}
      <button
        onClick={onReset}
        className="qz-rev-3"
        style={{
          ...styles.primaryBtn,
          background: "transparent",
          color: "var(--qz-color-primary)",
          border: "2px solid var(--qz-color-primary)",
          marginTop: 24,
        }}
      >
        {tc("start_over")}
      </button>
      <SaveResultsLink quizId={quizId} sessionId={sessionId} />
      <BuddyRow
        quizId={quizId}
        sessionId={sessionId}
        buddySessionId={buddySessionId}
        analytics={analytics}
      />
    </div>
  );
}
