import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties, ReactNode } from "react";
import type { Quiz, DesignTokens } from "../../../lib/quizSchema";
import type { IndexedProduct } from "../../../lib/recommendationEngine";
import {
  resolveDesignTokens,
  tokensToCssVars,
  suggestContrastText,
} from "../../../lib/designTokens";
import { googleFontsUrl } from "../../runtime/runtimeStyles";
import { DeviceFrame } from "../../builder/preview/DeviceFrame";
import type { DeviceTier } from "../../builder/preview/previewWidth";
import {
  resolveGuided,
  resolveDiscount,
  offerCode,
  offerLabel,
  type GuidedConfig,
} from "./state";

/* Results-guided handoff §6 — the preview. QRTZ-S3: rendered through the
   shared DeviceFrame (the canonical 390×745 phone / 960×700 inline band of
   previewWidth.DEVICES — this file used to hardcode 390×844 / 1180×740 and
   its own fit math), scaled to fit. QRTZ-G45 (owner reversal of F5 on THIS
   surface only): no size/scale readout and no fold marker here — the view
   controls sit in a plain bar above the frame; the builder keeps both.
   THE PREVIEW FOLLOWS THE STEP: the gate screen
   for the email ask (placement = before), the loading screen for the Loading
   tab, the results page for everything else. Highlighting (§6/§7): opening a
   section soft-rings the region it owns; focusing a control rings the ONE
   element it changes; rings fade after 2.6s. data-part is PER-ELEMENT —
   never one part for a whole screen. Themed with the draft's resolved design
   tokens (the same tokens the published quiz renders with), real products
   from the catalog index. */

export type PreviewScreen = "results" | "gate" | "loading";

const money = (n: number) => `$${n.toFixed(2)}`;

/** {terms}/{privacy} tokens → links, as React nodes (no raw HTML — the copy
 *  is merchant-authored text). Dropping a token drops that link (§4). */
function TermsLine({ cfg }: { cfg: GuidedConfig }) {
  const template = cfg.captureTermsText || "By continuing you agree to our {terms} and {privacy}.";
  const parts = template.split(/(\{terms\}|\{privacy\})/);
  return (
    <p className="qz-rg-terms" data-jump="consent" data-part="terms">
      {parts.map((p, i) =>
        p === "{terms}" ? (
          <u key={i} title={cfg.termsUrl}>
            {cfg.termsLabel}
          </u>
        ) : p === "{privacy}" ? (
          <u key={i} title={cfg.privacyUrl}>
            {cfg.privacyLabel}
          </u>
        ) : (
          p
        ),
      )}
    </p>
  );
}

