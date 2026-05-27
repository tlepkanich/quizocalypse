import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useFetcher, useLoaderData } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  Text,
  Banner,
  Badge,
  InlineStack,
  Button,
  Popover,
  ActionList,
  Tabs,
  TextField,
  Tag,
  Select,
  Box,
  Combobox,
  Listbox,
  Modal,
  DataTable,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
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

  // Catalog tags + slim product index for the drawer's Logic tab autocomplete
  // and the result node's live recommendation preview.
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
  // Build an absolute preview URL using the request origin (the tunnel host),
  // so opening the preview in a new tab from inside the admin iframe lands on
  // the tunnel rather than admin.shopify.com/q/...
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

  // Content-Type drives the intent: JSON body = autosave; form = publish action.
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

    // Merge: preserve existing answer ids/edge_handle_ids by order so edges survive.
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

    // Prune edges whose source handle no longer exists.
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

    // Re-validate before persisting.
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

// ---------- Custom node renderers ----------

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
      <Field
        label="Headline"
        value={d.doc.data.headline}
        onChange={(v) =>
          d.onChange({ ...d.doc, data: { ...d.doc.data, headline: v } as never })
        }
      />
      <Field
        label="Subtext"
        value={d.doc.data.subtext}
        onChange={(v) =>
          d.onChange({ ...d.doc, data: { ...d.doc.data, subtext: v } as never })
        }
        multiline
      />
      <Field
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
      <Field
        label="Question"
        value={d.doc.data.text}
        onChange={(v) =>
          d.onChange({ ...d.doc, data: { ...d.doc.data, text: v } as never })
        }
        multiline
      />
      <div style={{ marginTop: 8, fontSize: 11, color: "#666" }}>Answers</div>
      {answers.map((answer, idx) => (
        <div key={answer.id} style={{ position: "relative" }}>
          <InlineNoDrag>
            <Field
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
          {/* Per-answer source handle, stacked vertically along the right edge. */}
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
      <Field
        label="Headline"
        value={d.doc.data.headline}
        onChange={(v) =>
          d.onChange({ ...d.doc, data: { ...d.doc.data, headline: v } as never })
        }
      />
      <Field
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
      <Field
        label="Headline"
        value={d.doc.data.headline}
        onChange={(v) =>
          d.onChange({ ...d.doc, data: { ...d.doc.data, headline: v } as never })
        }
      />
      <Field
        label="Subtext"
        value={d.doc.data.subtext}
        onChange={(v) =>
          d.onChange({ ...d.doc, data: { ...d.doc.data, subtext: v } as never })
        }
        multiline
      />
      <Field
        label="CTA"
        value={d.doc.data.cta_label}
        onChange={(v) =>
          d.onChange({ ...d.doc, data: { ...d.doc.data, cta_label: v } as never })
        }
      />
      <Field
        label="Fallback collection"
        value={d.doc.data.fallback_collection_id}
        onChange={(v) =>
          d.onChange({
            ...d.doc,
            data: { ...d.doc.data, fallback_collection_id: v } as never,
          })
        }
      />
      <div style={{ marginTop: 6, fontSize: 10, color: "#888" }}>
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
        background: "white",
        border: `2px solid ${hasIssue ? "#D72C0D" : accent}`,
        borderRadius: 8,
        padding: 10,
        minWidth: 260,
        maxWidth: 320,
        boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
        fontSize: 12,
        position: "relative",
      }}
    >
      {(handles === "target" || handles === "both") && (
        <Handle type="target" position={Position.Left} />
      )}
      <div
        style={{
          fontSize: 10,
          color: accent,
          textTransform: "uppercase",
          fontWeight: 600,
          letterSpacing: 0.5,
          marginBottom: 6,
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>{label}</span>
        {hasIssue && (
          <span
            title={issues.map((i) => i.message).join(" · ")}
            style={{
              background: "#D72C0D",
              color: "white",
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

function Field({
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
      style={{ display: "block", marginBottom: inline ? 4 : 6 }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <span
        style={{
          fontSize: 10,
          color: "#666",
          display: "block",
          marginBottom: 2,
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
          padding: "4px 6px",
          border: "1px solid #ddd",
          borderRadius: 4,
          fontSize: 12,
          fontFamily: "inherit",
          resize: multiline ? "vertical" : "none",
          boxSizing: "border-box",
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
  border: "1px solid #ddd",
  borderRadius: 4,
  cursor: "pointer",
  width: 22,
  height: 22,
  fontSize: 16,
  lineHeight: 1,
  color: "#888",
};

const btnGhost: React.CSSProperties = {
  background: "transparent",
  border: "1px dashed #aaa",
  borderRadius: 4,
  padding: "4px 8px",
  cursor: "pointer",
  fontSize: 11,
  color: "#555",
  width: "100%",
  marginTop: 6,
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

  // Keep React Flow state in sync with the source-of-truth doc whenever the
  // doc changes externally (autosave round-trip, mutation outside drag).
  useEffect(() => {
    setNodes(rfNodes);
  }, [rfNodes, setNodes]);
  useEffect(() => {
    setEdges(rfEdges);
  }, [rfEdges, setEdges]);

  // Position changes: apply locally for smooth dragging, commit to doc on drop.
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
        // Don't delete the intro node — it's required.
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
      <InlineStack gap="200" align="space-between">
        <InlineStack gap="200">
          <Button onClick={handleAutoLayout}>Auto-layout</Button>
          <Button onClick={() => setAllPathsOpen(true)}>View all paths</Button>
          {allIssues.length > 0 && (
            <Badge tone="critical">{`${allIssues.length} validation issue${allIssues.length === 1 ? "" : "s"}`}</Badge>
          )}
        </InlineStack>
        <Text as="span" variant="bodySm" tone="subdued">
          {doc.nodes.length} nodes · {doc.edges.length} edges · Press Delete to remove selection
        </Text>
      </InlineStack>
      <AllPathsModal
        open={allPathsOpen}
        onClose={() => setAllPathsOpen(false)}
        doc={doc}
        productIndex={productIndex}
      />

      <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
        <div
          style={{
            flex: 1,
            height: 640,
            background: "#FAFAFA",
            position: "relative",
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

          <div style={{ position: "absolute", right: 20, bottom: 20, zIndex: 5 }}>
            <Popover
              active={addMenuOpen}
              onClose={() => setAddMenuOpen(false)}
              activator={
                <button
                  type="button"
                  onClick={() => setAddMenuOpen((o) => !o)}
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 24,
                    background: "#5563DE",
                    color: "white",
                    border: "none",
                    fontSize: 26,
                    cursor: "pointer",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
                  }}
                  title={selectedId ? "Add node connected to selection" : "Add node"}
                >
                  +
                </button>
              }
            >
              <ActionList
                items={[
                  { content: "Add question", onAction: () => handleAddNode("question") },
                  { content: "Add result", onAction: () => handleAddNode("result") },
                  { content: "Add email gate", onAction: () => handleAddNode("email_gate") },
                ]}
              />
            </Popover>
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
    { id: "content", content: "Content" },
    ...(isQuestion ? [{ id: "logic", content: "Logic" }] : []),
    ...(isResult ? [{ id: "preview", content: "Preview" }] : []),
    { id: "design", content: "Design" },
    ...(isQuestion ? [{ id: "ai", content: "AI" }] : []),
  ];
  const [tabIndex, setTabIndex] = useState(0);
  const [steeringPrompt, setSteeringPrompt] = useState("");
  const tabId = availableTabs[tabIndex]?.id ?? "content";

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h3" variant="headingSm">
            {nodeLabel(node)}
          </Text>
          <Button variant="plain" onClick={onClose}>
            Close
          </Button>
        </InlineStack>

        <Tabs
          tabs={availableTabs}
          selected={tabIndex}
          onSelect={setTabIndex}
          fitted
        />

        {tabId === "content" && (
          <ContentTab node={node} onChange={onChange} />
        )}
        {tabId === "logic" && isQuestion && node.type === "question" && (
          <LogicTab
            node={node}
            collections={collections}
            catalogTags={catalogTags}
            onChange={onChange}
          />
        )}
        {tabId === "preview" && isResult && node.type === "result" && (
          <ResultPreviewTab
            node={node}
            doc={doc}
            productIndex={productIndex}
          />
        )}
        {tabId === "design" && (
          <DesignTab
            nodeType={node.type}
            override={nodeOverride}
            onChange={onNodeDesignChange}
            onApplyToAll={onApplyDesignToAll}
          />
        )}
        {tabId === "ai" && isQuestion && (
          <AiTab
            steeringPrompt={steeringPrompt}
            onSteeringPromptChange={setSteeringPrompt}
            onRegenerate={() => onRegenerate(steeringPrompt)}
            regenState={regenState}
            regenError={regenError}
          />
        )}
      </BlockStack>
    </Card>
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
    <Box
      padding="300"
      background="bg-surface-secondary"
      borderRadius="200"
    >
      <BlockStack gap="100">
        <Text as="p" variant="bodySm" fontWeight="semibold">
          Theme block settings
        </Text>
        <Text as="p" variant="bodySm" tone="subdued">
          When adding the Quizocalypse block to a storefront section, paste:
        </Text>
        <code style={{ fontSize: 12, display: "block" }}>
          Quiz ID: {quizId}
        </code>
        <code style={{ fontSize: 12, display: "block" }}>
          App URL: {appOrigin}
        </code>
      </BlockStack>
    </Box>
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
      <BlockStack gap="300">
        <TextField
          label="Question text"
          value={node.data.text}
          onChange={(v) =>
            onChange({ ...node, data: { ...node.data, text: v } as never })
          }
          autoComplete="off"
          multiline={3}
        />
        <Select
          label="Question type"
          value={node.data.question_type}
          onChange={(v) =>
            onChange({
              ...node,
              data: {
                ...node.data,
                question_type: v as typeof node.data.question_type,
              } as never,
            })
          }
          options={[
            { label: "Single select", value: "single_select" },
            { label: "Multi select", value: "multi_select" },
            { label: "Image tile", value: "image_tile" },
          ]}
        />
        {node.data.question_type === "multi_select" && (
          <TextField
            label="Max selections (optional)"
            type="number"
            value={
              node.data.max_selections !== undefined
                ? String(node.data.max_selections)
                : ""
            }
            onChange={(v) => {
              const num = v ? Number(v) : undefined;
              onChange({
                ...node,
                data: {
                  ...node.data,
                  ...(num ? { max_selections: num } : { max_selections: undefined }),
                } as never,
              });
            }}
            autoComplete="off"
          />
        )}
      </BlockStack>
    );
  }

  if (node.type === "intro") {
    return (
      <BlockStack gap="300">
        <TextField
          label="Headline"
          value={node.data.headline}
          onChange={(v) =>
            onChange({ ...node, data: { ...node.data, headline: v } as never })
          }
          autoComplete="off"
        />
        <TextField
          label="Subtext"
          value={node.data.subtext}
          onChange={(v) =>
            onChange({ ...node, data: { ...node.data, subtext: v } as never })
          }
          autoComplete="off"
          multiline={3}
        />
        <TextField
          label="Button label"
          value={node.data.button_label}
          onChange={(v) =>
            onChange({
              ...node,
              data: { ...node.data, button_label: v } as never,
            })
          }
          autoComplete="off"
        />
      </BlockStack>
    );
  }

  if (node.type === "email_gate") {
    return (
      <BlockStack gap="300">
        <TextField
          label="Headline"
          value={node.data.headline}
          onChange={(v) =>
            onChange({ ...node, data: { ...node.data, headline: v } as never })
          }
          autoComplete="off"
        />
        <TextField
          label="Subtext"
          value={node.data.subtext}
          onChange={(v) =>
            onChange({ ...node, data: { ...node.data, subtext: v } as never })
          }
          autoComplete="off"
          multiline={3}
        />
      </BlockStack>
    );
  }

  // result
  return (
    <BlockStack gap="300">
      <TextField
        label="Headline"
        value={node.data.headline}
        onChange={(v) =>
          onChange({ ...node, data: { ...node.data, headline: v } as never })
        }
        autoComplete="off"
      />
      <TextField
        label="Subtext"
        value={node.data.subtext}
        onChange={(v) =>
          onChange({ ...node, data: { ...node.data, subtext: v } as never })
        }
        autoComplete="off"
        multiline={3}
      />
      <TextField
        label="CTA label"
        value={node.data.cta_label}
        onChange={(v) =>
          onChange({ ...node, data: { ...node.data, cta_label: v } as never })
        }
        autoComplete="off"
      />
      <TextField
        label="Slot count (1–6)"
        type="number"
        value={String(node.data.slot_count)}
        onChange={(v) =>
          onChange({
            ...node,
            data: {
              ...node.data,
              slot_count: Math.max(1, Math.min(6, Number(v) || 1)),
            } as never,
          })
        }
        autoComplete="off"
      />
    </BlockStack>
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
  const collectionOptions = [
    { label: "(no filter)", value: "" },
    ...collections.map((c) => ({ label: c.title, value: c.collectionId })),
  ];

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
    <BlockStack gap="400">
      <Text as="p" variant="bodySm" tone="subdued">
        Each answer adds tags to the recommendation bag and optionally narrows
        candidates to a specific collection. Tag suggestions come from your
        live catalog — typing a non-catalog tag is allowed but won&apos;t match
        any products.
      </Text>
      {node.data.answers.map((answer, idx) => (
        <BlockStack key={answer.id} gap="200">
          <Text as="h4" variant="headingSm">
            Answer {idx + 1}: {answer.text || "(untitled)"}
          </Text>
          <TagAutocomplete
            tags={answer.tags}
            catalogTags={catalogTags}
            onChange={(tags) => updateAnswer(idx, { tags })}
          />
          <Select
            label="Collection filter"
            value={answer.collection_filter ?? ""}
            onChange={(v) =>
              updateAnswer(idx, {
                ...(v ? { collection_filter: v } : { collection_filter: undefined }),
              })
            }
            options={collectionOptions}
          />
          {isImageTile && (
            <TextField
              label="Image URL"
              value={answer.image_url ?? ""}
              onChange={(v) =>
                updateAnswer(idx, {
                  ...(v ? { image_url: v } : { image_url: undefined }),
                })
              }
              autoComplete="off"
              placeholder="https://cdn.shopify.com/..."
            />
          )}
        </BlockStack>
      ))}
    </BlockStack>
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
  };

  const removeTag = (tag: string) => {
    onChange(tags.filter((t) => t !== tag));
  };

  const inCatalog = (t: string) => catalogTags.includes(t);
  const customTagButton =
    input.trim() && !catalogTags.includes(input.trim()) && !tags.includes(input.trim());

  return (
    <BlockStack gap="200">
      <InlineStack gap="100" wrap>
        {tags.length === 0 && (
          <Text as="span" variant="bodySm" tone="subdued">
            No tags yet
          </Text>
        )}
        {tags.map((t) => (
          <Tag key={t} onRemove={() => removeTag(t)}>
            {inCatalog(t) ? t : `${t} (not in catalog)`}
          </Tag>
        ))}
      </InlineStack>
      <Combobox
        activator={
          <Combobox.TextField
            label="Add tag"
            labelHidden
            autoComplete="off"
            placeholder="Search catalog tags…"
            value={input}
            onChange={setInput}
          />
        }
      >
        {filtered.length > 0 ? (
          <Listbox onSelect={addTag}>
            {filtered.map((t) => (
              <Listbox.Option key={t} value={t}>
                {t}
              </Listbox.Option>
            ))}
          </Listbox>
        ) : undefined}
      </Combobox>
      {customTagButton && (
        <Button variant="plain" onClick={() => addTag(input)}>
          Add custom tag &ldquo;{input.trim()}&rdquo; (not in catalog)
        </Button>
      )}
    </BlockStack>
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
    <BlockStack gap="300">
      <Text as="p" variant="bodySm" tone="subdued">
        Per-node overrides on top of your brand defaults + quiz tokens. Leave
        a color blank to inherit from the parent layer.
      </Text>
      {colorRoles.map((role) => {
        const value = override.colors?.[role.key];
        return (
          <InlineStack key={role.key} gap="300" blockAlign="center">
            <Box minWidth="90px">
              <Text as="span" variant="bodyMd">
                {role.label}
              </Text>
            </Box>
            <input
              type="color"
              value={value ?? "#000000"}
              onChange={(e) => setColor(role.key, e.target.value)}
              style={{ width: 40, height: 32, border: "none", padding: 0 }}
            />
            <div style={{ flex: 1 }}>
              <TextField
                label=""
                labelHidden
                value={value ?? ""}
                onChange={(v) => setColor(role.key, v || null)}
                placeholder="(inherit)"
                autoComplete="off"
              />
            </div>
            {value && (
              <Button
                variant="plain"
                onClick={() => setColor(role.key, null)}
              >
                Clear
              </Button>
            )}
          </InlineStack>
        );
      })}
      <InlineStack gap="200" wrap>
        {(nodeType === "question" || nodeType === "result") && hasOverrides && (
          <Button
            variant="plain"
            onClick={() => onApplyToAll(nodeType, override)}
          >
            Apply to all {nodeType === "question" ? "questions" : "results"}
          </Button>
        )}
        {hasOverrides && (
          <Button variant="plain" tone="critical" onClick={reset}>
            Reset all node overrides
          </Button>
        )}
      </InlineStack>
    </BlockStack>
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
  // For each question, track which answer the merchant is simulating.
  const [picks, setPicks] = useState<Record<string, string | "_first">>({});

  const selectedAnswerIds = useMemo(() => {
    return questionNodes
      .map((q) => {
        const pick = picks[q.id] ?? "_first";
        const ans = pick === "_first" ? q.data.answers[0] : q.data.answers.find((a) => a.id === pick);
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
    <BlockStack gap="300">
      <Text as="p" variant="bodySm" tone="subdued">
        Simulate the quiz against your live catalog. Pick an answer per
        question and the recommendation engine ranks products for this result
        in real time.
      </Text>
      {questionNodes.length === 0 ? (
        <Banner tone="info">
          <p>No question nodes to simulate against.</p>
        </Banner>
      ) : (
        questionNodes.map((q) => (
          <Select
            key={q.id}
            label={q.data.text.slice(0, 70) || "Question"}
            value={picks[q.id] ?? "_first"}
            onChange={(v) => setPicks({ ...picks, [q.id]: v })}
            options={[
              { label: "First answer", value: "_first" },
              ...q.data.answers.map((a) => ({
                label: a.text || a.id,
                value: a.id,
              })),
            ]}
          />
        ))
      )}
      <BlockStack gap="100">
        <Text as="h4" variant="headingSm">
          Top {node.data.slot_count} products
        </Text>
        {recs.length === 0 ? (
          <Text as="p" variant="bodySm" tone="subdued">
            No matches — would fall back to{" "}
            <code>{node.data.fallback_collection_id || "(no fallback)"}</code>.
          </Text>
        ) : (
          recs.map((r) => (
            <Box
              key={r.product_id}
              padding="200"
              background="bg-surface-secondary"
              borderRadius="200"
            >
              <InlineStack gap="200" align="space-between">
                <Text as="span" variant="bodyMd" fontWeight="semibold">
                  {r.title}
                </Text>
                <InlineStack gap="100">
                  <Badge>{`score ${r.score}`}</Badge>
                  {!r.inventory_in_stock && (
                    <Badge tone="critical">out of stock</Badge>
                  )}
                </InlineStack>
              </InlineStack>
            </Box>
          ))
        )}
      </BlockStack>
    </BlockStack>
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

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="All paths"
      size="large"
      primaryAction={{ content: "Close", onAction: onClose }}
    >
      <Modal.Section>
        <BlockStack gap="300">
          <Text as="p" variant="bodySm" tone="subdued">
            Every reachable answer combination simulated against the live
            catalog. Rows showing zero products would fall back to the
            destination result&apos;s fallback collection at runtime.
          </Text>
          {introCount === 0 || questionCount === 0 ? (
            <Banner tone="warning">
              <p>Need an intro and at least one question to enumerate paths.</p>
            </Banner>
          ) : rows.length === 0 ? (
            <Text as="p" variant="bodySm">
              No paths could be walked. Check edge connections.
            </Text>
          ) : (
            <DataTable
              columnContentTypes={["text", "text", "text"]}
              headings={["Path", "Result", "Top products"]}
              rows={rows.map(({ combo, resultNode, recs }) => [
                combo.map((c) => c.ans.text || c.ans.id).join(" → "),
                resultNode ? resultNode.data.headline : "(no result)",
                recs.length === 0
                  ? "— fallback —"
                  : recs.map((r) => r.title).join(", "),
              ])}
            />
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
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
    <BlockStack gap="300">
      <Text as="p" variant="bodySm" tone="subdued">
        Ask Claude to rewrite this question. Tags will only be drawn from your
        real catalog. Answer IDs are preserved by order so connected edges
        survive when possible.
      </Text>
      <TextField
        label="Steering (optional)"
        value={steeringPrompt}
        onChange={onSteeringPromptChange}
        autoComplete="off"
        multiline={3}
        placeholder="e.g. 'Lean more playful' or 'Add a sensitivity option'"
        maxLength={300}
        showCharacterCount
      />
      <Button variant="primary" onClick={onRegenerate} loading={isRegen}>
        Regenerate
      </Button>
      {regenError && (
        <Banner tone="critical" title="Regenerate failed">
          <p>{regenError}</p>
        </Banner>
      )}
    </BlockStack>
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

  // Per-question regenerate. After it completes successfully, bump a counter
  // used as a `key` on FlowBuilder to force remount with the loader's revalidated
  // doc (Remix auto-revalidates loaders after an action succeeds).
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
      <Page backAction={{ content: "Dashboard", url: "/app" }}>
        <TitleBar title={data.name} />
        <Banner tone="critical" title="Quiz JSON failed validation">
          <p>The stored draft does not match the Quiz schema. Issues:</p>
          <ul>
            {data.issues.map((i, idx) => (
              <li key={idx}>
                <strong>{i.path || "(root)"}</strong>: {i.message}
              </li>
            ))}
          </ul>
          <details style={{ marginTop: 12 }}>
            <summary>Raw stored JSON</summary>
            <pre style={{ fontSize: 11 }}>
              {JSON.stringify(data.rawJson, null, 2)}
            </pre>
          </details>
        </Banner>
      </Page>
    );
  }

  const isSaving =
    saveFetcher.state !== "idle" &&
    saveFetcher.formMethod === "PUT";
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
    <Page
      backAction={{ content: "Quizzes", url: "/app/quizzes" }}
      title={data.name}
      titleMetadata={<Badge tone="info">{data.status}</Badge>}
    >
      <TitleBar title={data.name} />
      <BlockStack gap="300">
        {publishError && (
          <Banner tone="critical" title="Publish blocked">
            <p>{publishError.error}</p>
            {publishError.issues && publishError.issues.length > 0 && (
              <ul>
                {publishError.issues.map((i, idx) => (
                  <li key={idx}>
                    <strong>{i.path || "(root)"}</strong>: {i.message}
                  </li>
                ))}
              </ul>
            )}
          </Banner>
        )}
        {publishResult && (
          <Banner tone="success" title={`Published v${publishResult.version}`}>
            <BlockStack gap="200">
              <p>
                {publishResult.productCount} products indexed.{" "}
                <a href={previewUrl} target="_blank" rel="noreferrer">
                  Open the live storefront preview
                </a>{" "}
                — share this link, or embed in any storefront page via the
                Quizocalypse theme block (Online Store → Customize → Add
                block).
              </p>
              <EmbedSnippet quizId={data.quizId} previewUrl={previewUrl} />
            </BlockStack>
          </Banner>
        )}
        <Card padding="0">
          <div style={{ padding: 12 }}>
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
          </div>
        </Card>
        <InlineStack gap="200" align="space-between">
          <Text as="span" variant="bodySm" tone="subdued">
            {isSaving
              ? "Saving…"
              : savedAt
                ? `Saved at ${new Date(savedAt).toLocaleTimeString()}`
                : "Edit any field to autosave."}
            {saveError ? ` — error: ${saveError}` : ""}
          </Text>
          <InlineStack gap="200">
            <Link to={`/app/quizzes/${data.quizId}/versions`}>
              <Button>Versions</Button>
            </Link>
            <Link to={`/app/quizzes/${data.quizId}/analytics`}>
              <Button>Analytics</Button>
            </Link>
            <Button url={previewUrl} target="_blank">
              Preview
            </Button>
            <Button
              variant="primary"
              onClick={handlePublish}
              loading={isPublishing}
            >
              Publish
            </Button>
          </InlineStack>
        </InlineStack>
      </BlockStack>
    </Page>
  );
}
