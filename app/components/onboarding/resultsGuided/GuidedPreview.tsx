import { useEffect, useMemo, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { Quiz, DesignTokens } from "../../../lib/quizSchema";
import type { IndexedProduct } from "../../../lib/recommendationEngine";
import {
  resolveDesignTokens,
  tokensToCssVars,
  suggestContrastText,
} from "../../../lib/designTokens";
import { resolveRecPageGlobal } from "../../../lib/recommendDecider";
import {
  TERMS_BOX,
  TERMS_LINE,
  defaultMarketingCopy,
  resolvePolicyLinks,
  smsBoxLabel,
  smsSmallPrint,
  unsubscribeLine,
  type WordingPart,
} from "../../../lib/consentWording";
import { cardCut, offerCodeDisplay, offerLine, offerName, offerTerms } from "../../../lib/offerCopy";
import { ConsentNotice, termsCopy, SMS_CHECKBOX, SMS_NOTICE } from "../../runtime/views/ConsentNotice";
import { googleFontsUrl } from "../../runtime/runtimeStyles";
import { DeviceFrame } from "../../builder/preview/DeviceFrame";
import { resolveGuided, resolveDiscount, discountExists } from "./state";

/* Results-guided handoff §11 — the preview. Phone only: DeviceFrame's
   390×745 phone, capped at 86% (slightly under life-size reads as a preview
   beside the settings, not a second page). THE PREVIEW FOLLOWS THE STEP: the
   gate screen for Email/Consent when the ask comes before the results, the
   loading screen for Loading, the results page for everything else.
   Rings: ARRIVING on a step or tab draws one hairline ring around the region
   it owns; TOUCHING a control rings only the element it changes. Both hold
   one second, then fade. Nonces (`arrival`, `touch`) trigger them — never
   every render. The phone never changes the step: a click on a region the
   current step owns opens that tab; anything else is inert. */

export type PreviewScreen = "results" | "gate" | "loading";
export type PreviewScroll = "region" | "bottom" | "top";

const money = (n: number) => `$${n.toFixed(2)}`;
// How many matches each arrangement shows in the preview (two per row).
const SHOWN: Record<string, number> = { hero_grid: 3, grid: 4, list: 3, single_hero: 1 };
const RING_HOLD_MS = 1000;
const RING_FADE_MS = 450;

export function GuidedPreview({
  doc,
  productIndex,
  designTokens,
  screen,
  sec,
  focusPart,
  arrival,
  touch,
  scroll,
  liveSecs,
  onOpenSec,
  shopDomain,
  storeName,
}: {
  doc: Quiz;
  productIndex: IndexedProduct[];
  designTokens: DesignTokens | null | undefined;
  screen: PreviewScreen;
  /** The open section (step or tab); null on the Overview. */
  sec: string | null;
  /** The touched control's part. */
  focusPart: string | null;
  /** Bumped on each arrival on a step or tab. */
  arrival: number;
  /** Bumped on each touched control. */
  touch: number;
  scroll: PreviewScroll;
  /** The regions the current step owns (clickable). */
  liveSecs: string[];
  onOpenSec: (sec: string) => void;
  shopDomain?: string;
  storeName?: string;
}) {
  const cfg = resolveGuided(doc);
  const runtimeCfg = resolveRecPageGlobal(doc.rec_page_settings);
  const disc = resolveDiscount(doc);
  const activeDiscount = discountExists(doc) && doc.discount_config?.enabled === true;

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

  /** A region's attributes: its jump id, and whether this step owns it. */
  const region = (id: string) => ({
    "data-jump": id,
    ...(liveSecs.includes(id) ? { "data-live": "1" } : {}),
  });

  // ── rings + scroll, driven by the nonces only ─────────────────────────────
  const screenRef = useRef<HTMLDivElement>(null);
  const ring = (targets: Element[], cls: string) => {
    targets.forEach((e) => e.classList.remove("qz-rg-zfade"));
    targets.forEach((e) => e.classList.add(cls));
    const hold = window.setTimeout(() => {
      targets.forEach((e) => {
        e.classList.add("qz-rg-zfade");
        e.classList.remove(cls);
      });
      window.setTimeout(() => targets.forEach((e) => e.classList.remove("qz-rg-zfade")), RING_FADE_MS);
    }, RING_HOLD_MS);
    return () => window.clearTimeout(hold);
  };
  const scrollTo = (target: HTMLElement | null) => {
    const scr = screenRef.current;
    if (!scr) return;
    if (scroll === "top") {
      scr.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (scroll === "bottom") {
      scr.scrollTo({ top: scr.scrollHeight, behavior: "smooth" });
      return;
    }
    if (!target) return;
    // offsetTop, never scrollIntoView: the frame is CSS-scaled, so client
    // rects are in scaled pixels while scrollTop is content pixels.
    let y = 0;
    let el: HTMLElement | null = target;
    while (el && el !== scr) {
      y += el.offsetTop;
      el = el.offsetParent as HTMLElement | null;
    }
    const top = Math.max(0, y - (scr.clientHeight / 2 - target.offsetHeight / 2));
    if (Math.abs(top - scr.scrollTop) > 12) scr.scrollTo({ top, behavior: "smooth" });
  };
  // Arrival: one soft ring around the region the section owns.
  useEffect(() => {
    const scr = screenRef.current;
    if (!scr) return;
    let cleanup: (() => void) | undefined;
    const frame = window.requestAnimationFrame(() => {
      if (!sec) {
        scrollTo(null);
        return;
      }
      // The real region wins over its empty-state hint.
      const real = [...scr.querySelectorAll(`[data-jump="${sec}"]:not(.qz-rg-empty)`)];
      const targets = real.length ? real : [...scr.querySelectorAll(`[data-jump="${sec}"]`)];
      scrollTo((targets[0] as HTMLElement | undefined) ?? null);
      cleanup = ring(targets, "qz-rg-zsoft");
    });
    return () => {
      window.cancelAnimationFrame(frame);
      cleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrival]);
  // Touch: ring ONLY the element the control changes.
  useEffect(() => {
    const scr = screenRef.current;
    if (!scr || !focusPart || touch === 0) return;
    let cleanup: (() => void) | undefined;
    const frame = window.requestAnimationFrame(() => {
      const targets = [...scr.querySelectorAll(`[data-part="${focusPart}"]`)];
      scrollTo((targets[0] as HTMLElement | undefined) ?? null);
      cleanup = ring(targets, "qz-rg-zsel");
    });
    return () => {
      window.cancelAnimationFrame(frame);
      cleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [touch]);

  // Clicks: only a region the current step owns does anything.
  const onScreenClick = (e: React.MouseEvent) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-live]");
    if (t?.dataset.jump) onOpenSec(t.dataset.jump);
  };

  // ── the form (gate screen, inline, unlock card) ───────────────────────────
  const fixed = Boolean(cfg.consentVersion);
  const links = resolvePolicyLinks(cfg, shopDomain);
  const labels = {
    terms: cfg.termsLabel?.trim() || "Terms & Conditions",
    privacy: cfg.privacyLabel?.trim() || "Privacy Policy",
  };
  const sentence = (parts: readonly WordingPart[]) =>
    parts.map((p, i) =>
      typeof p === "string" ? (
        p
      ) : (
        <u key={i} title={links[p.link] ?? "No link yet"}>
          {labels[p.link]}
        </u>
      ),
    );
  const termsIsBox = cfg.captureTermsMode === "checkbox";
  const fixedConsent = (
    <>
      {cfg.capturePhone ? <input placeholder="Mobile number (optional)" readOnly data-part="sms" /> : null}
      <div className="qz-rg-consentgrp" {...region("consent")}>
        {cfg.consentOn ? (
          <div className="qz-rg-cons" data-part="mkt">
            <i /> <span>{cfg.consentCopy.trim() || defaultMarketingCopy(storeName)}</span>
          </div>
        ) : null}
        {cfg.capturePhone ? (
          <div className="qz-rg-cons" data-part="sms">
            <i /> <span>{smsBoxLabel(storeName)}</span>
          </div>
        ) : null}
        {termsIsBox ? (
          <div className="qz-rg-cons" data-part="terms">
            <i /> <span>{sentence(TERMS_BOX)}</span>
          </div>
        ) : null}
        <div className="qz-rg-legal">
          {!termsIsBox ? <p data-part="terms">{sentence(TERMS_LINE)}</p> : null}
          {cfg.consentOn ? <p>{unsubscribeLine(storeName)}</p> : null}
          {cfg.capturePhone ? <p>{smsSmallPrint(storeName)}</p> : null}
        </div>
      </div>
    </>
  );
  // A draft never touched by the consent tab still renders the old form live.
  const legacyConsent = (
    <>
      {cfg.capturePhone ? <input placeholder="Mobile number (optional)" readOnly data-part="sms" /> : null}
      <div className="qz-rg-consentgrp" {...region("consent")}>
        {cfg.consentOn ? (
          <div className="qz-rg-cons" data-part="mkt">
            <i /> <span>{cfg.consentCopy.trim() || "Email me offers and updates. Unsubscribe anytime."}</span>
          </div>
        ) : null}
        {cfg.capturePhone && cfg.smsConsentMode === "checkbox" ? (
          <div className="qz-rg-cons" data-part="sms">
            <i /> <span>{cfg.smsConsentText || SMS_CHECKBOX}</span>
          </div>
        ) : null}
        {cfg.captureTermsOn && cfg.captureTermsMode !== "notice" ? (
          <div className="qz-rg-cons" data-part="terms">
            <i /> <span>{termsCopy(runtimeCfg)}</span>
          </div>
        ) : null}
        {cfg.captureTermsOn && cfg.captureTermsMode === "notice" ? (
          <p className="qz-rg-terms" data-part="terms">
            <ConsentNotice config={runtimeCfg} shopDomain={shopDomain} />
          </p>
        ) : null}
        {cfg.capturePhone && cfg.smsConsentMode === "notice" ? (
          <p className="qz-rg-terms">{cfg.smsConsentText || SMS_NOTICE}</p>
        ) : null}
      </div>
    </>
  );
  const formBody = (
    <>
      <input placeholder="you@email.com" readOnly />
      {fixed ? fixedConsent : legacyConsent}
      <button type="button">{cfg.captureCta}</button>
    </>
  );

  let screenBody: ReactNode;
  if (screen === "gate") {
    screenBody = (
      <div className="qz-rg-scr qz-rg-gatescr">
        <div className="qz-rg-gwrap">
          <span className="qz-rg-gicon" aria-hidden>
            ✉
          </span>
          <h2 className="qz-rg-h1" {...region("gate")} data-part="gcopy">
            {cfg.captureHeadline || "Your matches are ready"}
          </h2>
          <p className="qz-rg-why" {...region("gate")} data-part="gcopy">
            {cfg.captureSubtext || "Tell us where to send them and we’ll unlock your results."}
          </p>
          <div className="qz-rg-capform" {...region("gate")} data-part="gform">
            {formBody}
          </div>
          {cfg.where === "before" && !cfg.captureRequired ? (
            <p className="qz-rg-gskip" {...region("gate")} data-part="gskip">
              {cfg.captureSkipLabel}
            </p>
          ) : null}
        </div>
      </div>
    );
  } else if (screen === "loading") {
    const steps = cfg.loadingNamed ? cfg.loadingSteps.filter((s) => s.trim()) : [];
    screenBody = (
      <div className="qz-rg-scr qz-rg-loadscr">
        <div className="qz-rg-gwrap" {...region("reveal")}>
          <h2 className="qz-rg-h1">Finding your matches</h2>
          <div className="qz-rg-lbar" aria-hidden>
            <i />
          </div>
          {steps.length ? (
            <div className="qz-rg-lplain">
              {steps.map((s, i) => (
                <span key={i} className={i === 0 ? "is-now" : ""}>
                  {s}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    );
  } else {
    // ── the results page ─────────────────────────────────────────────────────
    const layout = cfg.layout ?? "hero_grid";
    const visible = productIndex.slice(0, SHOWN[layout] ?? 3);
    const useHero = (layout === "hero_grid" || layout === "single_hero") && visible.length > 0;
    const hero = useHero ? visible[0] : null;
    const rest = useHero ? visible.slice(1) : visible;
    const isGrid = layout === "hero_grid" || layout === "grid";
    const inline = cfg.where === "inline";
    const unlockCard = inline && cfg.unlock;
    const cut = activeDiscount ? cardCut(disc, { locked: unlockCard, matchingCards: visible.length }) : null;
    const after = (base: number) =>
      !cut ? base : cut.kind === "amount" ? Math.max(0, base - cut.value) : Math.max(0, base * (1 - cut.value / 100));
    const priceOf = (p: IndexedProduct) => (p.price ? parseFloat(p.price) : 0);
    const priceHtml = (base: number) =>
      after(base) < base ? (
        <span className="qz-rg-fp" data-part="price">
          <s className="qz-rg-was">{money(base)}</s> <b className="qz-rg-now">{money(after(base))}</b>
        </span>
      ) : (
        <span className="qz-rg-fp" data-part="price">
          {base ? money(base) : "$—"}
        </span>
      );
    const descOf = (p: IndexedProduct) =>
      cfg.descOverrides?.[p.product_id] ||
      p.description ||
      `${p.title.replace(/^The /, "")}. A customer favourite, built for real conditions.`;
    const card = (p: IndexedProduct, i: number) => (
      <div key={p.product_id + i} className={isGrid ? "qz-rg-gcard" : "qz-rg-lrow"}>
        <span
          className={isGrid ? "qz-rg-gimg" : "qz-rg-fimg"}
          style={p.image_url ? { backgroundImage: `url("${p.image_url}")` } : undefined}
        />
        <span className="qz-rg-fbody">
          <span className="qz-rg-fn">{p.title}</span>
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
    const rowsClass = `qz-rg-rows${isGrid ? " is-g2" : ""}`;

    // What sits above the matches: the offer bar, the locked card, the form.
    const offerBar =
      activeDiscount && !unlockCard ? (
        <div className="qz-rg-offer" {...region("gate")} data-part="offer">
          <span>{offerLine(disc)}</span>
          <b>{offerCodeDisplay(disc)}</b>
        </div>
      ) : null;
    const lockedCard = unlockCard ? (
      <div
        className={`qz-rg-capform is-unlock${activeDiscount ? "" : " is-pending"}`}
        {...region("gate")}
        data-part="gform"
      >
        {activeDiscount ? null : <span className="qz-rg-pendlbl">Add a discount to unlock this</span>}
        <div className="qz-rg-ulead" data-part="offer">
          <span className="qz-rg-ulock" aria-hidden>
            🔒
          </span>
          <span className="qz-rg-utx">
            <b>{offerName(disc)}</b>
            <em>{offerTerms(disc).replace(/^ · /, "") || "Yours after this step"}</em>
          </span>
        </div>
        <h4 data-part="gcopy">{cfg.captureHeadline}</h4>
        <p data-part="gcopy">{cfg.captureSubtext}</p>
        {formBody}
      </div>
    ) : null;
    const inlineForm =
      inline && !unlockCard ? (
        <div className="qz-rg-capform" {...region("gate")} data-part="capture">
          <h4 data-part="gcopy">{cfg.captureHeadline || "Want these emailed to you?"}</h4>
          <p data-part="gcopy">{cfg.captureSubtext || "We’ll send this match list to your inbox."}</p>
          {formBody}
        </div>
      ) : null;
    // A section that is open but draws nothing says so where its block would be.
    const noAsk =
      cfg.where === "none" && (sec === "gate" || sec === "consent") ? (
        <div className="qz-rg-empty" {...region(sec)}>
          {sec === "gate"
            ? "No email is asked for. The shopper goes straight from the last answer to the results."
            : "No email is asked for, so there is no form to show consent on."}
        </div>
      ) : null;
    const picks = cfg.extrasOn ? productIndex.filter((p) => cfg.extrasProductIds.includes(p.product_id)) : [];
    const shelf = picks.length ? (
      <div className="qz-rg-extras" {...region("fallback")}>
        <div className="qz-rg-xh" data-part="xhead">
          <h3>{cfg.extrasHeading}</h3>
        </div>
        {cfg.extrasCopy.trim() ? <p data-part="xhead">{cfg.extrasCopy}</p> : null}
        <div className={rowsClass} data-part="xprods">
          {picks.slice(0, cfg.extrasCount).map(card)}
        </div>
      </div>
    ) : sec === "fallback" ? (
      <div className="qz-rg-empty" {...region("fallback")} data-part="xprods">
        No products picked yet, so nothing shows under the matches.
      </div>
    ) : null;

    screenBody = (
      <div className="qz-rg-scr">
        <header className="qz-rg-shead">
          <h2 className="qz-rg-h1" {...region("head")} data-part="hl">
            {cfg.headline}
          </h2>
          <p className="qz-rg-why" {...region("head")} data-part="why">
            {cfg.whyCopy}
          </p>
        </header>
        {noAsk}
        {offerBar}
        {lockedCard}
        {inlineForm}
        {hero ? (
          <div className="qz-rg-hero" {...region("cards")} data-part="grid">
            <span
              className="qz-rg-himg"
              style={hero.image_url ? { backgroundImage: `url("${hero.image_url}")` } : undefined}
            >
              <span className="qz-rg-ftop">★ Our top pick for you</span>
            </span>
            <div className="qz-rg-hbody">
              <div className="qz-rg-hn">{hero.title}</div>
              {cfg.showDesc ? (
                <div className="qz-rg-fdesc" data-part="desc">
                  {descOf(hero)}
                </div>
              ) : null}
              <div className="qz-rg-prow">{priceHtml(priceOf(hero))}</div>
              {cfg.showAtc ? (
                <button type="button" className="qz-rg-cta" data-part="cart" style={{ color: ctaText }}>
                  Add to cart
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        {rest.length ? (
          <div className={rowsClass} {...region("cards")} data-part="grid">
            {rest.map(card)}
          </div>
        ) : null}
        {/* The live quiz draws "Add all to cart" only for two or more. */}
        {cfg.showAddAll && visible.length >= 2 ? (
          <button type="button" className="qz-rg-addall" {...region("cards")} data-part="addall">
            Add all to cart
          </button>
        ) : null}
        {shelf}
      </div>
    );
  }

  return (
    <div className="qz-rg-pvwrap">
      <div className="qz-rg-pv">
        <DeviceFrame tier="phone" zoom={86} showFold={false}>
          <div className="qz-rg-frame" style={cssVars}>
            {fontUrl ? <link rel="stylesheet" href={fontUrl} /> : null}
            {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
            <div
              className={`qz-rg-screen${sec ? "" : " is-inert"}`}
              ref={screenRef}
              onClick={onScreenClick}
            >
              {screenBody}
            </div>
          </div>
        </DeviceFrame>
      </div>
    </div>
  );
}
