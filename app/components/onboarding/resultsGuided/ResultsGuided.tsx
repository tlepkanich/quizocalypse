import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Quiz, DesignTokens, RecPageGlobal } from "../../../lib/quizSchema";
import type { IndexedProduct } from "../../../lib/recommendationEngine";
import type { BuilderCollection } from "../../builder/stepProps";
import type { Placement } from "../../../lib/captureMode";
import { offerCodeDisplay, offerName, offerValue } from "../../../lib/offerCopy";
import { useQuizDraft } from "../../studio/useQuizDraft";
import { useFunnelBar, FunnelSaveChip, type FunnelBarOverride } from "../funnelChrome";
import { GuidedPreview, type PreviewScreen, type PreviewScroll } from "./GuidedPreview";
import { DiscountEditor } from "./DiscountEditor";
import { TermsModal, DescriptionsModal, ExtrasPickerModal } from "./modals";
import {
  resolveGuided,
  resolveDiscount,
  patchGuided,
  writeDiscount,
  discountExists,
  forcePerShopperCode,
  readSession,
  writeSession,
  snapLoadingMs,
  GATE_COPY,
  REVEAL_MAX_MS,
  LOADING_MIN_MS,
  LOADING_MAX_MS,
  LOADING_STEP_MS,
  WIRED,
} from "./state";

/* Results-guided handoff (docs/design/results-guided/DEV-HANDOFF.md §5–§11)
   — the Results step as a FIVE-STEP GUIDED FLOW: one question per screen, a
   phone preview beside it, and an Overview that opens the builder.
   Completion: ONE `seen` map (persisted in build_session.results_guided)
   drives the pips AND the funnel bar's gate; a step is done when the forward
   button leaves its last tab. Step 3 walks its sub-tabs (Email › Loading ›
   Consent) in both directions. The phone never changes the step. Owner rule
   (no dead ends): controls whose live reader has not landed carry a quiet
   "not connected yet" tag — see WIRED in state.ts. */

type StepId = "says" | "shows" | "keep" | "edge";
type SecId = "head" | "cards" | "gate" | "reveal" | "consent" | "fallback";

const FLOW: Array<{ g: StepId | null; title: string; secs: SecId[] }> = [
  { g: "says", title: "What does the page say?", secs: ["head"] },
  { g: "shows", title: "How do the matches look?", secs: ["cards"] },
  { g: "keep", title: "Do you want their email?", secs: ["gate", "reveal", "consent"] },
  { g: "edge", title: "Anything after the matches?", secs: ["fallback"] },
  { g: null, title: "Overview", secs: [] },
];
const OVERVIEW_IX = FLOW.length - 1;
const TAB_LABEL: Partial<Record<SecId, string>> = { gate: "Email", reveal: "Loading", consent: "Consent" };

// Referentially stable no-op for the gated bar Continue (the funnelChrome
// publish contract forbids fresh handlers per render).
const GATE_NOOP = () => {};

const GROUPS: Array<{ id: StepId; ic: string; name: string }> = [
  { id: "keep", ic: "✉", name: "Email capture & offer" },
  { id: "says", ic: "“”", name: "What it says" },
  { id: "shows", ic: "▤", name: "The matches" },
  { id: "edge", ic: "⤢", name: "Extra picks" },
];

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
const LAY_NAME: Record<string, string> = Object.fromEntries(LAYS);

const PLACEMENTS: Array<[Placement, string]> = [
  ["inline", "Email collection on the results page."],
  ["before", "Email collection before the results page."],
  ["none", "No email capture."],
];

