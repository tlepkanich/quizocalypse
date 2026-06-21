import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useFetcher, useSearchParams } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import { QzPage, QzPageHeader, QzButton, QzBanner } from "../qz";
import { experienceTypeOf, type Quiz } from "../../lib/quizSchema";
import { validateQuiz, validateQuizWarnings, type NodeIssue } from "../../lib/quizValidation";
import { orderFlow } from "../../lib/flowOrder";
import { reconcileBucketsToResultNodes } from "../../lib/bucketReconcile";
import type { StepProps } from "../builder/stepProps";
import { Step5Preview } from "../builder/Step5Preview";
import { Step1Products } from "../builder/Step1Products";
import { LogicView } from "../logic/LogicView";
import { DEVICE_PRESETS, breakpointForWidth } from "../builder/preview/previewWidth";
import type { InspectTarget } from "../runtime/QuizRuntime";
import { useQuizDraft } from "./useQuizDraft";
import { FlowRail, type WorkspaceView } from "./FlowRail";
import { ContextPanel } from "./ContextPanel";
import { AiChatPanel } from "./AiChatPanel";
import { ReviewEnrichPanel } from "./ReviewEnrichPanel";
import { EditableTitle, PLACEMENTS, type StudioBuilderData } from "./studioShared";
import { BuilderRail, BuilderFilmstrip } from "./BuilderChrome";
import { Step3Results } from "../builder/Step3Results";
import { TranslationsPanel } from "./TranslationsPanel";
import { ExperiencePanel } from "./ExperiencePanel";
import { CssTab } from "./panels/CssTab";
import { BuilderSettings } from "./BuilderSettings";
import { BuilderThemePanel } from "./BuilderThemePanel";
import { BuilderBlocksPalette } from "./BuilderBlocksPalette";
import { BuilderPageSettings } from "./BuilderPageSettings";
import { insertModule } from "./studioDoc";

// ════════════════════════════════════════════════════════════════════════════
// UnifiedWorkspace (Unified P2) — ONE editing surface replacing the AI/Advanced
// split: left FlowRail (hierarchy + views) · center live preview (click any
// element to edit it) · right ContextPanel (Content/Design for every node
// type) with the AI chat docked below. Ships behind ?mode=next; the old modes
// stay untouched until the P8 flip. Server-free, renders in both the embedded
// and standalone surfaces.
// ════════════════════════════════════════════════════════════════════════════

const XTYPE_LABEL: Record<string, string> = {
  product_match: "Product match",
  personality: "Personality",
  lead_capture: "Lead capture",
  survey: "Survey",
};

type Chrome = "embedded" | "standalone";
type QuizDoc = Quiz;

export function UnifiedWorkspace({ data, chrome }: { data: StudioBuilderData; chrome: Chrome }) {
  if (!data.valid || !data.doc) {
    return (
      <QzPage>
        {chrome === "embedded" ? <TitleBar title="Studio" /> : null}
        <QzPageHeader eyebrow="Quiz studio" title={data.name} />
        <QzBanner tone="crit" title="This quiz's draft JSON failed validation">
          The studio needs a valid draft.{" "}
          {chrome === "embedded" ? (
            <Link to={`/app/quizzes/${data.quizId}`}>Open the canvas builder</Link>
          ) : (
            <Link to="/studio">Back to all quizzes</Link>
          )}{" "}
          to repair or delete it.
        </QzBanner>
      </QzPage>
    );
  }
  return <WorkspaceShell key={data.quizId} data={data} chrome={chrome} />;
}

