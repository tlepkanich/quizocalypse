import { useState } from "react";
import { QzBadge, QzButton, QzField, QzInput, QzSelect, QzTextarea } from "../../qz";
import type { ContentBlock, Quiz, QuizNode } from "../../../lib/quizSchema";
import { synthesizeLayout } from "../../../lib/synthesizeLayout";
import {
  PALETTE_BLOCKS,
  blockAdd,
  blockMove,
  blockRemove,
  blockUpdate,
  getNodeLayout,
  makeBlock,
  setNodeLayout,
} from "../studioDoc";
import { NODE_LABEL } from "./nodeMeta";

// ════════════════════════════════════════════════════════════════════════════
// Layout panel — the Layout Library (Unified P0: extracted from StudioBuilder
// verbatim — template ↔ blocks, block rows, and the BlockStyle field grid).
// ════════════════════════════════════════════════════════════════════════════

type QuizDoc = Quiz;

export function LayoutTab({
  doc,
  node,
  onCommit,
}: {
  doc: QuizDoc;
  node: QuizNode;
  onCommit: (doc: QuizDoc) => void;
}) {
  const layout = getNodeLayout(doc, node.id);
  const onTemplate = !layout;

  if (node.type === "branch" || node.type === "integration") {
    return (
      <p className="qz-dim" style={{ fontSize: 13 }}>
        {NODE_LABEL[node.type]} steps are invisible to shoppers — no layout to compose.
      </p>
    );
  }

  if (onTemplate) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <QzBadge tone="ok">On template</QzBadge>
        <p className="qz-dim" style={{ fontSize: 13, margin: 0 }}>
          This step renders its default template. Break it into editable blocks to rearrange,
          restyle, and add sections.
        </p>
        <QzButton
          size="sm"
          variant="primary"
          onClick={() => onCommit(setNodeLayout(doc, node.id, synthesizeLayout(node)))}
        >
          Break into blocks
        </QzButton>
        {/* Editor revamp P5 — "show picture on a page in different areas":
            one-click image placement (synthesize + insert in a single commit). */}
        <div className="qz-row" style={{ gap: 6 }}>
          <QzButton
            size="sm"
            variant="ghost"
            onClick={() => {
              const blocks = synthesizeLayout(node);
              if (!blocks) return;
              onCommit(setNodeLayout(doc, node.id, [makeBlock("image"), ...blocks]));
            }}
          >
            + Image above
          </QzButton>
          <QzButton
            size="sm"
            variant="ghost"
            onClick={() => {
              const blocks = synthesizeLayout(node);
              if (!blocks) return;
              onCommit(setNodeLayout(doc, node.id, [...blocks, makeBlock("image")]));
            }}
          >
            + Image below
          </QzButton>
        </div>
      </div>
    );
  }

  const blocks = layout;
  const setBlocks = (next: ContentBlock[] | null) =>
    onCommit(setNodeLayout(doc, node.id, next));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="qz-row qz-row-between" style={{ alignItems: "center" }}>
        <QzBadge tone="warn">Customized</QzBadge>
        <button
          onClick={() => setBlocks(null)}
          className="qz-btn qz-btn-ghost qz-btn-sm"
          title="Discard blocks and return to the default template"
        >
          Reset to template
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {blocks.map((b, i) => (
          <BlockRow
            key={b.id}
            block={b}
            first={i === 0}
            last={i === blocks.length - 1}
            onChange={(patch) => setBlocks(blockUpdate(blocks, b.id, patch))}
            onMove={(dir) => setBlocks(blockMove(blocks, b.id, dir))}
            onRemove={() => setBlocks(blockRemove(blocks, b.id))}
          />
        ))}
      </div>

      <div>
        <div className="qz-label" style={{ marginBottom: 6 }}>
          Add layout section
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {PALETTE_BLOCKS.map((p) => (
            <button
              key={p.type}
              onClick={() => setBlocks(blockAdd(blocks, makeBlock(p.type)))}
              className="qz-btn qz-btn-ghost qz-btn-sm"
              title={`Add ${p.label}`}
            >
              <span style={{ marginRight: 6 }}>{p.glyph}</span>
              {p.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function BlockRow({
  block,
  first,
  last,
  onChange,
  onMove,
  onRemove,
}: {
  block: ContentBlock;
  first: boolean;
  last: boolean;
  onChange: (patch: Partial<ContentBlock>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="qz-card" style={{ padding: 8 }}>
      <div className="qz-row qz-row-between" style={{ alignItems: "center" }}>
        <button
          onClick={() => setOpen((o) => !o)}
          style={{
            border: "none",
            background: "transparent",
            cursor: "pointer",
            fontWeight: 600,
            fontSize: 13,
            textTransform: "capitalize",
          }}
        >
          {open ? "▾" : "▸"} {block.type.replace("_", " ")}
        </button>
        <div className="qz-row" style={{ gap: 2 }}>
          <button disabled={first} onClick={() => onMove(-1)} className="qz-btn qz-btn-ghost qz-btn-sm">↑</button>
          <button disabled={last} onClick={() => onMove(1)} className="qz-btn qz-btn-ghost qz-btn-sm">↓</button>
          <button onClick={onRemove} className="qz-btn qz-btn-ghost qz-btn-sm">✕</button>
        </div>
      </div>
      {open ? <BlockFields block={block} onChange={onChange} /> : null}
    </div>
  );
}

function BlockFields({
  block,
  onChange,
}: {
  block: ContentBlock;
  onChange: (patch: Partial<ContentBlock>) => void;
}) {
  return (
    <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
      {block.type === "heading" ? (
        <>
          <QzField label="Bind">
            <QzSelect
              value={block.bind}
              onChange={(e) => onChange({ bind: e.target.value } as Partial<ContentBlock>)}
            >
              <option value="none">Literal text</option>
              <option value="headline">Headline</option>
              <option value="text">Question text</option>
              <option value="persona_name">Persona name</option>
            </QzSelect>
          </QzField>
          {block.bind === "none" ? (
            <QzField label="Text">
              <QzInput value={block.text} onChange={(e) => onChange({ text: e.target.value })} />
            </QzField>
          ) : null}
          <QzField label="Level">
            <QzSelect
              value={block.level}
              onChange={(e) => onChange({ level: e.target.value } as Partial<ContentBlock>)}
            >
              <option value="h1">H1</option>
              <option value="h2">H2</option>
            </QzSelect>
          </QzField>
        </>
      ) : null}
      {block.type === "text" ? (
        <QzField label="Text">
          <QzTextarea
            value={block.text}
            onChange={(e) => onChange({ text: e.target.value })}
            rows={2}
          />
        </QzField>
      ) : null}
      {block.type === "image" ? (
        <QzField label="Image URL">
          <QzInput
            value={block.url ?? ""}
            onChange={(e) => onChange({ url: e.target.value } as Partial<ContentBlock>)}
          />
        </QzField>
      ) : null}
      {block.type === "button" ? (
        <QzField label="Label">
          <QzInput value={block.label} onChange={(e) => onChange({ label: e.target.value })} />
        </QzField>
      ) : null}
      {block.type === "spacer" ? (
        <QzField label="Size (px)">
          <QzInput
            type="number"
            value={block.size}
            onChange={(e) => onChange({ size: Number(e.target.value) } as Partial<ContentBlock>)}
          />
        </QzField>
      ) : null}
      <QzField label="Alignment">
        <QzSelect
          value={block.style.align ?? ""}
          onChange={(e) =>
            onChange({
              style: { ...block.style, align: (e.target.value || undefined) as never },
            } as Partial<ContentBlock>)
          }
        >
          <option value="">Default</option>
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </QzSelect>
      </QzField>
      {/* Editor revamp P5 — the BlockStyle sizing/color fields existed in the
          schema since 2A but were never exposed. A compact grid: blank = theme
          default (undefined strips the override). */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <QzField label="Font size (px)">
          <QzInput
            type="number"
            value={block.style.font_size ?? ""}
            placeholder="auto"
            onChange={(e) =>
              onChange({
                style: {
                  ...block.style,
                  font_size: e.target.value ? Number(e.target.value) : undefined,
                },
              } as Partial<ContentBlock>)
            }
          />
        </QzField>
        <QzField label="Padding (px)">
          <QzInput
            type="number"
            value={block.style.padding ?? ""}
            placeholder="auto"
            onChange={(e) =>
              onChange({
                style: {
                  ...block.style,
                  padding: e.target.value ? Number(e.target.value) : undefined,
                },
              } as Partial<ContentBlock>)
            }
          />
        </QzField>
        <QzField label="Max width (px)">
          <QzInput
            type="number"
            value={block.style.max_width ?? ""}
            placeholder="auto"
            onChange={(e) =>
              onChange({
                style: {
                  ...block.style,
                  max_width: e.target.value ? Number(e.target.value) : undefined,
                },
              } as Partial<ContentBlock>)
            }
          />
        </QzField>
        <QzField label="Corners">
          <QzSelect
            value={block.style.radius ?? ""}
            onChange={(e) =>
              onChange({
                style: { ...block.style, radius: (e.target.value || undefined) as never },
              } as Partial<ContentBlock>)
            }
          >
            <option value="">Default</option>
            <option value="square">Square</option>
            <option value="rounded">Rounded</option>
            <option value="pill">Pill</option>
          </QzSelect>
        </QzField>
        <QzField label="Text color">
          <QzInput
            value={block.style.text_color ?? ""}
            placeholder="#1b1a17"
            onChange={(e) =>
              onChange({
                style: { ...block.style, text_color: e.target.value || undefined },
              } as Partial<ContentBlock>)
            }
          />
        </QzField>
        <QzField label="Background">
          <QzInput
            value={block.style.background ?? ""}
            placeholder="transparent"
            onChange={(e) =>
              onChange({
                style: { ...block.style, background: e.target.value || undefined },
              } as Partial<ContentBlock>)
            }
          />
        </QzField>
      </div>
    </div>
  );
}
