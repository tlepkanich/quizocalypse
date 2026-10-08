// The contacts panel and the contacts exports (ANALYTICS-HANDOFF.md, Data
// work 5 and 7). Every number on the analytics page that opens the panel
// opens it HERE, server-side, over every contact in the range — never over a
// capped list shipped to the browser.
//
// The group is cut by one facet (an answer, a result, a recommended product,
// or everyone who left an email), then by the panel's two controls: the
// status chips and "Marketing consent only". Facts describe the whole group;
// chip counts follow the consent switch; rows follow both. Screens show masked
// emails; the CSV export and "Copy emails" carry them in full.
//
// Both admin surfaces call this after their own auth; the shop scope is
// enforced by loadQuizCohort (a foreign quiz id 404s).

import { z } from "zod";
import { loadQuizCohort, maskEmail } from "./quizAnalytics.server";
import type { CohortContact, ContactStatus } from "./analyticsCohort";
import { formatDate } from "./formatDate";
import { defaultSegmentName, segmentRules, type SegmentSpec } from "./klaviyoSegment";
import { NO_MATCH_RESULT_ID } from "./sessionResult";

export const CONTACTS_PAGE = 40;
const MAX_PAGE = 500;

export const ContactsQuery = z.object({
  facet: z.enum(["all", "answer", "result", "product"]).catch("all"),
  /** answerId / resultId / productId for the facet. */
  id: z.string().max(200).optional(),
  status: z.enum(["all", "bought", "added", "no-purchase"]).catch("all"),
  consent: z.boolean(),
  /** The Contact list's extra chips. */
  segment: z.enum(["all", "purchased", "didnt_buy", "no_match", "back_in_stock"]).catch("all"),
  offset: z.number().int().min(0).catch(0),
  limit: z.number().int().min(1).max(MAX_PAGE).catch(CONTACTS_PAGE),
});
export type ContactsQuery = z.infer<typeof ContactsQuery>;

export function parseContactsQuery(sp: URLSearchParams): ContactsQuery {
  return ContactsQuery.parse({
    facet: sp.get("facet") ?? "all",
    id: sp.get("id") ?? undefined,
    status: sp.get("status") ?? "all",
    consent: sp.get("consent") === "1",
    segment: sp.get("segment") ?? "all",
    offset: Number(sp.get("offset") ?? 0),
    limit: Number(sp.get("limit") ?? CONTACTS_PAGE),
  });
}

export interface ContactsPanelRow {
  id: string;
  emailMasked: string;
  capturedAt: string;
  result: string | null;
  noMatch: boolean;
  status: ContactStatus;
  consent: boolean | null;
  value: string | null;
}

export interface ContactsPanelData {
  title: { eyebrow: string; name: string };
  /** The group's own size: "Picked this", "Got this result", "Shown to", "Finished". */
  stat: { label: string; value: number } | null;
  facts: { contacts: number; consent: number; bought: number };
  /** After the consent switch, before the status chip. */
  statusCounts: Record<"all" | ContactStatus, number>;
  /** Orders that came from a result, for the note tying orders to contacts. */
  resultOrders: number | null;
  /** "Create Klaviyo segment": the rules in words, a name, and who matches today. */
  segment: { rules: string[]; defaultName: string; matchToday: number };
  rows: ContactsPanelRow[];
  /** Rows matching every filter (the page shows `rows.length` of these). */
  total: number;
  offset: number;
  limit: number;
}

type Loaded = Awaited<ReturnType<typeof loadQuizCohort>>;

