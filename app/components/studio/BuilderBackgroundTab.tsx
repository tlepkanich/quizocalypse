import type { Quiz, QuizNode } from "../../lib/quizSchema";
import { readabilityHint, type ScreenBackground } from "../../lib/screenBackground";
import { resolveDesignTokens } from "../../lib/designTokens";
import { NumericControl } from "../controls/NumericControl";
import { BuilderPageSettings } from "./BuilderPageSettings";

// ════════════════════════════════════════════════════════════════════════════
// BuilderBackgroundTab (QZY-11, build-tab §8) — PER-SCREEN backgrounds:
// solid / 2-stop gradient / image / video, fit + focal point, overlay scrub,
// blur + fixed under More; "Apply to all screens" (confirmed); a non-blocking
// readability hint. The quiz-wide default stays in Design — a per-screen
// entry here wins. Video is ALWAYS muted (§8.2, not configurable); mobile
// defaults to the poster fallback.
// ════════════════════════════════════════════════════════════════════════════

type QuizDoc = Quiz;

const SWATCH_FALLBACK = resolveDesignTokens().colors?.background ?? "";

export function BuilderBackgroundTab({
  doc,
  node,
  commit,
}: {
  doc: QuizDoc;
  /** The screen being edited (the canvas's current step). */
  node: QuizNode | null;
  commit: (doc: QuizDoc) => void;
}) {
  if (!node) {
    return (
      <div className="qz-card" style={{ padding: 14 }}>
        <p className="qz-dim" style={{ fontSize: 12.5, margin: 0 }}>
          Select a screen in the carousel below to set its background.
        </p>
      </div>
    );
  }
  const bg: ScreenBackground = doc.node_backgrounds?.[node.id] ?? {};
  const write = (next: ScreenBackground | null) => {
    const map = { ...(doc.node_backgrounds ?? {}) };
    if (next && Object.keys(next).length > 0) map[node.id] = next;
    else delete map[node.id];
    if (Object.keys(map).length === 0) {
      const { node_backgrounds: _dropped, ...rest } = doc;
      commit(rest as QuizDoc);
    } else {
      commit({ ...doc, node_backgrounds: map });
    }
  };
  const patch = (p: Partial<ScreenBackground>) => {
    const next: Record<string, unknown> = { ...bg };
    for (const [k, v] of Object.entries(p)) {
      if (v === undefined) delete next[k];
      else next[k] = v;
    }
    write(next as ScreenBackground);
  };
  const applyToAll = () => {
    if (
      !window.confirm(
        "Apply this background to EVERY screen? Each screen's current background is replaced.",
      )
    )
      return;
    const map: NonNullable<QuizDoc["node_backgrounds"]> = {};
    for (const n of doc.nodes) map[n.id] = { ...bg };
    commit({ ...doc, node_backgrounds: map });
  };
  const hint = readabilityHint(bg);

  const colorField = (label: string, key: "color" | "color2") => (
    <label className="qz-ads-color">
      <span>{label}</span>
      <input
        type="color"
        value={bg[key] ?? SWATCH_FALLBACK}
        onChange={(e) => patch({ [key]: e.target.value })}
      />
    </label>
  );
  const urlField = (label: string, key: "image_url" | "video_url" | "poster_url") => (
    <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
      <span className="qz-dim" style={{ fontSize: 11.5 }}>
        {label}
      </span>
      <input
        className="qz-input"
        value={bg[key] ?? ""}
        placeholder="https://…"
        onChange={(e) => patch({ [key]: e.target.value.trim() || undefined })}
      />
    </label>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="qz-label" style={{ fontSize: 11 }}>
        Background — this screen
      </div>
      <div className="qz-segmented" role="group" aria-label="Background type">
        {(["none", "color", "gradient", "image", "video"] as const).map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={t === "none" ? bg.type === undefined : bg.type === t}
            onClick={() => (t === "none" ? write(null) : patch({ type: t }))}
          >
            {t === "none" ? "None" : t[0]!.toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {bg.type === "color" ? colorField("Color", "color") : null}
      {bg.type === "gradient" ? (
        <div className="qz-row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {colorField("From", "color")}
          {colorField("To", "color2")}
          <NumericControl
            label="Angle"
            value={bg.angle}
            min={0}
            max={360}
            step={5}
            fallback={135}
            allowEmpty
            suffix="°"
            onChange={(n) => patch({ angle: n })}
          />
        </div>
      ) : null}
      {bg.type === "image" ? urlField("Image URL", "image_url") : null}
      {bg.type === "video" ? (
        <>
          {urlField("Video URL (MP4/WebM)", "video_url")}
          {urlField("Poster frame", "poster_url")}
          <div className="qz-row" style={{ gap: 6, alignItems: "center" }}>
            <span className="qz-dim" style={{ fontSize: 11.5 }}>
              On mobile
            </span>
            <div className="qz-segmented" role="group" aria-label="Mobile video behavior">
              {(["poster", "play"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={(bg.mobile_video ?? "poster") === m}
                  onClick={() => patch({ mobile_video: m === "poster" ? undefined : m })}
                >
                  {m === "poster" ? "Show poster" : "Play video"}
                </button>
              ))}
            </div>
          </div>
          <p className="qz-dim" style={{ fontSize: 11.5, margin: 0 }}>
            Background video always plays muted (browser autoplay rules).
          </p>
        </>
      ) : null}
      {bg.type === "image" || bg.type === "video" ? (
        <>
          <div className="qz-row" style={{ gap: 6, alignItems: "center" }}>
            <span className="qz-dim" style={{ fontSize: 11.5 }}>
              Fit
            </span>
            <div className="qz-segmented" role="group" aria-label="Background fit">
              {(["cover", "contain", "tile"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={(bg.fit ?? "cover") === f}
                  disabled={f === "tile" && bg.type === "video"}
                  onClick={() => patch({ fit: f === "cover" ? undefined : f })}
                >
                  {f[0]!.toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="qz-row" style={{ gap: 8, flexWrap: "wrap" }}>
            <NumericControl
              label="Focal X"
              value={bg.focal_x}
              min={0}
              max={100}
              fallback={50}
              allowEmpty
              suffix="%"
              onChange={(n) => patch({ focal_x: n })}
            />
            <NumericControl
              label="Focal Y"
              value={bg.focal_y}
              min={0}
              max={100}
              fallback={50}
              allowEmpty
              suffix="%"
              onChange={(n) => patch({ focal_y: n })}
            />
          </div>
        </>
      ) : null}
      {bg.type ? (
        <>
          <NumericControl
            label="Overlay"
            value={bg.overlay}
            min={0}
            max={80}
            fallback={0}
            allowEmpty
            suffix="%"
            onChange={(n) => patch({ overlay: n })}
          />
          {hint ? (
            <p className="qz-dim" role="note" style={{ fontSize: 11.5, margin: 0 }}>
              💡 {hint}
            </p>
          ) : null}
          <details className="qz-insp-more" style={{ flex: "0 0 auto" }}>
            <summary>More options</summary>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
              <NumericControl
                label="Blur"
                value={bg.blur}
                min={0}
                max={20}
                fallback={0}
                allowEmpty
                suffix="px"
                onChange={(n) => patch({ blur: n })}
              />
              {bg.type === "image" ? (
                <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={Boolean(bg.fixed)}
                    onChange={(e) => patch({ fixed: e.target.checked || undefined })}
                  />
                  Fixed (doesn&rsquo;t scroll)
                </label>
              ) : null}
            </div>
          </details>
          <button
            type="button"
            className="qz-btn qz-btn-ghost qz-btn-sm"
            onClick={applyToAll}
          >
            Apply to all screens…
          </button>
        </>
      ) : null}
      <details className="qz-insp-more" style={{ flex: "0 0 auto" }}>
        <summary>Quiz-wide default (Design)</summary>
        <div style={{ marginTop: 8 }}>
          <p className="qz-dim" style={{ fontSize: 11.5, margin: "0 0 8px" }}>
            The default lives in Design; a per-screen background above wins.
          </p>
          <BuilderPageSettings doc={doc} commit={commit} />
        </div>
      </details>
    </div>
  );
}
