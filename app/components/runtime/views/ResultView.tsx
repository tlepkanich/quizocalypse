import { useContext, useEffect } from "react";
import type { RecommendedProduct } from "../../../lib/recommendationEngine";
import { productHref } from "../../../lib/productHref";
import { selectHeroAndGrid } from "../../../lib/heroProduct";
import type { createAnalyticsClient } from "../../../lib/analytics";
import type { stylesFor } from "../runtimeStyles";
import { useChrome } from "../chromeStrings";
import {
  RuntimeChromeContext,
  RuntimePlatformContext,
  RuntimePreviewContext,
} from "../runtimeContexts";
import { NotifyMeForm } from "../bits/NotifyMeForm";
import { SaveResultsLink, ShareResultsButton, BuddyRow } from "../bits/resultLinks";
import { ProductCard } from "./ProductCard";
import { WhyBullets } from "./WhyBullets";
import { ResultEmailCapture } from "./ResultEmailCapture";
import { postQuizSession } from "./postQuizSession";

export function ResultView({
  headline,
  subtext,
  ctaLabel,
  recs,
  secondary,
  quizId,
  sessionId,
  collectEmail,
  answerIds,
  resultNodeId,
  shopDomain,
  discountCode,
  discountLabel,
  styles,
  startedAt,
  completed,
  analytics,
  buddySessionId,
  onReset,
  bare,
  whyBullets,
  inspect,
  splitLayout,
  reasonsByProduct,
  escapeHatch,
  showVariants = false,
  showDescriptions = false,
  lowStockByProduct,
  resultsSummaryBar = false,
  answerSummary,
  retakeLink = false,
  shareResults = false,
  oosNotify = false,
  whyIntro,
  blurbByProduct,
  globalFallback,
  heroLogic,
  heroOos,
}: {
  headline: string;
  subtext: string;
  ctaLabel: string;
  // Spec §5 — result page's OOS behavior is "notify_me": sold-out cards get a
  // back-in-stock capture, and a section prompt shows when ALL recs are OOS.
  oosNotify?: boolean;
  // Spec §3 Mode A — token-resolved page-intro copy, rendered above sections.
  whyIntro?: string;
  // Spec §3 Mode B — product_id → token-resolved per-product blurb.
  blurbByProduct?: Map<string, string> | null;
  // Rec-Page spec §2/§6 display + structure toggles, threaded from the result node.
  showVariants?: boolean;
  showDescriptions?: boolean;
  // product_id → live stock qty (≤ threshold), populated by the urgency fetch.
  lowStockByProduct?: Map<string, number> | null;
  resultsSummaryBar?: boolean;
  // Shopper's picked answer labels for the summary bar ("Oily skin · Sensitive").
  answerSummary?: string[];
  retakeLink?: boolean;
  // Spec §6 share button (uses the persistent results URL).
  shareResults?: boolean;
  inspect?: (part: "result_headline" | "result_subtext") => React.HTMLAttributes<HTMLElement>;
  // BIC P8: 2-column desktop layout (pitch left, vertical cards right). The
  // call site gates it on tokens.result_split && desktop; absent = stacked.
  splitLayout?: boolean;
  recs: RecommendedProduct[];
  secondary?: RecommendedProduct[];
  quizId?: string;
  sessionId?: string;
  collectEmail?: boolean;
  answerIds?: string[];
  resultNodeId: string;
  shopDomain?: string;
  discountCode?: string;
  discountLabel?: string;
  styles: ReturnType<typeof stylesFor>;
  startedAt: number;
  completed: React.MutableRefObject<boolean>;
  analytics: ReturnType<typeof createAnalyticsClient> | null;
  buddySessionId?: string | null;
  onReset: () => void;
  // When true, render just the products + "Start over" (no card / heading) so a
  // `recommendations` content-block can place it inside a custom layout.
  bare?: boolean;
  whyBullets?: string[];
  reasonsByProduct?: Map<string, string[]> | null;
  escapeHatch?: { label: string; url: string } | null;
  // Rec-Page spec §7 — quiz-level no-bucket-match fallback, computed at the call
  // site (resolveGlobalFallbackProducts). Rendered ONLY when recs is empty.
  globalFallback?: { heading: string; products: RecommendedProduct[] } | null;
  // step4-dev-handoff §6 — feature the top product as a HERO card above the grid.
  // Unset (the default) = no hero = today's grid (byte-stable). Only "match" renders
  // for now (reviewed/seller are config-gated until review/sales data exists).
  heroLogic?: "match" | "reviewed" | "seller";
  heroOos?: "next" | "grid";
}) {
  const tc = useChrome();
  const isPreviewMode = useContext(RuntimePreviewContext);
  const platform = useContext(RuntimePlatformContext);
  // MQ — minimal chrome shows recommendations as a row of vertical cards
  // (Quizell): auto-fit fills 1–3 columns by available width.
  const minimal = useContext(RuntimeChromeContext) === "minimal";
  // Fire completion + view events once when the result first renders, and
  // persist the server-side session (Dev Spec §7.2) — but never in preview.
  useEffect(() => {
    if (completed.current || !analytics) return;
    completed.current = true;
    analytics.track("quiz_completed", {
      duration_ms: Date.now() - (startedAt || Date.now()),
    });
    analytics.track("recommendation_viewed", {
      result_node_id: resultNodeId,
      product_ids: recs.map((r) => r.product_id),
      secondary_product_ids: (secondary ?? []).map((r) => r.product_id),
    });
    if (!isPreviewMode) {
      postQuizSession({
        quizId,
        sessionId,
        outcomeId: resultNodeId,
        answerIds: answerIds ?? [],
        productIds: [...recs, ...(secondary ?? [])].map((r) => r.product_id),
      });
    }
  }, [
    analytics,
    completed,
    resultNodeId,
    startedAt,
    recs,
    secondary,
    isPreviewMode,
    quizId,
    sessionId,
    answerIds,
  ]);

  // step4-dev-handoff §6 — when hero_logic is set, feature the top product as a
  // hero card above the grid. Scoped to the STANDARD single-section grid (not the
  // split/minimal layouts, which own their structure) so the change is bounded;
  // unset → heroActive false → recs renders exactly as today (byte-stable).
  const heroActive = !!heroLogic && !splitLayout && !minimal;
  const heroSplit = heroActive ? selectHeroAndGrid(recs, heroOos ?? "next") : null;
  const heroProduct = heroSplit?.hero ?? null;
  const gridRecs = heroProduct ? heroSplit!.grid : recs;

  const inner = (
    <>
      {resultsSummaryBar && answerSummary && answerSummary.length > 0 ? (
        <div
          style={{
            marginTop: bare ? 0 : 16,
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span style={{ fontSize: 12, color: "var(--qz-color-muted, #888)" }}>
            {tc("your_answers")}:
          </span>
          {answerSummary.map((label, i) => (
            <span
              key={`${label}-${i}`}
              style={{
                fontSize: 12,
                padding: "2px 10px",
                borderRadius: 999,
                background: "color-mix(in srgb, var(--qz-color-primary) 10%, transparent)",
              }}
            >
              {label}
            </span>
          ))}
        </div>
      ) : null}
      {discountLabel ? (
        <div
          style={{
            marginTop: bare ? 0 : 16,
            padding: "10px 14px",
            borderRadius: "var(--qz-radius)",
            background: "color-mix(in srgb, var(--qz-color-primary) 12%, transparent)",
            color: "var(--qz-color-text)",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          🎁 {discountLabel} on these picks — applied automatically at checkout.
        </div>
      ) : null}
      {whyIntro && whyIntro.trim() ? (
        <div
          style={{
            marginTop: bare ? 0 : 16,
            padding: "12px 14px",
            borderRadius: "var(--qz-radius)",
            background: "color-mix(in srgb, var(--qz-color-primary) 6%, transparent)",
            fontSize: 14,
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
          }}
        >
          {whyIntro}
        </div>
      ) : null}
      {oosNotify && recs.length > 0 && recs.every((r) => !r.inventory_in_stock) ? (
        <div
          style={{
            marginTop: bare ? 0 : 16,
            padding: "12px 14px",
            borderRadius: "var(--qz-radius)",
            background: "color-mix(in srgb, var(--qz-color-primary) 8%, transparent)",
          }}
        >
          <div style={{ fontSize: 13, marginBottom: 8 }}>{tc("notify_section_prompt")}</div>
          <NotifyMeForm quizId={quizId} sessionId={sessionId} productId={null} />
        </div>
      ) : null}
      {heroProduct ? (
        <div style={{ marginTop: bare && !discountLabel ? 0 : 20 }}>
          <div style={{ marginBottom: 8 }}>
            <span
              style={{
                display: "inline-block",
                fontSize: 12,
                fontWeight: 600,
                color: "var(--qz-color-primary)",
                background: "color-mix(in srgb, var(--qz-color-primary) 12%, transparent)",
                borderRadius: 999,
                padding: "3px 10px",
              }}
            >
              {tc("hero_badge")}
            </span>
          </div>
          <ProductCard
            product={heroProduct}
            position={0}
            ctaLabel={ctaLabel}
            href={productHref(heroProduct, shopDomain, platform)}
            shopDomain={shopDomain}
            discountCode={discountCode}
            discountLabel={discountLabel}
            showVariants={showVariants}
            showDescriptions={showDescriptions}
            lowStockQty={lowStockByProduct?.get(heroProduct.product_id) ?? null}
            oosNotify={oosNotify}
            quizId={quizId}
            sessionId={sessionId}
            blurb={blurbByProduct?.get(heroProduct.product_id)}
            reasons={reasonsByProduct?.get(heroProduct.product_id) ?? undefined}
            styles={styles}
            onClick={() =>
              analytics?.track("recommendation_clicked", {
                product_id: heroProduct.product_id,
                position: 0,
                hero: true,
              })
            }
            onAdd={() =>
              analytics?.track("add_to_cart", {
                product_id: heroProduct.product_id,
                position: 0,
                hero: true,
              })
            }
          />
        </div>
      ) : null}
      <div
        style={{
          marginTop: bare && !discountLabel ? 0 : 20,
          ...(splitLayout
            ? { display: "flex", flexDirection: "column", gap: 14 }
            : minimal
              ? {
                  display: "grid",
                  gap: 16,
                  gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
                }
              : styles.productGrid),
        }}
      >
        {/* The bucket MATCH still returns "no fit → no products" (the rule holds).
            Rec-Page §7 adds an OPT-IN quiz-level fallback: when the merchant
            enabled it, an empty result shows a curated "Our most-loved products"
            section instead of the bare no-match message. */}
        {recs.length === 0 &&
          (globalFallback && globalFallback.products.length > 0 ? (
            <div style={{ display: "contents" }}>
              <h3 style={{ ...styles.h2, gridColumn: "1 / -1", margin: "0 0 4px" }}>
                {globalFallback.heading}
              </h3>
              {globalFallback.products.map((r, idx) => (
                <ProductCard
                  key={r.product_id}
                  product={r}
                  position={idx}
                  vertical={splitLayout || minimal}
                  ctaLabel={ctaLabel}
                  href={productHref(r, shopDomain, platform)}
                  shopDomain={shopDomain}
                  showVariants={showVariants}
                  showDescriptions={showDescriptions}
                  quizId={quizId}
                  sessionId={sessionId}
                  styles={styles}
                  onClick={() =>
                    analytics?.track("recommendation_clicked", {
                      product_id: r.product_id,
                      quiz_id: quizId,
                      source: "global_fallback",
                    })
                  }
                />
              ))}
            </div>
          ) : (
            <p style={{ color: "var(--qz-color-muted)" }}>{tc("no_results_match")}</p>
          ))}
        {gridRecs.map((r, idx) => (
          <ProductCard
            reasons={reasonsByProduct?.get(r.product_id) ?? undefined}
            key={r.product_id}
            product={r}
            position={idx}
            vertical={splitLayout || minimal}
            ctaLabel={ctaLabel}
            href={productHref(r, shopDomain, platform)}
            shopDomain={shopDomain}
            discountCode={discountCode}
            discountLabel={discountLabel}
            showVariants={showVariants}
            showDescriptions={showDescriptions}
            lowStockQty={lowStockByProduct?.get(r.product_id) ?? null}
            oosNotify={oosNotify}
            quizId={quizId}
            sessionId={sessionId}
            blurb={blurbByProduct?.get(r.product_id)}
            styles={styles}
            onClick={() =>
              analytics?.track("recommendation_clicked", {
                product_id: r.product_id,
                position: idx,
              })
            }
            onAdd={() =>
              analytics?.track("add_to_cart", {
                product_id: r.product_id,
                position: idx,
              })
            }
          />
        ))}
      </div>
      {secondary && secondary.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <h3 style={{ ...styles.h2, fontSize: "0.8em", margin: "0 0 12px" }}>
            {tc("you_might_also_like")}
          </h3>
          <div style={styles.productGrid}>
            {secondary.map((r, idx) => (
              <ProductCard
            reasons={reasonsByProduct?.get(r.product_id) ?? undefined}
                key={r.product_id}
                product={r}
                position={recs.length + idx}
                ctaLabel={ctaLabel}
                href={productHref(r, shopDomain, platform)}
                shopDomain={shopDomain}
                showVariants={showVariants}
                showDescriptions={showDescriptions}
                lowStockQty={lowStockByProduct?.get(r.product_id) ?? null}
                styles={styles}
                onClick={() =>
                  analytics?.track("recommendation_clicked", {
                    product_id: r.product_id,
                    position: recs.length + idx,
                    secondary: true,
                  })
                }
                onAdd={() =>
                  analytics?.track("add_to_cart", {
                    product_id: r.product_id,
                    position: recs.length + idx,
                  })
                }
              />
            ))}
          </div>
        </div>
      )}
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
      {retakeLink ? (
        <button
          type="button"
          onClick={onReset}
          style={{
            display: "block",
            margin: "10px auto 0",
            background: "none",
            border: "none",
            font: "inherit",
            fontSize: "0.85em",
            fontFamily: "var(--qz-font-body)",
            color: "var(--qz-color-muted, #888)",
            textDecoration: "underline",
            cursor: "pointer",
          }}
        >
          {tc("retake_quiz")}
        </button>
      ) : null}
      {shareResults ? <ShareResultsButton quizId={quizId} sessionId={sessionId} /> : null}
      <SaveResultsLink quizId={quizId} sessionId={sessionId} />
      <BuddyRow quizId={quizId} sessionId={sessionId} buddySessionId={buddySessionId} analytics={analytics} />
      {escapeHatch && escapeHatch.label && escapeHatch.url ? (
        <a
          href={escapeHatch.url}
          target="_blank"
          rel="noreferrer"
          style={{
            display: "block",
            textAlign: "center",
            marginTop: 10,
            fontSize: "0.85em",
            fontFamily: "var(--qz-font-body)",
            color: "var(--qz-color-muted, #888)",
            textDecoration: "underline",
          }}
        >
          {escapeHatch.label}
        </a>
      ) : null}
    </>
  );

  if (bare) return inner;

  const pitch = (
    <>
      <h2 style={styles.resultHeadline} {...(inspect?.("result_headline") ?? {})}>{headline}</h2>
      {subtext && (
        <p style={{ ...styles.muted, marginTop: 8 }} {...(inspect?.("result_subtext") ?? {})}>
          {subtext}
        </p>
      )}
      <WhyBullets bullets={whyBullets} styles={styles} />
    </>
  );
  const email =
    collectEmail && quizId && sessionId ? (
      <ResultEmailCapture
        quizId={quizId}
        sessionId={sessionId}
        styles={styles}
        analytics={analytics}
      />
    ) : null;

  // BIC P8 (opt-in via tokens.result_split, desktop only): editorial split —
  // the pitch reads like a sticky magazine column while vertical cards scroll.
  if (splitLayout) {
    return (
      <div style={{ ...styles.card, maxWidth: 1020, width: "100%" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 0.85fr) minmax(0, 1.15fr)",
            gap: 40,
            alignItems: "start",
          }}
        >
          <div style={{ position: "sticky", top: 24 }}>
            {pitch}
            {email}
          </div>
          <div>{inner}</div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.card}>
      {pitch}
      {inner}
      {email}
    </div>
  );
}
