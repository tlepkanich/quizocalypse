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
  const { doc, commit, isSaving, savedAt } = useQuizDraft(data.doc as QuizDoc);
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

  // QD-6 — standalone gets the Quizell builder chrome (icon-rail + top bar +
  // step filmstrip). The embedded /app surface keeps the Polaris-framed layout.
  if (chrome === "standalone") {
    const activeTool = view === "build" ? tool : "settings";
    return (
      <div className="qz-builder">
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
        <div className="qz-builder-main">
          <header className="qz-builder-topbar">
            <div className="qz-row" style={{ gap: 8, minWidth: 0, alignItems: "center" }}>
              <Link to="/studio" className="qz-dim" style={{ textDecoration: "none", fontSize: 13 }}>
                Dashboard
              </Link>
              <span className="qz-dim" aria-hidden="true">›</span>
              <EditableTitle name={data.name} onRename={renameQuiz} />
              <span className="qz-badge" style={{ fontSize: 10 }}>
                {XTYPE_LABEL[experienceTypeOf(doc)]}
              </span>
            </div>
            <div className="qz-row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span className="qz-dim" style={{ fontSize: 12 }}>{savingLabel}</span>
              {editInteractToggle}
              {settingsPopover}
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
          <div className="qz-builder-canvas">
            {banners}
            {body}
          </div>
          <BuilderFilmstrip steps={ordered.steps} selectedId={selectedId} onSelect={select} />
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
