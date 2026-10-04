import { describe, expect, it } from "vitest";
import { MAX_BILL_EMAILS, checkNewBillEmail, parseBillEmails } from "./billEmails";

describe("checkNewBillEmail", () => {
  it("trims and lower-cases a good address", () => {
    expect(checkNewBillEmail([], "  Accounts@NorthLight.com ")).toEqual({
      ok: true,
      email: "accounts@northlight.com",
    });
  });

  it("refuses an address that is not complete", () => {
    for (const bad of ["", "name", "name@store", "name @store.com", "@store.com"]) {
      expect(checkNewBillEmail([], bad)).toEqual({
        ok: false,
        message: "Enter a full email address, like name@yourstore.com.",
      });
    }
  });

  it("refuses an address already on the list, whatever its case", () => {
    expect(checkNewBillEmail(["name@x.com"], "Name@X.com")).toEqual({
      ok: false,
      message: "name@x.com is already on the list.",
    });
  });

  it("stops at the list limit", () => {
    const full = Array.from({ length: MAX_BILL_EMAILS }, (_, index) => `a${index}@x.com`);
    expect(checkNewBillEmail(full, "new@x.com").ok).toBe(false);
  });
});

describe("parseBillEmails", () => {
  it("reads the stored list, and anything malformed as no emails", () => {
    expect(parseBillEmails(["a@x.com"])).toEqual(["a@x.com"]);
    expect(parseBillEmails(null)).toEqual([]);
    expect(parseBillEmails({ not: "a list" })).toEqual([]);
    expect(parseBillEmails([1, 2])).toEqual([]);
  });
});
