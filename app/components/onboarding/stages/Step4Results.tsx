import { useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { Quiz, DesignTokens } from "../../../lib/quizSchema";
import { stepNumber, TOTAL_STEPS } from "../../../lib/funnelStages";
import type { IndexedProduct } from "../../../lib/recommendationEngine";
import { resolveGlobalFallbackProducts } from "../../../lib/recommendationEngine";
import {
  resolveRecPageGlobal,
  targetProducts,
  revealLineup,
  deciderFallbackProducts,
  productRating,
  type ResolvedRecPageConfig,
  type RevealLayout,
} from "../../../lib/recommendDecider";
import { setRecPageGlobal } from "../../../lib/quizMutations";
import { GLOBAL_WHY_COPY_KEY } from "../../../lib/whyCopyMeta";
import { resolveDesignTokens, tokensToCssVars } from "../../../lib/designTokens";
import type { BuilderCategory } from "../../builder/stepProps";
import { useQuizDraft } from "../../studio/useQuizDraft";
import { ScrubNumber } from "../../controls/ScrubNumber";

// ════════════════════════════════════════════════════════════════════════════
// Step4Results — the funnel's Step 4, EXACT to results-page-redesign.html
// (design bundle 07-13): AI-tip card → mono-kicker sections (Layout · Content
// · Trust · Products · Offer · Fallback) with switch toggle-rows + Best-
// practice pills, and the 3D floating phone preview (aura + ground shadow +
// float, click to straighten). All controls write rec_page_settings.global
// through the same sparse-patch autosave as before; the preview still renders
// through the REAL v2 engine helpers (targetProducts → revealLineup).
// Deliberate deviations from the mock (functionality kept): the "Show why we
// recommend" toggle row (the runtime's whyOn gate has no other UI), the
// Products-shown stepper writes gridMax 0–6 (products AFTER the hero on hero
// layouts — sublabel says so), a Discount-code input under the Offer toggle
// (incentiveOn without a code renders nothing), More options + the persistent
// dashboard explainer, and the inline no-match fallback block in the phone.
// Decider docs only; legacy drafts keep their existing stage.
// ════════════════════════════════════════════════════════════════════════════

const LAYOUTS: ReadonlyArray<{ id: RevealLayout; name: string }> = [
  { id: "hero_grid", name: "Hero + grid" },
  { id: "grid", name: "Grid" },
  { id: "list", name: "List" },
  { id: "single_hero", name: "Single hero" },
];

/** The mock's CSS-drawn layout glyphs (.g.hero/.grid/.list/.single). */
function LayoutGlyph({ id }: { id: RevealLayout }) {
  const bars =
    id === "hero_grid" ? 3 : id === "grid" ? 4 : id === "list" ? 3 : 1;
  const cls =
    id === "hero_grid"
      ? "is-hero"
      : id === "grid"
        ? "is-grid"
        : id === "list"
          ? "is-list"
          : "is-single";
  return (
    <span className={`qz-s4-g ${cls}`} aria-hidden>
      {Array.from({ length: bars }, (_, i) => (
        <b key={i} />
      ))}
    </span>
  );
}

type WhyGenState = { state: "idle" | "busy" } | { state: "error"; message: string };

export function Step4Results({
  quizId,
  initialDoc,
  categories,
  productIndex,
  designTokens,
}: {
  quizId: string;
  initialDoc: Quiz;
  categories: BuilderCategory[];
  productIndex: IndexedProduct[];
  designTokens?: DesignTokens | null;
}) {
  const { doc, commit, isSaving, savedAt } = useQuizDraft(initialDoc);
  const cfg = resolveRecPageGlobal(doc.rec_page_settings);

  // Sparse writes: a value equal to its read-time default clears the key, so
  // stored docs only carry what the merchant actually changed.
  type GlobalPatch = Partial<NonNullable<NonNullable<Quiz["rec_page_settings"]>["global"]>>;
  const patch = <K extends keyof GlobalPatch>(key: K, value: GlobalPatch[K], dflt: GlobalPatch[K]) =>
    commit(setRecPageGlobal(doc, { [key]: value === dflt ? undefined : value } as GlobalPatch));

  // ✦ AI generate — the RecPageV2Panel recipe, global scope only: the scope is
  // pinned at click time, the doc is read at RESPONSE time (docRef) so copy
  // lands as a sparse patch over the merchant's in-flight edits.
  const docRef = useRef(doc);
  docRef.current = doc;
  const [whyGen, setWhyGen] = useState<WhyGenState>({ state: "idle" });
  const generateWhy = async () => {
    if (whyGen.state === "busy" || cfg.whyCopyLocked) return;
    setWhyGen({ state: "busy" });
    try {
      const res = await fetch("/api/generate-why-copy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quizId, targetId: null }),
      });
      const body = (await res.json()) as {
        ok: boolean;
        copy?: string;
        meta?: { at: string; members: string };
        error?: string;
      };
      if (!body.ok || !body.copy || !body.meta) {
        setWhyGen({ state: "error", message: body.error ?? "Copy generation failed — try again." });
        return;
      }
      const latest = docRef.current;
      commit({
        ...setRecPageGlobal(latest, { whyCopy: body.copy }),
        why_copy_meta: { ...(latest.why_copy_meta ?? {}), [GLOBAL_WHY_COPY_KEY]: body.meta },
      });
      setWhyGen({ state: "idle" });
    } catch {
      setWhyGen({ state: "error", message: "Copy generation failed — try again." });
    }
  };
  // Hand-editing voids AI provenance (the why_copy_meta contract).
  const editWhyCopy = (value: string) => {
    const next = setRecPageGlobal(doc, { whyCopy: value.trim() ? value : undefined });
    if (doc.why_copy_meta && GLOBAL_WHY_COPY_KEY in doc.why_copy_meta) {
      const { [GLOBAL_WHY_COPY_KEY]: _dropped, ...restMeta } = doc.why_copy_meta;
      if (Object.keys(restMeta).length) commit({ ...next, why_copy_meta: restMeta });
      else {
        const { why_copy_meta: _gone, ...docRest } = next;
        commit(docRest as Quiz);
      }
    } else {
      commit(next);
    }
  };

  // The AI tip applies the two Trust best practices in ONE commit.
  const tipApplied = cfg.showStars && cfg.showPerWhy;
  const applyTip = () => {
    if (tipApplied) return;
    commit(setRecPageGlobal(doc, { showStars: true, showPerWhy: true }));
  };

  /** The mock's .tog row — a switch button with name / Best-practice pill /
   *  description. Static rows (the stepper) render the same shell as a div. */
  const tog = (opts: {
    label: string;
    value: boolean;
    onToggle: (next: boolean) => void;
    desc?: string;
    bp?: boolean;
  }) => (
    <button
      type="button"
      role="switch"
      aria-checked={opts.value}
      className={`qz-s4-tog${opts.value ? " is-on" : ""}`}
      onClick={() => opts.onToggle(!opts.value)}
    >
      <span className="qz-s4-sw" aria-hidden />
      <span className="qz-s4-tog-b">
        <span className="qz-s4-tog-n">
          {opts.label}
          {opts.bp ? <span className="qz-s4-bp">Best practice</span> : null}
        </span>
        {opts.desc ? <span className="qz-s4-tog-d">{opts.desc}</span> : null}
      </span>
    </button>
  );

  return (
    <div className="qz-qb-stage">
      <header className="qz-row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
        <div>
          <div className="qz-label" style={{ fontSize: 11, marginBottom: 2 }}>
            Step {stepNumber("rec_page")} of {TOTAL_STEPS} · Results reveal
          </div>
          <h2 style={{ margin: 0, fontSize: 21, letterSpacing: "-.02em" }}>Design the reveal</h2>
        </div>
        <span className="qz-save-status" aria-live="polite">
          {isSaving ? (
            <span className="qz-save-chip is-saving">
              <span className="qz-save-dot" aria-hidden /> Saving…
            </span>
          ) : savedAt ? (
            <span key={savedAt} className="qz-save-chip is-saved">
              <span aria-hidden>✓</span> Saved
            </span>
          ) : null}
        </span>
      </header>

      <div className="qz-s4-split">
        <div className="qz-s4-panel">
          {/* AI tip (the bundle's locked standard) */}
          <div className="qz-s4-aitip">
            <span className="qz-s4-aico" aria-hidden>
              <i>✦</i>
            </span>
            <div className="qz-s4-aitip-body">
              <span className="qz-s4-ailabel">AI tip</span>
              <div className="qz-s4-aitip-tt">Turn on review stars and per-product reasons</div>
              <p>
                Shoppers who click a recommendation convert ~5.5× higher — but only when they
                trust it. Peer proof and a stated reason are what earn that trust.
              </p>
            </div>
            <button type="button" className="qz-s4-aitip-use" onClick={applyTip}>
              {tipApplied ? "✓ Applied" : "Use this"}
            </button>
          </div>

          <section className="qz-s4-sec">
            <div className="qz-s4-sec-title">Layout</div>
            <div className="qz-s4-layouts" role="radiogroup" aria-label="Reveal layout">
              {LAYOUTS.map((l) => {
                const active = (cfg.layout ?? "hero_grid") === l.id;
                return (
                  <button
                    key={l.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`qz-s4-lay${active ? " is-on" : ""}`}
                    onClick={() => patch("layout", l.id, "hero_grid")}
                  >
                    <LayoutGlyph id={l.id} />
                    <span>{l.name}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="qz-s4-sec">
            <div className="qz-s4-sec-title">Content</div>
            <label className="qz-s4-field">
              <span className="qz-s4-f">Headline</span>
              <input
                type="text"
                className="qz-s4-inp"
                value={cfg.headline}
                onChange={(e) =>
                  patch("headline", e.target.value.trim() ? e.target.value : undefined, undefined)
                }
              />
            </label>
            {tog({
              label: "Show “why we recommend”",
              value: cfg.whyOn,
              onToggle: (v) => patch("whyOn", v, true),
            })}
            {cfg.whyOn ? (
              <div className="qz-s4-why">
                <label className="qz-s4-field">
                  <span className="qz-s4-f">Why we recommend</span>
                  <textarea
                    className="qz-s4-inp"
                    rows={3}
                    value={cfg.whyCopy}
                    onChange={(e) => editWhyCopy(e.target.value)}
                  />
                </label>
                <div className="qz-s4-why-row">
                  <button
                    type="button"
                    className="qz-s4-genbtn"
                    disabled={whyGen.state === "busy" || Boolean(cfg.whyCopyLocked)}
                    title={cfg.whyCopyLocked ? "This copy is locked — unlock it in the dashboard." : undefined}
                    onClick={generateWhy}
                  >
                    <i aria-hidden>✦</i> {whyGen.state === "busy" ? "Writing…" : "AI generate"}
                  </button>
                  {whyGen.state === "error" ? (
                    <span className="qz-s4-err" role="alert">{whyGen.message}</span>
                  ) : null}
                </div>
              </div>
            ) : null}
          </section>

          <section className="qz-s4-sec">
            <div className="qz-s4-sec-title">Trust</div>
            {tog({
              label: "Show review stars",
              bp: true,
              value: cfg.showStars,
              onToggle: (v) => patch("showStars", v, false),
              desc: "Peer proof is the #1 trust signal — shoppers now trust each other as much as experts.",
            })}
            {tog({
              label: "Why each product matched",
              bp: true,
              value: cfg.showPerWhy,
              onToggle: (v) => patch("showPerWhy", v, false),
              desc: "A stated reason per product kills the “black box” problem. One generic blurb doesn’t.",
            })}
          </section>

          <section className="qz-s4-sec">
            <div className="qz-s4-sec-title">Products</div>
            <div className="qz-s4-tog is-static">
              <span className="qz-s4-tog-b">
                <span className="qz-s4-tog-n">Products shown</span>
                <span className="qz-s4-tog-d">
                  On hero layouts this counts the products after the hero pick.
                </span>
              </span>
              <span className="qz-s4-stepper">
                <button
                  type="button"
                  aria-label="Fewer products"
                  onClick={() => patch("gridMax", Math.max(0, Math.min(6, cfg.gridMax) - 1), 3)}
                >
                  −
                </button>
                <span className="qz-s4-stepper-v" aria-live="polite">{Math.min(cfg.gridMax, 6)}</span>
                <button
                  type="button"
                  aria-label="More products"
                  onClick={() => patch("gridMax", Math.min(6, cfg.gridMax + 1), 3)}
                >
                  +
                </button>
              </span>
            </div>
            {tog({
              label: "Show price",
              value: cfg.showPrice,
              onToggle: (v) => patch("showPrice", v, true),
            })}
            {tog({
              label: "Show descriptions",
              value: cfg.showDesc,
              onToggle: (v) => patch("showDesc", v, true),
              desc: "Thin product info is a top drop-off cause.",
            })}
            {tog({
              label: "Show “Add to cart”",
              bp: true,
              value: cfg.showAtc,
              onToggle: (v) => patch("showAtc", v, true),
              desc: "Buy in place. Every redirect costs conversion.",
            })}
            {tog({
              label: "Show “Add all to cart”",
              value: cfg.showAddAll,
              onToggle: (v) => patch("showAddAll", v, false),
              desc: "Appears when 2+ products show.",
            })}
          </section>

          <section className="qz-s4-sec">
            <div className="qz-s4-sec-title">Offer</div>
            {tog({
              label: "Show a discount at the reveal",
              bp: true,
              value: cfg.incentiveOn,
              onToggle: (v) => patch("incentiveOn", v, false),
              desc: "Pairing the match with an offer at the result step is the single largest documented lift.",
            })}
            {cfg.incentiveOn ? (
              <label className="qz-s4-field">
                <span className="qz-s4-f">Discount code</span>
                <input
                  type="text"
                  className="qz-s4-inp"
                  placeholder="e.g. RIDE10"
                  value={cfg.incentiveCode ?? ""}
                  onChange={(e) =>
                    patch(
                      "incentiveCode",
                      e.target.value.trim() ? e.target.value.trim() : undefined,
                      undefined,
                    )
                  }
                />
                <span className="qz-s4-hint qz-dim">
                  An existing code from your store — the reveal displays and applies it.
                </span>
              </label>
            ) : null}
          </section>

          <section className="qz-s4-sec">
            <div className="qz-s4-sec-title">Fallback</div>
            {tog({
              label: "Show a fallback if no matches",
              value: cfg.fallbackOn,
              onToggle: (v) => patch("fallbackOn", v, true),
              desc: "Fallback products come from your logic build.",
            })}
          </section>

          {/* §2.5 — progressive disclosure, collapsed by default. */}
          <details className="qz-s4-more">
            <summary>More options</summary>
            <div className="qz-s4-morefield">
              <span>Image fit</span>
              <div className="qz-s4-seg" role="radiogroup" aria-label="Image fit">
                {(["cover", "contain"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={(cfg.imgFit ?? "cover") === v}
                    className={(cfg.imgFit ?? "cover") === v ? "is-active" : ""}
                    onClick={() => patch("imgFit", v, "cover")}
                  >
                    {v === "cover" ? "Cover" : "Contain"}
                  </button>
                ))}
              </div>
            </div>
            <div className="qz-s4-morefield">
              <span>Card aspect</span>
              <div className="qz-s4-seg" role="radiogroup" aria-label="Card aspect">
                {(["square", "portrait", "landscape"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={(cfg.cardAspect ?? "square") === v}
                    className={(cfg.cardAspect ?? "square") === v ? "is-active" : ""}
                    onClick={() => patch("cardAspect", v, "square")}
                  >
                    {v[0]!.toUpperCase() + v.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <ScrubNumber
              label="Corner radius"
              value={cfg.cardRadius ?? 12}
              min={0}
              max={32}
              suffix="px"
              onChange={(n) => commit(setRecPageGlobal(doc, { cardRadius: n }))}
            />
          </details>

          {/* §1 — the persistent explainer; always visible, not dismissible. */}
          <p className="qz-s4-explainer">
            This sets the general reveal. Fine-tune per-result copy, sort, sub-filters, discounts,
            and custom fallback design in the dashboard →
          </p>
        </div>

        <Step4Preview
          doc={doc}
          cfg={cfg}
          categories={categories}
          productIndex={productIndex}
          designTokens={designTokens}
        />
      </div>
    </div>
  );
}

// ── The 3D floating phone preview ────────────────────────────────────────────
// The mock's aura + ground-shadow + float envelope (click to straighten)
// around the REAL engine-driven reveal (targetProducts → revealLineup), so
// what the panel toggles is what the runtime will do. Stars use REAL baked
// review metafields when present, else a clearly-sample cycle; per-product
// reasons preview the runtime's grounded "Because you chose …" chips using
// the doc's own first answers. Fallback stays INLINE below the matched reveal.

const SAMPLE_STARS = [
  { value: 4.8, count: 212 },
  { value: 4.6, count: 88 },
  { value: 4.9, count: 341 },
  { value: 4.5, count: 63 },
];

function Step4Preview({
  doc,
  cfg,
  categories,
  productIndex,
  designTokens,
}: {
  doc: Quiz;
  cfg: ResolvedRecPageConfig;
  categories: BuilderCategory[];
  productIndex: IndexedProduct[];
  designTokens?: DesignTokens | null;
}) {
  const [flat, setFlat] = useState(false);
  const cssVars = useMemo(
    () => tokensToCssVars(resolveDesignTokens(designTokens ?? undefined)) as CSSProperties,
    [designTokens],
  );

  const target =
    categories.find((c) => c.productIds.length > 0) ?? categories[0] ?? null;
  const lineup = useMemo(() => {
    if (!target) return null;
    const shape = target.source === "product" ? ("product" as const) : ("collection" as const);
    const { hero, grid } = targetProducts({
      targetId: target.id,
      targetShape: shape,
      config: cfg,
      productIndex,
      targetProductIdsMap: { [target.id]: target.productIds },
    });
    return revealLineup(cfg.layout, hero, grid);
  }, [target, cfg, productIndex]);

  // §2.4/§3 — the inherited fallback: the logic build's chooser first, the
  // legacy collection chain as the last resort (mirrors the runtime order).
  const fallbackProducts = useMemo(() => {
    if (cfg.fallbackOn === false) return [];
    const fromChooser = resolveGlobalFallbackProducts(doc.global_fallback, productIndex);
    if (fromChooser.length > 0) return fromChooser.slice(0, 4);
    return deciderFallbackProducts(cfg, productIndex).products.slice(0, 4);
  }, [doc.global_fallback, cfg, productIndex]);

  // Grounded per-product-why sample: the doc's own first question answers —
  // the same texts the runtime's "Because you chose …" chips will show.
  const sampleReasons = useMemo(() => {
    const q = doc.nodes.find((n) => n.type === "question");
    return q && q.type === "question"
      ? q.data.answers.slice(0, 2).map((a) => a.text).filter(Boolean)
      : [];
  }, [doc.nodes]);

  if (!target || !lineup) {
    return (
      <p className="qz-dim" style={{ margin: 8 }}>
        No recommendations yet — pick your recommendations in Step 1 first.
      </p>
    );
  }

  const aspectCss =
    cfg.cardAspect === "portrait" ? "3 / 4" : cfg.cardAspect === "landscape" ? "4 / 3" : "1 / 1";
  const imgStyle: CSSProperties = {
    objectFit: cfg.imgFit ?? "cover",
    aspectRatio: aspectCss,
    borderRadius: cfg.cardRadius ?? 9,
  };
  const isList = cfg.layout === "list";

  const price = (p: IndexedProduct) =>
    cfg.showPrice && p.price != null && Number.isFinite(Number(p.price)) ? (
      <div className="qz-s4p-price">${Number(p.price).toFixed(2)}</div>
    ) : null;

  const stars = (p: IndexedProduct, i: number) => {
    if (!cfg.showStars) return null;
    const real = productRating(p);
    const r = real ?? SAMPLE_STARS[i % SAMPLE_STARS.length]!;
    return (
      <div
        className="qz-s4p-stars"
        title={real ? undefined : "Sample rating — live stars use your products’ review data."}
      >
        <span aria-hidden>
          {"★".repeat(Math.round(r.value)) + "☆".repeat(5 - Math.round(r.value))}
        </span>
        <span>
          {r.value.toFixed(1)}
          {r.count != null ? ` (${r.count})` : ""}
        </span>
      </div>
    );
  };

  const perWhy = () =>
    cfg.showPerWhy && sampleReasons.length > 0 ? (
      <div className="qz-s4p-pwhy">
        <b aria-hidden>✦</b>
        <span>Because you chose: {sampleReasons.join(" · ")}</span>
      </div>
    ) : null;

  const card = (p: IndexedProduct, hero: boolean, i: number) => (
    <div
      key={p.product_id}
      className={`qz-s4p-card${hero ? " is-hero" : ""}${isList ? " is-row" : ""}`}
    >
      {p.image_url ? (
        <img src={p.image_url} alt="" style={imgStyle} />
      ) : (
        <div className="qz-s4p-noimg" style={imgStyle} />
      )}
      <div className="qz-s4p-body">
        {stars(p, i)}
        <div className="qz-s4p-title">{p.title}</div>
        {price(p)}
        {cfg.showDesc && p.description ? (
          <div className="qz-s4p-desc">{p.description}</div>
        ) : null}
        {perWhy()}
        {cfg.showAtc ? <span className="qz-s4p-atc">Add to cart</span> : null}
      </div>
    </div>
  );

  const addAllTotal = lineup.shown.reduce((sum, p) => sum + (Number(p.price) || 0), 0);
  const showAddAll = cfg.showAddAll && lineup.shown.length >= 2;
  const fbHeading = doc.global_fallback?.heading || "Our most-loved products";
  const offerActive = cfg.incentiveOn && Boolean(cfg.incentiveCode);

  return (
    <div className={`qz-s4-preview${flat ? " is-flat" : ""}`}>
      <span className="qz-s4-aura" aria-hidden />
      <span className="qz-s4-ground" aria-hidden />
      <div
        className="qz-s4-phone3d"
        role="button"
        tabIndex={0}
        aria-pressed={flat}
        aria-label="Straighten the phone preview"
        onClick={() => setFlat((f) => !f)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setFlat((f) => !f);
          }
        }}
      >
        <div className="qz-s4-screen" style={cssVars}>
          <h3 className="qz-s4p-headline">{cfg.headline}</h3>
          {cfg.whyOn && cfg.whyCopy.trim() ? (
            <p className="qz-s4p-why">{cfg.whyCopy}</p>
          ) : null}
          {offerActive ? (
            <div className="qz-s4p-offer">
              <span>
                🎁 Code <b>{cfg.incentiveCode}</b>
                {cfg.incentiveAutoApply ? " — applied automatically at checkout" : " at checkout"}
              </span>
            </div>
          ) : null}
          {lineup.heroBlock ? (
            <div className="qz-s4p-herowrap">
              <span className="qz-s4p-badge">⭐ Our top pick for you</span>
              {card(lineup.heroBlock, true, 0)}
            </div>
          ) : null}
          {lineup.bodyItems.length > 0 ? (
            <div className={`qz-s4p-items${isList ? " is-list" : ""}`}>
              {lineup.bodyItems.map((p, i) => card(p, false, i + (lineup.heroBlock ? 1 : 0)))}
            </div>
          ) : null}
          {lineup.shown.length === 0 ? (
            <p className="qz-dim" style={{ fontSize: 12 }}>
              This recommendation has no products yet.
            </p>
          ) : null}
          {showAddAll ? (
            <div className="qz-s4p-addall">
              Add all {lineup.shown.length} to cart · ${addAllTotal.toFixed(2)}
            </div>
          ) : null}
          {cfg.fallbackOn !== false ? (
            <div className="qz-s4p-fb">
              <div className="qz-s4p-fb-head">
                <span>If nothing matches</span>
                <span className="qz-s4p-fb-tag">default copy · edit in dashboard</span>
              </div>
              {fallbackProducts.length > 0 ? (
                <>
                  <div className="qz-s4p-fb-heading">{fbHeading}</div>
                  <div className="qz-s4p-items">
                    {fallbackProducts.map((p, i) => card(p, false, i))}
                  </div>
                </>
              ) : (
                <p className="qz-dim" style={{ fontSize: 12, margin: 0 }}>
                  No fallback products yet — choose them in the Logic step’s Fallback panel.
                </p>
              )}
            </div>
          ) : null}
        </div>
      </div>
      <span className="qz-s4-phint">Click the phone to straighten it</span>
    </div>
  );
}
