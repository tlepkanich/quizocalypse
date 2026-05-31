import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useFetcher, useLoaderData } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import {
  QzPage,
  QzPageHeader,
  QzCard,
  QzButton,
  QzBanner,
  QzBadge,
  QzField,
  QzInput,
  QzTextarea,
  QzSelect,
} from "../components/qz";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
  type Connection,
  type NodeChange,
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  applyNodeChanges,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Quiz } from "../lib/quizSchema";
import {
  loadQuizEditorData,
  handleQuizEditorAction,
} from "../lib/quizEditorIO.server";
import {
  recommendForResult,
  type IndexedProduct,
} from "../lib/recommendationEngine";
import {
  buttonStyle,
  resolveDesignTokens,
  tokensToCssVars,
  type DesignTokensT,
} from "../lib/designTokens";
import { resolveNodeOverride } from "../lib/resultLayout";
import {
  addAnswer,
  addAskAINode,
  addBranchNode,
  addBranchSlot,
  addEdge as addQuizEdge,
  addEmailGateNode,
  addEndNode,
  addIntegrationNode,
  addMessageNode,
  addProductCardsNode,
  addQuestionNode,
  addResultNode,
  deleteEdge as deleteQuizEdge,
  deleteNode as deleteQuizNode,
  removeAnswer,
  removeBranchSlot,
  setEdgeCondition,
  setNodePosition,
} from "../lib/quizMutations";
import { autoLayout } from "../lib/autoLayout";
import { validateQuiz, type NodeIssue } from "../lib/quizValidation";
import type { z } from "zod";

type QuizDoc = z.infer<typeof Quiz>;
type QuizNodeDoc = QuizDoc["nodes"][number];

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const { id } = params;
  if (!id) throw new Response("Missing quiz id", { status: 400 });
  return json(await loadQuizEditorData(request, id));
};

export const action = async ({ params, request }: ActionFunctionArgs) => {
  const { id } = params;
  if (!id) return json({ ok: false, error: "Missing id" }, { status: 400 });
  return handleQuizEditorAction(request, id);
};

// ---------- Custom node renderers (React Flow) ----------
// These use plain HTML inputs and inherit the redesign palette via CSS vars
// when possible. Node accent colors stay distinct so node types remain
// visually identifiable in the graph.

interface NodeData extends Record<string, unknown> {
  doc: QuizNodeDoc;
  issues: NodeIssue[];
  hasDrift: boolean;
  onChange: (next: QuizNodeDoc) => void;
  onAddAnswer: (nodeId: string) => void;
  onRemoveAnswer: (nodeId: string, answerId: string) => void;
  onHandlePlus: (nodeId: string, handle?: string) => void;
}

// True if the node's desktop and mobile breakpoint overrides differ from each
// other (shallow JSON compare — overrides are pure data). Used to surface a
// drift badge on the canvas so authors know which breakpoint they last touched.
function hasBreakpointDrift(
  bpOverrides: QuizDoc["breakpoint_overrides"],
  nodeId: string,
): boolean {
  const rec = bpOverrides[nodeId];
  if (!rec) return false;
  const desktop = rec.desktop ?? {};
  const mobile = rec.mobile ?? {};
  return JSON.stringify(desktop) !== JSON.stringify(mobile);
}

function IntroNodeView({ data }: NodeProps) {
  const d = data as NodeData;
  if (d.doc.type !== "intro") return null;
  return (
    <NodeShell accent="#5563DE" label="welcome" handles="source" issues={d.issues} hasDrift={d.hasDrift} onPlus={() => d.onHandlePlus(d.doc.id)}>
      <NodeField
        label="Headline"
        value={d.doc.data.headline}
        onChange={(v) =>
          d.onChange({ ...d.doc, data: { ...d.doc.data, headline: v } as never })
        }
      />
      <NodeField
        label="Subtext"
        value={d.doc.data.subtext}
        onChange={(v) =>
          d.onChange({ ...d.doc, data: { ...d.doc.data, subtext: v } as never })
        }
        multiline
      />
      <NodeField
        label="Button"
        value={d.doc.data.button_label}
        onChange={(v) =>
          d.onChange({
            ...d.doc,
            data: { ...d.doc.data, button_label: v } as never,
          })
        }
      />
    </NodeShell>
  );
}

function QuestionNodeView({ data }: NodeProps) {
  const d = data as NodeData;
  if (d.doc.type !== "question") return null;
  const answers = d.doc.data.answers;
  const isFreeform =
    d.doc.data.question_type === "text" || d.doc.data.question_type === "email";
  return (
    <NodeShell accent="#2C7A4B" label={`question · ${d.doc.data.question_type}`} issues={d.issues} hasDrift={d.hasDrift}>
      <Handle type="target" position={Position.Left} />
      <NodeField
        label="Question"
        value={d.doc.data.text}
        onChange={(v) =>
          d.onChange({ ...d.doc, data: { ...d.doc.data, text: v } as never })
        }
        multiline
      />
      <div style={{ marginTop: 8, fontSize: 11, color: "var(--qz-ink-3)" }}>
        {isFreeform ? "Seed answer (drives tags + routing)" : "Answers"}
      </div>
      {answers.map((answer, idx) => (
        <div key={answer.id} style={{ position: "relative" }}>
          <InlineNoDrag>
            <NodeField
              label={`#${idx + 1}`}
              inline
              value={answer.text}
              onChange={(v) => {
                const next = [...answers];
                next[idx] = { ...answer, text: v };
                d.onChange({
                  ...d.doc,
                  data: { ...d.doc.data, answers: next } as never,
                });
              }}
            />
            {answers.length > (isFreeform ? 1 : 2) && (
              <button
                type="button"
                onClick={() => d.onRemoveAnswer(d.doc.id, answer.id)}
                style={btnIcon}
                title="Remove answer"
              >
                ×
              </button>
            )}
          </InlineNoDrag>
          <Handle
            type="source"
            position={Position.Right}
            id={answer.edge_handle_id}
            style={{
              top: undefined,
              right: -6,
              background: "#2C7A4B",
              width: 10,
              height: 10,
            }}
          />
          <HandlePlus
            onClick={() => d.onHandlePlus(d.doc.id, answer.edge_handle_id)}
            ariaLabel={`Add next module after answer ${idx + 1}`}
          />
        </div>
      ))}
      {!isFreeform && (
        <InlineNoDrag>
          <button
            type="button"
            onClick={() => d.onAddAnswer(d.doc.id)}
            style={btnGhost}
          >
            + Add answer
          </button>
        </InlineNoDrag>
      )}
    </NodeShell>
  );
}

function EmailGateNodeView({ data }: NodeProps) {
  const d = data as NodeData;
  if (d.doc.type !== "email_gate") return null;
  return (
    <NodeShell accent="#7E57C2" label="email_gate" handles="both" issues={d.issues} hasDrift={d.hasDrift} onPlus={() => d.onHandlePlus(d.doc.id)}>
      <NodeField
        label="Headline"
        value={d.doc.data.headline}
        onChange={(v) =>
          d.onChange({ ...d.doc, data: { ...d.doc.data, headline: v } as never })
        }
      />
      <NodeField
        label="Subtext"
        value={d.doc.data.subtext}
        onChange={(v) =>
          d.onChange({ ...d.doc, data: { ...d.doc.data, subtext: v } as never })
        }
        multiline
      />
    </NodeShell>
  );
}

function ResultNodeView({ data }: NodeProps) {
  const d = data as NodeData;
  if (d.doc.type !== "result") return null;
  return (
    <NodeShell accent="#BB6622" label="result" handles="target" issues={d.issues} hasDrift={d.hasDrift}>
      <NodeField
        label="Headline"
        value={d.doc.data.headline}
        onChange={(v) =>
          d.onChange({ ...d.doc, data: { ...d.doc.data, headline: v } as never })
        }
      />
      <NodeField
        label="Subtext"
        value={d.doc.data.subtext}
        onChange={(v) =>
          d.onChange({ ...d.doc, data: { ...d.doc.data, subtext: v } as never })
        }
        multiline
      />
      <NodeField
        label="CTA"
        value={d.doc.data.cta_label}
        onChange={(v) =>
          d.onChange({ ...d.doc, data: { ...d.doc.data, cta_label: v } as never })
        }
      />
      <NodeField
        label="Fallback collection"
        value={d.doc.data.fallback_collection_id}
        onChange={(v) =>
          d.onChange({
            ...d.doc,
            data: { ...d.doc.data, fallback_collection_id: v } as never,
          })
        }
      />
      <div style={{ marginTop: 6, fontSize: 10, color: "var(--qz-ink-4)" }}>
        slots: {d.doc.data.slot_count}
      </div>
    </NodeShell>
  );
}

function MessageNodeView({ data }: NodeProps) {
  const d = data as NodeData;
  if (d.doc.type !== "message") return null;
  return (
    <NodeShell accent="#3D7E9F" label="message" handles="both" issues={d.issues} hasDrift={d.hasDrift} onPlus={() => d.onHandlePlus(d.doc.id)}>
      <NodeField
        label="Text"
        value={d.doc.data.text}
        onChange={(v) =>
          d.onChange({ ...d.doc, data: { ...d.doc.data, text: v } as never })
        }
        multiline
      />
      <div style={{ marginTop: 6, fontSize: 10, color: "var(--qz-ink-4)" }}>
        merge tags: @name, @email, @answer.&lt;id&gt;
      </div>
    </NodeShell>
  );
}

function EndNodeView({ data }: NodeProps) {
  const d = data as NodeData;
  if (d.doc.type !== "end") return null;
  return (
    <NodeShell accent="#7C5295" label="end" handles="target" issues={d.issues} hasDrift={d.hasDrift}>
      <NodeField
        label="Headline"
        value={d.doc.data.headline}
        onChange={(v) =>
          d.onChange({ ...d.doc, data: { ...d.doc.data, headline: v } as never })
        }
      />
      <NodeField
        label="Subtext"
        value={d.doc.data.subtext}
        onChange={(v) =>
          d.onChange({ ...d.doc, data: { ...d.doc.data, subtext: v } as never })
        }
        multiline
      />
      {(d.doc.data.cta_label || d.doc.data.cta_url) && (
        <div style={{ marginTop: 6, fontSize: 10, color: "var(--qz-ink-4)" }}>
          CTA: {d.doc.data.cta_label ?? "(no label)"}
        </div>
      )}
      {d.doc.data.redirect_url && (
        <div style={{ marginTop: 4, fontSize: 10, color: "var(--qz-ink-4)" }}>
          → auto-redirect
        </div>
      )}
    </NodeShell>
  );
}

function BranchNodeView({ data }: NodeProps) {
  const d = data as NodeData;
  if (d.doc.type !== "branch") return null;
  const branchDoc = d.doc;
  const branchData = branchDoc.data;
  const slots = branchData.slots;
  return (
    <NodeShell
      accent="#C4673B"
      label={`branch · ${branchData.mode}`}
      issues={d.issues}
      hasDrift={d.hasDrift}
    >
      <Handle type="target" position={Position.Left} />
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: "var(--qz-ink)",
          marginBottom: 6,
        }}
      >
        {branchData.label}
      </div>
      <div style={{ fontSize: 10, color: "var(--qz-ink-3)", marginBottom: 8 }}>
        {branchData.mode === "ab_split"
          ? "A/B split — weighted random, sticky per session"
          : "Rules — first matching slot wins"}
      </div>
      {slots.map((slot) => (
        <div
          key={slot.id}
          style={{
            position: "relative",
            padding: "6px 8px",
            border: "1px solid var(--qz-rule)",
            borderRadius: "var(--qz-radius)",
            marginBottom: 4,
            background: "var(--qz-cream-2)",
            fontSize: 11,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span style={{ fontWeight: 600 }}>{slot.label}</span>
          {branchData.mode === "ab_split" && (
            <span
              className="qz-mono"
              style={{ fontSize: 10, color: "var(--qz-ink-3)" }}
            >
              w{slot.weight}
            </span>
          )}
          <Handle
            type="source"
            position={Position.Right}
            id={slot.id}
            style={{
              top: undefined,
              right: -6,
              background: "#C4673B",
              width: 10,
              height: 10,
            }}
          />
          <HandlePlus
            onClick={() => d.onHandlePlus(branchDoc.id, slot.id)}
            ariaLabel={`Add next module from branch slot ${slot.label}`}
          />
        </div>
      ))}
    </NodeShell>
  );
}

function AskAINodeView({ data }: NodeProps) {
  const d = data as NodeData;
  if (d.doc.type !== "ask_ai") return null;
  const aiData = d.doc.data;
  return (
    <NodeShell
      accent="#1F7A6E"
      label="ask AI · chat"
      handles="both"
      issues={d.issues}
      hasDrift={d.hasDrift}
      onPlus={() => d.onHandlePlus(d.doc.id)}
    >
      <div style={{ fontSize: 11, color: "var(--qz-ink-3)", marginBottom: 4 }}>
        Persona
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
        {aiData.persona_name}
      </div>
      <div style={{ fontSize: 11, color: "var(--qz-ink-3)", marginBottom: 4 }}>
        Opener
      </div>
      <div
        style={{
          fontSize: 11,
          color: "var(--qz-ink-2)",
          marginBottom: 6,
          fontStyle: "italic",
        }}
      >
        “{aiData.opening_message.slice(0, 80)}
        {aiData.opening_message.length > 80 ? "…" : ""}”
      </div>
      <div style={{ fontSize: 10, color: "var(--qz-ink-4)" }}>
        {aiData.suggested_questions.length} suggested ·{" "}
        {aiData.max_turns} turn cap
      </div>
    </NodeShell>
  );
}

