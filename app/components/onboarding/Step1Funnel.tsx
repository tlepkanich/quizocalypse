import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useFetcher } from "@remix-run/react";
import {
  QzPage,
  QzPageHeader,
  QzCard,
  QzBanner,
  QzBadge,
  QzField,
  QzTextarea,
  QzProgress,
  QzExpandCard,
  StagedProgress,
} from "../qz";
import type { TemplateOption } from "../../lib/quizSchema";

// Builder Re-work Step 1 — the shared, server-free creation funnel. Renders one
// of four stages off the draft's build_session and drives every transition
// through ONE fetcher (the nested route's action). Mirrors how BrandIdentityReview
// is shared verbatim by the studio + embedded brand routes; the embedded twin
// (S6) wraps this same component with an admin-backed loader.

// The loader's serialized shape (kept local to avoid a route⇄component type cycle).
export interface FunnelData {
  quizId: string;
  name: string;
  stage: "grouping" | "goal" | "generating" | "templates" | "done";
  minGoalChars: number;
  productCount: number;
  identitySummary: string | null;
  detection: {
    dimension: string;
    rationale: string;
    groups: Array<{ key: string; name: string; count: number }>;
  };
  confirmed: {
    dimension: string;
    confirmed_category_ids: string[];
    detected_rationale: string;
  } | null;
  goal: { goal_text: string; struggle_text: string } | null;
  templateOptions: TemplateOption[];
  pickedOptionId: string | null;
}

type ActionResult =
  | { intent: string; ok: boolean; error?: string }
  | { intent: "resync"; ok: boolean; error?: string };

// The staged generation copy (Step 1 notes — "not a spinner"). S5 reuses these
// four beats for the detached full build's overlay.
const BUILD_STAGES = [
  "Reading your catalog",
  "Mapping your products",
  "Writing your questions",
  "Building your results page",
];

const XTYPE_LABEL: Record<string, string> = {
  product_match: "Product match",
  personality: "Personality",
  lead_capture: "Lead capture",
  survey: "Survey",
};

export function Step1Funnel({ data }: { data: FunnelData }) {
  const fetcher = useFetcher<ActionResult>();
  const pendingIntent =
    fetcher.state !== "idle" ? String(fetcher.formData?.get("intent") ?? "") : null;
  const result = fetcher.state === "idle" ? fetcher.data ?? null : null;
  const errorMsg = result && result.ok === false ? result.error : null;

  return (
    <QzPage>
      <QzPageHeader
        eyebrow="AI-first setup · Step 1"
        title="Shape your quiz"
        subtitle={
          data.identitySummary
            ? data.identitySummary
            : "We read your catalog, group your products, and draft a few quiz directions to pick from."
        }
        actions={
          <Link to="/studio" className="qz-btn qz-btn-ghost qz-btn-sm">
            ← All quizzes
          </Link>
        }
      />

      <FunnelProgress stage={data.stage} />

      {errorMsg ? (
        <QzBanner tone="crit" title="That didn't go through">
          {errorMsg}
        </QzBanner>
      ) : null}

      {data.stage === "grouping" ? (
        <GroupingStage data={data} fetcher={fetcher} pendingIntent={pendingIntent} result={result} />
      ) : null}

      {data.stage === "goal" ? (
        <GoalStage data={data} fetcher={fetcher} pendingIntent={pendingIntent} />
      ) : null}

      {data.stage === "templates" || data.stage === "done" ? (
        <TemplatesStage data={data} fetcher={fetcher} pendingIntent={pendingIntent} />
      ) : null}
    </QzPage>
  );
}

// A slim three-dot stage indicator across the funnel.
function FunnelProgress({ stage }: { stage: FunnelData["stage"] }) {
  const order = ["grouping", "goal", "templates"];
  const labels: Record<string, string> = {
    grouping: "Group",
    goal: "Goal",
    templates: "Directions",
  };
  const activeKey = stage === "done" ? "templates" : stage;
  const activeIdx = order.indexOf(activeKey);
  return (
    <div className="qz-row" style={{ gap: 8, margin: "2px 0 18px", flexWrap: "wrap" }}>
      {order.map((k, i) => (
        <span
          key={k}
          className="qz-row"
          style={{ gap: 6, fontSize: 12.5, color: i <= activeIdx ? "var(--qz-ink)" : "var(--qz-ink-4)" }}
        >
          <span
            aria-hidden
            style={{
              width: 7,
              height: 7,
              borderRadius: 999,
              background: i <= activeIdx ? "var(--qz-accent)" : "var(--qz-ink-4)",
              opacity: i <= activeIdx ? 1 : 0.4,
            }}
          />
          {labels[k]}
          {i < order.length - 1 ? <span className="qz-dim" style={{ marginLeft: 2 }}>·</span> : null}
        </span>
      ))}
    </div>
  );
}

