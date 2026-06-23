import type { CSSProperties, ReactNode } from "react";
import type { OrderedStep } from "../../lib/flowOrder";
import type { Quiz, QuizNode } from "../../lib/quizSchema";
import type { IndexedProduct } from "../../lib/recommendationEngine";
import { StepPreview, type PreviewCategory } from "../runtime/StepPreview";
import { NODE_LABEL } from "./panels/nodeMeta";
import { ThemeToggle } from "./ThemeToggle";

// QD-6 — Quizell-style builder chrome for the STANDALONE surface: a left
// icon-rail (Editor / AI / Theme / Settings / Code) + a bottom step filmstrip.
// Pure presentational; the parent (UnifiedWorkspace) owns the view/selection
// state and maps the rail onto its existing build/logic views.

const RAIL_ICON: Record<string, ReactNode> = {
  editor: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" /></>,
  ai: <path d="M12 3l1.7 4.5L18 9l-4.3 1.5L12 15l-1.7-4.5L6 9l4.3-1.5L12 3Z" />,
  theme: <><circle cx="13.5" cy="6.5" r="1" /><circle cx="17.5" cy="10.5" r="1" /><circle cx="8.5" cy="7.5" r="1" /><circle cx="6.5" cy="12.5" r="1" /><path d="M12 3a9 9 0 1 0 0 18 1.6 1.6 0 0 0 1.6-1.6c0-.4-.2-.8-.4-1.1-.2-.3-.4-.6-.4-1a1.6 1.6 0 0 1 1.6-1.6H16a5 5 0 0 0 5-5c0-4.4-4-7.7-9-7.7Z" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.2A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3a2 2 0 1 1 0-4h.2A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9 4.6a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.4 1Z" /></>,
  code: <path d="m16 18 6-6-6-6M8 6l-6 6 6 6" />,
};

const RAIL: Array<{ key: string; label: string }> = [
  { key: "editor", label: "Editor" },
  { key: "ai", label: "AI" },
  { key: "theme", label: "Theme" },
  { key: "settings", label: "Settings" },
  { key: "code", label: "Code" },
];

export function BuilderRail({ active, onSelect }: { active: string; onSelect: (key: string) => void }) {
  return (
    <nav className="qz-builder-rail" aria-label="Builder tools">
      {RAIL.map((r) => (
        <button
          key={r.key}
          type="button"
          className={`qz-builder-rail-item${active === r.key ? " is-active" : ""}`}
          aria-current={active === r.key ? "page" : undefined}
          onClick={() => onSelect(r.key)}
        >
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {RAIL_ICON[r.key]}
          </svg>
          <span>{r.label}</span>
        </button>
      ))}
      {/* QB-1 — the full-screen builder has no app sidebar, so the dark-mode
          toggle lives at the foot of the rail (matches Quizell's 🌙). */}
      <div className="qz-builder-rail-spacer" />
      <ThemeToggle />
    </nav>
  );
}

// The step's own copy (headline / question text) for the filmstrip card, so it
// reads like Quizell's thumbnails ("What's your skin type?") not "Question".
function stepTitle(node: QuizNode | undefined): string {
  if (!node) return "";
  const d = node.data as Record<string, unknown>;
  const s = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : "");
  switch (node.type) {
    case "question":
      return s("text");
    case "message":
      return s("text");
    case "ask_ai":
      return s("persona_name");
    default:
      return s("headline");
  }
}

// QP-1 — filmstrip thumbnail geometry. Each card is a clipped viewport showing a
// real StepPreview laid out at FILM_NATURAL_W, scaled to fit — so the strip reads
// like Quizell's rendered step thumbnails (the intro image, the question chips,
// the product row) instead of a text label. The render is the label.
const FILM_THUMB_W = 156;
const FILM_THUMB_H = 104;
const FILM_NATURAL_W = 460;
const FILM_SCALE = FILM_THUMB_W / FILM_NATURAL_W;
// Painted on the StepPreview root (the var is set on that same element by
// tokensToCssVars), so a dark-themed quiz's thumbnail gets its own backdrop.
const FILM_RENDER_STYLE: CSSProperties = {
  width: FILM_NATURAL_W,
  minHeight: FILM_THUMB_H / FILM_SCALE,
  padding: 18,
  background: "var(--qz-color-bg)",
};

export function BuilderFilmstrip({
  doc,
  steps,
  selectedId,
  onSelect,
  onAdd,
  productIndex,
  categories,
}: {
  doc: Quiz;
  steps: OrderedStep[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd?: () => void;
  productIndex: IndexedProduct[];
  categories?: PreviewCategory[];
}) {
  if (steps.length === 0 && !onAdd) return null;
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  // Standalone quizzes default to the minimal Quizell chrome (the filmstrip only
  // renders in the standalone builder), so the thumbnail matches the live quiz.
  const chrome = doc.design_tokens?.chrome ?? "minimal";
  return (
    <div className="qz-builder-filmstrip" aria-label="Quiz steps">
      {steps.map((s, i) => {
        const node = byId.get(s.nodeId);
        const type = NODE_LABEL[s.type] ?? s.type;
        const title = stepTitle(node) || type;
        return (
          <button
            key={s.nodeId}
            type="button"
            className={`qz-film-card${selectedId === s.nodeId ? " is-active" : ""}`}
            onClick={() => onSelect(s.nodeId)}
            title={`${i + 1}. ${title}`}
            aria-label={`Step ${i + 1}: ${title}`}
          >
            <span
              className="qz-film-thumb"
              aria-hidden="true"
              ref={(el) => {
                // The thumb renders a scaled live StepPreview whose real
                // buttons/inputs are purely decorative — mark the subtree inert
                // so they're not focusable or interactive. Fixes axe
                // aria-hidden-focus (focusable content inside aria-hidden) AND
                // nested-interactive (a control nested inside the step button).
                if (el) el.inert = true;
              }}
            >
              {node ? (
                <span
                  className="qz-film-thumb-scale"
                  style={{ width: FILM_NATURAL_W, transform: `scale(${FILM_SCALE})` }}
                >
                  <StepPreview
                    doc={doc}
                    node={node}
                    productIndex={productIndex}
                    categories={categories}
                    chrome={chrome}
                    style={FILM_RENDER_STYLE}
                  />
                </span>
              ) : null}
            </span>
            <span className="qz-film-num">{i + 1}</span>
          </button>
        );
      })}
      {onAdd ? (
        <button type="button" className="qz-film-add" onClick={onAdd} title="Add a step" aria-label="Add a step">
          +
        </button>
      ) : null}
    </div>
  );
}
