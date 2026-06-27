import type { CSSProperties, ReactNode } from "react";
import {
  recommendForResultExplained,
  recommendForStageExplained,
  resolveGlobalFallbackProducts,
} from "../../lib/recommendationEngine";
import type { IndexedProduct } from "../../lib/recommendationEngine";
import type { Quiz, QuizNode, ResultRanking } from "../../lib/quizSchema";

// ───────────────────────────────────────────────────────────────────────────
// RecPageDiagram (Rec-Page spec §1 live schematic) — a compact "page anatomy"
// map of a result page: Page header · (intro copy) · 1–3 product Sections ·
// Global fallback · Footer, stacked as labelled blocks. Each section shows the
// LIVE pool count straight from the recommendation engine (preview = no shopper
// answers, so the count is the section's eligible membership), plus on/off
// indicators for discount, OOS-fallback, and the quiz-level global fallback.
// Pure over the doc — re-renders as settings change. Mounted beside
// ResultSettingsPanel in the builder (and reused by the funnel Rec Page stage).
// ───────────────────────────────────────────────────────────────────────────

type ResultNode = Extract<QuizNode, { type: "result" }>;

const RANK_LABEL: Record<ResultRanking, string> = {
  relevance: "answer fit",
  best_seller: "best selling",
  newest: "newest",
  price_asc: "price ↑",
  price_desc: "price ↓",
  title_az: "title A→Z",
  title_za: "title Z→A",
  highest_rated: "highest rated",
  manual: "curated",
};

const blockBase: CSSProperties = {
  border: "1px solid var(--qz-rule)",
  borderRadius: "var(--qz-radius)",
  padding: "8px 10px",
  background: "var(--qz-paper)",
};

const tagStyle: CSSProperties = {
  display: "inline-block",
  fontSize: 10,
  lineHeight: 1.4,
  padding: "1px 6px",
  borderRadius: 999,
  border: "1px solid var(--qz-rule)",
  background: "var(--qz-cream-2)",
  color: "var(--qz-ink-2)",
};

function Block({
  title,
  sub,
  accent,
  muted,
  chip,
  children,
}: {
  title: string;
  sub?: string;
  accent?: boolean;
  muted?: boolean;
  chip?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      style={{
        ...blockBase,
        ...(accent ? { borderColor: "var(--qz-accent)", borderLeftWidth: 3 } : null),
        ...(muted ? { opacity: 0.55, borderStyle: "dashed" } : null),
      }}
    >
      <div className="qz-row qz-row-between" style={{ alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, minWidth: 0 }}>{title}</span>
        {chip != null ? <span style={tagStyle}>{chip}</span> : null}
      </div>
      {sub ? (
        <div className="qz-dim" style={{ fontSize: 11, lineHeight: 1.3, marginTop: 2 }}>
          {sub}
        </div>
      ) : null}
      {children ? <div style={{ marginTop: 6 }}>{children}</div> : null}
    </div>
  );
}

export function RecPageDiagram({
  doc,
  node,
  productIndex,
}: {
  doc: Quiz;
  node: ResultNode;
  productIndex: IndexedProduct[];
}) {
  const data = node.data;
  const idx = productIndex ?? [];
  const stages = data.stages;

  // Live per-section pool counts (preview: no shopper answers → eligible
  // membership). poolSize = products that fit the section before the cap.
  const sections =
    stages.length === 0
      ? [
          {
            key: node.id,
            label: "Section 1",
            sublabel: "Single section",
            headline: data.headline || "Recommended for you",
            poolSize: recommendForResultExplained({
              quiz: doc,
              productIndex: idx,
              selectedAnswerIds: [],
              resultNodeId: node.id,
            }).poolSize,
            ranking: data.ranking,
            max: data.max_products ?? data.slot_count,
          },
        ]
      : stages.map((stage, i) => ({
          key: stage.id,
          label: `Section ${i + 1}`,
          sublabel: i === 0 ? "Primary match" : "Cross-sell / routine",
          headline: stage.headline || `Section ${i + 1}`,
          poolSize: recommendForStageExplained(doc, idx, [], node.id, stage).poolSize,
          ranking: stage.ranking,
          max: stage.max_products,
        }));

  const discountOn = data.include_discount && doc.discount_config.enabled;
  const oosFallback = data.oos_behavior === "fallback";
  const gf = doc.global_fallback;
  const gfProducts = gf.enabled ? resolveGlobalFallbackProducts(gf, idx) : [];

  const footerBits = [
    data.results_summary_bar && "summary bar",
    data.retake_link && "retake",
    data.share_results && "share",
  ].filter(Boolean) as string[];

  return (
    <div className="qz-card" style={{ padding: 0, overflow: "hidden", position: "sticky", top: 12 }}>
      <div
        className="qz-row"
        style={{
          gap: 6,
          alignItems: "center",
          padding: "8px 12px",
          borderBottom: "1px solid var(--qz-rule)",
          background: "var(--qz-cream-2)",
        }}
      >
        <span className="qz-label">Page anatomy</span>
      </div>
      <div className="qz-col qz-gap-8" style={{ padding: 12 }}>
        <Block title="Page header" sub={data.headline || "Result page"} />

        {data.why_intro_enabled ? (
          <Block title="Intro copy" sub="“Why we recommend” (Mode A)" chip="on" />
        ) : null}

        {sections.map((s) => {
          const shown = Math.min(s.poolSize, s.max);
          return (
            <Block
              key={s.key}
              accent
              title={`${s.label} · ${s.headline}`}
              sub={`${s.sublabel} · sort: ${RANK_LABEL[s.ranking]}`}
            >
              <div className="qz-row qz-gap-4" style={{ flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ ...tagStyle, background: "var(--qz-paper)", fontWeight: 600 }}>
                  {s.poolSize} fit → show {shown}
                </span>
                {discountOn ? <span style={tagStyle}>discount</span> : null}
                {oosFallback ? <span style={tagStyle}>OOS → fallback</span> : null}
              </div>
            </Block>
          );
        })}

        <Block
          muted={!gf.enabled}
          title="Global fallback"
          sub={gf.enabled ? gf.heading : "No bucket match → empty"}
          chip={gf.enabled ? `${gfProducts.length} ready` : "off"}
        />

        <Block
          title="Footer"
          sub={footerBits.length ? footerBits.join(" · ") : "Standard footer"}
        />
      </div>
    </div>
  );
}
