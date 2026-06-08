import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "@remix-run/react";
import { QzBanner } from "../qz";
import type { Quiz as QuizDoc } from "../../lib/quizSchema";
import type { IndexedProduct } from "../../lib/recommendationEngine";
import type { BuilderCategory } from "../builder/stepProps";
import { setSlotWeight, setBranchMode, promoteAbWinner } from "../../lib/quizMutations";
import {
  membersFromCategories,
  toggleMembership,
  diffMembers,
  type MappingCategory,
} from "../../lib/productMapping";
import type { FunnelCounts } from "../../lib/abAnalytics";
import { RecommendationMap } from "./RecommendationMap";
import { ProductMappingTable } from "./ProductMappingTable";

// FOCUS #2 — the dual-view Logic workspace. Resizable 50/50 with a
// Both / Visual / Table toggle. Visual (HALF 1) = RecommendationMap; Table
// (HALF 2) = ProductMappingTable. LogicView owns the working bucket-membership
// (so both halves stay in sync before save) and persists membership id-stably
// via /api/categories/set-members; A/B weight + mode edits go through onCommit
// (the doc autosave).

type ViewMode = "both" | "visual" | "table";
type SaveState = "idle" | "saving" | "saved" | "error";
type SetMembersResponse = { ok: boolean; updated?: number; error?: string };

const SAVE_DEBOUNCE_MS = 700;
const idsKey = (cats: BuilderCategory[]) =>
  cats.map((c) => c.id).sort().join("|");

export interface LogicViewProps {
  quizId: string;
  doc: QuizDoc;
  onCommit: (doc: QuizDoc) => void;
  productIndex: IndexedProduct[];
  categories: BuilderCategory[];
  abAnalytics: Record<string, Record<string, FunnelCounts>>;
}

export function LogicView({
  quizId,
  doc,
  onCommit,
  productIndex,
  categories,
  abAnalytics,
}: LogicViewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("both");
  const [splitPct, setSplitPct] = useState(52);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [members, setMembers] = useState<Record<string, string[]>>(() =>
    membersFromCategories(categories),
  );
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const fetcher = useFetcher<SetMembersResponse>();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reseed local membership only when the BUCKET SET changes (Step-1 regroup
  // adds/removes buckets). A membership save that revalidates the loader keeps
  // the same ids, so local edits aren't clobbered.
  const bucketKey = idsKey(categories);
  useEffect(() => {
    setMembers(membersFromCategories(categories));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucketKey]);

  // Reflect the fetcher lifecycle into the save indicator.
  useEffect(() => {
    if (fetcher.state === "submitting" || fetcher.state === "loading") {
      setSaveState("saving");
    } else if (fetcher.state === "idle" && fetcher.data) {
      setSaveState(fetcher.data.ok ? "saved" : "error");
    }
  }, [fetcher.state, fetcher.data]);

  const workingCategories: BuilderCategory[] = useMemo(
    () => categories.map((c) => ({ ...c, productIds: members[c.id] ?? c.productIds })),
    [categories, members],
  );

  const mappingCategories: MappingCategory[] = workingCategories;

  const dirty = useMemo(
    () => Object.keys(diffMembers(categories, members)).length > 0,
    [categories, members],
  );

  const selectedCategoryId = useMemo(() => {
    if (!selectedNodeId) return null;
    const node = doc.nodes.find((n) => n.id === selectedNodeId);
    return node && node.type === "result" ? node.data.category_id ?? null : null;
  }, [doc.nodes, selectedNodeId]);

  function scheduleSave(nextMembers: Record<string, string[]>) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const changed = diffMembers(categories, nextMembers);
      if (Object.keys(changed).length === 0) return;
      fetcher.submit(
        { quizId, members: JSON.stringify(changed) },
        { method: "POST", action: "/api/categories/set-members" },
      );
    }, SAVE_DEBOUNCE_MS);
  }

  function handleToggle(categoryId: string, productId: string) {
    setMembers((prev) => {
      const next = toggleMembership(prev, categoryId, productId);
      scheduleSave(next);
      return next;
    });
  }

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  // Divider drag (Both mode).
  function startDrag(e: React.PointerEvent) {
    e.preventDefault();
    const onMove = (ev: PointerEvent) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const next = ((ev.clientX - rect.left) / rect.width) * 100;
      setSplitPct(Math.min(75, Math.max(25, next)));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const showVisual = viewMode !== "table";
  const showTable = viewMode !== "visual";

  const map = (
    <RecommendationMap
      doc={doc}
      productIndex={productIndex}
      categories={workingCategories}
      abAnalytics={abAnalytics}
      selectedNodeId={selectedNodeId}
      onSelectNode={(id) => setSelectedNodeId((cur) => (cur === id ? null : id))}
      onSetWeight={(branchId, slotId, weight) =>
        onCommit(setSlotWeight(doc, branchId, slotId, weight))
      }
      onPromote={(branchId, slotId) =>
        onCommit(promoteAbWinner(doc, branchId, slotId))
      }
      onConvertToAb={(branchId) => onCommit(setBranchMode(doc, branchId, "ab_split"))}
    />
  );
  const table = (
    <ProductMappingTable
      productIndex={productIndex}
      categories={mappingCategories as BuilderCategory[]}
      resultNodes={doc.nodes}
      selectedCategoryId={selectedCategoryId}
      onToggle={handleToggle}
      saveState={saveState}
      dirty={dirty}
    />
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="qz-row qz-row-between" style={{ alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 className="qz-h1" style={{ margin: 0 }}>
            Logic &amp; recommendations
          </h2>
          <p className="qz-dim" style={{ marginTop: 6, maxWidth: 560 }}>
            See every recommendation page and its variations, map products into the buckets that feed them,
            and run A/B tests — all in one view.
          </p>
        </div>
        <div className="qz-row" style={{ gap: 4 }}>
          {(["both", "visual", "table"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setViewMode(m)}
              className={`qz-btn qz-btn-sm${viewMode === m ? " qz-btn-primary" : " qz-btn-ghost"}`}
            >
              {m === "both" ? "Both" : m === "visual" ? "Visual" : "Table"}
            </button>
          ))}
        </div>
      </div>

      {saveState === "error" && fetcher.data?.error ? (
        <QzBanner tone="crit" title="Couldn't save mapping">
          {fetcher.data.error}
        </QzBanner>
      ) : saveState === "saved" ? (
        <QzBanner tone="default" title="Mapping saved">
          Re-publish to push the updated product mapping to your live quiz.
        </QzBanner>
      ) : null}

      {viewMode === "both" ? (
        <div ref={containerRef} style={{ display: "flex", alignItems: "stretch", gap: 0, minWidth: 0 }}>
          <div style={{ width: `${splitPct}%`, minWidth: 0, paddingRight: 14 }}>{map}</div>
          <div
            role="separator"
            aria-orientation="vertical"
            onPointerDown={startDrag}
            style={{
              width: 8,
              flex: "0 0 auto",
              cursor: "col-resize",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div style={{ width: 3, height: 48, borderRadius: 3, background: "color-mix(in srgb, var(--qz-ink) 20%, transparent)" }} />
          </div>
          <div style={{ width: `${100 - splitPct}%`, minWidth: 0, paddingLeft: 14 }}>{table}</div>
        </div>
      ) : (
        <div style={{ minWidth: 0 }}>{showVisual ? map : null}{showTable ? table : null}</div>
      )}
    </div>
  );
}
