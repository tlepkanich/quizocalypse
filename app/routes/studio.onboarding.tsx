import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import {
  json,
  redirect,
  unstable_createMemoryUploadHandler,
  unstable_parseMultipartFormData,
} from "@remix-run/node";
import {
  Form,
  Link,
  useActionData,
  useFetcher,
  useLoaderData,
  useNavigation,
} from "@remix-run/react";
import { useEffect, useMemo, useState } from "react";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import prisma from "../db.server";
import { parseBrandGuidelinesSafe } from "../lib/brandGuidelines";
import { startAiOnboardingBuild } from "../lib/onboardingBuild.server";
import { extractBrandGuidelines } from "../lib/brandExtract";
import { scoreCatalogCompleteness } from "../lib/catalogIndex";
import { DesignTokens } from "../lib/quizSchema";
import type { QuizTone } from "../lib/claude";
import { QzPage, QzPageHeader, QzCard, QzBanner } from "../components/qz";
import { WizardStepper } from "../components/onboarding/OnboardingStepper";
import {
  CatalogStep,
  BrandStep,
  GoalStep,
  type WizardGoalId,
  type WizardExperienceType,
  IncentiveStep,
  ReviewStep,
  mergeHexIntoTokens,
  type Placement,
  type ExtractResp,
  type DesignTokensT,
} from "../components/onboarding/OnboardingWizardSteps";

