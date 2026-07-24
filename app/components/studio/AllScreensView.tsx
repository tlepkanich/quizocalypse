import { useEffect, useMemo, useState } from "react";
import { DesignTokens, type Quiz, type QuizNode } from "../../lib/quizSchema";
import type { OrderedFlow } from "../../lib/flowOrder";
import type { IndexedProduct } from "../../lib/recommendationEngine";
import { DEFAULT_TOKENS } from "../../lib/designTokens";
import { linesToRadiusPx } from "../../lib/styleBar";
import {
  CURATED_FONTS,
  CURATED_FONT_CATEGORIES,
  FONT_CATEGORY_LABEL,
  isCuratedFont,
} from "../../lib/curatedFonts";
import type { BuilderCategory } from "../builder/stepProps";
import { StepPreview } from "../runtime/StepPreview";
import { nodeTitle } from "./FlowRail";

// ════════════════════════════════════════════════════════════════════════════
// BLD-1 — the "All screens" canvas + the simplified Global styles panel.
//
// AllScreensGrid renders EVERY screen of the quiz as a live card (StepPreview,
// the established thumbnail renderer — never N QuizRuntimes) with a mono type
// kicker, truncated title, ordinal, and a scaled mobile preview painted with
// the CURRENT design tokens. Clicking a card focuses that screen and flips the
// workspace back to the single-screen editor; a dashed "+ New screen" card
// reuses the workspace's add-question flow (which anchors via
// straightThroughRun's last MOVABLE step — the add-anchor rule).
//
// GlobalStylesPanel is a deliberately SIMPLIFIED subset of the Theme rail
// (BuilderDesignPanel stays the full editor): every control writes an EXISTING
// design_tokens field through the workspace commit (autosave + undo), so all
// cards update live via tokensToCssVars — no new schema fields.
//   Brand color      → colors.primary        (buttons + accents follow it)
//   Background       → colors.background
//   Heading/Body     → typography.{heading,body}.family (curated Google Fonts)
//   Button softness  → button_radius (px)
//   Answer softness  → style_bar.lines (0–100 → --qz-radius)
//   Content padding  → page_padding (all four sides → --qz-pp-*)
// ════════════════════════════════════════════════════════════════════════════

type QuizDoc = Quiz;
type Tokens = Quiz["design_tokens"];

// Short mono kicker per node type (EMAIL, not "Email gate" — the card head is
// a type stamp, not the full merchant label).
const KICKER: Record<QuizNode["type"], string> = {
  intro: "INTRO",
  question: "QUESTION",
  email_gate: "EMAIL",
  result: "RESULT",
  message: "MESSAGE",
  end: "END",
  branch: "BRANCH",
  ask_ai: "ASK AI",
  integration: "INTEGRATION",
  product_cards: "PRODUCTS",
};

/** The spine in column order + branch lanes appended (the ScreenCarousel
 *  derivation), so every screen is reachable from the grid. */
export function allScreens(doc: QuizDoc, ordered: OrderedFlow): QuizNode[] {
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const ids = ordered.steps.map((s) => s.nodeId);
  for (const lane of ordered.branches) for (const s of lane.steps) ids.push(s.nodeId);
  return ids
    .map((id) => byId.get(id))
    .filter((n): n is QuizNode => Boolean(n));
}

