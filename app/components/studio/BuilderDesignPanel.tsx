import { useState } from "react";
import { DesignTokens, type Quiz } from "../../lib/quizSchema";
import { DEFAULT_TOKENS } from "../../lib/designTokens";
import {
  isAllowedLogoType,
  isSafeLogoUrl,
  MAX_LOGO_BYTES,
  LOGO_SIZES,
  LOGO_ALIGNS,
} from "../../lib/logoUpload";
import type { VibeTemplate } from "../../lib/vibeTemplates";
import { BrandIdentityPanel } from "./BrandIdentityPanel";
import { VibeTemplateSelector } from "./VibeTemplateSelector";
import { StyleBar } from "./StyleBar";
import { BuilderThemePanel } from "./BuilderThemePanel";

// D6b — builder parity for the Design Settings spec (the funnel's grown Design
// panel, now in the main builder's Theme tool). The SAME five funnel panels —
// Brand Identity · Vibe templates · Style bar · Shape/Buttons · Per-quiz
// formatting — are reused UNCHANGED; only the persistence seam differs. The funnel
// POSTs fetcher intents; every one of those intents is a pure design_tokens
// transform, so the builder re-expresses each as commit({...doc, design_tokens:
// next}) through useQuizDraft's whole-doc autosave (the BuilderThemePanel /
// BuilderPageSettings pattern). The Quiz↔Rec link + scope route edits to
// design_tokens or rec_page_design exactly like the funnel DesignStage; the
// Quiz/Rec preview toggle reuses D5's runtime swap by selecting a result node
// (which already renders rec_page_design when de-linked).

type Tokens = Quiz["design_tokens"];

