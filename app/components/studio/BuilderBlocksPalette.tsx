import type { ReactNode } from "react";
import type { ContentBlockType, Quiz, QuizNode } from "../../lib/quizSchema";
import { PALETTE_BLOCKS, makeBlock, setNodeLayout } from "./studioDoc";
import { synthesizeLayout } from "../../lib/synthesizeLayout";

// ════════════════════════════════════════════════════════════════════════════
// BLD-3 — the library's "Add" tab as a structural port of build-tab.html's
// component library: mono group labels (Content · Questions · Social proof ·
// Capture · Outcome), a 2-column grid of compact tiles (.comp — 15px stroke
// icon + 11px label), the mock's icon set, and the libhd search filtering it.
// Click OR drag a tile onto the canvas to append the block to the target step
// (the selected step, else the one the canvas is showing) — undoable via the
// top bar. Inserting preserves an existing explicit layout. Smart tiles only
// appear for the node type whose interactive region the runtime can render;
// ai_chat/product_grid stay off the palette until their regions are extracted.
// ════════════════════════════════════════════════════════════════════════════

type QuizDoc = Quiz;

// Smart block → the only node type it renders on (mirror of the runtime's
// RUNTIME_SMART_BLOCK_HOSTS).
const SMART_HOST: Record<string, QuizNode["type"]> = {
  answers: "question",
  recommendations: "result",
  email_input: "email_gate",
};
const UNSUPPORTED: ReadonlySet<string> = new Set(["ai_chat", "product_grid"]);

/** The mock's <symbol> paths for the component tiles (24px viewBox). */
export const BLOCK_ICONS: Record<string, ReactNode> = {
  heading: <path d="M6 4v16M18 4v16M6 12h12M4 4h4M16 4h4" />,
  text: <path d="M4 6h16M4 12h16M4 18h10" />,
  content: <path d="M4 6h16M4 12h16M4 18h10" />,
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M21 16l-5-5-9 9" />
    </>
  ),
  video: (
    <>
      <rect x="3" y="5" width="14" height="14" rx="2" />
      <path d="M17 10l4-2v8l-4-2z" />
    </>
  ),
  logo: <path d="M12 3l2.5 5 5.5.5-4 4 1 5.5-5-3-5 3 1-5.5-4-4 5.5-.5z" />,
  divider: <path d="M3 12h18" />,
  spacer: <path d="M12 4v16M8 8l4-4 4 4M8 16l4 4 4-4" />,
  choice: (
    <>
      <circle cx="6" cy="8" r="2.4" />
      <circle cx="6" cy="16" r="2.4" />
      <path d="M11 8h9M11 16h9" />
    </>
  ),
  scale: (
    <>
      <path d="M4 12h16" />
      <circle cx="9" cy="12" r="2.6" fill="currentColor" stroke="none" />
    </>
  ),
  email_input: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </>
  ),
  review_stars: <path d="M12 3l2.5 5 5.5.5-4 4 1 5.5-5-3-5 3 1-5.5-4-4 5.5-.5z" />,
  testimonial: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01" />
    </>
  ),
  trust_badges: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M8 12l3 3 5-5" />
    </>
  ),
  recommendations: (
    <>
      <circle cx="9" cy="20" r="1.4" />
      <circle cx="17" cy="20" r="1.4" />
      <path d="M3 4h2l2.5 12h10L20 8H6" />
    </>
  ),
  coupon: (
    <path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0l-7-7a2 2 0 01-.6-1.4V5a2 2 0 012-2h6.8a2 2 0 011.4.6l7 7a2 2 0 010 2.8z" />
  ),
  button: <rect x="3" y="8" width="18" height="8" rx="4" />,
  progress: (
    <>
      <rect x="3" y="10" width="18" height="4" rx="2" />
      <rect x="3" y="10" width="8" height="4" rx="2" fill="currentColor" stroke="none" />
    </>
  ),
};

export function BlockIcon({ type }: { type: string }) {
  const d = BLOCK_ICONS[type] ?? BLOCK_ICONS.text;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ width: 15, height: 15, flex: "none" }}
      aria-hidden="true"
    >
      {d}
    </svg>
  );
}

// mock GROUPS + membership, mapped onto the app's real block inventory. The
// display label follows the mock where the mock names the same thing
// (Recommendations → "Product results").
const GROUPS: { name: string; types: ContentBlockType[] }[] = [
  { name: "Content", types: ["heading", "text", "image", "video", "logo", "divider", "spacer", "content"] },
  { name: "Social proof", types: ["review_stars", "testimonial", "trust_badges"] },
  { name: "Capture", types: ["email_input"] },
  { name: "Outcome", types: ["recommendations", "coupon", "button", "progress"] },
];
const MOCK_LABEL: Partial<Record<ContentBlockType, string>> = {
  email_input: "Email capture",
  recommendations: "Product results",
};

