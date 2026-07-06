// BIC-2 C2 — the LEGACY-ONLY funnel stages, extracted from Step1Funnel.tsx as
// PURE MOVES and lazy-loaded (React.lazy) by the shell: these stages are only
// reachable by pre-flip in-flight drafts parked on the retired stage keys
// ("goal", "configuring", "overview", "templates", "done"), so the active
// funnel path never downloads this chunk.
//   - GoalStage        — stage "goal" (goal + struggle capture; folded into Shape)
//   - TemplatesStage   — stages "templates"/"done" (the pre-Step-2 directions list)
//   - OverviewStage    — stage "overview" (the retired pre-generate review)
//   - BattleCardStage  — stage "configuring" (the tier-2 battle card + dial modules)
// Only the imports + the default-export dispatcher are new.
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { useFetcher } from "@remix-run/react";
import {
  QzCard,
  QzBadge,
  QzField,
  QzInput,
  QzSelect,
  QzTextarea,
  QzSegmented,
  QzTooltip,
  QzProgress,
  QzExpandCard,
  StagedProgress,
} from "../../qz";
import type {
  RichTemplateOption,
  DesignDials,
  RecDefaults,
  RecommendedGroup,
} from "../../../lib/quizSchema";
import { OOS_LABEL, XTYPE_LABEL, type ActionResult, type FunnelData } from "./stagesShared";

// The staged generation copy (Step 1 notes — "not a spinner"). S5 reuses these
// four beats for the detached full build's overlay.
const BUILD_STAGES = [
  "Reading your catalog",
  "Mapping your products",
  "Writing your questions",
  "Building your results page",
];

