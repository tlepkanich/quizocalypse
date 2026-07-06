import { useContext, useEffect, useRef, useState } from "react";
import type {
  ExplainedRecommendation,
  RecommendedProduct,
} from "../../../lib/recommendationEngine";
import type { DeciderFallback, ResolvedRecPageConfig } from "../../../lib/recommendDecider";
import { productHref } from "../../../lib/productHref";
import type { createAnalyticsClient } from "../../../lib/analytics";
import type { stylesFor } from "../runtimeStyles";
import { useChrome } from "../chromeStrings";
import {
  RuntimeChromeContext,
  RuntimePlatformContext,
  RuntimePreviewContext,
} from "../runtimeContexts";
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
}: {
  poolSize: number;
  onDone: () => void;
}) {
  const tc = useChrome();
  const [beat, setBeat] = useState(0);
  // onDone is an inline arrow at the call site (new identity per parent
  // render) — hold it in a ref so a mid-beat parent re-render can't reset
  // the running beat timer and stretch the interstitial.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useEffect(() => {
    const beats = [900, 700];
    if (beat >= beats.length) {
      onDoneRef.current();
      return;
    }
    const t = setTimeout(() => setBeat((b) => b + 1), beats[beat]);
    return () => clearTimeout(t);
  }, [beat]);
  const lines = [
    tc("reveal_weighing"),
    poolSize > 0 ? tc("reveal_matching", { n: poolSize }) : tc("reveal_weighing"),
  ];
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
      <div style={{ fontSize: "1.05em", fontWeight: 600 }}>
        {lines[Math.min(beat, lines.length - 1)]}
      </div>
      <style>{`@keyframes qz-spin { to { transform: rotate(360deg); } }`}</style>
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
  const [submitting, setSubmitting] = useState(false);
  const emailValid = /^\S+@\S+\.\S+$/.test(email);
  const canSubmit = (config.captureEmail ? emailValid : true) && !submitting;

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
      <h2 style={styles.h2}>{tc("capture_headline")}</h2>
      <p style={{ ...styles.muted, marginTop: 8 }}>{tc("capture_subtext")}</p>
      <div style={{ marginTop: 20, display: "grid", gap: 12 }}>
        {config.captureEmail && (
          <input
            type="email"
            aria-label={tc("gate_email_placeholder")}
            placeholder={tc("gate_email_placeholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={submitOnEnter}
            style={inputStyle}
          />
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
      </div>
      <button
        style={{ ...styles.primaryBtn, opacity: canSubmit ? 1 : 0.5, marginTop: 20 }}
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
  onReset: () => void;
}) {
  const tc = useChrome();
  const isPreviewMode = useContext(RuntimePreviewContext);
  const platform = useContext(RuntimePlatformContext);
  const minimal = useContext(RuntimeChromeContext) === "minimal";
  const cfg = decider.config;
  const hero = decider.hero;
  const grid = decider.grid;
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
      ...(hero ? [hero.product_id] : []),
      ...grid.map((p) => p.product_id),
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

  const card = (p: RecommendedProduct, position: number, extra?: Record<string, unknown>) => (
    <ProductCard
      key={p.product_id}
      product={p}
      position={position}
      vertical={minimal}
      ctaLabel={tc("shop_now")}
      href={productHref(p, shopDomain, platform)}
      shopDomain={shopDomain}
      discountCode={discountCode}
      showDescriptions={cfg.showDesc}
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

  return (
    <div style={styles.card}>
      {cfg.incentivePos === "banner" ? incentiveChip : null}
      <h2 style={styles.h2}>{cfg.headline}</h2>
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
      {hero ? (
        <div style={{ marginTop: 20 }}>
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
          {card(hero, 0, { hero: true })}
        </div>
      ) : null}
      {grid.length > 0 ? (
        <div style={gridStyle}>{grid.map((p, i) => card(p, i + (hero ? 1 : 0)))}</div>
      ) : null}
      {showFallback ? (
        <div style={gridStyle}>
          {fallbackRecs.map((p, i) => card(p, i, { source: fallback!.source }))}
        </div>
      ) : null}
      {cfg.incentivePos === "bottom" ? incentiveChip : null}
      <button
        onClick={onReset}
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
