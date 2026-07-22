import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useFetcher, useSearchParams } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { QzPage, QzPageHeader, QzButton, QzBanner } from "../qz";
import { experienceTypeOf, type Quiz, type ContentBlockType } from "../../lib/quizSchema";
import { validateQuiz, validateQuizWarnings, type NodeIssue } from "../../lib/quizValidation";
import { orderFlow } from "../../lib/flowOrder";
import { reconcileBucketsToResultNodes } from "../../lib/bucketReconcile";
import {
  deleteNode,
  duplicateQuestionNode,
  setQuestionType,
  straightThroughRun,
  swapScoringModel,
} from "../../lib/quizMutations";
import { buildBuilderHealthReport, type Tier1Link } from "../../lib/pathReport";
import type { StepProps } from "../builder/stepProps";
import { Step5Preview } from "../builder/Step5Preview";
import { Step1Products } from "../builder/Step1Products";
import { LogicView } from "../logic/LogicView";
import { DEVICE_PRESETS, breakpointForWidth } from "../builder/preview/previewWidth";
import type { InspectTarget } from "../runtime/QuizRuntime";
import { useQuizDraft } from "./useQuizDraft";
import { FlowRail, type WorkspaceView } from "./FlowRail";
import { ContextPanel } from "./ContextPanel";
import type { RegenApi } from "./panels/ContentTab";
import { AiChatPanel } from "./AiChatPanel";
import { ReviewEnrichPanel } from "./ReviewEnrichPanel";
import { EditableTitle, PLACEMENTS, startInlineTextEdit, type StudioBuilderData } from "./studioShared";
import { applyInspectText, INLINE_EDITABLE_PARTS, insertModule } from "./studioDoc";
import { BuilderNavRail, BuilderTopBar, type BuilderNavKey } from "./BuilderChrome";
import { HealthPill } from "../onboarding/questionsLogicV3/HealthPill";
import { HealthPopover } from "../onboarding/questionsLogicV3/HealthPopover";
import { Step3Results } from "../builder/Step3Results";
import { TranslationsPanel } from "./TranslationsPanel";
import { ExperiencePanel } from "./ExperiencePanel";
import { QzDrawer } from "../qz-overlays";
import { BuilderLogicView, QuizSettingsView } from "./BuilderSettings";
import { BuilderDesignPanel } from "./BuilderDesignPanel";
import { BLOCK_DRAG_MIME, BuilderBlocksPalette, insertBlock } from "./BuilderBlocksPalette";
import { BuilderBackgroundTab } from "./BuilderBackgroundTab";
import { BuilderLayersTab } from "./BuilderLayersTab";
import { ScreenCarousel } from "./ScreenCarousel";
import UpgradeDeciderModal from "../onboarding/questionsLogic/UpgradeDeciderModal";

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

