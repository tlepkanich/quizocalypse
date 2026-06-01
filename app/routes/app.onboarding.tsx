import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import {
  json,
  redirect,
  unstable_createMemoryUploadHandler,
  unstable_parseMultipartFormData,
} from "@remix-run/node";
import { Form, useFetcher, useLoaderData } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { buildSeedQuiz } from "../lib/seedQuiz";
import {
  buildTemplateQuiz,
  isTemplateId,
  TEMPLATE_LIST,
} from "../lib/quizTemplates";
import { runAiOnboardingBuild } from "../lib/onboardingBuild.server";
import { buildDemoQuiz, DEMO_QUIZ_NAME } from "../lib/demoQuiz";
import { extractBrandGuidelines } from "../lib/brandExtract";
import { parseBrandGuidelinesSafe } from "../lib/brandGuidelines";
import { DesignTokens } from "../lib/quizSchema";
import type { QuizTone } from "../lib/claude";
import { mergeHexIntoTokens, type DesignTokensT } from "../lib/designTokens";
import { THEME_PRESETS } from "../lib/themePresets";
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
  QzEmbed,
} from "../components/qz";
import { OnboardingStepper } from "../components/onboarding/OnboardingStepper";
import {
  ONBOARDING_VIDEOS,
  ONBOARDING_VIDEO_TITLES,
} from "../components/onboarding/onboardingVideos";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    select: { id: true, brandGuidelines: true },
  });
  if (!shop) throw new Response("Shop not found", { status: 404 });
  const [productCount, firstCollection] = await Promise.all([
    prisma.product.count({ where: { shopId: shop.id } }),
    prisma.collection.findFirst({
      where: { shopId: shop.id },
      select: { collectionId: true },
    }),
  ]);
  return json({
    productCount,
    hasCollection: Boolean(firstCollection),
    brandVoiceName: parseBrandGuidelinesSafe(shop.brandGuidelines)?.name ?? null,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) return json({ ok: false, error: "Shop not found" }, { status: 400 });

  const contentType = request.headers.get("content-type") ?? "";

  // ── intent=extract-design (multipart logo → AI image analysis → tokens) ──
  if (contentType.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await unstable_parseMultipartFormData(
        request,
        unstable_createMemoryUploadHandler({ maxPartSize: MAX_UPLOAD_BYTES }),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      return json({ ok: false, intent: "extract-design", error: msg }, { status: 400 });
    }
    const file = form.get("file");
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
  const intent = String(form.get("intent") ?? "");

  // ── intent=template ──────────────────────────────────────────────────────
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

  // ── intent=demo (one-click feature showcase) ─────────────────────────────
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
    // Land on the Page builder so the whole flow — questions, the A/B branch,
    // and both result variants — is visible; Publish is one click away.
    return redirect(`/app/quizzes/${quiz.id}/studio?step=4`);
  }

  // ── intent=blank ─────────────────────────────────────────────────────────
  if (intent === "blank") {
    const name = String(form.get("name") ?? "").trim().slice(0, 120) || "Untitled quiz";
    const quiz = await prisma.quiz.create({
      data: { shopId: shop.id, name, status: "draft", draftJson: buildSeedQuiz(name) as never },
    });
    return redirect(`/app/quizzes/${quiz.id}/studio?step=1`);
  }

  // ── intent=build (one-shot AI build) ─────────────────────────────────────
  if (intent === "build") {
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
    let flow = { welcome_message: false, email_gate: false, mixed_input_types: false };
    try {
      const raw = form.get("flow");
      if (typeof raw === "string" && raw) {
        const p = JSON.parse(raw) as Partial<typeof flow>;
        flow = {
          welcome_message: Boolean(p.welcome_message),
          email_gate: Boolean(p.email_gate),
          mixed_input_types: Boolean(p.mixed_input_types),
        };
      }
    } catch {
      // keep defaults
    }
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
      const result = await runAiOnboardingBuild({
        shopId: shop.id,
        name,
        goalPrompt,
        questionCount,
        tone,
        flow,
        designTokens,
      });
      return json({
        ok: true,
        intent: "build" as const,
        quizId: result.quizId,
        degraded: result.degraded ?? null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return json({ ok: false, intent: "build", error: msg }, { status: 500 });
    }
  }

  return json({ ok: false, error: "Unknown intent" }, { status: 400 });
};

type ExtractResp = { ok: boolean; intent?: string; tokens?: DesignTokensT | null; brandName?: string; error?: string };
type BuildResp = { ok: boolean; intent?: string; quizId?: string; degraded?: string | null; error?: string };

export default function Onboarding() {
  const data = useLoaderData<typeof loader>();
  const [step, setStep] = useState(1);
  const [maxReached, setMaxReached] = useState(1);

  const [name, setName] = useState("");
  const [goalPrompt, setGoalPrompt] = useState("");
  const [questionCount, setQuestionCount] = useState(6);
  const [tone, setTone] = useState<QuizTone>("friendly");
  const [emailGate, setEmailGate] = useState(false);
  const [baseTokens, setBaseTokens] = useState<DesignTokensT | null>(null);
  const [hex, setHex] = useState("");

  const designFetcher = useFetcher<ExtractResp>();
  const buildFetcher = useFetcher<BuildResp>();

  const goto = (n: number) => {
    setStep(n);
    setMaxReached((m) => Math.max(m, n));
  };

  // Adopt logo-extracted tokens into the design state.
  useEffect(() => {
    if (designFetcher.state === "idle" && designFetcher.data?.ok && designFetcher.data.tokens) {
      setBaseTokens(designFetcher.data.tokens);
    }
  }, [designFetcher.state, designFetcher.data]);

  const effectiveTokens = useMemo(
    () => (hex.trim() ? mergeHexIntoTokens(baseTokens, hex) : baseTokens),
    [baseTokens, hex],
  );

  const submitBuild = () => {
    const fd = new FormData();
    fd.set("intent", "build");
    fd.set("name", name);
    fd.set("goalPrompt", goalPrompt);
    fd.set("questionCount", String(questionCount));
    fd.set("tone", tone);
    fd.set("flow", JSON.stringify({ email_gate: emailGate, welcome_message: false, mixed_input_types: false }));
    if (effectiveTokens) fd.set("designTokens", JSON.stringify(effectiveTokens));
    buildFetcher.submit(fd, { method: "POST" });
  };

  const building = buildFetcher.state !== "idle";
  const built = buildFetcher.data?.ok && buildFetcher.data.quizId ? buildFetcher.data : null;
  const vKey = (["start", "about", "design", "build"] as const)[step - 1] ?? "start";

  return (
    <QzPage>
      <TitleBar title="Get started" />
      <QzPageHeader
        eyebrow="Guided setup"
        title="Let's build your first quiz"
        subtitle="Pick a template to start fast, or let AI build a quiz from your catalog in a couple of minutes."
      />

      <OnboardingStepper current={step} maxReached={maxReached} onJump={goto} />

      {!data.hasCollection ? (
        <div style={{ marginBottom: 16 }}>
          <QzBanner tone="warn" title="No Shopify collections synced yet">
            Templates and AI build work best with at least one collection — they power result-page
            fallbacks and product mapping. You can still continue and refine later.
          </QzBanner>
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.5fr) minmax(0, 1fr)", gap: 24, alignItems: "start" }}>
        <div style={{ minWidth: 0 }}>
          {step === 1 ? (
            <StartStep onAi={() => goto(2)} />
          ) : step === 2 ? (
            <AboutStep
              {...{ name, setName, goalPrompt, setGoalPrompt, questionCount, setQuestionCount, tone, setTone, emailGate, setEmailGate }}
              brandVoiceName={data.brandVoiceName}
              onNext={() => goto(3)}
              onBack={() => goto(1)}
            />
          ) : step === 3 ? (
            <DesignStep
              designFetcher={designFetcher}
              baseTokens={baseTokens}
              setBaseTokens={setBaseTokens}
              hex={hex}
              setHex={setHex}
              effectiveTokens={effectiveTokens}
              onNext={() => goto(4)}
              onBack={() => goto(2)}
            />
          ) : (
            <BuildStep
              name={name}
              goalPrompt={goalPrompt}
              questionCount={questionCount}
              tone={tone}
              emailGate={emailGate}
              productCount={data.productCount}
              building={building}
              built={built}
              error={buildFetcher.data && buildFetcher.data.ok === false ? buildFetcher.data.error : null}
              onBuild={submitBuild}
              onBack={() => goto(3)}
            />
          )}
        </div>

        {/* video-per-step rail */}
        <QzCard style={{ padding: 16, position: "sticky", top: 12 }}>
          <div className="qz-label" style={{ marginBottom: 10 }}>
            {ONBOARDING_VIDEO_TITLES[vKey]}
          </div>
          <QzEmbed
            url={ONBOARDING_VIDEOS[vKey]}
            title={ONBOARDING_VIDEO_TITLES[vKey]}
            caption="A short walkthrough for this step."
          />
        </QzCard>
      </div>
    </QzPage>
  );
}

// ── Step 1: Start ────────────────────────────────────────────────────────────
function StartStep({ onAi }: { onAi: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <QzCard style={{ padding: 18 }}>
        <div className="qz-row qz-row-between" style={{ alignItems: "center", gap: 12 }}>
          <div>
            <strong style={{ fontSize: 16 }}>Build with AI</strong>
            <div className="qz-dim" style={{ fontSize: 13, marginTop: 2 }}>
              Answer a few questions and AI builds the quiz — questions, logic, product mapping, and copy — from your catalog.
            </div>
          </div>
          <QzButton variant="primary" onClick={onAi}>
            Start with AI →
          </QzButton>
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
  );
}

// ── Step 2: About ────────────────────────────────────────────────────────────
function AboutStep(props: {
  name: string;
  setName: (v: string) => void;
  goalPrompt: string;
  setGoalPrompt: (v: string) => void;
  questionCount: number;
  setQuestionCount: (v: number) => void;
  tone: QuizTone;
  setTone: (v: QuizTone) => void;
  emailGate: boolean;
  setEmailGate: (v: boolean) => void;
  brandVoiceName: string | null;
  onNext: () => void;
  onBack: () => void;
}) {
  const canNext = props.goalPrompt.trim().length > 0;
  return (
    <QzCard style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 className="qz-h1" style={{ margin: 0 }}>Tell us about your quiz</h2>
      {props.brandVoiceName ? (
        <QzBadge tone="ok">Brand voice: {props.brandVoiceName}</QzBadge>
      ) : null}
      <QzField label="Quiz name">
        <QzInput value={props.name} onChange={(e) => props.setName(e.target.value)} placeholder="e.g. Find your skincare routine" />
      </QzField>
      <QzField label="What should this quiz help shoppers do?" hint="The clearer the goal, the better the questions AI writes.">
        <QzTextarea
          value={props.goalPrompt}
          onChange={(e) => props.setGoalPrompt(e.target.value)}
          placeholder="e.g. Help shoppers find the right moisturizer for their skin type and concerns."
          rows={3}
        />
      </QzField>
      <QzField label={`How many questions? (${props.questionCount})`} hint="5–8 works best for completion.">
        <input
          type="range"
          min={5}
          max={8}
          value={props.questionCount}
          onChange={(e) => props.setQuestionCount(Number(e.target.value))}
          style={{ width: 220 }}
        />
      </QzField>
      <QzField label="Tone">
        <QzSelect value={props.tone} onChange={(e) => props.setTone(e.target.value as QuizTone)}>
          <option value="friendly">Friendly</option>
          <option value="editorial">Editorial</option>
          <option value="playful">Playful</option>
          <option value="professional">Professional</option>
        </QzSelect>
      </QzField>
      <label style={{ display: "inline-flex", gap: 8, alignItems: "center", fontSize: 13 }}>
        <input type="checkbox" checked={props.emailGate} onChange={(e) => props.setEmailGate(e.target.checked)} />
        Capture emails before showing results (incentive: grow your list)
      </label>
      <div className="qz-row qz-row-between" style={{ marginTop: 4 }}>
        <QzButton size="sm" variant="ghost" onClick={props.onBack}>← Back</QzButton>
        <QzButton size="sm" variant="primary" disabled={!canNext} onClick={props.onNext} title={!canNext ? "Add a goal to continue" : undefined}>
          Next: Design →
        </QzButton>
      </div>
    </QzCard>
  );
}

// ── Step 3: Design ───────────────────────────────────────────────────────────
function DesignStep(props: {
  designFetcher: ReturnType<typeof useFetcher<ExtractResp>>;
  baseTokens: DesignTokensT | null;
  setBaseTokens: (t: DesignTokensT | null) => void;
  hex: string;
  setHex: (v: string) => void;
  effectiveTokens: DesignTokensT | null;
  onNext: () => void;
  onBack: () => void;
}) {
  const { designFetcher } = props;
  const extracting = designFetcher.state !== "idle";
  const colors = props.effectiveTokens?.colors ?? {};
  const swatches: Array<[string, string | undefined]> = [
    ["Primary", colors.primary],
    ["Accent", colors.accent],
    ["Background", colors.background],
    ["Text", colors.text],
  ];

  return (
    <QzCard style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 className="qz-h1" style={{ margin: 0 }}>Make it yours</h2>
      <p className="qz-dim" style={{ margin: 0, fontSize: 13 }}>
        Drop your logo and AI reads your brand colors — or pick a starting look. Optional; you can fully restyle in the builder.
      </p>

      <designFetcher.Form method="post" encType="multipart/form-data">
        <QzField label="Upload your logo" hint="PNG or JPG. AI extracts your palette.">
          <input
            type="file"
            name="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => {
              if (e.target.files?.length) designFetcher.submit(e.target.form);
            }}
          />
        </QzField>
      </designFetcher.Form>
      {extracting ? <span className="qz-dim" style={{ fontSize: 12 }}>Reading your logo…</span> : null}
      {designFetcher.data && designFetcher.data.ok === false ? (
        <QzBanner tone="warn" title="Couldn't read that image">{designFetcher.data.error}</QzBanner>
      ) : null}

      <QzField label="Primary brand color" hint="Overrides the primary color above.">
        <div className="qz-row" style={{ gap: 8, alignItems: "center" }}>
          <input type="color" value={props.hex || "#2a6df4"} onChange={(e) => props.setHex(e.target.value)} style={{ width: 40, height: 32, border: "none", background: "none" }} />
          <div style={{ width: 120 }}>
            <QzInput value={props.hex} onChange={(e) => props.setHex(e.target.value)} placeholder="#2a6df4" />
          </div>
        </div>
      </QzField>

      <div>
        <div className="qz-label" style={{ marginBottom: 8 }}>Or pick a starting look</div>
        <div className="qz-row" style={{ gap: 8, flexWrap: "wrap" }}>
          {THEME_PRESETS.map((p) => (
            <button
              key={p.id}
              className="qz-btn qz-btn-ghost qz-btn-sm"
              onClick={() => props.setBaseTokens(p.tokens)}
              title={p.description}
            >
              {p.name}
            </button>
          ))}
          {props.baseTokens || props.hex ? (
            <button className="qz-btn qz-btn-ghost qz-btn-sm" onClick={() => { props.setBaseTokens(null); props.setHex(""); }}>
              Clear
            </button>
          ) : null}
        </div>
      </div>

      {props.effectiveTokens ? (
        <div className="qz-row" style={{ gap: 14, flexWrap: "wrap" }}>
          {swatches.map(([label, val]) =>
            val ? (
              <div key={label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: val, border: "1px solid #00000018" }} />
                <span className="qz-dim" style={{ fontSize: 10.5 }}>{label}</span>
              </div>
            ) : null,
          )}
        </div>
      ) : null}

      <div className="qz-row qz-row-between" style={{ marginTop: 4 }}>
        <QzButton size="sm" variant="ghost" onClick={props.onBack}>← Back</QzButton>
        <QzButton size="sm" variant="primary" onClick={props.onNext}>Next: Build →</QzButton>
      </div>
    </QzCard>
  );
}

