import type { Quiz, QuizNode } from "../../../lib/quizSchema";
import type { AnswerDisplay, AnswerDisplayMode } from "../../../lib/answerDisplay";
import { resolveDesignTokens } from "../../../lib/designTokens";
import { updateNodeData } from "../studioDoc";
import { NumericControl } from "../../controls/NumericControl";

// The color <input> needs a concrete value while a knob is unset — use the
// theme's default background (no raw hex literal; the check-tokens ratchet).
const SWATCH_FALLBACK = resolveDesignTokens().colors?.background ?? "";

// ════════════════════════════════════════════════════════════════════════════
// AnswerDisplaySection (QZY-9, build-tab §5/§5.2) — the question-level layout
// picker + option styling. Presets before numbers (§10): mode picker + shape
// presets up top, per-mode essentials next, the long tail under More options.
// Mode switching is LOSSLESS by construction: only answer_display.mode is
// rewritten — media, labels, and mappings live on the answers.
// ════════════════════════════════════════════════════════════════════════════

type QuizDoc = Quiz;
type QuestionNode = Extract<QuizNode, { type: "question" }>;

// R5b §3.1 — four STRUCTURAL layout modes (Icon is retired as a mode; media is
// now the independent "Show icon/image" toggle below). Legacy mode:"icon" docs
// still render — the runtime keeps that case.
const MODES: Array<{ id: AnswerDisplayMode | "default"; label: string }> = [
  { id: "default", label: "Text list" },
  { id: "cards", label: "Image cards" },
  { id: "tiles", label: "Large tiles" },
  { id: "pills", label: "Compact pills" },
];

const CARD_FAMILY = new Set(["single_select", "multi_select", "image_tile"]);