// The card's floor: the tallest stop's natural height, measured in the
// browser at the default type scale (the Loading tab with its three default
// steps, 1440×900). The card grows past it only when Page Copy opens.
const CARD_FLOOR_PX = 488;

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
  step = 1,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  label: string;
  fmt?: (v: number) => string;
  step?: number;
}) {
  return (
    <span className="qz-s3-stepper">
      <button
        type="button"
        aria-label={`Decrease ${label}`}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - step))}
      >
        −
      </button>
      <span className="qz-s3-stepper-val">{fmt ? fmt(value) : value}</span>
      <button
        type="button"
        aria-label={`Increase ${label}`}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + step))}
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
  collections,
  designTokens,
  shopDomain,
  storeName,
  onOpenBuilder,
}: {
  quizId: string;
  initialDoc: Quiz;
  productIndex: IndexedProduct[];
  collections: BuilderCollection[];
  designTokens?: DesignTokens | null;
  /** The storefront domain policy links resolve against (handoff §9). */
  shopDomain?: string | null;
  /** The store's display name for the fixed consent wording, when known. */
  storeName?: string | null;
  /** The Overview's "Open the builder →" (the funnel's generate-build intent). */
  onOpenBuilder: () => void;
}) {
  void quizId;
  void collections;
  const { doc, commit, isSaving, savedAt, saveError, retrySave } = useQuizDraft(initialDoc);
  const cfg = resolveGuided(doc);
  const disc = resolveDiscount(doc);
  const session = readSession(doc);
  const seen = session.seen ?? {};
  const hasDiscount = discountExists(doc);
  const discountOn = doc.discount_config?.enabled === true;
  const activeDiscount = hasDiscount && discountOn;

  const [stepIx, setStepIx] = useState(0);
  const [sec, setSec] = useState<SecId>("head");
  const [focusPart, setFocusPart] = useState<string | null>(null);
  // Nonces re-trigger a ring / scroll in the phone without re-ringing on
  // every render (handoff §11).
  const [arrival, setArrival] = useState(0);
  const [touch, setTouch] = useState(0);
  const [scroll, setScroll] = useState<PreviewScroll>("region");
  const [rot, setRot] = useState({ h: 0, w: 0 });
  const [copyOpen, setCopyOpen] = useState(false);
  const [ddOpen, setDdOpen] = useState(false);
  const [modal, setModal] = useState<null | "discount" | "terms" | "descs" | "extras">(null);

  const step = FLOW[stepIx]!;
  const isOverview = step.g === null;
  const tabIx = step.secs.indexOf(sec);

  const blockers: Record<StepId, string | null> = {
    keep: cfg.where !== "none" && cfg.unlock && !activeDiscount ? "Needs a discount to unlock" : null,
    says: cfg.headline.trim() ? null : "Needs a headline",
    shows: null,
    edge: null,
  };
  const flowDone = FLOW.every((f) => (f.g === null ? seen.__ovw === true : seen[f.g] === true));

  // The preview follows the step (§11).
  const screen: PreviewScreen = isOverview
    ? "results"
    : sec === "reveal" && cfg.loadingOn
      ? "loading"
      : (sec === "gate" || sec === "consent") && cfg.where === "before"
        ? "gate"
        : "results";

  /** Mark steps/tabs seen on a given doc (never the stale closure `doc`:
   *  two commits built from one render would overwrite each other). */
  const withSeen = (base: Quiz, keys: string[]) => {
    const cur = readSession(base).seen ?? {};
    const fresh = keys.filter((k) => cur[k] !== true);
    if (fresh.length === 0) return base;
    return writeSession(base, { seen: { ...cur, ...Object.fromEntries(fresh.map((k) => [k, true])) } });
  };
  /** Every settings write: using a control on a tab turns its dot green, in
   *  the SAME commit as the change. */
  const save = (next: Quiz) => commit(step.secs.length > 1 ? withSeen(next, [`tab:${sec}`]) : next);

  // §5 arrival celebration — once per arrival on the Overview.
  const spineRef = useRef<HTMLDivElement>(null);
  const celebrated = useRef(false);
  useEffect(() => {
    if (!isOverview) {
      celebrated.current = false;
      return;
    }
    if (celebrated.current) return;
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

  /** Arrive on a step. Forward and Overview rows land on the FIRST tab;
   *  Back lands on the LAST (Back from step 4 opens Consent). */
  const gotoStep = (i: number, fromEnd = false, base: Quiz = doc) => {
    const next = Math.max(0, Math.min(OVERVIEW_IX, i));
    const f = FLOW[next]!;
    setStepIx(next);
    setSec(f.secs.length ? f.secs[fromEnd ? f.secs.length - 1 : 0]! : "head");
    setFocusPart(null);
    setCopyOpen(false);
    setDdOpen(false);
    setArrival((n) => n + 1);
    // Step 4 scrolls to the bottom (the shelf renders under the matches);
    // the Overview to the top; everything else to its own region.
    setScroll(f.g === "edge" ? "bottom" : f.g === null ? "top" : "region");
    const withOvw = f.g === null ? withSeen(base, ["__ovw"]) : base;
    if (withOvw !== doc) commit(withOvw);
  };

  const openTab = (id: SecId) => {
    setSec(id);
    setFocusPart(null);
    setCopyOpen(false);
    setArrival((n) => n + 1);
    setScroll("region");
  };

  const forward = () => {
    if (isOverview) {
      onOpenBuilder();
      return;
    }
    // Leaving a tab counts as passing it (its dot turns green).
    if (tabIx > -1 && tabIx < step.secs.length - 1) {
      const passed = withSeen(doc, [`tab:${sec}`]);
      if (passed !== doc) commit(passed);
      openTab(step.secs[tabIx + 1]!);
      return;
    }
    const done = withSeen(doc, [step.g as string, ...(step.secs.length > 1 ? [`tab:${sec}`] : [])]);
    gotoStep(stepIx + 1, false, done);
  };
  const back = () => {
    if (tabIx > 0) {
      openTab(step.secs[tabIx - 1]!);
      return;
    }
    gotoStep(stepIx - 1, true);
  };

  /** A touched control rings ONLY the element it changes (handoff §11). */
  const focusOn = (part: string, scrollMode: PreviewScroll = "region") => {
    setFocusPart(part);
    setTouch((n) => n + 1);
    setScroll(scrollMode);
  };

  // The funnel bar's "Open builder" stays disabled until every step is done;
  // once live it stays live (seen is persisted and never unset). Publish
  // contract: memoized on the one boolean; the noop is module-stable.
  const barOverride = useMemo<FunnelBarOverride>(
    () =>
      flowDone
        ? {}
        : {
            continueSpec: {
              label: "Open builder",
              onClick: GATE_NOOP,
              disabled: true,
              title: "Finish the Results steps first.",
            },
          },
    [flowDone],
  );
  useFunnelBar(barOverride);

  const patch = (p: Parameters<typeof patchGuided>[1]) => save(patchGuided(doc, p));

  // ── the card's floor (handoff §5): Back and Continue hold one height at
  //    every stop; on a short window the floor yields to the room left and
  //    the card scrolls inside itself. Measured from the card's own top. ──
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardRoom, setCardRoom] = useState(CARD_FLOOR_PX);
  useLayoutEffect(() => {
    const fit = () => {
      const card = cardRef.current;
      if (!card) return;
      // Measured from the card's OWN top edge — summing the head's height
      // misses its bottom gap (the mock's overflow bug).
      setCardRoom(Math.max(260, window.innerHeight - card.getBoundingClientRect().top - 24));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  // ── placement, unlock and the copy presets (handoff §7) ───────────────────
  const presetFor = (where: Placement, unlock: boolean) =>
    GATE_COPY[unlock && where !== "none" ? "unlock" : where];
  const copyPatch = (where: Placement, unlock: boolean): Partial<RecPageGlobal> => {
    if (session.copy_touched || where === "none") return {};
    const preset = presetFor(where, unlock);
    return { captureHeadline: preset.headline, captureSubtext: preset.copy, captureCta: preset.cta };
  };
  const setPlacement = (where: Placement) => {
    setDdOpen(false);
    // "Required" is kept as the merchant set it: it only shows (and only
    // matters) for the before-results gate.
    let next = patchGuided(doc, { where, ...copyPatch(where, cfg.unlock) });
    if (cfg.unlock && where !== "none") next = forcePerShopperCode(next);
    save(next);
    focusOn("gform");
  };
  const setUnlock = (on: boolean) => {
    let next = patchGuided(doc, {
      captureUnlocksOffer: on ? true : undefined,
      // Normalise the retired "discount" placement on this write.
      ...(cfg.where === "inline" && doc.rec_page_settings?.global?.capturePlacement === "discount"
        ? { where: "inline" as const }
        : {}),
      ...copyPatch(cfg.where, on),
    });
    if (on) next = forcePerShopperCode(next);
    if (!on) next = writeSession(next, { unlock_deferred: undefined });
    save(next);
    focusOn("offer");
  };
  const touchCopy = (p: Partial<RecPageGlobal>) =>
    save(writeSession(patchGuided(doc, p), { copy_touched: true }));

  const win = (arr: string[], off: number) =>
    [0, 1, 2].map((i) => arr[(((off + i) % arr.length) + arr.length) % arr.length]!);

  // ── step 1 — what it says ────────────────────────────────────────────────
  const suggestionRow = (arr: string[], key: "h" | "w", apply: (t: string) => void, short?: boolean) => (
    <div className="qz-rg-sugg">
      <div className="qz-rg-sl">Suggestions</div>
      <div className="qz-rg-srow">
        <button type="button" className="qz-rg-arw" aria-label="Previous suggestions" onClick={() => setRot((r) => ({ ...r, [key]: r[key] - 1 }))}>
          ‹
        </button>
        <div className="qz-rg-swin">
          {win(arr, rot[key]).map((t) => (
            <button key={t} type="button" className="qz-rg-pchip" title={t} onClick={() => apply(t)}>
              {short && t.length > 26 ? `${t.slice(0, 24)}…` : t}
            </button>
          ))}
        </div>
        <button type="button" className="qz-rg-arw" aria-label="Next suggestions" onClick={() => setRot((r) => ({ ...r, [key]: r[key] + 1 }))}>
          ›
        </button>
      </div>
    </div>
  );
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
        {suggestionRow(HS, "h", (t) => {
          patch({ headline: t });
          focusOn("hl");
        })}
      </div>
      <div className="qz-rg-fld" onFocusCapture={() => focusOn("why")}>
        <div className="qz-rg-fl">Why we recommend</div>
        <textarea
          className="qz-input"
          rows={2}
          value={cfg.whyCopy}
          aria-label="Why we recommend"
          onChange={(e) => patch({ whyCopy: e.target.value })}
        />
        {suggestionRow(WS, "w", (t) => {
          patch({ whyCopy: t });
          focusOn("why");
        }, true)}
      </div>
    </>
  );

  // ── step 2 — the matches ────────────────────────────────────────────────
  const layout = cfg.layout ?? "hero_grid";
  const cardToggle = (part: string, label: string, on: boolean, flip: () => void, extra?: ReactNode) => (
    <div key={part} className={`qz-rg-tog${on ? " is-on" : ""}`}>
      <span className="qz-rg-t">{label}</span>
      {extra}
      <Toggle
        on={on}
        label={label}
        onClick={() => {
          flip();
          // Turning something OFF rings nothing: its element is gone.
          if (!on) focusOn(part);
        }}
      />
    </div>
  );
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
      <div className="qz-rg-fl" style={{ marginTop: 14 }}>
        On each card
      </div>
      <div className="qz-rg-togs">
        {cardToggle("cart", "One-click add to cart", cfg.showAtc, () => patch({ showAtc: !cfg.showAtc }))}
        {cardToggle(
          "desc",
          "Product description",
          !!cfg.showDesc,
          () => patch({ showDesc: !cfg.showDesc }),
          cfg.showDesc ? (
            <button type="button" className="qz-rg-gear" title="Edit the descriptions" onClick={() => setModal("descs")}>
              ✎
            </button>
          ) : null,
        )}
        {cardToggle("addall", "“Add all to cart” button", !!cfg.showAddAll, () => patch({ showAddAll: !cfg.showAddAll }))}
      </div>
    </>
  );

  // ── step 3 · Email — placement, the discount, the unlock, Page Copy ──────
  const codeSource =
    disc.code_mode === "static" ? "one shared code" : disc.code_mode === "existing" ? "an existing discount" : "a new code per shopper";
  const needsDiscount = cfg.where !== "none" && cfg.unlock && !activeDiscount;
  const discountBlock = (
    <div className="qz-rg-offerblk" data-part="offer">
      <div className="qz-rg-fl">
        Discount <Unwired k="discount" />
      </div>
      {hasDiscount ? (
        <div className={`qz-rg-coupon${discountOn ? " is-on" : ""}${needsDiscount && !discountOn ? " is-need" : ""}`}>
          <span className="qz-rg-ct">
            <b>{offerName(disc)}</b>
            <span>
              <code>{offerCodeDisplay(disc)}</code> · {codeSource}
            </span>
          </span>
          <button type="button" className="qz-rg-cedit" onClick={() => setModal("discount")}>
            Edit
          </button>
          <Toggle
            on={discountOn}
            label="Discount on"
            onClick={() => {
              save(writeDiscount(doc, { enabled: !discountOn }));
              if (!discountOn) focusOn("offer");
            }}
          />
        </div>
      ) : (
        <button
          type="button"
          className={`qz-rg-addbtn${needsDiscount ? " is-need" : ""}`}
          onClick={() => setModal("discount")}
        >
          ＋ Create a discount
        </button>
      )}
      {cfg.where !== "none" ? (
        <>
          <div className="qz-rg-inline">
            <span className="qz-rg-t">
              Require the email to unlock it <Unwired k="unlock" />
            </span>
            <Toggle on={cfg.unlock} label="Require the email to unlock it" onClick={() => setUnlock(!cfg.unlock)} />
          </div>
          {needsDiscount ? (
            session.unlock_deferred ? (
              <div className="qz-rg-dnote">
                {hasDiscount
                  ? "Your discount is off. The unlock card won’t show until you turn it on."
                  : "No discount yet. The unlock card won’t show until you create one."}
              </div>
            ) : (
              <button
                type="button"
                className="qz-rg-later"
                onClick={() => save(writeSession(doc, { unlock_deferred: true }))}
              >
                Set up later
              </button>
            )
          ) : null}
        </>
      ) : null}
    </div>
  );
  const pageCopy = (
    <div className={`qz-rg-disc${copyOpen ? " is-open" : ""}`} data-part="gcopy">
      <button
        type="button"
        className="qz-rg-dischead"
        aria-expanded={copyOpen}
        onClick={() => {
          const opening = !copyOpen;
          setCopyOpen(opening);
          // Opening pulls the whole section to the top of the card, so all
          // four fields are on screen at once.
          if (opening) {
            window.requestAnimationFrame(() => {
              const card = cardRef.current;
              const head = card?.querySelector<HTMLElement>(".qz-rg-disc");
              if (card && head) card.scrollTo({ top: head.offsetTop - 12, behavior: "smooth" });
            });
          }
        }}
      >
        <span className="qz-rg-dt">
          <b>Page Copy</b>
        </span>
        <span aria-hidden>▾</span>
      </button>
      {copyOpen ? (
        <div className="qz-rg-discbody" onFocusCapture={() => focusOn("gcopy")}>
          <div className="qz-rg-fld">
            <div className="qz-rg-fl">Headline</div>
            <input
              className="qz-input"
              value={cfg.captureHeadline || ""}
              aria-label="Capture headline"
              onChange={(e) => touchCopy({ captureHeadline: e.target.value })}
            />
          </div>
          <div className="qz-rg-fld">
            <div className="qz-rg-fl">Supporting line</div>
            <textarea
              className="qz-input"
              rows={2}
              value={cfg.captureSubtext || ""}
              aria-label="Capture supporting line"
              onChange={(e) => touchCopy({ captureSubtext: e.target.value })}
            />
          </div>
          <div className="qz-rg-fld">
            <div className="qz-rg-fl">Button</div>
            <input
              className="qz-input"
              value={cfg.captureCta}
              aria-label="Capture button label"
              onChange={(e) => touchCopy({ captureCta: e.target.value })}
            />
          </div>
          {cfg.where === "before" && !cfg.captureRequired ? (
            <div className="qz-rg-fld" onFocusCapture={() => focusOn("gskip")}>
              <div className="qz-rg-fl">Skip link</div>
              <input
                className="qz-input"
                value={cfg.captureSkipLabel}
                aria-label="Skip link label"
                onChange={(e) => patch({ captureSkipLabel: e.target.value })}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
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
          <span>{PLACEMENTS.find(([w]) => w === cfg.where)?.[1]}</span>
          <span aria-hidden>▾</span>
        </button>
        {ddOpen ? (
          <div className="qz-rg-ddmenu" role="listbox">
            {PLACEMENTS.map(([w, label]) => (
              <button
                key={w}
                type="button"
                role="option"
                aria-selected={cfg.where === w}
                className={`qz-rg-ddopt${cfg.where === w ? " is-on" : ""}`}
                onClick={() => setPlacement(w)}
              >
                {label}
                {w === "before" ? <em className="qz-rg-besttag">Best</em> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {discountBlock}
      {cfg.where !== "none" ? (
        <div className="qz-rg-nested">
          {cfg.where === "before" ? (
            <div className="qz-rg-inline">
              <span className="qz-rg-t">Required to see results</span>
              <Toggle
                on={!!cfg.captureRequired}
                label="Required to see results"
                onClick={() => {
                  patch({ captureRequired: !cfg.captureRequired });
                  focusOn(cfg.captureRequired ? "gskip" : "gform");
                }}
              />
            </div>
          ) : null}
          {pageCopy}
        </div>
      ) : null}
    </>
  );

  // ── step 3 · Loading ──────────────────────────────────────────────────────
  const stepsListRef = useRef<HTMLDivElement>(null);
  const focusNewStep = useRef(false);
  useEffect(() => {
    if (!focusNewStep.current) return;
    focusNewStep.current = false;
    const inputs = stepsListRef.current?.querySelectorAll("input");
    inputs?.[inputs.length - 1]?.focus();
  });
  const loadingMs = cfg.loadingMs ?? 2000;
  const loadingBody = !cfg.loadingOn ? (
    <div className="qz-rg-dnote">The loading screen is off. Turn it on in the Questions step.</div>
  ) : (
    <>
      <div className="qz-rg-note">
        <b>Best practice:</b> a short 2–3 second “working on it” screen.
      </div>
      <div className="qz-rg-inline">
        <span className="qz-rg-t">Duration</span>
        <Stepper
          value={loadingMs}
          min={LOADING_MIN_MS}
          max={LOADING_MAX_MS}
          step={LOADING_STEP_MS}
          label="loading duration"
          fmt={(v) => `${(v / 1000).toFixed(1)}s`}
          // An absent value reads 1.6 s; the first change snaps onto the grid.
          onChange={(v) => patch({ loadingMs: snapLoadingMs(v) })}
        />
      </div>
      {loadingMs > REVEAL_MAX_MS ? (
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
        <div className="qz-rg-fld" ref={stepsListRef}>
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
            onClick={() => {
              focusNewStep.current = true;
              patch({ loadingSteps: [...cfg.loadingSteps, ""] });
            }}
          >
            ＋ Add a step
          </button>
        </div>
      ) : null}
    </>
  );

  // ── step 3 · Consent — four rows, fixed wording (handoff §9) ─────────────
  const termsIsBox = cfg.captureTermsMode === "checkbox";
  const consentBody =
    cfg.where === "none" ? (
      <div className="qz-rg-dnote">No email is collected, so there’s no form to add these to.</div>
    ) : (
      <>
        <div className="qz-rg-inline qz-rg-ringrow" data-part="mkt">
          <span className="qz-rg-t">Email marketing consent</span>
          <Toggle
            on={!!cfg.consentOn}
            label="Email marketing consent"
            onClick={() => {
              patch({ consentOn: !cfg.consentOn });
              if (!cfg.consentOn) focusOn("mkt");
            }}
          />
        </div>
        {cfg.consentOn ? (
          <div className="qz-rg-fld qz-rg-mktedit" onFocusCapture={() => focusOn("mkt")}>
            <input
              className="qz-input"
              value={cfg.consentCopy}
              maxLength={120}
              placeholder="Email me news and offers."
              aria-label="Marketing checkbox text"
              onChange={(e) => patch({ consentCopy: e.target.value })}
            />
            {!cfg.consentCopy.trim() ? (
              <div className="qz-rg-cap">Write the checkbox text — until then shoppers see the default.</div>
            ) : null}
          </div>
        ) : null}
        <div className="qz-rg-inline qz-rg-ringrow">
          <span className="qz-rg-t">Terms and conditions checkbox</span>
          <Toggle
            on={termsIsBox}
            label="Terms and conditions checkbox"
            onClick={() => {
              patch({ captureTermsMode: termsIsBox ? "notice" : "checkbox" });
              focusOn("terms");
            }}
          />
        </div>
        <div className="qz-rg-inline qz-rg-ringrow">
          <span className="qz-rg-t">Email terms of service</span>
          <button
            type="button"
            className="qz-rg-bt"
            onClick={() => {
              focusOn("terms");
              setModal("terms");
            }}
          >
            Edit →
          </button>
        </div>
        <div className="qz-rg-inline qz-rg-ringrow">
          <span className="qz-rg-t">SMS collection</span>
          <Toggle
            on={!!cfg.capturePhone}
            label="SMS collection"
            onClick={() => {
              patch({ capturePhone: cfg.capturePhone ? undefined : true });
              if (!cfg.capturePhone) focusOn("sms");
            }}
          />
        </div>
        {cfg.capturePhone ? (
          <div className="qz-rg-dnote">
            Integrations are set up later. Until one is connected, the phone field stays off your live quiz.
          </div>
        ) : null}
      </>
    );

  // ── step 4 — extra picks ──────────────────────────────────────────────────
  const picks = cfg.extrasOn ? cfg.extrasProductIds.length : 0;
  const edgeBody = (
    <>
      <div className="qz-rg-inline">
        <span className="qz-rg-t">Show these products if no results</span>
        <Toggle
          on={cfg.fallbackOn !== false}
          label="Show these products if no results"
          // The live quiz reads `fallbackOn !== false`: store false, clear true.
          onClick={() => patch({ fallbackOn: cfg.fallbackOn !== false ? false : undefined })}
        />
      </div>
      <button type="button" className="qz-rg-inline qz-rg-rowbtn" onClick={() => setModal("extras")}>
        <span className="qz-rg-t">Show these products after all results</span>
        <span className="qz-rg-rowval">
          {picks ? `${picks} product${picks === 1 ? "" : "s"}` : "Choose"} ›
        </span>
      </button>
      <div className="qz-rg-fld" onFocusCapture={() => focusOn("xhead", "bottom")}>
        <div className="qz-rg-fl">Heading</div>
        <input
          className="qz-input"
          value={cfg.extrasHeading}
          aria-label="Extra picks heading"
          onChange={(e) => patch({ extrasHeading: e.target.value })}
        />
      </div>
      <div className="qz-rg-fld" onFocusCapture={() => focusOn("xhead", "bottom")}>
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
        <Stepper
          value={cfg.extrasCount}
          min={1}
          max={6}
          label="extra picks count"
          onChange={(v) => {
            patch({ extrasCount: v });
            focusOn("xprods", "bottom");
          }}
        />
      </div>
    </>
  );

  // ── Overview — the read-back rows ─────────────────────────────────────────
  const loadingSecs = `${(loadingMs / 1000).toFixed(1)}s`;
  const summary: Record<StepId, () => string> = {
    says: () => `“${cfg.headline}”`,
    shows: () => {
      const on = [cfg.showAtc && "cart", cfg.showDesc && "description"].filter(Boolean).join(", ");
      return `${LAY_NAME[layout]}${on ? ` · ${on}` : ""}`;
    },
    keep: () => {
      const load = cfg.loadingOn ? ` · ${loadingSecs}` : "";
      if (cfg.where === "none") return `No email asked${load}`;
      const w = cfg.where === "before" ? "Before results" : "On the page";
      const offer = activeDiscount ? ` · ${offerValue(disc)}${cfg.unlock ? " (unlocks)" : ""}` : "";
      return `${w} · ${cfg.capturePhone ? "Email + SMS" : "Email"}${load}${offer}`;
    },
    edge: () => {
      const parts = [
        picks ? `After all results · ${Math.min(cfg.extrasCount, picks)} shown` : null,
        cfg.fallbackOn !== false ? "If no results" : null,
      ].filter(Boolean);
      return parts.length ? parts.join(" · ") : "Off";
    },
  };
  const split = cfg.where === "before";
  const overviewRow = (g: (typeof GROUPS)[number]) => {
    const gs = blockers[g.id] ? "todo" : seen[g.id] ? "done" : "new";
    return (
      <button
        key={g.id}
        type="button"
        className={`qz-rg-drow is-${gs}`}
        onClick={() => gotoStep(FLOW.findIndex((f) => f.g === g.id))}
      >
        <span className="qz-rg-dic" aria-hidden>
          {g.ic}
          <i className="qz-rg-dbadge">{gs === "done" ? "✓" : gs === "todo" ? "!" : ""}</i>
        </span>
        <span className="qz-rg-dtx">
          <b>{g.name}</b>
          <span className="qz-rg-dsum">{gs === "todo" ? blockers[g.id] : summary[g.id]()}</span>
        </span>
        <span className="qz-rg-darr" aria-hidden>
          ›
        </span>
      </button>
    );
  };
  const overviewBody = (
    <div className="qz-rg-ovw">
      {split ? (
        <>
          <div>
            <div className="qz-rg-bandlbl">Before the results</div>
            {overviewRow(GROUPS[0]!)}
          </div>
          <div>
            <div className="qz-rg-bandlbl">The results page</div>
            {GROUPS.slice(1).map(overviewRow)}
          </div>
        </>
      ) : (
        GROUPS.map(overviewRow)
      )}
    </div>
  );

  // step 3 — the sub-tabs, walked by the forward and back buttons
  const keepTabs = (
    <div className="qz-rg-stabs" role="tablist" aria-label="Email capture sections">
      {FLOW[2]!.secs.map((id) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={sec === id}
          className={`qz-rg-stab${sec === id ? " is-on" : ""}${seen[`tab:${id}`] ? " is-done" : ""}`}
          onClick={() => openTab(id)}
        >
          <i aria-hidden />
          {TAB_LABEL[id]}
        </button>
      ))}
    </div>
  );

  let body: ReactNode = null;
  if (isOverview) body = overviewBody;
  else if (step.g === "says") body = saysBody;
  else if (step.g === "shows") body = showsBody;
  else if (step.g === "keep")
    body = (
      <>
        {keepTabs}
        {sec === "gate" ? gateBody : sec === "reveal" ? loadingBody : consentBody}
      </>
    );
  else body = edgeBody;

  // The phone: a region THIS step owns opens its tab; nothing changes the step.
  const liveSecs: string[] = isOverview ? [] : step.secs;

  return (
    <div className="qz-rg">
      <div className="qz-rg-split">
        <div className="qz-rg-stepcol">
          <div className="qz-rg-stepwrap">
            {/* Height says here, colour says done; no amber. */}
            <div className="qz-rg-spine" ref={spineRef}>
              {FLOW.map((f, i) => {
                const done = f.g === null ? !!seen.__ovw : !!seen[f.g];
                const here = i === stepIx;
                return (
                  <i
                    key={i}
                    title={here ? "You are here" : done ? "Done" : "Not reached yet"}
                    style={{ animationDelay: `${i * 90}ms` }}
                    className={`${done ? "is-done " : ""}${here ? "is-now" : ""}`}
                  />
                );
              })}
            </div>
            <div className="qz-rg-stepno">
              Step {stepIx + 1} of {FLOW.length}
            </div>
            <h2 className="qz-rg-title">{step.title}</h2>
          </div>
          <div
            className="qz-rg-card"
            ref={cardRef}
            style={
              cardRoom < CARD_FLOOR_PX
                ? { minHeight: cardRoom, maxHeight: cardRoom, overflowY: "auto" }
                : { minHeight: CARD_FLOOR_PX }
            }
          >
            <div className="qz-rg-panel">{body}</div>
            <div className="qz-rg-stepfoot">
              {/* No Back on the very first stop: absent, not disabled. The back
                  control is the bare ‹ chevron (owner 2026-08-18). */}
              {stepIx > 0 || tabIx > 0 ? (
                <button type="button" className="qz-rg-btn2 is-backico" title="Back" aria-label="Back" onClick={back}>
                  ‹
                </button>
              ) : null}
              <FunnelSaveChip isSaving={isSaving} savedAt={savedAt} saveError={saveError} onRetry={retrySave} />
              <span className="qz-rg-fsp" />
              <button type="button" className="qz-rg-btn2 is-pri" onClick={forward}>
                {isOverview ? "Open the builder →" : "Continue"}
              </button>
            </div>
          </div>
        </div>
        <GuidedPreview
          doc={doc}
          productIndex={productIndex}
          designTokens={designTokens ?? undefined}
          screen={screen}
          sec={isOverview ? null : sec}
          focusPart={focusPart}
          arrival={arrival}
          touch={touch}
          scroll={scroll}
          liveSecs={liveSecs}
          onOpenSec={(id) => {
            if (liveSecs.includes(id)) openTab(id as SecId);
          }}
          shopDomain={shopDomain ?? undefined}
          storeName={storeName ?? undefined}
        />
      </div>

      {modal === "discount" ? (
        <DiscountEditor
          doc={doc}
          lockedToDynamic={cfg.unlock && cfg.where !== "none"}
          onCommit={(next) => save(writeSession(next, { unlock_deferred: undefined }))}
          onClose={() => setModal(null)}
        />
      ) : null}
      {modal === "terms" ? (
        <TermsModal
          doc={doc}
          shopDomain={shopDomain ?? undefined}
          storeName={storeName ?? undefined}
          onCommit={save}
          onClose={() => setModal(null)}
        />
      ) : null}
      {modal === "descs" ? (
        <DescriptionsModal doc={doc} productIndex={productIndex} onCommit={save} onClose={() => setModal(null)} />
      ) : null}
      {modal === "extras" ? (
        <ExtrasPickerModal
          doc={doc}
          productIndex={productIndex}
          onCommit={(next) => {
            save(next);
            focusOn("xprods", "bottom");
          }}
          onClose={() => setModal(null)}
        />
      ) : null}
    </div>
  );
}

