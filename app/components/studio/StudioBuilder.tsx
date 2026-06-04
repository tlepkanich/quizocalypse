import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useFetcher, useSearchParams } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import { BuilderStepper, type StepState } from "../builder/BuilderStepper";
import { Step1Products } from "../builder/Step1Products";
import { Step3Results } from "../builder/Step3Results";
import { Step5Preview } from "../builder/Step5Preview";
import { SmartBuildPanel, type SmartBuildParams } from "../builder/SmartBuildPanel";
import type {
  StepProps,
  BuilderCollection,
  BuilderCategory,
} from "../builder/stepProps";
import { reconcileBucketsToResultNodes } from "../../lib/bucketReconcile";
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
  QzSegmented,
} from "../qz";
import type { ContentBlock, DesignTokens, Quiz, QuizNode } from "../../lib/quizSchema";
import { validateQuiz, type NodeIssue } from "../../lib/quizValidation";
import { orderFlow } from "../../lib/flowOrder";
import { synthesizeLayout } from "../../lib/synthesizeLayout";
import { StepPreview } from "../runtime/StepPreview";
import {
  addAnswer,
  deleteNode,
  removeAnswer,
  moveStep,
  straightThroughRun,
} from "../../lib/quizMutations";
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
} from "./studioDoc";
import type { IndexedProduct } from "../../lib/recommendationEngine";
import type { FunnelCounts } from "../../lib/abAnalytics";
import { LogicView } from "../logic/LogicView";

// ════════════════════════════════════════════════════════════════════════════
// StudioBuilder — the 4-step guided quiz builder, extracted from the embedded
// route so BOTH the Shopify-embedded route (app.quizzes.$id_.studio.tsx) and
// the standalone /studio surface render the identical UI. This module imports
// ZERO server code (no *.server / prisma / claude) so it bundles cleanly into
// either route's client. `chrome` toggles the embedded-only App Bridge TitleBar
// and the /app/* links that only resolve inside the Shopify admin.
// ════════════════════════════════════════════════════════════════════════════

type QuizDoc = Quiz;
type Breakpoint = "synced" | "desktop" | "mobile";
type Chrome = "embedded" | "standalone";

