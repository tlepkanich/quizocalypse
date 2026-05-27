import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  Link,
  useLoaderData,
  useNavigation,
  useSubmit,
} from "@remix-run/react";
import {
  Page,
  Card,
  IndexTable,
  Text,
  Badge,
  Button,
  Modal,
  BlockStack,
  EmptyState,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { Quiz } from "../lib/quizSchema";

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
    select: { id: true, name: true, version: true, status: true },
  });
  if (!quiz) throw new Response("Quiz not found", { status: 404 });

  const versions = await prisma.quizVersion.findMany({
    where: { quizId: quiz.id },
    orderBy: { version: "desc" },
    select: { id: true, version: true, publishedAt: true },
  });

  return json({
    quiz,
    versions: versions.map((v) => ({
      ...v,
      publishedAt: v.publishedAt.toISOString(),
    })),
  });
};

export const action = async ({ params, request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { id } = params;
  if (!id) return json({ ok: false, error: "Missing id" }, { status: 400 });

  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
  });
  if (!shop) return json({ ok: false, error: "Shop not found" }, { status: 404 });

  const form = await request.formData();
  if (form.get("intent") !== "revert") {
    return json({ ok: false, error: "Unknown intent" }, { status: 400 });
  }

  const versionId = String(form.get("versionId") ?? "");
  const version = await prisma.quizVersion.findFirst({
    where: { id: versionId, quiz: { id, shopId: shop.id } },
  });
  if (!version) {
    return json({ ok: false, error: "Version not found" }, { status: 404 });
  }

  // The publishedJson includes publish-only fields (product_index, published_at).
  // Zod's default `strip` discards them; we keep only the Quiz subset for the draft.
  const parsed = Quiz.safeParse(version.publishedJson);
  if (!parsed.success) {
    return json(
      { ok: false, error: "Stored version doesn't match the current quiz schema." },
      { status: 400 },
    );
  }

  await prisma.quiz.update({
    where: { id },
    data: { draftJson: parsed.data as never },
  });

  return json({
    ok: true,
    revertedTo: version.version,
  });
};

export default function QuizVersions() {
  const { quiz, versions } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const [pending, setPending] = useState<{
    id: string;
    version: number;
  } | null>(null);
  const isReverting =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "revert";

  const confirmRevert = () => {
    if (!pending) return;
    const form = new FormData();
    form.set("intent", "revert");
    form.set("versionId", pending.id);
    submit(form, { method: "POST" });
    setPending(null);
  };

  return (
    <Page
      backAction={{ content: "Quiz", url: `/app/quizzes/${quiz.id}` }}
      title={`Versions: ${quiz.name}`}
      titleMetadata={
        <Badge tone={quiz.status === "published" ? "success" : "info"}>
          {quiz.status}
        </Badge>
      }
    >
      <TitleBar title="Versions" />
      <Card padding="0">
        {versions.length === 0 ? (
          <EmptyState
            heading="No published versions yet"
            action={{ content: "Back to editor", url: `/app/quizzes/${quiz.id}` }}
            image=""
          >
            <p>Publish your quiz to start tracking versions you can revert to.</p>
          </EmptyState>
        ) : (
          <IndexTable
            resourceName={{ singular: "version", plural: "versions" }}
            itemCount={versions.length}
            selectable={false}
            headings={[
              { title: "Version" },
              { title: "Published" },
              { title: "" },
            ]}
          >
            {versions.map((v, idx) => (
              <IndexTable.Row id={v.id} key={v.id} position={idx}>
                <IndexTable.Cell>
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    v{v.version}
                  </Text>{" "}
                  {v.version === quiz.version && (
                    <Badge tone="success">active</Badge>
                  )}
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span" variant="bodyMd" tone="subdued">
                    {new Date(v.publishedAt).toLocaleString()}
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Button
                    onClick={() => setPending({ id: v.id, version: v.version })}
                    variant="plain"
                    disabled={v.version === quiz.version}
                  >
                    Revert to this version
                  </Button>
                </IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        )}
      </Card>

      {pending && (
        <Modal
          open
          onClose={() => setPending(null)}
          title={`Revert to v${pending.version}?`}
          primaryAction={{
            content: "Revert",
            destructive: true,
            loading: isReverting,
            onAction: confirmRevert,
          }}
          secondaryActions={[
            { content: "Cancel", onAction: () => setPending(null) },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd">
                This replaces your current draft with the contents of v
                {pending.version}. Any unsaved changes in the editor will be
                lost. You'll then need to publish again to push the reverted
                version to your storefront.
              </Text>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}

      <BlockStack gap="200">
        <div style={{ marginTop: 12 }}>
          <Link to={`/app/quizzes/${quiz.id}`}>
            <Button variant="plain">← Back to editor</Button>
          </Link>
        </div>
      </BlockStack>
    </Page>
  );
}