export function AnswerDisplaySection({
  doc,
  node,
  onCommit,
}: {
  doc: QuizDoc;
  node: QuestionNode;
  onCommit: (doc: QuizDoc) => void;
}) {
  if (!CARD_FAMILY.has(node.data.question_type)) return null;
  const d: AnswerDisplay = node.data.answer_display ?? {};
  // Sparse writes — undefined drops a key; an emptied object drops the field.
  const patch = (p: Partial<AnswerDisplay>) => {
    const next: Record<string, unknown> = { ...d };
    for (const [k, v] of Object.entries(p)) {
      if (v === undefined) delete next[k];
      else next[k] = v;
    }
    onCommit(
      updateNodeData(doc, node.id, {
        answer_display: Object.keys(next).length ? next : undefined,
      }),
    );
  };
  const activeMode = d.mode ?? "default";
  const colorInput = (
    label: string,
    value: string | undefined,
    key: keyof AnswerDisplay,
  ) => (
    <label className="qz-ads-color">
      <span>{label}</span>
      <input
        type="color"
        value={value ?? SWATCH_FALLBACK}
        onChange={(e) => patch({ [key]: e.target.value } as Partial<AnswerDisplay>)}
      />
      <button
        type="button"
        className="qz-btn qz-btn-ghost qz-btn-sm"
        disabled={value === undefined}
        onClick={() => patch({ [key]: undefined } as Partial<AnswerDisplay>)}
        title="Clear (theme default)"
      >
        ✕
      </button>
    </label>
  );

  return (
    <div className="qz-ads" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="qz-label" style={{ fontSize: 11 }}>
        Answer display
      </div>
      <div className="qz-ads-modes" role="radiogroup" aria-label="Answer display mode">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={activeMode === m.id}
            className={activeMode === m.id ? "is-active" : ""}
            onClick={() => patch({ mode: m.id === "default" ? undefined : m.id })}
          >
            {m.label}
          </button>
        ))}
      </div>
      {activeMode !== "default" ? (
        <>
          {/* §3.1 — ONE corner-radius control: the chips SNAP the value, the
              scrubber fine-tunes. Pill = the fully-round preset; Rounded/Square
              and the scrubber write an explicit radius. They never disagree —
              each write clears the other (legacy `shape` still resolves via
              displayRadius, so the runtime is unchanged). */}
          <div className="qz-row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span className="qz-dim" style={{ fontSize: 11.5 }}>
              Corner radius
            </span>
            <div className="qz-segmented" role="group" aria-label="Corner radius preset">
              <button
                type="button"
                aria-pressed={d.shape === "pill"}
                onClick={() => patch({ shape: "pill", radius: undefined })}
              >
                Pill
              </button>
              <button
                type="button"
                aria-pressed={d.shape === "rounded" || (!d.shape && d.radius === 12)}
                onClick={() => patch({ shape: undefined, radius: 12 })}
              >
                Rounded
              </button>
              <button
                type="button"
                aria-pressed={d.shape === "square" || (!d.shape && d.radius === 0)}
                onClick={() => patch({ shape: undefined, radius: 0 })}
              >
                Square
              </button>
            </div>
            <NumericControl
              label="Radius"
              value={d.shape === "pill" ? undefined : d.radius}
              min={0}
              max={40}
              fallback={12}
              allowEmpty
              suffix="px"
              onChange={(n) => patch({ radius: n, shape: undefined })}
            />
          </div>
          {activeMode === "cards" || activeMode === "tiles" ? (
            <NumericControl
              label="Columns"
              value={d.columns}
              min={2}
              max={4}
              fallback={2}
              allowEmpty
              onChange={(n) => patch({ columns: n })}
            />
          ) : null}
          {/* R5b §3.1 — media as an INDEPENDENT toggle on the inline layouts
              (list / pills); cards & tiles inherently show images. */}
          {activeMode !== "cards" && activeMode !== "tiles" ? (
            <>
              <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={Boolean(d.show_media)}
                  onChange={(e) => patch({ show_media: e.target.checked || undefined })}
                />
                Show icon / image on each option
              </label>
              {d.show_media ? (
                <>
                  <NumericControl
                    label="Icon size"
                    value={d.icon_size}
                    min={12}
                    max={96}
                    fallback={22}
                    allowEmpty
                    suffix="px"
                    onChange={(n) => patch({ icon_size: n })}
                  />
                  <NumericControl
                    label="Image size"
                    value={d.image_size}
                    min={16}
                    max={160}
                    fallback={40}
                    allowEmpty
                    suffix="px"
                    onChange={(n) => patch({ image_size: n })}
                  />
                  <div className="qz-row" style={{ gap: 6, alignItems: "center" }}>
                    <span className="qz-dim" style={{ fontSize: 11.5 }}>
                      Icon position
                    </span>
                    <div className="qz-segmented" role="group" aria-label="Icon position">
                      {(["left", "top", "right"] as const).map((p) => (
                        <button
                          key={p}
                          type="button"
                          aria-pressed={(d.icon_position ?? "left") === p}
                          onClick={() => patch({ icon_position: p === "left" ? undefined : p })}
                        >
                          {p === "left" ? "Left" : p === "top" ? "Above" : "Right"}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              ) : null}
            </>
          ) : null}
          {/* R5b §3.1 — content alignment within each option. */}
          <div className="qz-row" style={{ gap: 6, alignItems: "center" }}>
            <span className="qz-dim" style={{ fontSize: 11.5 }}>
              Align
            </span>
            <div className="qz-segmented" role="group" aria-label="Content alignment">
              {(["left", "center", "right"] as const).map((al) => (
                <button
                  key={al}
                  type="button"
                  aria-pressed={(d.content_align ?? "left") === al}
                  onClick={() => patch({ content_align: al === "left" ? undefined : al })}
                >
                  {al[0]!.toUpperCase() + al.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <NumericControl
            label="Spacing"
            value={d.spacing}
            min={0}
            max={40}
            fallback={10}
            allowEmpty
            suffix="px"
            onChange={(n) => patch({ spacing: n })}
          />
          <details className="qz-insp-more" style={{ flex: "0 0 auto" }}>
            <summary>More options</summary>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
              {activeMode === "cards" || activeMode === "tiles" ? (
                <>
                  <div className="qz-row" style={{ gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <span className="qz-dim" style={{ fontSize: 11.5 }}>
                      Aspect
                    </span>
                    <div className="qz-segmented" role="group" aria-label="Image aspect">
                      {(["1:1", "4:3", "16:9"] as const).map((a) => (
                        <button
                          key={a}
                          type="button"
                          aria-pressed={(d.aspect ?? "1:1") === a}
                          onClick={() => patch({ aspect: a === "1:1" ? undefined : a })}
                        >
                          {a}
                        </button>
                      ))}
                    </div>
                    <div className="qz-segmented" role="group" aria-label="Image fit">
                      {(["cover", "contain"] as const).map((f) => (
                        <button
                          key={f}
                          type="button"
                          aria-pressed={(d.fit ?? "cover") === f}
                          onClick={() => patch({ fit: f === "cover" ? undefined : f })}
                        >
                          {f === "cover" ? "Cover" : "Contain"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="qz-row" style={{ gap: 6, alignItems: "center" }}>
                    <span className="qz-dim" style={{ fontSize: 11.5 }}>
                      Label
                    </span>
                    <div className="qz-segmented" role="group" aria-label="Label position">
                      {(["below", "overlay", "hidden"] as const).map((p) => (
                        <button
                          key={p}
                          type="button"
                          aria-pressed={(d.label_position ?? "below") === p}
                          onClick={() =>
                            patch({ label_position: p === "below" ? undefined : p })
                          }
                        >
                          {p[0]!.toUpperCase() + p.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <NumericControl
                    label="Overlay tint"
                    value={d.overlay_tint}
                    min={0}
                    max={80}
                    fallback={45}
                    allowEmpty
                    suffix="%"
                    onChange={(n) => patch({ overlay_tint: n })}
                  />
                  {colorInput("Overlay text", d.overlay_text_color, "overlay_text_color")}
                </>
              ) : null}
              {/* §5.1 — label styling INDEPENDENT of image sizing. */}
              <NumericControl
                label="Label size"
                value={d.label_size}
                min={9}
                max={40}
                fallback={15}
                allowEmpty
                suffix="px"
                onChange={(n) => patch({ label_size: n })}
              />
              <div className="qz-row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                {colorInput("Label color", d.label_color, "label_color")}
                <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={Boolean(d.label_bold)}
                    onChange={(e) => patch({ label_bold: e.target.checked || undefined })}
                  />
                  Bold
                </label>
              </div>
              <div className="qz-row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                {colorInput("Background", d.bg, "bg")}
                {colorInput("Gradient stop", d.bg2, "bg2")}
              </div>
              <div className="qz-row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                {colorInput("Border color", d.border_color, "border_color")}
                <NumericControl
                  label="Border"
                  value={d.border_width}
                  min={0}
                  max={6}
                  fallback={1}
                  allowEmpty
                  suffix="px"
                  onChange={(n) => patch({ border_width: n })}
                />
              </div>
              {/* R5c-1 §6.1 — selected-state: indicator + fill / text / border. */}
              <div className="qz-row" style={{ gap: 6, alignItems: "center" }}>
                <span className="qz-dim" style={{ fontSize: 11.5 }}>
                  When selected
                </span>
                <div className="qz-segmented" role="group" aria-label="Selection indicator">
                  {(["check", "dot", "filled", "none"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={
                        (d.selected_indicator ?? (d.selected_style === "check" ? "check" : "none")) === s
                      }
                      onClick={() => patch({ selected_indicator: s })}
                    >
                      {s === "check" ? "Check" : s === "dot" ? "Dot" : s === "filled" ? "Filled" : "None"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="qz-row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                {colorInput("Selected fill", d.selected_fill, "selected_fill")}
                {colorInput("Selected text", d.selected_text_color, "selected_text_color")}
              </div>
              <div className="qz-row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                {colorInput("Selected border", d.selected_border_color, "selected_border_color")}
                <NumericControl
                  label="Border width"
                  value={d.selected_border_width}
                  min={0}
                  max={8}
                  fallback={2}
                  allowEmpty
                  suffix="px"
                  onChange={(n) => patch({ selected_border_width: n })}
                />
              </div>
              {activeMode === "pills" ? (
                <NumericControl
                  label="Pill padding"
                  value={d.pad}
                  min={2}
                  max={40}
                  fallback={8}
                  allowEmpty
                  suffix="px"
                  onChange={(n) => patch({ pad: n })}
                />
              ) : null}
            </div>
          </details>
        </>
      ) : null}
    </div>
  );
}
