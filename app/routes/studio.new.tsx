import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useLoaderData } from "@remix-run/react";
import { useState } from "react";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import prisma from "../db.server";
import { buildSeedQuiz } from "../lib/seedQuiz";
import { buildDemoQuiz, DEMO_QUIZ_NAME } from "../lib/demoQuiz";
import { buildTemplateQuiz, TEMPLATE_LIST, isTemplateId } from "../lib/quizTemplates";
import { HOUSE_TOKENS } from "../lib/themePresets";
import { QzPage, QzPageHeader, QzCard, QzButton, QzField, QzInput, QzBanner } from "../components/qz";
import { SHOW_OTHER_BUILD_PATHS } from "../lib/studioFlags";

// Standalone "New quiz" — Experiences E2: the experience TYPE comes first
// (what is this FOR?), then blank/template within it. Each type carries its
// own guard rails (E1) and build shaping, so the choice up front is the
// merchant declaring the outcome they want.

const EXPERIENCE_CARDS = [
  {
    type: "product_match" as const,
    icon: "🛍",
    label: "Product match",
    blurb: "Recommend the right products from your catalog, scored by every answer.",
    needsCatalog: true,
  },
  {
    type: "personality" as const,
    icon: "✨",
    label: "Personality",
    blurb: "Give shoppers an identity — a persona reveal with products to match it.",
    needsCatalog: true,
  },
  {
    type: "lead_capture" as const,
    icon: "✉️",
    label: "Lead capture",
    blurb: "Qualify with a couple of questions, then capture the email. Feeds your list.",
    needsCatalog: false,
  },
  {
    type: "survey" as const,
    icon: "📊",
    label: "Survey",
    blurb: "Learn from your audience — no products required, answers are the outcome.",
    needsCatalog: false,
  },
];
type ExperienceCardType = (typeof EXPERIENCE_CARDS)[number]["type"];

const BLANK_NAME_PLACEHOLDER: Record<ExperienceCardType, string> = {
  product_match: "Find your match",
  personality: "Which one are you?",
  lead_capture: "Get your free guide",
  survey: "Help us get better",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireStudioAccess(request);
  // Single front door: "Create with AI" is the only quiz builder for now. The
  // blank/template/demo create route is hidden — send any direct visit (stale
  // links, bookmarks) into the AI funnel. Flip SHOW_OTHER_BUILD_PATHS to restore.
  if (!SHOW_OTHER_BUILD_PATHS) return redirect("/studio/onboarding");
  const shop = await resolveStudioShop();
  const firstCollection = await prisma.collection.findFirst({
    where: { shopId: shop.id },
    select: { collectionId: true },
  });
  return json({ hasCollection: Boolean(firstCollection) });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await requireStudioAccess(request);
  // Blank/template/demo creation is hidden behind the single AI front door.
  if (!SHOW_OTHER_BUILD_PATHS) return redirect("/studio/onboarding");
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
    const xtypeRaw = String(form.get("experience_type") ?? "product_match");
    const xtype = (EXPERIENCE_CARDS.some((c) => c.type === xtypeRaw)
      ? xtypeRaw
      : "product_match") as ExperienceCardType;
    const quiz = await prisma.quiz.create({
      data: {
        shopId: shop.id,
        name: name || BLANK_NAME_PLACEHOLDER[xtype],
        status: "draft",
        // Standalone quizzes default to the warm Linen house theme (the
        // best-looking preset per the 2026-07 side-by-side render pass);
        // merchants can re-theme per quiz in the Theme panel.
        draftJson: { ...buildSeedQuiz(name, xtype), design_tokens: HOUSE_TOKENS } as never,
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
      // Linen house theme over the template's structure (questions/results
      // stay; only the palette/typography flips to the house look).
      data: {
        shopId: shop.id,
        name,
        status: "draft",
        draftJson: { ...doc, design_tokens: HOUSE_TOKENS } as never,
      },
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
  const [xtype, setXtype] = useState<ExperienceCardType>("product_match");
  const templates = TEMPLATE_LIST.filter((t) =>
    xtype === "product_match" || xtype === "personality"
      ? t.experience === "personality"
      : t.experience === xtype,
  );
  const selectedCard = EXPERIENCE_CARDS.find((c) => c.type === xtype)!;

  return (
    <QzPage>
      <QzPageHeader
        eyebrow="Standalone builder"
        title="What are you creating?"
        subtitle="The experience type sets the guard rails — what gets built, what's required, and which numbers matter."
        actions={
          <Link to="/studio" className="qz-btn qz-btn-ghost qz-btn-sm">
            ← All quizzes
          </Link>
        }
      />

      {/* Step A — the experience type */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))",
          gap: 14,
          marginTop: 8,
        }}
      >
        {EXPERIENCE_CARDS.map((c) => {
          const active = xtype === c.type;
          return (
            <button
              key={c.type}
              type="button"
              aria-pressed={active}
              onClick={() => setXtype(c.type)}
              className="qz-card qz-interactive"
              style={{
                textAlign: "left",
                cursor: "pointer",
                padding: 16,
                font: "inherit",
                border: active
                  ? "2px solid var(--qz-accent, #2a6df4)"
                  : "1px solid var(--qz-rule, #e3ddd2)",
                background: "var(--qz-paper, #fff)",
              }}
            >
              <div style={{ fontSize: 22 }}>{c.icon}</div>
              <strong style={{ fontSize: 15, display: "block", marginTop: 6 }}>{c.label}</strong>
              <span className="qz-dim" style={{ fontSize: 12.5, lineHeight: 1.45, display: "block", marginTop: 4 }}>
                {c.blurb}
              </span>
            </button>
          );
        })}
      </div>

      {!hasCollection && selectedCard.needsCatalog ? (
        <QzBanner tone="warn" title="Add products first">
          {selectedCard.label} experiences recommend from your catalog, so a quiz needs something to
          recommend — otherwise Step 1 is empty. Connect Shopify or add products (import a CSV / add
          manually), then group them.{" "}
          <Link to="/studio/products" className="qz-link">Manage products →</Link>
          {"  ·  "}
          <Link to="/studio/groups" className="qz-link">Groups →</Link>
        </QzBanner>
      ) : null}

      {/* Step B — start blank or from a template, within the chosen type */}
      <QzCard style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <strong style={{ fontSize: 16 }}>Blank {selectedCard.label.toLowerCase()}</strong>
          <div className="qz-dim" style={{ fontSize: 13, marginTop: 2 }}>
            {xtype === "survey"
              ? "An intro + one starter question. Add questions and an end screen — no products needed."
              : xtype === "lead_capture"
                ? "An intro + one starter question. Add an email gate to start capturing."
                : "An intro + one starter question. Group products in Step 1, then build the flow."}
          </div>
        </div>
        <Form method="post" className="qz-row" style={{ gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <input type="hidden" name="intent" value="blank" />
          <input type="hidden" name="experience_type" value={xtype} />
          <QzField label="Name (optional)">
            <QzInput name="name" placeholder={BLANK_NAME_PLACEHOLDER[xtype]} style={{ width: 280 }} />
          </QzField>
          <QzButton type="submit" variant="accent">
            Create →
          </QzButton>
        </Form>
      </QzCard>

      {templates.length > 0 ? (
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
            {templates.map((t) => (
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
      ) : null}

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
