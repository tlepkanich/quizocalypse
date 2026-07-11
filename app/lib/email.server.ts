import { logFor } from "./log.server";

// ───────────────────────────────────────────────────────────────────────────
// Generic transactional email transport, extracted from the magic-link module
// so other senders (§M6 referral reward delivery) reuse the SAME proven chain
// instead of growing a second one. Priority: Gmail SMTP (app password) →
// Resend HTTP API → not sent (the caller decides how to degrade). Gmail first
// because a Resend account without a verified domain can only deliver to its
// own owner; the Gmail path can email any address. Transport failures are
// logged and reported as `sent: false` — email is always best-effort here,
// never a throw path.
// ───────────────────────────────────────────────────────────────────────────

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Display name for the From header (address comes from the transport env). */
  fromName?: string;
}

export type EmailTransport = "gmail" | "resend" | "none";

export interface SendEmailResult {
  sent: boolean;
  transport: EmailTransport;
}

/** Send one transactional email via the first configured transport. `scope`
 *  names the caller in failure logs (e.g. "studio-login", "referral"). */
export async function sendEmail(msg: EmailMessage, scope: string): Promise<SendEmailResult> {
  const smtpUser = process.env.GMAIL_SMTP_USER;
  const smtpPass = process.env.GMAIL_SMTP_APP_PASSWORD;
  if (smtpUser && smtpPass) {
    return { sent: await sendViaGmailSmtp(msg, smtpUser, smtpPass, scope), transport: "gmail" };
  }
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    return { sent: await sendViaResend(msg, resendKey, scope), transport: "resend" };
  }
  return { sent: false, transport: "none" };
}

async function sendViaGmailSmtp(
  msg: EmailMessage,
  user: string,
  pass: string,
  scope: string,
): Promise<boolean> {
  // Lazy import keeps nodemailer out of the module graph for unit tests.
  const { default: nodemailer } = await import("nodemailer");
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass },
  });
  try {
    await transporter.sendMail({
      from: `"${msg.fromName ?? "Quizocalypse"}" <${user}>`,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    });
    return true;
  } catch (error) {
    logFor(scope).error({ err: error, to: maskRecipient(msg.to) }, "Gmail SMTP send failed");
    return false;
  }
}

// No PII in logs (CLAUDE.md): failure logs carry a masked recipient — enough
// to correlate a delivery complaint, never the address itself.
function maskRecipient(email: string): string {
  return email.replace(/^(.)[^@]*(@.*)$/, "$1…$2");
}

async function sendViaResend(msg: EmailMessage, apiKey: string, scope: string): Promise<boolean> {
  const from = process.env.STUDIO_EMAIL_FROM ?? "Quizocalypse Studio <onboarding@resend.dev>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [msg.to],
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    logFor(scope).error({ status: res.status, body, to: maskRecipient(msg.to) }, "Resend send failed");
    return false;
  }
  return true;
}
