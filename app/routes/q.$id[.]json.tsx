import type { LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";

// Public quiz JSON for the storefront runtime.
// CDN-cacheable; CORS-open so the same payload can be loaded from any storefront.
export const loader = async ({ params }: LoaderFunctionArgs) => {
  const { id } = params;
  if (!id) return new Response("missing id", { status: 400 });

  const quiz = await prisma.quiz.findFirst({
    where: { id },
    select: { publishedJson: true, status: true },
  });
  if (!quiz || !quiz.publishedJson) {
    return new Response("not found", { status: 404 });
  }

  return new Response(JSON.stringify(quiz.publishedJson), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=60, stale-while-revalidate=300",
      "access-control-allow-origin": "*",
    },
  });
};
