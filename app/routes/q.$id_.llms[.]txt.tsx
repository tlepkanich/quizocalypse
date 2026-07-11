import type { LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { extractPersonaPages } from "../lib/personaSeo";

// §M9.4 — llms.txt: a clean, extractable index of this quiz's public surfaces
// (the quiz itself + every persona guide) for AI answer engines. Plain text,
// SSR, cacheable. Resource route — no component.
export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const { id } = params;
  if (!id) throw new Response("Not found", { status: 404 });
  const quiz = await prisma.quiz.findFirst({
    where: { id },
    select: { id: true, name: true, publishedJson: true },
  });
  if (!quiz?.publishedJson) throw new Response("Not found", { status: 404 });
  const raw = quiz.publishedJson as Parameters<typeof extractPersonaPages>[0];
  const pages = extractPersonaPages(raw);
  const origin = new URL(request.url).origin;
  const name = quiz.name || "Product quiz";

  const lines = [
    `# ${name}`,
    "",
    `> A guided product-match quiz. Answer a few questions to get a personalized recommendation.`,
    "",
    `- [Take the quiz](${origin}/q/${quiz.id})`,
    "",
  ];
  if (pages.length) {
    lines.push("## Result guides", "");
    for (const p of pages) {
      const desc = p.description ? `: ${p.description.replace(/\s+/g, " ").trim()}` : "";
      lines.push(`- [${p.name}](${origin}/q/${quiz.id}/persona/${p.slug})${desc}`);
    }
    lines.push("");
  }

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
};