/** The session's latest answer ids per question, from the cohort's events. */
function answersBySession(loaded: Loaded): Map<string, Map<string, string[]>> {
  const out = new Map<string, Map<string, { ts: number; ids: string[] }>>();
  for (const e of loaded.cohortEvents) {
    if (e.eventType !== "question_answered") continue;
    const p = e.payload as { question_id?: unknown; answer_ids?: unknown } | null;
    if (typeof p?.question_id !== "string") continue;
    const ids = Array.isArray(p.answer_ids) ? p.answer_ids.filter((x): x is string => typeof x === "string") : [];
    const per = out.get(e.sessionId) ?? new Map<string, { ts: number; ids: string[] }>();
    const prev = per.get(p.question_id);
    if (!prev || e.ts >= prev.ts) per.set(p.question_id, { ts: e.ts, ids });
    out.set(e.sessionId, per);
  }
  const flat = new Map<string, Map<string, string[]>>();
  for (const [sid, per] of out) flat.set(sid, new Map([...per].map(([q, v]) => [q, v.ids])));
  return flat;
}

interface Group {
  eyebrow: string;
  name: string;
  stat: { label: string; value: number } | null;
  members: CohortContact[];
  facet: SegmentSpec["facet"];
}

function selectGroup(loaded: Loaded, q: ContactsQuery, answers: Map<string, Map<string, string[]>>): Group {
  const { fig, doc } = loaded;
  const all = fig.contactList;
  if (q.facet === "answer" && q.id) {
    let question: { id: string; text: string } | null = null;
    let answerText = q.id;
    for (const n of doc?.nodes ?? []) {
      if (n.type !== "question") continue;
      const a = n.data.answers.find((x) => x.id === q.id);
      if (a) {
        question = { id: n.id, text: n.data.text };
        answerText = a.text;
        break;
      }
    }
    if (!question) throw new Response("Unknown answer", { status: 404 });
    const qid = question.id;
    const picked = (sid: string) => (answers.get(sid)?.get(qid) ?? []).includes(q.id!);
    let pickedAll = 0;
    for (const sid of answers.keys()) if (picked(sid)) pickedAll += 1;
    return {
      eyebrow: question.text,
      name: answerText,
      stat: { label: "Picked this", value: pickedAll },
      members: all.filter((c) => picked(c.sessionId)),
      facet: { kind: "answer", questionText: question.text, answerText },
    };
  }
  if (q.facet === "result" && q.id) {
    const row = fig.results.find((r) => r.resultId === q.id);
    const noMatch = row?.noMatch ?? false;
    return {
      eyebrow: noMatch ? "Saw no match" : "Result",
      name: row?.name ?? "Result",
      stat: row ? { label: "Got this result", value: row.finished } : null,
      members: all.filter((c) => (c.result?.resultId ?? "__not_finished__") === q.id),
      facet: { kind: "result", resultName: row?.name ?? "", noMatch: q.id === NO_MATCH_RESULT_ID },
    };
  }
  if (q.facet === "product" && q.id) {
    const title = loaded.productMetaRows.find((p) => p.productId === q.id)?.title ?? q.id;
    let shown = 0;
    for (const e of loaded.cohortEvents) {
      if (e.eventType !== "recommendation_viewed") continue;
      const p = e.payload as { stage?: unknown; product_ids?: unknown; secondary_product_ids?: unknown } | null;
      if (p?.stage === "preview") continue;
      const ids = [
        ...(Array.isArray(p?.product_ids) ? p.product_ids : []),
        ...(Array.isArray(p?.secondary_product_ids) ? p.secondary_product_ids : []),
      ];
      if (ids.includes(q.id)) shown += 1;
    }
    return {
      eyebrow: "Recommended product",
      name: title,
      stat: { label: "Shown to", value: shown },
      members: all.filter((c) => c.matchedProductIds.includes(q.id!)),
      facet: { kind: "product", productId: q.id, productTitle: title },
    };
  }
  return {
    eyebrow: "Everyone who left an email",
    name: "All contacts",
    stat: { label: "Finished", value: fig.finished },
    members: all,
    facet: { kind: "all" },
  };
}

function applySegment(loaded: Loaded, list: CohortContact[], segment: ContactsQuery["segment"]): CohortContact[] {
  switch (segment) {
    case "purchased":
      return list.filter((c) => c.status === "bought");
    case "didnt_buy":
      return list.filter((c) => c.status !== "bought");
    case "no_match":
      return list.filter((c) => c.result?.noMatch);
    case "back_in_stock": {
      const bis = new Set(loaded.bis.map((b) => b.email.toLowerCase()));
      return list.filter((c) => bis.has(c.email.toLowerCase()));
    }
    default:
      return list;
  }
}