// ── Overview — review everything before the build (the new flow's tail) ───────
// A read-only summary of what we'll generate. "Generate quiz →" fires the SAME
// detached build (generate-build) the battle card used to trigger directly, so
// the build inputs are unchanged. In the re-sequenced flow this sits last before
// Generate (… → Design → Overview → Generate → the builder).
function OverviewStage({
  data,
  fetcher,
  pendingIntent,
}: {
  data: FunnelData;
  fetcher: ReturnType<typeof useFetcher<ActionResult>>;
  pendingIntent: string | null;
}) {
  const picked = data.pickedTemplate;
  const buckets = data.productGroups;
  const building = pendingIntent === "generate-build";

  const rows: Array<{ label: string; value: string }> = [
    { label: "Quiz name", value: picked?.quiz_name || data.name },
    {
      label: "Recommendations",
      value: buckets.length
        ? `${buckets.length} — ${buckets.map((b) => b.name).join(" · ")}`
        : "None yet",
    },
  ];
  if (picked) {
    rows.push({ label: "Questions", value: `~${picked.question_count}` });
    rows.push({ label: "Products per result", value: String(picked.rec_defaults.max_products) });
    rows.push({ label: "Out of stock", value: OOS_LABEL[picked.rec_defaults.oos_behavior] });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <QzCard style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div className="qz-label">Review</div>
          <h2 className="qz-h2" style={{ margin: 0 }}>Ready to build your quiz</h2>
          <p className="qz-dim" style={{ margin: 0, fontSize: 13 }}>
            Here’s what we’ll generate. Go back to change anything, or generate when it looks right.
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((r) => (
            <div
              key={r.label}
              className="qz-row qz-row-between"
              style={{ gap: 12, alignItems: "baseline" }}
            >
              <span className="qz-dim" style={{ fontSize: 12.5, minWidth: 160 }}>{r.label}</span>
              <span style={{ fontSize: 14, fontWeight: 500, textAlign: "right" }}>{r.value}</span>
            </div>
          ))}
        </div>
      </QzCard>
      <div className="qz-row" style={{ gap: 8 }}>
        <button
          type="button"
          className="qz-btn qz-btn-ghost"
          disabled={building}
          onClick={() => fetcher.submit({ intent: "to-design" }, { method: "post" })}
        >
          ← Back
        </button>
        <button
          type="button"
          className="qz-btn qz-btn-accent"
          disabled={building}
          onClick={() => fetcher.submit({ intent: "generate-build" }, { method: "post" })}
        >
          {building ? "Building…" : "Generate quiz →"}
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
  // Pre-fill the goal with the store-derived suggestion (built-in templates +
  // brand identity) so this stage is an approval, not a blank box. A previously
  // saved goal always wins over the suggestion.
  const [goal, setGoal] = useState(data.goal?.goal_text || data.suggestedGoal || "");
  const [struggle, setStruggle] = useState(data.goal?.struggle_text ?? "");
  const showingSuggestion =
    !data.goal?.goal_text && goal.length > 0 && goal.trim() === data.suggestedGoal.trim();
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
        {showingSuggestion ? (
          <div
            className="qz-dim"
            style={{ fontSize: 12, marginTop: -4, display: "flex", alignItems: "center", gap: 6 }}
          >
            <span aria-hidden>✨</span>
            <span>Pre-filled from your store — edit it or keep it as-is.</span>
          </div>
        ) : null}

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
        {data.templateOptions.map((opt, i) => {
          return (
            <QzExpandCard
              key={opt.id}
              title={opt.title}
              angle={opt.angle}
              defaultOpen={i === 0}
              badge={<QzBadge tone="draft">{XTYPE_LABEL[opt.experience_type] ?? opt.experience_type}</QzBadge>}
              footer={
                <div className="qz-row" style={{ gap: 10, flexWrap: "wrap", marginTop: 4 }}>
                  <button
                    type="button"
                    className="qz-btn qz-btn-accent qz-btn-sm"
                    disabled={picking}
                    onClick={() => fetcher.submit({ intent: "pick", optionId: opt.id }, { method: "post" })}
                  >
                    {picking ? "Building…" : "Build this quiz →"}
                  </button>
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

// ── Stage: Configuring (tier-2) — the BATTLE CARD: pick a template, fine-tune
// the high-level design dials + recommendation settings, then generate. Edits
// autosave (optimistic + debounce) to the picked_template working copy.
const LEVEL_OPTS: { value: "low" | "medium" | "high"; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Med" },
  { value: "high", label: "High" },
];
const LINE_OPTS: { value: "soft" | "sharp" | "rounded"; label: string }[] = [
  { value: "soft", label: "Soft" },
  { value: "rounded", label: "Rounded" },
  { value: "sharp", label: "Sharp" },
];
const LEVEL_LABEL: Record<"low" | "medium" | "high", string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};
const LINE_LABEL: Record<"soft" | "sharp" | "rounded", string> = {
  soft: "Soft",
  rounded: "Rounded",
  sharp: "Sharp",
};

function BattleCardStage({
  data,
  fetcher,
  pendingIntent,
}: {
  data: FunnelData;
  fetcher: ReturnType<typeof useFetcher<ActionResult>>;
  pendingIntent: string | null;
}) {
  const picked = data.pickedTemplate;
  const templates = data.richTemplates;
  const [expandedId, setExpandedId] = useState<string>(picked?.template_id ?? templates[0]?.id ?? "");
  const [optDials, setOptDials] = useState<DesignDials | null>(null);
  const [optRec, setOptRec] = useState<RecDefaults | null>(null);
  const [optName, setOptName] = useState<string | null>(null);
  const [optGroups, setOptGroups] = useState<RecommendedGroup[] | null>(null);
  const dialTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The 3-module deep-dive target: which dial + which disclosure level (2=educate,
  // 3=examples). null = closed (Module 1, the battle card, is always visible).
  const [moduleTarget, setModuleTarget] = useState<{ dial: keyof DesignDials; module: 2 | 3 } | null>(null);

  // Clear the optimistic overlays once the autosave write lands (server canonical).
  useEffect(() => {
    if (fetcher.state === "idle") {
      setOptDials(null);
      setOptRec(null);
      setOptName(null);
      setOptGroups(null);
    }
  }, [fetcher.state]);

  const expanded = templates.find((t) => t.id === expandedId) ?? templates[0];
  const isPicked = Boolean(picked && expanded && picked.template_id === expanded.id);
  const dials: DesignDials | undefined = isPicked && picked ? optDials ?? picked.design_dials : expanded?.dials;
  const rec: RecDefaults | undefined = isPicked && picked ? optRec ?? picked.rec_defaults : expanded?.rec_defaults;
  const name = isPicked && picked ? optName ?? picked.quiz_name : "";
  const groups: RecommendedGroup[] = isPicked && picked ? optGroups ?? picked.recommended_groups : [];

  const saveDials = (next: DesignDials) => {
    setOptDials(next);
    if (dialTimer.current) clearTimeout(dialTimer.current);
    dialTimer.current = setTimeout(
      () => fetcher.submit({ intent: "set-dials", dials: JSON.stringify(next) }, { method: "post" }),
      600,
    );
  };
  const saveRec = (next: RecDefaults) => {
    setOptRec(next);
    if (recTimer.current) clearTimeout(recTimer.current);
    recTimer.current = setTimeout(
      () => fetcher.submit({ intent: "set-rec", rec: JSON.stringify(next) }, { method: "post" }),
      600,
    );
  };
  const saveName = (v: string) => {
    setOptName(v);
    if (nameTimer.current) clearTimeout(nameTimer.current);
    nameTimer.current = setTimeout(() => {
      if (v.trim()) fetcher.submit({ intent: "set-name", name: v }, { method: "post" });
    }, 600);
  };
  // Toggles are discrete (no debounce) — fire immediately, reflect optimistically.
  const toggleGroup = (groupId: string, enabled: boolean) => {
    setOptGroups(groups.map((g) => (g.group_id === groupId ? { ...g, enabled } : g)));
    fetcher.submit({ intent: "toggle-group", groupId, enabled: String(enabled) }, { method: "post" });
  };
  const toggleProduct = (groupId: string, productId: string, enabled: boolean) => {
    setOptGroups(
      groups.map((g) => {
        if (g.group_id !== groupId) return g;
        const set = new Set(g.product_ids);
        if (enabled) set.add(productId);
        else set.delete(productId);
        return { ...g, product_ids: Array.from(set) };
      }),
    );
    fetcher.submit(
      { intent: "toggle-product", groupId, productId, enabled: String(enabled) },
      { method: "post" },
    );
  };

  if (!expanded || !dials || !rec) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <QzCard style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div className="qz-label">Step 3 of 3 · Template</div>
        <h2 className="qz-h2" style={{ margin: 0 }}>Pick a template and fine-tune it</h2>
        <p className="qz-dim" style={{ margin: 0 }}>
          Each is a different way to run your quiz. Select one, adjust the high-level dials, then
          generate the full thing.
        </p>
      </QzCard>

      {isPicked && picked ? (
        <QuizNameBar
          name={name}
          saving={fetcher.state !== "idle"}
          saved={picked.saved_as_template}
          onName={saveName}
          onSaveTemplate={() => fetcher.submit({ intent: "save-template" }, { method: "post" })}
        />
      ) : null}

      <TemplateRail
        templates={templates}
        expandedId={expanded.id}
        pickedId={picked?.template_id ?? null}
        onExpand={setExpandedId}
      />

      <BattleCard
        template={expanded}
        isPicked={isPicked}
        dials={dials}
        rec={rec}
        collections={data.collections}
        recommendedGroups={groups}
        productGroups={data.productGroups}
        onDials={saveDials}
        onRec={(patch) => saveRec({ ...rec, ...patch })}
        onToggleGroup={toggleGroup}
        onToggleProduct={toggleProduct}
        onPick={() => fetcher.submit({ intent: "pick-template", templateId: expanded.id }, { method: "post" })}
        onGenerate={() => fetcher.submit({ intent: "to-design" }, { method: "post" })}
        onDeepDive={(dial) => setModuleTarget({ dial, module: 2 })}
        picking={pendingIntent === "pick-template"}
        generating={pendingIntent === "to-design"}
      />

      {moduleTarget ? (
        <DialModule
          dial={moduleTarget.dial}
          module={moduleTarget.module}
          currentValue={dials[moduleTarget.dial]}
          onSeeExamples={() => setModuleTarget({ dial: moduleTarget.dial, module: 3 })}
          onApply={(v) => saveDials({ ...dials, [moduleTarget.dial]: v } as DesignDials)}
          onClose={() => setModuleTarget(null)}
        />
      ) : null}

      <div className="qz-row" style={{ gap: 10 }}>
        <button
          type="button"
          className="qz-btn qz-btn-ghost qz-btn-sm"
          onClick={() => fetcher.submit({ intent: "back-to-types" }, { method: "post" })}
        >
          ← Back to types
        </button>
      </div>
    </div>
  );
}

function QuizNameBar({
  name,
  saving,
  saved,
  onName,
  onSaveTemplate,
}: {
  name: string;
  saving: boolean;
  saved: boolean;
  onName: (v: string) => void;
  onSaveTemplate: () => void;
}) {
  return (
    <QzCard style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="qz-row qz-row-between" style={{ gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 240px" }}>
          <QzField label="Quiz name" hint="Auto-named from your template — edit it, but you never start blank.">
            <QzInput value={name} onChange={(e) => onName(e.target.value)} />
          </QzField>
        </div>
        <div className="qz-row" style={{ gap: 8, alignItems: "center" }}>
          {saving ? <span className="qz-mono qz-dim" style={{ fontSize: 11 }}>Saving…</span> : null}
          {saved ? (
            <QzBadge tone="ok">Saved as template</QzBadge>
          ) : (
            <button type="button" className="qz-btn qz-btn-sm" onClick={onSaveTemplate}>
              Save as template
            </button>
          )}
        </div>
      </div>
    </QzCard>
  );
}

function TemplateRail({
  templates,
  expandedId,
  pickedId,
  onExpand,
}: {
  templates: RichTemplateOption[];
  expandedId: string;
  pickedId: string | null;
  onExpand: (id: string) => void;
}) {
  return (
    <div className="qz-template-rail">
      {templates.map((t) => (
        <QzTooltip key={t.id} content={t.angle}>
          <button
            type="button"
            className={t.id === expandedId ? "qz-template-pill is-active" : "qz-template-pill"}
            onClick={() => onExpand(t.id)}
          >
            {pickedId === t.id ? <span aria-hidden>✓ </span> : null}
            {t.title}
          </button>
        </QzTooltip>
      ))}
    </div>
  );
}

function DialRow<T extends string>({
  label,
  options,
  value,
  displayLabel,
  isPicked,
  onChange,
  onDeepDive,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  displayLabel: string;
  isPicked: boolean;
  onChange: (v: T) => void;
  onDeepDive?: () => void;
}) {
  return (
    <div className="qz-dial-row">
      <span className="qz-dial-row-label">{label}</span>
      {isPicked ? (
        <QzSegmented options={options} value={value} onChange={onChange} ariaLabel={label} />
      ) : (
        <QzBadge tone="draft">{displayLabel}</QzBadge>
      )}
      {onDeepDive ? (
        <button
          type="button"
          className="qz-btn qz-btn-ghost qz-btn-sm qz-dial-info"
          aria-label={`What does ${label} mean?`}
          onClick={onDeepDive}
        >
          ⓘ
        </button>
      ) : null}
    </div>
  );
}

function BattleCard({
  template,
  isPicked,
  dials,
  rec,
  collections,
  recommendedGroups,
  productGroups,
  onDials,
  onRec,
  onToggleGroup,
  onToggleProduct,
  onPick,
  onGenerate,
  onDeepDive,
  picking,
  generating,
}: {
  template: RichTemplateOption;
  isPicked: boolean;
  dials: DesignDials;
  rec: RecDefaults;
  collections: Array<{ collectionId: string; title: string }>;
  recommendedGroups: RecommendedGroup[];
  productGroups: FunnelData["productGroups"];
  onDials: (next: DesignDials) => void;
  onRec: (patch: Partial<RecDefaults>) => void;
  onToggleGroup: (groupId: string, enabled: boolean) => void;
  onToggleProduct: (groupId: string, productId: string, enabled: boolean) => void;
  onPick: () => void;
  onGenerate: () => void;
  onDeepDive: (dial: keyof DesignDials) => void;
  picking: boolean;
  generating: boolean;
}) {
  return (
    <QzCard className="qz-battle-card">
      <div className="qz-battle-section qz-row qz-row-between" style={{ alignItems: "flex-start", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="qz-label">{template.question_count} questions</span>
          <h3 className="qz-h2" style={{ margin: 0 }}>{template.title}</h3>
          <p className="qz-muted" style={{ margin: 0, fontSize: 13.5 }}>{template.angle}</p>
        </div>
        <QzBadge tone="draft">{XTYPE_LABEL[template.experience_type] ?? template.experience_type}</QzBadge>
      </div>

      <div className="qz-battle-section">
        <div className="qz-label" style={{ marginBottom: 6 }}>What makes this template</div>
        <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
          {template.feature_notes.map((n, i) => (
            <li key={i} style={{ fontSize: 13.5 }}>{n}</li>
          ))}
        </ul>
      </div>

      <div className="qz-battle-section">
        <div className="qz-row qz-row-between" style={{ marginBottom: 8, alignItems: "center" }}>
          <span className="qz-label">Design dials</span>
          {isPicked ? <span className="qz-dim" style={{ fontSize: 11.5 }}>Tap ⓘ to see what each does</span> : null}
        </div>
        <DialRow
          label="Imagery"
          options={LEVEL_OPTS}
          value={dials.imagery}
          displayLabel={LEVEL_LABEL[dials.imagery]}
          isPicked={isPicked}
          onChange={(v) => onDials({ ...dials, imagery: v })}
          onDeepDive={isPicked ? () => onDeepDive("imagery") : undefined}
        />
        <DialRow
          label="Graphics"
          options={LEVEL_OPTS}
          value={dials.graphics}
          displayLabel={LEVEL_LABEL[dials.graphics]}
          isPicked={isPicked}
          onChange={(v) => onDials({ ...dials, graphics: v })}
          onDeepDive={isPicked ? () => onDeepDive("graphics") : undefined}
        />
        <DialRow
          label="Word-forward"
          options={LEVEL_OPTS}
          value={dials.word_forward}
          displayLabel={LEVEL_LABEL[dials.word_forward]}
          isPicked={isPicked}
          onChange={(v) => onDials({ ...dials, word_forward: v })}
          onDeepDive={isPicked ? () => onDeepDive("word_forward") : undefined}
        />
        <DialRow
          label="Lines"
          options={LINE_OPTS}
          value={dials.lines}
          displayLabel={LINE_LABEL[dials.lines]}
          isPicked={isPicked}
          onChange={(v) => onDials({ ...dials, lines: v })}
          onDeepDive={isPicked ? () => onDeepDive("lines") : undefined}
        />
      </div>

      <div className="qz-battle-section">
        <div className="qz-label" style={{ marginBottom: 8 }}>Recommendation</div>
        {isPicked ? (
          <div className="qz-row" style={{ gap: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
            <QzField label="Max products">
              <QzInput
                type="number"
                min={1}
                max={12}
                value={rec.max_products}
                onChange={(e) =>
                  onRec({ max_products: Math.max(1, Math.min(12, Number(e.target.valueAsNumber) || 3)) })
                }
                style={{ width: 90 }}
              />
            </QzField>
            <QzField label="Out of stock">
              <QzSelect
                value={rec.oos_behavior}
                onChange={(e) => onRec({ oos_behavior: e.target.value as RecDefaults["oos_behavior"] })}
              >
                <option value="show_with_badge">Show + badge</option>
                <option value="hide">Hide</option>
                <option value="fallback">Fallback collection</option>
              </QzSelect>
            </QzField>
            {rec.oos_behavior === "fallback" ? (
              <QzField label="Fallback collection">
                <QzSelect
                  value={rec.fallback_collection_id}
                  onChange={(e) => onRec({ fallback_collection_id: e.target.value })}
                >
                  <option value="">Best sellers (default)</option>
                  {collections.map((c) => (
                    <option key={c.collectionId} value={c.collectionId}>{c.title}</option>
                  ))}
                </QzSelect>
              </QzField>
            ) : null}
          </div>
        ) : (
          <div className="qz-row" style={{ gap: 8, flexWrap: "wrap" }}>
            <QzBadge tone="draft">Max {rec.max_products}</QzBadge>
            <QzBadge tone="draft">OOS: {OOS_LABEL[rec.oos_behavior]}</QzBadge>
          </div>
        )}
      </div>

      {isPicked ? (
        <RecProductsEditor
          groups={recommendedGroups}
          catalog={productGroups}
          onToggleGroup={onToggleGroup}
          onToggleProduct={onToggleProduct}
        />
      ) : null}

      <div
        className="qz-battle-section qz-row"
        style={{ gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}
      >
        {isPicked ? (
          <button type="button" className="qz-btn qz-btn-accent" disabled={generating} onClick={onGenerate}>
            {generating ? "Loading…" : "Continue →"}
          </button>
        ) : (
          <button type="button" className="qz-btn qz-btn-primary" disabled={picking} onClick={onPick}>
            {picking ? "Selecting…" : "Select this template"}
          </button>
        )}
      </div>
    </QzCard>
  );
}

// ── Recommended products (the battle card's "N Recommended Products" editor) ──
// The confirmed buckets render as toggle-chip groups; de-selections are template-
// scoped overrides on picked_template.recommended_groups (applied to the quiz's
// Category.productIds at build time, never mutating other quizzes). A disabled
// group gets no result page; a de-selected product drops from its bucket.
function RecProductsEditor({
  groups,
  catalog,
  onToggleGroup,
  onToggleProduct,
}: {
  groups: RecommendedGroup[];
  catalog: FunnelData["productGroups"];
  onToggleGroup: (groupId: string, enabled: boolean) => void;
  onToggleProduct: (groupId: string, productId: string, enabled: boolean) => void;
}) {
  const catalogById = useMemo(() => new Map(catalog.map((c) => [c.id, c])), [catalog]);
  if (groups.length === 0) return null;
  const enabledCount = groups.filter((g) => g.enabled).length;
  return (
    <div className="qz-battle-section">
      <div className="qz-row qz-row-between" style={{ alignItems: "baseline", marginBottom: 4 }}>
        <span className="qz-label">Recommended products</span>
        <span className="qz-dim" style={{ fontSize: 11.5 }}>
          {enabledCount} of {groups.length} group{groups.length === 1 ? "" : "s"} on
        </span>
      </div>
      <p className="qz-muted" style={{ margin: "0 0 10px", fontSize: 13 }}>
        Which product groups this quiz can recommend — and which items inside them. A group that's off
        won't get a result page.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {groups.map((g) => {
          const all = catalogById.get(g.group_id)?.products ?? [];
          const selected = new Set(g.product_ids);
          const onCount = all.length ? all.filter((p) => selected.has(p.id)).length : selected.size;
          return (
            <div key={g.group_id} className={g.enabled ? "qz-rec-group" : "qz-rec-group is-off"}>
              <label className="qz-rec-group-head">
                <input
                  type="checkbox"
                  checked={g.enabled}
                  onChange={(e) => onToggleGroup(g.group_id, e.target.checked)}
                />
                <span className="qz-rec-group-name">{g.group_name || "Group"}</span>
                <span className="qz-dim" style={{ fontSize: 11.5 }}>
                  {g.enabled ? (all.length ? `${onCount}/${all.length} products` : "on") : "off"}
                </span>
              </label>
              {g.enabled && all.length > 0 ? (
                <div className="qz-rec-chips">
                  {all.map((p) => {
                    const on = selected.has(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        className={on ? "qz-chip-toggle is-on" : "qz-chip-toggle"}
                        aria-pressed={on}
                        title={on ? `Remove ${p.title}` : `Add ${p.title}`}
                        onClick={() => onToggleProduct(g.group_id, p.id, !on)}
                      >
                        {p.title}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── The 3-module progressive disclosure ──────────────────────────────────────
// Module 1 is the battle card itself (always visible). Module 2 ("educate")
// explains what a dial does in plain language; Module 3 ("deep-dive") shows the
// live before/after gallery and lets the merchant apply a level inline. Both are
// rendered by DialModule below, keyed off the BattleCardStage's moduleTarget.

const DIAL_EDU: Record<keyof DesignDials, { label: string; what: string; deep: string }> = {
  imagery: {
    label: "Imagery",
    what: "How often product and lifestyle photos appear inside the question flow. High leans on image-led questions (photo answer tiles, a hero up top); Low keeps questions clean and text-only.",
    deep: "Higher imagery suits visual, browse-driven catalogs where shoppers pick by look. Lower imagery suits spec- or needs-driven shopping where photos distract from the decision. Compare a few questions below, then apply the level that fits.",
  },
  graphics: {
    label: "Graphics",
    what: "Decorative weight — answer icons/emoji, section chapters, and overall spacing. High feels chaptered, icon-rich, and airy; Low is compact and unadorned.",
    deep: "More graphics make a longer quiz feel friendly and guided; fewer keep a short quiz fast and serious. This also nudges the layout's breathing room.",
  },
  word_forward: {
    label: "Word-forward",
    what: "How much text each question carries. High adds explainer copy and reassuring helper text (great for considered, educational categories); Low keeps every question short and punchy.",
    deep: "Educational categories (supplements, skincare, gear) convert better when the quiz teaches as it asks. Impulse and visual categories do better with minimal copy that gets out of the way.",
  },
  lines: {
    label: "Lines",
    what: "The edge style used throughout the quiz — Soft (fully rounded), Rounded (gentle corners), or Sharp (square, precise).",
    deep: "Soft reads playful and approachable; Sharp reads precise and premium/clinical; Rounded sits in between. This maps to the corner radius on every card, button, and answer tile.",
  },
};

interface ExampleTile {
  value: string;
  label: string;
  q: string;
  answers: string[];
  hero: boolean;
  overrides: CSSProperties;
}

const SAMPLE_Q = "What's your skill level?";
const SAMPLE_A = ["Beginner", "Intermediate"];

// Each tile is a tiny quiz-card mock rendered from the live --qz-* tokens with a
// per-dial CSS-custom-property override — no screenshots, no AI, rebrands for free.
const DIAL_EXAMPLES: Record<keyof DesignDials, ExampleTile[]> = {
  imagery: [
    { value: "high", label: "High", q: SAMPLE_Q, answers: SAMPLE_A, hero: true, overrides: {} },
    { value: "medium", label: "Med", q: SAMPLE_Q, answers: SAMPLE_A, hero: true, overrides: { "--tile-hero-h": "20px" } as CSSProperties },
    { value: "low", label: "Low", q: SAMPLE_Q, answers: SAMPLE_A, hero: false, overrides: {} },
  ],
  graphics: [
    { value: "high", label: "High", q: "🏔️ " + SAMPLE_Q, answers: ["🟢 Beginner", "🔵 Intermediate"], hero: false, overrides: { "--tile-pad": "13px" } as CSSProperties },
    { value: "medium", label: "Med", q: SAMPLE_Q, answers: SAMPLE_A, hero: false, overrides: {} },
    { value: "low", label: "Low", q: SAMPLE_Q, answers: SAMPLE_A, hero: false, overrides: { "--tile-pad": "7px" } as CSSProperties },
  ],
  word_forward: [
    { value: "high", label: "High", q: "Tell us about your experience so we can tailor every pick", answers: ["I'm just starting out and want guidance", "I know my way around"], hero: false, overrides: {} },
    { value: "medium", label: "Med", q: SAMPLE_Q, answers: SAMPLE_A, hero: false, overrides: {} },
    { value: "low", label: "Low", q: "Your level?", answers: ["New", "Pro"], hero: false, overrides: {} },
  ],
  lines: [
    { value: "soft", label: "Soft", q: SAMPLE_Q, answers: SAMPLE_A, hero: false, overrides: { "--tile-radius": "999px" } as CSSProperties },
    { value: "rounded", label: "Rounded", q: SAMPLE_Q, answers: SAMPLE_A, hero: false, overrides: { "--tile-radius": "12px" } as CSSProperties },
    { value: "sharp", label: "Sharp", q: SAMPLE_Q, answers: SAMPLE_A, hero: false, overrides: { "--tile-radius": "0px" } as CSSProperties },
  ],
};

// Values are level/edge words ("low"/"soft"/…) — capitalize for display.
const dialDisplay = (value: string): string => (value ? value.charAt(0).toUpperCase() + value.slice(1) : value);

function DialModule({
  dial,
  module,
  currentValue,
  onSeeExamples,
  onApply,
  onClose,
}: {
  dial: keyof DesignDials;
  module: 2 | 3;
  currentValue: string;
  onSeeExamples: () => void;
  onApply: (value: string) => void;
  onClose: () => void;
}) {
  const edu = DIAL_EDU[dial];
  return (
    <QzCard className={module === 3 ? "qz-module-card qz-module-card--deep" : "qz-module-card"}>
      <div className="qz-row qz-row-between" style={{ alignItems: "flex-start", gap: 10 }}>
        <div>
          <div className="qz-label">
            {edu.label} · {module === 2 ? "What this does" : "See the difference"}
          </div>
          <p className="qz-muted" style={{ margin: "4px 0 0", fontSize: 13.5, lineHeight: 1.45 }}>
            {module === 2 ? edu.what : edu.deep}
          </p>
        </div>
        <button type="button" className="qz-btn qz-btn-ghost qz-btn-sm" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </div>

      {module === 2 ? (
        <div className="qz-row" style={{ gap: 12, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span className="qz-dim" style={{ fontSize: 12.5 }}>
            Currently: <strong>{dialDisplay(currentValue)}</strong>
          </span>
          <button type="button" className="qz-link-btn" onClick={onSeeExamples}>
            See examples →
          </button>
        </div>
      ) : (
        <DialExampleGallery dial={dial} currentValue={currentValue} onApply={onApply} />
      )}
    </QzCard>
  );
}

function DialExampleGallery({
  dial,
  currentValue,
  onApply,
}: {
  dial: keyof DesignDials;
  currentValue: string;
  onApply: (value: string) => void;
}) {
  const tiles = DIAL_EXAMPLES[dial];
  return (
    <div className="qz-example-gallery" style={{ marginTop: 12 }}>
      {tiles.map((t) => {
        const active = t.value === currentValue;
        return (
          <div key={t.value} className={active ? "qz-example-tile is-active" : "qz-example-tile"}>
            <div className="qz-tile-render" style={t.overrides}>
              {t.hero ? <div className="qz-tile-hero" aria-hidden="true" /> : null}
              <div className="qz-tile-q">{t.q}</div>
              <div className="qz-tile-answers">
                {t.answers.map((a, i) => (
                  <span key={i} className="qz-tile-chip">
                    {a}
                  </span>
                ))}
              </div>
            </div>
            <div className="qz-tile-cap">
              {active ? (
                <QzBadge tone="ok">Current · {t.label}</QzBadge>
              ) : (
                <button type="button" className="qz-link-btn" onClick={() => onApply(t.value)}>
                  Update to {t.label}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// The shell's lazy entry point — dispatches to the one legacy stage the draft
// is parked on, with exactly the same conditions the shell's dispatch used
// inline (only one can match; the rest render null, i.e. nothing).
export default function LegacyFunnelStages({
  stage,
  data,
  fetcher,
  pendingIntent,
}: {
  stage: FunnelData["stage"];
  data: FunnelData;
  fetcher: ReturnType<typeof useFetcher<ActionResult>>;
  pendingIntent: string | null;
}) {
  return (
    <>
      {stage === "goal" ? (
        <GoalStage data={data} fetcher={fetcher} pendingIntent={pendingIntent} />
      ) : null}
      {stage === "configuring" ? (
        <BattleCardStage data={data} fetcher={fetcher} pendingIntent={pendingIntent} />
      ) : null}
      {stage === "overview" ? (
        <OverviewStage data={data} fetcher={fetcher} pendingIntent={pendingIntent} />
      ) : null}
      {stage === "templates" || stage === "done" ? (
        <TemplatesStage data={data} fetcher={fetcher} pendingIntent={pendingIntent} />
      ) : null}
    </>
  );
}
