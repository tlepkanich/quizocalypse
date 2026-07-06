import { createHash, randomBytes } from "node:crypto";
import prisma from "../db.server";
import { logFor } from "./log.server";

// ───────────────────────────────────────────────────────────────────────────
// Email magic-link auth for the standalone /studio surface. Flow:
//   POST /studio/login (email) → requestMagicLink() issues a single-use token
//   (15-min TTL), emails a /studio/verify?token=… link via Resend, and the
//   verify route consumes it → signed session cookie (studioAccess.server.ts).
// Only the SHA-256 hash of a token is ever stored — a DB leak yields no
// usable login links. Who may log in is the STUDIO_ALLOWED_EMAILS env var
// (comma-separated, case-insensitive).
// ───────────────────────────────────────────────────────────────────────────

const TOKEN_TTL_MS = 15 * 60 * 1000;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

// Parse the STUDIO_ALLOWED_EMAILS allowlist. Exported for unit testing.
export function parseAllowlist(env: string | undefined): string[] {
  if (!env) return [];
  return env
    .split(",")
    .map((entry) => normalizeEmail(entry))
    .filter((entry) => entry.includes("@"));
}

export function isEmailAllowed(email: string): boolean {
  return parseAllowlist(process.env.STUDIO_ALLOWED_EMAILS).includes(normalizeEmail(email));
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Rate-limit policy for issuing magic links to one email address.
 * `recentIssuedAts` is every issue time for this address in the last hour
 * (newest first). Two limits, both silent (the login page still says "sent",
 * preserving anti-enumeration):
 *  - 60s cooldown between links — absorbs double-submits and inbox flooding
 *    while staying short enough that a user whose email is slow can retry.
 *  - Max 5 links per rolling hour — bounds a patient attacker; a legit user
 *    who has burned 5 links in an hour has a delivery problem a 6th email
 *    won't fix (and break-glass ?key= access still exists).
 */
export function canRequestLink(recentIssuedAts: Date[], now: Date): boolean {
  if (recentIssuedAts.length >= 5) return false;
  const newest = recentIssuedAts[0];
  if (newest && now.getTime() - newest.getTime() < 60_000) return false;
  return true;
}

/**
 * Issue a magic link for `email` and send it. Silently no-ops (still "ok") for
 * non-allowlisted addresses and rate-limited requests, so the login page can
 * always answer "if that address has access, a link is on its way" without
 * leaking which addresses are real.
 */
export async function requestMagicLink(rawEmail: string, origin: string): Promise<void> {
  const email = normalizeEmail(rawEmail);
  if (!isEmailAllowed(email)) return;

  const now = new Date();
  const recent = await prisma.studioLoginToken.findMany({
    where: { email, createdAt: { gte: new Date(now.getTime() - 60 * 60 * 1000) } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (!canRequestLink(recent.map((r) => r.createdAt), now)) return;

  const token = randomBytes(32).toString("base64url");
  await prisma.studioLoginToken.create({
    data: {
      email,
      tokenHash: hashToken(token),
      expiresAt: new Date(now.getTime() + TOKEN_TTL_MS),
    },
  });

  const link = `${origin}/studio/verify?token=${token}`;
  await sendMagicLinkEmail(email, link);
}

/**
 * Consume a magic-link token: valid + unexpired + unused → marks it used and
 * returns the email it was issued to; otherwise null. The updateMany guard on
 * `usedAt: null` makes consumption atomic — two racing clicks can't both win.
 */
export async function consumeMagicLink(token: string): Promise<string | null> {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const now = new Date();
  const row = await prisma.studioLoginToken.findUnique({ where: { tokenHash } });
  if (!row || row.usedAt || row.expiresAt < now) return null;
  const claimed = await prisma.studioLoginToken.updateMany({
    where: { tokenHash, usedAt: null },
    data: { usedAt: now },
  });
  return claimed.count === 1 ? row.email : null;
}

const EMAIL_SUBJECT = "Your Quizocalypse Studio sign-in link";

function emailHtml(link: string): string {
  return [
    `<p>Click to sign in to Quizocalypse Studio:</p>`,
    `<p><a href="${link}">Sign in to Studio</a></p>`,
    `<p>This link works once and expires in 15 minutes. If you didn't request it, ignore this email.</p>`,
  ].join("\n");
}

function emailText(link: string): string {
  return `Sign in to Quizocalypse Studio: ${link}\n\nThis link works once and expires in 15 minutes.`;
}

// Transport priority: Gmail SMTP (app password) → Resend HTTP API → stdout.
// Gmail first because a Resend account without a verified domain can only
// deliver to its own owner; the Gmail path can email any allowlisted address.
// Without either configured, the link is logged instead — the dev path.
async function sendMagicLinkEmail(email: string, link: string): Promise<void> {
  const smtpUser = process.env.GMAIL_SMTP_USER;
  const smtpPass = process.env.GMAIL_SMTP_APP_PASSWORD;
  if (smtpUser && smtpPass) {
    return sendViaGmailSmtp(email, link, smtpUser, smtpPass);
  }
  if (process.env.RESEND_API_KEY) {
    return sendViaResend(email, link, process.env.RESEND_API_KEY);
  }
  logFor("studio-login").info({ email, link }, "no email transport configured — magic link logged");
}

async function sendViaGmailSmtp(
  email: string,
  link: string,
  user: string,
  pass: string,
): Promise<void> {
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
      from: `"Quizocalypse Studio" <${user}>`,
      to: email,
      subject: EMAIL_SUBJECT,
      html: emailHtml(link),
      text: emailText(link),
    });
  } catch (error) {
    logFor("studio-login").error({ err: error, email }, "Gmail SMTP send failed");
  }
}

async function sendViaResend(email: string, link: string, apiKey: string): Promise<void> {
  const from = process.env.STUDIO_EMAIL_FROM ?? "Quizocalypse Studio <onboarding@resend.dev>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: EMAIL_SUBJECT,
      html: emailHtml(link),
      text: emailText(link),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    logFor("studio-login").error({ status: res.status, body, email }, "Resend send failed");
  }
}
