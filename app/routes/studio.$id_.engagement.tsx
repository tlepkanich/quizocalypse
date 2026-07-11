import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import prisma from "../db.server";
import { Quiz } from "../lib/quizSchema";
import { EngagementSettings, setEngagement, type EngagementSettingsT } from "../lib/engagementSchema";
import { QzPage } from "../components/qz";
import { EngagementSettingsPanel } from "../components/studio/EngagementSettingsPanel";

// §L Layer 2 — the per-quiz Engagement settings surface. Reads the quiz doc's
// engagement config + the shop's account defaults; the panel writes per-quiz
// overrides back to draftJson (bakes at publish).
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const quiz = await prisma.quiz.findFirst({
    where: { id: params.id, shopId: shop.id },
    select: { draftJson: true, name: true },
  });
  if (!quiz) throw new Response("Not found", { status: 404 });
  const parsed = Quiz.safeParse(quiz.draftJson);
  const engagement: EngagementSettingsT = parsed.success ? parsed.data.engagement ?? {} : {};
  const accountParsed = EngagementSettings.safeParse(shop.engagementDefaults ?? {});
  return json({
    engagement,
    accountDefaults: accountParsed.success ? accountParsed.data : null,
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const form = await request.formData();
  if (form.get("intent") !== "save-engagement") return json({ ok: false }, { status: 400 });

  // Audit hardening — an unparseable/invalid payload is a 400, never a silent
  // CLEAR (the old fallback treated a truncated submit as "wipe all engagement
  // settings"). A deliberate clear is an EMPTY object: it parses fine and
  // setEngagement drops the key.
  let raw: unknown;
  try {
    raw = JSON.parse(String(form.get("engagement") ?? "{}"));
  } catch {
    return json({ ok: false, error: "invalid engagement payload" }, { status: 400 });
  }
  const parsed = EngagementSettings.safeParse(raw);
  if (!parsed.success) return json({ ok: false, error: "invalid engagement payload" }, { status: 400 });

  const quiz = await prisma.quiz.findFirst({
    where: { id: params.id, shopId: shop.id },
    select: { id: true, draftJson: true },
  });
  if (!quiz) throw new Response("Not found", { status: 404 });
  // safeParse + 400, matching every neighboring draft-write path (an invalid
  // mid-gen draft must not 500).
  const parsedDoc = Quiz.safeParse(quiz.draftJson);
  if (!parsedDoc.success) {
    return json({ ok: false, error: "draft failed validation" }, { status: 400 });
  }
  const next = setEngagement(parsedDoc.data, parsed.data);
  await prisma.quiz.update({ where: { id: quiz.id }, data: { draftJson: next as never } });
  return redirect(`/studio/${params.id}/engagement`);
};

export default function StudioEngagement() {
  const { engagement, accountDefaults } = useLoaderData<typeof loader>();
  return (
    <QzPage>
      <div className="qz-formcol">
        <EngagementSettingsPanel initial={engagement} accountDefaults={accountDefaults} />
      </div>
    </QzPage>
  );
}
