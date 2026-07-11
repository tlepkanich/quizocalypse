import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendEmail } from "./email.server";

// Transport chain extracted from studioMagicLink (Gmail SMTP → Resend → none).
// The magic-link logged-fallback behavior itself is pinned by
// studioAccessFlow.test.ts; these tests pin the generic sender.

vi.mock("./log.server", () => ({
  logFor: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  reportError: vi.fn(),
}));

const sendMail = vi.fn();
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail }) },
}));

const MSG = { to: "a@b.com", subject: "Hi", html: "<p>x</p>", text: "x" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("GMAIL_SMTP_USER", "");
  vi.stubEnv("GMAIL_SMTP_APP_PASSWORD", "");
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("STUDIO_EMAIL_FROM", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("sendEmail", () => {
  it("no transport configured → not sent, caller can degrade", async () => {
    await expect(sendEmail(MSG, "test")).resolves.toEqual({ sent: false, transport: "none" });
  });

  it("Gmail SMTP preferred when configured; fromName lands in the From header", async () => {
    vi.stubEnv("GMAIL_SMTP_USER", "u@gmail.com");
    vi.stubEnv("GMAIL_SMTP_APP_PASSWORD", "pass");
    sendMail.mockResolvedValue({});
    const res = await sendEmail({ ...MSG, fromName: "Quizocalypse Studio" }, "test");
    expect(res).toEqual({ sent: true, transport: "gmail" });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: '"Quizocalypse Studio" <u@gmail.com>', to: "a@b.com", subject: "Hi" }),
    );
  });

  it("Gmail failure is swallowed (logged) → sent:false, never throws", async () => {
    vi.stubEnv("GMAIL_SMTP_USER", "u@gmail.com");
    vi.stubEnv("GMAIL_SMTP_APP_PASSWORD", "pass");
    sendMail.mockRejectedValue(new Error("smtp down"));
    await expect(sendEmail(MSG, "test")).resolves.toEqual({ sent: false, transport: "gmail" });
  });

  it("Resend fallback posts the message; non-ok → sent:false", async () => {
    vi.stubEnv("RESEND_API_KEY", "rk");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response("nope", { status: 422 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendEmail(MSG, "test")).resolves.toEqual({ sent: true, transport: "resend" });
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1].body as string) as { to: string[]; subject: string };
    expect(body.to).toEqual(["a@b.com"]);
    expect(body.subject).toBe("Hi");

    await expect(sendEmail(MSG, "test")).resolves.toEqual({ sent: false, transport: "resend" });
  });
});
