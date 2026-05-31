import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useFetcher, useLoaderData } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import {
  QzPage,
  QzPageHeader,
  QzButton,
  QzBadge,
  QzBanner,
  QzField,
  QzInput,
  QzTextarea,
  QzSelect,
} from "../components/qz";
import {
  loadQuizEditorData,
  handleQuizEditorAction,
} from "../lib/quizEditorIO.server";
import type { ContentBlock, DesignTokens, Quiz, QuizNode } from "../lib/quizSchema";
import { validateQuiz, type NodeIssue } from "../lib/quizValidation";
import { orderFlow } from "../lib/flowOrder";
import { synthesizeLayout } from "../lib/synthesizeLayout";
import { StepPreview } from "../components/runtime/StepPreview";
import { addAnswer, deleteNode, removeAnswer } from "../lib/quizMutations";
import {
  INSERTABLE_MODULES,
  PALETTE_BLOCKS,
  blockAdd,
  blockMove,
  blockRemove,
  blockUpdate,
  getNodeLayout,
  insertModule,
  makeBlock,
  setNodeCss,
  setNodeLayout,
  updateNodeData,
  type InsertKind,
} from "../components/studio/studioDoc";

type QuizDoc = Quiz;
type Breakpoint = "synced" | "desktop" | "mobile";

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

const NODE_LABEL: Record<QuizNode["type"], string> = {
  intro: "Intro",
  question: "Question",
  email_gate: "Email gate",
  result: "Result",
  message: "Message",
  end: "End",
  branch: "Branch",
  ask_ai: "Ask AI",
  integration: "Integration",
  product_cards: "Products",
};