// A small labeled segmented control (mirrors the funnel's FineTuneRow; kept local
// so this panel does not import from the funnel route file).
function Row({
  label,
  options,
  active,
  onPick,
}: {
  label: string;
  options: [string, string][];
  active: string | undefined;
  onPick: (v: string) => void;
}) {
  return (
    <div className="qz-row qz-gap-8" style={{ alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ fontSize: 13, width: 84, flexShrink: 0 }}>{label}</span>
      <div className="qz-row qz-gap-4" style={{ flexWrap: "wrap" }}>
        {options.map(([v, lbl]) => {
          const on = active === v;
          return (
            <button
              key={v}
              type="button"
              onClick={() => onPick(v)}
              style={{
                font: "inherit",
                fontSize: 12,
                padding: "5px 10px",
                border: "1px solid var(--qz-rule)",
                borderRadius: 6,
                background: on ? "var(--qz-ink-1, #111111)" : "var(--qz-paper)",
                color: on ? "#FFFFFF" : "inherit",
                cursor: "pointer",
              }}
            >
              {lbl}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function BuilderDesignPanel({
  doc,
  commit,
  onSelectNode,
}: {
  doc: Quiz;
  commit: (doc: Quiz) => void;
  onSelectNode?: (nodeId: string) => void;
}) {
  const linked = doc.design_linked !== false;
  const [scope, setScope] = useState<"quiz" | "rec_page">("quiz");
  const recScope = !linked && scope === "rec_page";
  // The scoped token set being edited (rec page when de-linked + rec scope, else quiz).
  const base: Tokens = recScope ? (doc.rec_page_design ?? doc.design_tokens) : doc.design_tokens;

  // Validate + write the scoped token set, mirroring the server's designScopeTarget.
  // Never commit an invalid token set — an unparseable design_tokens 500s SSR.
  const writeTokens = (next: Tokens) => {
    const parsed = DesignTokens.safeParse(next);
    if (!parsed.success) return;
    const data = parsed.data as Tokens;
    commit(recScope ? { ...doc, rec_page_design: data } : { ...doc, design_tokens: data });
  };
  const mergeTokens = (patch: Partial<Tokens>) => writeTokens({ ...base, ...patch } as Tokens);

  // §1 Brand Identity — colors + fonts (set-design-color / set-design-font; the
  // font slot stamps source:"google" to match funnel-authored docs).
  const onColor = (key: "primary" | "background" | "text" | "accent", hex: string) =>
    mergeTokens({ colors: { ...(base.colors ?? {}), [key]: hex } } as Partial<Tokens>);
  const onFont = (slot: "heading" | "body", family: string) => {
    const typo = (base.typography ?? {}) as Record<string, unknown>;
    const slotTokens = (typo[slot] ?? {}) as Record<string, unknown>;
    mergeTokens({
      typography: { ...typo, [slot]: { ...slotTokens, family, source: "google" } },
    } as Partial<Tokens>);
  };

  // §1 Logo — client-side base64 (the builder autosaves JSON; no multipart route).
  // Same validators the funnel intent uses (logoUpload.ts), applied before reading.
  const currentLogo = (base.logo ?? {}) as { url?: string; size?: string; align?: string };
  const onLogoFile = (file: File) => {
    if (!isAllowedLogoType(file.type)) {
      window.alert("Use a PNG, JPG, SVG, WEBP or GIF image.");
      return;
    }
    if (file.size === 0 || file.size > MAX_LOGO_BYTES) {
      window.alert("Logo must be 1 byte–2 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = typeof reader.result === "string" ? reader.result : "";
      if (!url || !isSafeLogoUrl(url)) return;
      mergeTokens({
        logo: { url, size: currentLogo.size ?? "md", align: currentLogo.align ?? "center" },
      } as Partial<Tokens>);
    };
    reader.readAsDataURL(file);
  };
  const onLogoUrl = (url: string) => {
    if (!isSafeLogoUrl(url)) {
      window.alert("Logo URL must be an https or data:image link.");
      return;
    }
    mergeTokens({
      logo: { url, size: currentLogo.size ?? "md", align: currentLogo.align ?? "center" },
    } as Partial<Tokens>);
  };
  const onLogoMeta = (field: "size" | "align", value: string) => {
    if (field === "size" && !(LOGO_SIZES as readonly string[]).includes(value)) return;
    if (field === "align" && !(LOGO_ALIGNS as readonly string[]).includes(value)) return;
    if (!currentLogo.url) return;
    mergeTokens({ logo: { ...currentLogo, [field]: value } } as Partial<Tokens>);
  };
  const onLogoClear = () => {
    const { logo: _drop, ...rest } = base;
    writeTokens(rest as Tokens);
  };

  // §1 Reset to defaults (pure client). Re-sync is funnel-only — the builder loader
  // carries no shop.brandTokens, so Re-sync is hidden (showResync={false}).
  const onReset = () => writeTokens(JSON.parse(JSON.stringify(DEFAULT_TOKENS)) as Tokens);

  // §2 Template (wholesale) · §3 shape/buttons + style bar · §4 formatting.
  const onApplyTemplate = (t: VibeTemplate) => writeTokens(t.tokens as Tokens);
  const onField = (field: "radius" | "button_style", value: string) =>
    mergeTokens({ [field]: value } as Partial<Tokens>);
  const onStyleBar = (sb: { image_density?: number; lines?: number; spacing?: number }) =>
    mergeTokens({ style_bar: { ...(base.style_bar ?? {}), ...sb } } as Partial<Tokens>);
  const progress = base.progress_bar;
  const onProgress = (p: Record<string, unknown>) =>
    mergeTokens({ progress_bar: { ...(progress ?? {}), ...p } } as Partial<Tokens>);

  // §5 link / scope — de-link seeds rec_page_design; re-link drops it (mirror server).
  const setLinked = (next: boolean) => {
    if (next) {
      if (!window.confirm("Reset the recommendation page’s design back to the quiz design?")) return;
      const { rec_page_design: _drop, ...rest } = doc;
      setScope("quiz");
      commit({ ...rest, design_linked: true } as Quiz);
    } else {
      commit({
        ...doc,
        design_linked: false,
        rec_page_design: doc.rec_page_design ?? doc.design_tokens,
      });
    }
  };

  // Preview toggle: flipping to "rec_page" selects the first result/end node so the
  // canvas (Editor-rail focusNodeId → full Step5Preview → QuizRuntime) renders
  // rec_page_design via D5's de-linked swap; "quiz" selects a question. (Drives the
  // focusNodeId path, NOT the simplified Results FramedPreview.)
  const firstResultNode = doc.nodes.find((n) => n.type === "result" || n.type === "end");
  const firstQuestion = doc.nodes.find((n) => n.type === "question");
  const pickScope = (next: "quiz" | "rec_page") => {
    setScope(next);
    if (next === "rec_page" && firstResultNode) onSelectNode?.(firstResultNode.id);
    else if (next === "quiz" && firstQuestion) onSelectNode?.(firstQuestion.id);
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* §5 — link the rec page's design to the quiz, or de-link for its own design. */}
      <div className="qz-col qz-gap-8">
        <label
          className="qz-row qz-gap-4"
          style={{ alignItems: "center", cursor: "pointer", fontSize: 13 }}
        >
          <input type="checkbox" checked={linked} onChange={(e) => setLinked(e.target.checked)} />
          Link the recommendation page’s design to the quiz
        </label>
        {!linked ? (
          <Row
            label="Editing"
            options={[["quiz", "Quiz"], ["rec_page", "Rec page"]]}
            active={scope}
            onPick={(v) => pickScope(v as "quiz" | "rec_page")}
          />
        ) : null}
        {recScope ? (
          <p className="qz-dim" style={{ margin: 0, fontSize: 12 }}>
            Editing the recommendation page’s design — every control below applies to the rec page
            until you re-link. Switch the canvas with the Quiz/Rec toggle above.
          </p>
        ) : null}
      </div>

      <BrandIdentityPanel
        tokens={base}
        onColor={onColor}
        onFont={onFont}
        onLogoFile={onLogoFile}
        onLogoUrl={onLogoUrl}
        onLogoMeta={onLogoMeta}
        onLogoClear={onLogoClear}
        onReset={onReset}
        onResync={() => {}}
        showResync={false}
      />

      <div className="qz-label" style={{ marginTop: 2 }}>Template</div>
      <VibeTemplateSelector currentTokens={base} onApply={onApplyTemplate} />

      <div className="qz-col qz-gap-8">
        <Row
          label="Shape"
          options={[["square", "Square"], ["rounded", "Rounded"], ["pill", "Pill"]]}
          active={base.radius}
          onPick={(v) => onField("radius", v)}
        />
        <Row
          label="Buttons"
          options={[["filled", "Filled"], ["outline", "Outline"], ["ghost", "Ghost"]]}
          active={base.button_style}
          onPick={(v) => onField("button_style", v)}
        />
      </div>

      <div className="qz-col qz-gap-8">
        <div className="qz-label">Style bar</div>
        <StyleBar value={base.style_bar} onCommit={onStyleBar} />
      </div>

      <div className="qz-col qz-gap-8">
        <div className="qz-label">Formatting</div>
        <Row
          label="Answers"
          options={[["auto", "Auto"], ["list", "List"], ["grid", "Grid"]]}
          active={base.answer_layout ?? "auto"}
          onPick={(v) => mergeTokens({ answer_layout: v } as Partial<Tokens>)}
        />
        {base.answer_layout === "grid" ? (
          <Row
            label="Columns"
            options={[["2", "2"], ["3", "3"]]}
            active={String(base.answer_grid_columns ?? 2)}
            onPick={(v) => mergeTokens({ answer_grid_columns: Number(v) } as Partial<Tokens>)}
          />
        ) : null}
        <Row
          label="Progress"
          options={[["on", "On"], ["off", "Off"]]}
          active={progress?.enabled === false ? "off" : "on"}
          onPick={(v) => onProgress({ enabled: v === "on" })}
        />
        {progress?.enabled !== false ? (
          <>
            <Row
              label="Style"
              options={[["bar", "Bar"], ["dots", "Dots"], ["steps", "Steps"]]}
              active={progress?.style ?? "bar"}
              onPick={(v) => onProgress({ style: v })}
            />
            <Row
              label="At"
              options={[["top", "Top"], ["bottom", "Bottom"]]}
              active={progress?.position ?? "top"}
              onPick={(v) => onProgress({ position: v })}
            />
          </>
        ) : null}
        <Row
          label="Image"
          options={[["top", "Top"], ["side", "Side"], ["none", "None"]]}
          active={base.question_image_position ?? "top"}
          onPick={(v) => mergeTokens({ question_image_position: v } as Partial<Tokens>)}
        />
      </div>

      {/* The legacy preset gallery + layout variants (quiz-scoped, not scope-aware),
          kept below for no-regression. Hidden while editing the rec page to avoid a
          control here silently writing the QUIZ design. */}
      {!recScope ? (
        <div style={{ borderTop: "1px solid var(--qz-rule)", paddingTop: 12 }}>
          <BuilderThemePanel doc={doc} commit={commit} />
        </div>
      ) : null}
    </div>
  );
}