function IntegrationNodeView({ data }: NodeProps) {
  const d = data as NodeData;
  if (d.doc.type !== "integration") return null;
  const intData = d.doc.data;
  return (
    <NodeShell
      accent="#A855F7"
      label="integration · auto"
      handles="both"
      issues={d.issues}
      hasDrift={d.hasDrift}
      onPlus={() => d.onHandlePlus(d.doc.id)}
    >
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
        {intData.label}
      </div>
      <div style={{ fontSize: 10, color: "var(--qz-ink-3)", marginBottom: 4 }}>
        {intData.actions.length} action{intData.actions.length === 1 ? "" : "s"}
      </div>
      {intData.actions.map((a, i) => (
        <div
          key={i}
          style={{
            fontSize: 10,
            color: "var(--qz-ink-2)",
            fontFamily: "var(--qz-font-mono)",
            padding: "2px 6px",
            background: "var(--qz-cream-2)",
            borderRadius: 3,
            marginBottom: 3,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {a.kind === "webhook"
            ? `webhook: ${a.url.replace(/^https?:\/\//, "")}`
            : `klaviyo${a.list_id ? `: list ${a.list_id}` : ""}`}
        </div>
      ))}
      <div style={{ fontSize: 10, color: "var(--qz-ink-4)", marginTop: 4 }}>
        {intData.continue_on_error ? "continues on error" : "stops on error"}
      </div>
    </NodeShell>
  );
}

function ProductCardsNodeView({ data }: NodeProps) {
  const d = data as NodeData;
  if (d.doc.type !== "product_cards") return null;
  const pcData = d.doc.data;
  return (
    <NodeShell
      accent="#16A085"
      label={`product cards · ${pcData.product_ids.length}`}
      handles="both"
      issues={d.issues}
      hasDrift={d.hasDrift}
      onPlus={() => d.onHandlePlus(d.doc.id)}
    >
      <NodeField
        label="Headline"
        value={pcData.headline}
        onChange={(v) =>
          d.onChange({ ...d.doc, data: { ...d.doc.data, headline: v } as never })
        }
      />
      <div style={{ fontSize: 10, color: "var(--qz-ink-3)", marginTop: 6 }}>
        {pcData.product_ids.length} product{pcData.product_ids.length === 1 ? "" : "s"}
        {" · "}
        CTA: {pcData.cta_label}
      </div>
    </NodeShell>
  );
}

const nodeTypes = {
  intro: IntroNodeView,
  question: QuestionNodeView,
  email_gate: EmailGateNodeView,
  result: ResultNodeView,
  message: MessageNodeView,
  end: EndNodeView,
  branch: BranchNodeView,
  ask_ai: AskAINodeView,
  integration: IntegrationNodeView,
  product_cards: ProductCardsNodeView,
};

// Small "+" button that floats off the right edge of a source handle. Opens
// the module picker so the author can pick what kind of node to add next.
// Drag-to-connect still works — this is just the click-driven alternative.
function HandlePlus({
  onClick,
  top,
  ariaLabel,
}: {
  onClick: () => void;
  top?: number | string;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel ?? "Add next module"}
      title={ariaLabel ?? "Add next module"}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onMouseDown={(e) => e.stopPropagation()}
      className="nodrag nopan"
      style={{
        position: "absolute",
        right: -28,
        top: top ?? "50%",
        transform: top === undefined ? "translateY(-50%)" : "none",
        width: 18,
        height: 18,
        borderRadius: 9,
        border: "1px solid var(--qz-rule)",
        background: "var(--qz-paper)",
        color: "var(--qz-ink)",
        fontSize: 13,
        fontWeight: 700,
        lineHeight: 1,
        cursor: "pointer",
        boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
        zIndex: 4,
        padding: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      +
    </button>
  );
}

function NodeShell({
  accent,
  label,
  children,
  handles,
  issues,
  hasDrift,
  onPlus,
}: {
  accent: string;
  label: string;
  children: React.ReactNode;
  handles?: "source" | "target" | "both";
  issues: NodeIssue[];
  hasDrift?: boolean;
  onPlus?: () => void;
}) {
  const hasIssue = issues.length > 0;
  return (
    <div
      style={{
        background: "var(--qz-paper)",
        border: `2px solid ${hasIssue ? "var(--qz-crit)" : accent}`,
        borderRadius: "var(--qz-radius-lg)",
        padding: 12,
        minWidth: 260,
        maxWidth: 320,
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
        fontSize: 12,
        fontFamily: "var(--qz-font-body)",
        position: "relative",
      }}
    >
      {(handles === "target" || handles === "both") && (
        <Handle type="target" position={Position.Left} />
      )}
      <div
        style={{
          fontFamily: "var(--qz-font-mono)",
          fontSize: 10,
          color: accent,
          textTransform: "uppercase",
          fontWeight: 600,
          letterSpacing: "0.1em",
          marginBottom: 8,
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>{label}</span>
        <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {hasDrift && (
            <span
              title="Desktop and mobile overrides differ for this node."
              style={{
                background: "var(--qz-paper)",
                color: "var(--qz-ink-2)",
                border: "1px solid var(--qz-rule)",
                borderRadius: 4,
                padding: "1px 5px",
                fontSize: 10,
                fontWeight: 700,
                lineHeight: 1,
              }}
            >
              ◐
            </span>
          )}
          {hasIssue && (
            <span
              title={issues.map((i) => i.message).join(" · ")}
              style={{
                background: "var(--qz-crit)",
                color: "#FFF",
                borderRadius: 4,
                padding: "1px 6px",
                fontSize: 9,
              }}
            >
              {issues.length} issue{issues.length === 1 ? "" : "s"}
            </span>
          )}
        </span>
      </div>
      {children}
      {(handles === "source" || handles === "both") && (
        <>
          <Handle type="source" position={Position.Right} />
          {onPlus && <HandlePlus onClick={onPlus} />}
        </>
      )}
    </div>
  );
}

function NodeField({
  label,
  value,
  onChange,
  multiline,
  inline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  inline?: boolean;
}) {
  const Tag = multiline ? "textarea" : "input";
  return (
    <label
      style={{ display: "block", marginBottom: inline ? 4 : 8 }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <span
        style={{
          fontFamily: "var(--qz-font-mono)",
          fontSize: 10,
          color: "var(--qz-ink-3)",
          display: "block",
          marginBottom: 2,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        {label}
      </span>
      <Tag
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={multiline ? 2 : undefined}
        style={{
          width: "100%",
          padding: "5px 8px",
          border: "1px solid var(--qz-rule)",
          borderRadius: "var(--qz-radius)",
          fontSize: 12,
          fontFamily: "inherit",
          resize: multiline ? "vertical" : "none",
          boxSizing: "border-box",
          background: "var(--qz-cream)",
        }}
      />
    </label>
  );
}

function InlineNoDrag({ children }: { children: React.ReactNode }) {
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{ display: "flex", alignItems: "center", gap: 6 }}
    >
      {children}
    </div>
  );
}

const btnIcon: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--qz-rule)",
  borderRadius: "var(--qz-radius)",
  cursor: "pointer",
  width: 22,
  height: 22,
  fontSize: 16,
  lineHeight: 1,
  color: "var(--qz-ink-3)",
};

const btnGhost: React.CSSProperties = {
  background: "transparent",
  border: "1px dashed var(--qz-ink-4)",
  borderRadius: "var(--qz-radius)",
  padding: "5px 10px",
  cursor: "pointer",
  fontSize: 11,
  fontFamily: "var(--qz-font-mono)",
  color: "var(--qz-ink-3)",
  width: "100%",
  marginTop: 8,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};

// ---------- Builder component ----------

function FlowBuilder({
  initialDoc,
  collections,
  catalogTags,
  productIndex,
  onChange,
  onRegenerate,
  regenState,
  regenError,
}: {
  initialDoc: QuizDoc;
  collections: Array<{ collectionId: string; title: string }>;
  catalogTags: string[];
  productIndex: IndexedProduct[];
  onChange: (next: QuizDoc) => void;
  onRegenerate: (nodeId: string, steeringPrompt: string) => void;
  regenState: "idle" | "submitting" | "loading";
  regenError: string | null;
}) {
  const [doc, setDoc] = useState<QuizDoc>(initialDoc);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  const commit = useCallback(
    (next: QuizDoc) => {
      setDoc(next);
      onChange(next);
    },
    [onChange],
  );

  const issuesByNode = useMemo(() => {
    const map = new Map<string, NodeIssue[]>();
    for (const issue of validateQuiz(doc)) {
      const existing = map.get(issue.nodeId) ?? [];
      existing.push(issue);
      map.set(issue.nodeId, existing);
    }
    return map;
  }, [doc]);

  const updateNode = useCallback(
    (next: QuizNodeDoc) => {
      commit({
        ...doc,
        nodes: doc.nodes.map((n) => (n.id === next.id ? next : n)),
      });
    },
    [doc, commit],
  );

  const handleAddAnswer = useCallback(
    (nodeId: string) => commit(addAnswer(doc, nodeId)),
    [doc, commit],
  );
  const handleRemoveAnswer = useCallback(
    (nodeId: string, answerId: string) =>
      commit(removeAnswer(doc, nodeId, answerId)),
    [doc, commit],
  );

  // Module-picker state lives at FlowBuilder scope so any node's `+` button
  // can pop the picker. handleHandlePlus is hoisted above rfNodes because
  // rfNodes' useMemo references it in its deps.
  const [pickerSource, setPickerSource] = useState<
    { nodeId: string; handle?: string } | null
  >(null);
  const handleHandlePlus = useCallback((nodeId: string, handle?: string) => {
    setPickerSource({ nodeId, handle });
  }, []);

  const rfNodes: Node[] = useMemo(
    () =>
      doc.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        position: n.position,
        data: {
          doc: n,
          issues: issuesByNode.get(n.id) ?? [],
          hasDrift: hasBreakpointDrift(doc.breakpoint_overrides, n.id),
          onChange: updateNode,
          onAddAnswer: handleAddAnswer,
          onRemoveAnswer: handleRemoveAnswer,
          onHandlePlus: handleHandlePlus,
        } satisfies NodeData,
        ...(selectedId === n.id ? { selected: true } : {}),
      })),
    [
      doc.nodes,
      doc.breakpoint_overrides,
      issuesByNode,
      updateNode,
      handleAddAnswer,
      handleRemoveAnswer,
      handleHandlePlus,
      selectedId,
    ],
  );

  const rfEdges: Edge[] = useMemo(
    () =>
      doc.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        ...(e.source_handle ? { sourceHandle: e.source_handle } : {}),
      })),
    [doc.edges],
  );

  const [nodes, setNodes] = useNodesState(rfNodes);
  const [edges, setEdges] = useEdgesState(rfEdges);

  useEffect(() => {
    setNodes(rfNodes);
  }, [rfNodes, setNodes]);
  useEffect(() => {
    setEdges(rfEdges);
  }, [rfEdges, setEdges]);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((nds) => applyNodeChanges(changes, nds));
      for (const change of changes) {
        if (change.type === "position" && change.dragging === false && change.position) {
          commit(setNodePosition(doc, change.id, change.position));
        }
        if (change.type === "select" && change.selected) {
          setSelectedId(change.id);
        }
      }
    },
    [doc, commit, setNodes],
  );

  const handleConnect = useCallback(
    (params: Connection) => {
      if (!params.source || !params.target) return;
      commit(
        addQuizEdge(
          doc,
          params.source,
          params.target,
          params.sourceHandle ?? undefined,
        ),
      );
    },
    [doc, commit],
  );

  const handleNodesDelete = useCallback(
    (deleted: Node[]) => {
      let next = doc;
      for (const n of deleted) {
        if (n.type === "intro") continue;
        next = deleteQuizNode(next, n.id);
      }
      if (next !== doc) commit(next);
    },
    [doc, commit],
  );

  const handleEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      let next = doc;
      for (const e of deleted) next = deleteQuizEdge(next, e.id);
      if (next !== doc) commit(next);
    },
    [doc, commit],
  );

  const handleAutoLayout = useCallback(() => {
    commit(autoLayout(doc));
  }, [doc, commit]);

  const handleAddNode = useCallback(
    (
      kind:
        | "question"
        | "result"
        | "email_gate"
        | "message"
        | "end"
        | "branch"
        | "ask_ai"
        | "integration"
        | "product_cards",
    ) => {
      setAddMenuOpen(false);
      const anchor = selectedId;
      if (kind === "question") commit(addQuestionNode(doc, anchor));
      else if (kind === "email_gate") commit(addEmailGateNode(doc, anchor));
      else if (kind === "message") commit(addMessageNode(doc, anchor));
      else if (kind === "end") commit(addEndNode(doc, anchor));
      else if (kind === "branch") commit(addBranchNode(doc, anchor));
      else if (kind === "ask_ai") commit(addAskAINode(doc, anchor));
      else if (kind === "integration") commit(addIntegrationNode(doc, anchor));
      else if (kind === "product_cards")
        commit(addProductCardsNode(doc, anchor));
      else {
        const fallback = collections[0]?.collectionId ?? "";
        commit(addResultNode(doc, anchor, fallback));
      }
    },
    [doc, commit, selectedId, collections],
  );

  // Picker → create node + edge, then select it. Hoisting note: pickerSource
  // state and handleHandlePlus live above rfNodes; handlePickerPick can stay
  // here because it isn't referenced until render of the popover.
  const handlePickerPick = useCallback(
    (
      kind:
        | "question"
        | "result"
        | "email_gate"
        | "message"
        | "end"
        | "branch"
        | "ask_ai"
        | "integration"
        | "product_cards",
    ) => {
      if (!pickerSource) return;
      const anchor = pickerSource.nodeId;
      const handle = pickerSource.handle;
      let next: QuizDoc;
      if (kind === "question") next = addQuestionNode(doc, anchor, handle);
      else if (kind === "email_gate")
        next = addEmailGateNode(doc, anchor, handle);
      else if (kind === "message") next = addMessageNode(doc, anchor, handle);
      else if (kind === "end") next = addEndNode(doc, anchor, handle);
      else if (kind === "branch") next = addBranchNode(doc, anchor, handle);
      else if (kind === "ask_ai") next = addAskAINode(doc, anchor, handle);
      else if (kind === "integration")
        next = addIntegrationNode(doc, anchor, handle);
      else if (kind === "product_cards")
        next = addProductCardsNode(doc, anchor, handle);
      else {
        const fallback = collections[0]?.collectionId ?? "";
        next = addResultNode(doc, anchor, fallback, handle);
      }
      // The freshly created node is the last one in next.nodes.
      const newNodeId = next.nodes[next.nodes.length - 1]?.id ?? null;
      commit(next);
      if (newNodeId) setSelectedId(newNodeId);
      setPickerSource(null);
    },
    [doc, commit, pickerSource, collections, setSelectedId],
  );

  const allIssues = useMemo(() => validateQuiz(doc), [doc]);

  const selectedNode = useMemo(
    () => doc.nodes.find((n) => n.id === selectedId) ?? null,
    [doc.nodes, selectedId],
  );

  const [allPathsOpen, setAllPathsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const applyDesignToAll = useCallback(
    (type: "question" | "result", tokens: DesignTokensT) => {
      const overrides = { ...doc.design_overrides };
      for (const n of doc.nodes) {
        if (n.type === type) overrides[n.id] = tokens;
      }
      commit({ ...doc, design_overrides: overrides });
    },
    [doc, commit],
  );

  return (
    <div style={{ width: "100%" }}>
      <div
        className="qz-row qz-row-between"
        style={{ marginBottom: 12, flexWrap: "wrap", gap: 8 }}
      >
        <div className="qz-row qz-gap-8">
          <QzButton size="sm" onClick={handleAutoLayout}>
            Auto-layout
          </QzButton>
          <QzButton size="sm" onClick={() => setAllPathsOpen(true)}>
            View all paths
          </QzButton>
          <Link to="pages" prefetch="intent" style={{ textDecoration: "none" }}>
            <QzButton size="sm">Result pages</QzButton>
          </Link>
          <QzButton size="sm" onClick={() => setSettingsOpen(true)}>
            Settings
          </QzButton>
          {allIssues.length > 0 && (
            <QzBadge tone="crit">
              {`${allIssues.length} issue${allIssues.length === 1 ? "" : "s"}`}
            </QzBadge>
          )}
        </div>
        <span className="qz-mono qz-dim" style={{ fontSize: 11 }}>
          {doc.nodes.length} nodes · {doc.edges.length} edges · Delete to remove
          selection
        </span>
      </div>
      <AllPathsModal
        open={allPathsOpen}
        onClose={() => setAllPathsOpen(false)}
        doc={doc}
        productIndex={productIndex}
      />
      <QuizSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        doc={doc}
        collections={collections}
        onSave={(next) => commit(next)}
      />
      {pickerSource && (
        <ModulePickerPopover
          onPick={handlePickerPick}
          onClose={() => setPickerSource(null)}
        />
      )}

      <div style={{ display: "flex", gap: 12 }}>
        <div
          style={{
            flex: 1,
            height: 640,
            background: "var(--qz-cream-2)",
            position: "relative",
            border: "1px solid var(--qz-rule)",
            borderRadius: "var(--qz-radius)",
          }}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={handleNodesChange}
            onConnect={handleConnect}
            onNodesDelete={handleNodesDelete}
            onEdgesDelete={handleEdgesDelete}
            deleteKeyCode={["Backspace", "Delete"]}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>

          <div
            style={{
              position: "absolute",
              right: 20,
              bottom: 20,
              zIndex: 5,
            }}
          >
            <div style={{ position: "relative" }}>
              <button
                type="button"
                onClick={() => setAddMenuOpen((o) => !o)}
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 24,
                  background: "var(--qz-accent)",
                  color: "var(--qz-paper)",
                  border: "none",
                  fontSize: 26,
                  cursor: "pointer",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
                }}
                title={
                  selectedId ? "Add node connected to selection" : "Add node"
                }
              >
                +
              </button>
              {addMenuOpen && (
                <>
                  <div
                    onClick={() => setAddMenuOpen(false)}
                    style={{ position: "fixed", inset: 0, zIndex: 6 }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      right: 0,
                      bottom: 56,
                      background: "var(--qz-paper)",
                      border: "1px solid var(--qz-rule)",
                      borderRadius: "var(--qz-radius)",
                      boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                      zIndex: 7,
                      minWidth: 180,
                      padding: 4,
                    }}
                  >
                    {(
                      [
                        ["Add question", "question"],
                        ["Add message", "message"],
                        ["Add Ask AI", "ask_ai"],
                        ["Add product cards", "product_cards"],
                        ["Add branch", "branch"],
                        ["Add integration", "integration"],
                        ["Add email gate", "email_gate"],
                        ["Add result", "result"],
                        ["Add end", "end"],
                      ] as const
                    ).map(([label, kind]) => (
                      <button
                        key={kind}
                        onClick={() => handleAddNode(kind)}
                        style={{
                          display: "block",
                          width: "100%",
                          background: "transparent",
                          border: "none",
                          padding: "8px 12px",
                          textAlign: "left",
                          fontSize: 14,
                          fontFamily: "inherit",
                          color: "var(--qz-ink)",
                          cursor: "pointer",
                          borderRadius: "var(--qz-radius)",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = "var(--qz-rule-2)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "transparent";
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {selectedNode && (
          <div style={{ width: 380, flexShrink: 0 }}>
            <NodeDrawer
              node={selectedNode}
              doc={doc}
              collections={collections}
              catalogTags={catalogTags}
              productIndex={productIndex}
              nodeOverride={doc.design_overrides[selectedNode.id] ?? {}}
              desktopOverride={
                doc.breakpoint_overrides[selectedNode.id]?.desktop ?? {}
              }
              mobileOverride={
                doc.breakpoint_overrides[selectedNode.id]?.mobile ?? {}
              }
              onChange={updateNode}
              onDocChange={commit}
              onNodeDesignChange={(next) =>
                commit({
                  ...doc,
                  design_overrides: {
                    ...doc.design_overrides,
                    [selectedNode.id]: next,
                  },
                })
              }
              onBreakpointDesignChange={(bp, next) =>
                commit({
                  ...doc,
                  breakpoint_overrides: {
                    ...doc.breakpoint_overrides,
                    [selectedNode.id]: {
                      ...(doc.breakpoint_overrides[selectedNode.id] ?? {}),
                      [bp]: next,
                    },
                  },
                })
              }
              onApplyDesignToAll={applyDesignToAll}
              onClose={() => setSelectedId(null)}
              onRegenerate={(prompt) => onRegenerate(selectedNode.id, prompt)}
              regenState={regenState}
              regenError={regenError}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Drawer ----------

type Breakpoint = "synced" | "desktop" | "mobile";

function NodeDrawer({
  node,
  doc,
  collections,
  catalogTags,
  productIndex,
  nodeOverride,
  desktopOverride,
  mobileOverride,
  onChange,
  onDocChange,
  onNodeDesignChange,
  onBreakpointDesignChange,
  onApplyDesignToAll,
  onClose,
  onRegenerate,
  regenState,
  regenError,
}: {
  node: QuizNodeDoc;
  doc: QuizDoc;
  collections: Array<{ collectionId: string; title: string }>;
  catalogTags: string[];
  productIndex: IndexedProduct[];
  nodeOverride: DesignTokensT;
  desktopOverride: DesignTokensT;
  mobileOverride: DesignTokensT;
  onChange: (next: QuizNodeDoc) => void;
  onDocChange: (next: QuizDoc) => void;
  onNodeDesignChange: (next: DesignTokensT) => void;
  onBreakpointDesignChange: (bp: "desktop" | "mobile", next: DesignTokensT) => void;
  onApplyDesignToAll: (type: "question" | "result", tokens: DesignTokensT) => void;
  onClose: () => void;
  onRegenerate: (prompt: string) => void;
  regenState: "idle" | "submitting" | "loading";
  regenError: string | null;
}) {
  const tabs = [
    { id: "preview", label: "Preview" },
    { id: "content", label: "Content" },
    { id: "design", label: "Design" },
  ];
  const [tabId, setTabId] = useState<string>("preview");
  const [breakpoint, setBreakpoint] = useState<Breakpoint>("synced");
  const [steeringPrompt, setSteeringPrompt] = useState("");

  // Pick the override layer currently being edited / previewed.
  const activeOverride =
    breakpoint === "desktop"
      ? desktopOverride
      : breakpoint === "mobile"
        ? mobileOverride
        : nodeOverride;

  // For the Preview tab, resolve a result node's override through the
  // shared-template posture: a result page in "shared" mode with no own
  // override previews with design_overrides["__shared_result__"]. Other node
  // types (and the design editor's activeOverride above) keep using the
  // node's own override verbatim.
  const previewNodeOverride = useMemo(() => {
    if (node.type === "result") {
      return (
        resolveNodeOverride(
          node.id,
          node.type,
          doc.result_layout_mode,
          doc.design_overrides,
        ) ?? {}
      );
    }
    return nodeOverride;
  }, [node.id, node.type, doc.result_layout_mode, doc.design_overrides, nodeOverride]);

  const previewTokens = useMemo(
    () =>
      resolveDesignTokens(
        doc.design_tokens ?? null,
        previewNodeOverride,
        breakpoint === "desktop" ? desktopOverride : null,
        breakpoint === "mobile" ? mobileOverride : null,
      ),
    [doc.design_tokens, previewNodeOverride, desktopOverride, mobileOverride, breakpoint],
  );

  const previewWidth = breakpoint === "mobile" ? 375 : 760;

  const handleDesignChange = (next: DesignTokensT) => {
    if (breakpoint === "synced") onNodeDesignChange(next);
    else onBreakpointDesignChange(breakpoint, next);
  };

  return (
    <QzCard>
      <div className="qz-col qz-gap-12">
        <div className="qz-row qz-row-between" style={{ alignItems: "baseline" }}>
          <h3 className="qz-h2" style={{ flex: 1, minWidth: 0 }}>
            {nodeLabel(node)}
          </h3>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--qz-ink-3)",
              cursor: "pointer",
              fontSize: 13,
              fontFamily: "var(--qz-font-mono)",
            }}
          >
            close ×
          </button>
        </div>

        <BreakpointToggle value={breakpoint} onChange={setBreakpoint} />

        <TabBar tabs={tabs} active={tabId} onSelect={setTabId} />

        <div style={{ marginTop: 4 }}>
          {tabId === "preview" && (
            <NodePreviewTab
              node={node}
              doc={doc}
              productIndex={productIndex}
              tokens={previewTokens}
              width={previewWidth}
            />
          )}
          {tabId === "content" && (
            <div className="qz-col qz-gap-16">
              <ContentTab node={node} onChange={onChange} />
              {node.type === "branch" && (
                <div
                  style={{
                    borderTop: "1px solid var(--qz-rule)",
                    paddingTop: 12,
                  }}
                >
                  <div className="qz-label qz-mt-8" style={{ marginBottom: 6 }}>
                    Branch slots
                  </div>
                  <BranchEditor
                    node={node}
                    doc={doc}
                    catalogTags={catalogTags}
                    onChange={onChange}
                    onDocChange={onDocChange}
                  />
                </div>
              )}
              {node.type === "question" && (
                <>
                  <div
                    style={{
                      borderTop: "1px solid var(--qz-rule)",
                      paddingTop: 12,
                    }}
                  >
                    <div className="qz-label qz-mt-8" style={{ marginBottom: 6 }}>
                      Answer logic
                    </div>
                    <LogicTab
                      node={node}
                      collections={collections}
                      catalogTags={catalogTags}
                      onChange={onChange}
                    />
                  </div>
                  <div
                    style={{
                      borderTop: "1px solid var(--qz-rule)",
                      paddingTop: 12,
                    }}
                  >
                    <div className="qz-label qz-mt-8" style={{ marginBottom: 6 }}>
                      AI regenerate
                    </div>
                    <AiTab
                      steeringPrompt={steeringPrompt}
                      onSteeringPromptChange={setSteeringPrompt}
                      onRegenerate={() => onRegenerate(steeringPrompt)}
                      regenState={regenState}
                      regenError={regenError}
                    />
                  </div>
                </>
              )}
            </div>
          )}
          {tabId === "design" && (
            <div className="qz-col qz-gap-12">
              {breakpoint !== "synced" && (
                <QzBanner tone="default">
                  Editing <strong>{breakpoint}</strong> overrides. Synced
                  changes don&apos;t apply here.
                </QzBanner>
              )}
              <DesignTab
                nodeType={node.type}
                override={activeOverride}
                onChange={handleDesignChange}
                onApplyToAll={onApplyDesignToAll}
              />
            </div>
          )}
        </div>
      </div>
    </QzCard>
  );
}

function BreakpointToggle({
  value,
  onChange,
}: {
  value: Breakpoint;
  onChange: (b: Breakpoint) => void;
}) {
  const items: Array<{ id: Breakpoint; label: string }> = [
    { id: "synced", label: "Synced" },
    { id: "desktop", label: "Desktop" },
    { id: "mobile", label: "Mobile" },
  ];
  return (
    <div
      className="qz-row"
      style={{
        gap: 2,
        background: "var(--qz-rule-2)",
        padding: 2,
        borderRadius: "var(--qz-radius)",
        width: "fit-content",
      }}
    >
      {items.map((item) => {
        const on = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            style={{
              background: on ? "var(--qz-paper)" : "transparent",
              border: "none",
              padding: "5px 12px",
              borderRadius: "var(--qz-radius)",
              fontSize: 12,
              fontFamily: "var(--qz-font-mono)",
              fontWeight: on ? 600 : 500,
              color: on ? "var(--qz-ink)" : "var(--qz-ink-3)",
              cursor: "pointer",
              boxShadow: on ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

function NodePreviewTab({
  node,
  doc,
  productIndex,
  tokens,
  width,
}: {
  node: QuizNodeDoc;
  doc: QuizDoc;
  productIndex: IndexedProduct[];
  tokens: DesignTokensT;
  width: number;
}) {
  return (
    <div className="qz-col qz-gap-8">
      <p className="qz-muted" style={{ fontSize: 12, margin: 0 }}>
        Live preview at {width}px wide — reflects the design tokens for the
        current breakpoint.
      </p>
      <div
        style={{
          background: "var(--qz-cream-2)",
          padding: 16,
          borderRadius: "var(--qz-radius)",
          border: "1px solid var(--qz-rule)",
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div style={{ width: `min(${width}px, 100%)` }}>
          <NodePreview node={node} doc={doc} productIndex={productIndex} tokens={tokens} />
        </div>
      </div>
      {node.type === "result" && (
        <div
          className="qz-mt-16"
          style={{
            borderTop: "1px solid var(--qz-rule)",
            paddingTop: 12,
          }}
        >
          <div className="qz-label" style={{ marginBottom: 8 }}>
            Simulate answers
          </div>
          <ResultPreviewTab
            node={node}
            doc={doc}
            productIndex={productIndex}
          />
        </div>
      )}
    </div>
  );
}

function NodePreview({
  node,
  doc,
  productIndex,
  tokens,
}: {
  node: QuizNodeDoc;
  doc: QuizDoc;
  productIndex: IndexedProduct[];
  tokens: DesignTokensT;
}) {
  const vars = tokensToCssVars(tokens) as React.CSSProperties;
  const cardStyle: React.CSSProperties = {
    background: "var(--qz-color-bg)",
    color: "var(--qz-color-text)",
    padding: "var(--qz-pad)",
    borderRadius: "var(--qz-radius)",
    fontFamily: "var(--qz-font-body)",
    fontSize: "var(--qz-base-size)",
    boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
  };
  const headingStyle: React.CSSProperties = {
    fontFamily: "var(--qz-font-heading)",
    fontSize: "var(--qz-h1-size)",
    margin: 0,
    color: "var(--qz-color-text)",
    fontWeight: 600,
    lineHeight: 1.15,
  };
  const subStyle: React.CSSProperties = {
    color: "var(--qz-color-muted)",
    marginTop: 8,
  };
  const btnStyle: React.CSSProperties = {
    ...buttonStyle(tokens),
    marginTop: 18,
    borderRadius: "var(--qz-radius)",
    padding: "10px 22px",
    fontFamily: "var(--qz-font-body)",
    fontSize: "var(--qz-base-size)",
    cursor: "default",
    border: "none",
    fontWeight: 600,
  };

  if (node.type === "intro") {
    return (
      <div style={vars}>
        <div style={cardStyle}>
          <h1 style={headingStyle}>{node.data.headline || "Headline"}</h1>
          {node.data.subtext && <p style={subStyle}>{node.data.subtext}</p>}
          <button style={btnStyle}>{node.data.button_label || "Start"}</button>
        </div>
      </div>
    );
  }

  if (node.type === "question") {
    const isFreeform =
      node.data.question_type === "text" || node.data.question_type === "email";
    return (
      <div style={vars}>
        <div style={cardStyle}>
          <h2
            style={{
              ...headingStyle,
              fontSize: "var(--qz-h2-size)",
            }}
          >
            {node.data.text || "Question"}
          </h2>
          {isFreeform ? (
            <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
              <div
                style={{
                  padding: "12px 14px",
                  borderRadius: "var(--qz-radius)",
                  border: "1px solid #00000022",
                  color: "var(--qz-color-muted)",
                  fontSize: "var(--qz-base-size)",
                }}
              >
                {node.data.input_config?.placeholder ||
                  (node.data.question_type === "email"
                    ? "you@example.com"
                    : "Type here…")}
              </div>
              <button style={btnStyle}>Continue</button>
            </div>
          ) : (
            <div
              style={{
                marginTop: 16,
                display: "grid",
                gap: 10,
              }}
            >
              {node.data.answers.map((a) => (
                <div
                  key={a.id}
                  style={{
                    padding: "var(--qz-pad)",
                    borderRadius: "var(--qz-radius)",
                    border: "2px solid #00000022",
                    color: "var(--qz-color-text)",
                    fontSize: "var(--qz-base-size)",
                  }}
                >
                  {a.text || "(answer)"}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (node.type === "email_gate") {
    return (
      <div style={vars}>
        <div style={cardStyle}>
          <h2 style={{ ...headingStyle, fontSize: "var(--qz-h2-size)" }}>
            {node.data.headline}
          </h2>
          {node.data.subtext && <p style={subStyle}>{node.data.subtext}</p>}
          <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
            <div
              style={{
                padding: "12px 14px",
                borderRadius: "var(--qz-radius)",
                border: "1px solid #00000022",
                color: "var(--qz-color-muted)",
                fontSize: "var(--qz-base-size)",
              }}
            >
              Email
            </div>
            {node.data.name_optional && (
              <div
                style={{
                  padding: "12px 14px",
                  borderRadius: "var(--qz-radius)",
                  border: "1px solid #00000022",
                  color: "var(--qz-color-muted)",
                  fontSize: "var(--qz-base-size)",
                }}
              >
                First name (optional)
              </div>
            )}
          </div>
          <button style={btnStyle}>Continue</button>
        </div>
      </div>
    );
  }

  if (node.type === "result") {
    const sample = productIndex.slice(0, node.data.slot_count);
    return (
      <div style={vars}>
        <div style={cardStyle}>
          <h2 style={{ ...headingStyle, fontSize: "var(--qz-h2-size)" }}>
            {node.data.headline}
          </h2>
          {node.data.subtext && <p style={subStyle}>{node.data.subtext}</p>}
          <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
            {sample.length === 0 ? (
              <p style={{ color: "var(--qz-color-muted)" }}>
                (Live products appear here at runtime.)
              </p>
            ) : (
              sample.map((p) => (
                <div
                  key={p.product_id}
                  style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "center",
                    padding: 10,
                    borderRadius: "var(--qz-radius)",
                    border: "1px solid #00000010",
                  }}
                >
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      background: "#00000010",
                      borderRadius: "var(--qz-radius)",
                    }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, fontSize: 14 }}>{p.title}</div>
                    {p.price && (
                      <div
                        style={{
                          color: "var(--qz-color-muted)",
                          fontSize: 12,
                          marginTop: 2,
                        }}
                      >
                        ${p.price}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
          <button style={btnStyle}>{node.data.cta_label}</button>
        </div>
      </div>
    );
  }

  if (node.type === "message") {
    return (
      <div style={vars}>
        <div style={cardStyle}>
          <p
            style={{
              color: "var(--qz-color-text)",
              fontSize: "var(--qz-base-size)",
              margin: 0,
              whiteSpace: "pre-wrap",
            }}
          >
            {node.data.text}
          </p>
          <button style={btnStyle}>Continue</button>
        </div>
      </div>
    );
  }

  // end
  if (node.type === "end") {
    return (
      <div style={vars}>
        <div style={cardStyle}>
          <h2 style={{ ...headingStyle, fontSize: "var(--qz-h2-size)" }}>
            {node.data.headline}
          </h2>
          {node.data.subtext && <p style={subStyle}>{node.data.subtext}</p>}
          {node.data.cta_label && <button style={btnStyle}>{node.data.cta_label}</button>}
        </div>
      </div>
    );
  }

  // ask_ai: simulated chat preview — opener bubble + suggested-question
  // chips. No real network call from the editor; full conversational flow
  // only exists in the storefront.
  if (node.type === "ask_ai") {
    return (
      <div style={vars}>
        <div style={cardStyle}>
          <div style={{ ...subStyle, fontSize: 12, marginBottom: 8 }}>
            {node.data.persona_name}
          </div>
          <div
            style={{
              background: "#00000010",
              color: "var(--qz-color-text)",
              padding: "10px 14px",
              borderRadius: "var(--qz-radius)",
              fontSize: "var(--qz-base-size)",
              lineHeight: 1.4,
              whiteSpace: "pre-wrap",
            }}
          >
            {node.data.opening_message}
          </div>
          {node.data.suggested_questions.length > 0 && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                marginTop: 10,
              }}
            >
              {node.data.suggested_questions.map((q, i) => (
                <span
                  key={i}
                  style={{
                    border: "1px solid #00000020",
                    borderRadius: "var(--qz-radius)",
                    padding: "5px 10px",
                    fontSize: 12,
                    color: "var(--qz-color-text)",
                  }}
                >
                  {q}
                </span>
              ))}
            </div>
          )}
          <div
            style={{
              marginTop: 12,
              padding: "8px 12px",
              border: "1px solid #00000022",
              borderRadius: "var(--qz-radius)",
              color: "var(--qz-color-muted)",
              fontSize: 13,
            }}
          >
            Type a question…
          </div>
          <button style={{ ...btnStyle, marginTop: 12 }}>
            {node.data.continue_label}
          </button>
        </div>
      </div>
    );
  }

  // integration: invisible to shoppers — only flashes briefly. Surface the
  // configured action count + URLs so authors can verify what'll fire.
  if (node.type === "integration") {
    return (
      <div style={vars}>
        <div style={{ ...cardStyle, textAlign: "center" }}>
          <div
            className="qz-label"
            style={{ color: "var(--qz-color-muted)", marginBottom: 6 }}
          >
            Integration · auto-fires
          </div>
          <h2 style={{ ...headingStyle, fontSize: "var(--qz-h2-size)" }}>
            {node.data.label}
          </h2>
          <p style={{ ...subStyle, fontSize: 13 }}>
            Shoppers don&apos;t see this — they&apos;ll see a brief
            &quot;Saving…&quot; while {node.data.actions.length} action
            {node.data.actions.length === 1 ? "" : "s"} fire server-side.
          </p>
          <div
            style={{
              marginTop: 10,
              textAlign: "left",
              fontSize: 11,
              fontFamily: "monospace",
            }}
          >
            {node.data.actions.map((a, i) => (
              <div
                key={i}
                style={{
                  padding: "4px 8px",
                  background: "#00000010",
                  borderRadius: 4,
                  marginBottom: 4,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {a.kind === "webhook"
                  ? `POST ${a.url}`
                  : `Klaviyo upsert${a.list_id ? ` → list ${a.list_id}` : ""}`}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // product_cards: shoppers see a row/grid of cards. Render dimmed
  // placeholders since the editor doesn't have product_index handy here.
  if (node.type === "product_cards") {
    return (
      <div style={vars}>
        <div style={cardStyle}>
          <h2 style={{ ...headingStyle, fontSize: "var(--qz-h2-size)" }}>
            {node.data.headline}
          </h2>
          {node.data.subtext && (
            <p style={subStyle}>{node.data.subtext}</p>
          )}
          <div
            style={{
              marginTop: 12,
              display: "grid",
              gridTemplateColumns: `repeat(${Math.min(node.data.product_ids.length, 3)}, 1fr)`,
              gap: 8,
            }}
          >
            {node.data.product_ids.map((pid, i) => (
              <div
                key={i}
                style={{
                  background: "#00000010",
                  borderRadius: "var(--qz-radius)",
                  padding: 8,
                  fontSize: 11,
                  color: "var(--qz-color-muted)",
                  textAlign: "center",
                  minHeight: 80,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {pid.length > 24 ? `${pid.slice(0, 14)}…` : pid}
              </div>
            ))}
          </div>
          <button style={{ ...btnStyle, marginTop: 12 }}>
            {node.data.continue_label}
          </button>
        </div>
      </div>
    );
  }

  // branch: shoppers never see a branch directly — runtime auto-advances.
  // Surface this fact in the drawer Preview so authors aren't confused.
  if (node.type === "branch") {
    return (
      <div style={vars}>
        <div style={{ ...cardStyle, textAlign: "center" }}>
          <div
            className="qz-label"
            style={{ color: "var(--qz-color-muted)", marginBottom: 6 }}
          >
            Branch · {node.data.mode}
          </div>
          <h2 style={{ ...headingStyle, fontSize: "var(--qz-h2-size)" }}>
            {node.data.label}
          </h2>
          <p style={{ ...subStyle, fontSize: 13 }}>
            Shoppers never see a branch step — the runtime auto-advances to
            one of its {node.data.slots.length} targets based on{" "}
            {node.data.mode === "ab_split"
              ? "weighted random A/B selection (sticky per session)"
              : "the first matching rule"}
            .
          </p>
        </div>
      </div>
    );
  }

  return null;
  // mark unused props so eslint doesn't complain
  void doc;
}

function TabBar({
  tabs,
  active,
  onSelect,
}: {
  tabs: Array<{ id: string; label: string }>;
  active: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div
      className="qz-row"
      style={{
        gap: 4,
        borderBottom: "1px solid var(--qz-rule)",
        paddingBottom: 0,
      }}
    >
      {tabs.map((t) => {
        const on = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onSelect(t.id)}
            style={{
              background: "transparent",
              border: "none",
              borderBottom: on
                ? "2px solid var(--qz-ink)"
                : "2px solid transparent",
              padding: "8px 6px",
              fontSize: 13,
              fontFamily: "var(--qz-font-body)",
              fontWeight: on ? 600 : 500,
              color: on ? "var(--qz-ink)" : "var(--qz-ink-3)",
              cursor: "pointer",
              marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function nodeLabel(node: QuizNodeDoc): string {
  switch (node.type) {
    case "intro":
      return `Welcome · ${node.data.headline}`;
    case "question":
      return `Question · ${node.data.text.slice(0, 30)}`;
    case "message":
      return `Message · ${node.data.text.slice(0, 30)}`;
    case "end":
      return `End · ${node.data.headline}`;
    case "email_gate":
      return `Email gate`;
    case "result":
      return `Result · ${node.data.headline}`;
    case "branch":
      return `Branch · ${node.data.label}`;
    case "ask_ai":
      return `Ask AI · ${node.data.persona_name}`;
    case "integration":
      return `Integration · ${node.data.label}`;
    case "product_cards":
      return `Product cards · ${node.data.headline}`;
  }
}

function ContentTab({
  node,
  onChange,
}: {
  node: QuizNodeDoc;
  onChange: (next: QuizNodeDoc) => void;
}) {
  if (node.type === "question") {
    return (
      <div className="qz-col qz-gap-12">
        <QzField label="Question text">
          <QzTextarea
            rows={3}
            value={node.data.text}
            onChange={(e) =>
              onChange({
                ...node,
                data: { ...node.data, text: e.target.value } as never,
              })
            }
          />
        </QzField>
        <QzField label="Question type">
          <QzSelect
            value={node.data.question_type}
            onChange={(e) =>
              onChange({
                ...node,
                data: {
                  ...node.data,
                  question_type: e.target
                    .value as typeof node.data.question_type,
                } as never,
              })
            }
          >
            <option value="single_select">Single select</option>
            <option value="multi_select">Multi select</option>
            <option value="image_tile">Image tile</option>
            <option value="image_picker">Image picker (grid)</option>
            <option value="searchable">Searchable</option>
            <option value="text">Text input</option>
            <option value="email">Email input</option>
          </QzSelect>
        </QzField>
        {(node.data.question_type === "text" ||
          node.data.question_type === "email") && (
          <>
            <QzField
              label="Input placeholder"
              hint="Shown in the empty field — e.g. 'Your favorite colour'."
            >
              <QzInput
                value={node.data.input_config?.placeholder ?? ""}
                onChange={(e) =>
                  onChange({
                    ...node,
                    data: {
                      ...node.data,
                      input_config: {
                        ...(node.data.input_config ?? {
                          placeholder: "",
                          max_length: 120,
                        }),
                        placeholder: e.target.value,
                      },
                    } as never,
                  })
                }
              />
            </QzField>
            <QzField label="Max length" hint="1–500 characters">
              <QzInput
                type="number"
                value={String(node.data.input_config?.max_length ?? 120)}
                onChange={(e) =>
                  onChange({
                    ...node,
                    data: {
                      ...node.data,
                      input_config: {
                        placeholder: node.data.input_config?.placeholder ?? "",
                        max_length: Math.max(
                          1,
                          Math.min(500, Number(e.target.value) || 1),
                        ),
                      },
                    } as never,
                  })
                }
              />
            </QzField>
            <p
              className="qz-muted"
              style={{ fontSize: 12, margin: 0 }}
            >
              The shopper&apos;s typed value becomes the answer text. Edit the
              seeded answer below to control which tags get accumulated.
            </p>
          </>
        )}
        {node.data.question_type === "multi_select" && (
          <QzField label="Max selections (optional)">
            <QzInput
              type="number"
              value={
                node.data.max_selections !== undefined
                  ? String(node.data.max_selections)
                  : ""
              }
              onChange={(e) => {
                const num = e.target.value ? Number(e.target.value) : undefined;
                onChange({
                  ...node,
                  data: {
                    ...node.data,
                    ...(num
                      ? { max_selections: num }
                      : { max_selections: undefined }),
                  } as never,
                });
              }}
            />
          </QzField>
        )}
        <label
          style={{
            display: "flex",
            gap: 10,
            alignItems: "flex-start",
            cursor: "pointer",
            paddingTop: 4,
          }}
        >
          <input
            type="checkbox"
            checked={node.data.show_preview_after === true}
            onChange={(e) =>
              onChange({
                ...node,
                data: {
                  ...node.data,
                  show_preview_after: e.target.checked,
                } as never,
              })
            }
            style={{ marginTop: 3, accentColor: "var(--qz-accent)" }}
          />
          <span>
            <span style={{ display: "block", fontSize: 14, fontWeight: 500 }}>
              Show product preview after this question
            </span>
            <span
              className="qz-muted"
              style={{ fontSize: 12, display: "block", marginTop: 2 }}
            >
              Storefront opens a refining picks rail once a shopper answers
              this question. Pre-tag fallback is the quiz&apos;s Featured
              collection (set in Quiz settings).
            </span>
          </span>
        </label>
      </div>
    );
  }

  if (node.type === "intro") {
    return (
      <div className="qz-col qz-gap-12">
        <QzField label="Headline">
          <QzInput
            value={node.data.headline}
            onChange={(e) =>
              onChange({
                ...node,
                data: { ...node.data, headline: e.target.value } as never,
              })
            }
          />
        </QzField>
        <QzField label="Subtext">
          <QzTextarea
            rows={3}
            value={node.data.subtext}
            onChange={(e) =>
              onChange({
                ...node,
                data: { ...node.data, subtext: e.target.value } as never,
              })
            }
          />
        </QzField>
        <QzField label="Button label">
          <QzInput
            value={node.data.button_label}
            onChange={(e) =>
              onChange({
                ...node,
                data: { ...node.data, button_label: e.target.value } as never,
              })
            }
          />
        </QzField>
      </div>
    );
  }

  if (node.type === "email_gate") {
    return (
      <div className="qz-col qz-gap-12">
        <QzField label="Headline">
          <QzInput
            value={node.data.headline}
            onChange={(e) =>
              onChange({
                ...node,
                data: { ...node.data, headline: e.target.value } as never,
              })
            }
          />
        </QzField>
        <QzField label="Subtext">
          <QzTextarea
            rows={3}
            value={node.data.subtext}
            onChange={(e) =>
              onChange({
                ...node,
                data: { ...node.data, subtext: e.target.value } as never,
              })
            }
          />
        </QzField>
      </div>
    );
  }

  if (node.type === "message") {
    return (
      <div className="qz-col qz-gap-12">
        <QzField
          label="Message"
          hint="Merge tags: @name, @email, @answer.<questionNodeId>"
        >
          <QzTextarea
            rows={5}
            value={node.data.text}
            onChange={(e) =>
              onChange({
                ...node,
                data: { ...node.data, text: e.target.value } as never,
              })
            }
          />
        </QzField>
      </div>
    );
  }

  if (node.type === "end") {
    return (
      <div className="qz-col qz-gap-12">
        <QzField label="Headline">
          <QzInput
            value={node.data.headline}
            onChange={(e) =>
              onChange({
                ...node,
                data: { ...node.data, headline: e.target.value } as never,
              })
            }
          />
        </QzField>
        <QzField label="Subtext">
          <QzTextarea
            rows={3}
            value={node.data.subtext}
            onChange={(e) =>
              onChange({
                ...node,
                data: { ...node.data, subtext: e.target.value } as never,
              })
            }
          />
        </QzField>
        <QzField label="CTA label (optional)">
          <QzInput
            value={node.data.cta_label ?? ""}
            placeholder="Shop the collection"
            onChange={(e) =>
              onChange({
                ...node,
                data: {
                  ...node.data,
                  cta_label: e.target.value || undefined,
                } as never,
              })
            }
          />
        </QzField>
        <QzField label="CTA URL (optional)" hint="Opens in a new tab">
          <QzInput
            value={node.data.cta_url ?? ""}
            placeholder="https://shop.example.com/collection/..."
            onChange={(e) =>
              onChange({
                ...node,
                data: {
                  ...node.data,
                  cta_url: e.target.value || undefined,
                } as never,
              })
            }
          />
        </QzField>
        <QzField
          label="Redirect URL (optional)"
          hint="Auto-navigates after a short delay"
        >
          <QzInput
            value={node.data.redirect_url ?? ""}
            placeholder="https://shop.example.com/..."
            onChange={(e) =>
              onChange({
                ...node,
                data: {
                  ...node.data,
                  redirect_url: e.target.value || undefined,
                } as never,
              })
            }
          />
        </QzField>
      </div>
    );
  }

  if (node.type === "ask_ai") {
    return (
      <div className="qz-col qz-gap-12">
        <QzField label="Persona name">
          <QzInput
            value={node.data.persona_name}
            placeholder="Assistant"
            onChange={(e) =>
              onChange({
                ...node,
                data: { ...node.data, persona_name: e.target.value } as never,
              })
            }
          />
        </QzField>
        <QzField
          label="System prompt"
          hint="Sets persona, tone, do/don'ts. Sent to Claude as the system message."
        >
          <QzTextarea
            rows={6}
            value={node.data.system_prompt}
            onChange={(e) =>
              onChange({
                ...node,
                data: { ...node.data, system_prompt: e.target.value } as never,
              })
            }
          />
        </QzField>
        <QzField
          label="Opening message"
          hint="Shown to the shopper before they type anything."
        >
          <QzTextarea
            rows={2}
            value={node.data.opening_message}
            onChange={(e) =>
              onChange({
                ...node,
                data: { ...node.data, opening_message: e.target.value } as never,
              })
            }
          />
        </QzField>
        <QzField
          label="Suggested questions"
          hint="One per line. Shown as quick-reply chips before the first user turn."
        >
          <QzTextarea
            rows={4}
            value={node.data.suggested_questions.join("\n")}
            onChange={(e) => {
              const next = e.target.value
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean);
              onChange({
                ...node,
                data: {
                  ...node.data,
                  suggested_questions: next,
                } as never,
              });
            }}
          />
        </QzField>
        <QzField label="Max turns" hint="1–20. Caps assistant replies per session.">
          <QzInput
            type="number"
            value={String(node.data.max_turns)}
            onChange={(e) =>
              onChange({
                ...node,
                data: {
                  ...node.data,
                  max_turns: Math.max(
                    1,
                    Math.min(20, Number(e.target.value) || 1),
                  ),
                } as never,
              })
            }
          />
        </QzField>
        <QzField label="Continue button label">
          <QzInput
            value={node.data.continue_label}
            placeholder="Continue"
            onChange={(e) =>
              onChange({
                ...node,
                data: { ...node.data, continue_label: e.target.value } as never,
              })
            }
          />
        </QzField>
      </div>
    );
  }

  if (node.type === "branch") {
    return (
      <div className="qz-col qz-gap-12">
        <QzField label="Label">
          <QzInput
            value={node.data.label}
            placeholder="Internal name for this branch"
            onChange={(e) =>
              onChange({
                ...node,
                data: { ...node.data, label: e.target.value } as never,
              })
            }
          />
        </QzField>
        <QzField label="Mode" hint="Rules: first matching slot wins. A/B split: weighted random, sticky per session.">
          <QzSelect
            value={node.data.mode}
            onChange={(e) =>
              onChange({
                ...node,
                data: {
                  ...node.data,
                  mode: e.target.value as "rules" | "ab_split",
                } as never,
              })
            }
          >
            <option value="rules">Rules</option>
            <option value="ab_split">A/B split</option>
          </QzSelect>
        </QzField>
      </div>
    );
  }

  if (node.type === "integration") {
    return (
      <div className="qz-col qz-gap-12">
        <QzField label="Label">
          <QzInput
            value={node.data.label}
            placeholder="Internal name for this integration"
            onChange={(e) =>
              onChange({
                ...node,
                data: { ...node.data, label: e.target.value } as never,
              })
            }
          />
        </QzField>
        <label
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            cursor: "pointer",
            paddingTop: 4,
          }}
        >
          <input
            type="checkbox"
            checked={node.data.continue_on_error}
            onChange={(e) =>
              onChange({
                ...node,
                data: {
                  ...node.data,
                  continue_on_error: e.target.checked,
                } as never,
              })
            }
          />
          <span style={{ fontSize: 13 }}>
            Continue to the next step even if an action fails
          </span>
        </label>
        <div className="qz-label qz-mt-8" style={{ marginBottom: 4 }}>
          Actions
        </div>
        {node.data.actions.map((act, idx) => (
          <div
            key={idx}
            style={{
              padding: 10,
              border: "1px solid var(--qz-rule)",
              borderRadius: "var(--qz-radius)",
              background: "var(--qz-paper)",
            }}
            className="qz-col qz-gap-8"
          >
            <div
              className="qz-row qz-row-between"
              style={{ alignItems: "center" }}
            >
              <span style={{ fontWeight: 600, fontSize: 12 }}>
                #{idx + 1} · {act.kind === "klaviyo" ? "Klaviyo" : "Webhook"}
              </span>
              {node.data.actions.length > 1 && (
                <button
                  type="button"
                  onClick={() =>
                    onChange({
                      ...node,
                      data: {
                        ...node.data,
                        actions: node.data.actions.filter((_, i) => i !== idx),
                      } as never,
                    })
                  }
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--qz-crit)",
                    cursor: "pointer",
                    fontSize: 12,
                    fontFamily: "var(--qz-font-mono)",
                  }}
                >
                  remove
                </button>
              )}
            </div>
            <QzField label="Label">
              <QzInput
                value={act.label}
                onChange={(e) =>
                  onChange({
                    ...node,
                    data: {
                      ...node.data,
                      actions: node.data.actions.map((a, i) =>
                        i === idx ? { ...a, label: e.target.value } : a,
                      ),
                    } as never,
                  })
                }
              />
            </QzField>
            {act.kind === "webhook" && (
              <>
                <QzField label="POST URL">
                  <QzInput
                    value={act.url}
                    placeholder="https://hooks.zapier.com/…"
                    onChange={(e) =>
                      onChange({
                        ...node,
                        data: {
                          ...node.data,
                          actions: node.data.actions.map((a, i) =>
                            i === idx && a.kind === "webhook"
                              ? { ...a, url: e.target.value }
                              : a,
                          ),
                        } as never,
                      })
                    }
                  />
                </QzField>
                <QzField
                  label="Secret (optional)"
                  hint="Sent as the X-Quizocalypse-Secret request header so your receiver can verify the call."
                >
                  <QzInput
                    value={act.secret ?? ""}
                    placeholder="(none)"
                    onChange={(e) => {
                      const v = e.target.value;
                      onChange({
                        ...node,
                        data: {
                          ...node.data,
                          actions: node.data.actions.map((a, i) =>
                            i === idx && a.kind === "webhook"
                              ? {
                                  ...a,
                                  ...(v
                                    ? { secret: v }
                                    : { secret: undefined }),
                                }
                              : a,
                          ),
                        } as never,
                      });
                    }}
                  />
                </QzField>
              </>
            )}
            {act.kind === "klaviyo" && (
              <>
                <QzField
                  label="Klaviyo API key"
                  hint="Private key (pk_…). Stored server-side only."
                >
                  <QzInput
                    type="password"
                    value={act.api_key}
                    placeholder="pk_…"
                    onChange={(e) =>
                      onChange({
                        ...node,
                        data: {
                          ...node.data,
                          actions: node.data.actions.map((a, i) =>
                            i === idx && a.kind === "klaviyo"
                              ? { ...a, api_key: e.target.value }
                              : a,
                          ),
                        } as never,
                      })
                    }
                  />
                </QzField>
                <QzField
                  label="List ID (optional)"
                  hint="Subscribe the profile to this list after upsert."
                >
                  <QzInput
                    value={act.list_id ?? ""}
                    placeholder="UPXxxx"
                    onChange={(e) => {
                      const v = e.target.value;
                      onChange({
                        ...node,
                        data: {
                          ...node.data,
                          actions: node.data.actions.map((a, i) =>
                            i === idx && a.kind === "klaviyo"
                              ? {
                                  ...a,
                                  ...(v
                                    ? { list_id: v }
                                    : { list_id: undefined }),
                                }
                              : a,
                          ),
                        } as never,
                      });
                    }}
                  />
                </QzField>
                <p
                  className="qz-muted"
                  style={{ fontSize: 11, margin: 0 }}
                >
                  Requires the shopper to hit an email_gate before this node
                  so we have an email to upsert.
                </p>
              </>
            )}
          </div>
        ))}
        <div className="qz-row qz-gap-8">
          <QzButton
            size="sm"
            onClick={() =>
              onChange({
                ...node,
                data: {
                  ...node.data,
                  actions: [
                    ...node.data.actions,
                    {
                      kind: "webhook" as const,
                      url: "https://example.com/webhook",
                      label: `Outbound webhook ${node.data.actions.length + 1}`,
                    },
                  ],
                } as never,
              })
            }
          >
            + Webhook
          </QzButton>
          <QzButton
            size="sm"
            onClick={() =>
              onChange({
                ...node,
                data: {
                  ...node.data,
                  actions: [
                    ...node.data.actions,
                    {
                      kind: "klaviyo" as const,
                      api_key: "",
                      label: `Klaviyo profile sync ${node.data.actions.length + 1}`,
                    },
                  ],
                } as never,
              })
            }
          >
            + Klaviyo
          </QzButton>
        </div>
      </div>
    );
  }

  if (node.type === "product_cards") {
    return (
      <div className="qz-col qz-gap-12">
        <QzField label="Headline">
          <QzInput
            value={node.data.headline}
            onChange={(e) =>
              onChange({
                ...node,
                data: { ...node.data, headline: e.target.value } as never,
              })
            }
          />
        </QzField>
        <QzField label="Subtext">
          <QzTextarea
            rows={2}
            value={node.data.subtext}
            onChange={(e) =>
              onChange({
                ...node,
                data: { ...node.data, subtext: e.target.value } as never,
              })
            }
          />
        </QzField>
        <QzField
          label="Product IDs"
          hint="One Shopify product ID per line. 1–6 products. Use the storefront ID (gid://shopify/Product/…)."
        >
          <QzTextarea
            rows={4}
            value={node.data.product_ids.join("\n")}
            onChange={(e) => {
              const next = e.target.value
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean)
                .slice(0, 6);
              if (next.length === 0) return; // schema requires ≥1
              onChange({
                ...node,
                data: { ...node.data, product_ids: next } as never,
              });
            }}
          />
        </QzField>
        <QzField label="Per-card CTA label">
          <QzInput
            value={node.data.cta_label}
            placeholder="Shop"
            onChange={(e) =>
              onChange({
                ...node,
                data: { ...node.data, cta_label: e.target.value } as never,
              })
            }
          />
        </QzField>
        <QzField label="Continue button label">
          <QzInput
            value={node.data.continue_label}
            placeholder="Continue"
            onChange={(e) =>
              onChange({
                ...node,
                data: { ...node.data, continue_label: e.target.value } as never,
              })
            }
          />
        </QzField>
      </div>
    );
  }

  // result
  if (node.type !== "result") return null;
  return (
    <div className="qz-col qz-gap-12">
      <QzField label="Headline">
        <QzInput
          value={node.data.headline}
          onChange={(e) =>
            onChange({
              ...node,
              data: { ...node.data, headline: e.target.value } as never,
            })
          }
        />
      </QzField>
      <QzField label="Subtext">
        <QzTextarea
          rows={3}
          value={node.data.subtext}
          onChange={(e) =>
            onChange({
              ...node,
              data: { ...node.data, subtext: e.target.value } as never,
            })
          }
        />
      </QzField>
      <QzField label="CTA label">
        <QzInput
          value={node.data.cta_label}
          onChange={(e) =>
            onChange({
              ...node,
              data: { ...node.data, cta_label: e.target.value } as never,
            })
          }
        />
      </QzField>
      <QzField label="Slot count" hint="1–6">
        <QzInput
          type="number"
          value={String(node.data.slot_count)}
          onChange={(e) =>
            onChange({
              ...node,
              data: {
                ...node.data,
                slot_count: Math.max(
                  1,
                  Math.min(6, Number(e.target.value) || 1),
                ),
              } as never,
            })
          }
        />
      </QzField>

      <ResultLogicEditor node={node} onChange={onChange} />
    </div>
  );
}

// v3 recommendation-logic editor for result nodes. Surfaces the match
// ladder (reorderable strategy list), the conditional-rule builder, the
// ranking + OOS settings, and the bound targets (category/collection/
// metafield) the ladder strategies need. Writes straight to ResultData.
const ALL_STRATEGIES = [
  "conditional",
  "points",
  "category",
  "collection",
  "tag",
  "metafield",
] as const;

const STRATEGY_LABEL: Record<string, string> = {
  conditional: "Conditional rules",
  points: "Points winner",
  category: "Bound category",
  collection: "Collection",
  tag: "Tag overlap",
  metafield: "Metafield match",
};

function ResultLogicEditor({
  node,
  onChange,
}: {
  node: Extract<QuizNodeDoc, { type: "result" }>;
  onChange: (next: QuizNodeDoc) => void;
}) {
  const data = node.data;
  const set = (patch: Record<string, unknown>) =>
    onChange({ ...node, data: { ...data, ...patch } as never });

  const ladder = data.match_ladder;
  const moveStrategy = (idx: number, dir: -1 | 1) => {
    const next = [...ladder];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j]!, next[idx]!];
    set({ match_ladder: next });
  };
  const toggleStrategy = (s: (typeof ALL_STRATEGIES)[number]) => {
    set({
      match_ladder: ladder.includes(s)
        ? ladder.filter((x) => x !== s)
        : [...ladder, s],
    });
  };

  return (
    <div
      style={{ borderTop: "1px solid var(--qz-rule)", paddingTop: 12 }}
      className="qz-col qz-gap-12"
    >
      <div className="qz-label">Recommendation logic</div>
      <p className="qz-muted" style={{ fontSize: 12, margin: 0 }}>
        Products are resolved by trying each enabled strategy top-to-bottom
        until one returns enough products. Reorder to set priority.
      </p>

      {/* Ladder: enabled strategies in order with up/down + remove */}
      <div className="qz-col qz-gap-4">
        {ladder.map((s, i) => (
          <div
            key={s}
            className="qz-row qz-gap-8"
            style={{
              alignItems: "center",
              padding: "6px 8px",
              border: "1px solid var(--qz-rule)",
              borderRadius: "var(--qz-radius)",
              background: "var(--qz-paper)",
            }}
          >
            <span className="qz-mono qz-dim" style={{ fontSize: 11, width: 16 }}>
              {i + 1}
            </span>
            <span style={{ flex: 1, fontSize: 13 }}>
              {STRATEGY_LABEL[s] ?? s}
            </span>
            <button type="button" onClick={() => moveStrategy(i, -1)} style={ladderBtn} title="Up">
              ↑
            </button>
            <button type="button" onClick={() => moveStrategy(i, 1)} style={ladderBtn} title="Down">
              ↓
            </button>
            <button
              type="button"
              onClick={() => toggleStrategy(s)}
              style={{ ...ladderBtn, color: "var(--qz-crit)" }}
              title="Remove"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="qz-row qz-gap-4" style={{ flexWrap: "wrap" }}>
        {ALL_STRATEGIES.filter((s) => !ladder.includes(s)).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => toggleStrategy(s)}
            style={{
              background: "var(--qz-cream-2)",
              border: "1px solid var(--qz-rule)",
              borderRadius: 999,
              padding: "3px 10px",
              fontSize: 11,
              cursor: "pointer",
              color: "var(--qz-ink-2)",
            }}
          >
            + {STRATEGY_LABEL[s] ?? s}
          </button>
        ))}
      </div>

      {/* Per-strategy config that's needed by the enabled strategies */}
      {ladder.includes("collection") && (
        <QzField label="Collection ID" hint="For the Collection strategy.">
          <QzInput
            value={data.collection_id ?? ""}
            placeholder="gid://shopify/Collection/…"
            onChange={(e) =>
              set({ collection_id: e.target.value || undefined })
            }
          />
        </QzField>
      )}
      {ladder.includes("metafield") && (
        <div className="qz-row qz-gap-8">
          <QzField label="Metafield key">
            <QzInput
              value={data.metafield_key ?? ""}
              placeholder="custom.skin_type"
              onChange={(e) =>
                set({ metafield_key: e.target.value || undefined })
              }
            />
          </QzField>
          <QzField label="Value">
            <QzInput
              value={data.metafield_value ?? ""}
              placeholder="oily"
              onChange={(e) =>
                set({ metafield_value: e.target.value || undefined })
              }
            />
          </QzField>
        </div>
      )}
      {ladder.includes("conditional") && (
        <ConditionalRulesEditor data={data} onSet={set} />
      )}

      {/* Ranking + OOS */}
      <div className="qz-row qz-gap-8">
        <QzField label="Ranking">
          <QzSelect
            value={data.ranking}
            onChange={(e) => set({ ranking: e.target.value })}
          >
            <option value="relevance">Relevance</option>
            <option value="newest">Newest</option>
            <option value="best_seller">Best seller</option>
            <option value="highest_rated">Highest rated</option>
          </QzSelect>
        </QzField>
        <QzField label="Out of stock">
          <QzSelect
            value={data.oos_behavior}
            onChange={(e) => set({ oos_behavior: e.target.value })}
          >
            <option value="show_with_badge">Show with badge</option>
            <option value="hide">Hide</option>
            <option value="fallback">Fallback collection</option>
          </QzSelect>
        </QzField>
      </div>
      {data.oos_behavior === "fallback" && (
        <QzField label="OOS fallback collection ID">
          <QzInput
            value={data.oos_fallback_collection_id ?? ""}
            placeholder="gid://shopify/Collection/…"
            onChange={(e) =>
              set({ oos_fallback_collection_id: e.target.value || undefined })
            }
          />
        </QzField>
      )}
      <div className="qz-row qz-gap-8">
        <label
          className="qz-row qz-gap-8"
          style={{ alignItems: "center", fontSize: 12, cursor: "pointer" }}
        >
          <input
            type="checkbox"
            checked={data.include_discount}
            onChange={(e) => set({ include_discount: e.target.checked })}
          />
          Include discount
        </label>
        <label
          className="qz-row qz-gap-8"
          style={{ alignItems: "center", fontSize: 12, cursor: "pointer" }}
        >
          <input
            type="checkbox"
            checked={data.subscription_eligible}
            onChange={(e) => set({ subscription_eligible: e.target.checked })}
          />
          Subscription
        </label>
      </div>
    </div>
  );
}

const ladderBtn: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--qz-rule)",
  borderRadius: 4,
  width: 22,
  height: 22,
  cursor: "pointer",
  fontSize: 12,
  lineHeight: 1,
  color: "var(--qz-ink-2)",
};

function ConditionalRulesEditor({
  data,
  onSet,
}: {
  data: Extract<QuizNodeDoc, { type: "result" }>["data"];
  onSet: (patch: Record<string, unknown>) => void;
}) {
  const rules = data.conditional_rules;
  const update = (i: number, patch: Record<string, unknown>) =>
    onSet({
      conditional_rules: rules.map((r, idx) =>
        idx === i ? { ...r, ...patch } : r,
      ),
    });
  const csv = (s: string) =>
    s.split(",").map((x) => x.trim()).filter(Boolean);
  return (
    <div className="qz-col qz-gap-8">
      <div className="qz-label" style={{ fontSize: 11 }}>
        Conditional rules — first match wins
      </div>
      {rules.map((r, i) => (
        <div
          key={i}
          style={{
            padding: 8,
            border: "1px solid var(--qz-rule)",
            borderRadius: "var(--qz-radius)",
          }}
          className="qz-col qz-gap-4"
        >
          <QzField label="If ALL of these answer ids (comma-sep)">
            <QzInput
              value={r.all_of.join(", ")}
              onChange={(e) => update(i, { all_of: csv(e.target.value) })}
            />
          </QzField>
          <QzField label="…and ANY of (optional)">
            <QzInput
              value={r.any_of.join(", ")}
              onChange={(e) => update(i, { any_of: csv(e.target.value) })}
            />
          </QzField>
          <QzField label="→ show product ids (comma-sep)">
            <QzInput
              value={r.product_ids.join(", ")}
              onChange={(e) => update(i, { product_ids: csv(e.target.value) })}
            />
          </QzField>
          <button
            type="button"
            onClick={() =>
              onSet({ conditional_rules: rules.filter((_, idx) => idx !== i) })
            }
            style={{
              alignSelf: "flex-end",
              background: "transparent",
              border: "none",
              color: "var(--qz-crit)",
              cursor: "pointer",
              fontSize: 11,
              fontFamily: "var(--qz-font-mono)",
            }}
          >
            remove rule
          </button>
        </div>
      ))}
      <QzButton
        size="sm"
        onClick={() =>
          onSet({
            conditional_rules: [
              ...rules,
              { all_of: [], any_of: [], product_ids: [] },
            ],
          })
        }
      >
        + Add rule
      </QzButton>
    </div>
  );
}

// Per-slot rule editor for branch nodes. Rules mode: each slot's outbound
// edge gets a condition (answer_id / tag / ab_slot). A/B split mode: each
// slot gets a weight knob. Slot add/remove buttons live here too.
function BranchEditor({
  node,
  doc,
  catalogTags,
  onChange,
  onDocChange,
}: {
  node: Extract<QuizNodeDoc, { type: "branch" }>;
  doc: QuizDoc;
  catalogTags: string[];
  onChange: (next: QuizNodeDoc) => void;
  onDocChange: (next: QuizDoc) => void;
}) {
  const allAnswers = useMemo(() => {
    const out: Array<{
      questionId: string;
      questionText: string;
      answerId: string;
      answerText: string;
    }> = [];
    for (const n of doc.nodes) {
      if (n.type !== "question") continue;
      for (const a of n.data.answers) {
        out.push({
          questionId: n.id,
          questionText: n.data.text.slice(0, 30),
          answerId: a.id,
          answerText: a.text,
        });
      }
    }
    return out;
  }, [doc.nodes]);

  return (
    <div className="qz-col qz-gap-12">
      {node.data.slots.map((slot, idx) => {
        const edge = doc.edges.find(
          (e) => e.source === node.id && e.source_handle === slot.id,
        );
        return (
          <div
            key={slot.id}
            style={{
              padding: 10,
              border: "1px solid var(--qz-rule)",
              borderRadius: "var(--qz-radius)",
              background: "var(--qz-paper)",
            }}
          >
            <div
              className="qz-row qz-row-between"
              style={{ alignItems: "center", marginBottom: 8 }}
            >
              <QzField label={`Slot ${idx + 1} label`}>
                <QzInput
                  value={slot.label}
                  onChange={(e) =>
                    onChange({
                      ...node,
                      data: {
                        ...node.data,
                        slots: node.data.slots.map((s) =>
                          s.id === slot.id
                            ? { ...s, label: e.target.value }
                            : s,
                        ),
                      } as never,
                    })
                  }
                />
              </QzField>
              {node.data.slots.length > 2 && (
                <button
                  type="button"
                  onClick={() =>
                    onDocChange(removeBranchSlot(doc, node.id, slot.id))
                  }
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--qz-crit)",
                    cursor: "pointer",
                    fontSize: 12,
                    fontFamily: "var(--qz-font-mono)",
                  }}
                >
                  remove
                </button>
              )}
            </div>

            {node.data.mode === "ab_split" ? (
              <QzField label="Weight" hint="Higher weight = larger share">
                <QzInput
                  type="number"
                  value={String(slot.weight)}
                  onChange={(e) =>
                    onChange({
                      ...node,
                      data: {
                        ...node.data,
                        slots: node.data.slots.map((s) =>
                          s.id === slot.id
                            ? {
                                ...s,
                                weight: Math.max(0, Number(e.target.value) || 0),
                              }
                            : s,
                        ),
                      } as never,
                    })
                  }
                />
              </QzField>
            ) : (
              <BranchSlotRuleEditor
                edge={edge}
                allAnswers={allAnswers}
                catalogTags={catalogTags}
                onChange={(cond) => {
                  if (!edge) return;
                  onDocChange(setEdgeCondition(doc, edge.id, cond));
                }}
              />
            )}
          </div>
        );
      })}
      <QzButton
        size="sm"
        onClick={() => onDocChange(addBranchSlot(doc, node.id))}
      >
        + Add slot
      </QzButton>
    </div>
  );
}

// Sub-editor for one branch slot in rules mode. The author picks the
// condition kind (answer/tag/none) and the value. Sends `undefined` to
// clear back to unconditional.
function BranchSlotRuleEditor({
  edge,
  allAnswers,
  catalogTags,
  onChange,
}: {
  edge: QuizDoc["edges"][number] | undefined;
  allAnswers: Array<{
    questionId: string;
    questionText: string;
    answerId: string;
    answerText: string;
  }>;
  catalogTags: string[];
  onChange: (
    cond: { answer_id?: string; tag?: string; ab_slot?: string } | undefined,
  ) => void;
}) {
  if (!edge) {
    return (
      <p className="qz-muted" style={{ fontSize: 11, margin: 0 }}>
        Connect this slot to a node before adding a rule.
      </p>
    );
  }
  const kind: "none" | "answer" | "tag" = edge.condition?.answer_id
    ? "answer"
    : edge.condition?.tag
      ? "tag"
      : "none";

  return (
    <div className="qz-col qz-gap-8">
      <QzField label="When" hint="Pick when this slot's edge fires">
        <QzSelect
          value={kind}
          onChange={(e) => {
            const v = e.target.value as "none" | "answer" | "tag";
            if (v === "none") onChange(undefined);
            else if (v === "answer")
              onChange({ answer_id: allAnswers[0]?.answerId ?? "" });
            else onChange({ tag: catalogTags[0] ?? "" });
          }}
        >
          <option value="none">Always (no rule)</option>
          <option value="answer">Shopper picked answer…</option>
          <option value="tag">Accumulated tag includes…</option>
        </QzSelect>
      </QzField>
      {kind === "answer" && (
        <QzField label="Answer">
          <QzSelect
            value={edge.condition?.answer_id ?? ""}
            onChange={(e) => onChange({ answer_id: e.target.value })}
          >
            {allAnswers.length === 0 && (
              <option value="">(no questions yet)</option>
            )}
            {allAnswers.map((a) => (
              <option key={a.answerId} value={a.answerId}>
                {a.questionText} → {a.answerText}
              </option>
            ))}
          </QzSelect>
        </QzField>
      )}
      {kind === "tag" && (
        <QzField label="Tag">
          <QzSelect
            value={edge.condition?.tag ?? ""}
            onChange={(e) => onChange({ tag: e.target.value })}
          >
            {catalogTags.length === 0 && (
              <option value="">(no catalog tags)</option>
            )}
            {catalogTags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </QzSelect>
        </QzField>
      )}
    </div>
  );
}

function LogicTab({
  node,
  collections,
  catalogTags,
  onChange,
}: {
  node: Extract<QuizNodeDoc, { type: "question" }>;
  collections: Array<{ collectionId: string; title: string }>;
  catalogTags: string[];
  onChange: (next: QuizNodeDoc) => void;
}) {
  const isImageTile = node.data.question_type === "image_tile";

  const updateAnswer = (
    idx: number,
    patch: Partial<(typeof node.data.answers)[number]>,
  ) => {
    const next = [...node.data.answers];
    const current = next[idx];
    if (!current) return;
    next[idx] = { ...current, ...patch };
    onChange({ ...node, data: { ...node.data, answers: next } as never });
  };

  return (
    <div className="qz-col qz-gap-16">
      <p className="qz-muted" style={{ fontSize: 13, margin: 0 }}>
        Each answer adds tags to the recommendation bag and optionally narrows
        candidates to a specific collection. Tag suggestions come from your
        live catalog — typing a non-catalog tag is allowed but won&apos;t match
        any products.
      </p>
      {node.data.answers.map((answer, idx) => (
        <div
          key={answer.id}
          className="qz-col qz-gap-8"
          style={{
            paddingTop: 12,
            borderTop:
              idx > 0 ? "1px solid var(--qz-rule)" : undefined,
          }}
        >
          <div className="qz-row qz-gap-8" style={{ alignItems: "baseline" }}>
            <span className="qz-label">Answer {idx + 1}</span>
            <span className="qz-muted" style={{ fontSize: 13 }}>
              {answer.text || "(untitled)"}
            </span>
          </div>
          <QzField label="Tags">
            <TagAutocomplete
              tags={answer.tags}
              catalogTags={catalogTags}
              onChange={(tags) => updateAnswer(idx, { tags })}
            />
          </QzField>
          <QzField label="Collection filter">
            <QzSelect
              value={answer.collection_filter ?? ""}
              onChange={(e) =>
                updateAnswer(idx, {
                  ...(e.target.value
                    ? { collection_filter: e.target.value }
                    : { collection_filter: undefined }),
                })
              }
            >
              <option value="">(no filter)</option>
              {collections.map((c) => (
                <option key={c.collectionId} value={c.collectionId}>
                  {c.title}
                </option>
              ))}
            </QzSelect>
          </QzField>
          {isImageTile && (
            <QzField label="Image URL">
              <QzInput
                value={answer.image_url ?? ""}
                placeholder="https://cdn.shopify.com/..."
                onChange={(e) =>
                  updateAnswer(idx, {
                    ...(e.target.value
                      ? { image_url: e.target.value }
                      : { image_url: undefined }),
                  })
                }
              />
            </QzField>
          )}
          <AnswerPointsEditor
            points={answer.points}
            onChange={(points) => updateAnswer(idx, { points })}
          />
        </div>
      ))}
    </div>
  );
}

// Compact per-answer points editor for the "points" match strategy. Lets a
// merchant map categoryId → weight by hand (the live category list isn't
// loaded in the builder, so category ids are free-text). Gated behind a
// disclosure so quizzes that don't use points scoring stay uncluttered.
function AnswerPointsEditor({
  points,
  onChange,
}: {
  points: Record<string, number> | undefined;
  onChange: (points: Record<string, number> | undefined) => void;
}) {
  const entries = Object.entries(points ?? {});
  const hasPoints = entries.length > 0;
  const [open, setOpen] = useState(hasPoints);
  const [newCategoryId, setNewCategoryId] = useState("");
  const [newWeight, setNewWeight] = useState("");

  // Merge/replace a category's weight; a cleared or zero weight removes the
  // key, and an empty map normalizes back to undefined so we don't persist
  // `points: {}`.
  const setWeight = (categoryId: string, weight: number | null) => {
    const next: Record<string, number> = { ...(points ?? {}) };
    if (weight === null || weight === 0 || Number.isNaN(weight)) {
      delete next[categoryId];
    } else {
      next[categoryId] = weight;
    }
    onChange(Object.keys(next).length > 0 ? next : undefined);
  };

  const addCategory = () => {
    const id = newCategoryId.trim();
    const weight = Number(newWeight);
    if (!id || !newWeight.trim() || Number.isNaN(weight) || weight === 0) return;
    setWeight(id, weight);
    setNewCategoryId("");
    setNewWeight("");
  };

  return (
    <div className="qz-col qz-gap-8">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          alignSelf: "flex-start",
          background: "transparent",
          border: "none",
          padding: 0,
          color: "var(--qz-ink-3)",
          cursor: "pointer",
          fontSize: 12,
          fontFamily: "var(--qz-font-mono)",
        }}
      >
        {open ? "▾" : "▸"} Points{hasPoints ? ` (${entries.length})` : ""}
      </button>
      {open && (
        <div className="qz-col qz-gap-8" style={{ paddingLeft: 12 }}>
          <p className="qz-muted" style={{ fontSize: 12, margin: 0 }}>
            Weights this answer contributes per category id, used by the
            &quot;points&quot; result strategy.
          </p>
          {entries.length === 0 && (
            <span className="qz-dim" style={{ fontSize: 12 }}>
              No category weights yet
            </span>
          )}
          {entries.map(([categoryId, weight]) => (
            <div
              key={categoryId}
              className="qz-row qz-gap-8"
              style={{ alignItems: "center" }}
            >
              <QzInput
                value={categoryId}
                readOnly
                style={{ flex: 1, minWidth: 0 }}
              />
              <QzInput
                type="number"
                value={String(weight)}
                onChange={(e) => {
                  const raw = e.target.value;
                  setWeight(categoryId, raw === "" ? null : Number(raw));
                }}
                style={{ width: 80 }}
              />
              <QzButton
                variant="ghost"
                size="sm"
                onClick={() => setWeight(categoryId, null)}
              >
                remove
              </QzButton>
            </div>
          ))}
          <div className="qz-row qz-gap-8" style={{ alignItems: "center" }}>
            <QzInput
              placeholder="category id"
              value={newCategoryId}
              onChange={(e) => setNewCategoryId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCategory();
                }
              }}
              style={{ flex: 1, minWidth: 0 }}
            />
            <QzInput
              type="number"
              placeholder="weight"
              value={newWeight}
              onChange={(e) => setNewWeight(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCategory();
                }
              }}
              style={{ width: 80 }}
            />
            <QzButton variant="ghost" size="sm" onClick={addCategory}>
              + add
            </QzButton>
          </div>
        </div>
      )}
    </div>
  );
}

function TagAutocomplete({
  tags,
  catalogTags,
  onChange,
}: {
  tags: string[];
  catalogTags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const filtered = useMemo(() => {
    const q = input.toLowerCase().trim();
    if (!q) return catalogTags.filter((t) => !tags.includes(t)).slice(0, 8);
    return catalogTags
      .filter((t) => !tags.includes(t) && t.toLowerCase().includes(q))
      .slice(0, 8);
  }, [input, catalogTags, tags]);

  const addTag = (tag: string) => {
    const t = tag.trim();
    if (!t) return;
    if (tags.includes(t)) return;
    onChange([...tags, t]);
    setInput("");
    setOpen(false);
  };

  const removeTag = (tag: string) => {
    onChange(tags.filter((t) => t !== tag));
  };

  const inCatalog = (t: string) => catalogTags.includes(t);
  const showCustom =
    input.trim() &&
    !catalogTags.includes(input.trim()) &&
    !tags.includes(input.trim());

  return (
    <div className="qz-col qz-gap-8">
      <div className="qz-row" style={{ flexWrap: "wrap", gap: 6 }}>
        {tags.length === 0 && (
          <span className="qz-dim" style={{ fontSize: 12 }}>
            No tags yet
          </span>
        )}
        {tags.map((t) => (
          <Chip
            key={t}
            label={inCatalog(t) ? t : `${t} (not in catalog)`}
            onRemove={() => removeTag(t)}
          />
        ))}
      </div>
      <div style={{ position: "relative" }}>
        <QzInput
          placeholder="Search catalog tags…"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && input.trim()) {
              e.preventDefault();
              addTag(input);
            }
          }}
        />
        {open && filtered.length > 0 && (
          <div
            style={{
              position: "absolute",
              top: "100%",
              left: 0,
              right: 0,
              marginTop: 4,
              background: "var(--qz-paper)",
              border: "1px solid var(--qz-rule)",
              borderRadius: "var(--qz-radius)",
              boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
              zIndex: 10,
              maxHeight: 220,
              overflowY: "auto",
            }}
          >
            {filtered.map((t) => (
              <button
                key={t}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  addTag(t);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  background: "transparent",
                  border: "none",
                  padding: "8px 12px",
                  textAlign: "left",
                  fontSize: 13,
                  fontFamily: "inherit",
                  color: "var(--qz-ink)",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--qz-rule-2)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                {t}
              </button>
            ))}
          </div>
        )}
      </div>
      {showCustom && (
        <QzButton variant="ghost" size="sm" onClick={() => addTag(input)}>
          + Add custom tag &ldquo;{input.trim()}&rdquo;
        </QzButton>
      )}
    </div>
  );
}

function Chip({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 8px 3px 10px",
        background: "var(--qz-rule-2)",
        borderRadius: 100,
        fontSize: 12,
        fontFamily: "var(--qz-font-mono)",
        color: "var(--qz-ink-2)",
      }}
    >
      {label}
      <button
        type="button"
        onClick={onRemove}
        style={{
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: "var(--qz-ink-3)",
          fontSize: 14,
          lineHeight: 1,
          padding: 0,
        }}
        title="Remove tag"
      >
        ×
      </button>
    </span>
  );
}

function DesignTab({
  nodeType,
  override,
  onChange,
  onApplyToAll,
}: {
  nodeType: QuizNodeDoc["type"];
  override: DesignTokensT;
  onChange: (next: DesignTokensT) => void;
  onApplyToAll: (type: "question" | "result", tokens: DesignTokensT) => void;
}) {
  const colorRoles = [
    { key: "primary", label: "Primary" },
    { key: "secondary", label: "Secondary" },
    { key: "accent", label: "Accent" },
    { key: "background", label: "Background" },
    { key: "text", label: "Text" },
    { key: "muted", label: "Muted" },
  ] as const;

  const setColor = (key: string, hex: string | null) => {
    const colors = { ...(override.colors ?? {}) } as Record<string, string>;
    if (hex === null) {
      delete colors[key];
    } else {
      colors[key] = hex;
    }
    const next: DesignTokensT = { ...override };
    if (Object.keys(colors).length === 0) {
      delete next.colors;
    } else {
      next.colors = colors as DesignTokensT["colors"];
    }
    onChange(next);
  };

  const reset = () => onChange({});
  const hasOverrides = Object.keys(override).length > 0;

  return (
    <div className="qz-col qz-gap-12">
      <p className="qz-muted" style={{ fontSize: 13, margin: 0 }}>
        Per-node overrides on top of your brand defaults + quiz tokens. Leave a
        color blank to inherit from the parent layer.
      </p>
      {colorRoles.map((role) => {
        const value = override.colors?.[role.key];
        return (
          <div
            key={role.key}
            className="qz-row qz-gap-8"
            style={{ alignItems: "center" }}
          >
            <span
              className="qz-mono"
              style={{
                minWidth: 80,
                fontSize: 11,
                color: "var(--qz-ink-3)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
              }}
            >
              {role.label}
            </span>
            <input
              type="color"
              value={value ?? "#000000"}
              onChange={(e) => setColor(role.key, e.target.value)}
              style={{
                width: 36,
                height: 28,
                border: "1px solid var(--qz-rule)",
                borderRadius: "var(--qz-radius)",
                padding: 0,
                background: "var(--qz-paper)",
              }}
            />
            <div style={{ flex: 1 }}>
              <QzInput
                value={value ?? ""}
                placeholder="(inherit)"
                onChange={(e) => setColor(role.key, e.target.value || null)}
                style={{ fontFamily: "var(--qz-font-mono)", fontSize: 12 }}
              />
            </div>
            {value && (
              <button
                type="button"
                onClick={() => setColor(role.key, null)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--qz-ink-3)",
                  fontSize: 12,
                  cursor: "pointer",
                  fontFamily: "var(--qz-font-mono)",
                }}
              >
                clear
              </button>
            )}
          </div>
        );
      })}
      <div className="qz-row qz-gap-8" style={{ flexWrap: "wrap" }}>
        {(nodeType === "question" || nodeType === "result") && hasOverrides && (
          <QzButton
            variant="ghost"
            size="sm"
            onClick={() => onApplyToAll(nodeType, override)}
          >
            Apply to all {nodeType === "question" ? "questions" : "results"}
          </QzButton>
        )}
        {hasOverrides && (
          <QzButton
            variant="ghost"
            size="sm"
            onClick={reset}
            style={{ color: "var(--qz-crit)" }}
          >
            Reset overrides
          </QzButton>
        )}
      </div>
    </div>
  );
}

function ResultPreviewTab({
  node,
  doc,
  productIndex,
}: {
  node: Extract<QuizNodeDoc, { type: "result" }>;
  doc: QuizDoc;
  productIndex: IndexedProduct[];
}) {
  const questionNodes = useMemo(
    () =>
      doc.nodes.filter(
        (n): n is Extract<QuizNodeDoc, { type: "question" }> =>
          n.type === "question",
      ),
    [doc.nodes],
  );
  const [picks, setPicks] = useState<Record<string, string | "_first">>({});

  const selectedAnswerIds = useMemo(() => {
    return questionNodes
      .map((q) => {
        const pick = picks[q.id] ?? "_first";
        const ans =
          pick === "_first"
            ? q.data.answers[0]
            : q.data.answers.find((a) => a.id === pick);
        return ans?.id;
      })
      .filter((id): id is string => !!id);
  }, [picks, questionNodes]);

  const recs = useMemo(
    () =>
      recommendForResult({
        quiz: doc,
        productIndex,
        selectedAnswerIds,
        resultNodeId: node.id,
      }),
    [doc, productIndex, selectedAnswerIds, node.id],
  );

  return (
    <div className="qz-col qz-gap-12">
      <p className="qz-muted" style={{ fontSize: 13, margin: 0 }}>
        Simulate the quiz against your live catalog. Pick an answer per question
        and the recommendation engine ranks products for this result in real
        time.
      </p>
      {questionNodes.length === 0 ? (
        <QzBanner tone="default">
          No question nodes to simulate against.
        </QzBanner>
      ) : (
        questionNodes.map((q) => (
          <QzField key={q.id} label={(q.data.text || "Question").slice(0, 70)}>
            <QzSelect
              value={picks[q.id] ?? "_first"}
              onChange={(e) => setPicks({ ...picks, [q.id]: e.target.value })}
            >
              <option value="_first">First answer</option>
              {q.data.answers.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.text || a.id}
                </option>
              ))}
            </QzSelect>
          </QzField>
        ))
      )}
      <div>
        <h4 className="qz-h3" style={{ marginBottom: 8 }}>
          Top {node.data.slot_count} products
        </h4>
        {recs.length === 0 ? (
          <p className="qz-muted" style={{ fontSize: 13, margin: 0 }}>
            No matches — would fall back to{" "}
            <code>{node.data.fallback_collection_id || "(no fallback)"}</code>.
          </p>
        ) : (
          <div className="qz-col qz-gap-8">
            {recs.map((r) => (
              <div
                key={r.product_id}
                style={{
                  padding: 10,
                  background: "var(--qz-rule-2)",
                  borderRadius: "var(--qz-radius)",
                }}
              >
                <div className="qz-row qz-row-between">
                  <span style={{ fontWeight: 500 }}>{r.title}</span>
                  <div className="qz-row qz-gap-4">
                    <QzBadge>{`score ${r.score}`}</QzBadge>
                    {!r.inventory_in_stock && (
                      <QzBadge tone="crit">out of stock</QzBadge>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Modal-style picker for the output-handle `+` flow. Lists the five module
// types a merchant can drop after any source handle. Sits on top of the same
// dimmed overlay used by QuizSettingsModal / AllPathsModal for consistency.
function ModulePickerPopover({
  onPick,
  onClose,
}: {
  onPick: (
    kind:
      | "question"
      | "result"
      | "email_gate"
      | "message"
      | "end"
      | "branch"
      | "ask_ai"
      | "integration"
      | "product_cards",
  ) => void;
  onClose: () => void;
}) {
  const items: Array<{
    kind:
      | "question"
      | "result"
      | "email_gate"
      | "message"
      | "end"
      | "branch"
      | "ask_ai"
      | "integration"
      | "product_cards";
    label: string;
    hint: string;
  }> = [
    { kind: "question", label: "Question", hint: "Single/multi-select, image tiles, or text/email input" },
    { kind: "message", label: "Message", hint: "A chat-style copy block" },
    { kind: "ask_ai", label: "Ask AI", hint: "Multi-turn AI chat grounded in the quiz path + catalog" },
    { kind: "product_cards", label: "Product cards", hint: "Hand-pick products to showcase mid-flow" },
    { kind: "branch", label: "Branch", hint: "Rules-based routing or A/B variant split" },
    { kind: "integration", label: "Integration", hint: "Fire outbound webhooks server-side then auto-advance" },
    { kind: "email_gate", label: "Email gate", hint: "Capture email before results" },
    { kind: "result", label: "Result", hint: "Show recommended products" },
    { kind: "end", label: "End", hint: "Final screen with optional CTA" },
  ];
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(27, 26, 23, 0.4)",
        display: "grid",
        placeItems: "center",
        zIndex: 100,
        backdropFilter: "blur(4px)",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="qz-card"
        style={{ maxWidth: 420, width: "100%", padding: 20 }}
      >
        <div className="qz-label">Add module</div>
        <h2 className="qz-h2 qz-mt-8" style={{ margin: 0 }}>
          Pick what comes next
        </h2>
        <div className="qz-col qz-gap-8 qz-mt-16">
          {items.map((item) => (
            <button
              key={item.kind}
              type="button"
              onClick={() => onPick(item.kind)}
              style={{
                textAlign: "left",
                background: "var(--qz-paper)",
                border: "1px solid var(--qz-rule)",
                borderRadius: "var(--qz-radius)",
                padding: "10px 12px",
                cursor: "pointer",
                fontFamily: "var(--qz-font-body)",
                color: "var(--qz-ink)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--qz-cream-2)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--qz-paper)";
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 14 }}>{item.label}</div>
              <div
                className="qz-muted"
                style={{ fontSize: 12, marginTop: 2 }}
              >
                {item.hint}
              </div>
            </button>
          ))}
        </div>
        <div
          className="qz-row qz-gap-8 qz-mt-16"
          style={{ justifyContent: "flex-end" }}
        >
          <QzButton onClick={onClose}>Cancel</QzButton>
        </div>
      </div>
    </div>
  );
}

function QuizSettingsModal({
  open,
  onClose,
  doc,
  collections,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  doc: QuizDoc;
  collections: Array<{ collectionId: string; title: string }>;
  onSave: (next: QuizDoc) => void;
}) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(27, 26, 23, 0.4)",
        display: "grid",
        placeItems: "center",
        zIndex: 100,
        backdropFilter: "blur(4px)",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="qz-card"
        style={{ maxWidth: 520, width: "100%", padding: 28 }}
      >
        <div className="qz-label">Quiz settings</div>
        <h2 className="qz-h1 qz-mt-8">Quiz settings</h2>
        <p className="qz-muted qz-mt-16" style={{ fontSize: 14 }}>
          Quiz-level configuration. These apply across every node in this quiz.
        </p>

        <div className="qz-col qz-gap-16 qz-mt-24">
          <QzField
            label="Featured collection"
            hint="Used as the fallback for the mid-quiz product preview when accumulated answer tags don't match anything in your catalog. Pick something like 'Best Sellers'."
          >
            <QzSelect
              value={doc.featured_collection_id ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                const next = { ...doc };
                if (v) next.featured_collection_id = v;
                else delete next.featured_collection_id;
                onSave(next);
              }}
            >
              <option value="">(none — fall back to scope)</option>
              {collections.map((c) => (
                <option key={c.collectionId} value={c.collectionId}>
                  {c.title}
                </option>
              ))}
            </QzSelect>
          </QzField>

          <div
            style={{
              borderTop: "1px solid var(--qz-rule)",
              paddingTop: 16,
            }}
          >
            <div className="qz-label">Floating launcher</div>
            <p className="qz-muted" style={{ fontSize: 13, marginTop: 8 }}>
              Drop the snippet below on any storefront page to render a
              floating button that opens the quiz in a modal.
            </p>
            <label
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                cursor: "pointer",
                marginTop: 12,
              }}
            >
              <input
                type="checkbox"
                checked={doc.launcher_config.enabled}
                onChange={(e) =>
                  onSave({
                    ...doc,
                    launcher_config: {
                      ...doc.launcher_config,
                      enabled: e.target.checked,
                    },
                  })
                }
              />
              <span style={{ fontSize: 14 }}>Enable floating launcher</span>
            </label>
            {doc.launcher_config.enabled && (
              <div className="qz-col qz-gap-12 qz-mt-16">
                <QzField label="Icon">
                  <QzSelect
                    value={doc.launcher_config.icon}
                    onChange={(e) =>
                      onSave({
                        ...doc,
                        launcher_config: {
                          ...doc.launcher_config,
                          icon: e.target.value as
                            | "sparkle"
                            | "star"
                            | "chat",
                        },
                      })
                    }
                  >
                    <option value="sparkle">Sparkle</option>
                    <option value="star">Star</option>
                    <option value="chat">Chat bubble</option>
                  </QzSelect>
                </QzField>
                <QzField label="Corner">
                  <QzSelect
                    value={doc.launcher_config.corner}
                    onChange={(e) =>
                      onSave({
                        ...doc,
                        launcher_config: {
                          ...doc.launcher_config,
                          corner: e.target.value as
                            | "bottom-right"
                            | "bottom-left"
                            | "top-right"
                            | "top-left",
                        },
                      })
                    }
                  >
                    <option value="bottom-right">Bottom right</option>
                    <option value="bottom-left">Bottom left</option>
                    <option value="top-right">Top right</option>
                    <option value="top-left">Top left</option>
                  </QzSelect>
                </QzField>
                <QzField
                  label="Pill label (optional)"
                  hint="Shown alongside the icon. Leave empty for icon-only."
                >
                  <QzInput
                    value={doc.launcher_config.label}
                    placeholder="Take the quiz"
                    onChange={(e) =>
                      onSave({
                        ...doc,
                        launcher_config: {
                          ...doc.launcher_config,
                          label: e.target.value,
                        },
                      })
                    }
                  />
                </QzField>
                <QzField
                  label="Button color (optional)"
                  hint="Hex — defaults to your primary brand color."
                >
                  <QzInput
                    value={doc.launcher_config.color ?? ""}
                    placeholder="#5563DE"
                    onChange={(e) => {
                      const v = e.target.value;
                      onSave({
                        ...doc,
                        launcher_config: {
                          ...doc.launcher_config,
                          ...(v
                            ? { color: v }
                            : { color: undefined }),
                        },
                      });
                    }}
                  />
                </QzField>
                <QzField label="Snippet to embed (publish first)">
                  <pre
                    style={{
                      background: "var(--qz-cream-2)",
                      padding: 10,
                      borderRadius: "var(--qz-radius)",
                      fontSize: 11,
                      fontFamily: "var(--qz-font-mono)",
                      overflowX: "auto",
                      margin: 0,
                    }}
                  >
                    {`<script async src="/q/${doc.quiz_id}/launcher.js"></script>`}
                  </pre>
                </QzField>
              </div>
            )}
          </div>
        </div>

        <div
          className="qz-row qz-gap-8 qz-mt-24"
          style={{ justifyContent: "flex-end" }}
        >
          <QzButton onClick={onClose}>Done</QzButton>
        </div>
      </div>
    </div>
  );
}

function AllPathsModal({
  open,
  onClose,
  doc,
  productIndex,
}: {
  open: boolean;
  onClose: () => void;
  doc: QuizDoc;
  productIndex: IndexedProduct[];
}) {
  const rows = useMemo(() => {
    if (!open) return [];
    const intro = doc.nodes.find((n) => n.type === "intro");
    if (!intro) return [];
    const questions = doc.nodes.filter(
      (n): n is Extract<QuizNodeDoc, { type: "question" }> =>
        n.type === "question",
    );
    if (questions.length === 0) return [];

    const combos = cartesian(
      questions.map((q) => q.data.answers.map((a) => ({ qId: q.id, ans: a }))),
    );
    const MAX = 200;
    const sample = combos.length > MAX ? combos.slice(0, MAX) : combos;

    return sample.map((combo) => walkPath(doc, intro.id, combo, productIndex));
  }, [open, doc, productIndex]);

  const introCount = doc.nodes.filter((n) => n.type === "intro").length;
  const questionCount = doc.nodes.filter((n) => n.type === "question").length;

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(27, 26, 23, 0.4)",
        display: "grid",
        placeItems: "center",
        zIndex: 100,
        backdropFilter: "blur(4px)",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="qz-card qz-flush"
        style={{
          maxWidth: 980,
          width: "100%",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          className="qz-row qz-row-between"
          style={{ padding: 20, borderBottom: "1px solid var(--qz-rule)" }}
        >
          <div>
            <div className="qz-label">Debug</div>
            <h2 className="qz-h1 qz-mt-8">All paths</h2>
          </div>
          <QzButton variant="ghost" size="sm" onClick={onClose}>
            Close
          </QzButton>
        </div>
        <div style={{ padding: 20, overflowY: "auto" }}>
          <p className="qz-muted" style={{ fontSize: 13 }}>
            Every reachable answer combination simulated against the live
            catalog. Rows showing zero products would fall back to the
            destination result&apos;s fallback collection at runtime.
          </p>
          {introCount === 0 || questionCount === 0 ? (
            <QzBanner tone="warn">
              Need an intro and at least one question to enumerate paths.
            </QzBanner>
          ) : rows.length === 0 ? (
            <p className="qz-muted">
              No paths could be walked. Check edge connections.
            </p>
          ) : (
            <table className="qz-table" style={{ marginTop: 12 }}>
              <thead>
                <tr>
                  <th>Path</th>
                  <th>Result</th>
                  <th>Top products</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ combo, resultNode, recs }, idx) => (
                  <tr key={idx}>
                    <td className="qz-mono" style={{ fontSize: 12 }}>
                      {combo.map((c) => c.ans.text || c.ans.id).join(" → ")}
                    </td>
                    <td>
                      {resultNode ? resultNode.data.headline : "(no result)"}
                    </td>
                    <td className="qz-muted" style={{ fontSize: 13 }}>
                      {recs.length === 0
                        ? "— fallback —"
                        : recs.map((r) => r.title).join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function cartesian<T>(arrays: T[][]): T[][] {
  return arrays.reduce<T[][]>(
    (acc, arr) => acc.flatMap((combo) => arr.map((item) => [...combo, item])),
    [[]],
  );
}

function walkPath(
  doc: QuizDoc,
  startId: string,
  combo: Array<{
    qId: string;
    ans: Extract<QuizNodeDoc, { type: "question" }>["data"]["answers"][number];
  }>,
  productIndex: IndexedProduct[],
) {
  const picksByQid: Record<string, (typeof combo)[number]> = {};
  for (const c of combo) picksByQid[c.qId] = c;

  let cursor: string | null = startId;
  for (let i = 0; i < doc.nodes.length + 1 && cursor !== null; i++) {
    const cid: string = cursor;
    const node: QuizNodeDoc | undefined = doc.nodes.find((n) => n.id === cid);
    if (!node || node.type === "result") break;
    if (node.type === "question") {
      const pick: (typeof combo)[number] | undefined = picksByQid[cid];
      type DocEdge = QuizDoc["edges"][number];
      const matched: DocEdge | undefined = pick
        ? doc.edges.find(
            (e) =>
              e.source === cid &&
              e.source_handle === pick.ans.edge_handle_id,
          )
        : undefined;
      const fallback: DocEdge | undefined = doc.edges.find(
        (e) => e.source === cid,
      );
      cursor = (matched ?? fallback)?.target ?? null;
    } else {
      cursor = doc.edges.find((e) => e.source === cid)?.target ?? null;
    }
  }
  const finalId: string | null = cursor;
  const resultNode = finalId
    ? (doc.nodes.find(
        (n): n is Extract<QuizNodeDoc, { type: "result" }> =>
          n.id === finalId && n.type === "result",
      ) ?? null)
    : null;
  const selectedAnswerIds = combo.map((c) => c.ans.id);
  const recs = resultNode
    ? recommendForResult({
        quiz: doc,
        productIndex,
        selectedAnswerIds,
        resultNodeId: resultNode.id,
      })
    : [];
  return { combo, resultNode, recs };
}

function AiTab({
  steeringPrompt,
  onSteeringPromptChange,
  onRegenerate,
  regenState,
  regenError,
}: {
  steeringPrompt: string;
  onSteeringPromptChange: (v: string) => void;
  onRegenerate: () => void;
  regenState: "idle" | "submitting" | "loading";
  regenError: string | null;
}) {
  const isRegen = regenState !== "idle";
  return (
    <div className="qz-col qz-gap-12">
      <p className="qz-muted" style={{ fontSize: 13, margin: 0 }}>
        Ask Claude to rewrite this question. Tags will only be drawn from your
        real catalog. Answer IDs are preserved by order so connected edges
        survive when possible.
      </p>
      <QzField
        label="Steering (optional)"
        meta={`${steeringPrompt.length} / 300`}
      >
        <QzTextarea
          rows={3}
          maxLength={300}
          placeholder="e.g. 'Lean more playful' or 'Add a sensitivity option'"
          value={steeringPrompt}
          onChange={(e) => onSteeringPromptChange(e.target.value)}
        />
      </QzField>
      <QzButton variant="accent" onClick={onRegenerate} disabled={isRegen}>
        {isRegen ? "Regenerating…" : "Regenerate"}
      </QzButton>
      {regenError && (
        <QzBanner tone="crit" title="Regenerate failed">
          {regenError}
        </QzBanner>
      )}
    </div>
  );
}

function EmbedSnippet({
  quizId,
  previewUrl,
}: {
  quizId: string;
  previewUrl: string;
}) {
  const appOrigin = new URL(previewUrl).origin;
  return (
    <div
      style={{
        padding: 12,
        background: "var(--qz-rule-2)",
        borderRadius: "var(--qz-radius)",
      }}
    >
      <div className="qz-label" style={{ marginBottom: 6 }}>
        Theme block settings
      </div>
      <p className="qz-muted" style={{ fontSize: 13, margin: "0 0 8px" }}>
        When adding the Quizocalypse block to a storefront section, paste:
      </p>
      <div
        className="qz-mono"
        style={{ fontSize: 12, color: "var(--qz-ink-2)" }}
      >
        <div>Quiz ID: {quizId}</div>
        <div>App URL: {appOrigin}</div>
      </div>
    </div>
  );
}

// ---------- Page ----------

export default function QuizEditor() {
  const data = useLoaderData<typeof loader>();
  const saveFetcher = useFetcher<{ ok: boolean; savedAt?: string; error?: string }>();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerSave = useCallback(
    (next: QuizDoc) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveFetcher.submit(JSON.stringify({ doc: next }), {
          method: "PUT",
          encType: "application/json",
        });
      }, 800);
    },
    [saveFetcher],
  );

  const publishFetcher = useFetcher<{
    ok: boolean;
    action?: "publish";
    version?: number;
    productCount?: number;
    error?: string;
    issues?: Array<{ path: string; message: string }>;
  }>();
  const handlePublish = useCallback(() => {
    const form = new FormData();
    form.set("intent", "publish");
    publishFetcher.submit(form, { method: "POST" });
  }, [publishFetcher]);

  const regenFetcher = useFetcher<{
    ok: boolean;
    action?: "regenerate-node";
    error?: string;
  }>();
  const [regenCount, setRegenCount] = useState(0);
  useEffect(() => {
    if (regenFetcher.data?.ok && regenFetcher.data.action === "regenerate-node") {
      setRegenCount((c) => c + 1);
    }
  }, [regenFetcher.data]);
  const handleRegenerate = useCallback(
    (nodeId: string, steeringPrompt: string) => {
      const form = new FormData();
      form.set("intent", "regenerate-node");
      form.set("nodeId", nodeId);
      form.set("steeringPrompt", steeringPrompt);
      regenFetcher.submit(form, { method: "POST" });
    },
    [regenFetcher],
  );
  const regenError =
    regenFetcher.data?.ok === false ? (regenFetcher.data.error ?? null) : null;

  if (!data.valid || !data.doc) {
    return (
      <QzPage>
        <TitleBar title={data.name} />
        <QzPageHeader
          eyebrow={
            <Link
              to="/app/quizzes"
              style={{ color: "inherit", textDecoration: "none" }}
            >
              ← Quizzes
            </Link>
          }
          title={data.name}
        />
        <QzBanner tone="crit" title="Quiz JSON failed validation">
          <p style={{ margin: "0 0 8px" }}>
            The stored draft does not match the Quiz schema. Issues:
          </p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {data.issues.map((i, idx) => (
              <li key={idx}>
                <strong>{i.path || "(root)"}</strong>: {i.message}
              </li>
            ))}
          </ul>
          <details style={{ marginTop: 12 }}>
            <summary>Raw stored JSON</summary>
            <pre style={{ fontSize: 11, overflowX: "auto" }}>
              {JSON.stringify(data.rawJson, null, 2)}
            </pre>
          </details>
          {/* Almost always this is an orphan row left behind by a failed
              generation attempt. The list page (/app/quizzes) accepts a
              POST { intent: "delete", id } so we surface that action
              right here as a "Delete and start over" affordance. */}
          <form
            method="POST"
            action="/app/quizzes"
            style={{ marginTop: 16, display: "flex", gap: 12 }}
            onSubmit={(e) => {
              if (
                !confirm(
                  "Delete this incomplete quiz? You can generate a new one from /app/quizzes/new.",
                )
              ) {
                e.preventDefault();
              }
            }}
          >
            <input type="hidden" name="intent" value="delete" />
            <input type="hidden" name="id" value={data.quizId} />
            <QzButton type="submit" variant="primary">
              Delete this quiz
            </QzButton>
            <Link to="/app/quizzes/new" style={{ textDecoration: "none" }}>
              <QzButton>Generate a new one</QzButton>
            </Link>
          </form>
        </QzBanner>
      </QzPage>
    );
  }

  const isSaving =
    saveFetcher.state !== "idle" && saveFetcher.formMethod === "PUT";
  const savedAt =
    saveFetcher.data?.ok && "savedAt" in saveFetcher.data
      ? saveFetcher.data.savedAt
      : null;
  const saveError = saveFetcher.data?.ok === false ? saveFetcher.data.error : null;

  const isPublishing =
    publishFetcher.state !== "idle" && publishFetcher.formMethod === "POST";
  const publishResult =
    publishFetcher.data?.ok && publishFetcher.data.action === "publish"
      ? publishFetcher.data
      : null;
  const publishError =
    publishFetcher.data?.ok === false ? publishFetcher.data : null;

  const previewUrl = data.previewUrl;

  return (
    <QzPage>
      <TitleBar title={data.name} />

      <QzPageHeader
        eyebrow={
          <Link
            to="/app/quizzes"
            style={{ color: "inherit", textDecoration: "none" }}
          >
            ← Quizzes
          </Link>
        }
        title={data.name}
        subtitle="Edit the flow visually. Click any node to open its drawer. Autosave is on — publish to push to the storefront."
        actions={
          <>
            <Link to={`/app/quizzes/${data.quizId}/versions`}>
              <QzButton size="sm">Versions</QzButton>
            </Link>
            <Link to={`/app/quizzes/${data.quizId}/analytics`}>
              <QzButton size="sm">Analytics</QzButton>
            </Link>
            <a href={previewUrl} target="_blank" rel="noreferrer">
              <QzButton size="sm">Preview</QzButton>
            </a>
            <QzButton
              variant="accent"
              onClick={handlePublish}
              disabled={isPublishing}
            >
              {isPublishing ? "Publishing…" : "Publish"}
            </QzButton>
          </>
        }
      />

      <div className="qz-col qz-gap-16">
        {publishError && (
          <QzBanner tone="crit" title="Publish blocked">
            <p style={{ margin: "0 0 8px" }}>{publishError.error}</p>
            {publishError.issues && publishError.issues.length > 0 && (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {publishError.issues.map((i, idx) => (
                  <li key={idx}>
                    <strong>{i.path || "(root)"}</strong>: {i.message}
                  </li>
                ))}
              </ul>
            )}
          </QzBanner>
        )}
        {publishResult && (
          <QzBanner tone="ok" title={`Published v${publishResult.version}`}>
            <div className="qz-col qz-gap-8">
              <p style={{ margin: 0 }}>
                {publishResult.productCount} products indexed.{" "}
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "inherit" }}
                >
                  Open the live storefront preview
                </a>{" "}
                — share this link, or embed via the Quizocalypse theme block.
              </p>
              <EmbedSnippet quizId={data.quizId} previewUrl={previewUrl} />
            </div>
          </QzBanner>
        )}

        <ReactFlowProvider>
          <FlowBuilder
            key={regenCount}
            initialDoc={data.doc}
            collections={data.collections}
            catalogTags={data.catalogTags}
            productIndex={data.productIndex}
            onChange={triggerSave}
            onRegenerate={handleRegenerate}
            regenState={regenFetcher.state}
            regenError={regenError}
          />
        </ReactFlowProvider>

        <div className="qz-row qz-row-between qz-mono qz-dim" style={{ fontSize: 11 }}>
          <span>
            {isSaving
              ? "Saving…"
              : savedAt
                ? `Saved at ${new Date(savedAt).toLocaleTimeString()}`
                : "Edit any field to autosave."}
            {saveError ? ` — error: ${saveError}` : ""}
          </span>
          <span>
            <QzBadge tone={data.status === "published" ? "ok" : "draft"}>
              {data.status}
            </QzBadge>
          </span>
        </div>
      </div>
    </QzPage>
  );
}
