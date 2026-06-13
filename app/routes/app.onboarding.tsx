import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { buildSeedQuiz } from "../lib/seedQuiz";
import { buildTemplateQuiz, isTemplateId, TEMPLATE_LIST } from "../lib/quizTemplates";
import { buildDemoQuiz, DEMO_QUIZ_NAME } from "../lib/demoQuiz";
import { findOrCreateStep1Draft } from "../lib/step1Funnel.server";
import { QzPage, QzPageHeader, QzCard, QzButton, QzBanner } from "../components/qz";

// Builder Re-work Step 1 — the embedded "create a quiz" hub. The identity-first
// AI funnel is the headline path (intent=ai-funnel → the resumable Step-1
// funnel); templates / demo / blank remain as the fast-start escape hatch (the
// embedded equivalent of /studio/new). The old 4-step AI wizard is retired —
// the funnel (grouping → goal → directions → build) replaces it.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    select: { id: true },
  });
  if (!shop) throw new Response("Shop not found", { status: 404 });
  const [productCount, firstCollection] = await Promise.all([
    prisma.product.count({ where: { shopId: shop.id } }),
    prisma.collection.findFirst({ where: { shopId: shop.id }, select: { collectionId: true } }),
  ]);
  return json({ productCount, hasCollection: Boolean(firstCollection) });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) return json({ ok: false, error: "Shop not found" }, { status: 400 });

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  // ── intent=ai-funnel → the identity-first creation funnel ──────────────────
  if (intent === "ai-funnel") {
    const quizId = await findOrCreateStep1Draft(shop.id);
    return redirect(`/app/onboarding/${quizId}`);
  }

  // ── intent=template ────────────────────────────────────────────────────────
  if (intent === "template") {
    const templateId = String(form.get("templateId") ?? "");
    if (!isTemplateId(templateId)) {
      return json({ ok: false, error: "Unknown template" }, { status: 400 });
    }
    const firstCollection = await prisma.collection.findFirst({
      where: { shopId: shop.id },
      select: { collectionId: true },
    });
    const { doc, name } = buildTemplateQuiz(templateId, firstCollection?.collectionId ?? "");
    const quiz = await prisma.quiz.create({
      data: { shopId: shop.id, name, status: "draft", draftJson: doc as never },
    });
    return redirect(`/app/quizzes/${quiz.id}/studio?step=1`);
  }

  // ── intent=demo (one-click feature showcase) ───────────────────────────────
  if (intent === "demo") {
    const firstCollection = await prisma.collection.findFirst({
      where: { shopId: shop.id },
      select: { collectionId: true },
    });
    const quiz = await prisma.quiz.create({
      data: {
        shopId: shop.id,
        name: DEMO_QUIZ_NAME,
        status: "draft",
        draftJson: buildDemoQuiz(firstCollection?.collectionId ?? "") as never,
      },
    });
    return redirect(`/app/quizzes/${quiz.id}/studio?step=2`);
  }

  // ── intent=blank ───────────────────────────────────────────────────────────
  if (intent === "blank") {
    const name = String(form.get("name") ?? "").trim().slice(0, 120) || "Untitled quiz";
    const quiz = await prisma.quiz.create({
      data: { shopId: shop.id, name, status: "draft", draftJson: buildSeedQuiz(name) as never },
    });
    return redirect(`/app/quizzes/${quiz.id}/studio?step=1`);
  }

  return json({ ok: false, error: "Unknown intent" }, { status: 400 });
};

export default function Onboarding() {
  const data = useLoaderData<typeof loader>();
  return (
    <QzPage>
      <TitleBar title="Create a quiz" />
      <QzPageHeader
        eyebrow="Create"
        title="Start a new quiz"
        subtitle="Let AI build one from your catalog and brand identity, or start fast from a template."
      />

      {!data.hasCollection ? (
        <div style={{ marginBottom: 16 }}>
          <QzBanner tone="warn" title="No Shopify collections synced yet">
            Templates and AI build work best with at least one collection — they power result-page
            fallbacks and product mapping. You can still continue and refine later.
          </QzBanner>
        </div>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <QzCard style={{ padding: 18 }}>
          <div className="qz-row qz-row-between" style={{ alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div>
              <strong style={{ fontSize: 16 }}>✨ Build with AI</strong>
              <div className="qz-dim" style={{ fontSize: 13, marginTop: 2 }}>
                We read your catalog and brand identity, group your products, and draft a few quiz
                directions for you to pick from — then build the whole thing.
              </div>
            </div>
            <Form method="post">
              <input type="hidden" name="intent" value="ai-funnel" />
              <QzButton type="submit" variant="primary">
                Start with AI →
              </QzButton>
            </Form>
          </div>
        </QzCard>

        <div>
          <div className="qz-label" style={{ marginBottom: 10 }}>
            Or start from a template
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
            {TEMPLATE_LIST.map((t) => (
              <Form method="post" key={t.id}>
                <input type="hidden" name="intent" value="template" />
                <input type="hidden" name="templateId" value={t.id} />
                <button
                  type="submit"
                  className="qz-card"
                  style={{
                    width: "100%",
                    textAlign: "left",
                    cursor: "pointer",
                    padding: 0,
                    overflow: "hidden",
                    border: "1px solid #00000014",
                  }}
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

        <div className="qz-row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Form method="post">
            <input type="hidden" name="intent" value="demo" />
            <button type="submit" className="qz-btn qz-btn-ghost qz-btn-sm">
              🎬 Create a demo quiz (showcases everything)
            </button>
          </Form>
          <Form method="post">
            <input type="hidden" name="intent" value="blank" />
            <button type="submit" className="qz-btn qz-btn-ghost qz-btn-sm">
              Start from a blank quiz instead
            </button>
          </Form>
        </div>
      </div>
    </QzPage>
  );
}
