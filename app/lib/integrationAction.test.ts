import type { ActionFunctionArgs } from "@remix-run/node";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import prisma from "../db.server";
import { Quiz } from "./quizSchema";
import type * as SsrfGuardModule from "./ssrfGuard.server";
import { action as integrationAction } from "../routes/q.$id.integration";

// BIC-2 D2 — behavior-level coverage for the q.$id.integration POST executor
// (the merchant-configured action runner on quiz completion). EXTENDS
// integrationSignature.test.ts, which already pins the HMAC signature header
// and the no-secret case — nothing here re-asserts those. Covered here:
// Klaviyo payloads (profile properties incl. quiz_results_url + the Completed
// Quiz event), the SSRF guard refusing private/localhost/http receivers via
// the REAL screening logic, continue_on_error semantics, and the
// validation/method 4xx matrix. Lives in app/lib per the publicWriteGuards
// precedent (route-dir test files break the Remix Vite plugin).

vi.mock("../db.server", () => ({
  default: { quiz: { findFirst: vi.fn() } },
}));

// Real sync screening (protocol / hostname denylist / IP-literal ranges), DNS
// skipped so tests stay offline. Every refusal case below is decided by the
// sync screen, so the guard behavior under test is the real thing.
vi.mock("./ssrfGuard.server", async (importOriginal) => {
  const actual = await importOriginal<typeof SsrfGuardModule>();
  return {
    ...actual,
    assertPublicHttpsUrl: vi.fn(async (url: string) => {
      const screened = actual.screenUrl(url);
      return screened.ok ? { ok: true } : { ok: false, reason: screened.reason ?? "unsafe url" };
    }),
  };
});

const p = prisma as unknown as { quiz: { findFirst: Mock } };

type ActionsInput = Array<Record<string, unknown>>;

// intro-less minimal published doc: q1 (two answers with tags) → integration
// node with configurable actions → result. No edges: forward-walk product
// resolution is out of scope here (pure-lib covered in recommendationEngine).
function publishedDoc(actions: ActionsInput, continueOnError?: boolean) {
  return Quiz.parse({
    quiz_id: "q1",
    status: "published",
    scope: { collection_ids: [] },
    nodes: [
      {
        id: "qn1",
        type: "question",
        position: { x: 0, y: 0 },
        data: {
          text: "Skin type?",
          question_type: "single_select",
          answers: [
            { id: "a_dry", text: "Dry", tags: ["dry"], edge_handle_id: "h1" },
            { id: "a_oily", text: "Oily", tags: ["oily"], edge_handle_id: "h2" },
          ],
        },
      },
      {
        id: "int1",
        type: "integration",
        position: { x: 1, y: 0 },
        data: {
          actions,
          ...(continueOnError === undefined ? {} : { continue_on_error: continueOnError }),
        },
      },
      {
        id: "res1",
        type: "result",
        position: { x: 2, y: 0 },
        data: { headline: "Your match", fallback_collection_id: "col1" },
      },
    ],
  });
}

function args(body: unknown, init?: { method?: string; raw?: string }): ActionFunctionArgs {
  const request = new Request("https://shop.example/q/q1/integration", {
    method: init?.method ?? "POST",
    headers: { "content-type": "application/json" },
    ...(init?.method === "GET" ? {} : { body: init?.raw ?? JSON.stringify(body) }),
  });
  return { request, params: { id: "q1" }, context: {} } as unknown as ActionFunctionArgs;
}

const PATH = [{ questionNodeId: "qn1", answerIds: ["a_dry"] }];

const fetchMock = vi.fn();