// ── Design-token layer write (synced → design_overrides; bp → breakpoint) ────
type Tokens = DesignTokens;
function mergeTokens(cur: Tokens, patch: Tokens): Tokens {
  return {
    ...cur,
    ...patch,
    ...(patch.colors ? { colors: { ...cur.colors, ...patch.colors } } : {}),
  };
}
function setDesignLayer(
  doc: QuizDoc,
  nodeId: string,
  mode: Breakpoint,
  patch: Tokens,
): QuizDoc {
  if (mode === "synced") {
    const cur = doc.design_overrides[nodeId] ?? {};
    return {
      ...doc,
      design_overrides: { ...doc.design_overrides, [nodeId]: mergeTokens(cur, patch) },
    };
  }
  const rec = doc.breakpoint_overrides[nodeId] ?? {};
  const cur = rec[mode] ?? {};
  return {
    ...doc,
    breakpoint_overrides: {
      ...doc.breakpoint_overrides,
      [nodeId]: { ...rec, [mode]: mergeTokens(cur, patch) },
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Route component
// ════════════════════════════════════════════════════════════════════════════
export default function StudioRoute() {
  const data = useLoaderData<typeof loader>();
  if (!data.valid || !data.doc) {
    return (
      <QzPage>
        <TitleBar title="Studio" />
        <QzPageHeader eyebrow="Studio" title={data.name} />
        <QzBanner tone="crit" title="This quiz's draft JSON failed validation">
          Studio needs a valid draft.{" "}
          <Link to={`/app/quizzes/${data.quizId}`}>Open the canvas builder</Link> to repair or
          delete it.
        </QzBanner>
      </QzPage>
    );
  }
  return <Studio key={data.quizId} data={data} />;
}

type LoaderData = ReturnType<typeof useLoaderData<typeof loader>>;

function Studio({ data }: { data: LoaderData }) {
  const [doc, setDoc] = useState<QuizDoc>(data.doc as QuizDoc);
  const [zoomId, setZoomId] = useState<string | null>(null);
  const collections = data.collections;
  const productIndex = data.productIndex;

  const saveFetcher = useFetcher<{ ok: boolean; savedAt?: string; error?: string }>();
  const publishFetcher = useFetcher<{ ok: boolean; version?: number; error?: string }>();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerSave = useCallback(
    (next: QuizDoc) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveFetcher.submit(JSON.stringify({ doc: next }), {
          method: "PUT",
          encType: "application/json",
        });
      }, 700);
    },
    [saveFetcher],
  );

  const commit = useCallback(
    (next: QuizDoc) => {
      setDoc(next);
      triggerSave(next);
    },
    [triggerSave],
  );

  const fallbackCollection = collections[0]?.collectionId ?? "";
  const allIssues = useMemo(() => validateQuiz(doc), [doc]);
  const issuesByNode = useMemo(() => {
    const map = new Map<string, NodeIssue[]>();
    for (const issue of allIssues) {
      const arr = map.get(issue.nodeId) ?? [];
      arr.push(issue);
      map.set(issue.nodeId, arr);
    }
    return map;
  }, [allIssues]);
  const ordered = useMemo(() => orderFlow(doc), [doc]);

  const handleInsert = useCallback(
    (kind: InsertKind, anchorId: string | null, anchorHandle?: string) => {
      const { doc: next, newNodeId } = insertModule(
        doc,
        kind,
        anchorId,
        anchorHandle,
        fallbackCollection,
      );
      commit(next);
      if (newNodeId) setZoomId(newNodeId);
    },
    [doc, commit, fallbackCollection],
  );

  const handleDelete = useCallback(
    (nodeId: string) => {
      commit(deleteNode(doc, nodeId));
      setZoomId((z) => (z === nodeId ? null : z));
    },
    [doc, commit],
  );

  const isSaving = saveFetcher.state !== "idle";
  const savedAt =
    saveFetcher.data?.ok && saveFetcher.data.savedAt ? saveFetcher.data.savedAt : null;
  const canPublish = allIssues.length === 0;
  const isPublishing = publishFetcher.state !== "idle";

  const publish = () => {
    const form = new FormData();
    form.set("intent", "publish");
    publishFetcher.submit(form, { method: "POST" });
  };

  const zoomNode = zoomId ? doc.nodes.find((n) => n.id === zoomId) ?? null : null;

  return (
    <QzPage>
      <TitleBar title={`Studio · ${data.name}`} />
      <QzPageHeader
        eyebrow="Studio builder"
        title={data.name}
        subtitle="Compose each step visually, drag in layout blocks, and ship."
        actions={
          <div className="qz-row" style={{ gap: 8, alignItems: "center" }}>
            <span className="qz-dim" style={{ fontSize: 12 }}>
              {isSaving ? "Saving…" : savedAt ? "Saved" : ""}
            </span>
            <Link to={`/app/quizzes/${data.quizId}`} className="qz-btn qz-btn-ghost qz-btn-sm">
              Canvas
            </Link>
            <a
              href={data.previewUrl}
              target="_blank"
              rel="noreferrer"
              className="qz-btn qz-btn-ghost qz-btn-sm"
            >
              Preview
            </a>
            <QzButton
              variant="primary"
              size="sm"
              disabled={!canPublish || isPublishing}
              onClick={publish}
            >
              {isPublishing ? "Publishing…" : "Publish"}
            </QzButton>
          </div>
        }
      />

      {publishFetcher.data?.ok === false && publishFetcher.data.error ? (
        <QzBanner tone="crit" title="Publish failed">
          {publishFetcher.data.error}
        </QzBanner>
      ) : null}
      {publishFetcher.data?.ok && publishFetcher.data.version ? (
        <QzBanner tone="ok" title={`Published v${publishFetcher.data.version}`}>
          Live at <a href={data.previewUrl} target="_blank" rel="noreferrer">{data.previewUrl}</a>
        </QzBanner>
      ) : null}

      <CompletenessBar issues={allIssues} total={doc.nodes.length} />

      {zoomNode ? (
        <StepEditor
          key={zoomNode.id}
          doc={doc}
          node={zoomNode}
          productIndex={productIndex}
          issues={issuesByNode.get(zoomNode.id) ?? []}
          onBack={() => setZoomId(null)}
          onCommit={commit}
          onDelete={() => handleDelete(zoomNode.id)}
        />
      ) : (
        <FlowView
          doc={doc}
          ordered={ordered}
          productIndex={productIndex}
          issuesByNode={issuesByNode}
          onZoom={setZoomId}
          onInsert={handleInsert}
        />
      )}
    </QzPage>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Completeness banner — red-until-complete
// ════════════════════════════════════════════════════════════════════════════
function CompletenessBar({ issues, total }: { issues: NodeIssue[]; total: number }) {
  if (issues.length === 0) {
    return (
      <QzBanner tone="ok" title="Ready to publish">
        All {total} steps are wired up. No blockers.
      </QzBanner>
    );
  }
  return (
    <QzBanner tone="warn" title={`${issues.length} to fix before publishing`}>
      <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
        {issues.slice(0, 6).map((i, idx) => (
          <li key={idx}>{i.message}</li>
        ))}
      </ul>
    </QzBanner>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Flow view — ordered step cards + templated insertion + branch lanes
// ════════════════════════════════════════════════════════════════════════════
function FlowView({
  doc,
  ordered,
  productIndex,
  issuesByNode,
  onZoom,
  onInsert,
}: {
  doc: QuizDoc;
  ordered: ReturnType<typeof orderFlow>;
  productIndex: LoaderData["productIndex"];
  issuesByNode: Map<string, NodeIssue[]>;
  onZoom: (id: string) => void;
  onInsert: (kind: InsertKind, anchorId: string | null, anchorHandle?: string) => void;
}) {
  const nodeById = useMemo(() => {
    const m = new Map<string, QuizNode>();
    for (const n of doc.nodes) m.set(n.id, n);
    return m;
  }, [doc.nodes]);

  const spine = ordered.steps;
  const lastSpine = spine[spine.length - 1];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "stretch",
          overflowX: "auto",
          paddingBottom: 12,
        }}
      >
        {spine.map((step) => {
          const node = nodeById.get(step.nodeId);
          if (!node) return null;
          const lanes = ordered.branches.filter((l) => l.branchNodeId === step.nodeId);
          return (
            <div key={step.nodeId} style={{ display: "flex", alignItems: "stretch", gap: 8 }}>
              <StepColumn
                node={node}
                doc={doc}
                productIndex={productIndex}
                issues={issuesByNode.get(step.nodeId) ?? []}
                lanes={lanes}
                nodeById={nodeById}
                issuesByNode={issuesByNode}
                onZoom={onZoom}
                onInsert={onInsert}
              />
              {/* Insert after this step (templated). Branch handles their own. */}
              {node.type !== "branch" && node.type !== "result" && node.type !== "end" ? (
                <InsertSlot onPick={(kind) => onInsert(kind, step.nodeId, undefined)} />
              ) : null}
            </div>
          );
        })}
      </div>

      {ordered.orphans.length > 0 ? (
        <OrphanTray
          ids={ordered.orphans}
          nodeById={nodeById}
          doc={doc}
          productIndex={productIndex}
          issuesByNode={issuesByNode}
          onZoom={onZoom}
        />
      ) : null}

      {!lastSpine ? (
        <QzBanner tone="warn" title="No steps yet">
          This quiz has no reachable steps from the intro.
        </QzBanner>
      ) : null}
    </div>
  );
}

function StepColumn({
  node,
  doc,
  productIndex,
  issues,
  lanes,
  nodeById,
  issuesByNode,
  onZoom,
  onInsert,
}: {
  node: QuizNode;
  doc: QuizDoc;
  productIndex: LoaderData["productIndex"];
  issues: NodeIssue[];
  lanes: ReturnType<typeof orderFlow>["branches"];
  nodeById: Map<string, QuizNode>;
  issuesByNode: Map<string, NodeIssue[]>;
  onZoom: (id: string) => void;
  onInsert: (kind: InsertKind, anchorId: string | null, anchorHandle?: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <StepCard
        node={node}
        doc={doc}
        productIndex={productIndex}
        issues={issues}
        onZoom={() => onZoom(node.id)}
      />
      {lanes.map((lane) => (
        <div
          key={lane.laneId}
          style={{
            borderLeft: "2px solid #00000012",
            paddingLeft: 8,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <div className="qz-label" style={{ fontSize: 10 }}>
            {lane.slotLabel}
          </div>
          {lane.steps.length === 0 ? (
            <InsertSlot
              label="Empty slot — add a step"
              warn
              onPick={(kind) => onInsert(kind, lane.branchNodeId, lane.slotId)}
            />
          ) : (
            lane.steps.map((s) => {
              const ln = nodeById.get(s.nodeId);
              if (!ln) return null;
              return (
                <MiniStepCard
                  key={s.nodeId}
                  node={ln}
                  issues={issuesByNode.get(s.nodeId) ?? []}
                  onZoom={() => onZoom(s.nodeId)}
                />
              );
            })
          )}
        </div>
      ))}
    </div>
  );
}

const THUMB_W = 248;
const THUMB_SCALE = 0.42;

function StepCard({
  node,
  doc,
  productIndex,
  issues,
  onZoom,
}: {
  node: QuizNode;
  doc: QuizDoc;
  productIndex: LoaderData["productIndex"];
  issues: NodeIssue[];
  onZoom: () => void;
}) {
  const bad = issues.length > 0;
  return (
    <button
      onClick={onZoom}
      className="qz-card"
      style={{
        width: THUMB_W,
        padding: 0,
        overflow: "hidden",
        textAlign: "left",
        cursor: "pointer",
        border: bad ? "2px solid var(--qz-crit, #c0392b)" : undefined,
        position: "relative",
      }}
    >
      <div
        className="qz-row qz-row-between"
        style={{ padding: "10px 12px", alignItems: "center" }}
      >
        <span style={{ fontWeight: 600, fontSize: 13 }}>{NODE_LABEL[node.type]}</span>
        {bad ? <QzBadge tone="crit">{issues.length}</QzBadge> : <QzBadge tone="ok">OK</QzBadge>}
      </div>
      <div
        style={{
          height: 150,
          overflow: "hidden",
          background: "#FAFAFA",
          borderTop: "1px solid #00000010",
        }}
      >
        <div
          style={{
            width: THUMB_W / THUMB_SCALE,
            transform: `scale(${THUMB_SCALE})`,
            transformOrigin: "top left",
            pointerEvents: "none",
            padding: 16,
          }}
        >
          <StepPreview doc={doc} node={node} productIndex={productIndex} />
        </div>
      </div>
    </button>
  );
}

function MiniStepCard({
  node,
  issues,
  onZoom,
}: {
  node: QuizNode;
  issues: NodeIssue[];
  onZoom: () => void;
}) {
  const bad = issues.length > 0;
  return (
    <button
      onClick={onZoom}
      className="qz-card"
      style={{
        width: 200,
        padding: "8px 10px",
        cursor: "pointer",
        textAlign: "left",
        border: bad ? "2px solid var(--qz-crit, #c0392b)" : undefined,
      }}
    >
      <div className="qz-row qz-row-between" style={{ alignItems: "center" }}>
        <span style={{ fontWeight: 600, fontSize: 12 }}>{NODE_LABEL[node.type]}</span>
        {bad ? <QzBadge tone="crit">{issues.length}</QzBadge> : null}
      </div>
    </button>
  );
}

function InsertSlot({
  onPick,
  label,
  warn,
}: {
  onPick: (kind: InsertKind) => void;
  label?: string;
  warn?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [open]);
  return (
    <div ref={ref} style={{ position: "relative", alignSelf: "center" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Insert a step"
        style={{
          width: label ? "auto" : 30,
          height: 30,
          padding: label ? "0 12px" : 0,
          borderRadius: 999,
          border: warn ? "1px dashed #c0392b" : "1px dashed #00000033",
          background: "#fff",
          cursor: "pointer",
          color: warn ? "#c0392b" : "inherit",
          fontSize: 13,
          whiteSpace: "nowrap",
        }}
      >
        {label ?? "+"}
      </button>
      {open ? (
        <div
          className="qz-card"
          style={{
            position: "absolute",
            top: 36,
            left: 0,
            zIndex: 30,
            width: 230,
            padding: 6,
            display: "grid",
            gap: 2,
            boxShadow: "0 8px 28px rgba(0,0,0,0.16)",
          }}
        >
          {INSERTABLE_MODULES.map((m) => (
            <button
              key={m.kind}
              onClick={() => {
                onPick(m.kind);
                setOpen(false);
              }}
              className="qz-row"
              style={{
                gap: 10,
                alignItems: "center",
                padding: "7px 8px",
                border: "none",
                background: "transparent",
                cursor: "pointer",
                borderRadius: 8,
                textAlign: "left",
                width: "100%",
              }}
            >
              <span style={{ width: 20, textAlign: "center" }}>{m.glyph}</span>
              <span style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{m.label}</span>
                <span className="qz-dim" style={{ fontSize: 11 }}>
                  {m.hint}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function OrphanTray({
  ids,
  nodeById,
  doc,
  productIndex,
  issuesByNode,
  onZoom,
}: {
  ids: string[];
  nodeById: Map<string, QuizNode>;
  doc: QuizDoc;
  productIndex: LoaderData["productIndex"];
  issuesByNode: Map<string, NodeIssue[]>;
  onZoom: (id: string) => void;
}) {
  return (
    <div>
      <div className="qz-label" style={{ marginBottom: 8 }}>
        Unreachable steps
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {ids.map((id) => {
          const node = nodeById.get(id);
          if (!node) return null;
          return (
            <StepCard
              key={id}
              node={node}
              doc={doc}
              productIndex={productIndex}
              issues={issuesByNode.get(id) ?? []}
              onZoom={() => onZoom(id)}
            />
          );
        })}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Zoom editor — full-page single-step edit
// ════════════════════════════════════════════════════════════════════════════
type Tab = "content" | "layout" | "style" | "css";

function StepEditor({
  doc,
  node,
  productIndex,
  issues,
  onBack,
  onCommit,
  onDelete,
}: {
  doc: QuizDoc;
  node: QuizNode;
  productIndex: LoaderData["productIndex"];
  issues: NodeIssue[];
  onBack: () => void;
  onCommit: (doc: QuizDoc) => void;
  onDelete: () => void;
}) {
  const [tab, setTab] = useState<Tab>("content");
  const [bp, setBp] = useState<Breakpoint>("synced");
  const previewBp = bp === "mobile" ? "mobile" : "desktop";
  const previewWidth = previewBp === "mobile" ? 375 : 600;

  return (
    <div>
      <div className="qz-row qz-row-between" style={{ alignItems: "center", marginBottom: 12 }}>
        <button onClick={onBack} className="qz-btn qz-btn-ghost qz-btn-sm">
          ← Back to flow
        </button>
        <div className="qz-row" style={{ gap: 8, alignItems: "center" }}>
          <strong>{NODE_LABEL[node.type]}</strong>
          {issues.length > 0 ? (
            <QzBadge tone="crit">{issues.length} issue{issues.length > 1 ? "s" : ""}</QzBadge>
          ) : (
            <QzBadge tone="ok">Complete</QzBadge>
          )}
          {node.type !== "intro" ? (
            <button onClick={onDelete} className="qz-btn qz-btn-ghost qz-btn-sm">
              Delete
            </button>
          ) : null}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 380px", gap: 16 }}>
        {/* Preview pane */}
        <div className="qz-card" style={{ padding: 16, background: "#FAFAFA" }}>
          <div className="qz-row qz-row-between" style={{ marginBottom: 12 }}>
            <span className="qz-label">Preview</span>
            <div className="qz-row" style={{ gap: 4 }}>
              {(["synced", "desktop", "mobile"] as Breakpoint[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setBp(m)}
                  className={`qz-btn qz-btn-sm${bp === m ? " qz-btn-primary" : " qz-btn-ghost"}`}
                >
                  {m === "synced" ? "Synced" : m === "desktop" ? "Desktop" : "Mobile"}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <div style={{ width: previewWidth, maxWidth: "100%" }}>
              <StepPreview doc={doc} node={node} productIndex={productIndex} breakpoint={previewBp} />
            </div>
          </div>
        </div>

        {/* Rail */}
        <div className="qz-card" style={{ padding: 0, alignSelf: "start" }}>
          <div className="qz-row" style={{ borderBottom: "1px solid #00000010" }}>
            {(["content", "layout", "style", "css"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  flex: 1,
                  padding: "10px 6px",
                  border: "none",
                  borderBottom: tab === t ? "2px solid var(--qz-ink, #111)" : "2px solid transparent",
                  background: "transparent",
                  cursor: "pointer",
                  fontWeight: tab === t ? 700 : 500,
                  fontSize: 13,
                  textTransform: "capitalize",
                }}
              >
                {t}
              </button>
            ))}
          </div>
          <div style={{ padding: 16 }}>
            {tab === "content" ? (
              <ContentTab doc={doc} node={node} onCommit={onCommit} />
            ) : tab === "layout" ? (
              <LayoutTab doc={doc} node={node} onCommit={onCommit} />
            ) : tab === "style" ? (
              <StyleTab doc={doc} node={node} mode={bp} onCommit={onCommit} />
            ) : (
              <CssTab doc={doc} node={node} onCommit={onCommit} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Content tab — focused field editors per node type ────────────────────────
function ContentTab({
  doc,
  node,
  onCommit,
}: {
  doc: QuizDoc;
  node: QuizNode;
  onCommit: (doc: QuizDoc) => void;
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
          {text("hero_image_url", "Hero image URL")}
        </>
      );
    case "question":
      return <QuestionContent doc={doc} node={node} onCommit={onCommit} />;
    case "email_gate":
      return (
        <>
          {text("headline", "Headline")}
          {text("subtext", "Subtext", true)}
        </>
      );
    case "result":
      return (
        <>
          {text("headline", "Headline")}
          {text("subtext", "Subtext", true)}
          {text("cta_label", "CTA label")}
          <p className="qz-dim" style={{ fontSize: 12 }}>
            Recommendation logic lives in the canvas builder’s Logic tab.
          </p>
        </>
      );
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

function QuestionContent({
  doc,
  node,
  onCommit,
}: {
  doc: QuizDoc;
  node: Extract<QuizNode, { type: "question" }>;
  onCommit: (doc: QuizDoc) => void;
}) {
  const setText = (text: string) => onCommit(updateNodeData(doc, node.id, { text }));
  const setAnswer = (answerId: string, text: string) => {
    const answers = node.data.answers.map((a) => (a.id === answerId ? { ...a, text } : a));
    onCommit(updateNodeData(doc, node.id, { answers }));
  };
  const isCard = !["text", "email"].includes(node.data.question_type);
  return (
    <>
      <QzField label="Question">
        <QzTextarea value={node.data.text} onChange={(e) => setText(e.target.value)} rows={2} />
      </QzField>
      <QzField label="Answers">
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {node.data.answers.map((a) => (
            <div key={a.id} className="qz-row" style={{ gap: 6 }}>
              <QzInput
                value={a.text}
                onChange={(e) => setAnswer(a.id, e.target.value)}
                style={{ flex: 1 }}
              />
              {node.data.answers.length > (isCard ? 2 : 1) ? (
                <button
                  onClick={() => onCommit(removeAnswer(doc, node.id, a.id))}
                  className="qz-btn qz-btn-ghost qz-btn-sm"
                >
                  ✕
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </QzField>
      {isCard ? (
        <QzButton size="sm" variant="ghost" onClick={() => onCommit(addAnswer(doc, node.id))}>
          + Add answer
        </QzButton>
      ) : null}
    </>
  );
}

// ── Layout tab — the Layout Library ──────────────────────────────────────────
function LayoutTab({
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
    </div>
  );
}

// ── Style tab — node design tokens (synced or per-breakpoint) ────────────────
function StyleTab({
  doc,
  node,
  mode,
  onCommit,
}: {
  doc: QuizDoc;
  node: QuizNode;
  mode: Breakpoint;
  onCommit: (doc: QuizDoc) => void;
}) {
  const layer =
    mode === "synced"
      ? doc.design_overrides[node.id]
      : doc.breakpoint_overrides[node.id]?.[mode];
  const colors = layer?.colors ?? {};

  const color = (key: "primary" | "background" | "text", label: string) => (
    <QzField label={label} key={key}>
      <div className="qz-row" style={{ gap: 8, alignItems: "center" }}>
        <input
          type="color"
          value={colors[key] ?? "#000000"}
          onChange={(e) => onCommit(setDesignLayer(doc, node.id, mode, { colors: { [key]: e.target.value } }))}
          style={{ width: 36, height: 30, border: "none", background: "none" }}
        />
        <QzInput
          value={colors[key] ?? ""}
          placeholder="inherit"
          onChange={(e) => onCommit(setDesignLayer(doc, node.id, mode, { colors: { [key]: e.target.value } }))}
        />
      </div>
    </QzField>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <p className="qz-dim" style={{ fontSize: 12, margin: 0 }}>
        Editing the <strong>{mode}</strong> layer. Use the preview toggle to switch.
      </p>
      {color("primary", "Primary")}
      {color("background", "Background")}
      {color("text", "Text")}
      <QzField label="Corner radius">
        <QzSelect
          value={layer?.radius ?? ""}
          onChange={(e) =>
            onCommit(setDesignLayer(doc, node.id, mode, { radius: (e.target.value || undefined) as never }))
          }
        >
          <option value="">Inherit</option>
          <option value="square">Square</option>
          <option value="rounded">Rounded</option>
          <option value="pill">Pill</option>
        </QzSelect>
      </QzField>
      <QzField label="Button style">
        <QzSelect
          value={layer?.button_style ?? ""}
          onChange={(e) =>
            onCommit(setDesignLayer(doc, node.id, mode, { button_style: (e.target.value || undefined) as never }))
          }
        >
          <option value="">Inherit</option>
          <option value="filled">Filled</option>
          <option value="outline">Outline</option>
          <option value="ghost">Ghost</option>
        </QzSelect>
      </QzField>
    </div>
  );
}

// ── CSS tab — per-node custom CSS (paid) ─────────────────────────────────────
function CssTab({
  doc,
  node,
  onCommit,
}: {
  doc: QuizDoc;
  node: QuizNode;
  onCommit: (doc: QuizDoc) => void;
}) {
  const css = doc.node_css[node.id] ?? "";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <p className="qz-dim" style={{ fontSize: 12, margin: 0 }}>
        Custom CSS scoped to this step. Selectors are prefixed automatically, or write bare
        declarations to style the step container. <code>&amp;</code> targets the root; reference a
        block by its <code>class</code>.
      </p>
      <QzTextarea
        value={css}
        onChange={(e) => onCommit(setNodeCss(doc, node.id, e.target.value))}
        rows={8}
        placeholder={"&:hover { box-shadow: 0 8px 30px rgba(0,0,0,.12); }\n.qz-block { letter-spacing: .2px; }"}
        style={{ fontFamily: "monospace", fontSize: 12 }}
      />
    </div>
  );
}
