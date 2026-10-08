// The one handler behind both surfaces' contacts resource routes
// (/studio/:id/analytics/contacts and /app/quizzes/:id/analytics/contacts).
// Each route authenticates and resolves its shop, then hands over here, so the
// two can't drift (CLAUDE.md: fix logic in the shared seam).
//
//   ?format=json    (default) the contacts panel: facts, chip counts, a page of rows
//   ?format=emails  "Copy emails": the panel's full emails, as JSON
//   ?format=csv     Export; ?section=contacts (default) | responses
//
// Every format follows the range (?r, ?from, ?to) and the panel's filters.
// Exports and email copies are logged (shop, quiz, kind, rows) — Shopify's
// protected-data rules want an access record.

import { json } from "@remix-run/node";
import { logFor } from "./log.server";
import {
  quizContactEmailsForShop,
  quizContactsCsvForShop,
  quizContactsForShop,
  quizResponsesCsvForShop,
} from "./quizContacts.server";

export async function contactsResource(shop: { id: string }, quizId: string, request: Request): Promise<Response> {
  const sp = new URL(request.url).searchParams;
  const format = sp.get("format") ?? "json";
  const log = logFor("analytics");

  if (format === "csv") {
    const section = sp.get("section") === "responses" ? "responses" : "contacts";
    const out =
      section === "responses"
        ? await quizResponsesCsvForShop(shop, quizId, sp)
        : await quizContactsCsvForShop(shop, quizId, sp);
    log.info({ shopId: shop.id, quizId, section, rows: out.rows }, "analytics export");
    return new Response(out.csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${out.filename}"`,
        "Cache-Control": "no-store",
      },
    });
  }
  if (format === "emails") {
    const emails = await quizContactEmailsForShop(shop, quizId, sp);
    log.info({ shopId: shop.id, quizId, rows: emails.length }, "contacts emails copied");
    return json({ emails }, { headers: { "Cache-Control": "no-store" } });
  }
  return json(await quizContactsForShop(shop, quizId, sp), { headers: { "Cache-Control": "no-store" } });
}
