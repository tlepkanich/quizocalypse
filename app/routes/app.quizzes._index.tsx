import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData, useNavigate, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Card,
  IndexTable,
  Text,
  Badge,
  Button,
  EmptyState,
  Modal,
  BlockStack,
  InlineStack,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
  });
  if (!shop) {
    return json({ quizzes: [] });
  }
  const quizzes = await prisma.quiz.findMany({
    where: { shopId: shop.id },
    select: {
      id: true,
      name: true,
      status: true,
      version: true,
      updatedAt: true,
      createdAt: true,
    },
    orderBy: { updatedAt: "desc" },
  });
  return json({
    quizzes: quizzes.map((q) => ({
      ...q,
      updatedAt: q.updatedAt.toISOString(),
      createdAt: q.createdAt.toISOString(),
    })),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
  });
  if (!shop) {
    return json({ ok: false, error: "Shop not found" }, { status: 404 });
  }

  const form = await request.formData();
  const intent = form.get("intent");
  const id = String(form.get("id") ?? "");
  if (!id) return json({ ok: false, error: "Missing id" }, { status: 400 });

  // Ensure the quiz belongs to this shop before mutating.
  const quiz = await prisma.quiz.findFirst({
    where: { id, shopId: shop.id },
    select: { id: true },
  });
  if (!quiz) return json({ ok: false, error: "Not found" }, { status: 404 });

  if (intent === "delete") {
    await prisma.quiz.delete({ where: { id } });
    return json({ ok: true });
  }

  return json({ ok: false, error: "Unknown intent" }, { status: 400 });
};

export default function QuizList() {
  const { quizzes } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const submit = useSubmit();
  const navigation = useNavigation();
  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const isDeleting =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "delete";

  const confirmDelete = () => {
    if (!pendingDelete) return;
    const form = new FormData();
    form.set("intent", "delete");
    form.set("id", pendingDelete.id);
    submit(form, { method: "POST" });
    setPendingDelete(null);
  };

  return (
    <Page
      backAction={{ content: "Dashboard", url: "/app" }}
      title="Quizzes"
      primaryAction={{
        content: "New AI quiz",
        onAction: () => navigate("/app/quizzes/new"),
      }}
    >
      <TitleBar title="Quizzes" />
      <Card padding="0">
        {quizzes.length === 0 ? (
          <EmptyState
            heading="No quizzes yet"
            action={{ content: "Generate one", url: "/app/quizzes/new" }}
            image=""
          >
            <p>Create your first AI-generated quiz to get started.</p>
          </EmptyState>
        ) : (
          <IndexTable
            resourceName={{ singular: "quiz", plural: "quizzes" }}
            itemCount={quizzes.length}
            selectable={false}
            headings={[
              { title: "Name" },
              { title: "Status" },
              { title: "Version" },
              { title: "Updated" },
              { title: "" },
            ]}
          >
            {quizzes.map((q, index) => (
              <IndexTable.Row id={q.id} key={q.id} position={index}>
                <IndexTable.Cell>
                  <Link to={`/app/quizzes/${q.id}`} prefetch="intent">
                    <Text as="span" variant="bodyMd" fontWeight="semibold">
                      {q.name}
                    </Text>
                  </Link>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Badge tone={q.status === "published" ? "success" : "info"}>
                    {q.status}
                  </Badge>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span" variant="bodyMd">
                    v{q.version}
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span" variant="bodyMd" tone="subdued">
                    {new Date(q.updatedAt).toLocaleString()}
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <InlineStack gap="200" align="end">
                    <Button
                      url={`/app/quizzes/${q.id}`}
                      variant="plain"
                    >
                      Open
                    </Button>
                    <Button
                      onClick={() =>
                        setPendingDelete({ id: q.id, name: q.name })
                      }
                      variant="plain"
                      tone="critical"
                    >
                      Delete
                    </Button>
                  </InlineStack>
                </IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        )}
      </Card>

      {pendingDelete && (
        <Modal
          open
          onClose={() => setPendingDelete(null)}
          title={`Delete "${pendingDelete.name}"?`}
          primaryAction={{
            content: "Delete",
            destructive: true,
            loading: isDeleting,
            onAction: confirmDelete,
          }}
          secondaryActions={[
            {
              content: "Cancel",
              onAction: () => setPendingDelete(null),
            },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd">
                This permanently removes the quiz and all of its versions.
                There's no undo.
              </Text>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}