/** The group, then the segment, consent and status filters, in that order. */
async function resolveContacts(
  shop: { id: string },
  quizId: string,
  sp: URLSearchParams,
  now: Date,
) {
  const q = parseContactsQuery(sp);
  const loaded = await loadQuizCohort(shop, quizId, sp, now);
  const answers = answersBySession(loaded);
  const group = selectGroup(loaded, q, answers);
  const segmented = applySegment(loaded, group.members, q.segment);
  const base = q.consent ? segmented.filter((c) => c.consent === true) : segmented;
  const shown = q.status === "all" ? base : base.filter((c) => c.status === q.status);
  return { q, loaded, answers, group, segmented, base, shown };
}

export async function quizContactsForShop(
  shop: { id: string },
  quizId: string,
  sp: URLSearchParams,
  now = new Date(),
): Promise<ContactsPanelData> {
  const { q, loaded, group, segmented, base, shown } = await resolveContacts(shop, quizId, sp, now);
  const statusCounts = { all: base.length, bought: 0, added: 0, "no-purchase": 0 };
  for (const c of base) statusCounts[c.status] += 1;
  const resultRow = q.facet === "result" ? loaded.fig.results.find((r) => r.resultId === q.id) : undefined;
  const spec = segmentSpecOf(loaded, group, q.status);
  // Klaviyo only ever takes people it may email: the consenting part of the
  // status group, whatever the switch says.
  const statusGroup = q.status === "all" ? segmented : segmented.filter((c) => c.status === q.status);
  return {
    title: { eyebrow: group.eyebrow, name: group.name },
    stat: group.stat,
    facts: {
      contacts: segmented.length,
      consent: segmented.filter((c) => c.consent === true).length,
      bought: segmented.filter((c) => c.status === "bought").length,
    },
    statusCounts,
    resultOrders: resultRow ? resultRow.orders : null,
    segment: {
      rules: segmentRules(spec),
      defaultName: defaultSegmentName(group.name, q.status),
      matchToday: statusGroup.filter((c) => c.consent === true).length,
    },
    rows: shown.slice(q.offset, q.offset + q.limit).map((c) => ({
      id: c.captureId,
      emailMasked: maskEmail(c.email),
      capturedAt: c.capturedAt.toISOString(),
      result: c.result?.name ?? null,
      noMatch: Boolean(c.result?.noMatch),
      status: c.status,
      consent: c.consent,
      value: c.orderValue,
    })),
    total: shown.length,
    offset: q.offset,
    limit: q.limit,
  };
}

function segmentSpecOf(loaded: Loaded, group: Group, status: ContactsQuery["status"]): SegmentSpec {
  return { quizId: loaded.quiz.id, quizName: loaded.quiz.name, facet: group.facet, status };
}

/** The panel's group as a Klaviyo segment spec — built from the quiz itself,
 *  never from text the browser sends. */
export async function quizSegmentSpecForShop(
  shop: { id: string },
  quizId: string,
  sp: URLSearchParams,
  now = new Date(),
): Promise<{ spec: SegmentSpec; defaultName: string }> {
  const { q, loaded, group } = await resolveContacts(shop, quizId, sp, now);
  return { spec: segmentSpecOf(loaded, group, q.status), defaultName: defaultSegmentName(group.name, q.status) };
}

/** "Copy emails": the full emails of the panel's current list. */
export async function quizContactEmailsForShop(
  shop: { id: string },
  quizId: string,
  sp: URLSearchParams,
  now = new Date(),
): Promise<string[]> {
  const { shown } = await resolveContacts(shop, quizId, sp, now);
  return shown.map((c) => c.email);
}

