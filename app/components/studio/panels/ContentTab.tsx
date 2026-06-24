import { useEffect, useRef, useState } from "react";
import { useFetcher } from "@remix-run/react";
import { QzButton, QzField, QzInput, QzSelect, QzTextarea } from "../../qz";
import type { Quiz, QuizNode } from "../../../lib/quizSchema";
import { isFreeformType } from "../../../lib/quizSchema";
import { addAnswer, removeAnswer } from "../../../lib/quizMutations";
import { updateNodeData } from "../studioDoc";
import { EmojiIconPicker } from "../EmojiIconPicker";
import { ImagePicker, IMAGE_ANSWER_TYPES, type PickerProduct } from "../ImagePicker";

// ════════════════════════════════════════════════════════════════════════════
// Content panel — focused field editors per node type (Unified P0: extracted
// from StudioBuilder verbatim; QuestionContent additionally gains the
// icon/image/columns affordances that previously lived only in the AI-mode
// InspectorPanel, so there is ONE canonical question editor).
// ════════════════════════════════════════════════════════════════════════════

type QuizDoc = Quiz;

// Inline character counter shown in QzField's `meta` slot. Turns amber at 80%
// and red at 95% so merchants notice before hitting the hard cap.
function CharCount({ value, max }: { value: string; max: number }) {
  const n = value.length;
  const pct = n / max;
  const color =
    pct >= 0.95
      ? "#D72C0D"
      : pct >= 0.8
        ? "#8A6116"
        : "var(--qz-ink-3, #999)";
  return (
    <span style={{ fontSize: 10.5, color, fontVariantNumeric: "tabular-nums" }}>
      {n}/{max}
    </span>
  );
}

export function ContentTab({
  doc,
  node,
  onCommit,
  products,
}: {
  doc: QuizDoc;
  node: QuizNode;
  onCommit: (doc: QuizDoc) => void;
  // Optional product catalog for the image picker's "Your products" tab.
  // Call sites without it still get the URL tab.
  products?: PickerProduct[];
}) {
  const set = (patch: Record<string, unknown>) => onCommit(updateNodeData(doc, node.id, patch));
  const d = node.data as Record<string, unknown>;
  const str = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : "");

  const text = (k: string, label: string, area = false) => (
    <QzField label={label} key={k}>
      {area ? (
        <QzTextarea value={str(k)} onChange={(e) => set({ [k]: e.target.value })} rows={3} />
      ) : (
        <QzInput value={str(k)} onChange={(e) => set({ [k]: e.target.value })} />
      )}
    </QzField>
  );

  switch (node.type) {
    case "intro":
      return (
        <>
          {text("headline", "Headline")}
          {text("subtext", "Subtext", true)}
          {text("button_label", "Button label")}
          <HeroImageField
            value={str("hero_image_url")}
            onChange={(url) => set({ hero_image_url: url || undefined })}
            products={products}
          />
        </>
      );
    case "question":
      return <QuestionContent doc={doc} node={node} onCommit={onCommit} products={products} />;
    case "email_gate":
      return (
        <>
          {text("headline", "Headline")}
          {text("subtext", "Subtext", true)}
          <label style={{ display: "inline-flex", gap: 8, alignItems: "center", fontSize: 13 }}>
            <input
              type="checkbox"
              checked={Boolean(d.collect_phone)}
              onChange={(e) => set({ collect_phone: e.target.checked })}
            />
            Also collect phone (SMS)
          </label>
        </>
      );
    case "result": {
      const hatch = (d as { escape_hatch?: { label?: string; url?: string } }).escape_hatch;
      return (
        <>
          {text("headline", "Headline")}
          {text("subtext", "Subtext", true)}
          {text("cta_label", "CTA label")}
          <QzField
            label="Escape hatch (optional)"
            hint='A quiet "talk to a human" link under the result — label + https URL, both required to show.'
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <QzInput
                value={hatch?.label ?? ""}
                placeholder="Not sure? Talk to an expert"
                onChange={(e) => {
                  const label = e.target.value;
                  const url = hatch?.url ?? "";
                  set({ escape_hatch: label || url ? { label, url } : undefined });
                }}
              />
              <QzInput
                value={hatch?.url ?? ""}
                placeholder="https://your-store.com/pages/contact"
                onChange={(e) => {
                  const url = e.target.value;
                  const label = hatch?.label ?? "";
                  set({ escape_hatch: label || url ? { label, url } : undefined });
                }}
              />
            </div>
          </QzField>
          <p className="qz-dim" style={{ fontSize: 12 }}>
            Recommendation logic lives in the canvas builder's Logic tab.
          </p>
        </>
      );
    }
    case "message":
      return text("text", "Message", true);
    case "end":
      return (
        <>
          {text("headline", "Headline")}
          {text("subtext", "Subtext", true)}
          {text("cta_label", "CTA label")}
          {text("cta_url", "CTA URL")}
        </>
      );
    case "ask_ai":
      return (
        <>
          {text("persona_name", "Persona name")}
          {text("opening_message", "Opening message", true)}
          {text("system_prompt", "System prompt", true)}
        </>
      );
    case "product_cards":
      return (
        <>
          {text("headline", "Headline")}
          {text("subtext", "Subtext", true)}
          {text("cta_label", "CTA label")}
        </>
      );
    case "branch":
      return text("label", "Label");
    case "integration":
      return (
        <>
          {text("label", "Label")}
          <p className="qz-dim" style={{ fontSize: 12 }}>
            Configure webhook / Klaviyo actions in the canvas builder.
          </p>
        </>
      );
    default:
      return null;
  }
}

