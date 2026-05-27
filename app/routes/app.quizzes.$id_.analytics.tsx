import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  Text,
  InlineStack,
  Banner,
  DataTable,
  Box,
  Layout,
  Badge,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { id } = params;
  if (!id) throw new Response("Missing quiz id", { status: 400 });

  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
  });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  const quiz = await prisma.quiz.findFirst({
    where: { id, shopId: shop.id },
    select: { id: true, name: true, status: true },
  });
  if (!quiz) throw new Response("Quiz not found", { status: 404 });

  // Distinct-session funnel: a session counts once at each stage it reached.
  const eventRows = await prisma.event.findMany({
    where: { quizId: quiz.id },
    select: { sessionId: true, eventType: true, ts: true },
  });

  const sessionsByStage = new Map<string, Set<string>>();
  let earliest: Date | null = null;
  let latest: Date | null = null;
  for (const row of eventRows) {
    const set = sessionsByStage.get(row.eventType) ?? new Set();
    set.add(row.sessionId);
    sessionsByStage.set(row.eventType, set);
    if (!earliest || row.ts < earliest) earliest = row.ts;
    if (!latest || row.ts > latest) latest = row.ts;
  }
  const count = (k: string) => sessionsByStage.get(k)?.size ?? 0;

  const started = count("quiz_started");
  const answered = count("question_answered");
  const completed = count("quiz_completed");
  const viewed = count("recommendation_viewed");
  const clicked = count("recommendation_clicked");

  const captures = await prisma.emailCapture.findMany({
    where: { quizId: quiz.id },
    orderBy: { capturedAt: "desc" },
    take: 25,
  });

  return json({
    quiz,
    funnel: { started, answered, completed, viewed, clicked },
    earliest: earliest ? earliest.toISOString() : null,
    latest: latest ? latest.toISOString() : null,
    captureCount: captures.length,
    captures: captures.map((c) => ({
      ...c,
      capturedAt: c.capturedAt.toISOString(),
    })),
  });
};

export default function QuizAnalytics() {
  const data = useLoaderData<typeof loader>();
  const { funnel } = data;
  const completionRate =
    funnel.started > 0 ? funnel.completed / funnel.started : 0;
  const clickThroughRate =
    funnel.viewed > 0 ? funnel.clicked / funnel.viewed : 0;

  return (
    <Page
      backAction={{ content: "Quiz", url: `/app/quizzes/${data.quiz.id}` }}
      title={`Analytics: ${data.quiz.name}`}
      titleMetadata={
        <Badge tone={data.quiz.status === "published" ? "success" : "info"}>
          {data.quiz.status}
        </Badge>
      }
    >
      <TitleBar title="Analytics" />
      <BlockStack gap="400">
        {funnel.started === 0 && (
          <Banner tone="info">
            <p>
              No events yet. Once shoppers take this quiz on the storefront,
              counts will populate here.
            </p>
          </Banner>
        )}

        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Funnel
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Distinct sessions reaching each stage.{" "}
                  {data.earliest && (
                    <>
                      Earliest event{" "}
                      {new Date(data.earliest).toLocaleString()} · latest{" "}
                      {data.latest && new Date(data.latest).toLocaleString()}
                    </>
                  )}
                </Text>
                <BlockStack gap="200">
                  <FunnelRow label="Started" value={funnel.started} />
                  <FunnelRow
                    label="Answered ≥1 question"
                    value={funnel.answered}
                  />
                  <FunnelRow label="Completed" value={funnel.completed} />
                  <FunnelRow
                    label="Saw recommendations"
                    value={funnel.viewed}
                  />
                  <FunnelRow label="Clicked a product" value={funnel.clicked} />
                </BlockStack>
                <InlineStack gap="500">
                  <Stat
                    label="Completion rate"
                    value={`${(completionRate * 100).toFixed(1)}%`}
                  />
                  <Stat
                    label="Recommendation click-through"
                    value={`${(clickThroughRate * 100).toFixed(1)}%`}
                  />
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Email captures
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Most recent 25. Webhook delivery to external endpoints
                  (Klaviyo, etc.) lands in a follow-up.
                </Text>
                {data.captures.length === 0 ? (
                  <Text as="p" variant="bodySm" tone="subdued">
                    No captures yet.
                  </Text>
                ) : (
                  <DataTable
                    columnContentTypes={["text", "text", "text"]}
                    headings={["Email", "Name", "Captured"]}
                    rows={data.captures.map((c) => [
                      c.email,
                      c.firstName ?? "—",
                      new Date(c.capturedAt).toLocaleString(),
                    ])}
                  />
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}

function FunnelRow({ label, value }: { label: string; value: number }) {
  return (
    <InlineStack align="space-between">
      <Text as="span" variant="bodyMd">
        {label}
      </Text>
      <Text as="span" variant="bodyMd" fontWeight="semibold">
        {value}
      </Text>
    </InlineStack>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Text as="p" variant="bodySm" tone="subdued">
        {label}
      </Text>
      <Text as="p" variant="headingLg">
        {value}
      </Text>
    </Box>
  );
}
