import { useContext, useState } from "react";
import type { Quiz } from "../../../lib/quizSchema";
import { isFreeformType } from "../../../lib/quizSchema";
import type { DesignTokensT } from "../../../lib/designTokens";
import { questionImagePosition } from "../../../lib/styleBar";
import type { stylesFor } from "../runtimeStyles";
import { useChrome } from "../chromeStrings";
import { RuntimeChromeContext } from "../runtimeContexts";
import { inspectAttrs, type InspectPart, type InspectTarget } from "../inspect";
import { answerLabel } from "../bits/answerLabel";
import { AnswerOptions } from "./AnswerOptions";
import { QuestionImage } from "../bits/QuestionImage";
import { TooltipChip } from "../bits/TooltipChip";
import { SkipLink, MinimalNav } from "../bits/nav";

type QuizDoc = Quiz;

function DropdownQuestion({
  node,
  onAdvance,
  styles,
  onInspect,
  inspectedTarget,
  qImgPos,
  region = false,
}: {
  node: Extract<QuizDoc["nodes"][number], { type: "question" }>;
  onAdvance: (answerIds: string[], handle: string | null) => void;
  styles: ReturnType<typeof stylesFor>;
  onInspect?: (target: InspectTarget) => void;
  inspectedTarget?: InspectTarget | null;
  qImgPos?: "none" | "top" | "side";
  region?: boolean;
}) {
  const tc = useChrome();
  const insp = (part: InspectPart, answerId?: string) =>
    inspectAttrs(onInspect, inspectedTarget, {
      nodeId: node.id,
      part,
      ...(answerId ? { answerId } : {}),
    });
  // BLD-7 — region mode (see QuestionView): no card shell / question header.
  const shell = region ? { display: "flex", flexDirection: "column" as const } : styles.card;
  const header = region ? null : (
    <>
      <QuestionImage url={node.data.image_url} position={qImgPos} />
      <h2 style={styles.h2} {...insp("question_text")}>{node.data.text}</h2>
      {node.data.helper_text ? (
        <p style={{ ...styles.muted, fontSize: "0.85em", marginTop: -6 }}>{node.data.helper_text}</p>
      ) : null}
    </>
  );
  const [sel, setSel] = useState("");
  const answer = node.data.answers.find((a) => a.id === sel);
  return (
    <div style={shell}>
      {header}
      <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 12 }}>
        <select
          value={sel}
          onChange={(e) => setSel(e.target.value)}
          aria-label={node.data.text}
          style={styles.selectInput}
        >
          <option value="">{tc("choose")}</option>
          {node.data.answers.map((a) => (
            <option key={a.id} value={a.id}>
              {answerLabel(a)}
            </option>
          ))}
        </select>
        <button
          style={{ ...styles.primaryBtn, opacity: answer ? 1 : 0.5 }}
          disabled={!answer}
          onClick={() => answer && onAdvance([answer.id], answer.edge_handle_id)}
        >
          Continue
        </button>
      </div>
    </div>
  );
}

