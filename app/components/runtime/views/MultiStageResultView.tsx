import { useContext, useEffect } from "react";
import type { ResultStage as ResultStageT } from "../../../lib/quizSchema";
import type { RecommendedProduct } from "../../../lib/recommendationEngine";
import { cartPermalinkMulti } from "../../../lib/cartLink";
import { productHref } from "../../../lib/productHref";
import type { createAnalyticsClient } from "../../../lib/analytics";
import type { stylesFor } from "../runtimeStyles";
import { useChrome } from "../chromeStrings";
import { RuntimePlatformContext, RuntimePreviewContext } from "../runtimeContexts";
import { SaveResultsLink, BuddyRow } from "../bits/resultLinks";
import { ProductCard } from "./ProductCard";
import { WhyBullets } from "./WhyBullets";
import { ResultEmailCapture } from "./ResultEmailCapture";
import { postQuizSession } from "./postQuizSession";

// Multi-stage (Advanced) result page. Renders the page headline/subtext, then
// each stage as its own section (stage headline/subtext + its product cards),
// reusing the same ProductCard markup as the single-result view. Fires the
// same result analytics events once on first render, using the union of all
// stages' product ids for recommendation_viewed.
export function MultiStageResultView({
  headline,
  subtext,
  ctaLabel,
  sections,
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
}: {
  headline: string;
  subtext: string;
  ctaLabel: string;
  inspect?: (part: "result_headline" | "result_subtext") => React.HTMLAttributes<HTMLElement>;
  sections: { stage: ResultStageT; recs: RecommendedProduct[] }[];
  quizId?: string;
  sessionId?: string;
  collectEmail?: boolean;
  answerIds?: string[];
  resultNodeId: string;
  shopDomain: string;
  discountCode?: string;
  discountLabel?: string;
  styles: ReturnType<typeof stylesFor>;
  startedAt: number;
  completed: React.MutableRefObject<boolean>;
  analytics: ReturnType<typeof createAnalyticsClient> | null;
  buddySessionId?: string | null;
  onReset: () => void;
  bare?: boolean;
  whyBullets?: string[];
}) {
  const tc = useChrome();
  const isPreviewMode = useContext(RuntimePreviewContext);
  useEffect(() => {
    if (completed.current || !analytics) return;
    completed.current = true;
    analytics.track("quiz_completed", {
      duration_ms: Date.now() - (startedAt || Date.now()),
    });
    const productIds = sections.flatMap((s) => s.recs.map((r) => r.product_id));
    analytics.track("recommendation_viewed", {
      result_node_id: resultNodeId,
      product_ids: productIds,
    });
    if (!isPreviewMode) {
      postQuizSession({
        quizId,
        sessionId,
        outcomeId: resultNodeId,
        answerIds: answerIds ?? [],
        productIds,
      });
    }
  }, [
    analytics,
    completed,
    resultNodeId,
    startedAt,
    sections,
    isPreviewMode,
    quizId,
    sessionId,
    answerIds,
  ]);

  const inner = (
    <>
      <div style={{ marginTop: bare ? 0 : 20, display: "grid", gap: 28 }}>
        {sections.map(({ stage, recs }) => (
          <StageSection
            key={stage.id}
            stage={stage}
            recs={recs}
            ctaLabel={ctaLabel}
            shopDomain={shopDomain}
            discountCode={discountCode}
            discountLabel={discountLabel}
            styles={styles}
            analytics={analytics}
          />
        ))}
      </div>
      {(() => {
        // E5 — "Add the full routine": each section's TOP pick, one tap.
        // Hosted: a single multi-pair cart permalink. Embedded (TAE iframe):
        // a sequential single-item postMessage loop for back-compat, falling
        // back to the permalink if the parent doesn't answer.
        const topVariants = sections
          // Each section's first IN-STOCK pick — never add a sold-out variant to
          // the multi-pair cart permalink (it would add nothing on Shopify).
          .map(({ recs }) => recs.find((r) => r.inventory_in_stock !== false)?.default_variant_id)
          .filter((v): v is string => Boolean(v));
        if (topVariants.length < 2 || isPreviewMode) return null;
        const multiUrl = cartPermalinkMulti(shopDomain, topVariants, discountCode);
        if (!multiUrl) return null;
        return (
          <button
            onClick={() => {
              analytics?.track("add_to_cart", {
                routine: true,
                item_count: topVariants.length,
              });
              window.open(multiUrl, "_top");
            }}
            style={{ ...styles.primaryBtn, marginTop: 24 }}
          >
            {tc("add_routine", { n: topVariants.length })}
          </button>
        );
      })()}
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
      <BuddyRow quizId={quizId} sessionId={sessionId} buddySessionId={buddySessionId} analytics={analytics} />
    </>
  );

  if (bare) return inner;
  return (
    <div style={styles.card}>
      <h2 style={styles.resultHeadline} {...(inspect?.("result_headline") ?? {})}>{headline}</h2>
      {subtext && (
        <p style={{ ...styles.muted, marginTop: 8 }} {...(inspect?.("result_subtext") ?? {})}>
          {subtext}
        </p>
      )}
      <WhyBullets bullets={whyBullets} styles={styles} />
      {inner}
      {collectEmail && quizId && sessionId ? (
        <ResultEmailCapture
          quizId={quizId}
          sessionId={sessionId}
          styles={styles}
          analytics={analytics}
        />
      ) : null}
    </div>
  );
}

function StageSection({
  stage,
  recs,
  ctaLabel,
  shopDomain,
  discountCode,
  discountLabel,
  styles,
  analytics,
}: {
  stage: ResultStageT;
  recs: RecommendedProduct[];
  ctaLabel: string;
  shopDomain: string;
  discountCode?: string;
  discountLabel?: string;
  styles: ReturnType<typeof stylesFor>;
  analytics: ReturnType<typeof createAnalyticsClient> | null;
}) {
  const platform = useContext(RuntimePlatformContext);
  const tc = useChrome();
  return (
    <section>
      {stage.headline && (
        <h2
          style={{
            ...styles.h2,
            // E5 editorial: a quiet eyebrow rule above each routine section.
            fontSize: "calc(var(--qz-h2-size) * 1.08)",
            paddingTop: 14,
            borderTop: "1px solid color-mix(in srgb, var(--qz-color-muted, #aaa) 28%, transparent)",
          }}
        >
          {stage.headline}
        </h2>
      )}
      {stage.subtext && (
        <p style={{ ...styles.muted, marginTop: 6 }}>{stage.subtext}</p>
      )}
      <div style={{ marginTop: 12, ...styles.productGrid }}>
        {recs.length === 0 && (
          <p style={{ color: "var(--qz-color-muted)" }}>
            {tc("no_results_match")}
          </p>
        )}
        {recs.map((r, idx) => {
          const href = productHref(r, shopDomain, platform);
          return (
            <ProductCard
              key={r.product_id}
              product={r}
              position={idx}
              ctaLabel={ctaLabel}
              href={href}
              shopDomain={shopDomain}
              discountCode={discountCode}
              discountLabel={discountLabel}
              styles={styles}
              onClick={() =>
                analytics?.track("recommendation_clicked", {
                  result_stage_id: stage.id,
                  product_id: r.product_id,
                  position: idx,
                })
              }
              onAdd={() =>
                analytics?.track("add_to_cart", {
                  result_stage_id: stage.id,
                  product_id: r.product_id,
                  position: idx,
                })
              }
            />
          );
        })}
      </div>
    </section>
  );
}
