import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import { quizAnalyticsForShop } from "../lib/quizAnalytics.server";
import { QzPage, QzPageHeader, QzBadge } from "../components/qz";
import { QuizAnalyticsView } from "../components/analytics/QuizAnalyticsView";

// ANALYTICS P0 (spec Screen 2/3) — one quiz in seven sections. This route is a
// thin shell: auth + the shared seam + the shared view. The SAME view is what
// the Main Builder will host, so nothing here may grow surface-specific
// logic — fix things in quizAnalyticsForShop / QuizAnalyticsView instead.
// `$id_` de-nests it from the editor route.
export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const { id } = params;
  if (!id) throw new Response("Missing quiz id", { status: 400 });
  const url = new URL(request.url);
  return json({ data: await quizAnalyticsForShop(shop, id, url.searchParams) });
};

export default function StudioQuizAnalytics() {
  const { data } = useLoaderData<typeof loader>();
  return (
    <QzPage width="wide">
      <QzPageHeader
        eyebrow={
          <Link to={`/studio/${data.quiz.id}`} className="qz-link">
            ← {data.quiz.name}
          </Link>
        }
        title="Analytics"
        actions={
          <QzBadge tone={data.quiz.status === "published" ? "ok" : "draft"}>
            {data.quiz.status === "published" ? "Live" : "Draft"}
          </QzBadge>
        }
      />
      <QuizAnalyticsView data={data} surface="studio" exportBase="/studio/customers/export" />
    </QzPage>
  );
}
