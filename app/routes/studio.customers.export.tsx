import type { LoaderFunctionArgs } from "@remix-run/node";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import { loadCustomerContacts, contactsToCsv } from "../lib/customerHub.server";
import { logFor } from "../lib/log.server";

// Contacts CSV export. A resource route (no component) so returning a raw CSV
// Response never tries to render a UI (which crashed when the hub route did it
// inline). ANALYTICS P0 — the Customer Engagement tab folded into Analytics;
// this route now also serves the per-quiz Customers section:
//   ?quiz=<id>      scope to one quiz (ownership enforced by the shop filter)
//   ?segment=…      all | purchased | didnt_buy | no_match | back_in_stock |
//                   abandoned (legacy keys keep working)
// Exports are logged (shop, quiz, segment, rows) — Shopify's protected-data
// rules want an access record, not a confirmation dialog.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const params = new URL(request.url).searchParams;
  const segment = params.get("segment") ?? "all";
  const quizId = params.get("quiz");

  // loadCustomerContacts is shop-scoped, so a foreign quiz id yields 0 rows —
  // the per-quiz export can't cross shops by construction.
  let rows = await loadCustomerContacts(shop.id);
  if (quizId) rows = rows.filter((c) => c.quizId === quizId);
  switch (segment) {
    case "purchased":
      rows = rows.filter((c) => c.session?.converted);
      break;
    case "didnt_buy":
      // Matches the Analytics "Didn't buy" cohort chip: every contact who
      // hasn't purchased (what you see is what downloads).
      rows = rows.filter((c) => !c.session?.converted);
      break;
    case "no_match":
      rows = rows.filter((c) => c.session != null && c.session.completed && c.session.matchedCount === 0);
      break;
    case "back_in_stock":
      rows = rows.filter((c) => c.backInStock);
      break;
    case "abandoned":
      rows = rows.filter((c) => c.segments.includes("abandoned"));
      break;
    default:
      break; // all
  }
  const csv = contactsToCsv(rows, "all");

  logFor("analytics").info(
    { shopId: shop.id, quizId: quizId ?? null, segment, rows: rows.length },
    "contacts export",
  );

  // UTF-8 BOM so Excel opens accented names correctly.
  return new Response(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="contacts-${quizId ?? "all"}-${segment}.csv"`,
    },
  });
};