export function AllScreensGrid({
  doc,
  ordered,
  activeId,
  onOpenScreen,
  onAddScreen,
  productIndex,
  categories,
}: {
  doc: QuizDoc;
  ordered: OrderedFlow;
  activeId: string | null;
  /** Focus this screen and switch back to the single-screen editor. */
  onOpenScreen: (nodeId: string) => void;
  onAddScreen: () => void;
  productIndex: IndexedProduct[];
  categories: BuilderCategory[];
}) {
  const screens = useMemo(() => allScreens(doc, ordered), [doc, ordered]);
  return (
    <div className="qz-allscreens" role="list" aria-label="All screens">
      {screens.map((node, i) => (
        <div key={node.id} role="listitem" className="qz-allscreens-cell">
          <button
            type="button"
            className={`qz-allcard${node.id === activeId ? " is-active" : ""}`}
            aria-label={`Edit ${KICKER[node.type]} screen ${i + 1}: ${nodeTitle(node)}`}
            onClick={() => onOpenScreen(node.id)}
          >
            <span className="qz-allcard-head">
              <span className="qz-allcard-kicker">{KICKER[node.type]}</span>
              <span className="qz-allcard-title">{nodeTitle(node)}</span>
              <span className="qz-allcard-ord">{String(i + 1).padStart(2, "0")}</span>
            </span>
            <span className="qz-allcard-frame" aria-hidden>
              <span className="qz-allcard-scale">
                <StepPreview
                  doc={doc}
                  node={node}
                  productIndex={productIndex}
                  categories={categories}
                  breakpoint="mobile"
                  chrome="minimal"
                  className="qz-allcard-doc"
                />
              </span>
            </span>
          </button>
        </div>
      ))}
      <div role="listitem" className="qz-allscreens-cell">
        <button
          type="button"
          className="qz-allcard-add"
          onClick={onAddScreen}
          title="Add a question screen after the last step"
        >
          <span aria-hidden style={{ fontSize: 26, lineHeight: 1 }}>
            +
          </span>
          New screen
        </button>
      </div>
    </div>
  );
}

// ── Global styles panel ──────────────────────────────────────────────────────

function GroupHead({ kicker, hint }: { kicker: string; hint: string }) {
  return (
    <div className="qz-gsp-head">
      <span className="qz-gsp-kicker">{kicker}</span>
      <span className="qz-gsp-hint">{hint}</span>
    </div>
  );
}

function ColorField({
  label,
  value,
  fallback,
  onCommit,
}: {
  label: string;
  value: string | undefined;
  /** Default hex shown when the token is unset (sourced from DEFAULT_TOKENS —
   *  no raw hex literals in this file, per the check-tokens gate). */
  fallback: string;
  onCommit: (hex: string) => void;
}) {
  const [text, setText] = useState(value ?? "");
  useEffect(() => setText(value ?? ""), [value]);
  const shown = value ?? fallback;
  // Color inputs normalize to lowercase — emit lowercase to match (the
  // BuilderPageSettings #418 lesson; the builder is ClientOnly, but cheap).
  const swatch = (/^#[0-9a-fA-F]{6}$/.test(shown) ? shown : fallback).toLowerCase();
  const commitText = () => {
    const v = text.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(v) && v !== value) onCommit(v);
  };
  return (
    <div className="qz-gsp-row">
      <span className="qz-gsp-label">{label}</span>
      <input
        type="color"
        className="qz-gsp-swatch"
        aria-label={`${label} color`}
        value={swatch}
        onChange={(e) => {
          setText(e.target.value);
          onCommit(e.target.value);
        }}
      />
      <input
        type="text"
        className="qz-gsp-hex"
        aria-label={`${label} hex`}
        spellCheck={false}
        placeholder={fallback}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commitText}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitText();
          }
        }}
      />
    </div>
  );
}

