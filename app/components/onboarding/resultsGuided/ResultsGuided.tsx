import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Quiz, DesignTokens, RecPageGlobal } from "../../../lib/quizSchema";
import type { IndexedProduct } from "../../../lib/recommendationEngine";
import { useQuizDraft } from "../../studio/useQuizDraft";
import { useFunnelBar, FunnelSaveChip, type FunnelBarOverride } from "../funnelChrome";
import { GuidedPreview, type PreviewScreen } from "./GuidedPreview";
import { DiscountEditor } from "./DiscountEditor";
import { TermsModal, DescriptionsModal, ExtrasPickerModal } from "./modals";
import {
  resolveGuided,
  resolveDiscount,
  patchGuided,
  writeDiscount,
  offerLabel,
  offerCode,
  GATE_COPY,
  REVEAL_MAX_MS,
  WIRED,
} from "./state";

/* Results-guided handoff (master.md, UPDATE AREA 3) — the Results step as a
   SIX-STEP GUIDED FLOW: one question per screen, a live phone preview beside
   it, and an Overview that hands off to the builder (Design-step retired;
   the look is brand-inherited). §5 completion model: done =
   the merchant has been through the step (moved past it with Next); blocked =
   on but cannot render. The bar carries progress only (no amber); Overview
   rows read the ACTUAL settings back. §3: no Back on step 1 (absent, not
   disabled); Next always reads "Next →"; the last button is "Continue to
   Design →". Owner rule (no dead ends): settings the runtime does not consume
   yet carry a quiet "not connected yet" tag — see WIRED in state.ts. */

// QRTZ-S6 (mock s15) — `name` feeds the eyebrow ("Step 1 of 6 · The page
// copy") and the forward button ("Next: the matches" names its destination).
const FLOW = [
  {
    g: "says",
    name: "The page copy",
    title: "What does the page say?",
    sub: "The first thing a shopper reads after answering. Name the outcome they get, not the quiz they took.",
  },
  {
    g: "shows",
    name: "The matches",
    title: "How do the matches look?",
    sub: "How many products they see, how those are arranged, and what each card carries.",
  },
  {
    g: "disc",
    name: "The offer",
    title: "Do you want to make an offer?",
    sub: "Optional. Leave it off if you would rather protect margin than push conversion.",
  },
  {
    g: "keep",
    name: "Email capture",
    title: "Do you want their email?",
    sub: "And if so, where you ask for it. This is the single biggest lever on the page.",
  },
  {
    g: "edge",
    name: "Extra picks",
    title: "Anything after the matches?",
    sub: "A “you might also like” shelf under the results. An AOV lever worth testing.",
  },
  {
    g: null,
    name: "Overview",
    title: "Overview",
    sub: "Everything you have set. Next you will style it in Design.",
  },
] as const;

// "Next: the matches" — sentence-case the section name after the colon.
const lcFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

const GROUPS: Array<{ id: string; band: "before" | "page"; ic: string; name: string }> = [
  { id: "keep", band: "before", ic: "✉", name: "Email capture" },
  { id: "says", band: "page", ic: "“”", name: "What it says" },
  { id: "shows", band: "page", ic: "▤", name: "The matches" },
  { id: "disc", band: "page", ic: "%", name: "Discount" },
  { id: "edge", band: "page", ic: "⤢", name: "Extra picks" },
];
const BANDS = { before: "Before the results", page: "The results page" };

const HS = [
  "Your perfect match",
  "We found your fit",
  "Made for how you ride",
  "Built for your setup",
  "Your match is in",
  "Picked for you",
];
const WS = [
  "Based on your answers, here's what we'd put you on.",
  "Matched to how and where you ride.",
  "Picked for your experience level.",
  "Chosen from your answers. Not our bestsellers.",
];

const LAYS: Array<[NonNullable<RecPageGlobal["layout"]>, string]> = [
  ["hero_grid", "Hero + list"],
  ["grid", "Grid"],
  ["list", "List"],
  ["single_hero", "Single"],
];
const LAY_NAME: Record<string, string> = {
  hero_grid: "Hero + list",
  grid: "Grid",
  list: "List",
  single_hero: "Single",
};

/** The owner's no-dead-ends flag: quiet, honest, impossible to miss in a review. */
function Unwired({ k }: { k: string }) {
  if (WIRED[k]) return null;
  return (
    <span className="qz-rg-unwired" title="Saved to the quiz, but the live page doesn't read it yet — flagged so we connect it.">
      not connected yet
    </span>
  );
}

function Stepper({
  value,
  min,
  max,
  onChange,
  label,
  fmt,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  label: string;
  fmt?: (v: number) => string;
}) {
  return (
    <span className="qz-s3-stepper">
      <button
        type="button"
        aria-label={`Decrease ${label}`}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        −
      </button>
      <span className="qz-s3-stepper-val">{fmt ? fmt(value) : value}</span>
      <button
        type="button"
        aria-label={`Increase ${label}`}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        +
      </button>
    </span>
  );
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`qz-rg-sw${on ? " is-on" : ""}`}
      onClick={onClick}
    />
  );
}

