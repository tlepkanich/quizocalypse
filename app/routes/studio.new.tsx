import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useLoaderData } from "@remix-run/react";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import prisma from "../db.server";
import { buildSeedQuiz } from "../lib/seedQuiz";
import { buildDemoQuiz, DEMO_QUIZ_NAME } from "../lib/demoQuiz";
import { buildTemplateQuiz, TEMPLATE_LIST, isTemplateId } from "../lib/quizTemplates";
import { QzPage, QzPageHeader, QzCard, QzButton, QzField, QzInput, QzBanner } from "../components/qz";

// Standalone "New quiz" — the create entry the embedded app has at
// /app/quizzes/new + /app/onboarding, ported to the /studio website. Reuses the
// auth-free builders (seed / template / demo) and redirects into the standalone
// builder. The action gates itself (Remix doesn't run the parent layout loader
// before an action).

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const firstCollection = await prisma.collection.findFirst({
    where: { shopId: shop.id },
    select: { collectionId: true },
  });
  return json({ hasCollection: Boolean(firstCollection) });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  const firstCollection = await prisma.collection.findFirst({
    where: { shopId: shop.id },
    select: { collectionId: true },
  });
  const fb = firstCollection?.collectionId ?? "";

  if (intent === "blank") {
    const name = String(form.get("name") ?? "").trim();
    const quiz = await prisma.quiz.create({
      data: {
        shopId: shop.id,
        name: name || "Find your match",
        status: "draft",
        draftJson: buildSeedQuiz(name) as never,
      },
    });
    return redirect(`/studio/${quiz.id}?step=1`);
  }

  if (intent === "template") {
    const templateId = String(form.get("templateId") ?? "");
    if (!isTemplateId(templateId)) {
      return json({ error: "Unknown template" }, { status: 400 });
    }
    const { doc, name } = buildTemplateQuiz(templateId, fb);
    const quiz = await prisma.quiz.create({
      data: { shopId: shop.id, name, status: "draft", draftJson: doc as never },
    });
    return redirect(`/studio/${quiz.id}?step=1`);
  }

  if (intent === "demo") {
    const quiz = await prisma.quiz.create({
      data: {
        shopId: shop.id,
        name: DEMO_QUIZ_NAME,
        status: "draft",
        draftJson: buildDemoQuiz(fb) as never,
      },
    });
    return redirect(`/studio/${quiz.id}?step=2`);
  }

  return json({ error: "Unknown intent" }, { status: 400 });
};

export default function StudioNew() {
  const { hasCollection } = useLoaderData<typeof loader>();
  return (
    <QzPage>
      <QzPageHeader
        eyebrow="Standalone builder"
        title="New quiz"
        subtitle="Start blank, from a vertical template, or with the full feature demo."
        actions={
          <Link to="/studio" className="qz-btn qz-btn-ghost qz-btn-sm">
            ← All quizzes
          </Link>
        }
      />

      {!hasCollection ? (
        <QzBanner tone="warn" title="No collections synced">
          Templates and the demo need a fallback collection. Sync your catalog from the Shopify app
          first — a blank quiz still works.
        </QzBanner>
      ) : null}

      {/* Blank — the primary create */}
      <QzCard style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <strong style={{ fontSize: 16 }}>Blank quiz</strong>
          <div className="qz-dim" style={{ fontSize: 13, marginTop: 2 }}>
            An intro + one starter question. Group products in Step 1, then build the flow.
          </div>
        </div>
        <Form method="post" className="qz-row" style={{ gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <input type="hidden" name="intent" value="blank" />
          <QzField label="Name (optional)">
            <QzInput name="name" placeholder="Find your match" style={{ width: 280 }} />
          </QzField>
          <QzButton type="submit" variant="accent">
            Create blank quiz →
          </QzButton>
        </Form>
      </QzCard>

      {/* Templates */}
      <div style={{ marginTop: 24 }}>
        <div className="qz-label" style={{ marginBottom: 10 }}>
          Or start from a template
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: 14,
          }}
        >
          {TEMPLATE_LIST.map((t) => (
            <Form method="post" key={t.id}>
              <input type="hidden" name="intent" value="template" />
              <input type="hidden" name="templateId" value={t.id} />
              <button
                type="submit"
                className="qz-card qz-interactive"
                style={{ width: "100%", textAlign: "left", cursor: "pointer", padding: 0, overflow: "hidden" }}
              >
                <div style={{ height: 8, background: t.accent }} />
                <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 6 }}>
                  <strong style={{ fontSize: 15 }}>{t.label}</strong>
                  <span className="qz-dim" style={{ fontSize: 12.5, lineHeight: 1.4 }}>
                    {t.description}
                  </span>
                  <span style={{ fontSize: 12, color: t.accent, fontWeight: 600, marginTop: 2 }}>
                    Use this template →
                  </span>
                </div>
              </button>
            </Form>
          ))}
        </div>
      </div>

      {/* Demo */}
      <div style={{ marginTop: 20 }}>
        <Form method="post">
          <input type="hidden" name="intent" value="demo" />
          <button type="submit" className="qz-btn qz-btn-ghost qz-btn-sm">
            🎬 Create a demo quiz (showcases every feature)
          </button>
        </Form>
      </div>
    </QzPage>
  );
}
