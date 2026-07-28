import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Link, useFetcher, useLoaderData, useRevalidator } from "@remix-run/react";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import { QzPage } from "../components/qz";
import { loadFunnelDraft } from "../lib/funnelDraft.server";
import { listGlobalTemplates, listSavedTemplates } from "../lib/savedTemplates.server";
import { mergeTemplateOptions, categoryLabel } from "../lib/industryTemplates";
import { XTYPE_LABEL } from "../components/onboarding/stages/stagesShared";
import {
  beginTemplateCandidates,
  ensureTemplateCandidates,
  pickStarterTemplate,
  pickTemplateCandidate,
  templateGenStalled,
} from "../lib/templateCandidates.server";

// FLOW-3 (funnel-reconfig Flow 3) — the "Generate Quiz Templates" front door.
// Landing here claims/seeds the template-first draft and kicks the detached
// candidate generation (the Shape typing/types middle pass repurposed, 2-3
// generated-to-differ directions); the page polls until the cards land. The
// PORT-10 starter rail (8 industry templates + any shop-saved rows) lives here
// too — relocated from the retired Shape stage. Clicking any card enters the
// normal flow PRE-POPULATED at the recs step; the recs Continue then confirms
// via flow3-confirm (no start pop-up) straight into the question build.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const quizId = await ensureTemplateCandidates(shop);
  const { quiz, session } = await loadFunnelDraft(shop.id, quizId);
  const [saved, starters] = await Promise.all([
    listSavedTemplates(shop.id),
    listGlobalTemplates(),
  ]);
  const templates = mergeTemplateOptions(
    saved.map((t) => ({ id: t.id, name: t.name, template: t.template })),
    starters.map((t) => ({ id: t.id, name: t.name, template: t.template })),
  ).map((t) => ({
    id: t.id,
    name: t.name,
    scope: t.scope,
    category: t.category,
    angle: t.template.angle,
  }));
  const tf = session.template_first;
  return json({
    quizId,
    gen: tf?.gen ?? (session.quiz_types.length > 0 ? ("ready" as const) : ("failed" as const)),
    genError: tf?.error ?? null,
    stalled: templateGenStalled(session, quiz.updatedAt),
    candidates: session.quiz_types.map((t) => ({
      id: t.id,
      name: t.name,
      experience_type: t.experience_type,
      achieves: t.achieves,
      rationale: t.rationale,
      range: t.question_range,
    })),
    templates,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const quizId = String(form.get("quizId") ?? "");
  // Ownership gate — loadFunnelDraft 404s a foreign/unknown id before any write.
  await loadFunnelDraft(shop.id, quizId);

  if (intent === "retry-gen") {
    await beginTemplateCandidates(shop.id, quizId);
    return json({ intent, ok: true });
  }
  if (intent === "pick-candidate") {
    const res = await pickTemplateCandidate(shop, quizId, String(form.get("typeId") ?? ""));
    if (!res.ok) return json({ intent, ...res }, { status: 400 });
    return redirect(`/studio/onboarding/${quizId}`);
  }
  if (intent === "pick-template") {
    const res = await pickStarterTemplate(shop, quizId, String(form.get("templateId") ?? ""));
    if (!res.ok) return json({ intent, ...res }, { status: 400 });
    return redirect(`/studio/onboarding/${quizId}`);
  }
  return json({ intent, ok: false, error: "Unknown action" }, { status: 400 });
};

type ActionResult = { intent: string; ok: boolean; error?: string };

export default function StudioTemplates() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionResult>();
  const revalidator = useRevalidator();
  const pendingIntent =
    fetcher.state !== "idle" ? String(fetcher.formData?.get("intent") ?? "") : null;
  const pendingId =
    fetcher.state !== "idle"
      ? String(fetcher.formData?.get("typeId") ?? fetcher.formData?.get("templateId") ?? "")
      : null;
  const actionError =
    fetcher.state === "idle" && fetcher.data && fetcher.data.ok === false
      ? fetcher.data.error ?? null
      : null;

  // Poll while the detached candidate job runs (the Step1Funnel discipline:
  // the job writes the next state, the revalidate picks it up, the poll stops).
  const generating = data.gen === "picking";
  useEffect(() => {
    if (!generating) return;
    const t = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, 1500);
    return () => clearInterval(t);
  }, [generating, revalidator]);

  const retry = () =>
    fetcher.submit({ intent: "retry-gen", quizId: data.quizId }, { method: "post" });
  const retrying = pendingIntent === "retry-gen";
  const picking = pendingIntent === "pick-candidate" || pendingIntent === "pick-template";

  const own = data.templates.filter((t) => t.scope !== "starter");
  const starters = data.templates.filter((t) => t.scope === "starter");

  return (
    <QzPage>
      <div className="qz-tf-page" data-quiz-id={data.quizId}>
        <Link to="/studio" className="qz-sm-back">
          ← Back
        </Link>
        <h1 className="qz-h1" style={{ margin: "0 0 6px" }}>
          Generate quiz templates
        </h1>
        <p className="qz-muted" style={{ margin: "0 0 18px", maxWidth: 560, fontSize: 14 }}>
          Our AI drafts a few very different quiz directions from your catalog — pick one and it
          opens pre-filled, starting with the products it should recommend. Or start from a
          ready-made industry template below.
        </p>

        {actionError ? (
          <p className="qz-tf-error" role="alert">
            {actionError}
          </p>
        ) : null}

        {/* ── Generated candidates ── */}
        <h2 className="qz-label" style={{ margin: "0 0 10px" }}>
          Generated for your store
        </h2>

        {generating && data.stalled ? (
          <div className="qz-tf-banner" role="status">
            <span className="qz-tf-banner-icon" aria-hidden>◷</span>
            <div>
              <strong>This is taking longer than it should</strong>
              <p className="qz-dim" style={{ margin: 0, fontSize: 13 }}>
                The template generation seems to have stalled. Re-run it, or start from a
                ready-made template below.
              </p>
            </div>
            <button
              type="button"
              className="qz-btn qz-btn-accent qz-btn-sm"
              disabled={retrying}
              onClick={retry}
            >
              {retrying ? "Restarting…" : "Try again"}
            </button>
          </div>
        ) : generating ? (
          <div className="qz-tf-generating" role="status" aria-live="polite">
            <span className="qz-tf-spark" aria-hidden>✦</span>
            <div>
              <strong>Drafting a few very different quiz directions…</strong>
              <p className="qz-dim" style={{ margin: 0, fontSize: 13 }}>
                Reading your catalog and brand — they&rsquo;ll appear here in a moment. This page
                refreshes itself.
              </p>
            </div>
          </div>
        ) : data.gen === "failed" ? (
          <div className="qz-tf-banner" role="status">
            <span className="qz-tf-banner-icon" aria-hidden>!</span>
            <div>
              <strong>Templates weren&rsquo;t generated</strong>
              <p className="qz-dim" style={{ margin: 0, fontSize: 13 }}>
                {data.genError ??
                  "We couldn't draft template ideas just now — try again, or start from a ready-made template below."}
              </p>
            </div>
            <button
              type="button"
              className="qz-btn qz-btn-accent qz-btn-sm"
              disabled={retrying}
              onClick={retry}
            >
              {retrying ? "Retrying…" : "Try again"}
            </button>
          </div>
        ) : (
          <div className="qz-tf-grid">
            {data.candidates.map((c, i) => (
              <article key={c.id} className="qz-tf-card">
                {i === 0 ? <span className="qz-tf-ribbon">✦ Recommended</span> : null}
                <span className="qz-row qz-row-between" style={{ gap: 8, alignItems: "flex-start" }}>
                  <strong className="qz-tf-name">{c.name}</strong>
                  <span className="qz-tf-badge">
                    {XTYPE_LABEL[c.experience_type] ?? c.experience_type}
                  </span>
                </span>
                <span className="qz-tf-line">{c.achieves}</span>
                {c.rationale ? <span className="qz-tf-why">{c.rationale}</span> : null}
                <span className="qz-tf-meta">
                  {c.range.min}–{c.range.max} questions
                </span>
                <button
                  type="button"
                  className="qz-btn qz-btn-accent qz-btn-sm qz-tf-use"
                  disabled={picking}
                  onClick={() =>
                    fetcher.submit(
                      { intent: "pick-candidate", quizId: data.quizId, typeId: c.id },
                      { method: "post" },
                    )
                  }
                >
                  {pendingIntent === "pick-candidate" && pendingId === c.id
                    ? "Opening…"
                    : "Use this →"}
                </button>
              </article>
            ))}
          </div>
        )}

        {/* ── PORT-10 starter rail (relocated from the retired Shape stage) ── */}
        {own.length > 0 ? (
          <>
            <h2 className="qz-label" style={{ margin: "24px 0 4px" }}>
              Reuse a saved template
            </h2>
            <p className="qz-dim" style={{ margin: "0 0 10px", fontSize: 13 }}>
              Start from one you saved before — its settings come along.
            </p>
            <div className="qz-tf-rail">
              {own.map((t) => (
                <TemplatePill
                  key={t.id}
                  t={t}
                  glyph="♻"
                  busy={picking}
                  pending={pendingIntent === "pick-template" && pendingId === t.id}
                  onPick={() =>
                    fetcher.submit(
                      { intent: "pick-template", quizId: data.quizId, templateId: t.id },
                      { method: "post" },
                    )
                  }
                />
              ))}
            </div>
          </>
        ) : null}

        {starters.length > 0 ? (
          <>
            <h2 className="qz-label" style={{ margin: "24px 0 4px" }}>
              Start from an industry template
            </h2>
            <p className="qz-dim" style={{ margin: "0 0 10px", fontSize: 13 }}>
              Proven quiz structures by vertical — pick the closest to your store and the AI
              adapts it to your catalog.
            </p>
            <div className="qz-tf-rail" data-starter-rail>
              {starters.map((t) => (
                <TemplatePill
                  key={t.id}
                  t={t}
                  glyph="✦"
                  busy={picking}
                  pending={pendingIntent === "pick-template" && pendingId === t.id}
                  onPick={() =>
                    fetcher.submit(
                      { intent: "pick-template", quizId: data.quizId, templateId: t.id },
                      { method: "post" },
                    )
                  }
                />
              ))}
            </div>
          </>
        ) : null}
      </div>
    </QzPage>
  );
}

function TemplatePill({
  t,
  glyph,
  busy,
  pending,
  onPick,
}: {
  t: { id: string; name: string; category: string | null; angle: string };
  glyph: string;
  busy: boolean;
  pending: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      className="qz-shape-savedpill"
      disabled={busy}
      title={t.angle}
      onClick={onPick}
    >
      {pending ? (
        "Opening…"
      ) : (
        <>
          {glyph} {t.name}
          {t.category ? (
            <span className="qz-muted" style={{ marginLeft: 6, fontSize: 11.5 }}>
              {categoryLabel(t.category)}
            </span>
          ) : null}
        </>
      )}
    </button>
  );
}
