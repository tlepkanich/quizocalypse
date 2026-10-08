import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import prisma from "../db.server";
import { Quiz } from "./quizSchema";
import { quizContactsForShop, quizContactEmailsForShop, quizContactsCsvForShop, quizResponsesCsvForShop } from "./quizContacts.server";

// The contacts panel (ANALYTICS-HANDOFF.md, Data work 5 + 7): server-side
// facets over EVERY contact, facts on the whole group, chip counts after the
// consent switch, full emails only in the export and the copy.

vi.mock("../db.server", () => ({
  default: {
    quiz: { findFirst: vi.fn() },
    event: { findMany: vi.fn(), findFirst: vi.fn() },
    quizSession: { findMany: vi.fn() },
    emailCapture: { findMany: vi.fn() },
    product: { findMany: vi.fn() },
    backInStockRequest: { findMany: vi.fn() },
    category: { findMany: vi.fn() },
  },
}));

const p = prisma as unknown as {
  quiz: { findFirst: Mock };
  event: { findMany: Mock; findFirst: Mock };
  quizSession: { findMany: Mock };
  emailCapture: { findMany: Mock };
  product: { findMany: Mock };
  backInStockRequest: { findMany: Mock };
  category: { findMany: Mock };
};

const DOC = Quiz.parse({
  quiz_id: "qz1",
  status: "published",
  scope: { collection_ids: [] },
  nodes: [
    { id: "i1", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
    {
      id: "q1",
      type: "question",
      position: { x: 1, y: 0 },
      data: {
        text: "Skin type?",
        question_type: "single_select",
        answers: [
          { id: "a1", text: "Dry", tags: [], edge_handle_id: "h1" },
          { id: "a2", text: "=Oily", tags: [], edge_handle_id: "h2" },
        ],
      },
    },
    { id: "r1", type: "result", position: { x: 2, y: 0 }, data: { headline: "Your set", fallback_collection_id: "c" } },
  ],
  edges: [
    { id: "e1", source: "i1", target: "q1" },
    { id: "e2", source: "q1", target: "r1" },
  ],
});

const T = new Date("2026-09-01T00:00:00Z");
const ev = (sessionId: string, eventType: string, payload: unknown = {}) => ({ sessionId, eventType, payload, ts: T });
const SIDS = ["s1", "s2", "s3", "s4"];
const EVENTS = [
  ...SIDS.map((s) => ev(s, "quiz_engaged")),
  ...SIDS.map((s) => ev(s, "quiz_completed")),
  ev("s1", "question_answered", { question_id: "q1", answer_ids: ["a1"] }),
  ev("s2", "question_answered", { question_id: "q1", answer_ids: ["a1"] }),
  ev("s3", "question_answered", { question_id: "q1", answer_ids: ["a2"] }),
  ev("s4", "question_answered", { question_id: "q1", answer_ids: ["a1"] }),
  ...SIDS.map((s) => ev(s, "recommendation_viewed", { result_node_id: "r1", product_ids: ["p1"] })),
  ev("s2", "add_to_cart", { product_id: "p1" }),
  ev("s1", "order_attributed", { order_id: "o1", total_price: "20.00", currency: "USD" }),
];
const cap = (sid: string, email: string, consent: boolean | null) => ({
  id: `c-${sid}`,
  sessionId: sid,
  email,
  capturedAt: T,
  marketingConsent: consent,
});

beforeEach(() => {
  vi.clearAllMocks();
  p.quiz.findFirst.mockResolvedValue({ id: "qz1", name: "Skin", status: "published", publishedJson: DOC, draftJson: null });
  p.event.findMany.mockImplementation((q: { where: Record<string, unknown> }) =>
    Promise.resolve(
      q.where.eventType === "quiz_engaged" && !("sessionId" in q.where) ? SIDS.map((sessionId) => ({ sessionId })) : EVENTS,
    ),
  );
  p.event.findFirst.mockResolvedValue(null);
  p.quizSession.findMany.mockResolvedValue(
    SIDS.map((sid) => ({
      sessionId: sid,
      outcomeId: "r1",
      answerIds: [],
      matchedProductIds: sid === "s3" ? ["p2"] : ["p1"],
      converted: sid === "s1",
      completedAt: T,
    })),
  );
  p.emailCapture.findMany.mockResolvedValue([
    cap("s1", "amy@example.com", true),
    cap("s2", "bo@example.com", true),
    cap("s3", "cy@example.com", false),
    cap("s4", "di@example.com", null),
  ]);
  p.product.findMany.mockResolvedValue([{ productId: "p1", title: "Hydra Cream", imageUrl: null, handle: null }]);
  p.backInStockRequest.findMany.mockResolvedValue([]);
  p.category.findMany.mockResolvedValue([]);
});

const run = (qs: string) => quizContactsForShop({ id: "shop1" }, "qz1", new URLSearchParams(`r=90d&${qs}`));

describe("contacts panel", () => {
  it("an answer opens on exactly the shoppers who picked it", async () => {
    const d = await run("facet=answer&id=a1");
    expect(d.title).toEqual({ eyebrow: "Skin type?", name: "Dry" });
    expect(d.stat).toEqual({ label: "Picked this", value: 3 });
    expect(d.facts).toEqual({ contacts: 3, consent: 2, bought: 1 });
    expect(d.statusCounts).toEqual({ all: 3, bought: 1, added: 1, "no-purchase": 1 });
    expect(d.rows.map((r) => r.emailMasked[0]).sort()).toEqual(["a", "b", "d"]);
    // Never a full email on screen.
    for (const local of ["amy@", "bo@", "di@"]) expect(JSON.stringify(d)).not.toContain(local);
  });

  it("the consent switch narrows the chip counts and rows, not the facts", async () => {
    const d = await run("facet=answer&id=a1&consent=1");
    expect(d.facts.contacts).toBe(3);
    expect(d.statusCounts).toEqual({ all: 2, bought: 1, added: 1, "no-purchase": 0 });
    expect(d.total).toBe(2);
  });

  it("a status chip filters the rows", async () => {
    const d = await run("facet=answer&id=a1&status=added");
    expect(d.total).toBe(1);
    expect(d.rows[0]!.status).toBe("added");
  });

  it("a result and a recommended product filter server-side", async () => {
    const r = await run("facet=result&id=r1");
    expect(r.title.name).toBe("Your set");
    expect(r.stat).toEqual({ label: "Got this result", value: 4 });
    expect(r.resultOrders).toBe(1);
    const prod = await run("facet=product&id=p1");
    expect(prod.title).toEqual({ eyebrow: "Recommended product", name: "Hydra Cream" });
    expect(prod.total).toBe(3);
  });

  it("everyone who left an email, paged", async () => {
    const d = await run("limit=2&offset=2");
    expect(d.total).toBe(4);
    expect(d.rows).toHaveLength(2);
    expect(d.stat).toEqual({ label: "Finished", value: 4 });
  });

  it("an unknown answer is a 404, not an empty list", async () => {
    await expect(run("facet=answer&id=nope")).rejects.toBeInstanceOf(Response);
  });
});

describe("copy and export", () => {
  it("Copy emails returns the full emails of the panel's list", async () => {
    const emails = await quizContactEmailsForShop({ id: "shop1" }, "qz1", new URLSearchParams("r=90d&facet=answer&id=a1&consent=1"));
    expect(emails.sort()).toEqual(["amy@example.com", "bo@example.com"]);
  });

  it("the CSV carries full emails, answers and consent, with formula cells neutralised", async () => {
    const { csv, rows } = await quizContactsCsvForShop({ id: "shop1" }, "qz1", new URLSearchParams("r=90d"));
    expect(rows).toBe(4);
    const lines = csv.replace(/^﻿/, "").split("\n");
    expect(lines[0]).toBe("Email,Captured,Result,Status,Marketing consent,Value,Recommended,Skin type?");
    expect(csv).toContain("cy@example.com");
    expect(csv).toContain("'=Oily");
    expect(csv).toContain("Not asked");
  });

  it("the responses CSV carries every response", async () => {
    const { rows, csv } = await quizResponsesCsvForShop({ id: "shop1" }, "qz1", new URLSearchParams("r=90d"));
    expect(rows).toBe(4);
    expect(csv.split("\n")[0]).toContain("Skin type?");
  });
});
