import prisma from "../db.server";
import { formatDate } from "./formatDate";
import { contactSegments, type ContactSession } from "./customerSegments";

// §R-8 — shared enrichment for the Customers hub, used by BOTH the hub route
// (renders JSON) and the CSV export resource route (returns a download). Kept
// in one place so the two surfaces never drift (no-fork rule).

export interface HubContact {
  id: string;
  email: string;
  firstName: string | null;
  phone: string | null;
  capturedAt: string;
  quizId: string;
  quizName: string;
  persona: string | null;
  session: ContactSession | null;
  backInStock: boolean;
  segments: string[];
}

export async function loadCustomerContacts(shopId: string): Promise<HubContact[]> {
  const captures = await prisma.emailCapture.findMany({
    where: { quiz: { shopId } },
    orderBy: { capturedAt: "desc" },
    include: { quiz: { select: { id: true, name: true } } },
  });

  const quizIds = [...new Set(captures.map((c) => c.quizId))];
  const sessionIds = [...new Set(captures.map((c) => c.sessionId))];
  const [sessions, cats, bis] = await Promise.all([
    quizIds.length
      ? prisma.quizSession.findMany({
          where: { quizId: { in: quizIds }, sessionId: { in: sessionIds } },
          select: { quizId: true, sessionId: true, outcomeId: true, answerIds: true, matchedProductIds: true, converted: true, completedAt: true },
        })
      : Promise.resolve([]),
    prisma.category.findMany({ where: { shopId }, select: { id: true, name: true } }),
    prisma.backInStockRequest.findMany({ where: { quiz: { shopId } }, select: { email: true } }),
  ]);

  const sessMap = new Map(sessions.map((s) => [`${s.quizId}:${s.sessionId}`, s]));
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const allProductIds = [...new Set(sessions.flatMap((s) => s.matchedProductIds))];
  const products = allProductIds.length
    ? await prisma.product.findMany({ where: { shopId, productId: { in: allProductIds } }, select: { productId: true, title: true } })
    : [];
  const prodTitle = new Map(products.map((p) => [p.productId, p.title]));
  const bisEmails = new Set(bis.map((b) => b.email.toLowerCase()));

  return captures.map((c) => {
    const s = sessMap.get(`${c.quizId}:${c.sessionId}`);
    const session: ContactSession | null = s
      ? {
          persona: s.outcomeId ? catName.get(s.outcomeId) ?? null : null,
          answerCount: s.answerIds.length,
          matchedCount: s.matchedProductIds.length,
          recommended: s.matchedProductIds.map((id) => prodTitle.get(id)).filter((t): t is string => !!t).slice(0, 8),
          converted: s.converted,
          completed: s.completedAt != null,
        }
      : null;
    const backInStock = bisEmails.has(c.email.toLowerCase());
    return {
      id: c.id,
      email: c.email,
      firstName: c.firstName,
      phone: c.phone,
      capturedAt: c.capturedAt.toISOString(),
      quizId: c.quiz.id,
      quizName: c.quiz.name,
      persona: session?.persona ?? null,
      session,
      backInStock,
      segments: contactSegments({ session, backInStock }),
    };
  });
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function contactsToCsv(contacts: HubContact[], segment: string): string {
  const rows = segment === "all" ? contacts : contacts.filter((c) => c.segments.includes(segment));
  const header = ["Email", "Name", "Phone", "Quiz", "Persona", "Recommended", "Status", "Captured"];
  const lines = [header.join(",")];
  for (const r of rows) {
    const status = r.session?.converted ? "Bought" : r.session && !r.session.completed ? "Abandoned" : r.session ? "No purchase yet" : "—";
    lines.push([
      r.email,
      r.firstName ?? "",
      r.phone ?? "",
      r.quizName,
      r.persona ?? "",
      (r.session?.recommended ?? []).join("; "),
      status,
      formatDate(r.capturedAt),
    ].map((v) => csvCell(String(v))).join(","));
  }
  return lines.join("\n");
}
