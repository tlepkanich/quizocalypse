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

// Rec-Page / Question-Builder spec — soft character limits (live counters, not
// hard server validation). Question text 150, answer/option label 60.
const QUESTION_MAX = 150;
const ANSWER_MAX = 60;
// Soft "4–8 questions" guidance (informational only — never blocks).
const QUESTION_COUNT_MIN = 4;
const QUESTION_COUNT_MAX = 8;

// Small live character counter. Dim until within 10 of the cap, then warns.
function CharCount({ value, max }: { value: number; max: number }) {
  const near = value >= max - 10;
  return (
    <span
      className="qz-dim"
      style={{
        fontSize: 10.5,
        color: near ? "var(--qz-warn, #b25e00)" : undefined,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {value}/{max}
    </span>
  );
}

// Question-Builder spec — surface the existing per-question AI "Regenerate"
// (previously only in the old canvas route) inside the studio editor, with a
// ~10s undo. The host wires these to the draft hook's AI-edit guard so autosave
// can't clobber the regenerated doc, and to the snapshot undo stack.
export interface RegenApi {
  // beginAiEdit — flush + pause autosave before the LLM call.
  start: () => void;
  // applyAi — 3-way merge the AI doc back on top of in-flight edits + record undo.
  apply: (doc: QuizDoc) => void;
  // endAiEdit — resume autosave on failure.
  error: () => void;
  // pop the snapshot undo stack (reverts the regenerate).
  undo: () => void;
}

interface RegenResponse {
  ok: boolean;
  action?: string;
  doc?: QuizDoc;
  error?: string;
}

const REGEN_UNDO_SECONDS = 10;

function RegenerateQuestion({ nodeId, regen }: { nodeId: string; regen: RegenApi }) {
  const fetcher = useFetcher<RegenResponse>();
  const wasBusy = useRef(false);
  const [undoLeft, setUndoLeft] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const busy = fetcher.state !== "idle";

  // Settle once on the busy→idle edge (mirrors AiChatPanel): success applies +
  // opens the undo window; any failure resumes autosave via regen.error().
  useEffect(() => {
    if (wasBusy.current && !busy) {
      const d = fetcher.data;
      if (d?.ok && d.doc) {
        regen.apply(d.doc);
        setErr(null);
        setUndoLeft(REGEN_UNDO_SECONDS);
      } else {
        regen.error();
        setErr(d?.error ?? "Couldn’t regenerate — try again.");
      }
    }
    wasBusy.current = busy;
  }, [busy, fetcher.data, regen]);

  // Tick the undo countdown down to zero.
  useEffect(() => {
    if (undoLeft <= 0) return;
    const t = window.setTimeout(() => setUndoLeft((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [undoLeft]);

  const send = () => {
    if (busy) return;
    setErr(null);
    setUndoLeft(0);
    regen.start();
    const form = new FormData();
    form.set("intent", "regenerate-node");
    form.set("nodeId", nodeId);
    fetcher.submit(form, { method: "POST" });
  };

  return (
    <div className="qz-col qz-gap-4">
      <div className="qz-row qz-gap-8" style={{ alignItems: "center", flexWrap: "wrap" }}>
        <QzButton size="sm" variant="ghost" onClick={send} disabled={busy}>
          {busy ? "Regenerating…" : "✨ Regenerate with AI"}
        </QzButton>
        {undoLeft > 0 ? (
          <button
            type="button"
            className="qz-btn qz-btn-ghost qz-btn-sm"
            onClick={() => {
              regen.undo();
              setUndoLeft(0);
            }}
          >
            Undo ({undoLeft}s)
          </button>
        ) : null}
      </div>
      {err ? <div style={{ fontSize: 11, color: "#b3241a" }}>{err}</div> : null}
    </div>
  );
}

export function ContentTab({
  doc,
  node,
  onCommit,
  products,
  regen,
}: {
  doc: QuizDoc;
  node: QuizNode;
  onCommit: (doc: QuizDoc) => void;
  // Optional product catalog for the image picker's "Your products" tab.
  // Call sites without it still get the URL tab.
  products?: PickerProduct[];
  // Optional AI-regenerate plumbing (studio only). Absent → no Regenerate button.
  regen?: RegenApi;
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
      return (
        <QuestionContent doc={doc} node={node} onCommit={onCommit} products={products} regen={regen} />
      );
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
            Recommendation logic lives in the canvas builder’s Logic tab.
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
  label = "Hero image",
}: {
  value: string;
  onChange: (url: string) => void;
  products?: PickerProduct[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <QzField label={label}>
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
  regen,
}: {
  doc: QuizDoc;
  node: Extract<QuizNode, { type: "question" }>;
  onCommit: (doc: QuizDoc) => void;
  products?: PickerProduct[];
  regen?: RegenApi;
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
  // B6 — scale config (range + endpoint labels) for rating / slider / numeric.
  const sc = node.data.scale_config;
  const scStr = (v: number | undefined) => (v === undefined ? "" : String(v));
  const toNum = (v: string) => {
    const t = v.trim();
    if (t === "") return undefined;
    const n = Number(t);
    return Number.isFinite(n) ? n : undefined;
  };
  const toPos = (v: string) => {
    const n = toNum(v);
    return n !== undefined && n > 0 ? n : undefined;
  };
  // Merge a patch into scale_config; commit `undefined` once every field is blank
  // so a fully-cleared config serializes to NO key (published /q stays byte-stable).
  const setScale = (patch: Record<string, unknown>) => {
    const merged: Record<string, unknown> = { ...(sc ?? {}), ...patch };
    const cleaned = Object.fromEntries(
      Object.entries(merged).filter(([, v]) => v !== undefined && v !== "" && v !== null),
    );
    setData({ scale_config: Object.keys(cleaned).length ? cleaned : undefined });
  };
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
  const questionCount = doc.nodes.filter((n) => n.type === "question").length;
  const countNudge =
    questionCount < QUESTION_COUNT_MIN
      ? `${questionCount} question${questionCount === 1 ? "" : "s"} — most quizzes feel best with ${QUESTION_COUNT_MIN}–${QUESTION_COUNT_MAX}.`
      : questionCount > QUESTION_COUNT_MAX
        ? `${questionCount} questions — consider trimming toward ${QUESTION_COUNT_MIN}–${QUESTION_COUNT_MAX} to keep shoppers engaged.`
        : null;
  return (
    <>
      {countNudge ? (
        <div
          className="qz-dim"
          style={{
            fontSize: 11.5,
            padding: "6px 8px",
            borderRadius: 6,
            background: "color-mix(in srgb, var(--qz-warn, #b25e00) 8%, transparent)",
          }}
        >
          {countNudge}
        </div>
      ) : null}
      <QzField
        label={
          <span className="qz-row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
            <span>Question</span>
            <CharCount value={node.data.text.length} max={QUESTION_MAX} />
          </span>
        }
      >
        <QzTextarea
          value={node.data.text}
          onChange={(e) => setText(e.target.value.slice(0, QUESTION_MAX))}
          maxLength={QUESTION_MAX}
          rows={2}
        />
      </QzField>
      <QzField label="Answering">
        <div className="qz-segmented" role="group" aria-label="Required or optional">
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
            Optional (can skip)
          </button>
        </div>
      </QzField>
      {regen ? <RegenerateQuestion nodeId={node.id} regen={regen} /> : null}
      <QzField label="Type">
        <QzSelect
          value={node.data.question_type}
          onChange={(e) => {
            const next = e.target.value;
            // Switching a multi-answer card question to a freeform input makes the
            // extra answers inert (freeform keeps only the first as a seed) — confirm
            // before discarding that work. The controlled select snaps back on cancel.
            if (
              !isFreeformType(node.data.question_type) &&
              isFreeformType(next) &&
              node.data.answers.length > 1 &&
              typeof window !== "undefined" &&
              !window.confirm(
                `Switching to this type ignores your ${node.data.answers.length} answers — only the first is kept. Continue?`,
              )
            ) {
              return;
            }
            setData({ question_type: next });
          }}
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
      {/* B6 — an optional per-question context/education image (above the text). */}
      <HeroImageField
        label="Question image"
        value={node.data.image_url ?? ""}
        onChange={(url) => setData({ image_url: url || undefined })}
        products={products}
      />
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
      {node.data.question_type === "rating" ||
      node.data.question_type === "slider" ||
      node.data.question_type === "numeric" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {node.data.question_type !== "rating" ? (
            <div className="qz-row" style={{ gap: 12 }}>
              <QzField label="Min">
                <QzInput
                  type="number"
                  value={scStr(sc?.min)}
                  onChange={(e) => setScale({ min: toNum(e.target.value) })}
                />
              </QzField>
              <QzField label="Max">
                <QzInput
                  type="number"
                  value={scStr(sc?.max)}
                  onChange={(e) => setScale({ max: toNum(e.target.value) })}
                />
              </QzField>
              <QzField label="Step">
                <QzInput
                  type="number"
                  min={0}
                  value={scStr(sc?.step)}
                  onChange={(e) => setScale({ step: toPos(e.target.value) })}
                />
              </QzField>
            </div>
          ) : null}
          {node.data.question_type !== "numeric" ? (
            <div className="qz-row" style={{ gap: 12 }}>
              <QzField label={node.data.question_type === "rating" ? "Left label" : "Min label"}>
                <QzInput
                  value={sc?.endpoint_label_min ?? ""}
                  maxLength={40}
                  placeholder="e.g. Not at all"
                  onChange={(e) => setScale({ endpoint_label_min: e.target.value.slice(0, 40) })}
                />
              </QzField>
              <QzField label={node.data.question_type === "rating" ? "Right label" : "Max label"}>
                <QzInput
                  value={sc?.endpoint_label_max ?? ""}
                  maxLength={40}
                  placeholder="e.g. Love it"
                  onChange={(e) => setScale({ endpoint_label_max: e.target.value.slice(0, 40) })}
                />
              </QzField>
            </div>
          ) : null}
          {node.data.question_type === "rating" ? (
            <p className="qz-dim" style={{ fontSize: 11.5, margin: 0 }}>
              Each rating point is an answer below — map it to a bucket in Routing → Mapping.
            </p>
          ) : null}
        </div>
      ) : null}
      {isFreeformType(node.data.question_type) ? (
        <p className="qz-dim" style={{ fontSize: 11.5, margin: "2px 0" }}>
          Open responses are stored as customer data — not scored toward a recommendation.
        </p>
      ) : null}
      <QzField label="Answers">
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {node.data.answers.map((a) => (
            <div key={a.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div className="qz-row" style={{ gap: 6, alignItems: "center" }}>
                <QzInput
                  value={a.text}
                  onChange={(e) => setAnswer(a.id, { text: e.target.value.slice(0, ANSWER_MAX) })}
                  maxLength={ANSWER_MAX}
                  style={{ flex: 1 }}
                />
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
              {a.text.length >= ANSWER_MAX - 10 ? (
                <div style={{ textAlign: "right" }}>
                  <CharCount value={a.text.length} max={ANSWER_MAX} />
                </div>
              ) : null}
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