function FontField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | undefined;
  onChange: (family: string) => void;
}) {
  const showCurrent = value && !isCuratedFont(value);
  return (
    <div className="qz-gsp-row">
      <span className="qz-gsp-label">{label}</span>
      <select
        className="qz-gsp-select"
        aria-label={label}
        value={value ?? "Inter"}
        onChange={(e) => onChange(e.target.value)}
      >
        {showCurrent ? <option value={value}>{value} (current)</option> : null}
        {CURATED_FONT_CATEGORIES.map((cat) => (
          <optgroup key={cat} label={FONT_CATEGORY_LABEL[cat]}>
            {CURATED_FONTS.filter((f) => f.category === cat).map((f) => (
              <option key={f.family} value={f.family}>
                {f.family}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

/** Slider + exact number, the px-value primitive for this panel (the
 *  BuilderDesignPanel range-row pattern with an editable number beside it). */
function SliderField({
  label,
  value,
  min,
  max,
  suffix,
  readout,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  /** Optional derived readout shown under the number (e.g. lines → px). */
  readout?: string;
  onChange: (v: number) => void;
}) {
  const clamp = (n: number) => Math.max(min, Math.min(max, Math.round(n)));
  return (
    <div className="qz-gsp-row">
      <span className="qz-gsp-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(clamp(Number(e.target.value)))}
      />
      <span className="qz-gsp-numwrap">
        <input
          type="number"
          className="qz-gsp-num"
          min={min}
          max={max}
          value={value}
          aria-label={`${label} exact value`}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(clamp(n));
          }}
        />
        {suffix ? <span className="qz-gsp-suffix">{suffix}</span> : null}
      </span>
      {readout ? <span className="qz-gsp-readout">{readout}</span> : null}
    </div>
  );
}

export function GlobalStylesPanel({
  doc,
  commit,
}: {
  doc: QuizDoc;
  commit: (next: QuizDoc) => void;
}) {
  const dt: Tokens = doc.design_tokens ?? {};

  // Never commit an invalid token set — an unparseable design_tokens 500s SSR
  // (the BuilderDesignPanel guard).
  const writeTokens = (next: Tokens) => {
    const parsed = DesignTokens.safeParse(next);
    if (!parsed.success) return;
    commit({ ...doc, design_tokens: parsed.data as Tokens });
  };
  const mergeTokens = (patch: Partial<Tokens>) => writeTokens({ ...dt, ...patch } as Tokens);

  const onColor = (key: "primary" | "background", hex: string) =>
    mergeTokens({ colors: { ...(dt.colors ?? {}), [key]: hex } } as Partial<Tokens>);
  const onFont = (slot: "heading" | "body", family: string) => {
    const typo = (dt.typography ?? {}) as Record<string, unknown>;
    const slotTokens = (typo[slot] ?? {}) as Record<string, unknown>;
    mergeTokens({
      typography: { ...typo, [slot]: { ...slotTokens, family, source: "google" } },
    } as Partial<Tokens>);
  };

  // Content padding: ONE value for all four sides (deliberate simplification —
  // the Theme rail's Page settings keeps the per-side cross). Reads the top
  // side as the representative value; the runtime default is 24.
  const padValue = dt.page_padding?.top ?? 24;
  const onPad = (v: number) =>
    mergeTokens({
      page_padding: { top: v, right: v, bottom: v, left: v },
    } as Partial<Tokens>);

  const answerLines = dt.style_bar?.lines ?? 50;
  const onAnswerLines = (v: number) =>
    mergeTokens({ style_bar: { ...(dt.style_bar ?? {}), lines: v } } as Partial<Tokens>);

  return (
    <div className="qz-card qz-gsp" aria-label="Global styles">
      <div className="qz-gsp-title">Global styles</div>

      <div className="qz-gsp-group">
        <GroupHead kicker="BRAND" hint="every screen follows" />
        <ColorField
          label="Brand color"
          value={dt.colors?.primary}
          fallback={DEFAULT_TOKENS.colors?.primary ?? ""}
          onCommit={(v) => onColor("primary", v)}
        />
        <ColorField
          label="Background"
          value={dt.colors?.background}
          fallback={DEFAULT_TOKENS.colors?.background ?? ""}
          onCommit={(v) => onColor("background", v)}
        />
      </div>

      <div className="qz-gsp-group">
        <GroupHead kicker="TYPE" hint="headings & body" />
        <FontField
          label="Heading font"
          value={dt.typography?.heading?.family}
          onChange={(f) => onFont("heading", f)}
        />
        <FontField
          label="Body font"
          value={dt.typography?.body?.family}
          onChange={(f) => onFont("body", f)}
        />
      </div>

      <div className="qz-gsp-group">
        <GroupHead kicker="BUTTONS" hint="all buttons · color follows Brand" />
        <SliderField
          label="Button softness"
          value={dt.button_radius ?? 10}
          min={0}
          max={48}
          suffix="px"
          onChange={(v) => mergeTokens({ button_radius: v } as Partial<Tokens>)}
        />
      </div>

      <div className="qz-gsp-group">
        <GroupHead kicker="ANSWERS" hint="answers & cards" />
        <SliderField
          label="Answer softness"
          value={answerLines}
          min={0}
          max={100}
          readout={`${linesToRadiusPx(answerLines)}px`}
          onChange={onAnswerLines}
        />
      </div>

      <div className="qz-gsp-group">
        <GroupHead kicker="SCREEN" hint="breathing room" />
        <SliderField
          label="Content padding"
          value={padValue}
          min={0}
          max={120}
          suffix="px"
          onChange={onPad}
        />
      </div>

      <p className="qz-gsp-note">
        Fine-grained controls — templates, logo, per-screen backgrounds — live in
        the Theme rail.
      </p>
    </div>
  );
}
