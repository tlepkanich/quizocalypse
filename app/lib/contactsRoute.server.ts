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
import { createKlaviyoSegment } from "./klaviyo.server";
import {
  quizSegmentSpecForShop,
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

/**
 * POST intent=klaviyo-segment — "Create Klaviyo segment" for the panel's
 * group. The facet and status come in the query string, exactly as the panel
 * loaded them; only the segment name is free text.
 */
export async function contactsAction(shop: { id: string }, quizId: string, request: Request): Promise<Response> {
  const form = await request.formData();
  if (form.get("intent") !== "klaviyo-segment") return json({ ok: false, error: "unknown intent" }, { status: 400 });
  const sp = new URL(request.url).searchParams;
  const { spec, defaultName } = await quizSegmentSpecForShop(shop, quizId, sp);
  const raw = form.get("name");
  const name = typeof raw === "string" && raw.trim() ? raw.trim().slice(0, 120) : defaultName;
  const result = await createKlaviyoSegment(shop.id, name, spec);
  return json(result, { status: result.ok ? 200 : result.code === "not_connected" ? 409 : 502 });
}
