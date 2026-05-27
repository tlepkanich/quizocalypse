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
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { Quiz } from "../lib/quizSchema";
import { publishQuiz, PublishError } from "../lib/quizPublish";
import { regenerateQuestion } from "../lib/claude";
import { buildScopedIndex } from "../lib/catalogIndex";
import {
  recommendForResult,
  type IndexedProduct,
} from "../lib/recommendationEngine";
import type { DesignTokensT } from "../lib/designTokens";
import {
  addAnswer,
  addEdge as addQuizEdge,
  addEmailGateNode,
  addQuestionNode,
  addResultNode,
  deleteEdge as deleteQuizEdge,
  deleteNode as deleteQuizNode,
  removeAnswer,
  setNodePosition,
} from "../lib/quizMutations";
import { autoLayout } from "../lib/autoLayout";
import { validateQuiz, type NodeIssue } from "../lib/quizValidation";
import type { z } from "zod";

type QuizDoc = z.infer<typeof Quiz>;
type QuizNodeDoc = QuizDoc["nodes"][number];

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { id } = params;
  if (!id) throw new Response("Missing quiz id", { status: 400 });

  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
  });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  const quiz = await prisma.quiz.findFirst({
    where: { id, shopId: shop.id },
  });
  if (!quiz) throw new Response("Quiz not found", { status: 404 });

  const collections = await prisma.collection.findMany({
    where: { shopId: shop.id },
    select: { collectionId: true, title: true },
    orderBy: { title: "asc" },
  });

  const products = await prisma.product.findMany({
    where: { shopId: shop.id },
  });
  const productIndex: IndexedProduct[] = products.map((p) => {
    const variants = (p.variants ?? []) as Array<{
      inventoryQuantity?: number | null;
    }>;
    return {
      product_id: p.productId,
      title: p.title,
      price: p.priceMin ? String(p.priceMin) : null,
      image_url: p.imageUrl,
      tags: p.tags,
      collection_ids: p.collectionIds,
      inventory_in_stock: variants.some(
        (v) =>
          typeof v.inventoryQuantity === "number" && v.inventoryQuantity > 0,
      ),
    };
  });
  const catalogTags = [
    ...new Set(products.flatMap((p) => p.tags)),
  ].sort((a, b) => a.localeCompare(b));

  const parsed = Quiz.safeParse(quiz.draftJson);
  const origin = new URL(request.url).origin;
  return json({
    quizId: quiz.id,
    name: quiz.name,
    status: quiz.status,
    version: quiz.version,
    valid: parsed.success,
    issues: parsed.success
      ? []
      : parsed.error.issues.slice(0, 5).map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
    doc: parsed.success ? parsed.data : null,
    rawJson: quiz.draftJson,
    collections,
    catalogTags,
    productIndex,
    previewUrl: `${origin}/q/${quiz.id}`,
  });
};