function fetchCallsTo(urlPart: string): Array<[string, RequestInit]> {
  return (fetchMock.mock.calls as Array<[string, RequestInit]>).filter(([url]) =>
    url.includes(urlPart),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("klaviyo action", () => {
  const KLAVIYO = { kind: "klaviyo", api_key: "pk_test_synthetic", list_id: "Xy12Ab" };

  it("upserts the profile with answers + quiz_results_url, then subscribes the list and fires the Completed Quiz event", async () => {
    p.quiz.findFirst.mockResolvedValue({ publishedJson: publishedDoc([KLAVIYO]), name: "Skin quiz" });

    const res = await integrationAction(
      args({
        nodeId: "int1",
        path: PATH,
        session_id: "3f2a9c04-77d1-4e2b-9a63-0d5b1c8e4f21",
        email: "shopper@example.com",
        name: "Sam",
        phone: "+15550100",
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, results: [{ kind: "klaviyo", ok: true, status: 200 }] });

    // Profile upsert — the primary call, with the shopper identity + grounded
    // quiz properties. The results_url carries the runtime session token.
    const [profileCall] = fetchCallsTo("/api/profile-import/");
    expect(profileCall).toBeTruthy();
    const profileInit = profileCall![1];
    expect(profileInit.method).toBe("POST");
    expect((profileInit.headers as Record<string, string>).Authorization).toBe(
      "Klaviyo-API-Key pk_test_synthetic",
    );
    const profile = JSON.parse(profileInit.body as string) as {
      data: {
        attributes: {
          email: string;
          first_name?: string;
          phone_number?: string;
          properties: Record<string, unknown>;
        };
      };
    };
    expect(profile.data.attributes.email).toBe("shopper@example.com");
    expect(profile.data.attributes.first_name).toBe("Sam");
    expect(profile.data.attributes.phone_number).toBe("+15550100");
    const props = profile.data.attributes.properties;
    expect(props.quiz_id).toBe("q1");
    expect(props.quiz_name).toBe("Skin quiz");
    expect(props.quiz_tags).toEqual(["dry"]);
    expect(props.quiz_results_url).toBe(
      "https://shop.example/q/q1/results?session_id=3f2a9c04-77d1-4e2b-9a63-0d5b1c8e4f21",
    );
    // Answers fold into per-question properties keyed by question id.
    expect(props.quiz_q_qn1).toBe("Dry");

    // Best-effort list subscription for the configured list.
    const [listCall] = fetchCallsTo("/api/lists/Xy12Ab/relationships/profiles/");
    expect(listCall).toBeTruthy();

    // The flow-trigger event carries the same grounding.
    const [eventCall] = fetchCallsTo("/api/events/");
    expect(eventCall).toBeTruthy();
    const event = JSON.parse(eventCall![1].body as string) as {
      data: {
        attributes: {
          metric: { data: { attributes: { name: string } } };
          profile: { data: { attributes: { email: string } } };
          properties: Record<string, unknown>;
        };
      };
    };
    expect(event.data.attributes.metric.data.attributes.name).toBe("Completed Quiz");
    expect(event.data.attributes.profile.data.attributes.email).toBe("shopper@example.com");
    expect(event.data.attributes.properties.quiz_tags).toEqual(["dry"]);
  });

  it("omits quiz_results_url when no session_id was sent", async () => {
    p.quiz.findFirst.mockResolvedValue({ publishedJson: publishedDoc([KLAVIYO]), name: "T" });

    await integrationAction(args({ nodeId: "int1", path: PATH, email: "shopper@example.com" }));

    const [profileCall] = fetchCallsTo("/api/profile-import/");
    const profile = JSON.parse(profileCall![1].body as string) as {
      data: { attributes: { properties: Record<string, unknown> } };
    };
    expect("quiz_results_url" in profile.data.attributes.properties).toBe(false);
  });

  it("no email captured → skips the action visibly, never calls Klaviyo, still advances (continue_on_error default)", async () => {
    p.quiz.findFirst.mockResolvedValue({ publishedJson: publishedDoc([KLAVIYO]), name: "T" });

    const res = await integrationAction(args({ nodeId: "int1", path: PATH }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; results: Array<{ ok: boolean; error?: string }> };
    expect(body.ok).toBe(true); // shopper flow advances regardless
    expect(body.results[0]!.ok).toBe(false);
    expect(body.results[0]!.error).toContain("email");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("SSRF guard on merchant webhook URLs", () => {
  it.each([
    ["https://127.0.0.1/hook", "private ip literal"],
    ["https://localhost/hook", "loopback host"],
    ["https://169.254.169.254/latest/meta-data", "private ip literal"],
    ["https://10.0.0.5/internal", "private ip literal"],
    ["http://receiver.example/hook", "not https"],
  ])("refuses %s and never fetches it", async (url, reason) => {
    p.quiz.findFirst.mockResolvedValue({
      publishedJson: publishedDoc([{ kind: "webhook", url }]),
      name: "T",
    });

    const res = await integrationAction(args({ nodeId: "int1", path: [] }));
    // Single action failed + continue_on_error default true → 200, refusal visible.
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: Array<{ ok: boolean; error?: string }> };
    expect(body.results[0]!.ok).toBe(false);
    expect(body.results[0]!.error).toBe(`blocked: ${reason}`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a blocked action does not stop later actions from firing", async () => {
    p.quiz.findFirst.mockResolvedValue({
      publishedJson: publishedDoc([
        { kind: "webhook", url: "https://127.0.0.1/evil" },
        { kind: "webhook", url: "https://receiver.example/hook" },
      ]),
      name: "T",
    });

    const res = await integrationAction(args({ nodeId: "int1", path: [] }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: Array<{ ok: boolean }> };
    expect(body.results).toHaveLength(2);
    expect(body.results[0]!.ok).toBe(false);
    expect(body.results[1]!.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe("https://receiver.example/hook");
  });
});

describe("continue_on_error semantics", () => {
  const TWO_HOOKS = [
    { kind: "webhook", url: "https://failing.example/hook" },
    { kind: "webhook", url: "https://healthy.example/hook" },
  ];

  it("true (default): a failing receiver doesn't kill the rest — 200 {ok:true} with per-action results", async () => {
    p.quiz.findFirst.mockResolvedValue({ publishedJson: publishedDoc(TWO_HOOKS), name: "T" });
    fetchMock
      .mockResolvedValueOnce(new Response("boom", { status: 500 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const res = await integrationAction(args({ nodeId: "int1", path: [] }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; results: Array<{ ok: boolean; status?: number }> };
    expect(body.ok).toBe(true);
    expect(body.results).toEqual([
      { kind: "webhook", ok: false, status: 500 },
      { kind: "webhook", ok: true, status: 200 },
    ]);
    // Both receivers were attempted — the failure didn't short-circuit.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("false: any failed action → 502 with the results attached (but every action still ran)", async () => {
    p.quiz.findFirst.mockResolvedValue({ publishedJson: publishedDoc(TWO_HOOKS, false), name: "T" });
    fetchMock
      .mockResolvedValueOnce(new Response("boom", { status: 500 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const res = await integrationAction(args({ nodeId: "int1", path: [] }));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; results: Array<{ ok: boolean }> };
    expect(body.error).toBeTruthy();
    expect(body.results).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a thrown fetch (network error) is contained per-action, not escaped", async () => {
    p.quiz.findFirst.mockResolvedValue({ publishedJson: publishedDoc(TWO_HOOKS), name: "T" });
    fetchMock
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const res = await integrationAction(args({ nodeId: "int1", path: [] }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: Array<{ ok: boolean; error?: string }> };
    expect(body.results[0]).toEqual({ kind: "webhook", ok: false, error: "ECONNREFUSED" });
    expect(body.results[1]!.ok).toBe(true);
  });
});

describe("validation / method matrix (4xx, never 5xx)", () => {
  beforeEach(() => {
    p.quiz.findFirst.mockResolvedValue({
      publishedJson: publishedDoc([{ kind: "webhook", url: "https://receiver.example/hook" }]),
      name: "T",
    });
  });

  it("non-POST → 405", async () => {
    const res = await integrationAction(args(null, { method: "GET" }));
    expect(res.status).toBe(405);
  });

  it("malformed JSON body → 400, no DB read, no outbound fetch", async () => {
    const res = await integrationAction(args(null, { raw: "{not json" }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBeTruthy();
    expect(p.quiz.findFirst).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("missing nodeId → 400", async () => {
    const res = await integrationAction(args({ path: [] }));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("missing/mis-typed path → 400 (used to escape as an unhandled throw)", async () => {
    const missing = await integrationAction(args({ nodeId: "int1" }));
    expect(missing.status).toBe(400);
    const wrongType = await integrationAction(args({ nodeId: "int1", path: "qn1:a_dry" }));
    expect(wrongType.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("nodeId that isn't an integration node → 400", async () => {
    const res = await integrationAction(args({ nodeId: "qn1", path: [] }));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("unpublished quiz → 404", async () => {
    p.quiz.findFirst.mockResolvedValue({ publishedJson: null, name: "T" });
    const res = await integrationAction(args({ nodeId: "int1", path: [] }));
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