export function GuidedPreview({
  doc,
  productIndex,
  designTokens,
  screen,
  openSec,
  focusPart,
  holdSel,
  onJump,
}: {
  doc: Quiz;
  productIndex: IndexedProduct[];
  designTokens: DesignTokens | null | undefined;
  screen: PreviewScreen;
  /** The open section id (soft ring on its region). */
  openSec: string | null;
  /** The focused control's part (solid ring on the one element it changes). */
  focusPart: string | null;
  /** Overview jump: the ring holds until the next interaction. */
  holdSel: boolean;
  /** Clicking a region on the page opens its section in the panel. */
  onJump: (sec: string) => void;
}) {
  const cfg = resolveGuided(doc);
  const disc = resolveDiscount(doc);

  const resolved = useMemo(() => resolveDesignTokens(designTokens ?? undefined), [designTokens]);
  const cssVars = useMemo(() => tokensToCssVars(resolved) as CSSProperties, [resolved]);
  const fontUrl = useMemo(
    () =>
      googleFontsUrl([
        resolved.typography?.heading?.family ?? "",
        resolved.typography?.body?.family ?? "",
      ]),
    [resolved],
  );
  const ctaText = suggestContrastText(resolved.colors?.primary ?? "");

  const [view, setView] = useState<DeviceTier>("phone");
  const [expanded, setExpanded] = useState(false);

  // real products — the matches pool + the extras shelf's own picks
  const pool = productIndex.slice(0, 8);
  const extrasPool = cfg.extrasProductIds.length
    ? productIndex.filter((p) => cfg.extrasProductIds.includes(p.product_id))
    : [];

  // ── §6 highlight engine: soft ring the open region, solid ring the focused
  //    part; fade after 2.6s unless an Overview jump asked it to hold. ──────
  const screenRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scr = screenRef.current;
    if (!scr) return;
    scr.querySelectorAll(".qz-rg-zsel, .qz-rg-zsoft").forEach((e) =>
      e.classList.remove("qz-rg-zsel", "qz-rg-zsoft"),
    );
    if (!openSec) return;
    const targets = focusPart
      ? [...scr.querySelectorAll(`[data-part="${focusPart}"]`)]
      : [...scr.querySelectorAll(`[data-jump="${openSec}"]`)];
    targets.forEach((e) => e.classList.add(focusPart ? "qz-rg-zsel" : "qz-rg-zsoft"));
    // §7 — scroll via offsetTop, never scrollIntoView: the frame is CSS-scaled,
    // so client rects are in scaled pixels while scrollTop is content pixels.
    const t =
      (focusPart && (scr.querySelector(`[data-part="${focusPart}"]`) as HTMLElement | null)) ||
      (scr.querySelector(`[data-jump="${openSec}"]:not(.qz-rg-empty)`) as HTMLElement | null) ||
      (scr.querySelector(`.qz-rg-empty[data-jump="${openSec}"]`) as HTMLElement | null);
    if (t) {
      let y = 0;
      let el: HTMLElement | null = t;
      while (el && el !== scr) {
        y += el.offsetTop;
        el = el.offsetParent as HTMLElement | null;
      }
      const target = Math.max(0, y - (scr.clientHeight / 2 - t.offsetHeight / 2));
      if (Math.abs(target - scr.scrollTop) > 12) scr.scrollTo({ top: target, behavior: "smooth" });
    }
    if (holdSel) return;
    const timer = window.setTimeout(
      () => targets.forEach((e) => e.classList.remove("qz-rg-zsel", "qz-rg-zsoft")),
      2600,
    );
    return () => window.clearTimeout(timer);
  });

  // delegate clicks on [data-jump] regions back into the panel
  useEffect(() => {
    const scr = screenRef.current;
    if (!scr) return;
    const onClick = (e: MouseEvent) => {
      const t = (e.target as HTMLElement).closest("[data-jump]");
      if (t && scr.contains(t)) onJump((t as HTMLElement).dataset.jump!);
    };
    scr.addEventListener("click", onClick);
    return () => scr.removeEventListener("click", onClick);
  });

  // ── screen contents ────────────────────────────────────────────────────────
  const consentRows = (
    <>
      {cfg.consentOn ? (
        <div className="qz-rg-cons" data-jump="consent" data-part="consent">
          <i /> <span>{cfg.consentCopy}</span>
        </div>
      ) : null}
      {cfg.capturePhone ? (
        <div className="qz-rg-cons" data-jump="consent" data-part="consent">
          <i /> <span>Text me offers. Msg &amp; data rates may apply. Reply STOP to opt out.</span>
        </div>
      ) : null}
      {cfg.captureTermsOn ? <TermsLine cfg={cfg} /> : null}
    </>
  );

  const capForm = (unlock: boolean) => {
    const pending = unlock && !doc.discount_config?.enabled;
    const expiry =
      disc.expiry_mode === "hours" ? `expires in ${disc.expiry_hours}h` : "Yours after this step";
    return (
      <div
        className={`qz-rg-capform${unlock ? " is-unlock" : ""}${pending ? " is-pending" : ""}`}
        data-jump="gate"
        data-part="gform"
      >
        {pending ? <span className="qz-rg-pendlbl">Add a discount to unlock this</span> : null}
        {unlock ? (
          <div className="qz-rg-ulead">
            <span className="qz-rg-ulock" aria-hidden>
              🔒
            </span>
            <span className="qz-rg-utx">
              <b>{offerLabel(disc)} your match</b>
              <em>{expiry}</em>
            </span>
          </div>
        ) : null}
        <h4 data-part="gcopy">{cfg.captureHeadline || "Your matches are ready"}</h4>
        <p data-part="gcopy">{cfg.captureSubtext || "Tell us where to send them."}</p>
        <input placeholder="you@email.com" readOnly />
        {cfg.capturePhone ? <input placeholder="Mobile number (optional)" readOnly /> : null}
        {consentRows}
        <button type="button">{cfg.captureCta}</button>
      </div>
    );
  };

  let screenBody: ReactNode;
  if (screen === "gate") {
    screenBody = (
      <div className="qz-rg-scr qz-rg-gatescr">
        <div className="qz-rg-gwrap">
          <span className="qz-rg-gicon" aria-hidden>
            ✉
          </span>
          <h2 className="qz-rg-h1" data-jump="gate" data-part="gcopy">
            {cfg.captureHeadline || "Your matches are ready"}
          </h2>
          <p className="qz-rg-why" data-jump="gate" data-part="gcopy">
            {cfg.captureSubtext || "Tell us where to send them and we’ll unlock your results."}
          </p>
          {capForm(false)}
          {cfg.capturePlacement === "before" && !cfg.captureRequired ? (
            <p className="qz-rg-gskip" data-jump="gate" data-part="gskip">
              {cfg.captureSkipLabel}
            </p>
          ) : null}
        </div>
      </div>
    );
  } else if (screen === "loading") {
    // Owner 2026-08-18 — the delay readout ("2.0s") left the visual screen;
    // the duration is configured in the panel only.
    const steps = cfg.loadingSteps.filter((s) => s.trim());
    screenBody = (
      <div className="qz-rg-scr qz-rg-loadscr">
        <div className="qz-rg-gwrap">
          <h2 className="qz-rg-h1" data-jump="reveal">
            {cfg.loadingOn ? "Finding your matches" : "No loading screen"}
          </h2>
          {cfg.loadingOn ? (
            <>
              <div className="qz-rg-lbar" aria-hidden>
                <i />
              </div>
              {cfg.loadingNamed && steps.length ? (
                <div className="qz-rg-lplain">
                  {steps.map((s, i) => (
                    <span key={i} className={i === 0 ? "is-now" : ""}>
                      {s}
                    </span>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <p className="qz-rg-why">The results appear the instant the last answer lands.</p>
          )}
        </div>
      </div>
    );
  } else {
    // ── the results page ─────────────────────────────────────────────────────
    const layout = cfg.layout ?? "hero_grid";
    const n =
      layout === "single_hero" ? 1 : Math.max(1, Math.min(cfg.gridMax || 3, pool.length || 3));
    const visible = pool.slice(0, n);
    const useHero = (layout === "hero_grid" || layout === "single_hero") && visible.length > 0;
    const hero = useHero ? visible[0] : null;
    const rest = useHero ? visible.slice(1) : visible;
    const isGrid = layout === "hero_grid" || layout === "grid";
    const offerOn = doc.discount_config?.enabled === true;
    const unlocking = cfg.capturePlacement === "discount";
    // §4 — only a product-class percent/fixed discount strikes a product
    // price; a locked offer never strikes it (the shopper can't have it yet).
    const cuts = offerOn && !unlocking && disc.kind !== "free_shipping" && disc.scope !== "collections";
    const after = (base: number) =>
      !cuts
        ? base
        : disc.kind === "amount"
          ? Math.max(0, base - disc.value)
          : Math.max(0, base * (1 - disc.value / 100));
    const priceOf = (p: IndexedProduct) => (p.price ? parseFloat(p.price) : 0);
    const priceHtml = (base: number) =>
      after(base) < base ? (
        <span className="qz-rg-fp" data-part="price">
          <s className="qz-rg-was">{money(base)}</s> <b className="qz-rg-now">{money(after(base))}</b>
          {!disc.auto_apply ? <span className="qz-rg-wcode">with code</span> : null}
        </span>
      ) : (
        <span className="qz-rg-fp" data-part="price">
          {base ? money(base) : "$—"}
        </span>
      );
    const starsOf = cfg.showStars ? (
      <span className="qz-rg-stars" data-part="stars">
        ★★★★★ <em>4.8 (212)</em>
        {cfg.showVerified ? (
          <b className="qz-rg-vb" data-part="verified">
            ✓ Verified
          </b>
        ) : null}
      </span>
    ) : null;
    const descOf = (p: IndexedProduct) =>
      cfg.descOverrides?.[p.product_id] ||
      `${p.title.replace(/^The /, "")}. A customer favourite, built for real conditions.`;

    const card = (p: IndexedProduct, i: number) => (
      <div key={p.product_id + i} className={isGrid ? "qz-rg-gcard" : "qz-rg-lrow"}>
        <span
          className={isGrid ? "qz-rg-gimg" : "qz-rg-fimg"}
          style={p.image_url ? { backgroundImage: `url("${p.image_url}")` } : undefined}
        />
        <span className="qz-rg-fbody">
          <span className="qz-rg-fn">{p.title}</span>
          {starsOf}
          {cfg.showDesc ? (
            <span className="qz-rg-fdesc" data-part="desc">
              {descOf(p)}
            </span>
          ) : null}
          {priceHtml(priceOf(p))}
          {cfg.showAtc ? (
            <span className="qz-rg-fbuy">
              <button type="button" className="qz-rg-fcta" data-part="cart">
                Add to cart
              </button>
            </span>
          ) : null}
        </span>
      </div>
    );

    const offerBarNode =
      offerOn && !unlocking ? (
        <div className="qz-rg-offer" data-jump="offer" data-part="offer">
          <span>
            {offerLabel(disc)} your match
            {disc.expiry_mode === "hours" ? ` · expires in ${disc.expiry_hours}h` : ""}
          </span>
          <b>{offerCode(disc)}</b>
        </div>
      ) : null;

    const extrasList = (extrasPool.length ? extrasPool : []).slice(0, cfg.extrasCount);
    screenBody = (
      <div className="qz-rg-scr">
        <header className="qz-rg-shead">
          <h2 className="qz-rg-h1" data-jump="head" data-part="hl">
            {cfg.headline}
          </h2>
          <p className="qz-rg-why" data-jump="head" data-part="why">
            {cfg.whyCopy}
          </p>
        </header>
        {openSec === "offer" && !offerOn ? (
          <div className="qz-rg-empty" data-jump="offer">
            No discount yet. Build one and it appears as a bar at the top of the page.
          </div>
        ) : null}
        {openSec === "reveal" && !cfg.loadingOn ? (
          <div className="qz-rg-empty" data-jump="reveal">
            No loading screen. The results appear the moment the last answer lands.
          </div>
        ) : null}
        {offerBarNode}
        {unlocking ? capForm(true) : null}
        {cfg.capturePlacement === "inline" ? capForm(false) : null}
        {hero ? (
          <div className="qz-rg-hero" data-jump="cards" data-part="grid">
            <span
              className="qz-rg-himg"
              style={hero.image_url ? { backgroundImage: `url("${hero.image_url}")` } : undefined}
            >
              <span className="qz-rg-ftop">★ Our top pick for you</span>
            </span>
            <div className="qz-rg-hbody">
              {starsOf}
              <div className="qz-rg-hn">{hero.title}</div>
              {cfg.showDesc ? (
                <div className="qz-rg-fdesc" data-part="desc">
                  {descOf(hero)}
                </div>
              ) : null}
              <div className="qz-rg-prow">{priceHtml(priceOf(hero))}</div>
              {cfg.showAtc ? (
                <button
                  type="button"
                  className="qz-rg-cta"
                  data-part="cart"
                  style={{ color: ctaText }}
                >
                  Add to cart
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        {rest.length ? (
          <div
            className={`qz-rg-rows${isGrid ? ` is-g${Math.min(cfg.perRow, 4)}` : ""}`}
            data-jump="cards"
            data-part="grid"
          >
            {rest.map(card)}
          </div>
        ) : null}
        {cfg.showAddAll ? (
          <button type="button" className="qz-rg-addall" data-jump="cards" data-part="addall">
            Add all to cart
          </button>
        ) : null}
        {cfg.extrasOn ? (
          <div className="qz-rg-extras" data-jump="fallback">
            <div className="qz-rg-xh" data-part="xhead">
              <h3>{cfg.extrasHeading}</h3>
              <span className="qz-rg-xtag">Extra picks</span>
            </div>
            <p data-part="xhead">{cfg.extrasCopy}</p>
            {extrasList.length ? (
              <div
                className={`qz-rg-rows${isGrid ? ` is-g${Math.min(cfg.perRow, 4)}` : ""}`}
                data-part="xprods"
              >
                {extrasList.map(card)}
              </div>
            ) : (
              <div className="qz-rg-note" data-part="xprods">
                No products picked yet. Choose some in the panel.
              </div>
            )}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="qz-rg-pvwrap" data-device={view}>
      {/* QRTZ-G45 — the mock's .preview-bar: device toggle left, nothing
          else. The owner cut the size/scale readout from this surface. */}
      <div className="qz-rg-pvctl">
        <span className="qz-s3-segbtns" role="group" aria-label="Preview device">
          <button
            type="button"
            className={view === "phone" ? "is-on" : ""}
            aria-pressed={view === "phone"}
            title="Mobile"
            aria-label="Mobile preview"
            onClick={() => setView("phone")}
          >
            📱
          </button>
          <button
            type="button"
            className={view === "desktop" ? "is-on" : ""}
            aria-pressed={view === "desktop"}
            title="Desktop"
            aria-label="Desktop preview"
            onClick={() => setView("desktop")}
          >
            🖥
          </button>
        </span>
        <button
          type="button"
          className="qz-s3-expandbtn is-icon"
          title="Expand"
          aria-label="Expand preview"
          onClick={() => setExpanded(true)}
        >
          ⛶
        </button>
      </div>
      <div className="qz-rg-pv">
        <DeviceFrame tier={view} resetKey={screen} showFold={false}>
          <div className="qz-rg-frame" style={cssVars}>
            {fontUrl ? <link rel="stylesheet" href={fontUrl} /> : null}
            <div className="qz-rg-screen" ref={screenRef}>
              {screenBody}
            </div>
          </div>
        </DeviceFrame>
      </div>
      {expanded && typeof document !== "undefined"
        ? createPortal(
            <div
              className="qz-s3-phscrim"
              role="dialog"
              aria-modal="true"
              aria-label="Expanded preview"
              onClick={(e) => {
                if (e.target === e.currentTarget) setExpanded(false);
              }}
            >
              <button
                type="button"
                className="qz-s3-phclose"
                aria-label="Close the expanded preview"
                onClick={() => setExpanded(false)}
              >
                ✕
              </button>
              {/* Expand is a bigger pane, not a zoom: the same DeviceFrame
                  measures this window-sized host and the same fit rule
                  produces the bigger result (never past 1:1). */}
              <div style={{ width: "92vw", height: "90vh" }}>
                <DeviceFrame tier={view} showFold={false}>
                  <div className="qz-rg-frame" style={cssVars}>
                    <div className="qz-rg-screen">{screenBody}</div>
                  </div>
                </DeviceFrame>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