// Unified P3 — the intro hero image gets the same picker as answer images
// (your products | URL) instead of a bare URL field.
function HeroImageField({
  value,
  onChange,
  products,
}: {
  value: string;
  onChange: (url: string) => void;
  products?: PickerProduct[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <QzField label="Hero image">
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div className="qz-row" style={{ gap: 6, alignItems: "center" }}>
          <QzInput
            value={value}
            placeholder="https://… (or pick →)"
            onChange={(e) => onChange(e.target.value)}
            style={{ flex: 1 }}
          />
          <button
            type="button"
            title={value ? "Change image" : "Pick an image"}
            aria-label="Pick a hero image"
            onClick={() => setOpen((o) => !o)}
            style={{
              border: open ? "1px solid var(--qz-accent, #2a6df4)" : "1px solid #00000022",
              background: value ? `center/cover url(${value})` : "#fff",
              color: value ? "transparent" : undefined,
              borderRadius: 6,
              width: 26,
              height: 26,
              cursor: "pointer",
              flex: "0 0 auto",
              fontSize: 12,
              lineHeight: 1,
            }}
          >
            🖼
          </button>
        </div>
        {open ? (
          <ImagePicker
            products={products ?? []}
            value={value || undefined}
            onPick={(url) => {
              onChange(url ?? "");
              setOpen(false);
            }}
          />
        ) : null}
      </div>
    </QzField>
  );
}

export function QuestionContent({
  doc,
  node,
  onCommit,
  products,
}: {
  doc: QuizDoc;
  node: Extract<QuizNode, { type: "question" }>;
  onCommit: (doc: QuizDoc) => void;
  products?: PickerProduct[];
}) {
  const setText = (text: string) => onCommit(updateNodeData(doc, node.id, { text }));
  const setData = (patch: Record<string, unknown>) =>
    onCommit(updateNodeData(doc, node.id, patch));
  const setAnswer = (answerId: string, patch: Record<string, unknown>) => {
    const answers = node.data.answers.map((a) => (a.id === answerId ? { ...a, ...patch } : a));
    onCommit(updateNodeData(doc, node.id, { answers }));
  };
  // Which answer row has its icon/image picker expanded (one at a time).
  const [picker, setPicker] = useState<{ answerId: string; kind: "icon" | "image" } | null>(null);
  const isCard = !isFreeformType(node.data.question_type);
  const supportsImages = IMAGE_ANSWER_TYPES.has(node.data.question_type);
  const columns = node.data.answer_columns;
  const num = (v: string) => (v.trim() ? Math.max(1, Math.round(Number(v) || 1)) : undefined);
  const chipStyle = (active: boolean): React.CSSProperties => ({
    border: active ? "1px solid var(--qz-accent, #2a6df4)" : "1px solid #00000022",
    background: "#fff",
    borderRadius: 6,
    width: 26,
    height: 26,
    cursor: "pointer",
    flex: "0 0 auto",
    fontSize: 13,
    lineHeight: 1,
  });

  // AI regenerate — submits to the current route (intent=regenerate-node) and
  // replaces the whole doc when the server returns the updated version.
  // An undo snapshot is offered for 10 seconds after each regeneration.
  const regenFetcher = useFetcher<{ ok: boolean; doc?: Quiz; error?: string }>();
  const isRegenerating = regenFetcher.state !== "idle";
  const [undoDoc, setUndoDoc] = useState<QuizDoc | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preRegenDocRef = useRef<QuizDoc | null>(null);
  const processedRegenRef = useRef<unknown>(null);

  useEffect(() => {
    if (
      regenFetcher.state === "idle" &&
      regenFetcher.data?.ok &&
      regenFetcher.data.doc &&
      regenFetcher.data !== processedRegenRef.current
    ) {
      processedRegenRef.current = regenFetcher.data;
      if (preRegenDocRef.current) {
        setUndoDoc(preRegenDocRef.current);
        preRegenDocRef.current = null;
      }
      onCommit(regenFetcher.data.doc as QuizDoc);
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      undoTimerRef.current = setTimeout(() => setUndoDoc(null), 10_000);
    }
  }, [regenFetcher.state, regenFetcher.data, onCommit]);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, []);

  return (
    <>
      <QzField
        label="Question"
        meta={<CharCount value={node.data.text} max={150} />}
      >
        <QzTextarea
          value={node.data.text}
          maxLength={150}
          onChange={(e) => setText(e.target.value)}
          rows={2}
        />
      </QzField>

      {/* Required / Optional toggle */}
      <div className="qz-row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div className="qz-segmented" role="group" aria-label="Question requirement">
          <button
            type="button"
            aria-pressed={node.data.required !== false}
            onClick={() => setData({ required: true })}
          >
            Required
          </button>
          <button
            type="button"
            aria-pressed={node.data.required === false}
            onClick={() => setData({ required: false })}
          >
            Optional
          </button>
        </div>
        {node.data.required === false ? (
          <span className="qz-dim" style={{ fontSize: 11 }}>
            Adds "Skip this question" — skipped questions score zero
          </span>
        ) : null}
      </div>

      {/* AI regenerate */}
      <div className="qz-row" style={{ gap: 6, alignItems: "center" }}>
        <button
          type="button"
          className="qz-btn qz-btn-ghost qz-btn-sm"
          disabled={isRegenerating}
          title="Replace this question with a new AI-generated version"
          onClick={() => {
            preRegenDocRef.current = doc;
            const form = new FormData();
            form.set("intent", "regenerate-node");
            form.set("nodeId", node.id);
            regenFetcher.submit(form, { method: "POST" });
          }}
        >
          {isRegenerating ? "Generating…" : "↻ Regenerate"}
        </button>
        {undoDoc ? (
          <button
            type="button"
            className="qz-btn qz-btn-ghost qz-btn-sm"
            onClick={() => {
              onCommit(undoDoc);
              setUndoDoc(null);
              if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
            }}
          >
            ↺ Undo
          </button>
        ) : null}
        {regenFetcher.data && !regenFetcher.data.ok ? (
          <span className="qz-dim" style={{ fontSize: 11, color: "#D72C0D" }}>
            {regenFetcher.data.error ?? "Regeneration failed"}
          </span>
        ) : null}
      </div>

      <QzField label="Type">
        <QzSelect
          value={node.data.question_type}
          onChange={(e) => setData({ question_type: e.target.value })}
        >
          <option value="single_select">Single select</option>
          <option value="multi_select">Multi select</option>
          <option value="dropdown">Dropdown</option>
          <option value="image_tile">Image tiles</option>
          <option value="image_picker">Image picker</option>
          <option value="rating">Rating scale</option>
          <option value="swatch">Swatch picker</option>
          <option value="numeric">Number input</option>
          <option value="date">Date input</option>
          <option value="slider">Slider (0–100)</option>
          <option value="searchable">Searchable</option>
          <option value="text">Text input</option>
          <option value="email">Email input</option>
        </QzSelect>
      </QzField>
      {node.data.question_type === "multi_select" ? (
        <div className="qz-row" style={{ gap: 12 }}>
          <QzField label="Min picks">
            <QzInput
              type="number"
              min={1}
              value={node.data.min_selections ? String(node.data.min_selections) : ""}
              onChange={(e) => setData({ min_selections: num(e.target.value) })}
            />
          </QzField>
          <QzField label="Max picks">
            <QzInput
              type="number"
              min={1}
              value={node.data.max_selections ? String(node.data.max_selections) : ""}
              onChange={(e) => setData({ max_selections: num(e.target.value) })}
            />
          </QzField>
        </div>
      ) : null}
      <QzField label="Answers">
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {node.data.answers.map((a) => (
            <div key={a.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div className="qz-row" style={{ gap: 6, alignItems: "center" }}>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                  <QzInput
                    value={a.text}
                    maxLength={60}
                    onChange={(e) => setAnswer(a.id, { text: e.target.value })}
                  />
                  {a.text.length > 45 ? (
                    <div style={{ textAlign: "right" }}>
                      <CharCount value={a.text} max={60} />
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  title={a.icon ? `Icon: ${a.icon} — change` : "Add an emoji icon"}
                  aria-label={`Icon for answer: ${a.text}`}
                  onClick={() =>
                    setPicker((p) =>
                      p?.answerId === a.id && p.kind === "icon"
                        ? null
                        : { answerId: a.id, kind: "icon" },
                    )
                  }
                  style={chipStyle(picker?.answerId === a.id && picker.kind === "icon")}
                >
                  {a.icon ?? "☺"}
                </button>
                {supportsImages ? (
                  <button
                    type="button"
                    title={a.image_url ? "Change image" : "Pick an image"}
                    aria-label={`Image for answer: ${a.text}`}
                    onClick={() =>
                      setPicker((p) =>
                        p?.answerId === a.id && p.kind === "image"
                          ? null
                          : { answerId: a.id, kind: "image" },
                      )
                    }
                    style={{
                      ...chipStyle(picker?.answerId === a.id && picker.kind === "image"),
                      background: a.image_url ? `center/cover url(${a.image_url})` : "#fff",
                      color: a.image_url ? "transparent" : undefined,
                      fontSize: 12,
                    }}
                  >
                    🖼
                  </button>
                ) : null}
                {node.data.answers.length > (isCard ? 2 : 1) ? (
                  <button
                    onClick={() => onCommit(removeAnswer(doc, node.id, a.id))}
                    className="qz-btn qz-btn-ghost qz-btn-sm"
                    title="Remove answer"
                    aria-label={`Remove answer: ${a.text}`}
                  >
                    ✕
                  </button>
                ) : null}
              </div>
              {picker?.answerId === a.id && picker.kind === "icon" ? (
                <EmojiIconPicker
                  value={a.icon}
                  onPick={(icon) => {
                    setAnswer(a.id, { icon });
                    setPicker(null);
                  }}
                />
              ) : null}
              {picker?.answerId === a.id && picker.kind === "image" ? (
                <ImagePicker
                  products={products ?? []}
                  value={a.image_url}
                  onPick={(image_url) => {
                    setAnswer(a.id, { image_url });
                    setPicker(null);
                  }}
                />
              ) : null}
            </div>
          ))}
        </div>
      </QzField>
      {isCard ? (
        <div className="qz-row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <QzButton size="sm" variant="ghost" onClick={() => onCommit(addAnswer(doc, node.id))}>
            + Add answer
          </QzButton>
          <span className="qz-dim" style={{ fontSize: 11 }}>Columns:</span>
          <div className="qz-segmented" role="group" aria-label="Answer columns">
            <button
              type="button"
              aria-pressed={columns === undefined}
              onClick={() => setData({ answer_columns: undefined })}
            >
              Auto
            </button>
            <button
              type="button"
              aria-pressed={columns === 1}
              onClick={() => setData({ answer_columns: 1 })}
            >
              1
            </button>
            <button
              type="button"
              aria-pressed={columns === 2}
              onClick={() => setData({ answer_columns: 2 })}
            >
              2
            </button>
          </div>
        </div>
      ) : null}
      <QzField
        label="Chapter label (optional)"
        hint="Groups questions in the progress trail — consecutive questions sharing a label read as one chapter (e.g. SKIN PROFILE)."
      >
        <QzInput
          value={node.data.section_label ?? ""}
          onChange={(e) => {
            const v = e.target.value.slice(0, 40);
            setData({ section_label: v.trim().length > 0 ? v : undefined });
          }}
          placeholder="e.g. Skin profile"
        />
      </QzField>
      <QzField
        label="Reassurance line (optional)"
        hint="One quiet line under the question — lowers decision anxiety."
      >
        <QzInput
          value={node.data.helper_text ?? ""}
          onChange={(e) => {
            const v = e.target.value.slice(0, 160);
            setData({ helper_text: v.trim().length > 0 ? v : undefined });
          }}
          placeholder="There's no wrong answer — pick what feels like you."
        />
      </QzField>
      <QzField
        label="Education card (optional)"
        hint="A short explainer shown before this question — use it for unfamiliar terms. Leave empty for none."
      >
        <QzTextarea
          value={node.data.education_card_before ?? ""}
          onChange={(e) => {
            const v = e.target.value.trim();
            setData({ education_card_before: v.length > 0 ? v : undefined });
          }}
          rows={2}
          placeholder="e.g. SPF measures how long a sunscreen protects against UVB rays."
        />
      </QzField>
    </>
  );
}
