import { z } from "zod";

// Shared schemas for the public POST /events and POST /captures endpoints.
// The storefront runtime is the only producer right now, but treating these
// as a public API forces us to validate every payload at the boundary.

export const EVENT_TYPES = [
  "quiz_started",
  "question_answered",
  "quiz_completed",
  "recommendation_viewed",
  "recommendation_clicked",
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
