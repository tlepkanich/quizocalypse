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
// Step4Results — the funnel's Step 4 rebuilt LIGHT per quiz-results-step4-dev-
// handoff v1.0 (QZY-5): a fixed always-visible settings panel on the left
// (layout archetypes · content · products · ONE fallback toggle · More
// options) and a live phone preview on the right. Deep control (per-result
// copy, sort, sub-filters, discounts, custom fallback design) is the
// dashboard's job — the persistent footer explainer says so. Deliberately NO
// out-of-stock and NO contact-capture controls here (§4: both are inherited).
// Decider docs only; legacy drafts keep their existing stage.
// ════════════════════════════════════════════════════════════════════════════

const LAYOUTS: ReadonlyArray<{ id: RevealLayout; name: string }> = [
  { id: "hero_grid", name: "Hero + grid" },
  { id: "grid", name: "Grid" },
  { id: "list", name: "List" },
  { id: "single_hero", name: "Single hero" },
];

/** CSS-drawn archetype thumbnail (no image assets — matches the funnel's
 *  sketch-style pickers). */
function LayoutThumb({ id }: { id: RevealLayout }) {
  const cell = (key: number, tall = false): JSX.Element => (
    <span key={key} className={`qz-s4-thumb-cell${tall ? " is-tall" : ""}`} />
  );
  if (id === "hero_grid")
    return (
      <span className="qz-s4-thumb is-herogrid" aria-hidden>
        <span className="qz-s4-thumb-hero" />
        <span className="qz-s4-thumb-grid">{[0, 1].map((i) => cell(i))}</span>
      </span>
    );
  if (id === "grid")
    return (
      <span className="qz-s4-thumb is-grid" aria-hidden>
        <span className="qz-s4-thumb-grid">{[0, 1, 2, 3].map((i) => cell(i))}</span>
      </span>
    );
  if (id === "list")
    return (
      <span className="qz-s4-thumb is-list" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span key={i} className="qz-s4-thumb-row" />
        ))}
      </span>
    );
  return (
    <span className="qz-s4-thumb is-single" aria-hidden>
      {cell(0, true)}
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

  const check = (
    label: string,
    value: boolean,
    onToggle: (next: boolean) => void,
  ) => (
    <label className="qz-s4-check">
      <input type="checkbox" checked={value} onChange={(e) => onToggle(e.target.checked)} />
      <span>{label}</span>
    </label>
  );

  return (
    <div className="qz-qb-stage">
      <header className="qz-row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <div className="qz-label" style={{ fontSize: 11, marginBottom: 2 }}>
            Step {stepNumber("rec_page")} of {TOTAL_STEPS} · Results reveal
          </div>
          <h2 style={{ margin: 0, fontSize: 20 }}>Design the reveal</h2>
          <p className="qz-dim" style={{ margin: "4px 0 0", fontSize: 13 }}>
            Pick a layout, set the copy, choose what shows. The phone updates as you edit.
          </p>
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
        {/* §1 — the settings panel is ALWAYS visible; no collapse control. */}
        <div className="qz-s4-panel">
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
                    className={`qz-s4-layout${active ? " is-active" : ""}`}
                    onClick={() => patch("layout", l.id, "hero_grid")}
                  >
                    <LayoutThumb id={l.id} />
                    <span>{l.name}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="qz-s4-sec">
            <div className="qz-s4-sec-title">Content</div>
            <label className="qz-s4-field">
              <span>Headline</span>
              <input
                type="text"
                value={cfg.headline}
                onChange={(e) =>
                  patch("headline", e.target.value.trim() ? e.target.value : undefined, undefined)
                }
              />
            </label>
            {check("Show “why we recommend”", cfg.whyOn, (v) => patch("whyOn", v, true))}
            {cfg.whyOn ? (
              <div className="qz-s4-why">
                <textarea
                  rows={3}
                  value={cfg.whyCopy}
                  onChange={(e) => editWhyCopy(e.target.value)}
                />
                <div className="qz-s4-why-row">
                  <button
                    type="button"
                    className="qz-btn qz-btn-ghost qz-btn-sm"
                    disabled={whyGen.state === "busy" || Boolean(cfg.whyCopyLocked)}
                    title={cfg.whyCopyLocked ? "This copy is locked — unlock it in the dashboard." : undefined}
                    onClick={generateWhy}
                  >
                    {whyGen.state === "busy" ? "✦ Writing…" : "✦ AI generate"}
                  </button>
                  {whyGen.state === "error" ? (
                    <span className="qz-s4-err" role="alert">{whyGen.message}</span>
                  ) : null}
                </div>
              </div>
            ) : null}
          </section>

          <section className="qz-s4-sec">
            <div className="qz-s4-sec-title">Products</div>
            <ScrubNumber
              label="Products after the hero"
              value={Math.min(cfg.gridMax, 6)}
              min={0}
              max={6}
              onChange={(n) => patch("gridMax", n, 3)}
            />
            {check("Show price", cfg.showPrice, (v) => patch("showPrice", v, true))}
            {check("Show descriptions", cfg.showDesc, (v) => patch("showDesc", v, true))}
            {check("Show “Add to cart”", cfg.showAtc, (v) => patch("showAtc", v, true))}
            {check("Show “Add all to cart”", cfg.showAddAll, (v) => patch("showAddAll", v, false))}
            <p className="qz-dim qz-s4-hint">
              “Add all” appears when 2+ products show — it adds every shown product in one tap.
            </p>
          </section>

          <section className="qz-s4-sec">
            <div className="qz-s4-sec-title">Fallback</div>
            {check("Show a fallback if a shopper gets no matches", cfg.fallbackOn, (v) =>
              patch("fallbackOn", v, true),
            )}
            <p className="qz-dim qz-s4-hint">
              The fallback products come from your logic build; heading, copy, and layout are set in
              the dashboard.
            </p>
          </section>

          {/* §2.5 — progressive disclosure, collapsed by default. */}
          <details className="qz-s4-more">
            <summary>More options</summary>
            <div className="qz-s4-field is-seg">
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
            <div className="qz-s4-field is-seg">
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

        <div className="qz-s4-previewcol">
          <Step4Preview
            doc={doc}
            cfg={cfg}
            categories={categories}
            productIndex={productIndex}
            designTokens={designTokens}
          />
        </div>
      </div>
    </div>
  );
}