// The slice of the editor loader's return that the builder UI consumes. Both
// routes' loaders return a superset of this, so their data is assignable here.
export interface StudioBuilderData {
  quizId: string;
  name: string;
  version: number;
  valid: boolean;
  doc: Quiz | null;
  collections: BuilderCollection[];
  productIndex: IndexedProduct[];
  categories: BuilderCategory[];
  brandVoiceName: string | null;
  previewUrl: string;
  abAnalytics: Record<string, Record<string, FunnelCounts>>;
}

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
export function StudioBuilder({ data, chrome }: { data: StudioBuilderData; chrome: Chrome }) {
  if (!data.valid || !data.doc) {
    return (
      <QzPage>
        {chrome === "embedded" ? <TitleBar title="Studio" /> : null}
        <QzPageHeader eyebrow="Studio" title={data.name} />
        <QzBanner tone="crit" title="This quiz's draft JSON failed validation">
          Studio needs a valid draft.{" "}
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
  return <BuilderShell key={data.quizId} data={data} chrome={chrome} />;
}

type LoaderData = StudioBuilderData;

function BuilderShell({ data, chrome }: { data: LoaderData; chrome: Chrome }) {
  const [doc, setDoc] = useState<QuizDoc>(data.doc as QuizDoc);
  const [zoomId, setZoomId] = useState<string | null>(null);
  // Inline editing target in the flow (distinct from zoomId, the full-page
  // advanced editor). Clicking a step or inserting one opens it inline.
  const [editId, setEditId] = useState<string | null>(null);
  const [reconcileError, setReconcileError] = useState<string | null>(null);
  const collections = data.collections;
  const productIndex = data.productIndex;
  const categories = data.categories;

  const [params, setParams] = useSearchParams();
  const stepParam = Number(params.get("step"));
  const step = stepParam >= 1 && stepParam <= 4 ? stepParam : 1;
  const goToStep = useCallback(
    (n: number) => {
      const clamped = Math.min(4, Math.max(1, n));
      setParams(
        (prev) => {
          const nextParams = new URLSearchParams(prev);
          nextParams.set("step", String(clamped));
          return nextParams;
        },
        { replace: false },
      );
      setZoomId(null);
    },
    [setParams],
  );

  // Top-level workspace: the guided 4-step "Build" flow, or the FOCUS #2
  // "Logic" dual-view. Synced to ?view= so reload/links persist.
  const view: "build" | "logic" = params.get("view") === "logic" ? "logic" : "build";
  const setView = useCallback(
    (v: "build" | "logic") => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (v === "logic") next.set("view", "logic");
          else next.delete("view");
          return next;
        },
        { replace: false },
      );
      setZoomId(null);
    },
    [setParams],
  );

  const saveFetcher = useFetcher<{ ok: boolean; savedAt?: string; error?: string }>();
  const publishFetcher = useFetcher<{ ok: boolean; version?: number; error?: string }>();
  const generateFetcher = useFetcher<{ ok: boolean; doc?: QuizDoc; error?: string }>();
  const renameFetcher = useFetcher<{ ok: boolean; name?: string }>();
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

  // Smart Build: POST the generate-questions intent; on success swap the doc.
  const runSmartBuild = useCallback(
    (p: SmartBuildParams) => {
      const form = new FormData();
      form.set("intent", "generate-questions");
      form.set("goalPrompt", p.goalPrompt);
      form.set("questionCount", String(p.questionCount));
      form.set("tone", p.tone);
      form.set("flow", JSON.stringify(p.flow));
      generateFetcher.submit(form, { method: "POST" });
    },
    [generateFetcher],
  );
  const appliedGenRef = useRef<unknown>(null);
  useEffect(() => {
    const d = generateFetcher.data;
    if (generateFetcher.state === "idle" && d?.ok && d.doc && appliedGenRef.current !== d) {
      appliedGenRef.current = d;
      commit(d.doc as QuizDoc);
    }
  }, [generateFetcher.state, generateFetcher.data, commit]);

  const renameQuiz = useCallback(
    (name: string) => {
      const form = new FormData();
      form.set("intent", "rename");
      form.set("name", name);
      renameFetcher.submit(form, { method: "POST" });
    },
    [renameFetcher],
  );
  const isGenerating = generateFetcher.state !== "idle";
  const generateError =
    generateFetcher.data && generateFetcher.data.ok === false
      ? generateFetcher.data.error
      : null;

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
      // Open the new step inline in the flow (no full-page jump).
      if (newNodeId) setEditId(newNodeId);
    },
    [doc, commit, fallbackCollection],
  );

  const handleDelete = useCallback(
    (nodeId: string) => {
      commit(deleteNode(doc, nodeId));
      setZoomId((z) => (z === nodeId ? null : z));
      setEditId((e) => (e === nodeId ? null : e));
    },
    [doc, commit],
  );

  // Drag-reorder / move-up-down: re-stitch the linear run so `movingId` sits
  // before `beforeId` (or at the end when null). moveStep no-ops on non-run
  // nodes, so this is safe to call from any gap.
  const handleMove = useCallback(
    (movingId: string, beforeId: string | null) => {
      commit(moveStep(doc, movingId, beforeId));
    },
    [doc, commit],
  );

  // Remove every unreachable step in one click (Studio fix for stray nodes,
  // no Advanced canvas needed).
  const handleCleanupOrphans = useCallback(
    (ids: string[]) => {
      let next = doc;
      for (const id of ids) next = deleteNode(next, id);
      commit(next);
      setZoomId((z) => (z && ids.includes(z) ? null : z));
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

  const resultCount = doc.nodes.filter((n) => n.type === "result").length;
  // Step 1 (Products) is the only gated step — you need at least one bucket or
  // result page before the rest of the flow has anything to wire to. Steps 2–4
  // are always continuable.
  const canContinue: Record<number, boolean> = {
    1: categories.length >= 1 || resultCount >= 1,
    2: true,
    3: true,
    4: true,
  };
  const stepStates: Record<number, StepState> = {};
  for (let n = 1; n <= 4; n++) {
    stepStates[n] = n === step ? "current" : n < step ? "done" : "upcoming";
  }

  const onNext = () => {
    if (step === 1) {
      const buckets = categories.map((c) => ({ id: c.id, name: c.name }));
      if (buckets.length) {
        try {
          commit(reconcileBucketsToResultNodes(doc, buckets, fallbackCollection));
          setReconcileError(null);
        } catch {
          // Result pages need a fallback collection (ResultData requires one).
          // A shop with no synced collections can't create them yet — but don't
          // dead-end the merchant. Proceed to the next step and surface a
          // non-blocking banner with a "sync your catalog" link instead.
          setReconcileError(
            "We couldn't turn your buckets into result pages yet — sync at least one Shopify collection (result pages need a fallback collection). You can keep building; pages will appear once a collection is synced.",
          );
        }
      } else {
        setReconcileError(null);
      }
    } else {
      setReconcileError(null);
    }
    goToStep(step + 1);
  };

  // Free step navigation from the stepper pills — jump in/out of any step at any
  // time. Unlike Next, a jump never blocks: if we're leaving Step 1 we still try
  // to turn buckets into result pages (so a forward jump doesn't skip page
  // creation), but a failure (e.g. no fallback collection yet) just navigates
  // anyway — the target step renders its own empty state.
  const jumpToStep = useCallback(
    (n: number) => {
      if (step === 1 && n !== 1) {
        const buckets = categories.map((c) => ({ id: c.id, name: c.name }));
        if (buckets.length) {
          try {
            commit(reconcileBucketsToResultNodes(doc, buckets, fallbackCollection));
          } catch {
            // Can't create result pages yet (no fallback collection) — navigate
            // without them; the target step shows its own empty/warn state.
          }
        }
      }
      setReconcileError(null);
      goToStep(n);
    },
    [step, categories, doc, commit, fallbackCollection, goToStep],
  );

  const stepProps: StepProps = {
    quizId: data.quizId,
    doc,
    onCommit: commit,
    productIndex,
    collections,
    categories,
    fallbackCollection,
    allIssues,
    issuesByNode,
    ordered,
    previewUrl: data.previewUrl,
    goToStep,
  };

  const viewToggle = (
    <QzSegmented
      ariaLabel="Build or optimize"
      value={view}
      onChange={setView}
      options={[
        {
          value: "build",
          label: "Build",
          title: "Build the quiz — products, questions, results, preview",
        },
        {
          value: "logic",
          label: "Optimize",
          title:
            "Optimize after launch — A/B splits, analytics, the recommendation map, and product mapping",
        },
      ]}
    />
  );
  const controls = (
    <div className="qz-row" style={{ gap: 8, alignItems: "center" }}>
      {viewToggle}
      <span className="qz-dim" style={{ fontSize: 12 }}>
        {isSaving ? "Saving…" : savedAt ? "Saved" : ""}
      </span>
      {chrome === "embedded" ? (
        <Link
          to={`/app/quizzes/${data.quizId}`}
          className="qz-btn qz-btn-ghost qz-btn-sm"
          title="Advanced node editor (power users)"
        >
          Advanced
        </Link>
      ) : null}
      <QzButton
        variant="primary"
        size="sm"
        disabled={!canPublish || isPublishing}
        onClick={publish}
      >
        {isPublishing ? "Publishing…" : "Publish"}
      </QzButton>
    </div>
  );

  return (
    <QzPage>
      {chrome === "embedded" ? <TitleBar title={`Build · ${data.name}`} /> : null}
      <QzPageHeader
        eyebrow="Quiz builder"
        title={<EditableTitle name={data.name} onRename={renameQuiz} />}
      />

      {view === "build" ? (
        <BuilderStepper
          current={step}
          states={stepStates}
          onJump={jumpToStep}
          right={controls}
        />
      ) : (
        <div
          className="qz-row qz-row-between"
          style={{ alignItems: "center", marginBottom: 16, gap: 12, flexWrap: "wrap" }}
        >
          <div>
            <div className="qz-label">Optimize</div>
            <div className="qz-dim" style={{ fontSize: 12 }}>
              A/B splits, analytics, the recommendation map &amp; product mapping
            </div>
          </div>
          {controls}
        </div>
      )}

      {reconcileError ? (
        <QzBanner tone="warn" title="Result pages need a synced collection">
          {reconcileError}{" "}
          {chrome === "embedded" ? (
            <Link to="/app" style={{ textDecoration: "underline" }}>
              Sync your catalog →
            </Link>
          ) : (
            <span className="qz-dim">Sync your catalog from the Shopify app first.</span>
          )}
        </QzBanner>
      ) : null}
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

      {view === "logic" ? (
        <LogicView
          quizId={data.quizId}
          doc={doc}
          onCommit={commit}
          productIndex={productIndex}
          categories={categories}
          abAnalytics={data.abAnalytics}
        />
      ) : (
        <>
      {step === 1 ? (
        <Step1Products {...stepProps} />
      ) : step === 3 ? (
        <Step3Results {...stepProps} />
      ) : step === 4 ? (
        <Step5Preview {...stepProps} />
      ) : (
        // Step 2 — Questions: the visual question/flow builder (Smart Build +
        // FlowView + zoom StepEditor). Promoted to be the second thing a
        // merchant touches, right after grouping products.
        <>
          <CompletenessBar issues={allIssues} total={doc.nodes.length} />
          {!zoomNode ? (
            <SmartBuildPanel
              onGenerate={runSmartBuild}
              generating={isGenerating}
              error={generateError}
              brandVoiceName={data.brandVoiceName}
              hasBuckets={doc.nodes.some((n) => n.type === "result" && n.data.category_id)}
              bucketCount={resultCount}
              defaultOpen={doc.nodes.filter((n) => n.type === "question").length <= 1}
            />
          ) : null}
          {zoomNode ? (
            <StepEditor
              key={zoomNode.id}
              doc={doc}
              node={zoomNode}
              productIndex={productIndex}
              categories={categories}
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
              categories={categories}
              issuesByNode={issuesByNode}
              editId={editId}
              onEdit={setEditId}
              onAdvanced={setZoomId}
              onCommit={commit}
              onInsert={handleInsert}
              onMove={handleMove}
              onDelete={handleDelete}
              onCleanupOrphans={handleCleanupOrphans}
            />
          )}
        </>
      )}

      <div
        className="qz-row qz-row-between"
        style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid var(--qz-rule)" }}
      >
        <QzButton size="sm" variant="ghost" disabled={step === 1} onClick={() => goToStep(step - 1)}>
          ← Back
        </QzButton>
        {step < 4 ? (
          <QzButton
            size="sm"
            variant="primary"
            disabled={!canContinue[step]}
            onClick={onNext}
            title={!canContinue[step] ? "Group your products to continue" : undefined}
          >
            Next →
          </QzButton>
        ) : (
          <QzButton
            size="sm"
            variant="primary"
            disabled={!canPublish || isPublishing}
            onClick={publish}
          >
            {isPublishing ? "Publishing…" : "Publish quiz"}
          </QzButton>
        )}
      </div>
        </>
      )}
    </QzPage>
  );
}

// Inline-editable quiz title (header). Click to rename; Enter/blur saves via
// the rename intent, Escape cancels.
function EditableTitle({ name, onRename }: { name: string; onRename: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  useEffect(() => {
    setValue(name);
  }, [name]);

  if (!editing) {
    return (
      <span
        onClick={() => setEditing(true)}
        title="Click to rename"
        style={{ cursor: "text" }}
      >
        {value || "Untitled quiz"}
      </span>
    );
  }
  const save = () => {
    const trimmed = value.trim();
    setEditing(false);
    if (trimmed && trimmed !== name) onRename(trimmed);
    else setValue(name);
  };
  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") save();
        if (e.key === "Escape") {
          setValue(name);
          setEditing(false);
        }
      }}
      style={{
        font: "inherit",
        color: "inherit",
        background: "transparent",
        border: "none",
        borderBottom: "2px solid var(--qz-ink, #222)",
        outline: "none",
        width: "100%",
        maxWidth: 520,
      }}
    />
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
// Flow view — a vertical CASCADE of step cards (top → down, the order the
// shopper experiences) with connectors, drag-to-reorder, a drag-in palette, and
// nested/indented branch lanes. (Replaces the old left-to-right scrolling row.)
// ════════════════════════════════════════════════════════════════════════════

// What's currently being dragged: an existing step (reorder) or a palette module
// (insert). Held in FlowView state because dataTransfer can't be read on dragover.
type DragState =
  | { mode: "move"; id: string }
  | { mode: "insert"; kind: InsertKind }
  | null;

function FlowView({
  doc,
  ordered,
  productIndex,
  categories,
  issuesByNode,
  editId,
  onEdit,
  onAdvanced,
  onCommit,
  onInsert,
  onMove,
  onDelete,
  onCleanupOrphans,
}: {
  doc: QuizDoc;
  ordered: ReturnType<typeof orderFlow>;
  productIndex: LoaderData["productIndex"];
  categories: LoaderData["categories"];
  issuesByNode: Map<string, NodeIssue[]>;
  editId: string | null;
  onEdit: (id: string | null) => void;
  onAdvanced: (id: string) => void;
  onCommit: (doc: QuizDoc) => void;
  onInsert: (kind: InsertKind, anchorId: string | null, anchorHandle?: string) => void;
  onMove: (movingId: string, beforeId: string | null) => void;
  onDelete: (id: string) => void;
  onCleanupOrphans: (ids: string[]) => void;
}) {
  const nodeById = useMemo(() => {
    const m = new Map<string, QuizNode>();
    for (const n of doc.nodes) m.set(n.id, n);
    return m;
  }, [doc.nodes]);

  const spine = ordered.steps;
  // The linear, drag-reorderable run (questions/messages/gates between intro and
  // the first branch/result). Drives which cards get a grip + move buttons.
  const runList = useMemo(() => straightThroughRun(doc).run, [doc]);
  const runSet = useMemo(() => new Set(runList), [runList]);

  const [drag, setDrag] = useState<DragState>(null);
  const [overGap, setOverGap] = useState<number | null>(null);
  const clearDrag = useCallback(() => {
    setDrag(null);
    setOverGap(null);
  }, []);

  // Resolve a drop in the gap above `beforeId` (anchored after `afterId`).
  const dropInGap = (afterId: string | null, beforeId: string | null) => {
    if (!drag) return;
    if (drag.mode === "move") onMove(drag.id, beforeId);
    else onInsert(drag.kind, afterId, undefined);
    clearDrag();
  };

  if (!spine.length) {
    return (
      <QzBanner tone="warn" title="No steps yet">
        This quiz has no reachable steps from the intro.
      </QzBanner>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        style={{ display: "grid", gap: 20, alignItems: "start" }}
        className="qz-cascade-grid"
      >
        <StepPalette setDrag={setDrag} clearDrag={clearDrag} />

        {/* The cascade — centered vertical column of cards + connectors. */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
          <div style={{ width: "100%", maxWidth: 540, display: "flex", flexDirection: "column" }}>
            {spine.map((step, i) => {
              const node = nodeById.get(step.nodeId);
              if (!node) return null;
              const lanes = ordered.branches.filter((l) => l.branchNodeId === step.nodeId);
              const movable = runSet.has(step.nodeId);
              const runIdx = runList.indexOf(step.nodeId);
              const prevId = i > 0 ? spine[i - 1]!.nodeId : null;
              return (
                <Fragment key={step.nodeId}>
                  {/* Gap + connector between the previous card and this one. Never
                      above the intro (always first). Doubles as a drop target. */}
                  {i > 0 ? (
                    <DropGap
                      active={drag != null}
                      over={overGap === i}
                      onOver={() => setOverGap(i)}
                      onLeave={() => setOverGap((g) => (g === i ? null : g))}
                      onDrop={() => dropInGap(prevId, step.nodeId)}
                      onInsert={(kind) => onInsert(kind, prevId, undefined)}
                    />
                  ) : null}
                  <CascadeRow
                    movable={movable}
                    onDragStart={() => setDrag({ mode: "move", id: step.nodeId })}
                    onDragEnd={clearDrag}
                    onUp={runIdx > 0 ? () => onMove(step.nodeId, runList[runIdx - 1]!) : undefined}
                    onDown={
                      runIdx >= 0 && runIdx < runList.length - 1
                        ? () => onMove(step.nodeId, runList[runIdx + 2] ?? null)
                        : undefined
                    }
                  >
                    <StepColumn
                      node={node}
                      doc={doc}
                      productIndex={productIndex}
                      categories={categories}
                      issues={issuesByNode.get(step.nodeId) ?? []}
                      lanes={lanes}
                      nodeById={nodeById}
                      issuesByNode={issuesByNode}
                      editId={editId}
                      onEdit={onEdit}
                      onAdvanced={onAdvanced}
                      onCommit={onCommit}
                      onDelete={onDelete}
                      onInsert={onInsert}
                    />
                  </CascadeRow>
                </Fragment>
              );
            })}

            {/* Final gap — drop here to append a step / move to the end. */}
            <DropGap
              active={drag != null}
              over={overGap === spine.length}
              onOver={() => setOverGap(spine.length)}
              onLeave={() => setOverGap((g) => (g === spine.length ? null : g))}
              onDrop={() => dropInGap(spine[spine.length - 1]!.nodeId, null)}
              onInsert={(kind) => onInsert(kind, spine[spine.length - 1]!.nodeId, undefined)}
            />
          </div>
        </div>
      </div>

      {ordered.orphans.length > 0 ? (
        <OrphanTray
          ids={ordered.orphans}
          nodeById={nodeById}
          doc={doc}
          productIndex={productIndex}
          categories={categories}
          issuesByNode={issuesByNode}
          onZoom={onAdvanced}
          onDelete={onDelete}
          onCleanupOrphans={onCleanupOrphans}
        />
      ) : null}
    </div>
  );
}

// Left rail of draggable step types. Drag a chip onto a gap in the flow to
// insert that step there; the existing "+" between steps still click-inserts.
function StepPalette({
  setDrag,
  clearDrag,
}: {
  setDrag: (d: DragState) => void;
  clearDrag: () => void;
}) {
  return (
    <div
      className="qz-cascade-palette"
      style={{ position: "sticky", top: 8, display: "flex", flexDirection: "column", gap: 8, alignSelf: "start" }}
    >
      <div className="qz-label" style={{ fontSize: 10 }}>
        Add a step
      </div>
      <p className="qz-dim" style={{ fontSize: 11, lineHeight: 1.4, margin: 0 }}>
        Drag a block into the flow, or use the + between steps.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 2 }}>
        {INSERTABLE_MODULES.map((m) => (
          <div
            key={m.kind}
            draggable
            onDragStart={(e) => {
              setDrag({ mode: "insert", kind: m.kind });
              e.dataTransfer.effectAllowed = "copy";
              try {
                e.dataTransfer.setData("text/plain", m.kind);
              } catch {
                /* some browsers throw on synthetic events; state already set */
              }
            }}
            onDragEnd={clearDrag}
            className="qz-card"
            title={m.hint}
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              padding: "8px 10px",
              cursor: "grab",
              fontSize: 13,
              userSelect: "none",
            }}
          >
            <span style={{ width: 18, textAlign: "center", flex: "0 0 auto" }}>{m.glyph}</span>
            <span style={{ fontWeight: 600 }}>{m.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// A connector + drop target between two cascade cards. Shows the vertical flow
// line with a click-"+" on it; highlights into an accent bar when a drag hovers.
function DropGap({
  active,
  over,
  onOver,
  onLeave,
  onDrop,
  onInsert,
}: {
  active: boolean;
  over: boolean;
  onOver: () => void;
  onLeave: () => void;
  onDrop: () => void;
  onInsert: (kind: InsertKind) => void;
}) {
  return (
    <div
      onDragOver={(e) => {
        if (active) {
          e.preventDefault();
          onOver();
        }
      }}
      onDragLeave={onLeave}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      style={{
        position: "relative",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        minHeight: 36,
        width: "100%",
      }}
    >
      {/* the flow line */}
      <div style={{ position: "absolute", top: 0, bottom: 0, width: 2, background: "var(--qz-rule)" }} />
      {/* drop highlight bar */}
      {over ? (
        <div
          style={{
            position: "absolute",
            left: "10%",
            right: "10%",
            height: 4,
            borderRadius: 999,
            background: "var(--qz-accent)",
          }}
        />
      ) : null}
      <div style={{ position: "relative", zIndex: 1 }}>
        <InsertSlot onPick={onInsert} />
      </div>
    </div>
  );
}

// Wraps a cascade card with a left gutter holding the drag grip + move-up/down
// buttons (only for reorderable steps). The grip lives OUTSIDE the card button
// so dragging it never triggers the card's click-to-edit.
function CascadeRow({
  children,
  movable,
  onDragStart,
  onDragEnd,
  onUp,
  onDown,
}: {
  children: React.ReactNode;
  movable: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onUp?: () => void;
  onDown?: () => void;
}) {
  const tiny: React.CSSProperties = {
    width: 22,
    height: 18,
    padding: 0,
    fontSize: 11,
    lineHeight: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "flex-start", justifyContent: "center", width: "100%" }}>
      <div style={{ width: 24, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, paddingTop: 8, flex: "0 0 auto" }}>
        {movable ? (
          <>
            <span
              draggable
              onDragStart={(e) => {
                onDragStart();
                e.dataTransfer.effectAllowed = "move";
                try {
                  e.dataTransfer.setData("text/plain", "move");
                } catch {
                  /* state already set */
                }
              }}
              onDragEnd={onDragEnd}
              title="Drag to reorder"
              aria-label="Drag to reorder"
              style={{ cursor: "grab", userSelect: "none", fontSize: 15, lineHeight: 1, color: "var(--qz-dim, #999)" }}
            >
              ⠿
            </span>
            <button type="button" className="qz-btn qz-btn-ghost" style={tiny} onClick={onUp} disabled={!onUp} title="Move up" aria-label="Move up">
              ↑
            </button>
            <button type="button" className="qz-btn qz-btn-ghost" style={tiny} onClick={onDown} disabled={!onDown} title="Move down" aria-label="Move down">
              ↓
            </button>
          </>
        ) : null}
      </div>
      <div style={{ flex: "0 1 auto", minWidth: 0 }}>{children}</div>
    </div>
  );
}

function StepColumn({
  node,
  doc,
  productIndex,
  categories,
  issues,
  lanes,
  nodeById,
  issuesByNode,
  editId,
  onEdit,
  onAdvanced,
  onCommit,
  onDelete,
  onInsert,
}: {
  node: QuizNode;
  doc: QuizDoc;
  productIndex: LoaderData["productIndex"];
  categories: LoaderData["categories"];
  issues: NodeIssue[];
  lanes: ReturnType<typeof orderFlow>["branches"];
  nodeById: Map<string, QuizNode>;
  issuesByNode: Map<string, NodeIssue[]>;
  editId: string | null;
  onEdit: (id: string | null) => void;
  onAdvanced: (id: string) => void;
  onCommit: (doc: QuizDoc) => void;
  onDelete: (id: string) => void;
  onInsert: (kind: InsertKind, anchorId: string | null, anchorHandle?: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <StepCard
        node={node}
        doc={doc}
        productIndex={productIndex}
        categories={categories}
        issues={issues}
        editing={editId === node.id}
        onOpen={() => onEdit(node.id)}
        onClose={() => onEdit(null)}
        onAdvanced={() => onAdvanced(node.id)}
        onCommit={onCommit}
        onDelete={() => onDelete(node.id)}
      />
      {lanes.map((lane) => (
        <div
          key={lane.laneId}
          style={{
            borderLeft: "2px solid var(--qz-rule)",
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
                  onZoom={() => onAdvanced(s.nodeId)}
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
  categories,
  issues,
  editing,
  onOpen,
  onClose,
  onAdvanced,
  onCommit,
  onDelete,
}: {
  node: QuizNode;
  doc: QuizDoc;
  productIndex: LoaderData["productIndex"];
  categories: LoaderData["categories"];
  issues: NodeIssue[];
  editing: boolean;
  onOpen: () => void;
  onClose: () => void;
  onAdvanced: () => void;
  onCommit: (doc: QuizDoc) => void;
  onDelete: () => void;
}) {
  const bad = issues.length > 0;

  // Inline editor — the card expands in place to the node's Content fields, so
  // editing happens IN the flow (no full-page jump). Advanced (Layout/Style/CSS)
  // is one click away. The rest of the flow stays visible alongside.
  if (editing) {
    return (
      <div
        className="qz-card"
        style={{
          width: 360,
          padding: 14,
          alignSelf: "stretch",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          border: "2px solid var(--qz-accent)",
          boxShadow: "var(--qz-shadow-md)",
        }}
      >
        <div className="qz-row qz-row-between" style={{ alignItems: "center" }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>{NODE_LABEL[node.type]}</span>
          <div className="qz-row" style={{ gap: 6, alignItems: "center" }}>
            {bad ? <QzBadge tone="crit">{issues.length}</QzBadge> : <QzBadge tone="ok">OK</QzBadge>}
            <button onClick={onClose} className="qz-btn qz-btn-primary qz-btn-sm">
              Done
            </button>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <ContentTab doc={doc} node={node} onCommit={onCommit} />
        </div>
        <div
          className="qz-row qz-row-between"
          style={{ borderTop: "1px solid var(--qz-rule)", paddingTop: 10, alignItems: "center" }}
        >
          <button
            onClick={onAdvanced}
            className="qz-btn qz-btn-ghost qz-btn-sm"
            title="Layout, design & CSS"
          >
            Advanced →
          </button>
          {node.type !== "intro" ? (
            <button onClick={onDelete} className="qz-btn qz-btn-ghost qz-btn-sm">
              Delete
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={onOpen}
      className="qz-card"
      style={{
        width: THUMB_W,
        padding: 0,
        overflow: "hidden",
        textAlign: "left",
        cursor: "pointer",
        border: bad ? "2px solid var(--qz-crit)" : undefined,
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
          borderTop: "1px solid var(--qz-rule)",
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
          <StepPreview doc={doc} node={node} productIndex={productIndex} categories={categories} />
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
          border: warn
            ? "1px dashed var(--qz-crit)"
            : "1px dashed color-mix(in srgb, var(--qz-ink) 20%, transparent)",
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
            boxShadow: "var(--qz-shadow-lg)",
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
  categories,
  issuesByNode,
  onZoom,
  onDelete,
  onCleanupOrphans,
}: {
  ids: string[];
  nodeById: Map<string, QuizNode>;
  doc: QuizDoc;
  productIndex: LoaderData["productIndex"];
  categories: LoaderData["categories"];
  issuesByNode: Map<string, NodeIssue[]>;
  onZoom: (id: string) => void;
  onDelete: (id: string) => void;
  onCleanupOrphans: (ids: string[]) => void;
}) {
  return (
    <div className="qz-card" style={{ padding: 14, border: "1px solid #f0c0c0", background: "#fff8f8" }}>
      <div className="qz-row qz-row-between" style={{ alignItems: "center", marginBottom: 10 }}>
        <div>
          <div className="qz-label" style={{ marginBottom: 2 }}>
            Unreachable steps ({ids.length})
          </div>
          <div className="qz-dim" style={{ fontSize: 12 }}>
            These aren’t reachable from the intro. Remove them, or open one to edit. No Advanced
            builder needed.
          </div>
        </div>
        <QzButton size="sm" variant="ghost" onClick={() => onCleanupOrphans(ids)}>
          Remove all
        </QzButton>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {ids.map((id) => {
          const node = nodeById.get(id);
          if (!node) return null;
          return (
            <div key={id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <StepCard
                node={node}
                doc={doc}
                productIndex={productIndex}
                categories={categories}
                issues={issuesByNode.get(id) ?? []}
                editing={false}
                onOpen={() => onZoom(id)}
                onClose={() => {}}
                onAdvanced={() => onZoom(id)}
                onCommit={() => {}}
                onDelete={() => onDelete(id)}
              />
              <button
                onClick={() => onDelete(id)}
                className="qz-btn qz-btn-ghost qz-btn-sm"
                style={{ color: "#b42318" }}
              >
                ✕ Delete
              </button>
            </div>
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
  categories,
  issues,
  onBack,
  onCommit,
  onDelete,
}: {
  doc: QuizDoc;
  node: QuizNode;
  productIndex: LoaderData["productIndex"];
  categories: LoaderData["categories"];
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
              <StepPreview doc={doc} node={node} productIndex={productIndex} categories={categories} breakpoint={previewBp} />
            </div>
          </div>
        </div>

        {/* Rail */}
        <div className="qz-card" style={{ padding: 0, alignSelf: "start" }}>
          <div className="qz-row" style={{ borderBottom: "1px solid var(--qz-rule)" }}>
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
  const setData = (patch: Record<string, unknown>) =>
    onCommit(updateNodeData(doc, node.id, patch));
  const setAnswer = (answerId: string, text: string) => {
    const answers = node.data.answers.map((a) => (a.id === answerId ? { ...a, text } : a));
    onCommit(updateNodeData(doc, node.id, { answers }));
  };
  const isCard = !["text", "email"].includes(node.data.question_type);
  const num = (v: string) => (v.trim() ? Math.max(1, Math.round(Number(v) || 1)) : undefined);
  return (
    <>
      <QzField label="Question">
        <QzTextarea value={node.data.text} onChange={(e) => setText(e.target.value)} rows={2} />
      </QzField>
      <QzField label="Type">
        <QzSelect
          value={node.data.question_type}
          onChange={(e) => setData({ question_type: e.target.value })}
        >
          <option value="single_select">Single select</option>
          <option value="multi_select">Multi select</option>
          <option value="dropdown">Dropdown</option>
          <option value="image_tile">Image tiles</option>
          <option value="image_picker">Image picker</option>
          <option value="searchable">Searchable</option>
          <option value="text">Text input</option>
          <option value="email">Email input</option>
        </QzSelect>
      </QzField>
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