export const action = async ({ params, request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { id } = params;
  if (!id) return json({ ok: false, error: "Missing id" }, { status: 400 });

  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
  });
  if (!shop) return json({ ok: false, error: "Shop not found" }, { status: 404 });

  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const body = (await request.json()) as { doc: unknown };
    const parsed = Quiz.safeParse(body.doc);
    if (!parsed.success) {
      return json(
        {
          ok: false,
          error: "Invalid quiz document",
          issues: parsed.error.issues.slice(0, 5),
        },
        { status: 400 },
      );
    }
    await prisma.quiz.update({
      where: { id },
      data: { draftJson: parsed.data as never },
    });
    return json({ ok: true, savedAt: new Date().toISOString() });
  }

  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "publish") {
    try {
      const result = await publishQuiz(prisma, { quizId: id, shopId: shop.id });
      return json({
        ok: true,
        action: "publish" as const,
        version: result.version,
        productCount: result.productCount,
      });
    } catch (err) {
      if (err instanceof PublishError) {
        return json(
          { ok: false, error: err.message, issues: err.issues },
          { status: 400 },
        );
      }
      const message = err instanceof Error ? err.message : String(err);
      return json({ ok: false, error: message }, { status: 500 });
    }
  }

  if (intent === "regenerate-node") {
    const nodeId = String(form.get("nodeId") ?? "");
    const steeringPrompt = String(form.get("steeringPrompt") ?? "");

    const quiz = await prisma.quiz.findFirst({
      where: { id, shopId: shop.id },
    });
    if (!quiz) return json({ ok: false, error: "Quiz not found" }, { status: 404 });

    const parsed = Quiz.safeParse(quiz.draftJson);
    if (!parsed.success) {
      return json({ ok: false, error: "Invalid quiz JSON" }, { status: 400 });
    }
    const doc = parsed.data;
    const target = doc.nodes.find(
      (n) => n.id === nodeId && n.type === "question",
    );
    if (!target || target.type !== "question") {
      return json({ ok: false, error: "Question node not found" }, { status: 404 });
    }

    const [allProducts, allCollections] = await Promise.all([
      prisma.product.findMany({ where: { shopId: shop.id } }),
      prisma.collection.findMany({ where: { shopId: shop.id } }),
    ]);
    const indexed = buildScopedIndex(
      allProducts,
      allCollections,
      doc.scope.collection_ids,
    );

    let regen;
    try {
      regen = await regenerateQuestion({
        catalogSummary: indexed.summary,
        existingQuestion: target.data,
        steeringPrompt,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return json({ ok: false, error: message }, { status: 502 });
    }

    const oldAnswers = target.data.answers;
    const mergedAnswers = regen.answers.map((newA, idx) => {
      const oldA = oldAnswers[idx];
      const id = oldA?.id ?? `a_${Math.random().toString(36).slice(2, 10)}`;
      const handle =
        oldA?.edge_handle_id ?? `h_${Math.random().toString(36).slice(2, 10)}`;
      return {
        id,
        text: newA.text,
        tags: newA.tags,
        ...(newA.collection_filter
          ? { collection_filter: newA.collection_filter }
          : {}),
        ...(newA.image_url ? { image_url: newA.image_url } : {}),
        edge_handle_id: handle,
      };
    });

    const handlesNow = new Set(mergedAnswers.map((a) => a.edge_handle_id));
    const prunedEdges = doc.edges.filter(
      (e) =>
        e.source !== nodeId || !e.source_handle || handlesNow.has(e.source_handle),
    );

    const updatedNode = {
      ...target,
      data: {
        ...target.data,
        text: regen.text,
        question_type: regen.question_type,
        required: regen.required,
        ...(regen.max_selections !== undefined
          ? { max_selections: regen.max_selections }
          : {}),
        answers: mergedAnswers,
      },
    };

    const updatedDoc = {
      ...doc,
      nodes: doc.nodes.map((n) => (n.id === nodeId ? updatedNode : n)),
      edges: prunedEdges,
    };

    const reparsed = Quiz.safeParse(updatedDoc);
    if (!reparsed.success) {
      return json(
        {
          ok: false,
          error:
            "Regenerated question failed schema validation: " +
            reparsed.error.issues
              .slice(0, 3)
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; "),
        },
        { status: 500 },
      );
    }

    await prisma.quiz.update({
      where: { id },
      data: { draftJson: reparsed.data as never },
    });

    return json({
      ok: true,
      action: "regenerate-node" as const,
      doc: reparsed.data,
    });
  }

  return json({ ok: false, error: "Unknown intent" }, { status: 400 });
};

// ---------- Custom node renderers (React Flow) ----------
// These use plain HTML inputs and inherit the redesign palette via CSS vars
// when possible. Node accent colors stay distinct so node types remain
// visually identifiable in the graph.

interface NodeData extends Record<string, unknown> {
  doc: QuizNodeDoc;
  issues: NodeIssue[];
  onChange: (next: QuizNodeDoc) => void;
  onAddAnswer: (nodeId: string) => void;
  onRemoveAnswer: (nodeId: string, answerId: string) => void;
}

function IntroNodeView({ data }: NodeProps) {
  const d = data as NodeData;
  if (d.doc.type !== "intro") return null;
  return (
    <NodeShell accent="#5563DE" label="intro" handles="source" issues={d.issues}>
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
  return (
    <NodeShell accent="#2C7A4B" label={`question · ${d.doc.data.question_type}`} issues={d.issues}>
      <Handle type="target" position={Position.Left} />
      <NodeField
        label="Question"
        value={d.doc.data.text}
        onChange={(v) =>
          d.onChange({ ...d.doc, data: { ...d.doc.data, text: v } as never })
        }
        multiline
      />
      <div style={{ marginTop: 8, fontSize: 11, color: "var(--qz-ink-3)" }}>Answers</div>
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
            {answers.length > 2 && (
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
        </div>
      ))}
      <InlineNoDrag>
        <button
          type="button"
          onClick={() => d.onAddAnswer(d.doc.id)}
          style={btnGhost}
        >
          + Add answer
        </button>
      </InlineNoDrag>
    </NodeShell>
  );
}

function EmailGateNodeView({ data }: NodeProps) {
  const d = data as NodeData;
  if (d.doc.type !== "email_gate") return null;
  return (
    <NodeShell accent="#7E57C2" label="email_gate" handles="both" issues={d.issues}>
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
    <NodeShell accent="#BB6622" label="result" handles="target" issues={d.issues}>
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

const nodeTypes = {
  intro: IntroNodeView,
  question: QuestionNodeView,
  email_gate: EmailGateNodeView,
  result: ResultNodeView,
};

function NodeShell({
  accent,
  label,
  children,
  handles,
  issues,
}: {
  accent: string;
  label: string;
  children: React.ReactNode;
  handles?: "source" | "target" | "both";
  issues: NodeIssue[];
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
      </div>
      {children}
      {(handles === "source" || handles === "both") && (
        <Handle type="source" position={Position.Right} />
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

  const rfNodes: Node[] = useMemo(
    () =>
      doc.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        position: n.position,
        data: {
          doc: n,
          issues: issuesByNode.get(n.id) ?? [],
          onChange: updateNode,
          onAddAnswer: handleAddAnswer,
          onRemoveAnswer: handleRemoveAnswer,
        } satisfies NodeData,
        ...(selectedId === n.id ? { selected: true } : {}),
      })),
    [doc.nodes, issuesByNode, updateNode, handleAddAnswer, handleRemoveAnswer, selectedId],
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
    (kind: "question" | "result" | "email_gate") => {
      setAddMenuOpen(false);
      const anchor = selectedId;
      if (kind === "question") commit(addQuestionNode(doc, anchor));
      else if (kind === "email_gate") commit(addEmailGateNode(doc, anchor));
      else {
        const fallback = collections[0]?.collectionId ?? "";
        commit(addResultNode(doc, anchor, fallback));
      }
    },
    [doc, commit, selectedId, collections],
  );

  const allIssues = useMemo(() => validateQuiz(doc), [doc]);

  const selectedNode = useMemo(
    () => doc.nodes.find((n) => n.id === selectedId) ?? null,
    [doc.nodes, selectedId],
  );

  const [allPathsOpen, setAllPathsOpen] = useState(false);

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
                        ["Add result", "result"],
                        ["Add email gate", "email_gate"],
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
              onChange={updateNode}
              onNodeDesignChange={(next) =>
                commit({
                  ...doc,
                  design_overrides: {
                    ...doc.design_overrides,
                    [selectedNode.id]: next,
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

function NodeDrawer({
  node,
  doc,
  collections,
  catalogTags,
  productIndex,
  nodeOverride,
  onChange,
  onNodeDesignChange,
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
  onChange: (next: QuizNodeDoc) => void;
  onNodeDesignChange: (next: DesignTokensT) => void;
  onApplyDesignToAll: (type: "question" | "result", tokens: DesignTokensT) => void;
  onClose: () => void;
  onRegenerate: (prompt: string) => void;
  regenState: "idle" | "submitting" | "loading";
  regenError: string | null;
}) {
  const isQuestion = node.type === "question";
  const isResult = node.type === "result";
  const availableTabs = [
    { id: "content", label: "Content" },
    ...(isQuestion ? [{ id: "logic", label: "Logic" }] : []),
    ...(isResult ? [{ id: "preview", label: "Preview" }] : []),
    { id: "design", label: "Design" },
    ...(isQuestion ? [{ id: "ai", label: "AI" }] : []),
  ];
  const [tabId, setTabId] = useState<string>("content");
  const [steeringPrompt, setSteeringPrompt] = useState("");

  // If the active tab disappears when the node type changes, fall back to content.
  const validTab = availableTabs.some((t) => t.id === tabId) ? tabId : "content";

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

        <TabBar
          tabs={availableTabs}
          active={validTab}
          onSelect={setTabId}
        />

        <div style={{ marginTop: 4 }}>
          {validTab === "content" && <ContentTab node={node} onChange={onChange} />}
          {validTab === "logic" && node.type === "question" && (
            <LogicTab
              node={node}
              collections={collections}
              catalogTags={catalogTags}
              onChange={onChange}
            />
          )}
          {validTab === "preview" && node.type === "result" && (
            <ResultPreviewTab
              node={node}
              doc={doc}
              productIndex={productIndex}
            />
          )}
          {validTab === "design" && (
            <DesignTab
              nodeType={node.type}
              override={nodeOverride}
              onChange={onNodeDesignChange}
              onApplyToAll={onApplyDesignToAll}
            />
          )}
          {validTab === "ai" && isQuestion && (
            <AiTab
              steeringPrompt={steeringPrompt}
              onSteeringPromptChange={setSteeringPrompt}
              onRegenerate={() => onRegenerate(steeringPrompt)}
              regenState={regenState}
              regenError={regenError}
            />
          )}
        </div>
      </div>
    </QzCard>
  );
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
      return `Intro · ${node.data.headline}`;
    case "question":
      return `Question · ${node.data.text.slice(0, 30)}`;
    case "email_gate":
      return `Email gate`;
    case "result":
      return `Result · ${node.data.headline}`;
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
          </QzSelect>
        </QzField>
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

  // result
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
        </div>
      ))}
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