// ── Stage 1 — confirm how products group into recommendation buckets ─────────
function GroupingStage({
  data,
  fetcher,
  pendingIntent,
  result,
}: {
  data: FunnelData;
  fetcher: ReturnType<typeof useFetcher<ActionResult>>;
  pendingIntent: string | null;
  result: ActionResult | null;
}) {
  const allKeys = useMemo(() => data.detection.groups.map((g) => g.key), [data.detection.groups]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(allKeys));
  const [useAll, setUseAll] = useState(data.detection.dimension === "all");

  const isAllOnly = data.detection.dimension === "all" || data.detection.groups.length === 0;
  const confirming = pendingIntent === "confirm-grouping";
  const resyncing = pendingIntent === "resync";
  const resyncResult = result && result.intent === "resync" ? result : null;

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const submitConfirm = () => {
    const mode = isAllOnly || useAll ? "all" : "detected";
    fetcher.submit(
      { intent: "confirm-grouping", mode, selected: Array.from(selected).join(",") },
      { method: "post" },
    );
  };

  const submitResync = () => fetcher.submit({ intent: "resync" }, { method: "post" });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <QzCard style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div className="qz-label">Step 1 of 3 · Grouping</div>
        <h2 className="qz-h2" style={{ margin: 0 }}>
          Here&rsquo;s how we&rsquo;d group your {data.productCount} products
        </h2>
        <p className="qz-dim" style={{ margin: 0 }}>
          {data.detection.rationale}
        </p>
      </QzCard>

      {isAllOnly ? (
        <QzCard
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            borderColor: "var(--qz-accent)",
          }}
        >
          <div className="qz-row" style={{ gap: 8 }}>
            <span aria-hidden>🛍️</span>
            <strong>Recommend from all products</strong>
          </div>
          <p className="qz-dim" style={{ margin: 0, fontSize: 13 }}>
            We&rsquo;ll match shoppers across your whole catalog rather than into fixed
            buckets — the right call for a focused or still-growing range.
          </p>
        </QzCard>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {data.detection.groups.map((g) => {
              const on = !useAll && selected.has(g.key);
              return (
                <button
                  key={g.key}
                  type="button"
                  className="qz-card qz-interactive"
                  onClick={() => !useAll && toggle(g.key)}
                  disabled={useAll}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    textAlign: "left",
                    cursor: useAll ? "default" : "pointer",
                    opacity: useAll ? 0.5 : 1,
                    borderColor: on ? "var(--qz-accent)" : undefined,
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 20,
                      height: 20,
                      flex: "none",
                      borderRadius: 6,
                      border: `1.5px solid ${on ? "var(--qz-accent)" : "var(--qz-ink-4)"}`,
                      background: on ? "var(--qz-accent)" : "transparent",
                      color: "#fff",
                      display: "grid",
                      placeItems: "center",
                      fontSize: 13,
                    }}
                  >
                    {on ? "✓" : ""}
                  </span>
                  <span style={{ flex: "1 1 auto", fontWeight: 600 }}>{g.name}</span>
                  <span className="qz-dim" style={{ fontSize: 12 }}>
                    {g.count} product{g.count === 1 ? "" : "s"}
                  </span>
                </button>
              );
            })}
          </div>

          <label
            className="qz-row"
            style={{ gap: 8, fontSize: 13, cursor: "pointer", color: "var(--qz-ink-3)" }}
          >
            <input type="checkbox" checked={useAll} onChange={(e) => setUseAll(e.target.checked)} />
            Skip grouping — recommend from all {data.productCount} products instead
          </label>
        </>
      )}

      <div className="qz-row qz-row-between" style={{ gap: 10, flexWrap: "wrap" }}>
        <div className="qz-row" style={{ gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            className="qz-btn qz-btn-ghost qz-btn-sm"
            onClick={submitResync}
            disabled={resyncing}
          >
            {resyncing ? "Refreshing…" : "↻ Refresh catalog"}
          </button>
          {resyncResult ? (
            <span className="qz-dim" style={{ fontSize: 12 }}>
              {resyncResult.ok
                ? "Catalog refreshed — grouping updated."
                : "Couldn't refresh from here — open the embedded app once to reconnect."}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          className="qz-btn qz-btn-accent"
          onClick={submitConfirm}
          disabled={confirming || (!isAllOnly && !useAll && selected.size === 0)}
        >
          {confirming ? "Saving…" : "Looks right — continue →"}
        </button>
      </div>
    </div>
  );
}

// ── Stage 2 — capture the goal + the struggle (gated by a min-char fill) ─────
function GoalStage({
  data,
  fetcher,
  pendingIntent,
}: {
  data: FunnelData;
  fetcher: ReturnType<typeof useFetcher<ActionResult>>;
  pendingIntent: string | null;
}) {
  const [goal, setGoal] = useState(data.goal?.goal_text ?? "");
  const [struggle, setStruggle] = useState(data.goal?.struggle_text ?? "");
  const goalLen = goal.trim().length;
  const met = goalLen >= data.minGoalChars;
  const generating = pendingIntent === "save-goal";

  // Advance the staged beats while the generation request is in flight.
  const [beat, setBeat] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (generating) {
      setBeat(0);
      timer.current = setInterval(() => {
        setBeat((b) => Math.min(b + 1, BUILD_STAGES.length - 1));
      }, 5000);
    } else if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [generating]);

  if (generating) {
    return (
      <QzCard style={{ padding: 28, display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div className="qz-label">Drafting your quiz directions</div>
          <p className="qz-dim" style={{ margin: 0, fontSize: 13 }}>
            Reading your brand identity and catalog to propose a few distinct ways to
            run this quiz. About 20 seconds.
          </p>
        </div>
        <StagedProgress stages={BUILD_STAGES} active={beat} />
      </QzCard>
    );
  }

  const submit = () => {
    fetcher.submit({ intent: "save-goal", goal, struggle }, { method: "post" });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <QzCard style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div className="qz-label">Step 2 of 3 · Goal</div>
          <h2 className="qz-h2" style={{ margin: 0 }}>
            What is the goal of this quiz?
          </h2>
        </div>

        <QzField label="The quiz should help shoppers…">
          <QzTextarea
            rows={3}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="e.g. Help winter-sports shoppers pick the right board and gear for their skill level and riding style."
          />
        </QzField>
        <QzProgress
          value={goalLen}
          max={data.minGoalChars}
          label={
            met
              ? "Enough to work with — add more if you like."
              : `${goalLen}/${data.minGoalChars} characters — a sentence or two helps the AI.`
          }
        />

        <QzField
          label="What do customers struggle with when choosing? (optional)"
          hint="This feeds back into your brand identity so every future quiz remembers it."
        >
          <QzTextarea
            rows={2}
            value={struggle}
            onChange={(e) => setStruggle(e.target.value)}
            placeholder="e.g. Too many specs (flex, camber, sizing) and they can't tell what matters for them."
          />
        </QzField>
      </QzCard>

      <div className="qz-row qz-row-between" style={{ gap: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          className="qz-btn qz-btn-ghost qz-btn-sm"
          onClick={() => fetcher.submit({ intent: "back-to-grouping" }, { method: "post" })}
        >
          ← Back to grouping
        </button>
        <button type="button" className="qz-btn qz-btn-accent" onClick={submit} disabled={!met}>
          Draft quiz directions →
        </button>
      </div>
    </div>
  );
}

// ── Stage 3 — pick a direction (expandable AI-proposed cards) ────────────────
function TemplatesStage({
  data,
  fetcher,
  pendingIntent,
}: {
  data: FunnelData;
  fetcher: ReturnType<typeof useFetcher<ActionResult>>;
  pendingIntent: string | null;
}) {
  const picking = pendingIntent === "pick";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <QzCard style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div className="qz-label">Step 3 of 3 · Directions</div>
        <h2 className="qz-h2" style={{ margin: 0 }}>
          Pick a direction to build
        </h2>
        <p className="qz-dim" style={{ margin: 0 }}>
          Each is a different way to run your quiz. Choose one and we&rsquo;ll write the
          full thing — questions, logic, and result pages.
        </p>
      </QzCard>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {data.templateOptions.map((opt) => {
          const selected = data.pickedOptionId === opt.id;
          return (
            <QzExpandCard
              key={opt.id}
              title={opt.title}
              angle={opt.angle}
              defaultOpen={data.templateOptions.length <= 2 || selected}
              selected={selected}
              badge={<QzBadge tone="draft">{XTYPE_LABEL[opt.experience_type] ?? opt.experience_type}</QzBadge>}
              footer={
                <div className="qz-row" style={{ gap: 10, flexWrap: "wrap", marginTop: 4 }}>
                  <button
                    type="button"
                    className="qz-btn qz-btn-accent qz-btn-sm"
                    disabled={picking || selected}
                    onClick={() => fetcher.submit({ intent: "pick", optionId: opt.id }, { method: "post" })}
                  >
                    {selected ? "✓ Selected" : picking ? "Selecting…" : "Build this quiz →"}
                  </button>
                  {selected ? (
                    <span className="qz-dim" style={{ fontSize: 12 }}>
                      The full build wires up in the next step.
                    </span>
                  ) : null}
                </div>
              }
            >
              {opt.rationale ? (
                <p className="qz-muted" style={{ margin: 0, fontSize: 13.5 }}>
                  {opt.rationale}
                </p>
              ) : null}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div className="qz-label">Sample questions</div>
                <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
                  {opt.sample_questions.map((q, i) => (
                    <li key={i} style={{ fontSize: 13.5 }}>
                      {q}
                    </li>
                  ))}
                </ul>
              </div>
            </QzExpandCard>
          );
        })}
      </div>

      <div className="qz-row" style={{ gap: 10 }}>
        <button
          type="button"
          className="qz-btn qz-btn-ghost qz-btn-sm"
          onClick={() => fetcher.submit({ intent: "back-to-goal" }, { method: "post" })}
        >
          ← Revise the goal
        </button>
      </div>
    </div>
  );
}
