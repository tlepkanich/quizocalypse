import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "@remix-run/react";
import { QzBanner } from "../qz";
import type { Quiz as QuizDoc } from "../../lib/quizSchema";
import type { IndexedProduct } from "../../lib/recommendationEngine";
import type { BuilderCategory } from "../builder/stepProps";
import { setSlotWeight, promoteAbWinner } from "../../lib/quizMutations";
import {
  membersFromCategories,
  toggleMembership,
  diffMembers,
} from "../../lib/productMapping";
import { findAbBranches, type FunnelCounts } from "../../lib/abAnalytics";
import { orderFlow } from "../../lib/flowOrder";
import { LogicFlowMap } from "./LogicFlowMap";
import { PathTester } from "./PathTester";
import { AbTestCard } from "./AbTestCard";
import { ProductMappingTable } from "./ProductMappingTable";

// ════════════════════════════════════════════════════════════════════════════
// Logic view (design refinement D2) — ONE scrolling column, three sections:
//   §1 How shoppers flow   — the LogicFlowMap (the overview Octane lacks)
//   §2 Try a path          — PathTester(s) with the "why" trace; add a second
//                            tester to SEE two paths produce different results
//   §3 Products per page   — the mapping matrix (tag-first bulk mapping)
// plus a Logic-health strip of lint chips. The old dual-pane splitter and
// Both/Visual/Table toggle are gone — sections scroll, each full-width.
// LogicView still owns working bucket membership (debounce-saved id-stably
// via /api/categories/set-members); A/B edits go through onCommit.
// ════════════════════════════════════════════════════════════════════════════

type SaveState = "idle" | "saving" | "saved" | "error";
type SetMembersResponse = { ok: boolean; updated?: number; error?: string };

const SAVE_DEBOUNCE_MS = 700;