/** The block stack an insert appends to: the node's explicit layout when one
 *  exists, else its fixed template synthesized (first customization). */
export function currentLayout(doc: QuizDoc, node: QuizNode) {
  return doc.node_layouts[node.id] ?? synthesizeLayout(node);
}

/** Append `type` to `node`'s layout (shared by tile click + canvas drop). */
export function insertBlock(doc: QuizDoc, node: QuizNode, type: ContentBlockType): QuizDoc {
  return setNodeLayout(doc, node.id, [...currentLayout(doc, node), makeBlock(type)]);
}

export const BLOCK_DRAG_MIME = "application/x-qz-block";

// QZY-7 (build-tab §3) — the palette's QUESTION tiles are not free blocks:
// on a question screen they SWITCH the question's input type; elsewhere they
// create a NEW question screen. A second question can never join a screen.
// Labels follow the mock's Questions group (Choice · Scale).
const QUESTION_TILES: { kind: "single_select" | "slider"; label: string; icon: string }[] = [
  { kind: "single_select", label: "Choice", icon: "choice" },
  { kind: "slider", label: "Scale", icon: "scale" },
];

export function BuilderBlocksPalette({
  doc,
  node,
  commit,
  onQuestionTile,
  query = "",
}: {
  doc: QuizDoc;
  /** The insert target: the selected step, else the step the canvas shows. */
  node: QuizNode | null;
  commit: (doc: QuizDoc) => void;
  /** QZY-7 — switch-or-create for the question tiles (host-implemented). */
  onQuestionTile?: (kind: "single_select" | "slider") => void;
  /** BLD-3 — the libhd search input (host-rendered, mock .search). */
  query?: string;
}) {
  const byType = new Map(PALETTE_BLOCKS.map((p) => [p.type, p]));
  const needle = query.trim().toLowerCase();
  const insert = (type: ContentBlockType) => {
    if (!node) return;
    commit(insertBlock(doc, node, type));
  };
  const allowed = (t: ContentBlockType) => {
    if (UNSUPPORTED.has(t)) return false;
    const host = SMART_HOST[t];
    return !host || node?.type === host;
  };
  const label = (t: ContentBlockType) => MOCK_LABEL[t] ?? byType.get(t)?.label ?? t;

  const questionTiles = onQuestionTile
    ? QUESTION_TILES.filter((q) => !needle || q.label.toLowerCase().includes(needle))
    : [];

  const groups: { name: string; tiles: ReactNode[] }[] = [];
  for (const g of GROUPS) {
    const tiles = g.types
      .filter(
        (t) =>
          allowed(t) && byType.has(t) && (!needle || label(t).toLowerCase().includes(needle)),
      )
      .map((t) => (
        <button
          key={t}
          type="button"
          className="qz-bt-comp"
          disabled={!node}
          draggable={!!node}
          onDragStart={(e) => {
            e.dataTransfer.setData(BLOCK_DRAG_MIME, t);
            e.dataTransfer.effectAllowed = "copy";
          }}
          onClick={() => insert(t)}
          title={
            node
              ? `Add ${label(t)} to this step — click, or drag onto the canvas`
              : "Select a step first"
          }
        >
          <span className="qz-block-glyph" aria-hidden="true">
            <BlockIcon type={t} />
          </span>
          <span>{label(t)}</span>
        </button>
      ));
    if (tiles.length) groups.push({ name: g.name, tiles });
  }
  // mock group order: Content · Questions · Social proof · Capture · Outcome.
  if (questionTiles.length) {
    groups.splice(Math.min(1, groups.length), 0, {
      name: "Questions",
      tiles: questionTiles.map((q) => (
        <button
          key={q.kind}
          type="button"
          className="qz-bt-comp"
          onClick={() => onQuestionTile?.(q.kind)}
          title={
            node?.type === "question"
              ? `Switch this question to ${q.label.toLowerCase()}`
              : `Add a new ${q.label.toLowerCase()} question screen`
          }
        >
          <span className="qz-block-glyph" aria-hidden="true">
            <BlockIcon type={q.icon} />
          </span>
          <span>{q.label}</span>
        </button>
      )),
    });
  }

  if (!groups.length) {
    return <div className="qz-bt-hint" style={{ textAlign: "center", padding: 12 }}>No components match &ldquo;{query}&rdquo;</div>;
  }
  return (
    <>
      {!node ? (
        <p className="qz-bt-hint" style={{ margin: 0 }}>
          Select a step below (or click an element in the canvas) to add blocks to it.
        </p>
      ) : null}
      {groups.map((g) => (
        <div key={g.name}>
          <span className="qz-bt-gl">{g.name}</span>
          <div className="qz-bt-libgrid">{g.tiles}</div>
        </div>
      ))}
    </>
  );
}