function csvCell(v: string): string {
  // Formula-injection guard: spreadsheet apps execute cells that start with
  // = + - @. Prefix with ' so a shopper-typed value stays a literal string.
  const guarded = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function toCsv(rows: string[][]): string {
  // UTF-8 BOM so Excel opens accented names correctly.
  return `﻿${rows.map((r) => r.map((v) => csvCell(v)).join(",")).join("\n")}`;
}

const STATUS_LABEL: Record<ContactStatus, string> = {
  bought: "Bought",
  added: "Added, not bought",
  "no-purchase": "No purchase yet",
};

/** The panel's list (or the Contact list) as CSV: full emails, every contact. */
export async function quizContactsCsvForShop(
  shop: { id: string },
  quizId: string,
  sp: URLSearchParams,
  now = new Date(),
): Promise<{ csv: string; rows: number; filename: string }> {
  const { loaded, answers, shown } = await resolveContacts(shop, quizId, sp, now);
  const questions = (loaded.doc?.nodes ?? []).flatMap((n) =>
    n.type === "question" ? [{ id: n.id, text: n.data.text, answers: new Map(n.data.answers.map((a) => [a.id, a.text])) }] : [],
  );
  const title = new Map(loaded.productMetaRows.map((p) => [p.productId, p.title]));
  const header = ["Email", "Captured", "Result", "Status", "Marketing consent", "Value", "Recommended", ...questions.map((x) => x.text)];
  const body = shown.map((c) => {
    const per = answers.get(c.sessionId);
    return [
      c.email,
      formatDate(c.capturedAt.toISOString()),
      c.result ? c.result.name : "",
      STATUS_LABEL[c.status],
      c.consent == null ? "Not asked" : c.consent ? "Yes" : "No",
      c.orderValue ?? "",
      c.matchedProductIds.map((id) => title.get(id) ?? id).join("; "),
      ...questions.map((x) => {
        const ids = per?.get(x.id);
        if (!ids) return "";
        return ids.length ? ids.map((id) => x.answers.get(id) ?? id).join("; ") : "Skipped";
      }),
    ];
  });
  return { csv: toCsv([header, ...body]), rows: body.length, filename: `contacts-${quizId}.csv` };
}

/** Individual responses, every one of them (the screen shows ten). */
export async function quizResponsesCsvForShop(
  shop: { id: string },
  quizId: string,
  sp: URLSearchParams,
  now = new Date(),
): Promise<{ csv: string; rows: number; filename: string }> {
  const loaded = await loadQuizCohort(shop, quizId, sp, now);
  const answers = answersBySession(loaded);
  const questions = (loaded.doc?.nodes ?? []).flatMap((n) =>
    n.type === "question" ? [{ id: n.id, text: n.data.text, answers: new Map(n.data.answers.map((a) => [a.id, a.text])) }] : [],
  );
  const lastTs = new Map<string, number>();
  for (const e of loaded.cohortEvents) {
    if (e.eventType === "question_answered" && e.ts > (lastTs.get(e.sessionId) ?? 0)) lastTs.set(e.sessionId, e.ts);
  }
  const sids = [...answers.keys()].sort((a, b) => (lastTs.get(b) ?? 0) - (lastTs.get(a) ?? 0));
  const header = ["Shopper", "Date", ...questions.map((x) => x.text), "Result", "Bought"];
  const body = sids.map((sid) => {
    const per = answers.get(sid)!;
    const finished = loaded.fig.completedSet.has(sid);
    return [
      sid,
      formatDate(new Date(lastTs.get(sid) ?? 0).toISOString()),
      ...questions.map((x) => {
        const ids = per.get(x.id);
        if (!ids) return "";
        return ids.length ? ids.map((id) => x.answers.get(id) ?? id).join("; ") : "Skipped";
      }),
      finished ? loaded.fig.resultBySession.get(sid)?.name ?? "" : "Left before a result",
      loaded.fig.boughtSet.has(sid) ? "Yes" : "No",
    ];
  });
  return { csv: toCsv([header, ...body]), rows: body.length, filename: `responses-${quizId}.csv` };
}