// `savedAt` is an ISO string from the CLIENT autosave fetcher — never
// server-rendered (the builder is ClientOnly besides), so local-time
// formatting is safe here (the ssr-unsafe-locale-dates trap doesn't apply).
function savedTimeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

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
  const {
    doc,
    commit: rawCommit,
    isSaving,
    savedAt,
    saveError,
    retrySave,
    flushSave,
    beginAiEdit,
    applyAiResult,
    endAiEdit,
  } = useQuizDraft(data.doc as QuizDoc);
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
  // Apply path for the AI panels: record the pre-AI doc for undo (as commit
  // does), then hand the AI doc to the draft hook, which 3-way merges any edit
  // typed DURING the LLM call back on top of it before adopting — so a headline
  // the merchant changes mid-call survives the AI doc landing.
  const applyAi = useCallback(
    (aiDoc: QuizDoc) => {
      setHistory((h) => ({ past: [...h.past, doc].slice(-50), future: [] }));
      applyAiResult(aiDoc);
    },
    [doc, applyAiResult],
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
  // Question-Builder spec — per-question AI Regenerate plumbing handed to the
  // ContextPanel's content editor: pause autosave during the LLM call, apply the
  // regenerated doc through the 3-way merge (recording a snapshot for undo), and
  // resume on error. The ~10s undo button reuses the snapshot stack.
  const regenApi = useMemo<RegenApi>(
    () => ({
      start: () => {
        beginAiEdit();
      },
      apply: applyAi,
      error: endAiEdit,
      undo,
    }),
    [beginAiEdit, applyAi, endAiEdit, undo],
  );
  // Keyboard shortcuts for undo/redo (⌘Z / ⌘⇧Z, plus Ctrl+Y for Windows redo).
  // Guarded so typing in a field keeps NATIVE text undo — only the builder canvas
  // gets these. undo()/redo() self-noop when the stack is empty, so no extra gate.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const ae = document.activeElement as HTMLElement | null;
      if (
        ae &&
        (ae.tagName === "INPUT" ||
          ae.tagName === "TEXTAREA" ||
          ae.tagName === "SELECT" ||
          ae.isContentEditable)
      ) {
        return;
      }
      const key = e.key.toLowerCase();
      if (key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (key === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);
  // QB-2 — preview zoom (a CSS scale on the canvas frame), 50–100%.
  const [zoom, setZoom] = useState(100);
  const publishFetcher = useFetcher<{ ok: boolean; version?: number; error?: string }>();
  const renameFetcher = useFetcher<{ ok: boolean; name?: string }>();

  // Selection drives the ContextPanel; the optional inspect target carries the
  // exact element clicked in the preview (for its outline highlight).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Armed-delete (two-step confirm) lifted from FlowRail so a Delete/Backspace
  // keystroke on the selected step arms it (the rail renders the confirm + owns
  // the destructive op). Never deletes outright.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [inspectTarget, setInspectTarget] = useState<InspectTarget | null>(null);
  // The step the live preview is currently SHOWING (reported by the runtime) —
  // drives the rail's ▸ marker so walking the quiz in Interact mode keeps you
  // oriented without opening the editing panel.
  const [liveNodeId, setLiveNodeId] = useState<string | null>(null);
  // BLD-7 — a palette tile is being dragged over the canvas (drop ring).
  const [blockDropActive, setBlockDropActive] = useState(false);
  const [editMode, setEditMode] = useState(true);
  // LOGIC v2 (L2-10f) — the explicit legacy→decider upgrade wizard.
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  // QZY-6 — the "Assist" top-bar companion (build-tab spec §1: AI acts in
  // context, never a destination tab). Opens the existing chat + enrich
  // panels in a right-side drawer; the full Assist design is DEFERRED.
  const [assistOpen, setAssistOpen] = useState(false);
  // Device-frame width lifted from Step5Preview so the Design tab's layer
  // selector can follow it ("edit what you see").
  const [frameW, setFrameW] = useState<number>(DEVICE_PRESETS.desktop);
  // QD-6 → QZY-6: the Build view's focused left panel (standalone only).
  // "theme" is the rail's Design section (the canvas stays visible); the old
  // ai/code tools moved to the Assist drawer + the Settings section.
  const [tool, setTool] = useState<"editor" | "theme">("editor");
  // QB-4b → QZY-7: the Build tab's left panel (build-tab spec §2) — Add
  // (palette) · Layers (current screen's blocks) · Background. The step LIST
  // left this panel: the screen carousel under the canvas is the navigator.
  const [editorSubtab, setEditorSubtab] = useState<"add" | "layers" | "background">("add");
  const [libraryCollapsed, setLibraryCollapsed] = useState(false);
  const [reconcileError, setReconcileError] = useState<string | null>(null);

  const select = useCallback((nodeId: string | null) => {
    setSelectedId(nodeId);
    setInspectTarget(null);
    setConfirmDeleteId(null); // navigating away disarms a pending delete
  }, []);
  const onInspect = useCallback((t: InspectTarget) => {
    setSelectedId(t.nodeId);
    setInspectTarget(t);
    setConfirmDeleteId(null);
  }, []);

  // Esc backs out one level: disarm a pending delete first, else clear selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (upgradeOpen) return; // the wizard modal owns Escape while open
      if (confirmDeleteId) setConfirmDeleteId(null);
      else select(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select, confirmDeleteId, upgradeOpen]);

  // Delete / Backspace on the selected step ARMS its two-step delete confirm in
  // the rail (never deletes outright — the actual delete is a second explicit
  // click). Guarded so it never fires while typing in a field; intro is not
  // deletable, so the rail renders no confirm for it (arming one is a no-op).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (!selectedId) return;
      const ae = document.activeElement as HTMLElement | null;
      if (
        ae &&
        (ae.tagName === "INPUT" ||
          ae.tagName === "TEXTAREA" ||
          ae.tagName === "SELECT" ||
          ae.isContentEditable)
      ) {
        return;
      }
      const node = doc.nodes.find((n) => n.id === selectedId);
      if (!node || node.type === "intro") return;
      e.preventDefault();
      setConfirmDeleteId(selectedId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, doc]);

  // View (Build / Products / Results / Logic). State is the source of truth — a
  // plain useState so a tab click ALWAYS switches, even when client-side routing
  // is flaky (the builder throws hydration #418/#425 on load, which was aborting
  // the setParams navigation → dead tabs: the reported "selecting products/
  // results/logic does nothing"). ?view= is read once on mount for deep-linking
  // and best-effort-synced; the view no longer DEPENDS on the URL round-trip.
  const [params, setParams] = useSearchParams();
  const [view, setViewState] = useState<WorkspaceView>(() => {
    const p = params.get("view");
    return p === "products" || p === "results" || p === "logic" || p === "settings"
      ? p
      : "build";
  });
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
              "We couldn't turn your recommendations into result pages yet — sync at least one Shopify collection (result pages need a fallback collection). You can keep building; pages will appear once a collection is synced.",
            );
          }
        }
      }
      setViewState(v);
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
  // BLD-1 — the standalone chrome's ONE health report (decider: full Tier-1;
  // legacy: the S1/S2 adapter). The pill, its popover and the tri-state
  // Publish all read this instance, so they cannot disagree; `blocking === 0`
  // ⇔ `canPublish` in both arms (S1 folds validateQuiz).
  const healthReport = useMemo(
    () => buildBuilderHealthReport(doc, data.categories),
    [doc, data.categories],
  );
  const [healthOpen, setHealthOpen] = useState(false);
  const isDecider = doc.logic_model === "decider";
  // BLD-2 — inline canvas editing commits on BLUR, which can land after other
  // commits; read the live doc through a ref so a stale closure can't clobber
  // edits made while the contenteditable session was open.
  const docRef = useRef(doc);
  docRef.current = doc;
  // Double-click the SELECTED (.qz-insp-sel) canvas element to edit its text
  // in place — builder-side DOM only, the runtime just re-renders the commit.
  const onCanvasDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!editMode || !inspectTarget) return;
      if (!INLINE_EDITABLE_PARTS.has(inspectTarget.part)) return;
      const el = (e.target as HTMLElement).closest?.(".qz-insp-sel");
      if (!(el instanceof HTMLElement)) return;
      e.preventDefault();
      const target = inspectTarget;
      startInlineTextEdit(el, (text) => {
        commit(applyInspectText(docRef.current, target, text));
      });
    },
    [editMode, inspectTarget, commit],
  );
  // Health popover jump-links: a question/node finding focuses that node in
  // the Build view's editor; a rule finding lives in the Logic view (BLD-4
  // will deep-scroll it — landing the view is the useful move today).
  const onHealthNavigate = useCallback(
    (link: Tier1Link) => {
      setHealthOpen(false);
      if (link.kind === "question" && link.nodeId) {
        setTool("editor");
        setView("build");
        select(link.nodeId);
      } else if (link.kind === "rule") {
        setView("logic");
      }
    },
    [setView, select],
  );
  const isPublishing = publishFetcher.state !== "idle";
  const placement = doc.placement ?? "page";
  const currentPlacement = PLACEMENTS.find((p) => p.value === placement) ?? PLACEMENTS[0]!;

  const publish = () => {
    const form = new FormData();
    form.set("intent", "publish");
    // Send the LIVE doc so a publish that races a pending autosave (the 700ms
    // debounce) still ships the merchant's latest edit — the server persists it
    // before baking, eliminating the missed-final-edit race.
    form.set("doc", JSON.stringify(doc));
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

  // Autosave status chip — a legible "Saving…" (pulsing dot) / "Saved" (green
  // check, success pulse keyed on savedAt). Shared by both top-bar variants.
  const saveStatus = (
    <span className="qz-save-status" aria-live="polite">
      {isSaving ? (
        <span className="qz-save-chip is-saving">
          <span className="qz-save-dot" aria-hidden /> Saving…
        </span>
      ) : savedAt ? (
        <span key={savedAt} className="qz-save-chip is-saved">
          <span aria-hidden>✓</span> Saved
        </span>
      ) : null}
    </span>
  );

  // B7 — scoring-model badge/toggle (parity with the funnel Question Builder
  // header). Both models are saved; clicking swaps active↔alt. Rendered in both
  // the standalone Quizell top bar and the embedded QzPageHeader.
  // LOGIC v2 (L2-10f): decider docs REPLACE it with the ◆ badge — the scoring
  // swap writes scoring_model, a legacy field decider docs must not grow —
  // and legacy docs gain the explicit per-quiz "↑ Upgrade" wizard entry.
  const scoringBadge =
    doc.logic_model === "decider" ? (
      <span
        className="qz-ql-modelbadge"
        title="One deciding question picks the result; advanced rules can override it"
      >
        ◆ Decider logic
      </span>
    ) : (
      (() => {
        const m = doc.scoring_model ?? "direct";
        const other = m === "direct" ? "weighted" : "direct";
        return (
          <>
            <button
              type="button"
              className="qz-btn qz-btn-ghost qz-btn-sm"
              style={{ fontSize: 12 }}
              title={`Scoring: ${m === "direct" ? "Direct mapping" : "Weighted scoring"} — click to switch (both models are saved)`}
              onClick={() => commit(swapScoringModel(doc, other))}
            >
              {m === "direct" ? "Direct mapping" : "Weighted scoring"}
            </button>
            <button
              type="button"
              className="qz-btn qz-btn-ghost qz-btn-sm"
              style={{ fontSize: 12 }}
              title="Convert this draft to Decider logic — one deciding question, rule overrides, a single configurable results page"
              onClick={() => setUpgradeOpen(true)}
            >
              ↑ Upgrade to Decider logic
            </button>
          </>
        );
      })()
    );

  // Portals to document.body, so mounting position is chrome-agnostic —
  // rendered in both the standalone builder and the embedded QzPage returns.
  const upgradeModal = upgradeOpen ? (
    <UpgradeDeciderModal
      doc={doc}
      categories={data.categories}
      surface="builder"
      onCommit={commit}
      onClose={() => setUpgradeOpen(false)}
    />
  ) : null;

  const editInteractToggle = (
    <div
      className="qz-segmented"
      role="group"
      aria-label="Preview mode"
      title="Edit: click any element in the preview to edit it · Interact: walk through the quiz normally"
    >
      <button type="button" aria-pressed={editMode} onClick={() => setEditMode(true)}>
        Edit
      </button>
      <button
        type="button"
        aria-pressed={!editMode}
        onClick={() => {
          setEditMode(false);
          setInspectTarget(null);
        }}
      >
        Interact
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

  const placementGrid = (
    <>
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
    </>
  );

  const settingsPopover = (
    <details style={{ position: "relative" }}>
      <summary className="qz-btn qz-btn-ghost qz-btn-sm" style={{ listStyle: "none", cursor: "pointer" }}>
        Placement
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
        {placementGrid}
      </div>
    </details>
  );

  // BLD-1 — the standalone bar's secondary actions folded into one ⋯ menu
  // (placement grid + share/embed) so the title keeps its room at 1280w.
  const moreMenu = (
    <details style={{ position: "relative" }}>
      <summary
        className="qz-btn qz-btn-ghost qz-btn-sm qz-tip"
        data-tip="Placement & sharing"
        aria-label="More options"
        style={{ listStyle: "none", cursor: "pointer", fontWeight: 700, letterSpacing: "0.08em" }}
      >
        ⋯
      </summary>
      <div
        className="qz-card"
        style={{
          position: "absolute",
          right: 0,
          top: "calc(100% + 6px)",
          width: 380,
          padding: 12,
          zIndex: 60,
          boxShadow: "var(--qz-lift-2)",
        }}
      >
        {placementGrid}
        <div className="qz-row" style={{ gap: 6, flexWrap: "wrap" }}>
          <Link
            to={`/studio/${data.quizId}/embed`}
            className="qz-btn qz-btn-ghost qz-btn-sm"
            style={{ textDecoration: "none", display: "inline-flex" }}
          >
            Share &amp; embed →
          </Link>
          <button
            type="button"
            className="qz-btn qz-btn-ghost qz-btn-sm"
            onClick={(e) => {
              // Close the <details> menu before navigating (QZY-6: quiz
              // settings is the rail's Settings section now).
              (e.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute("open");
              setView("settings");
            }}
          >
            Quiz settings…
          </button>
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
            categories={data.categories}
            view={view}
            onView={setView}
            confirmDeleteId={confirmDeleteId}
            onConfirmDelete={setConfirmDeleteId}
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
                regen={regenApi}
              />
            ) : (
              <div className="qz-card" style={{ padding: 12, marginBottom: 16 }}>
                <p className="qz-dim" style={{ fontSize: 12.5, margin: 0 }}>
                  Select a step in the rail — or click any element in the preview — to edit its
                  content, design, and layout here.
                </p>
              </div>
            )}
            <ReviewEnrichPanel
              onApply={applyAi}
              onAiStart={beginAiEdit}
              onAiError={endAiEdit}
              sources={doc.review_enrichment_sources}
            />
            <ExperiencePanel doc={doc} onCommit={commit} onSelectNode={select} />
            <TranslationsPanel
              doc={doc}
              onApply={applyAi}
              onAiStart={beginAiEdit}
              onAiError={endAiEdit}
              previewUrl={data.previewUrl}
            />
            <AiChatPanel
              onApply={applyAi}
              onAiStart={beginAiEdit}
              onAiError={endAiEdit}
              selectedNodeId={selectedId}
            />
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
            categories={data.categories}
            view={view}
            onView={setView}
            confirmDeleteId={confirmDeleteId}
            onConfirmDelete={setConfirmDeleteId}
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

  // BLD-1 — standalone gets the V2 builder chrome: the DS top bar (wordmark ·
  // truncating title · preview controls · save/health/publish) over a body row
  // of ONE nav rail · tool-switched left panel · centered stage. Validation
  // moved off the canvas into the health pill; the filmstrip is retired. The
  // embedded /app surface keeps the shared `body` 3-pane layout below
  // (untouched by owner decision).
  if (chrome === "standalone") {
    // ONE active key for the single nav rail: a non-build view IS the key
    // (the deep-linkable "results" view lights Build — result screens are
    // Build screens now); in the Build view the focused tool lights
    // (editor ⇒ Build, theme ⇒ Design).
    const railActive: BuilderNavKey =
      view === "products" || view === "logic" || view === "settings"
        ? view
        : tool === "theme"
          ? "design"
          : "build";
    const selectedNode = selectedId ? doc.nodes.find((n) => n.id === selectedId) ?? null : null;
    // BLD-7 — block-insert targeting: the SELECTED step wins; with nothing
    // selected, the step the canvas is showing (so the palette always works
    // when you can see a step). Drops target what you see (live first).
    const liveNode = liveNodeId ? doc.nodes.find((n) => n.id === liveNodeId) ?? null : null;
    const blockTarget = selectedNode ?? liveNode;
    const dropTarget = liveNode ?? selectedNode;
    const onCanvasDragOver = (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(BLOCK_DRAG_MIME)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = dropTarget ? "copy" : "none";
      if (!blockDropActive) setBlockDropActive(true);
    };
    const onCanvasDragLeave = (e: React.DragEvent) => {
      if (e.currentTarget.contains(e.relatedTarget as Node)) return;
      setBlockDropActive(false);
    };
    const onCanvasDrop = (e: React.DragEvent) => {
      const type = e.dataTransfer.getData(BLOCK_DRAG_MIME);
      setBlockDropActive(false);
      if (!type || !dropTarget) return;
      e.preventDefault();
      commit(insertBlock(doc, dropTarget, type as ContentBlockType));
      select(dropTarget.id); // open the inspector on the step that grew a block
    };

    // QZY-7 (build-tab §3) — the palette's question tiles: on a question
    // screen they SWITCH the input type (choice ↔ slider confirms, naming the
    // mapping impact — §9); elsewhere they add a NEW question screen after
    // the last movable step (the add-anchor rule: straightThroughRun, never
    // the ordered spine's terminal).
    const addQuestionScreen = (kind: "single_select" | "slider") => {
      const run = straightThroughRun(doc);
      const anchor =
        blockTarget && run.run.includes(blockTarget.id)
          ? blockTarget.id
          : run.run[run.run.length - 1] ?? run.head;
      if (!anchor) return;
      const { doc: next, newNodeId } = insertModule(
        doc,
        "question",
        anchor,
        undefined,
        fallbackCollection,
      );
      if (!newNodeId) return;
      commit(kind === "slider" ? setQuestionType(next, newNodeId, "slider") : next);
      select(newNodeId);
    };
    const onQuestionTile = (kind: "single_select" | "slider") => {
      if (blockTarget?.type === "question") {
        const cur = blockTarget.data.question_type;
        if (cur === kind) return;
        const crossing = (cur === "slider") !== (kind === "slider");
        if (
          crossing &&
          !window.confirm(
            kind === "slider"
              ? "Switch this question to a slider? Answers are kept (the first becomes the slider's seed); discrete mappings translate to range bands."
              : "Switch this question to choice answers? The slider's seed answer is kept and a second option is added.",
          )
        ) {
          return;
        }
        commit(setQuestionType(doc, blockTarget.id, kind));
        select(blockTarget.id);
        return;
      }
      addQuestionScreen(kind);
    };

    // The left panel content for the focused tool (build view only). QZY-6:
    // ai/code left this switch — Assist is a top-bar drawer, custom CSS lives
    // in Settings.
    const toolPanel =
      tool === "theme" ? (
        <>
          {/* BLD-3 — every tool panel opens with a header (the design panel's
              first control read as a floating checkbox without one). */}
          <div className="qz-label" style={{ fontSize: 11 }}>
            Design
          </div>
          <BuilderDesignPanel doc={doc} commit={commit} onSelectNode={select} />
        </>
      ) : (
        <>
          {/* QZY-7 (build-tab §2) — the three left-panel tabs. Screen
              NAVIGATION moved to the carousel under the canvas. */}
          <div className="qz-segmented" role="group" aria-label="Build panel">
            <button type="button" aria-pressed={editorSubtab === "add"} onClick={() => setEditorSubtab("add")}>
              Add
            </button>
            <button type="button" aria-pressed={editorSubtab === "layers"} onClick={() => setEditorSubtab("layers")}>
              Layers
            </button>
            <button type="button" aria-pressed={editorSubtab === "background"} onClick={() => setEditorSubtab("background")}>
              Background
            </button>
          </div>
          {editorSubtab === "add" ? (
            <BuilderBlocksPalette
              doc={doc}
              node={blockTarget}
              commit={commit}
              onQuestionTile={onQuestionTile}
            />
          ) : editorSubtab === "layers" ? (
            <BuilderLayersTab
              doc={doc}
              node={blockTarget}
              commit={commit}
              onSelectNode={select}
            />
          ) : (
            // QZY-11 — PER-SCREEN backgrounds (§8); the quiz-wide default
            // stays reachable in a disclosure inside.
            <BuilderBackgroundTab doc={doc} node={blockTarget} commit={commit} />
          )}
        </>
      );

    // BLD-3 — the right-side 400px inspector (the embedded 3-pane geometry):
    // the ContextPanel gets real room, so its Content/Design/Routing tabs fit
    // instead of clipping at the old 320px left panel's edge.
    const inspector = selectedId ? (
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
        regen={regenApi}
        inspectTarget={inspectTarget}
        onClearScope={() => setInspectTarget(null)}
        onArmDelete={setConfirmDeleteId}
      />
    ) : (
      <div className="qz-card" style={{ padding: 12 }}>
        <p className="qz-dim" style={{ fontSize: 12.5, margin: 0 }}>
          Select a step in the rail — or click any element in the preview — to
          edit its content, design, and layout here.
        </p>
      </div>
    );

    // The health pill + its controlled popover (QzPopover portals correctly
    // inside the blurred top bar — same hosting as TopBar3). Legacy docs hide
    // the decider-only sections (Tier-2 review, outcome table).
    const healthPill = (
      <HealthPill
        verdict={healthReport.verdict}
        open={healthOpen}
        onOpenChange={setHealthOpen}
        popover={
          <HealthPopover
            report={healthReport}
            doc={doc}
            quizId={data.quizId}
            onCommit={commit}
            onFlush={flushSave}
            onNavigate={onHealthNavigate}
            tier2={isDecider}
            showOutcomes={isDecider}
          />
        }
      />
    );

    // The v3 save-chip anatomy: Saving… / Saved HH:MM / error + Retry (the
    // embedded surface keeps the simpler shared `saveStatus` chip).
    const saveStatusV2 = (
      <span className="qz-save-status" aria-live="polite">
        {isSaving ? (
          <span className="qz-save-chip is-saving">
            <span className="qz-save-dot" aria-hidden /> Saving…
          </span>
        ) : saveError ? (
          <span className="qz-save-chip is-error">
            <span aria-hidden>⚠</span> {saveError} ·{" "}
            <button type="button" className="qz-ql-retry" onClick={retrySave}>
              Retry
            </button>
          </span>
        ) : savedAt ? (
          <span key={savedAt} className="qz-save-chip is-saved">
            <span aria-hidden>✓</span> Saved {savedTimeLabel(savedAt)}
          </span>
        ) : null}
      </span>
    );

    // Tri-state Publish (the v3 Continue pattern): blocked stays CLICKABLE
    // and opens the health popover with the jump-links — it never publishes
    // while blocking > 0 (same gate as canPublish; S1 folds validateQuiz).
    const blocking = healthReport.verdict.blocking;
    const publishBtnV2 =
      blocking > 0 ? (
        <button
          type="button"
          className="qz-btn qz-btn-sm qz-s3-continue is-blocked"
          aria-haspopup="dialog"
          onClick={() => setHealthOpen(true)}
        >
          Fix {blocking} issue{blocking === 1 ? "" : "s"}
        </button>
      ) : (
        <QzButton variant="primary" size="sm" disabled={isPublishing} onClick={publish}>
          {isPublishing ? "Publishing…" : "◆ Publish"}
        </QzButton>
      );

    // Transient outcomes only — validation + suggestions live in the pill now,
    // so a merely-unfinished quiz shows a clean canvas, not a nag banner.
    const standaloneNotices = (
      <>
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
      </>
    );

    return (
      <div className="qz-builder">
        <BuilderTopBar
          left={
            <>
              <div className="qz-builder-titlewrap">
                <EditableTitle name={data.name} onRename={renameQuiz} />
              </div>
              <span className="qz-badge" style={{ fontSize: 10, flex: "0 0 auto" }}>
                {XTYPE_LABEL[experienceTypeOf(doc)]}
              </span>
              {scoringBadge}
            </>
          }
          center={
            view === "build" ? (
              <>
                {deviceToggle}
                {zoomStepper}
                {editInteractToggle}
              </>
            ) : null
          }
          right={
            <>
              {saveStatusV2}
              {undoRedo}
              {healthPill}
              {/* QZY-6 — AI is a persistent top-bar companion, never a tab.
                  Full Assist design is spec-DEFERRED; this opens the existing
                  chat + review-enrich panels in context. */}
              <button
                type="button"
                className="qz-btn qz-btn-ghost qz-btn-sm"
                aria-pressed={assistOpen}
                onClick={() => setAssistOpen((v) => !v)}
              >
                ✦ Assist
              </button>
              {moreMenu}
              <a
                href={data.previewUrl}
                target="_blank"
                rel="noreferrer"
                className="qz-btn qz-btn-ghost qz-btn-sm"
              >
                Preview
              </a>
              {publishBtnV2}
            </>
          }
        />
        <div className="qz-builder-body">
          <BuilderNavRail
            active={railActive}
            onSelect={(key) => {
              if (key === "design") {
                setTool("theme");
                setView("build");
              } else if (key === "build") {
                setTool("editor");
                setView("build");
              } else {
                setView(key);
              }
            }}
          />
          {view === "build" ? (
            <>
              {libraryCollapsed ? null : (
                <aside className="qz-builder-panel">
                  <button type="button" className="qz-builder-panel-collapse" onClick={() => setLibraryCollapsed(true)} aria-label="Collapse component library">
                    <ChevronLeft size={15} aria-hidden />
                  </button>
                  {toolPanel}
                </aside>
              )}
              <div className="qz-builder-stage">
                {libraryCollapsed ? (
                  <button type="button" className="qz-builder-panel-reopen" onClick={() => setLibraryCollapsed(false)} aria-label="Open component library">
                    <ChevronRight size={15} aria-hidden /> <span>Library</span>
                  </button>
                ) : null}
                {/* QB-8 — slim notices strip (transient publish/reconcile results
                    only); empty = 0 height, so the canvas is just the live quiz. */}
                <div className="qz-builder-notices">{standaloneNotices}</div>
                <div
                  className={`qz-builder-canvas${blockDropActive ? " is-blockdrop" : ""}`}
                  onDoubleClick={onCanvasDoubleClick}
                  onDragOver={onCanvasDragOver}
                  onDragLeave={onCanvasDragLeave}
                  onDrop={onCanvasDrop}
                >
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
                {/* QZY-7 (build-tab §2) — the screen carousel, bottom of the
                    CENTER column only (never under the side panels). */}
                <ScreenCarousel
                  doc={doc}
                  ordered={ordered}
                  activeId={selectedId ?? liveNodeId}
                  onSelect={select}
                  onAddScreen={() => addQuestionScreen("single_select")}
                  confirmDeleteId={confirmDeleteId}
                  onConfirmDelete={setConfirmDeleteId}
                  onDelete={(nodeId) => {
                    commit(deleteNode(doc, nodeId));
                    setConfirmDeleteId(null);
                    select(null);
                  }}
                  onDuplicate={(nodeId) => {
                    const next = duplicateQuestionNode(doc, nodeId);
                    if (next !== doc) commit(next);
                  }}
                  productIndex={data.productIndex}
                  categories={data.categories}
                />
              </div>
              <aside className="qz-builder-inspector" aria-label="Step inspector">
                {inspector}
              </aside>
            </>
          ) : (
            <div className="qz-builder-settings">
              <div style={{ padding: "18px 22px", maxWidth: 1200, margin: "0 auto" }}>
                {standaloneNotices}
                {view === "products" ? (
                  <Step1Products {...stepProps} />
                ) : view === "results" ? (
                  // QZY-6 — off the rail (result screens edit in Build) but
                  // kept deep-linkable (?view=results) as the heavy editor.
                  <Step3Results
                    {...stepProps}
                    goToStep={(n) => setView(n === 1 ? "products" : "build")}
                  />
                ) : view === "settings" ? (
                  <QuizSettingsView
                    data={data}
                    doc={doc}
                    commit={commit}
                    onSelectNode={select}
                    selectedNodeId={selectedId}
                  />
                ) : (
                  // BLD-4 — the Logic view: LogicScroll for decider docs,
                  // LogicView for legacy; Try-a-path below.
                  <BuilderLogicView
                    data={data}
                    doc={doc}
                    commit={commit}
                    onSelectNode={select}
                  />
                )}
              </div>
            </div>
          )}
        </div>
        {upgradeModal}
        <QzDrawer
          open={assistOpen}
          onClose={() => setAssistOpen(false)}
          title="✦ Assist"
          width="440px"
        >
          <div style={{ display: "grid", gap: 14 }}>
            <AiChatPanel
              onApply={applyAi}
              onAiStart={beginAiEdit}
              onAiError={endAiEdit}
              selectedNodeId={selectedId}
            />
            <ReviewEnrichPanel
              onApply={applyAi}
              onAiStart={beginAiEdit}
              onAiError={endAiEdit}
              sources={doc.review_enrichment_sources}
            />
          </div>
        </QzDrawer>
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
        {saveStatus}
        <div className="qz-row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {scoringBadge}
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
      {upgradeModal}
    </QzPage>
  );
}
