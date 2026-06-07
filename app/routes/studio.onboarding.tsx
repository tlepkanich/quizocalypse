import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useLoaderData, useNavigation } from "@remix-run/react";
import { useState } from "react";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import prisma from "../db.server";
import { parseBrandGuidelinesSafe } from "../lib/brandGuidelines";
import { runAiOnboardingBuild } from "../lib/onboardingBuild.server";
import type { QuizTone } from "../lib/claude";
import {
  QzPage,
  QzPageHeader,
  QzCard,
  QzButton,
  QzField,
  QzInput,
  QzTextarea,
  QzSelect,
  QzBanner,
  QzBadge,
} from "../components/qz";

// Standalone AI-first onboarding — the Dev-Spec "one prompt → AI builds the
// quiz" flow, ported off the embedded admin (/app/onboarding, which needs
// Shopify OAuth) so it runs on the always-on /studio deployment. Build →
// redirect straight into the AI editor (?mode=ai). The action self-gates
// (Remix doesn't run the parent layout loader before an action).

const EXAMPLE_PROMPTS = [
  "Help shoppers find the right moisturizer for their skin type and concerns.",
  "Match customers to the perfect coffee roast based on taste and brew method.",
  "Recommend a starter skincare routine by skin goal and budget.",
  "Find the ideal running shoe for a runner's distance, terrain, and gait.",
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const [productCount, firstCollection, shopRow] = await Promise.all([
    prisma.product.count({ where: { shopId: shop.id } }),
    prisma.collection.findFirst({
      where: { shopId: shop.id },
      select: { collectionId: true },
    }),
    prisma.shop.findUnique({ where: { id: shop.id }, select: { brandGuidelines: true } }),
  ]);
  return json({
    productCount,
    hasCollection: Boolean(firstCollection),
    brandVoiceName: parseBrandGuidelinesSafe(shopRow?.brandGuidelines)?.name ?? null,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const form = await request.formData();

  const name = String(form.get("name") ?? "").trim().slice(0, 120) || "My quiz";
  const goalPrompt = String(form.get("goalPrompt") ?? "").slice(0, 500);
  const qcRaw = Number(form.get("questionCount"));
  const questionCount = Number.isFinite(qcRaw)
    ? Math.min(8, Math.max(3, Math.round(qcRaw)))
    : 6;
  const toneRaw = String(form.get("tone") ?? "friendly");
  const tone = (
    ["friendly", "editorial", "playful", "professional"].includes(toneRaw)
      ? toneRaw
      : "friendly"
  ) as QuizTone;
  const emailGate = form.get("emailGate") === "on";
  const websiteUrl = String(form.get("websiteUrl") ?? "").slice(0, 300);

  try {
    const result = await runAiOnboardingBuild({
      shopId: shop.id,
      name,
      goalPrompt,
      questionCount,
      tone,
      flow: { welcome_message: false, email_gate: emailGate, mixed_input_types: false },
      ...(websiteUrl ? { websiteUrl } : {}),
    });
    // Land straight in the AI editor; ?built carries the degraded hint (if any).
    const q = result.degraded ? `?mode=ai&built=degraded` : `?mode=ai&built=1`;
    return redirect(`/studio/${result.quizId}${q}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, { status: 500 });
  }
};

export default function StudioOnboarding() {
  const { productCount, hasCollection, brandVoiceName } = useLoaderData<typeof loader>();
  const nav = useNavigation();
  const building = nav.state !== "idle" && nav.formMethod === "POST";
  const [goal, setGoal] = useState("");
  const [count, setCount] = useState(6);

  if (building) {
    return (
      <QzPage>
        <QzCard
          style={{
            marginTop: 40,
            padding: 40,
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            gap: 16,
            alignItems: "center",
          }}
        >
          <div style={{ fontSize: 40 }}>✨</div>
          <h2 className="qz-h1" style={{ margin: 0 }}>Building your quiz…</h2>
          <p className="qz-dim" style={{ margin: 0, maxWidth: 440 }}>
            Reading your catalog → grouping products into outcomes → writing
            on-brand questions and result pages. This takes ~20–30 seconds.
          </p>
          <div className="qz-dim" style={{ fontSize: 13 }}>
            You&rsquo;ll land in the AI editor when it&rsquo;s ready.
          </div>
        </QzCard>
      </QzPage>
    );
  }

  return (
    <QzPage>
      <QzPageHeader
        eyebrow="AI-first setup"
        title="Build a quiz from one prompt"
        subtitle="Describe what shoppers should find. AI reads your catalog, groups products into outcomes, and writes the whole quiz — then you refine it by chat."
        actions={
          <Link to="/studio" className="qz-btn qz-btn-ghost qz-btn-sm">
            ← All quizzes
          </Link>
        }
      />

      {!hasCollection ? (
        <QzBanner tone="warn" title="No Shopify collections synced yet">
          AI builds best with at least one collection (it powers result-page fallbacks and
          product mapping). You can still build — sync your catalog from the Shopify app to improve it.
        </QzBanner>
      ) : null}

      <QzCard style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="qz-row qz-row-between" style={{ alignItems: "center" }}>
          <p className="qz-dim" style={{ margin: 0, fontSize: 13 }}>
            We&rsquo;ve scanned your <strong>{productCount}</strong>{" "}
            {productCount === 1 ? "product" : "products"} — one sentence of context is all the AI needs.
          </p>
          {brandVoiceName ? <QzBadge tone="ok">Brand voice: {brandVoiceName}</QzBadge> : null}
        </div>

        <Form method="post" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <QzField label="Quiz name">
            <QzInput name="name" placeholder="e.g. Find your skincare routine" />
          </QzField>

          <QzField
            label="What should this quiz help shoppers do?"
            hint="The clearer the goal, the better the questions AI writes."
          >
            <QzTextarea
              name="goalPrompt"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="e.g. Help shoppers find the right moisturizer for their skin type and concerns."
              rows={3}
            />
          </QzField>

          <div className="qz-row" style={{ gap: 8, flexWrap: "wrap" }}>
            {EXAMPLE_PROMPTS.map((ex) => (
              <button
                key={ex}
                type="button"
                className="qz-btn qz-btn-ghost qz-btn-sm"
                style={{ fontSize: 12 }}
                onClick={() => setGoal(ex)}
              >
                {ex.length > 48 ? `${ex.slice(0, 48)}…` : ex}
              </button>
            ))}
          </div>

          <QzField
            label="Your website (optional)"
            hint="AI reads your homepage / About page for on-brand language — richer, less generic copy."
          >
            <QzInput name="websiteUrl" placeholder="https://yourstore.com" />
          </QzField>

          <div className="qz-row" style={{ gap: 24, flexWrap: "wrap", alignItems: "flex-end" }}>
            <QzField label={`How many questions? (${count})`} hint="5–8 works best for completion.">
              <input
                type="range"
                name="questionCount"
                min={3}
                max={8}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                style={{ width: 200 }}
              />
            </QzField>
            <QzField label="Tone">
              <QzSelect name="tone" defaultValue="friendly">
                <option value="friendly">Friendly</option>
                <option value="editorial">Editorial</option>
                <option value="playful">Playful</option>
                <option value="professional">Professional</option>
              </QzSelect>
            </QzField>
          </div>

          <label style={{ display: "inline-flex", gap: 8, alignItems: "center", fontSize: 13 }}>
            <input type="checkbox" name="emailGate" />
            Capture emails before showing results (grow your list)
          </label>

          <div>
            <QzButton
              type="submit"
              variant="accent"
              disabled={goal.trim().length === 0}
              title={goal.trim().length === 0 ? "Add a goal to continue" : undefined}
            >
              ✨ Build my quiz
            </QzButton>
          </div>
        </Form>
      </QzCard>

      <p className="qz-dim" style={{ marginTop: 14, fontSize: 12.5 }}>
        Prefer to start from a blank quiz or a template?{" "}
        <Link to="/studio/new" className="qz-link">
          Use the classic builder →
        </Link>
      </p>
    </QzPage>
  );
}