// ── §3 — the phone preview ───────────────────────────────────────────────────
// A merchant-facing mock rendered through the REAL v2 engine helpers
// (targetProducts → revealLineup), so what the panel toggles is what the
// runtime will do. Fallback shows INLINE below the matched reveal (no state
// tabs — §3 acceptance).

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
    borderRadius: cfg.cardRadius ?? 10,
  };
  const isList = cfg.layout === "list";

  const price = (p: IndexedProduct) =>
    cfg.showPrice && p.price != null && Number.isFinite(Number(p.price)) ? (
      <div className="qz-s4p-price">${Number(p.price).toFixed(2)}</div>
    ) : null;

  const card = (p: IndexedProduct, hero: boolean) => (
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
        <div className="qz-s4p-title">{p.title}</div>
        {price(p)}
        {cfg.showDesc && p.description ? (
          <div className="qz-s4p-desc">{p.description}</div>
        ) : null}
        {cfg.showAtc ? <span className="qz-s4p-atc">Add to cart</span> : null}
      </div>
    </div>
  );

  const addAllTotal = lineup.shown.reduce((sum, p) => sum + (Number(p.price) || 0), 0);
  const showAddAll = cfg.showAddAll && lineup.shown.length >= 2;
  const fbHeading = doc.global_fallback?.heading || "Our most-loved products";

  return (
    <div className="qz-s4-phone">
      <div className="qz-s4-phone-notch" aria-hidden />
      <div className="qz-s4-screen" style={cssVars}>
        <h3 className="qz-s4p-headline">{cfg.headline}</h3>
        {cfg.whyOn && cfg.whyCopy.trim() ? (
          <p className="qz-s4p-why">{cfg.whyCopy}</p>
        ) : null}
        {lineup.heroBlock ? (
          <div className="qz-s4p-herowrap">
            <span className="qz-s4p-badge">⭐ Our top pick for you</span>
            {card(lineup.heroBlock, true)}
          </div>
        ) : null}
        {lineup.bodyItems.length > 0 ? (
          <div className={`qz-s4p-items${isList ? " is-list" : ""}`}>
            {lineup.bodyItems.map((p) => card(p, false))}
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
                  {fallbackProducts.map((p) => card(p, false))}
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
  );
}
