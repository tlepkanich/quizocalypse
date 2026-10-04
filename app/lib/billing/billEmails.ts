import { z } from "zod";

// Account → Bill emails: the saved addresses for receipts and alerts
// (BILLING-HANDOFF.md, "Bill emails"). Pure — the server module stores the
// list on ShopBilling.billEmails.

/** The mock's check: something@something.something, no spaces. */
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_EMAIL_LENGTH = 254;
export const MAX_BILL_EMAILS = 20;

const StoredBillEmails = z.array(z.string()).catch([]);

/** The stored JSON column → a list. Anything malformed reads as no emails. */
export function parseBillEmails(stored: unknown): string[] {
  return StoredBillEmails.parse(stored ?? []);
}

export type NewBillEmail = { ok: true; email: string } | { ok: false; message: string };

/** Validate an address against the saved list. Messages are the handoff's. */
export function checkNewBillEmail(saved: string[], raw: string): NewBillEmail {
  const email = raw.trim().toLowerCase();
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_SHAPE.test(email)) {
    return { ok: false, message: "Enter a full email address, like name@yourstore.com." };
  }
  if (saved.includes(email)) return { ok: false, message: `${email} is already on the list.` };
  if (saved.length >= MAX_BILL_EMAILS) {
    return { ok: false, message: `You can save up to ${MAX_BILL_EMAILS} addresses.` };
  }
  return { ok: true, email };
}
