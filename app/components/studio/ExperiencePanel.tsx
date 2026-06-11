import { useMemo, useState } from "react";
import { experienceTypeOf, type ExperienceType, type Quiz } from "../../lib/quizSchema";
import { QzSelect } from "../qz";

// ════════════════════════════════════════════════════════════════════════════
// ExperiencePanel (E7) — the build workflow's home for everything the
// Experiences program added. Lives in the workspace right rail (above the
// AI chat) so the features are PART OF BUILDING, not buried in a popover:
//   · the experience type (editable — guard rails + analytics follow)
//   · the three theater toggles (recap / computing reveal / because-chips)
//   · a live checklist: chapters, reassurance lines, escape hatch, capture
//     step — each with a jump-to-node affordance so "add one" is one click.
// ════════════════════════════════════════════════════════════════════════════

const TYPE_META: Record<ExperienceType, { label: string; blurb: string }> = {
  product_match: { label: "Product match", blurb: "Recommends from your catalog — results required." },
  personality: { label: "Personality", blurb: "Persona reveal + products — results required." },
  lead_capture: { label: "Lead capture", blurb: "Qualify, then capture — an email gate is the point." },
  survey: { label: "Survey", blurb: "Answers are the outcome — no products needed." },
};

export function ExperiencePanel({
  doc,
  onCommit,
  onSelectNode,
}: {
  doc: Quiz;
  onCommit: (doc: Quiz) => void;
  onSelectNode: (nodeId: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const xtype = experienceTypeOf(doc);

  const stats = useMemo(() => {
    const questions = doc.nodes.filter(
      (n): n is Extract<Quiz["nodes"][number], { type: "question" }> => n.type === "question",
    );
    const results = doc.nodes.filter(
      (n): n is Extract<Quiz["nodes"][number], { type: "result" }> => n.type === "result",
    );
    const chaptered = questions.filter((q) => q.data.section_label?.trim());
    const reassured = questions.filter((q) => q.data.helper_text?.trim());
    const hatched = results.filter((r) => r.data.escape_hatch?.label && r.data.escape_hatch?.url);
    const hasCapture = doc.nodes.some((n) => n.type === "email_gate" || n.type === "integration");
    return {
      questions,
      results,
      chaptered,
      reassured,
      hatched,
      hasCapture,
      firstUnchaptered: questions.find((q) => !q.data.section_label?.trim()),
      firstUnreassured: questions.find((q) => !q.data.helper_text?.trim()),
      firstUnhatched: results.find((r) => !(r.data.escape_hatch?.label && r.data.escape_hatch?.url)),
    };
  }, [doc]);

  const toggle = (
    label: string,
    hint: string,
    checked: boolean,
    onChange: (v: boolean) => void,
  ) => (
    <label className="qz-row" style={{ gap: 8, alignItems: "flex-start", fontSize: 12.5, cursor: "pointer" }}>
      <input type="checkbox" style={{ marginTop: 2 }} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        <span className="qz-dim" style={{ display: "block", fontSize: 10.5 }}>{hint}</span>
      </span>
    </label>
  );

  const checkRow = (
    ok: boolean,
    label: string,
    action?: { text: string; nodeId: string | undefined },
  ) => (
    <div className="qz-row qz-row-between" style={{ fontSize: 12, alignItems: "baseline", gap: 8 }}>
      <span>
        <span style={{ marginRight: 6 }}>{ok ? "✓" : "○"}</span>
        {label}
      </span>
      {!ok && action?.nodeId ? (
        <button
          type="button"
          className="qz-btn qz-btn-ghost qz-btn-sm"
          style={{ fontSize: 11 }}
          onClick={() => onSelectNode(action.nodeId!)}
        >
          {action.text}
        </button>
      ) : null}
    </div>
  );

  return (
    <div className="qz-card" style={{ padding: 14, marginBottom: 16 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="qz-row qz-row-between"
        style={{ width: "100%", background: "none", border: "none", cursor: "pointer", padding: 0 }}
      >
        <strong style={{ fontSize: 14 }}>🎭 Experience</strong>
        <span className="qz-dim" style={{ fontSize: 12 }}>
          {TYPE_META[xtype].label} · {open ? "▲" : "▼"}
        </span>
      </button>

      {open ? (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <QzSelect
              value={xtype}
              onChange={(e) =>
                onCommit({ ...doc, experience_type: e.target.value as ExperienceType })
              }
            >
              {(Object.keys(TYPE_META) as ExperienceType[]).map((t) => (
                <option key={t} value={t}>
                  {TYPE_META[t].label}
                </option>
              ))}
            </QzSelect>
            <p className="qz-dim" style={{ fontSize: 11, margin: "6px 0 0" }}>
              {TYPE_META[xtype].blurb} Changing the type changes the guard rails and which
              numbers the analytics lead with.
            </p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {toggle(
              "Answer recap before results",
              '"Just making sure we\'re on track" — review + edit answers before the reveal',
              doc.show_recap ?? false,
              (v) => onCommit({ ...doc, show_recap: v }),
            )}
            {toggle(
              "Computing reveal",
              'A ~4s "weighing your answers" beat showing the REAL factors',
              doc.results_reveal === "computing",
              (v) => onCommit({ ...doc, results_reveal: v ? "computing" : undefined }),
            )}
            {toggle(
              '"Because you chose" chips',
              "Each product names the answers that earned it its spot",
              doc.show_match_reasons ?? false,
              (v) => onCommit({ ...doc, show_match_reasons: v }),
            )}
          </div>

          <div style={{ borderTop: "1px solid var(--qz-rule, #eee)", paddingTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
            {stats.questions.length > 0
              ? checkRow(
                  stats.chaptered.length === stats.questions.length && stats.questions.length > 0,
                  `Chapters ${stats.chaptered.length}/${stats.questions.length} questions`,
                  { text: "Add →", nodeId: stats.firstUnchaptered?.id },
                )
              : null}
            {stats.questions.length > 0
              ? checkRow(
                  stats.reassured.length > 0,
                  `Reassurance lines ${stats.reassured.length}/${stats.questions.length}`,
                  { text: "Add →", nodeId: stats.firstUnreassured?.id },
                )
              : null}
            {stats.results.length > 0
              ? checkRow(
                  stats.hatched.length === stats.results.length,
                  `Escape hatch ${stats.hatched.length}/${stats.results.length} result pages`,
                  { text: "Add →", nodeId: stats.firstUnhatched?.id },
                )
              : null}
            {xtype === "lead_capture"
              ? checkRow(stats.hasCapture, "Capture step (email gate or integration)", {
                  text: "View →",
                  nodeId: doc.nodes.find((n) => n.type === "intro")?.id,
                })
              : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
