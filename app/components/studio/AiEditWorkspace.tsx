import { useMemo } from "react";
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