// Standalone AI-first onboarding — the Miro "AI-Guided Quiz Builder" setup flow,
// streamlined to a 5-step wizard (Catalog → Brand → Goal → Incentives → Review),
// ported off the embedded admin so it runs on the always-on /studio deployment.
// Client-side stepper (one Form submit on the last step + a useFetcher multipart
// sub-action for logo→tokens); the build runs DETACHED and redirects into the AI
// editor (?mode=ai), whose polling overlay handles the "Building…" state.

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const [productCount, sampleProducts, firstCollection, shopRow] = await Promise.all([
    prisma.product.count({ where: { shopId: shop.id } }),
    // Sample (capped) feeds the statistical completeness score; the true count
    // is the separate count() above for the "scanned N" headline.
    prisma.product.findMany({ where: { shopId: shop.id }, take: 1000 }),
    prisma.collection.findFirst({ where: { shopId: shop.id }, select: { collectionId: true } }),
    prisma.shop.findUnique({ where: { id: shop.id }, select: { brandGuidelines: true } }),
  ]);
  return json({
    productCount,
    hasCollection: Boolean(firstCollection),
    brandVoiceName: parseBrandGuidelinesSafe(shopRow?.brandGuidelines)?.name ?? null,
    completeness: scoreCatalogCompleteness(sampleProducts),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();

  // intent=extract-design (multipart logo → AI palette) — mirrors app.onboarding.
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    let mform: FormData;
    try {
      mform = await unstable_parseMultipartFormData(
        request,
        unstable_createMemoryUploadHandler({ maxPartSize: MAX_UPLOAD_BYTES }),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      return json({ ok: false, intent: "extract-design", error: msg }, { status: 400 });
    }
    const file = mform.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return json(
        { ok: false, intent: "extract-design", error: "Attach a logo image (PNG/JPG)." },
        { status: 400 },
      );
    }
    try {
      const buf = Buffer.from(await file.arrayBuffer());
      const guidelines = await extractBrandGuidelines({
        file: buf,
        mediaType: file.type || "image/png",
        fileName: file.name || "logo",
      });
      return json({
        ok: true,
        intent: "extract-design" as const,
        tokens: guidelines.visual_suggestions.tokens ?? null,
        brandName: guidelines.name,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't read that image";
      return json({ ok: false, intent: "extract-design", error: msg }, { status: 502 });
    }
  }

  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim().slice(0, 120) || "My quiz";
  const goalPrompt = String(form.get("goalPrompt") ?? "").slice(0, 500);
  const qcRaw = Number(form.get("questionCount"));
  const questionCount = Number.isFinite(qcRaw) ? Math.min(8, Math.max(3, Math.round(qcRaw))) : 6;
  const toneRaw = String(form.get("tone") ?? "friendly");
  const tone = (
    ["friendly", "editorial", "playful", "professional"].includes(toneRaw) ? toneRaw : "friendly"
  ) as QuizTone;
  const emailGate = form.get("emailGate") === "on";
  const collectEmailOnResult = form.get("collectEmailOnResult") === "on";
  const websiteUrl = String(form.get("websiteUrl") ?? "").slice(0, 300);
  const placementRaw = String(form.get("placement") ?? "page");
  const placement = (
    ["page", "popup", "inline", "product_widget"].includes(placementRaw) ? placementRaw : "page"
  ) as Placement;
  const xtypeRaw = String(form.get("experienceType") ?? "product_match");
  const experienceType = (
    ["product_match", "personality", "lead_capture", "survey"].includes(xtypeRaw)
      ? xtypeRaw
      : "product_match"
  ) as "product_match" | "personality" | "lead_capture" | "survey";
  const goalsRaw = String(form.get("goals") ?? "");
  const goalLabels = goalsRaw ? goalsRaw.split(",").filter(Boolean) : [];

  let designTokens: DesignTokensT | null = null;
  try {
    const raw = form.get("designTokens");
    if (typeof raw === "string" && raw) {
      const parsed = DesignTokens.safeParse(JSON.parse(raw));
      if (parsed.success) designTokens = parsed.data;
    }
  } catch {
    // ignore malformed tokens
  }

  try {
    const { quizId } = await startAiOnboardingBuild({
      shopId: shop.id,
      name,
      goalPrompt,
      questionCount,
      tone,
      experienceType,
      goalLabels,
      // Lead capture without a gate captures nothing — the type implies it.
      flow: {
        welcome_message: false,
        email_gate: emailGate || experienceType === "lead_capture",
        mixed_input_types: false,
      },
      ...(websiteUrl ? { websiteUrl } : {}),
      ...(designTokens ? { designTokens } : {}),
      placement,
      collectEmailOnResult,
    });
    return redirect(`/studio/${quizId}?mode=ai`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, { status: 500 });
  }
};

export default function StudioOnboarding() {
  const { productCount, hasCollection, brandVoiceName, completeness } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const building = nav.state !== "idle" && nav.formMethod === "POST";

  // Step state
  const [step, setStep] = useState(1);
  const [maxReached, setMaxReached] = useState(1);
  const goto = (n: number) => {
    setStep(n);
    setMaxReached((m) => Math.max(m, n));
  };

  // Accumulated wizard input
  const [name, setName] = useState("");
  const [goalPrompt, setGoalPrompt] = useState("");
  const [questionCount, setQuestionCount] = useState(6);
  const [tone, setTone] = useState<QuizTone>("friendly");
  const [emailGate, setEmailGate] = useState(false);
  const [collectEmailOnResult, setCollectEmailOnResult] = useState(false);
  const [placement, setPlacement] = useState<Placement>("page");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [goals, setGoals] = useState<WizardGoalId[]>([]);
  const [experienceType, setExperienceType] = useState<WizardExperienceType>("product_match");
  const [baseTokens, setBaseTokens] = useState<DesignTokensT | null>(null);
  const [hex, setHex] = useState("");
  const effectiveTokens = useMemo(
    () => (hex.trim() ? mergeHexIntoTokens(baseTokens, hex) : baseTokens),
    [baseTokens, hex],
  );

  // Logo → tokens sub-action (multipart), kept off the main wizard Form.
  const designFetcher = useFetcher<ExtractResp>();
  useEffect(() => {
    if (designFetcher.state === "idle" && designFetcher.data?.ok && designFetcher.data.tokens) {
      setBaseTokens(designFetcher.data.tokens);
    }
  }, [designFetcher.state, designFetcher.data]);

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
            Reading your catalog → grouping products into outcomes → writing on-brand
            questions and result pages. This usually takes about a minute.
          </p>
          <div className="qz-dim" style={{ fontSize: 13 }}>
            You&rsquo;ll land in the AI editor when it&rsquo;s ready.
          </div>
        </QzCard>
      </QzPage>
    );
  }

  const buildError =
    actionData && "error" in actionData ? (actionData.error as string) : null;

  return (
    <QzPage>
      <QzPageHeader
        eyebrow="AI-first setup"
        title="Build a quiz from one prompt"
        subtitle="AI reads your catalog, groups products into outcomes, and writes the whole quiz — you point it at a goal and refine by chat."
        actions={
          <Link to="/studio" className="qz-btn qz-btn-ghost qz-btn-sm">
            ← All quizzes
          </Link>
        }
      />

      <WizardStepper current={step} maxReached={maxReached} onJump={goto} />

      {step === 1 ? (
        <CatalogStep
          productCount={productCount}
          completeness={completeness}
          hasCollection={hasCollection}
          onNext={() => goto(2)}
        />
      ) : null}

      {step === 2 ? (
        <BrandStep
          websiteUrl={websiteUrl}
          setWebsiteUrl={setWebsiteUrl}
          baseTokens={baseTokens}
          setBaseTokens={setBaseTokens}
          hex={hex}
          setHex={setHex}
          effectiveTokens={effectiveTokens}
          designFetcher={designFetcher}
          onNext={() => goto(3)}
          onBack={() => goto(1)}
        />
      ) : null}

      {step === 3 ? (
        <GoalStep
          name={name}
          setName={setName}
          goalPrompt={goalPrompt}
          setGoalPrompt={setGoalPrompt}
          questionCount={questionCount}
          setQuestionCount={setQuestionCount}
          tone={tone}
          setTone={setTone}
          goals={goals}
          setGoals={setGoals}
          experienceType={experienceType}
          setExperienceType={setExperienceType}
          brandVoiceName={brandVoiceName}
          onNext={() => goto(4)}
          onBack={() => goto(2)}
        />
      ) : null}

      {step === 4 ? (
        <IncentiveStep
          emailGate={emailGate}
          setEmailGate={setEmailGate}
          collectEmailOnResult={collectEmailOnResult}
          setCollectEmailOnResult={setCollectEmailOnResult}
          placement={placement}
          setPlacement={setPlacement}
          onNext={() => goto(5)}
          onBack={() => goto(3)}
        />
      ) : null}

      {step === 5 ? (
        <Form method="post" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input type="hidden" name="name" value={name} />
          <input type="hidden" name="goalPrompt" value={goalPrompt} />
          <input type="hidden" name="experienceType" value={experienceType} />
          <input type="hidden" name="goals" value={goals.join(",")} />
          <input type="hidden" name="questionCount" value={questionCount} />
          <input type="hidden" name="tone" value={tone} />
          {emailGate ? <input type="hidden" name="emailGate" value="on" /> : null}
          {collectEmailOnResult ? (
            <input type="hidden" name="collectEmailOnResult" value="on" />
          ) : null}
          <input type="hidden" name="placement" value={placement} />
          {websiteUrl.trim() ? <input type="hidden" name="websiteUrl" value={websiteUrl} /> : null}
          {effectiveTokens ? (
            <input type="hidden" name="designTokens" value={JSON.stringify(effectiveTokens)} />
          ) : null}

          {buildError ? (
            <QzBanner tone="crit" title="Build failed">
              {buildError}
            </QzBanner>
          ) : null}

          <ReviewStep
            name={name}
            goalPrompt={goalPrompt}
            questionCount={questionCount}
            tone={tone}
            emailGate={emailGate}
            collectEmailOnResult={collectEmailOnResult}
            placement={placement}
            websiteUrl={websiteUrl}
            productCount={productCount}
            building={building}
            onBack={() => goto(4)}
          />
        </Form>
      ) : null}

      {step === 1 ? (
        <p className="qz-dim" style={{ marginTop: 14, fontSize: 12.5 }}>
          Prefer to start from a blank quiz or a template?{" "}
          <Link to="/studio/new" className="qz-link">
            Use the classic builder →
          </Link>
        </p>
      ) : null}
    </QzPage>
  );
}