// Where each A/B slot routes (mirrors the retired RecommendationMap helper).
function slotTargetsFor(doc: QuizDoc, branch: ReturnType<typeof findAbBranches>[number]) {
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const out: Record<string, { label: string; nodeId: string | null }> = {};
  for (const slot of branch.data.slots) {
    const edge = doc.edges.find((e) => e.source === branch.id && e.source_handle === slot.id);
    const target = edge ? byId.get(edge.target) : undefined;
    out[slot.id] = {
      label: target
        ? target.type === "result"
          ? target.data.headline || "Result"
          : target.type.replace(/_/g, " ")
        : "Not wired",
      nodeId: target?.id ?? null,
    };
  }
  return out;
}
const idsKey = (cats: BuilderCategory[]) => cats.map((c) => c.id).sort().join("|");

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
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [members, setMembers] = useState<Record<string, string[]>>(() =>
    membersFromCategories(categories),
  );
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const fetcher = useFetcher<SetMembersResponse>();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mappingRef = useRef<HTMLDivElement | null>(null);

  // Reseed local membership only when the BUCKET SET changes (Step-1 regroup
  // adds/removes buckets). A membership save that revalidates the loader keeps
  // the same ids, so local edits aren't clobbered.
  const bucketKey = idsKey(categories);
  useEffect(() => {
    setMembers(membersFromCategories(categories));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucketKey]);

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

  // ── Logic health (lint chips from already-computed data) ──────────────────
  const health = useMemo(() => {
    const flow = orderFlow(doc);
    const unreachable = doc.nodes.filter(
      (n) => n.type === "result" && flow.orphans.includes(n.id),
    ).length;
    const emptyBuckets = workingCategories.filter((c) => c.productIds.length === 0).length;
    let untagged = 0;
    for (const n of doc.nodes) {
      if (n.type !== "question") continue;
      for (const a of n.data.answers) {
        const hasPoints = a.points && Object.keys(a.points).length > 0;
        if (a.tags.length === 0 && !hasPoints) untagged += 1;
      }
    }
    return { unreachable, emptyBuckets, untagged };
  }, [doc, workingCategories]);
  const healthChips = [
    health.unreachable > 0 && { label: `${health.unreachable} unreachable result page${health.unreachable > 1 ? "s" : ""}`, tone: "warn" },
    health.emptyBuckets > 0 && { label: `${health.emptyBuckets} empty bucket${health.emptyBuckets > 1 ? "s" : ""}`, tone: "warn" },
    health.untagged > 0 && { label: `${health.untagged} answer${health.untagged > 1 ? "s" : ""} without tags or points`, tone: "dim" },
  ].filter(Boolean) as Array<{ label: string; tone: string }>;

  const abBranches = useMemo(() => findAbBranches(doc), [doc]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 1080 }}>
      <div>
        <h2 className="qz-h1" style={{ margin: 0 }}>
          Logic &amp; recommendations
        </h2>
        <p className="qz-dim" style={{ marginTop: 6, maxWidth: 620 }}>
          See how every path flows to a result page, test a journey to understand exactly why
          each product appears, and map products into the buckets that feed each page.
        </p>
        {healthChips.length > 0 ? (
          <div className="qz-row" style={{ gap: 6, flexWrap: "wrap", marginTop: 10 }}>
            {healthChips.map((c) => (
              <span
                key={c.label}
                className="qz-badge"
                style={{
                  fontSize: 11,
                  ...(c.tone === "warn"
                    ? { background: "color-mix(in srgb, #d9822b 14%, transparent)" }
                    : {}),
                }}
              >
                {c.tone === "warn" ? "⚠ " : ""}
                {c.label}
              </span>
            ))}
          </div>
        ) : (
          <div className="qz-row" style={{ gap: 6, marginTop: 10 }}>
            <span className="qz-badge" style={{ fontSize: 11 }}>✓ logic healthy</span>
          </div>
        )}
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

      {/* §1 — the flow map */}
      <LogicFlowMap
        doc={doc}
        categories={workingCategories}
        selectedNodeId={selectedNodeId}
        onSelectResult={(id) => {
          setSelectedNodeId((cur) => (cur === id ? null : id));
          mappingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
      />

      {/* A/B tests fold under the map when present */}
      {abBranches.length > 0 ? (
        <details className="qz-card" style={{ padding: 14 }} open>
          <summary className="qz-label" style={{ cursor: "pointer" }}>
            A/B tests ({abBranches.length})
          </summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
            {abBranches.map((b) => (
              <AbTestCard
                key={b.id}
                branch={b}
                funnel={abAnalytics[b.id]}
                slotTargets={slotTargetsFor(doc, b)}
                onSetWeight={(slotId, weight) => onCommit(setSlotWeight(doc, b.id, slotId, weight))}
                onPromote={(slotId) => onCommit(promoteAbWinner(doc, b.id, slotId))}
              />
            ))}
          </div>
        </details>
      ) : null}

      {/* §2 — try a path (and see why); add a second tester to COMPARE */}
      <div style={{ display: "grid", gridTemplateColumns: compareOpen ? "1fr 1fr" : "1fr", gap: 12 }}>
        <PathTester doc={doc} productIndex={productIndex} categories={workingCategories} />
        {compareOpen ? (
          <PathTester doc={doc} productIndex={productIndex} categories={workingCategories} />
        ) : null}
      </div>
      <div>
        <button
          type="button"
          className="qz-btn qz-btn-ghost qz-btn-sm"
          onClick={() => setCompareOpen((o) => !o)}
        >
          {compareOpen ? "Hide comparison" : "⇄ Compare another path"}
        </button>
      </div>

      {/* §3 — the mapping matrix */}
      <div ref={mappingRef}>
        <ProductMappingTable
          productIndex={productIndex}
          categories={workingCategories}
          resultNodes={doc.nodes}
          selectedCategoryId={selectedCategoryId}
          onToggle={handleToggle}
          saveState={saveState}
          dirty={dirty}
        />
      </div>
    </div>
  );
}