// ── Step 4: Build ────────────────────────────────────────────────────────────
function BuildStep(props: {
  name: string;
  goalPrompt: string;
  questionCount: number;
  tone: QuizTone;
  emailGate: boolean;
  productCount: number;
  building: boolean;
  built: BuildResp | null;
  error: string | null | undefined;
  onBuild: () => void;
  onBack: () => void;
}) {
  if (props.built) {
    return (
      <QzCard style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
        <h2 className="qz-h1" style={{ margin: 0 }}>Your quiz is ready 🎉</h2>
        {props.built.degraded ? (
          <QzBanner tone="default" title="A couple of things to finish">{props.built.degraded}</QzBanner>
        ) : (
          <p className="qz-dim" style={{ margin: 0 }}>
            AI grouped your products, wrote the questions, wired the logic, and applied your brand look.
          </p>
        )}
        <div>
          <a className="qz-btn qz-btn-primary" href={`/app/quizzes/${props.built.quizId}/studio?step=5`}>
            Open in Studio →
          </a>
        </div>
      </QzCard>
    );
  }

  return (
    <QzCard style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 className="qz-h1" style={{ margin: 0 }}>Ready to build</h2>
      <ul className="qz-dim" style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
        <li><strong>{props.name || "Your quiz"}</strong> · {props.questionCount} questions · {props.tone} tone{props.emailGate ? " · email capture" : ""}</li>
        <li>Goal: {props.goalPrompt || <em>none set</em>}</li>
        <li>AI will discover product buckets, write questions, wire routing, and apply your design.</li>
      </ul>
      {props.productCount < 5 ? (
        <QzBanner tone="warn" title="Small catalog">
          You have {props.productCount} products synced. AI builds best with 5+ — we’ll still create a starter quiz you can grow.
        </QzBanner>
      ) : null}
      {props.error ? <QzBanner tone="crit" title="Build failed">{props.error}</QzBanner> : null}
      {props.building ? (
        <QzBanner tone="default" title="Building your quiz…">
          This takes about 30 seconds — analyzing your catalog and writing questions.
        </QzBanner>
      ) : null}
      <div className="qz-row qz-row-between">
        <QzButton size="sm" variant="ghost" onClick={props.onBack} disabled={props.building}>← Back</QzButton>
        <QzButton variant="primary" onClick={props.onBuild} disabled={props.building}>
          {props.building ? "Building…" : "Build my quiz →"}
        </QzButton>
      </div>
    </QzCard>
  );
}