function WorkspaceShell({ data, chrome }: { data: StudioBuilderData; chrome: Chrome }) {
  const { doc, commit: rawCommit, isSaving, savedAt } = useQuizDraft(data.doc as QuizDoc);
  // QB-2 — snapshot undo/redo. Every panel edit replaces the whole doc, so a
  // stack of prior docs IS the history; undo/redo replay a snapshot through the
  // same autosave seam (an undo persists). Capped at 50 snapshots to bound memory.
  const [history, setHistory] = useState<{ past: QuizDoc[]; future: QuizDoc[] }>({
    past: [],
    future: [],
  });
  const commit = useCallback(
    (next: QuizDoc) => {
      setHistory((h) => ({ past: [...h.past, doc].slice(-50), future: [] }));
      rawCommit(next);
    },
    [doc, rawCommit],
  );
  const undo = useCallback(() => {
    if (history.past.length === 0) return;
    const prev = history.past[history.past.length - 1]!;
    setHistory({ past: history.past.slice(0, -1), future: [doc, ...history.future].slice(0, 50) });
    rawCommit(prev);
  }, [history, doc, rawCommit]);
  const redo = useCallback(() => {
    if (history.future.length === 0) return;
    const next = history.future[0]!;
    setHistory({ past: [...history.past, doc].slice(-50), future: history.future.slice(1) });
    rawCommit(next);
  }, [history, doc, rawCommit]);
  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;
  // QB-2 — preview zoom (a CSS scale on the canvas frame), 50–100%.
  const [zoom, setZoom] = useState(100);
  const publishFetcher = useFetcher<{ ok: boolean; version?: number; error?: string }>();
  const renameFetcher = useFetcher<{ ok: boolean; name?: string }>();

  // Selection drives the ContextPanel; the optional inspect target carries the
  // exact element clicked in the preview (for its outline highlight).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inspectTarget, setInspectTarget] = useState<InspectTarget | null>(null);
  // The step the live preview is currently SHOWING (reported by the runtime) —
  // drives the rail's ▸ marker so walking the quiz in Interact mode keeps you
  // oriented without opening the editing panel.
  const [liveNodeId, setLiveNodeId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(true);
  // Device-frame width lifted from Step5Preview so the Design tab's layer
  // selector can follow it ("edit what you see").
  const [frameW, setFrameW] = useState<number>(DEVICE_PRESETS.desktop);
  // QD-6: which Quizell builder rail tool is focused (standalone chrome only).
  const [tool, setTool] = useState<"editor" | "ai" | "theme" | "code">("editor");
  // QB-4b: the Editor tool's Blocks ‖ Settings sub-tab.
  const [editorSubtab, setEditorSubtab] = useState<"settings" | "blocks">("settings");
  const [reconcileError, setReconcileError] = useState<string | null>(null);

  const select = useCallback((nodeId: string | null) => {
    setSelectedId(nodeId);
    setInspectTarget(null);
  }, []);
  const onInspect = useCallback((t: InspectTarget) => {
    setSelectedId(t.nodeId);
    setInspectTarget(t);
  }, []);

  // Esc clears the selection from anywhere (same affordance the old
  // InspectorPanel had).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") select(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select]);

  // View (Build / Products / Logic) synced to ?view=.
  const [params, setParams] = useSearchParams();
  const viewParam = params.get("view");
  const view: WorkspaceView =
    viewParam === "products"
      ? "products"
      : viewParam === "results"
        ? "results"
        : viewParam === "logic"
          ? "logic"
          : "build";
  const setView = useCallback(
    (v: WorkspaceView) => {
      // Leaving Products: turn buckets into result pages (the 4-step builder
      // ran this on the Step-1 → Step-2 transition; same guarantee here).
      if (view === "products" && v !== "products") {
        const buckets = data.categories.map((c) => ({ id: c.id, name: c.name }));
        if (buckets.length) {
          try {
            commit(reconcileBucketsToResultNodes(doc, buckets, fallbackCollection));
            setReconcileError(null);
          } catch {
            setReconcileError(
              "We couldn't turn your buckets into result pages yet — sync at least one Shopify collection (result pages need a fallback collection). You can keep building; pages will appear once a collection is synced.",
            );
          }
        }
      }
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (v === "build") next.delete("view");
          else next.set("view", v);
          return next;
        },
        { replace: false },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, doc, commit, data.categories, setParams],
  );

  const allIssues = useMemo<NodeIssue[]>(() => validateQuiz(doc), [doc]);
  const suggestions = useMemo(() => validateQuizWarnings(doc), [doc]);
  const issuesByNode = useMemo(() => {
    const m = new Map<string, NodeIssue[]>();
    for (const i of allIssues) {
      const arr = m.get(i.nodeId) ?? [];
      arr.push(i);
      m.set(i.nodeId, arr);
    }
    return m;
  }, [allIssues]);
  const ordered = useMemo(() => orderFlow(doc), [doc]);
  const fallbackCollection = data.collections[0]?.collectionId ?? "";
  const canPublish = allIssues.length === 0;
  const isPublishing = publishFetcher.state !== "idle";
  const placement = doc.placement ?? "page";
  const currentPlacement = PLACEMENTS.find((p) => p.value === placement) ?? PLACEMENTS[0]!;

  const publish = () => {
    const form = new FormData();
    form.set("intent", "publish");
    publishFetcher.submit(form, { method: "POST" });
  };
  const renameQuiz = (name: string) => {
    const form = new FormData();
    form.set("intent", "rename");
    form.set("name", name);
    renameFetcher.submit(form, { method: "POST" });
  };

  // QB-5 — the filmstrip "+" inserts a question after the last step, then opens
  // it in the Editor (undoable via the top bar).
  const addStep = () => {
    const anchor = ordered.steps[ordered.steps.length - 1]?.nodeId ?? null;
    const { doc: next, newNodeId } = insertModule(doc, "question", anchor, undefined, fallbackCollection);
    commit(next);
    if (newNodeId) {
      setTool("editor");
      setView("build");
      select(newNodeId);
    }
  };

  const stepProps: StepProps = {
    quizId: data.quizId,
    doc,
    onCommit: commit,
    productIndex: data.productIndex,
    collections: data.collections,
    categories: data.categories,
    fallbackCollection,
    allIssues,
    issuesByNode,
    ordered,
    previewUrl: data.previewUrl,
    goToStep: () => {},
  };

  const savingLabel = isSaving ? "Saving…" : savedAt ? "Saved" : "";

  const editInteractToggle = (
    <div
      className="qz-segmented"
      role="group"
      aria-label="Preview mode"
      title="Edit: click any element in the preview to edit it · Interact: walk through the quiz normally"
    >
      <button type="button" aria-pressed={editMode} onClick={() => setEditMode(true)}>
        ✎ Edit
      </button>
      <button
        type="button"
        aria-pressed={!editMode}
        onClick={() => {
          setEditMode(false);
          setInspectTarget(null);
        }}
      >
        ▶ Interact
      </button>
    </div>
  );

  // QB-2 — Quizell top-bar controls (standalone builder).
  const deviceToggle = (
    <div className="qz-segmented" role="group" aria-label="Device size">
      {([
        {
          bp: "desktop" as const,
          w: DEVICE_PRESETS.desktop,
          label: "Desktop",
          icon: <><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></>,
        },
        {
          bp: "mobile" as const,
          w: DEVICE_PRESETS.mobile,
          label: "Mobile",
          icon: <><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" /></>,
        },
      ]).map((d) => (
        <button
          key={d.bp}
          type="button"
          className="qz-tip"
          aria-pressed={breakpointForWidth(frameW) === d.bp}
          data-tip={`${d.label} preview`}
          aria-label={d.label}
          onClick={() => setFrameW(d.w)}
          style={{ display: "inline-flex", alignItems: "center", padding: "5px 12px" }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {d.icon}
          </svg>
        </button>
      ))}
    </div>
  );

  const zoomStepper = (
    <div className="qz-row" style={{ gap: 2, alignItems: "center" }}>
      <button type="button" className="qz-icon-btn qz-tip" data-tip="Zoom out" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(50, z - 10))}>−</button>
      <span className="qz-dim" style={{ fontSize: 12.5, minWidth: 38, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{zoom}%</span>
      <button type="button" className="qz-icon-btn qz-tip" data-tip="Zoom in" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(100, z + 10))}>+</button>
    </div>
  );

  const undoRedo = (
    <div className="qz-row" style={{ gap: 2, alignItems: "center" }}>
      <button type="button" className="qz-icon-btn qz-tip" aria-label="Undo" data-tip="Undo" disabled={!canUndo} onClick={undo}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-1" /></svg>
      </button>
      <button type="button" className="qz-icon-btn qz-tip" aria-label="Redo" data-tip="Redo" disabled={!canRedo} onClick={redo}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 14 5-5-5-5" /><path d="M20 9H9a5 5 0 0 0 0 10h1" /></svg>
      </button>
    </div>
  );

  const shareBtn = (
    <Link to={`/studio/${data.quizId}/embed`} className="qz-btn qz-btn-ghost qz-btn-sm" style={{ textDecoration: "none" }}>
      🔗 Share
    </Link>
  );

  const settingsPopover = (
    <details style={{ position: "relative" }}>
      <summary className="qz-btn qz-btn-ghost qz-btn-sm" style={{ listStyle: "none", cursor: "pointer" }}>
        ⚙ Settings
      </summary>
      <div
        className="qz-card"
        style={{
          position: "absolute",
          right: 0,
          top: "calc(100% + 6px)",
          width: 380,
          padding: 12,
          zIndex: 50,
          boxShadow: "var(--qz-shadow-md)",
        }}
      >
        <div className="qz-label" style={{ marginBottom: 6, fontSize: 11 }}>
          Where should it appear?
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10 }}>
          {PLACEMENTS.map((p) => {
            const sel = p.value === placement;
            return (
              <button
                key={p.value}
                type="button"
                onClick={() => commit({ ...doc, placement: p.value })}
                title={p.hint}
                style={{
                  textAlign: "left",
                  padding: "6px 8px",
                  borderRadius: "var(--qz-radius)",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: sel ? 600 : 400,
                  border: sel ? "2px solid var(--qz-accent)" : "1px solid var(--qz-rule)",
                  background: sel ? "var(--qz-accent-tint)" : "var(--qz-paper)",
                }}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>
    </details>
  );

  const publishBtn = (
    <QzButton variant="primary" size="sm" disabled={!canPublish || isPublishing} onClick={publish}>
      {isPublishing ? "Publishing…" : "Publish"}
    </QzButton>
  );

  const banners = (
    <>
      {suggestions.length > 0 ? (
        <div
          className="qz-card"
          style={{
            padding: "10px 14px",
            marginBottom: 12,
            background: "color-mix(in srgb, var(--qz-warn, #b58a2a) 7%, var(--qz-surface, #fff))",
            fontSize: 12.5,
          }}
        >
          <strong style={{ fontSize: 12.5 }}>💡 Suggestions</strong>
          <span className="qz-dim"> (won&rsquo;t block publishing)</span>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {suggestions.slice(0, 3).map((s, i) => (
              <li key={`${s.nodeId}-${s.kind}-${i}`}>{s.message}</li>
            ))}
            {suggestions.length > 3 ? <li className="qz-dim">+{suggestions.length - 3} more</li> : null}
          </ul>
        </div>
      ) : null}
      {reconcileError ? (
        <QzBanner tone="warn" title="Result pages pending">
          {reconcileError}
        </QzBanner>
      ) : null}
      {publishFetcher.data?.ok === false && publishFetcher.data.error ? (
        <QzBanner tone="crit" title="Publish failed">
          {publishFetcher.data.error}
        </QzBanner>
      ) : null}
      {publishFetcher.data?.ok && publishFetcher.data.version ? (
        <QzBanner tone="ok" title={`Published v${publishFetcher.data.version}`}>
          Live at{" "}
          <a href={data.previewUrl} target="_blank" rel="noreferrer">
            {data.previewUrl}
          </a>{" "}
          — embed mode: <strong>{currentPlacement.label}</strong>.
        </QzBanner>
      ) : null}
      {!canPublish ? (
        <QzBanner tone="warn" title={`${allIssues.length} to fix before publishing`}>
          Steps with a red dot in the rail need attention — select one to edit it.
        </QzBanner>
      ) : null}
    </>
  );

  const body =
    view === "build" ? (
        <div className="qz-unified">
          <FlowRail
            doc={doc}
            ordered={ordered}
            issuesByNode={issuesByNode}
            selectedId={selectedId}
            currentId={liveNodeId}
            onSelect={select}
            onCommit={commit}
            fallbackCollection={fallbackCollection}
            view={view}
            onView={setView}
          />
          <div style={{ minWidth: 0 }}>
            <Step5Preview
              {...stepProps}
              onInspect={editMode ? onInspect : undefined}
              inspectedTarget={inspectTarget}
              frameW={frameW}
              onFrameWChange={setFrameW}
              focusNodeId={selectedId}
              onNodeShown={setLiveNodeId}
            />
          </div>
          <div style={{ position: "sticky", top: 8 }}>
            {selectedId ? (
              <ContextPanel
                doc={doc}
                nodeId={selectedId}
                onCommit={commit}
                onClose={() => select(null)}
                products={data.productIndex}
                productIndex={data.productIndex}
                categories={data.categories}
                frameBreakpoint={breakpointForWidth(frameW)}
                onOpenLogic={() => setView("logic")}
              />
            ) : (
              <div className="qz-card" style={{ padding: 12, marginBottom: 16 }}>
                <p className="qz-dim" style={{ fontSize: 12.5, margin: 0 }}>
                  Select a step in the rail — or click any element in the preview — to edit its
                  content, design, and layout here.
                </p>
              </div>
            )}
            <ReviewEnrichPanel onApply={commit} sources={doc.review_enrichment_sources} />
            <ExperiencePanel doc={doc} onCommit={commit} onSelectNode={select} />
            <TranslationsPanel doc={doc} onApply={commit} previewUrl={data.previewUrl} />
            <AiChatPanel onApply={commit} selectedNodeId={selectedId} />
          </div>
        </div>
      ) : (
        <div className="qz-unified qz-unified-wide">
          <FlowRail
            doc={doc}
            ordered={ordered}
            issuesByNode={issuesByNode}
            selectedId={selectedId}
            onSelect={select}
            onCommit={commit}
            fallbackCollection={fallbackCollection}
            view={view}
            onView={setView}
          />
          <div style={{ minWidth: 0, gridColumn: "2 / -1" }}>
            {view === "products" ? (
              <Step1Products {...stepProps} />
            ) : view === "results" ? (
              <Step3Results
                {...stepProps}
                goToStep={(n) => setView(n === 1 ? "products" : "build")}
              />
            ) : (
              <LogicView
                quizId={data.quizId}
                doc={doc}
                onCommit={commit}
                productIndex={data.productIndex}
                categories={data.categories}
                abAnalytics={data.abAnalytics}
              />
            )}
          </div>
        </div>
      );

  // QD-6 / QB-1 — standalone gets the Quizell builder: a full-width top bar over a
  // body row of icon-rail · tool-switched left panel · centered stage (preview +
  // filmstrip). Clicking a rail tool now actually SWAPS the left panel (the QD-6
  // gap). Settings takes over the body full-width. The embedded /app surface
  // keeps the shared `body` 3-pane layout below (untouched).
  if (chrome === "standalone") {
    const activeTool = view === "build" ? tool : "settings";
    const selectedNode = selectedId ? doc.nodes.find((n) => n.id === selectedId) ?? null : null;

    // The left panel content for the focused tool (build view only).
    const toolPanel =
      tool === "ai" ? (
        <>
          <AiChatPanel onApply={commit} selectedNodeId={selectedId} />
          <ReviewEnrichPanel onApply={commit} sources={doc.review_enrichment_sources} />
        </>
      ) : tool === "theme" ? (
        <BuilderThemePanel doc={doc} commit={commit} />
      ) : tool === "code" ? (
        selectedNode ? (
          <CssTab doc={doc} node={selectedNode} onCommit={commit} />
        ) : (
          <div className="qz-card" style={{ padding: 14 }}>
            <p className="qz-dim" style={{ fontSize: 12.5, margin: 0 }}>
              Select a step below to add custom CSS scoped to it.
            </p>
          </div>
        )
      ) : (
        <>
          {/* QB-4b — Quizell's Editor "Blocks ‖ Settings" sub-tabs. */}
          <div className="qz-segmented" role="group" aria-label="Editor mode">
            <button type="button" aria-pressed={editorSubtab === "blocks"} onClick={() => setEditorSubtab("blocks")}>
              Blocks
            </button>
            <button type="button" aria-pressed={editorSubtab === "settings"} onClick={() => setEditorSubtab("settings")}>
              Settings
            </button>
          </div>
          {editorSubtab === "blocks" ? (
            <BuilderBlocksPalette doc={doc} node={selectedNode} commit={commit} />
          ) : (
            <>
              {/* QP-2 — Quizell's Page Settings (background color + page paddings),
                  quiz-level, above the step list. */}
              <BuilderPageSettings doc={doc} commit={commit} />
              <FlowRail
                doc={doc}
                ordered={ordered}
                issuesByNode={issuesByNode}
                selectedId={selectedId}
                currentId={liveNodeId}
                onSelect={select}
                onCommit={commit}
                fallbackCollection={fallbackCollection}
                view={view}
                onView={setView}
              />
              {selectedId ? (
                <ContextPanel
                  doc={doc}
                  nodeId={selectedId}
                  onCommit={commit}
                  onClose={() => select(null)}
                  products={data.productIndex}
                  productIndex={data.productIndex}
                  categories={data.categories}
                  frameBreakpoint={breakpointForWidth(frameW)}
                  onOpenLogic={() => setView("logic")}
                />
              ) : (
                <div className="qz-card" style={{ padding: 12 }}>
                  <p className="qz-dim" style={{ fontSize: 12.5, margin: 0 }}>
                    Select a step to edit its content, design, and layout.
                  </p>
                </div>
              )}
            </>
          )}
        </>
      );

    return (
      <div className="qz-builder">
        <header className="qz-builder-topbar">
          {/* Left: Q logo + breadcrumb + experience-type badge */}
          <div className="qz-row" style={{ gap: 9, minWidth: 0, alignItems: "center", flex: "1 1 0" }}>
            <Link to="/studio" className="qz-brand-badge" aria-label="All quizzes" style={{ textDecoration: "none", flex: "0 0 auto" }}>
              Q
            </Link>
            <Link to="/studio" className="qz-dim" style={{ textDecoration: "none", fontSize: 13 }}>
              Dashboard
            </Link>
            <span className="qz-dim" aria-hidden="true">›</span>
            <EditableTitle name={data.name} onRename={renameQuiz} />
            <span className="qz-badge" style={{ fontSize: 10 }}>
              {XTYPE_LABEL[experienceTypeOf(doc)]}
            </span>
          </div>
          {/* Center: device toggle + zoom (build view only) */}
          {view === "build" ? (
            <div className="qz-row" style={{ gap: 14, alignItems: "center", flex: "0 0 auto" }}>
              {deviceToggle}
              {zoomStepper}
            </div>
          ) : null}
          {/* Right: edit/interact · undo/redo · settings · share · preview · save · publish */}
          <div className="qz-row" style={{ gap: 8, alignItems: "center", justifyContent: "flex-end", flex: "1 1 0", flexWrap: "wrap" }}>
            {view === "build" ? editInteractToggle : null}
            {undoRedo}
            {settingsPopover}
            <span className="qz-dim" style={{ fontSize: 12, minWidth: 44, textAlign: "right" }}>
              {savingLabel === "Saved" ? "Saved ✓" : savingLabel}
            </span>
            {shareBtn}
            <a
              href={data.previewUrl}
              target="_blank"
              rel="noreferrer"
              className="qz-btn qz-btn-ghost qz-btn-sm"
            >
              Preview
            </a>
            {publishBtn}
          </div>
        </header>
        <div className="qz-builder-body">
          <BuilderRail
            active={activeTool}
            onSelect={(key) => {
              if (key === "settings") {
                setView("logic");
              } else {
                setTool(key as "editor" | "ai" | "theme" | "code");
                setView("build");
              }
            }}
          />
          {view === "build" ? (
            <>
              <aside className="qz-builder-panel">{toolPanel}</aside>
              <div className="qz-builder-stage">
                {/* QB-8 — slim notices strip (validation/publish); empty = 0 height,
                    so a clean quiz shows the canvas as just the live quiz. */}
                <div className="qz-builder-notices">{banners}</div>
                <div className="qz-builder-canvas">
                  <div
                    style={{
                      width: "100%",
                      transform: zoom !== 100 ? `scale(${zoom / 100})` : undefined,
                      transformOrigin: "top center",
                    }}
                  >
                    <Step5Preview
                      {...stepProps}
                      onInspect={editMode ? onInspect : undefined}
                      inspectedTarget={inspectTarget}
                      frameW={frameW}
                      onFrameWChange={setFrameW}
                      focusNodeId={selectedId}
                      onNodeShown={setLiveNodeId}
                      chromeless
                      platform="standalone"
                    />
                  </div>
                </div>
                <BuilderFilmstrip doc={doc} steps={ordered.steps} selectedId={selectedId} onSelect={select} onAdd={addStep} productIndex={data.productIndex} categories={data.categories} />
              </div>
            </>
          ) : (
            <div className="qz-builder-settings">
              <div style={{ padding: "18px 22px", maxWidth: 1200, margin: "0 auto" }}>
                {banners}
                {view === "products" ? (
                  <Step1Products {...stepProps} />
                ) : view === "results" ? (
                  <Step3Results
                    {...stepProps}
                    goToStep={(n) => setView(n === 1 ? "products" : "build")}
                  />
                ) : (
                  // QB-3 — the Settings rail tool: Quizell's 8 top-tabs.
                  <BuilderSettings data={data} doc={doc} commit={commit} onSelectNode={select} />
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <QzPage>
      {chrome === "embedded" ? <TitleBar title={`Studio · ${data.name}`} /> : null}
      <QzPageHeader
        eyebrow="Quiz studio"
        title={
          <span className="qz-row" style={{ gap: 10, alignItems: "center" }}>
            <EditableTitle name={data.name} onRename={renameQuiz} />
            <span className="qz-badge" title="Experience type" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {XTYPE_LABEL[experienceTypeOf(doc)]}
            </span>
          </span>
        }
      />
      <div
        className="qz-row qz-row-between"
        style={{ alignItems: "center", marginBottom: 12, gap: 12, flexWrap: "wrap" }}
      >
        <span className="qz-dim" style={{ fontSize: 12 }}>{savingLabel}</span>
        <div className="qz-row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {editInteractToggle}
          {settingsPopover}
          {chrome === "embedded" ? (
            <Link
              to={`/app/quizzes/${data.quizId}`}
              className="qz-btn qz-btn-ghost qz-btn-sm"
              title="The full node-graph canvas (branch rules, integrations, A/B wiring)"
            >
              Canvas →
            </Link>
          ) : null}
          {publishBtn}
        </div>
      </div>
      {banners}
      {body}
    </QzPage>
  );
}
