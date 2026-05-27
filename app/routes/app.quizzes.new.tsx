import { useState, useMemo, useEffect } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData, useNavigate } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  Text,
  TextField,
  RangeSlider,
  Button,
  Banner,
  ChoiceList,
  InlineStack,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

interface ChoiceOption {
  label: string;
  value: string;
}

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

  // On successful generation, hop straight into the flow builder.
  useEffect(() => {
    if (fetcher.data?.ok && fetcher.data.quizId) {
      navigate(`/app/quizzes/${fetcher.data.quizId}`);
    }
  }, [fetcher.data, navigate]);

  const collectionChoices: ChoiceOption[] = useMemo(
    () =>
      collections.map((c) => ({
        label: c.title,
        value: c.collectionId,
      })),
    [collections],
  );

  const canSubmit = prompt.trim().length > 0 && !isGenerating;

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
    <Page backAction={{ content: "Dashboard", url: "/app" }}>
      <TitleBar title="New AI quiz" />
      <BlockStack gap="500">
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Generate a draft
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              Pick which collections the AI can recommend from, describe what
              the quiz should do, and how many questions you want. The model
              returns a structured quiz JSON which you&apos;ll later edit on the
              visual flow builder.
            </Text>

            <ChoiceList
              title="Collection scope"
              titleHidden={false}
              allowMultiple
              choices={collectionChoices}
              selected={selected}
              onChange={setSelected}
            />
            {collectionChoices.length === 0 && (
              <Banner tone="warning">
                <p>No collections synced yet. Run a catalog sync first.</p>
              </Banner>
            )}

            <TextField
              label="Quiz goal"
              value={prompt}
              onChange={setPrompt}
              autoComplete="off"
              multiline={4}
              maxLength={500}
              showCharacterCount
              placeholder="Describe your quiz goal, customer, and vibe."
            />

            <RangeSlider
              label={`Question count: ${count}`}
              min={3}
              max={8}
              step={1}
              value={count}
              onChange={(v) => setCount(Array.isArray(v) ? (v[0] ?? 5) : v)}
            />

            <InlineStack gap="300">
              <Button
                variant="primary"
                onClick={submit}
                disabled={!canSubmit}
                loading={isGenerating}
              >
                Generate quiz
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>

        {fetcher.data?.ok === false && (
          <Banner tone="critical" title="Generation failed">
            <p>
              {fetcher.data.error ?? "Unknown error"}
              {fetcher.data.attempts
                ? ` (${fetcher.data.attempts} attempts)`
                : ""}
            </p>
          </Banner>
        )}

        {fetcher.data?.ok && fetcher.data.quizId && (
          <Banner tone="success" title="Generated">
            <p>Opening the flow builder…</p>
          </Banner>
        )}
      </BlockStack>
    </Page>
  );
}
