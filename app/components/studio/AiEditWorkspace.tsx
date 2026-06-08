import { useMemo, useState } from "react";
import { Link, useFetcher } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import { Step5Preview } from "../builder/Step5Preview";
import type { StepProps } from "../builder/stepProps";
import { QzPage, QzPageHeader, QzButton, QzBanner } from "../qz";
import { validateQuiz, type NodeIssue } from "../../lib/quizValidation";
import { orderFlow } from "../../lib/flowOrder";
import type { Quiz } from "../../lib/quizSchema";
import type { StudioBuilderData } from "./StudioBuilder";
import { useQuizDraft } from "./useQuizDraft";
import { AiChatPanel } from "./AiChatPanel";

// Dev Spec Phase 4 placement options. The standalone /q/:id is always a full
// page; popup/inline/product_widget are honored by the Theme App Extension.
type Placement = NonNullable<Quiz["placement"]>;
const PLACEMENTS: Array<{ value: Placement; label: string; hint: string }> = [
  { value: "page", label: "Dedicated page", hint: "share the link above, or add the App Block to any page." },
  { value: "popup", label: "Popup", hint: "add the Quizocalypse App Block and set it to open as a modal." },
  { value: "inline", label: "Inline embed", hint: "drop the App Block into a page section to embed it in-flow." },
  { value: "product_widget", label: "Product page widget", hint: "add the App Block to your product template as a compact launcher." },
];

// Copy-to-clipboard for the published quiz link (Phase E shareable surface).
function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="qz-btn qz-btn-ghost qz-btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          // clipboard blocked — the link above is still selectable
        }
      }}
    >
      {copied ? "Copied ✓" : "Copy link"}
    </button>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// AiEditWorkspace — the AI-FIRST default editing surface (Dev Spec): a live,
// interactive quiz preview beside an inline AI chat. It reuses the exact same
// preview as the builder's Step 4 (Step5Preview → QuizRuntime mode="preview"
// with live draft recommendations) and the same autosave/publish plumbing, so
// it's purely additive. The full visual builder + logic tools remain one click
// away via "Advanced builder" (?mode=advanced → StudioBuilder). Server-free —
// renders in both the embedded and standalone surfaces.
// ════════════════════════════════════════════════════════════════════════════

type Chrome = "embedded" | "standalone";

export function AiEditWorkspace({ data, chrome }: { data: StudioBuilderData; chrome: Chrome }) {
  if (!data.valid || !data.doc) {
    return (
      <QzPage>
        {chrome === "embedded" ? <TitleBar title="AI editor" /> : null}
        <QzPageHeader eyebrow="AI quiz editor" title={data.name} />
        <QzBanner tone="crit" title="This quiz's draft JSON failed validation">
          The AI editor needs a valid draft.{" "}
          <Link to="?mode=advanced">Open the advanced builder</Link> to repair it.
        </QzBanner>
      </QzPage>
    );
  }
  return <AiWorkspaceShell key={data.quizId} data={data} chrome={chrome} />;
}

function AiWorkspaceShell({ data, chrome }: { data: StudioBuilderData; chrome: Chrome }) {
  const { doc, commit, isSaving, savedAt } = useQuizDraft(data.doc as Quiz);
  const publishFetcher = useFetcher<{ ok: boolean; version?: number; error?: string }>();

  const allIssues = useMemo<NodeIssue[]>(() => validateQuiz(doc), [doc]);
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
  const placement: Placement = doc.placement ?? "page";
  const currentPlacement = PLACEMENTS.find((p) => p.value === placement) ?? PLACEMENTS[0]!;

  const publish = () => {
    const form = new FormData();
    form.set("intent", "publish");
    publishFetcher.submit(form, { method: "POST" });
  };

  // Same StepProps the 4-step builder passes to Step5Preview. goToStep is a
  // no-op here (there are no steps in AI mode — the chat replaces them).
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

  return (
    <QzPage>
      {chrome === "embedded" ? <TitleBar title={`AI · ${data.name}`} /> : null}
      <QzPageHeader eyebrow="AI quiz editor" title={data.name} />

      <div
        className="qz-row qz-row-between"
        style={{ alignItems: "center", marginBottom: 16, gap: 12, flexWrap: "wrap" }}
      >
        <span className="qz-dim" style={{ fontSize: 12 }}>
          {isSaving ? "Saving…" : savedAt ? "Saved" : ""}
        </span>
        <div className="qz-row" style={{ gap: 8, alignItems: "center" }}>
          <label className="qz-row" style={{ gap: 6, alignItems: "center", fontSize: 12 }}>
            <span className="qz-dim">Placement</span>
            <select
              value={placement}
              onChange={(e) => commit({ ...doc, placement: e.target.value as Placement })}
              title="How this quiz appears on your storefront"
              style={{
                font: "inherit",
                fontSize: 12,
                padding: "4px 6px",
                borderRadius: "var(--qz-radius)",
                border: "1px solid #00000022",
              }}
            >
              {PLACEMENTS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <Link
            to="?mode=advanced"
            className="qz-btn qz-btn-ghost qz-btn-sm"
            title="Open the full visual builder, logic tools, and A/B testing"
          >
            Advanced builder →
          </Link>
          <QzButton variant="primary" size="sm" disabled={!canPublish || isPublishing} onClick={publish}>
            {isPublishing ? "Publishing…" : "Publish"}
          </QzButton>
        </div>
      </div>

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
          </a>
          <div style={{ marginTop: 6, fontSize: 12 }} className="qz-dim">
            Embed mode: <strong>{currentPlacement.label}</strong> — {currentPlacement.hint}
          </div>
          <div className="qz-row" style={{ gap: 8, marginTop: 10 }}>
            <CopyLinkButton url={data.previewUrl} />
            <a
              href={data.previewUrl}
              target="_blank"
              rel="noreferrer"
              className="qz-btn qz-btn-ghost qz-btn-sm"
            >
              Open quiz ↗
            </a>
          </div>
          {data.qrCode ? (
            <div style={{ marginTop: 12, display: "flex", gap: 12, alignItems: "center" }}>
              <img
                src={data.qrCode}
                alt="QR code linking to the quiz"
                width={88}
                height={88}
                style={{ borderRadius: 8, border: "1px solid var(--qz-rule)", background: "#fff" }}
              />
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>Scan to open on a phone</div>
                <a
                  href={data.qrCode}
                  download={`quiz-${data.quizId}-qr.png`}
                  className="qz-btn qz-btn-ghost qz-btn-sm"
                  style={{ alignSelf: "flex-start" }}
                >
                  Download QR ↓
                </a>
              </div>
            </div>
          ) : null}
        </QzBanner>
      ) : null}
      {!canPublish ? (
        <QzBanner tone="warn" title={`${allIssues.length} to fix before publishing`}>
          Ask the assistant to finish the quiz, or open the Advanced builder to wire it manually.
        </QzBanner>
      ) : null}

      <div className="qz-ai-workspace">
        <div style={{ minWidth: 0 }}>
          <Step5Preview {...stepProps} />
        </div>
        <div style={{ position: "sticky", top: 8 }}>
          <AiChatPanel onApply={commit} />
        </div>
      </div>
    </QzPage>
  );
}
