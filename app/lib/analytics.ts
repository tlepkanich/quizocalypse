import { z } from "zod";

// Shared schemas for the public POST /events and POST /captures endpoints.
// The storefront runtime is the only producer right now, but treating these
// as a public API forces us to validate every payload at the boundary.

export const EVENT_TYPES = [
  "quiz_started",
  "question_answered",
  "quiz_abandoned",
  "quiz_completed",
  "recommendation_viewed",
  "recommendation_clicked",
  "add_to_cart",
  "email_captured",
  "tooltip_viewed",
  // BIC P2 — fired when the shopper LEAVES the intro (clicked Start).
  // quiz_started fires on render, so started=view and engaged=interaction.
  "quiz_engaged",
  // BIC P2 — written SERVER-SIDE by the orders/create webhook per attributed
  // session: payload { order_id, total_price, currency }. Dashboards sum it
  // (deduped by order_id) into the Revenue stat. Never sent by the client,
  // but accepted by the enum so the shared Event table schema stays one list.
  "order_attributed",
  // Buddy mode (Phase L2): invited = clicked "compare with a friend";
  // completed = a shopper finished a quiz they opened via a ?buddy= link.
  "buddy_invited",
  "buddy_completed",
] as const;
export const EventType = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof EventType>;

export const EventPayload = z.object({
  quiz_id: z.string().min(1),
  session_id: z.string().min(1),
  event_type: EventType,
  payload: z.record(z.string(), z.unknown()).default({}),
  ts: z.number().int().optional(),
});

export const EventsBatch = z.object({
  events: z.array(EventPayload).min(1).max(50),
});

export const CapturePayload = z.object({
  quiz_id: z.string().min(1),
  session_id: z.string().min(1),
  email: z.string().email().max(254),
  first_name: z.string().max(100).optional(),
  phone: z.string().max(40).optional(),
});

// Server-side session write (Dev Spec §7.2). Posted from the runtime on quiz
// completion: the shopper's answers, the products matched, and the outcome page.
export const SessionPayload = z.object({
  quiz_id: z.string().min(1),
  session_id: z.string().min(1),
  outcome_id: z.string().max(200).optional(),
  answer_ids: z.array(z.string().max(200)).max(200).default([]),
  matched_product_ids: z.array(z.string().max(200)).max(200).default([]),
});

// ---- Client-side helpers (browser-only) ----

interface ClientEvent {
  quiz_id: string;
  session_id: string;
  event_type: EventType;
  payload: Record<string, unknown>;
  ts: number;
}

const FLUSH_INTERVAL_MS = 5000;

// Per-quiz analytics client. Created once per storefront load. Batches events
// and flushes via fetch (or sendBeacon on unload).
export function createAnalyticsClient(args: {
  quizId: string;
  sessionId: string;
}) {
  const queue: ClientEvent[] = [];
  let timer: ReturnType<typeof setInterval> | null = null;

  function flush(useBeacon: boolean = false) {
    if (queue.length === 0) return;
    const events = queue.splice(0, queue.length);
    const body = JSON.stringify({ events });
    if (useBeacon && typeof navigator !== "undefined" && "sendBeacon" in navigator) {
      const blob = new Blob([body], { type: "application/json" });
      navigator.sendBeacon("/events", blob);
      return;
    }
    void fetch("/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {
      // Swallow errors — analytics must never break the quiz UX.
    });
  }

  function track(type: EventType, payload: Record<string, unknown> = {}) {
    queue.push({
      quiz_id: args.quizId,
      session_id: args.sessionId,
      event_type: type,
      payload,
      ts: Date.now(),
    });
  }

  function start() {
    if (typeof window === "undefined") return;
    timer = setInterval(() => flush(false), FLUSH_INTERVAL_MS);
    window.addEventListener("pagehide", () => flush(true));
    window.addEventListener("beforeunload", () => flush(true));
  }

  function stop() {
    if (timer) clearInterval(timer);
    flush(false);
  }

  return { track, flush, start, stop };
}

export function newSessionId(): string {
  // Cryptographic randomness if available; fallback to Math.random.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
