import { useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Link, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import prisma from "../db.server";
import { QzPage, QzCard } from "../components/qz";
import { parseBrandIdentitySafe } from "../lib/brandIdentity";
import { suggestQuizGoal } from "../lib/goalSuggest";
import { detectGroupingDimension } from "../lib/groupingDetect";
import { toGroupingProduct } from "../lib/bucketPersist.server";
import { MIN_GOAL_CHARS } from "../lib/funnelDraft.server";
import { beginGoalFirstFlow } from "../lib/goalPrepick.server";

// FLOW-1 (funnel-reconfig Flow 1) — the "Write Your Goal" front door. The
// merchant writes their goal BEFORE anything else; submitting claims/seeds the
// decider draft, stores the folded brief, kicks the detached AI product
// pre-pick, and lands them on the recs surface pre-populated for refinement.
// The form is the goal-brief from the start-modal's second screen (same fields,
// copy, and validation), promoted to a page.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const [products, collections, shopRow] = await Promise.all([
    prisma.product.findMany({ where: { shopId: shop.id } }),
    prisma.collection.findMany({ where: { shopId: shop.id } }),
    prisma.shop.findUnique({ where: { id: shop.id }, select: { brandIdentity: true } }),
  ]);
  const detect = detectGroupingDimension(
    products.map(toGroupingProduct),
    collections.map((c) => ({ collectionId: c.collectionId, title: c.title })),
  );
  const suggestedGoal = suggestQuizGoal({
    identitySummary: parseBrandIdentitySafe(shopRow?.brandIdentity)?.summary ?? null,
    groupNames: detect.proposed.map((g) => g.name),
  });
  // Owner 2026-07-25 — the homepage hero's goal box lands here with ?goal=
  // pre-filled so the brief (audience/factors/length) still gets collected.
  const prefillGoal = new URL(request.url).searchParams.get("goal")?.trim().slice(0, 500) ?? "";
  return json({
    suggestedGoal,
    prefillGoal,
    minGoalChars: MIN_GOAL_CHARS,
    productCount: products.length,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const form = await request.formData();
  const goal = String(form.get("goal") ?? "").trim().slice(0, 500);
  if (goal.length < MIN_GOAL_CHARS) {
    return json(
      { ok: false, error: `Add a little more detail (at least ${MIN_GOAL_CHARS} characters).` },
      { status: 400 },
    );
  }
  const audience = String(form.get("audience") ?? "").trim().slice(0, 200);
  const factors = String(form.get("factors") ?? "").trim().slice(0, 200);
  const lengthRaw = Number(form.get("length"));
  const questionLength =
    Number.isInteger(lengthRaw) && lengthRaw >= 3 && lengthRaw <= 7 ? lengthRaw : null;
  const quizId = await beginGoalFirstFlow(shop, { goal, audience, factors, questionLength });
  return redirect(`/studio/onboarding/${quizId}`);
};

export default function StudioGoal() {
  const { suggestedGoal, prefillGoal, minGoalChars, productCount } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  const [goal, setGoal] = useState(prefillGoal);
  const [audience, setAudience] = useState("");
  const [factors, setFactors] = useState("");
  const [length, setLength] = useState<number | null>(null);
  const goalRef = useRef<HTMLTextAreaElement>(null);
  const audRef = useRef<HTMLInputElement>(null);
  const facRef = useRef<HTMLInputElement>(null);
  const segRef = useRef<HTMLDivElement>(null);

  const goalOk = goal.trim().length >= minGoalChars;
  const audOk = audience.trim().length > 2;
  const facOk = factors.trim().length > 2;
  const lenOk = length !== null;
  const done = [goalOk, audOk, facOk, lenOk].filter(Boolean).length;
  // QRTZ-S1 (mock s09 rule) — the goal alone is enough to draft: audience,
  // factors AND length are optional and never block the draft.
  const ready = goalOk;
  const note = !ready
    ? "Add your goal to start"
    : done < 4
      ? "Optional — but the rest sharpens the questions"
      : "Ready to go";

  const tracker = [
    { key: "goal", label: "Goal", ok: goalOk, focus: () => goalRef.current?.focus() },
    { key: "aud", label: "Audience", ok: audOk, focus: () => audRef.current?.focus() },
    { key: "fac", label: "Factors", ok: facOk, focus: () => facRef.current?.focus() },
    {
      key: "len",
      label: "Length",
      ok: lenOk,
      focus: () => segRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }),
    },
  ];

  const start = () => {
    if (!ready) return;
    const fields: Record<string, string> = {
      goal: goal.trim(),
      audience: audience.trim(),
      factors: factors.trim(),
    };
    // Length only travels when picked — the action nulls a missing value
    // (AI decides), so an unset radiogroup never blocks the draft.
    if (length !== null) fields.length = String(length);
    submit(fields, { method: "post" });
  };

  return (
    <QzPage>
      <div className="qz-goal-page">
        <Link to="/studio" className="qz-sm-back">
          ← Back
        </Link>
        <h1 className="qz-h1" style={{ margin: "0 0 6px" }}>
          Write your goal
        </h1>
        <p className="qz-muted" style={{ margin: "0 0 18px", maxWidth: 520, fontSize: 14 }}>
          Tell us what your quiz should do — our AI picks the products it should recommend, then
          builds the questions around them. You review everything before it goes live.
        </p>

        <QzCard style={{ maxWidth: 620 }}>
          <h2 className="qz-sm-title">Describe what your quiz should do</h2>

          <div className="qz-sm-track">
            <div className="qz-sm-thead">
              <span className="qz-sm-tlbl">Your brief</span>
              <span className="qz-sm-tcnt">{done} of 4 complete</span>
            </div>
            <div className="qz-sm-tcols">
              {tracker.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className={`qz-sm-tcol${t.ok ? " is-done" : ""}`}
                  onClick={t.focus}
                >
                  <span className="qz-sm-sbar" />
                  <span className="qz-sm-titem">
                    <span className="qz-sm-c" aria-hidden>✓</span>
                    {t.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="qz-sm-field">
            <label className="qz-sm-flabel" htmlFor="qz-goal-goal">Goal</label>
            <span className="qz-sm-fhint">What the quiz helps shoppers decide.</span>
            <textarea
              id="qz-goal-goal"
              ref={goalRef}
              className="qz-sm-inp"
              value={goal}
              autoFocus
              placeholder={suggestedGoal || "Help shoppers find the right board for how and where they ride"}
              onChange={(e) => setGoal(e.target.value)}
            />
          </div>
          <div className="qz-sm-field">
            <label className="qz-sm-flabel" htmlFor="qz-goal-aud">Audience</label>
            <span className="qz-sm-fhint">Who it&rsquo;s for.</span>
            <input
              id="qz-goal-aud"
              ref={audRef}
              className="qz-sm-inp"
              value={audience}
              placeholder="First-time riders buying a starter setup"
              onChange={(e) => setAudience(e.target.value)}
            />
          </div>
          <div className="qz-sm-field">
            <label className="qz-sm-flabel" htmlFor="qz-goal-fac">Deciding factors</label>
            <span className="qz-sm-fhint">
              What makes one option right over another — terrain, skill level, price, style.
            </span>
            <input
              id="qz-goal-fac"
              ref={facRef}
              className="qz-sm-inp"
              value={factors}
              placeholder="Terrain they ride, experience level, and how much they want to spend"
              onChange={(e) => setFactors(e.target.value)}
            />
          </div>
          <div className="qz-sm-field">
            <span className="qz-sm-flabel">Length</span>
            <span className="qz-sm-fhint">How many questions. Optional — it never blocks the draft.</span>
            <div className="qz-sm-seg" ref={segRef} role="radiogroup" aria-label="How many questions">
              {[3, 4, 5, 6, 7].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={length === n}
                  className={`qz-sm-segb${length === n ? " is-on" : ""}`}
                  onClick={() => setLength(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className="qz-sm-foot">
            <button type="button" className="qz-sm-gen" disabled={!ready || busy} onClick={start}>
              {busy ? "Starting…" : "Pick my products →"}
            </button>
            <span className="qz-sm-note" aria-live="polite">{note}</span>
          </div>
        </QzCard>

        <p className="qz-dim" style={{ margin: "14px 0 0", fontSize: 12.5, maxWidth: 620 }}>
          Next: our AI picks the products your quiz should recommend
          {productCount > 0 ? ` from your ${productCount}-product catalog` : ""} — you refine the
          selection, then the questions are generated for you.
        </p>
      </div>
    </QzPage>
  );
}
