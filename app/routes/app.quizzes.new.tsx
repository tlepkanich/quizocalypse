import { useEffect, useState } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData, useNavigate } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  QzPage,
  QzPageHeader,
  QzCard,
  QzButton,
  QzBanner,
  QzField,
  QzTextarea,
} from "../components/qz";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
  });
  const collections: Array<{ collectionId: string; title: string }> = shop
    ? await prisma.collection.findMany({
        where: { shopId: shop.id },
        select: { collectionId: true, title: true },
        orderBy: { title: "asc" },
      })
    : [];
  return json({ collections, shopId: shop?.id ?? null });
};

interface GenerateResponse {
  ok: boolean;
  quizId?: string;
  draftJson?: Record<string, unknown> | null;
  error?: string;
  attempts?: number;
}

export default function NewQuiz() {
  const { collections } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<GenerateResponse>();
  const navigate = useNavigate();
  const isGenerating =
    fetcher.state !== "idle" && fetcher.formMethod === "POST";

  const [selected, setSelected] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState(5);

  useEffect(() => {
    if (fetcher.data?.ok && fetcher.data.quizId) {
      navigate(`/app/quizzes/${fetcher.data.quizId}`);
    }
  }, [fetcher.data, navigate]);

  const toggleCollection = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
  };

  const canSubmit = prompt.trim().length > 0 && !isGenerating;
  const promptChars = prompt.length;

  const submit = () => {
    const formData = new FormData();
    formData.set("collection_ids", JSON.stringify(selected));
    formData.set("goal_prompt", prompt);
    formData.set("question_count", String(count));
    fetcher.submit(formData, {
      method: "POST",
      action: "/api/quizzes/new/generate",
    });
  };

  return (
    <QzPage>
      <TitleBar title="New AI quiz" />
      <QzPageHeader
        eyebrow="New quiz"
        title={
          <>
            Generate a quiz from your{" "}
            <span className="qz-serif-italic">catalog</span>.
          </>
        }
        subtitle="Pick a scope, describe the goal in plain English, and Claude drafts the questions, answers, and product mappings against your real product tags. You'll edit the result on the visual flow canvas."
      />

      <div className="qz-col qz-gap-24" style={{ maxWidth: 720 }}>
        <QzCard>
          <div className="qz-col qz-gap-24">
            <QzField
              label="Collection scope"
              hint={
                collections.length === 0
                  ? "No collections synced yet. Run a catalog sync first."
                  : "Optional. Leave empty to let the AI use your whole catalog."
              }
              meta={`${selected.length} selected`}
            >
              {collections.length === 0 ? (
                <QzBanner tone="warn">
                  No collections available. Go back to the dashboard and resync.
                </QzBanner>
              ) : (
                <div className="qz-row" style={{ flexWrap: "wrap", gap: 8 }}>
                  {collections.map((c) => {
                    const on = selected.includes(c.collectionId);
                    return (
                      <button
                        key={c.collectionId}
                        type="button"
                        onClick={() => toggleCollection(c.collectionId)}
                        className="qz-btn qz-btn-sm"
                        style={{
                          background: on
                            ? "var(--qz-ink)"
                            : "var(--qz-paper)",
                          color: on
                            ? "var(--qz-paper)"
                            : "var(--qz-ink-2)",
                          borderColor: on
                            ? "var(--qz-ink)"
                            : "var(--qz-rule)",
                        }}
                      >
                        {c.title}
                      </button>
                    );
                  })}
                </div>
              )}
            </QzField>

            <QzField
              label="Goal prompt"
              hint="What should the shopper learn about themselves, and what should they end up shopping?"
              meta={`${promptChars} / 500`}
            >
              <QzTextarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value.slice(0, 500))}
                rows={5}
                placeholder="e.g. Help shoppers pick the right hoodie for their style, season, and fit preference."
              />
            </QzField>

            <QzField
              label="Question count"
              hint="Three is tight, eight is exhaustive. Five usually hits the sweet spot."
              meta={String(count)}
            >
              <input
                type="range"
                min={3}
                max={8}
                step={1}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                style={{ width: "100%", accentColor: "var(--qz-accent)" }}
              />
              <div
                className="qz-row qz-row-between qz-mono qz-dim"
                style={{ fontSize: 11 }}
              >
                <span>3</span>
                <span>4</span>
                <span>5</span>
                <span>6</span>
                <span>7</span>
                <span>8</span>
              </div>
            </QzField>

            <div className="qz-row qz-gap-12">
              <QzButton
                variant="accent"
                size="lg"
                onClick={submit}
                disabled={!canSubmit}
              >
                {isGenerating ? "Generating…" : "Generate quiz"}
              </QzButton>
              {!canSubmit && !isGenerating && (
                <span className="qz-mono qz-dim" style={{ fontSize: 11 }}>
                  Type a goal prompt to continue
                </span>
              )}
            </div>
          </div>
        </QzCard>

        {fetcher.data?.ok === false && (
          <QzBanner tone="crit" title="Generation failed">
            {fetcher.data.error ?? "Unknown error"}
            {fetcher.data.attempts ? ` (${fetcher.data.attempts} attempts)` : ""}
          </QzBanner>
        )}

        {fetcher.data?.ok && fetcher.data.quizId && (
          <QzBanner tone="ok" title="Generated">
            Opening the flow builder…
          </QzBanner>
        )}
      </div>
    </QzPage>
  );
}