export function QuestionView({
  node,
  onAdvance,
  onBack,
  canBack,
  styles,
  tokens,
  onTooltipView,
  onInspect,
  inspectedTarget,
  region = false,
}: {
  node: Extract<QuizDoc["nodes"][number], { type: "question" }>;
  onAdvance: (answerIds: string[], handle: string | null) => void;
  onBack?: () => void;
  canBack?: boolean;
  styles: ReturnType<typeof stylesFor>;
  tokens: DesignTokensT;
  onTooltipView?: (answerId: string) => void;
  onInspect?: (target: InspectTarget) => void;
  inspectedTarget?: InspectTarget | null;
  // BLD-7 — render only the interactive region (for the "answers" block).
  region?: boolean;
}) {
  // MQ — minimal chrome turns single-select into select-then-Next (a pending
  // pick highlights; an explicit Next commits) + a Back/Next nav row. Classic
  // keeps tap-to-advance. `minimal` gates every branch below.
  const minimal = useContext(RuntimeChromeContext) === "minimal";
  const tc = useChrome();
  // B6 — optional questions get a "Skip" affordance (advances with no answer).
  const skipLink =
    node.data.required === false ? (
      <SkipLink minimal={minimal} onSkip={() => onAdvance([], null)} label={tc("skip")} />
    ) : null;
  const [picked, setPicked] = useState<string | null>(null);
  const insp = (part: InspectPart, answerId?: string) =>
    inspectAttrs(onInspect, inspectedTarget, {
      nodeId: node.id,
      part,
      ...(answerId ? { answerId } : {}),
    });
  // Explicit answer-column override (editor revamp P3). Unset keeps the
  // responsive default from stylesFor (2-up desktop, 1-up mobile).
  // §4 question image position (top default / side / none) — drives QuestionImage.
  // Image-density renderer (owner-activated): a Minimal-leaning density hides
  // decorative question header images across all 8 question renderers; answer
  // images (image_tile/image_picker/swatch) are FUNCTIONAL and never gated,
  // and an EXPLICIT position token beats the gate (questionImagePosition).
  const qImgPos = questionImagePosition(
    tokens.style_bar?.image_density,
    tokens.question_image_position,
  );
  // BLD-7 — region mode: the "answers" smart block mounts this view minus the
  // card shell + question header (the layout's heading block owns the title);
  // region=false (every existing caller) renders byte-identically.
  const shell = region ? { display: "flex", flexDirection: "column" as const } : styles.card;
  const header = region ? null : (
    <>
      <QuestionImage url={node.data.image_url} position={qImgPos} />
      <h2 style={styles.h2} {...insp("question_text")}>{node.data.text}</h2>
      {node.data.helper_text ? (
        <p style={{ ...styles.muted, fontSize: "0.85em", marginTop: -6 }}>{node.data.helper_text}</p>
      ) : null}
    </>
  );
  const answerGrid = {
    ...(node.data.answer_columns
      ? {
          ...styles.answerGrid,
          gridTemplateColumns: `repeat(${node.data.answer_columns}, minmax(0, 1fr))`,
        }
      : styles.answerGrid),
    // §4 side image: the answer grid is a BFC, so clear the float and sit below
    // the floated image (the question text wraps beside it). No-op otherwise.
    ...(qImgPos === "side" ? { clear: "both" as const } : {}),
  };
  // B6 — scale config (range + endpoint labels). Falls back to today's defaults
  // so an unset quiz renders byte-identically.
  const sc = node.data.scale_config;
  const sliderMin = sc?.min ?? 0;
  const sliderMax = sc?.max ?? 100;
  const sliderMid = String(Math.round((sliderMin + sliderMax) / 2));
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  // Slider defaults to its midpoint so it's immediately submittable + shows a value.
  const [freeform, setFreeform] = useState(
    node.data.question_type === "slider" ? sliderMid : "",
  );
  const isMulti = node.data.question_type === "multi_select";
  const isFreeform = isFreeformType(node.data.question_type);

  if (isFreeform) {
    // Freeform input: the typed value becomes the answer text. We piggy-back
    // on the question's seed answer (answers[0]) so tag accumulation +
    // outbound edge routing stay identical to card questions.
    const seed = node.data.answers[0];
    const cfg = node.data.input_config;
    const placeholder = cfg?.placeholder ?? "";
    const maxLength = cfg?.max_length ?? 120;
    const inputType =
      node.data.question_type === "email"
        ? "email"
        : node.data.question_type === "numeric"
          ? "number"
          : node.data.question_type === "date"
            ? "date"
            : "text";
    const required = node.data.required;
    const value = freeform.trim();
    const canSubmit =
      !required ||
      (value.length > 0 &&
        (inputType !== "email" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)));
    return (
      <div style={shell}>
        {header}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSubmit || !seed) return;
            // Capture the typed value as the picked answer so it shows up in
            // merge tags and the path. The runtime persists step.answerIds
            // by id; here we use the seed answer's id.
            onAdvance([seed.id], seed.edge_handle_id);
            // (We don't yet persist the typed string — that lands in the
            // path-derived merge context via the seed answer's text. Future
            // phase: dedicated freeform_responses[] in the path.)
          }}
          style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 12 }}
        >
          {node.data.question_type === "slider" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <input
                type="range"
                aria-label={node.data.text}
                min={sliderMin}
                max={sliderMax}
                step={sc?.step}
                value={freeform || sliderMid}
                onChange={(e) => setFreeform(e.target.value)}
                style={{ width: "100%", cursor: "pointer", accentColor: "var(--qz-color-primary)" }}
              />
              {sc?.endpoint_label_min || sc?.endpoint_label_max ? (
                <div style={{ ...styles.muted, display: "flex", justifyContent: "space-between", fontSize: "0.8em" }}>
                  <span>{sc?.endpoint_label_min ?? sliderMin}</span>
                  <span>{sc?.endpoint_label_max ?? sliderMax}</span>
                </div>
              ) : null}
              <div style={{ textAlign: "center", fontWeight: 600, fontSize: 18 }}>
                {freeform || sliderMid}
              </div>
            </div>
          ) : (
            <input
              type={inputType}
              aria-label={node.data.text}
              value={freeform}
              onChange={(e) => setFreeform(e.target.value.slice(0, maxLength))}
              placeholder={placeholder}
              maxLength={maxLength}
              {...(node.data.question_type === "numeric"
                ? { min: sc?.min, max: sc?.max, step: sc?.step }
                : {})}
              autoFocus
              style={{
                ...styles.answerBtn,
                padding: "var(--qz-pad)",
                textAlign: "left",
                cursor: "text",
              }}
            />
          )}
          <button
            type="submit"
            style={{
              ...styles.primaryBtn,
              opacity: canSubmit ? 1 : 0.5,
            }}
            disabled={!canSubmit}
          >
            Continue
          </button>
        </form>
      </div>
    );
  }

  if (isMulti) {
    const selectedIds = Object.entries(checked)
      .filter(([, v]) => v)
      .map(([k]) => k);
    const max = node.data.max_selections;
    const min = node.data.min_selections;
    const tooMany = typeof max === "number" && selectedIds.length > max;
    const tooFew = typeof min === "number" && selectedIds.length < min;
    return (
      <div style={shell}>
        {header}
        {node.data.answer_display?.mode ? (
          // QZY-9 — a configured display mode swaps in the mode renderer;
          // clicking toggles the checkbox state (same commit semantics below).
          <AnswerOptions
            node={node}
            display={node.data.answer_display}
            selectedIds={new Set(selectedIds)}
            onPickAnswer={(a) => setChecked({ ...checked, [a.id]: !checked[a.id] })}
            insp={insp}
            onTooltipView={onTooltipView}
            styles={styles}
          />
        ) : (
        <div style={answerGrid}>
          {node.data.answers.map((a) => (
            <div key={a.id} style={{ position: "relative" }}>
              <label
                style={{
                  ...styles.answerBtn,
                  display: "flex",
                  gap: 12,
                  alignItems: "center",
                  borderColor: checked[a.id]
                    ? "var(--qz-color-primary)"
                    : "#00000022",
                }}
                {...insp("answer", a.id)}
              >
                <input
                  type="checkbox"
                  checked={!!checked[a.id]}
                  onChange={(e) =>
                    setChecked({ ...checked, [a.id]: e.target.checked })
                  }
                />
                {answerLabel(a)}
              </label>
              {a.tooltip_text ? (
                <TooltipChip text={a.tooltip_text} onReveal={() => onTooltipView?.(a.id)} />
              ) : null}
            </div>
          ))}
        </div>
        )}
        {minimal ? (
          <MinimalNav
            onBack={onBack}
            canBack={canBack}
            onNext={() => {
              const first = node.data.answers.find((a) => checked[a.id]);
              onAdvance(selectedIds, first ? first.edge_handle_id : null);
            }}
            nextEnabled={selectedIds.length > 0 && !tooMany && !tooFew}
          />
        ) : (
          <button
            style={{
              ...styles.primaryBtn,
              opacity: selectedIds.length === 0 || tooMany || tooFew ? 0.5 : 1,
            }}
            disabled={selectedIds.length === 0 || tooMany || tooFew}
            onClick={() => {
              const first = node.data.answers.find((a) => checked[a.id]);
              onAdvance(selectedIds, first ? first.edge_handle_id : null);
            }}
          >
            Next
            {tooMany ? ` (max ${max})` : tooFew ? ` (choose ${min}+)` : ""}
          </button>
        )}
        {skipLink}
      </div>
    );
  }

  // Searchable: same single-select semantics, but with a top search input
  // that substring-filters the answer list. Useful for long pickers (brand,
  // country, etc.) where scrolling 50+ buttons would be annoying.
  if (node.data.question_type === "searchable") {
    return (
      <SearchableQuestion
        node={node}
        onAdvance={onAdvance}
        styles={styles}
        onInspect={onInspect}
        inspectedTarget={inspectedTarget}
        qImgPos={qImgPos}
        region={region}
      />
    );
  }

  // ImagePicker: dense thumbnail grid. Each answer's image dominates with a
  // small caption underneath. Visual-first picking — like "which of these
  // styles feels right?".
  if (node.data.question_type === "image_picker") {
    return (
      <div style={shell}>
        {header}
        <div
          style={{
            marginTop: 20,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
            gap: 10,
          }}
        >
          {node.data.answers.map((a) => (
            <button
              key={a.id}
              style={{
                ...styles.answerBtn,
                padding: 6,
                textAlign: "center",
                display: "flex",
                flexDirection: "column",
                alignItems: "stretch",
                gap: 6,
              }}
              {...insp("answer", a.id)}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--qz-color-primary)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "#00000022";
              }}
              onClick={() => onAdvance([a.id], a.edge_handle_id)}
            >
              {a.image_url ? (
                <img
                  src={a.image_url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  style={{
                    width: "100%",
                    aspectRatio: "1 / 1",
                    objectFit: "cover",
                    borderRadius: "var(--qz-radius)",
                  }}
                />
              ) : (
                <div
                  style={{
                    width: "100%",
                    aspectRatio: "1 / 1",
                    background: "#00000010",
                    borderRadius: "var(--qz-radius)",
                  }}
                />
              )}
              <span style={{ fontSize: 12 }}>{answerLabel(a)}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Dropdown: a compact <select> for long single-choice lists.
  if (node.data.question_type === "dropdown") {
    return (
      <DropdownQuestion
        node={node}
        onAdvance={onAdvance}
        styles={styles}
        onInspect={onInspect}
        inspectedTarget={inspectedTarget}
        qImgPos={qImgPos}
        region={region}
      />
    );
  }

  // Rating / Likert scale: a single-select rendered as a compact horizontal row.
  if (node.data.question_type === "rating") {
    return (
      <div style={shell}>
        {header}
        <div
          role="group"
          aria-label={node.data.text}
          style={{ marginTop: 20, display: "flex", gap: 8, flexWrap: "wrap" }}
        >
          {sc?.endpoint_label_min ? (
            <span style={{ ...styles.muted, fontSize: "0.8em", alignSelf: "center", flex: "0 0 auto" }}>
              {sc.endpoint_label_min}
            </span>
          ) : null}
          {node.data.answers.map((a) => (
            <div
              key={a.id}
              style={{ position: "relative", flex: "1 1 auto", minWidth: 56, display: "flex" }}
            >
              <button
                title={a.tooltip_text ?? a.text}
                style={{ ...styles.answerBtn, flex: 1, minWidth: 0, textAlign: "center" }}
                {...insp("answer", a.id)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--qz-color-primary)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "#00000022";
                }}
                onClick={() => onAdvance([a.id], a.edge_handle_id)}
              >
                {answerLabel(a)}
              </button>
              {a.tooltip_text ? (
                <TooltipChip text={a.tooltip_text} onReveal={() => onTooltipView?.(a.id)} />
              ) : null}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Swatch picker: single-select rendered as circular colour / material swatches.
  if (node.data.question_type === "swatch") {
    return (
      <div style={shell}>
        {header}
        <div style={{ marginTop: 20, display: "flex", gap: 14, flexWrap: "wrap" }}>
          {node.data.answers.map((a) => (
            <div key={a.id} style={{ position: "relative" }}>
              <button
                title={a.tooltip_text ?? a.text}
                style={{
                  ...styles.answerBtn,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 6,
                  width: 92,
                  padding: 8,
                }}
                {...insp("answer", a.id)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--qz-color-primary)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "#00000022";
                }}
                onClick={() => onAdvance([a.id], a.edge_handle_id)}
              >
                <span
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: "50%",
                    border: "1px solid #00000022",
                    backgroundColor: "#00000010",
                    backgroundImage: a.image_url ? `url(${a.image_url})` : undefined,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }}
                />
                <span style={{ fontSize: 12, textAlign: "center" }}>{answerLabel(a)}</span>
              </button>
              {a.tooltip_text ? (
                <TooltipChip text={a.tooltip_text} onReveal={() => onTooltipView?.(a.id)} />
              ) : null}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // single_select / image_tile (default fall-through)
  const commitPicked = () => {
    const a = node.data.answers.find((x) => x.id === picked);
    if (a) onAdvance([a.id], a.edge_handle_id);
  };
  return (
    <div style={shell}>
      {header}
      {node.data.answer_display?.mode ? (
        // QZY-9 — mode renderer; the HOST keeps its semantics (classic
        // tap-to-advance, minimal pending-pick + Next).
        <AnswerOptions
          node={node}
          display={node.data.answer_display}
          selectedIds={new Set(picked ? [picked] : [])}
          onPickAnswer={(a) =>
            minimal ? setPicked(a.id) : onAdvance([a.id], a.edge_handle_id)
          }
          insp={insp}
          onTooltipView={onTooltipView}
          styles={styles}
        />
      ) : (
      <div style={answerGrid}>
        {node.data.answers.map((a) => {
          const isPicked = minimal && picked === a.id;
          return (
          <div key={a.id} style={{ position: "relative" }}>
          <button
            style={
              isPicked
                ? { ...styles.answerBtn, boxShadow: "inset 0 0 0 2px var(--qz-color-text)" }
                : styles.answerBtn
            }
            {...insp("answer", a.id)}
            onMouseEnter={
              minimal
                ? undefined
                : (e) => {
                    e.currentTarget.style.borderColor = "var(--qz-color-primary)";
                  }
            }
            onMouseLeave={
              minimal
                ? undefined
                : (e) => {
                    e.currentTarget.style.borderColor = "#00000022";
                  }
            }
            // Minimal: tap selects (pending) then Next commits; classic auto-advances.
            onClick={() => (minimal ? setPicked(a.id) : onAdvance([a.id], a.edge_handle_id))}
          >
            {a.video_url && (
              <video
                src={a.video_url}
                controls
                playsInline
                style={{
                  width: "100%",
                  maxHeight: 200,
                  borderRadius: "var(--qz-radius)",
                  marginBottom: 8,
                  display: "block",
                }}
              />
            )}
            {node.data.question_type === "image_tile" && a.image_url && (
              <img
                src={a.image_url}
                alt=""
                loading="lazy"
                decoding="async"
                style={{
                  width: "100%",
                  maxHeight: 200,
                  objectFit: "cover",
                  borderRadius: "var(--qz-radius)",
                  marginBottom: 8,
                }}
              />
            )}
            {answerLabel(a)}
          </button>
          {a.tooltip_text ? (
            <TooltipChip text={a.tooltip_text} onReveal={() => onTooltipView?.(a.id)} />
          ) : null}
          </div>
          );
        })}
      </div>
      )}
      {minimal ? (
        <MinimalNav
          onBack={onBack}
          canBack={canBack}
          onNext={commitPicked}
          nextEnabled={picked !== null}
        />
      ) : null}
      {skipLink}
    </div>
  );
  // (typescript exhaustiveness assist — unused but satisfies the tokens prop)
  void tokens;
}

// Substring-filtered single-select. Hoisted to its own component so the
// search state doesn't churn the parent.
function SearchableQuestion({
  node,
  onAdvance,
  styles,
  onInspect,
  inspectedTarget,
  qImgPos,
  region = false,
}: {
  node: Extract<QuizDoc["nodes"][number], { type: "question" }>;
  onAdvance: (answerIds: string[], handle: string | null) => void;
  styles: ReturnType<typeof stylesFor>;
  onInspect?: (target: InspectTarget) => void;
  inspectedTarget?: InspectTarget | null;
  qImgPos?: "none" | "top" | "side";
  region?: boolean;
}) {
  const tc = useChrome();
  const insp = (part: InspectPart, answerId?: string) =>
    inspectAttrs(onInspect, inspectedTarget, {
      nodeId: node.id,
      part,
      ...(answerId ? { answerId } : {}),
    });
  // BLD-7 — region mode (see QuestionView): no card shell / question header.
  const shell = region ? { display: "flex", flexDirection: "column" as const } : styles.card;
  const header = region ? null : (
    <>
      <QuestionImage url={node.data.image_url} position={qImgPos} />
      <h2 style={styles.h2} {...insp("question_text")}>{node.data.text}</h2>
      {node.data.helper_text ? (
        <p style={{ ...styles.muted, fontSize: "0.85em", marginTop: -6 }}>{node.data.helper_text}</p>
      ) : null}
    </>
  );
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? node.data.answers.filter((a) => a.text.toLowerCase().includes(needle))
    : node.data.answers;
  return (
    <div style={shell}>
      {header}
      <input
        type="text"
        aria-label={node.data.text}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={tc("search_placeholder")}
        autoFocus
        style={{
          ...styles.answerBtn,
          marginTop: 16,
          padding: "12px 14px",
          textAlign: "left",
          cursor: "text",
          fontSize: "var(--qz-base-size)",
        }}
      />
      <div
        style={{
          marginTop: 12,
          display: "grid",
          gap: 8,
          maxHeight: 360,
          overflowY: "auto",
          paddingRight: 4,
        }}
      >
        {filtered.length === 0 ? (
          <div
            style={{
              padding: 16,
              color: "var(--qz-color-muted)",
              fontSize: 13,
              textAlign: "center",
            }}
          >
            No matches for &ldquo;{query}&rdquo;.
          </div>
        ) : (
          filtered.map((a) => (
            <button
              key={a.id}
              style={{
                ...styles.answerBtn,
                padding: "10px 14px",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--qz-color-primary)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "#00000022";
              }}
              onClick={() => onAdvance([a.id], a.edge_handle_id)}
            >
              {answerLabel(a)}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