export function ResultsGuided({
  quizId,
  initialDoc,
  productIndex,
  designTokens,
  onOpenBuilder,
}: {
  quizId: string;
  initialDoc: Quiz;
  productIndex: IndexedProduct[];
  designTokens?: DesignTokens | null;
  /** Step 6's "Open the builder →" (the funnel's generate-build intent —
   *  Design-step retired; the look is brand-inherited). */
  onOpenBuilder: () => void;
}) {
  void quizId;
  const { doc, commit, isSaving, savedAt, saveError, retrySave } = useQuizDraft(initialDoc);
  const cfg = resolveGuided(doc);
  const disc = resolveDiscount(doc);
  const offerOn = doc.discount_config?.enabled === true;

  // ── §5 completion model ────────────────────────────────────────────────────
  const [stepIx, setStepIx] = useState(0);
  const [seen, setSeen] = useState<Record<string, boolean>>({});
  const [openSec, setOpenSec] = useState<string>("head");
  const [focusPart, setFocusPart] = useState<string | null>(null);
  const [holdSel, setHoldSel] = useState(false);
  const [rot, setRot] = useState({ h: 0, w: 0 });
  const [wordOpen, setWordOpen] = useState(false);
  const [xMoreOpen, setXMoreOpen] = useState(false);
  const [ddOpen, setDdOpen] = useState(false);
  const [gateTab, setGateTab] = useState<"gate" | "reveal" | "consent">("gate");
  const [modal, setModal] = useState<null | "discount" | "terms" | "descs" | "extras">(null);
  const [deferredUnlock, setDeferredUnlock] = useState(false);
  const [returnToAsk, setReturnToAsk] = useState(false);

  // blockers (§5): on, but cannot render
  const blockers: Record<string, string | null> = {
    keep: cfg.capturePlacement === "discount" && !offerOn ? "Needs a discount to unlock" : null,
    says: cfg.headline.trim() ? null : "Needs a headline",
    shows: null,
    disc: null,
    edge: cfg.extrasOn && cfg.extrasProductIds.length === 0 ? "Extra picks has no products" : null,
  };
  const groupState = (id: string): "new" | "done" | "todo" =>
    blockers[id] ? "todo" : seen[id] ? "done" : "new";
  const allReviewed = GROUPS.every((g) => groupState(g.id) === "done") && seen.__ovw === true;

  const step = FLOW[stepIx]!;
  const isOverview = step.g === null;

  // preview follows the step (§6)
  const screen: PreviewScreen =
    step.g === "keep" && gateTab === "reveal"
      ? "loading"
      : step.g === "keep" && cfg.capturePlacement === "before"
        ? "gate"
        : "results";

  // §5 arrival celebration — once per arrival on the Overview
  const spineRef = useRef<HTMLDivElement>(null);
  const celebrated = useRef(false);
  useEffect(() => {
    if (!isOverview || celebrated.current) return;
    celebrated.current = true;
    const spine = spineRef.current;
    if (!spine || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    spine.classList.add("is-party");
    const conf = document.createElement("span");
    conf.className = "qz-rg-confetti";
    const tint = ["var(--qz-accent)", "var(--qz-ok)", "var(--qz-warn)", "var(--qz-accent-wash)"];
    for (let i = 0; i < 16; i++) {
      const bit = document.createElement("i");
      const up = i % 2 === 0;
      bit.style.cssText = `left:${5 + i * 6}%;--dx:${(Math.random() * 26 - 13).toFixed(0)}px;--dy:${up ? -(12 + Math.random() * 10) : 12 + Math.random() * 10}px;--r:${(Math.random() * 220 - 110).toFixed(0)}deg;animation-delay:${i * 34 + 120}ms;background:${tint[i % tint.length]};`;
      conf.appendChild(bit);
    }
    spine.appendChild(conf);
    const t = window.setTimeout(() => {
      conf.remove();
      spine.classList.remove("is-party");
    }, 1900);
    return () => window.clearTimeout(t);
  }, [isOverview]);

  const gotoStep = (i: number) => {
    const next = Math.max(0, Math.min(FLOW.length - 1, i));
    setStepIx(next);
    setFocusPart(null);
    setHoldSel(false);
    const f = FLOW[next]!;
    if (f.g === "says") setOpenSec("head");
    else if (f.g === "shows") setOpenSec("cards");
    else if (f.g === "disc") setOpenSec("offer");
    else if (f.g === "keep") setOpenSec(gateTab === "reveal" ? "reveal" : gateTab === "consent" ? "consent" : "gate");
    else if (f.g === "edge") setOpenSec("fallback");
    else setOpenSec("");
    if (f.g === null) setSeen((s) => ({ ...s, __ovw: true }));
  };
  const next = () => {
    if (step.g) setSeen((s) => ({ ...s, [step.g as string]: true }));
    if (stepIx < FLOW.length - 1) gotoStep(stepIx + 1);
    else onOpenBuilder();
  };

  // panel interactions narrow the preview highlight to the touched control
  const focusOn = (part: string) => {
    setFocusPart(part);
    setHoldSel(false);
  };

  // jump from the preview back into the right step
  const jumpFromPreview = (sec: string) => {
    const target =
      sec === "head" ? 0 : sec === "cards" ? 1 : sec === "offer" ? 2 : sec === "gate" || sec === "consent" || sec === "reveal" ? 3 : 4;
    if (sec === "gate" || sec === "consent" || sec === "reveal")
      setGateTab(sec as "gate" | "reveal" | "consent");
    gotoStep(target);
    setOpenSec(sec);
  };

  // the bar: save chip via the funnel bridge — error-only since the owner's
  // 2026-08-02 edit (silent when healthy; a failed autosave must surface).
  const barOverride = useMemo<FunnelBarOverride>(
    () => ({
      saveChip: (
        <FunnelSaveChip isSaving={isSaving} savedAt={savedAt} saveError={saveError} onRetry={retrySave} />
      ),
    }),
    [isSaving, savedAt, saveError, retrySave],
  );
  useFunnelBar(barOverride);

  const patch = (p: Partial<RecPageGlobal>) => commit(patchGuided(doc, p));

  // placement change applies the mode's copy preset while untouched (§4)
  const copyTouched = useRef(false);
  const setPlacement = (where: NonNullable<RecPageGlobal["capturePlacement"]>) => {
    const preset = GATE_COPY[where];
    patch({
      capturePlacement: where,
      ...(preset && !copyTouched.current
        ? { captureHeadline: preset.headline, captureSubtext: preset.copy, captureCta: preset.cta }
        : {}),
      ...(where !== "before" ? { captureRequired: false } : {}),
    });
    setDdOpen(false);
    if (where !== "discount") setDeferredUnlock(false);
  };

  const win = (arr: string[], off: number) =>
    [0, 1, 2].map((i) => arr[(((off + i) % arr.length) + arr.length) % arr.length]!);

  // ── section bodies ─────────────────────────────────────────────────────────
  const saysBody = (
    <>
      <div className="qz-rg-fld" onFocusCapture={() => focusOn("hl")}>
        <div className="qz-rg-fl">Headline</div>
        <input
          className="qz-input"
          value={cfg.headline}
          aria-label="Results headline"
          onChange={(e) => patch({ headline: e.target.value })}
        />
        <div className="qz-rg-sugg">
          <div className="qz-rg-sl">Try</div>
          <div className="qz-rg-srow">
            <button type="button" className="qz-rg-arw" aria-label="Previous suggestions" onClick={() => setRot((r) => ({ ...r, h: r.h - 1 }))}>
              ‹
            </button>
            <div className="qz-rg-swin">
              {win(HS, rot.h).map((t) => (
                <button key={t} type="button" className="qz-rg-pchip" title={t} onClick={() => patch({ headline: t })}>
                  {t}
                </button>
              ))}
            </div>
            <button type="button" className="qz-rg-arw" aria-label="Next suggestions" onClick={() => setRot((r) => ({ ...r, h: r.h + 1 }))}>
              ›
            </button>
          </div>
        </div>
      </div>
      <div className="qz-rg-fld" onFocusCapture={() => focusOn("why")}>
        <div className="qz-rg-fl">Intro line</div>
        <textarea
          className="qz-input"
          rows={2}
          value={cfg.whyCopy}
          aria-label="Results intro line"
          onChange={(e) => patch({ whyCopy: e.target.value })}
        />
        <div className="qz-rg-sugg">
          <div className="qz-rg-sl">Try</div>
          <div className="qz-rg-srow">
            <button type="button" className="qz-rg-arw" aria-label="Previous suggestions" onClick={() => setRot((r) => ({ ...r, w: r.w - 1 }))}>
              ‹
            </button>
            <div className="qz-rg-swin">
              {win(WS, rot.w).map((t) => (
                <button key={t} type="button" className="qz-rg-pchip" title={t} onClick={() => patch({ whyCopy: t })}>
                  {t.length > 26 ? `${t.slice(0, 24)}…` : t}
                </button>
              ))}
            </div>
            <button type="button" className="qz-rg-arw" aria-label="Next suggestions" onClick={() => setRot((r) => ({ ...r, w: r.w + 1 }))}>
              ›
            </button>
          </div>
        </div>
      </div>
    </>
  );

  const layout = cfg.layout ?? "hero_grid";
  const showsBody = (
    <>
      <div className="qz-rg-fl">How the matches are arranged</div>
      <div className="qz-rg-lays">
        {LAYS.map(([k, l]) => (
          <button
            key={k}
            type="button"
            className={`qz-rg-lay${k === layout ? " is-on" : ""}`}
            onClick={() => {
              patch({ layout: k });
              focusOn("grid");
            }}
          >
            <span className={`qz-rg-layg is-${k}`} aria-hidden>
              <b />
              <b />
              <b />
              {k === "grid" ? <b /> : null}
            </span>
            <span>{l}</span>
          </button>
        ))}
      </div>
      {layout === "hero_grid" || layout === "grid" ? (
        <div className="qz-rg-inline">
          <span className="qz-rg-t">
            Products per row <Unwired k="perRow" />
            <em>Phone &amp; desktop fine-tuned later in Design</em>
          </span>
          <Stepper value={cfg.perRow} min={1} max={4} label="products per row" onChange={(v) => patch({ perRow: v })} />
        </div>
      ) : null}
      <div className="qz-rg-inline" onClickCapture={() => focusOn("grid")}>
        <span className="qz-rg-t">How many to show</span>
        <Stepper
          value={layout === "single_hero" ? 1 : (cfg.gridMax || 3)}
          min={1}
          max={5}
          label="how many to show"
          onChange={(v) => patch({ gridMax: v })}
        />
      </div>
      <div className="qz-rg-fl" style={{ marginTop: 14 }}>
        On each card
      </div>
      <div className="qz-rg-togs">
        {(
          [
            ["stars", "Review stars", cfg.showStars, () => patch({ showStars: !cfg.showStars })],
            [
              "verified",
              "Verified-buyer badge",
              cfg.showVerified,
              () => patch({ showVerified: !cfg.showVerified }),
            ],
            ["cart", "One-click add to cart", cfg.showAtc, () => patch({ showAtc: !cfg.showAtc })],
          ] as Array<[string, string, boolean, () => void]>
        ).map(([part, label, on, flip]) => (
          <div key={part} className={`qz-rg-tog${on ? " is-on" : ""}`} onClickCapture={() => focusOn(part)}>
            <span className="qz-rg-t">
              {label}
              {part === "verified" ? <Unwired k="showVerified" /> : null}
            </span>
            <Toggle on={on} onClick={flip} label={label} />
          </div>
        ))}
        <div className={`qz-rg-tog${cfg.showDesc ? " is-on" : ""}`} onClickCapture={() => focusOn("desc")}>
          <span className="qz-rg-t">
            Product description <Unwired k="descOverrides" />
          </span>
          {cfg.showDesc ? (
            <button type="button" className="qz-rg-gear" title="Edit the descriptions" onClick={() => setModal("descs")}>
              ✎
            </button>
          ) : null}
          <Toggle on={!!cfg.showDesc} onClick={() => patch({ showDesc: !cfg.showDesc })} label="Product description" />
        </div>
        <div className={`qz-rg-tog${cfg.showAddAll ? " is-on" : ""}`} onClickCapture={() => focusOn("addall")}>
          <span className="qz-rg-t">“Add all to cart” button</span>
          <Toggle on={!!cfg.showAddAll} onClick={() => patch({ showAddAll: !cfg.showAddAll })} label="Add all to cart" />
        </div>
      </div>
    </>
  );

  const presetOn = (kind: string, value?: number) =>
    offerOn && disc.kind === kind && (value === undefined || disc.value === value) && !customOn;
  const customOn = offerOn && !(disc.kind === "percentage" && disc.value === 10 && !doc.discount_config?.code) && !(disc.kind === "free_shipping" && !doc.discount_config?.code);
  const applyPreset = (patchD: Partial<Quiz["discount_config"]>, on: boolean) => {
    commit(writeDiscount(doc, { enabled: on, ...(on ? patchD : {}) } as Partial<Quiz["discount_config"]>));
    setOpenSec("offer");
    focusOn("offer");
  };
  const discBody = (
    <>
      <div className="qz-rg-couponlist">
        <div className={`qz-rg-coupon${presetOn("percentage", 10) ? " is-on" : ""}`}>
          <span className="qz-rg-ct">
            <b>10% off your match</b>
            <span>The most-used quiz offer. A gentle nudge.</span>
          </span>
          <Toggle
            on={presetOn("percentage", 10)}
            onClick={() => applyPreset({ kind: "percentage", value: 10 }, !presetOn("percentage", 10))}
            label="10% off your match"
          />
        </div>
        <div className={`qz-rg-coupon${presetOn("free_shipping") ? " is-on" : ""}`}>
          <span className="qz-rg-ct">
            <b>Free shipping on your match</b>
            <span>Good for heavier or bundled products.</span>
          </span>
          <Toggle
            on={presetOn("free_shipping")}
            onClick={() => applyPreset({ kind: "free_shipping" }, !presetOn("free_shipping"))}
            label="Free shipping on your match"
          />
        </div>
        {customOn ? (
          <div className="qz-rg-coupon is-on">
            <span className="qz-rg-ct">
              <b>Your discount</b>
              <span>
                {offerCode(disc)} · {offerLabel(disc)} <Unwired k="discount_advanced" />
              </span>
            </span>
            <button type="button" className="qz-rg-cedit" onClick={() => setModal("discount")}>
              Edit
            </button>
            <Toggle on onClick={() => commit(writeDiscount(doc, { enabled: false }))} label="Your discount" />
          </div>
        ) : null}
      </div>
      <button type="button" className="qz-rg-addbtn" onClick={() => setModal("discount")}>
        ＋ Create a discount
      </button>
    </>
  );

  const placementLabel: Record<string, string> = {
    discount: "On the results page. Email unlocks a discount.",
    inline: "On the results page. No discount or un-gated discount.",
    before: "Before the results.",
    none: "No email capture.",
  };
  const best = offerOn ? "discount" : "before";
  const gateBody = (
    <>
      <div className={`qz-rg-dd${ddOpen ? " is-open" : ""}`}>
        <button
          type="button"
          className="qz-rg-ddbtn"
          aria-haspopup="listbox"
          aria-expanded={ddOpen}
          onClick={() => setDdOpen((v) => !v)}
        >
          <span>{placementLabel[cfg.capturePlacement]}</span>
          <span aria-hidden>▾</span>
        </button>
        {ddOpen ? (
          <div className="qz-rg-ddmenu" role="listbox">
            {(["discount", "inline", "before", "none"] as const).map((w) => (
              <button
                key={w}
                type="button"
                role="option"
                aria-selected={cfg.capturePlacement === w}
                className={`qz-rg-ddopt${cfg.capturePlacement === w ? " is-on" : ""}`}
                onClick={() => setPlacement(w)}
              >
                {placementLabel[w]}
                {w === best ? <em className="qz-rg-besttag">Best</em> : null}
                {w === "inline" || w === "discount" ? <Unwired k={w === "inline" ? "placement_inline" : "placement_discount"} /> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {cfg.capturePlacement === "discount" && !offerOn ? (
        <div className="qz-rg-setrow">
          {deferredUnlock ? (
            <div className="qz-rg-notewarn" style={{ margin: 0 }}>
              ⚠ No discount yet. The card won’t show until there is one.{" "}
              <button
                type="button"
                className="qz-rg-bt"
                onClick={() => {
                  setReturnToAsk(true);
                  setModal("discount");
                }}
              >
                Set up discount
              </button>
            </div>
          ) : (
            <>
              <span>This placement needs a discount to unlock.</span>
              <span className="qz-rg-btns">
                <button
                  type="button"
                  className="qz-rg-bt is-pri"
                  onClick={() => {
                    setReturnToAsk(true);
                    setModal("discount");
                  }}
                >
                  Set up discount
                </button>
                <button type="button" className="qz-rg-bt" onClick={() => setDeferredUnlock(true)}>
                  Set up later
                </button>
              </span>
            </>
          )}
        </div>
      ) : null}
      {cfg.capturePlacement !== "none" ? (
        <div className="qz-rg-nested">
          {cfg.capturePlacement === "before" ? (
            <div className="qz-rg-inline" onClickCapture={() => focusOn("gform")}>
              <span className="qz-rg-t">
                Required to see results <span className="qz-rg-tiptest">Test</span>
                <Unwired k="captureRequired" />
              </span>
              <Toggle
                on={!!cfg.captureRequired}
                onClick={() => patch({ captureRequired: !cfg.captureRequired })}
                label="Required to see results"
              />
            </div>
          ) : null}
          <div className={`qz-rg-disc${wordOpen ? " is-open" : ""}`}>
            <button type="button" className="qz-rg-dischead" onClick={() => setWordOpen((v) => !v)}>
              <span className="qz-rg-dt">
                <b>Wording</b>
                <span>“{cfg.captureHeadline || "Your matches are ready"}”</span>
              </span>
              <span aria-hidden>▾</span>
            </button>
            {wordOpen ? (
              <div className="qz-rg-discbody" onFocusCapture={() => focusOn("gcopy")}>
                <div className="qz-rg-fld">
                  <div className="qz-rg-fl">Headline</div>
                  <input
                    className="qz-input"
                    value={cfg.captureHeadline || ""}
                    aria-label="Capture headline"
                    onChange={(e) => {
                      copyTouched.current = true;
                      patch({ captureHeadline: e.target.value });
                    }}
                  />
                </div>
                <div className="qz-rg-fld">
                  <div className="qz-rg-fl">Supporting line</div>
                  <textarea
                    className="qz-input"
                    rows={2}
                    value={cfg.captureSubtext || ""}
                    aria-label="Capture supporting line"
                    onChange={(e) => {
                      copyTouched.current = true;
                      patch({ captureSubtext: e.target.value });
                    }}
                  />
                  <div className="qz-rg-cap">
                    Name the exchange: what they get for the address. “Join our newsletter” is the
                    weakest version of this line.
                  </div>
                </div>
                <div className="qz-rg-fld">
                  <div className="qz-rg-fl">
                    Button <Unwired k="captureCtaSkip" />
                  </div>
                  <input
                    className="qz-input"
                    value={cfg.captureCta}
                    aria-label="Capture button label"
                    onChange={(e) => {
                      copyTouched.current = true;
                      patch({ captureCta: e.target.value });
                    }}
                  />
                </div>
                {cfg.capturePlacement === "before" && !cfg.captureRequired ? (
                  <div className="qz-rg-fld" onFocusCapture={() => focusOn("gskip")}>
                    <div className="qz-rg-fl">
                      Skip link <Unwired k="captureCtaSkip" />
                    </div>
                    <input
                      className="qz-input"
                      value={cfg.captureSkipLabel}
                      aria-label="Skip link label"
                      onChange={(e) => patch({ captureSkipLabel: e.target.value })}
                    />
                    <div className="qz-rg-cap">
                      The visible way past the form. Removing it is what makes the gate “hard”.
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );

  const loadingBody = (
    <>
      <div className="qz-rg-inline">
        <span className="qz-rg-t">
          Show a loading screen <Unwired k="loading" />
        </span>
        <Toggle on={!!cfg.loadingOn} onClick={() => patch({ loadingOn: !cfg.loadingOn })} label="Show a loading screen" />
      </div>
      <div className="qz-rg-note">
        ◇ <b>Best practice:</b> a short 2–3 second “working on it” screen.
      </div>
      <div className="qz-rg-inline">
        <span className="qz-rg-t">Duration</span>
        <Stepper
          value={(cfg.loadingMs ?? 2000) / 500}
          min={2}
          max={10}
          label="loading duration"
          fmt={(v) => `${(v / 2).toFixed(1)}s`}
          onChange={(v) => patch({ loadingMs: v * 500 })}
        />
      </div>
      {(cfg.loadingMs ?? 2000) > REVEAL_MAX_MS ? (
        <div className="qz-rg-notewarn">
          ⚠ Past 3 seconds the wait stops reading as effort and starts reading as a broken page.
        </div>
      ) : null}
      <div className="qz-rg-inline">
        <span className="qz-rg-t">
          Name the steps <span className="qz-rg-tipbest">Best</span>
        </span>
        <Toggle on={!!cfg.loadingNamed} onClick={() => patch({ loadingNamed: !cfg.loadingNamed })} label="Name the steps" />
      </div>
      {cfg.loadingNamed ? (
        <div className="qz-rg-fld">
          {cfg.loadingSteps.map((s, i) => (
            <div key={i} className="qz-rg-steprow">
              <input
                className="qz-input"
                value={s}
                placeholder="What is happening at this point"
                aria-label={`Loading step ${i + 1}`}
                onChange={(e) => {
                  const steps = [...cfg.loadingSteps];
                  steps[i] = e.target.value;
                  patch({ loadingSteps: steps });
                }}
              />
              <button
                type="button"
                className="qz-rg-stepdel"
                disabled={cfg.loadingSteps.length <= 1}
                title="Remove this step"
                aria-label={`Remove loading step ${i + 1}`}
                onClick={() => patch({ loadingSteps: cfg.loadingSteps.filter((_, j) => j !== i) })}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            className="qz-rg-addstep"
            disabled={cfg.loadingSteps.length >= 5}
            onClick={() => patch({ loadingSteps: [...cfg.loadingSteps, ""] })}
          >
            ＋ Add a step
          </button>
          <div className="qz-rg-cap">
            Keep them true. A step claiming work you don’t do is the one thing here that can cost
            you trust.
          </div>
        </div>
      ) : null}
    </>
  );

  const consentBody = (
    <>
      <div className="qz-rg-inline" onClickCapture={() => focusOn("consent")}>
        <span className="qz-rg-t">
          Marketing consent <Unwired k="consent" />
        </span>
        <Toggle on={!!cfg.consentOn} onClick={() => patch({ consentOn: !cfg.consentOn })} label="Marketing consent" />
      </div>
      {cfg.consentOn ? (
        <div className="qz-rg-fld" onFocusCapture={() => focusOn("consent")}>
          <div className="qz-rg-fl">Consent wording</div>
          <input
            className="qz-input"
            value={cfg.consentCopy}
            aria-label="Consent wording"
            onChange={(e) => patch({ consentCopy: e.target.value })}
          />
        </div>
      ) : null}
      <div className="qz-rg-inline" onClickCapture={() => focusOn("terms")}>
        <span className="qz-rg-t">Terms &amp; conditions</span>
        {cfg.captureTermsOn ? (
          <button type="button" className="qz-rg-gear" title="Edit the wording and links" onClick={() => setModal("terms")}>
            ✎
          </button>
        ) : null}
        <Toggle
          on={!!cfg.captureTermsOn}
          onClick={() => patch({ captureTermsOn: !cfg.captureTermsOn })}
          label="Terms and conditions"
        />
      </div>
      <div className="qz-rg-inline" onClickCapture={() => focusOn("consent")}>
        <span className="qz-rg-t">SMS opt-in</span>
        <Toggle on={!!cfg.capturePhone} onClick={() => patch({ capturePhone: !cfg.capturePhone })} label="SMS opt-in" />
      </div>
      {cfg.capturePhone ? (
        <div className="qz-rg-notewarn">
          ⚠ A phone field on top of the email typically raises drop-off. And SMS needs its <b>own</b>{" "}
          tick, plus rate and opt-out wording.
        </div>
      ) : null}
    </>
  );

  const edgeBody = (
    <>
      <div className="qz-rg-inline">
        <span className="qz-rg-t">
          Show extra picks <Unwired k="extras" />
          <em>A “you might also like” shelf under the matches</em>
        </span>
        <Toggle on={!!cfg.extrasOn} onClick={() => patch({ extrasOn: !cfg.extrasOn })} label="Show extra picks" />
      </div>
      {cfg.extrasOn ? (
        <>
          <div className="qz-rg-inline" onClickCapture={() => focusOn("xprods")}>
            <span className="qz-rg-t">
              Products
              <em>
                {cfg.extrasProductIds.length
                  ? `${cfg.extrasProductIds.length} product${cfg.extrasProductIds.length === 1 ? "" : "s"} picked`
                  : "Nothing picked"}
              </em>
            </span>
            <button type="button" className="qz-rg-bt" onClick={() => setModal("extras")}>
              Choose →
            </button>
          </div>
          <div className="qz-rg-fld" onFocusCapture={() => focusOn("xhead")}>
            <div className="qz-rg-fl">Heading</div>
            <input
              className="qz-input"
              value={cfg.extrasHeading}
              aria-label="Extra picks heading"
              onChange={(e) => patch({ extrasHeading: e.target.value })}
            />
          </div>
          <div className={`qz-rg-disc${xMoreOpen ? " is-open" : ""}`}>
            <button type="button" className="qz-rg-dischead" onClick={() => setXMoreOpen((v) => !v)}>
              <span className="qz-rg-dt">
                <b>Copy and count</b>
                <span>
                  {cfg.extrasCount} shown · “{cfg.extrasCopy}”
                </span>
              </span>
              <span aria-hidden>▾</span>
            </button>
            {xMoreOpen ? (
              <div className="qz-rg-discbody" onFocusCapture={() => focusOn("xhead")}>
                <div className="qz-rg-fld">
                  <div className="qz-rg-fl">Copy</div>
                  <input
                    className="qz-input"
                    value={cfg.extrasCopy}
                    aria-label="Extra picks copy"
                    onChange={(e) => patch({ extrasCopy: e.target.value })}
                  />
                </div>
                <div className="qz-rg-inline">
                  <span className="qz-rg-t">How many to show</span>
                  <Stepper value={cfg.extrasCount} min={1} max={6} label="extra picks count" onChange={(v) => patch({ extrasCount: v })} />
                </div>
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </>
  );

  // §5 Overview — the read-back rows, banded by moment
  const summary: Record<string, () => string> = {
    says: () => `“${cfg.headline}”`,
    shows: () => {
      const on = [cfg.showStars && "stars", cfg.showAtc && "cart", cfg.showDesc && "description"]
        .filter(Boolean)
        .join(", ");
      return `${LAY_NAME[layout]} · ${layout === "single_hero" ? 1 : cfg.gridMax || 3} shown${on ? ` · ${on}` : ""}`;
    },
    keep: () => {
      if (cfg.capturePlacement === "none") return "No email asked";
      const w = { before: "Before results", inline: "On the page", discount: "Unlocks the offer" }[
        cfg.capturePlacement
      ];
      return `${w} · ${cfg.capturePhone ? "Email + SMS" : "Email"}${cfg.loadingOn ? ` · ${((cfg.loadingMs ?? 2000) / 1000).toFixed(1)}s` : ""}`;
    },
    disc: () => (offerOn ? `${offerLabel(disc)} · ${offerCode(disc)}` : "No offer"),
    edge: () =>
      cfg.extrasOn
        ? `Extra picks · ${Math.min(cfg.extrasCount, cfg.extrasProductIds.length || cfg.extrasCount)} shown`
        : "Off",
  };
  const overviewBody = (
    <div className="qz-rg-ovw">
      {(["before", "page"] as const).map((band) => (
        <div key={band}>
          <div className="qz-rg-bandlbl">{BANDS[band]}</div>
          {GROUPS.filter((g) => g.band === band).map((g) => {
            const gs = groupState(g.id);
            return (
              <button
                key={g.id}
                type="button"
                className={`qz-rg-drow is-${gs}`}
                onClick={() => {
                  setHoldSel(true);
                  gotoStep(FLOW.findIndex((f) => f.g === g.id));
                }}
              >
                <span className="qz-rg-dic" aria-hidden>
                  {g.ic}
                  <i className="qz-rg-dbadge">{gs === "done" ? "✓" : gs === "todo" ? "!" : ""}</i>
                </span>
                <span className="qz-rg-dtx">
                  <b>{g.name}</b>
                  <span className="qz-rg-dsum">
                    {gs === "todo" ? blockers[g.id] : gs === "new" ? "Not set up yet" : summary[g.id]?.() ?? ""}
                  </span>
                </span>
                <span className="qz-rg-darr" aria-hidden>
                  ›
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );

  // keep — the three sub-tabs (mock stabs)
  const keepTabs = (
    <div className="qz-rg-stabs" role="tablist" aria-label="Email capture sections">
      {(
        [
          ["gate", "The ask"],
          ["reveal", "Loading"],
          ["consent", "Consent"],
        ] as const
      ).map(([id, label]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={gateTab === id}
          className={`qz-rg-stab${gateTab === id ? " is-on" : ""}`}
          onClick={() => {
            setGateTab(id);
            setOpenSec(id);
            setFocusPart(null);
          }}
        >
          <i aria-hidden />
          {label}
        </button>
      ))}
    </div>
  );

  let body: ReactNode = null;
  if (isOverview) body = overviewBody;
  else if (step.g === "says") body = saysBody;
  else if (step.g === "shows") body = showsBody;
  else if (step.g === "disc") body = discBody;
  else if (step.g === "keep")
    body = (
      <>
        {keepTabs}
        {gateTab === "gate" ? gateBody : gateTab === "reveal" ? loadingBody : consentBody}
      </>
    );
  else body = edgeBody;

  return (
    <div className="qz-rg">
      <div className="qz-rg-split">
        <div className="qz-rg-stepcol">
          <div className="qz-rg-stepwrap">
            {/* §5 progress bar — colour says done, HEIGHT says here; no amber. */}
            <div className="qz-rg-spine" ref={spineRef} aria-hidden>
              {FLOW.map((f, i) => {
                const done = f.g === null ? !!seen.__ovw : !!seen[f.g];
                return <i key={i} className={`${done ? "is-done " : ""}${i === stepIx ? "is-now" : ""}`} />;
              })}
            </div>
            <div className="qz-rg-stepno">
              {/* QRTZ-S6 (mock .eyebrow) — the section name rides the count. */}
              Step {stepIx + 1} of {FLOW.length} · {step.name}
              {allReviewed ? <span className="qz-rg-allrev">✓ All reviewed</span> : null}
            </div>
            <h2 className="qz-rg-title">{step.title}</h2>
            <p className="qz-rg-stepsub">{step.sub}</p>
          </div>
          <div className="qz-rg-panel">{body}</div>
          <div className="qz-rg-stepfoot">
            {/* §3 — no Back on step 1: absent, not disabled. */}
            {stepIx > 0 ? (
              <button type="button" className="qz-rg-btn2" onClick={() => gotoStep(stepIx - 1)}>
                ← Back
              </button>
            ) : null}
            <span className="qz-rg-fsp" />
            <button type="button" className="qz-rg-btn2 is-pri" onClick={next}>
              {/* QRTZ-S6 (mock .edit-foot) — the forward button NAMES its
                  destination; the last keeps the product's builder handoff. */}
              {stepIx === FLOW.length - 1
                ? "Open the builder →"
                : `Next: ${lcFirst(FLOW[stepIx + 1]!.name)}`}
            </button>
          </div>
        </div>
        <GuidedPreview
          doc={doc}
          productIndex={productIndex}
          designTokens={designTokens ?? undefined}
          screen={screen}
          openSec={isOverview ? null : openSec}
          focusPart={focusPart}
          holdSel={holdSel}
          onJump={jumpFromPreview}
        />
      </div>

      {modal === "discount" ? (
        <DiscountEditor
          doc={doc}
          lockedToDynamic={cfg.capturePlacement === "discount"}
          onCommit={commit}
          onSaved={() => {
            if (returnToAsk) {
              setReturnToAsk(false);
              gotoStep(3);
              setOpenSec("gate");
            }
          }}
          onClose={() => setModal(null)}
        />
      ) : null}
      {modal === "terms" ? <TermsModal doc={doc} onCommit={commit} onClose={() => setModal(null)} /> : null}
      {modal === "descs" ? (
        <DescriptionsModal doc={doc} productIndex={productIndex} onCommit={commit} onClose={() => setModal(null)} />
      ) : null}
      {modal === "extras" ? (
        <ExtrasPickerModal doc={doc} productIndex={productIndex} onCommit={commit} onClose={() => setModal(null)} />
      ) : null}
    </div>
  );
}
