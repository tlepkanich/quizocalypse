import { describe, it, expect } from "vitest";
import { GATE_COPY, captureMode, plainAskCopy } from "./captureMode";
import { resolveRecPageGlobal } from "./recommendDecider";
import { Quiz, type RecPageGlobal } from "./quizSchema";
import { setRecPageGlobal } from "./quizMutations";
import {
  forcePerShopperCode,
  patchGuided,
  resolveGuided,
  resolveDiscount,
  writeDiscount,
} from "../components/onboarding/resultsGuided/state";
import { CONSENT_VERSION } from "./consentWording";
const resolve = (global: RecPageGlobal) =>
  resolveRecPageGlobal({ global, overrides: {} });
const doc = () =>
  Quiz.parse({
    quiz_id: "capture",
    logic_model: "decider",
    scope: { collection_ids: [] },
    nodes: [
      {
        id: "i",
        type: "intro",
        position: { x: 0, y: 0 },
        data: { headline: "Hi" },
      },
      {
        id: "e",
        type: "end",
        position: { x: 0, y: 0 },
        data: { headline: "Done" },
      },
    ],
    edges: [],
  });
describe("capture placement compatibility", () => {
  it("keeps all pre-existing gate predicates, including old inline-plus-email configs", () => {
    expect(captureMode(resolve({}))).toBe("gate");
    expect(
      captureMode(resolve({ capturePlacement: "inline", captureEmail: true })),
    ).toBe("gate");
    expect(
      captureMode(resolve({ capturePlacement: "inline", captureEmail: false })),
    ).toBe("none");
    expect(
      captureMode(resolve({ captureEmail: false, capturePhone: true })),
    ).toBe("gate");
  });
  it("explicit inline selection enables the inline form and preserves phone capture", () => {
    const initial = doc();
    initial.rec_page_settings = {
      global: { capturePhone: true },
      overrides: {},
    };
    const next = patchGuided(initial, { capturePlacement: "inline" });
    expect(captureMode(resolveRecPageGlobal(next.rec_page_settings))).toBe(
      "inline",
    );
    expect(next.rec_page_settings?.global.capturePhone).toBe(true);
    expect(
      patchGuided(next, { capturePlacement: "before" }).rec_page_settings
        ?.global.captureInlineOn,
    ).toBeUndefined();
  });
  it("clears new consent fields with their switches and preserves legacy terms copy", () => {
    const initial = doc();
    initial.rec_page_settings = {
      global: {
        captureEmail: true,
        capturePhone: true,
        smsConsentMode: "notice",
        smsConsentText: "SMS notice",
        captureTermsOn: true,
        captureTermsMode: "notice",
        captureTermsText: "My policy",
      },
      overrides: {},
    };
    const next = setRecPageGlobal(initial, {
      captureEmail: false,
      captureTermsOn: false,
    });
    expect(next.rec_page_settings?.global).toEqual({
      captureEmail: false,
      captureTermsOn: false,
      captureTermsText: "My policy",
    });
  });
  it("round-trips new fields without changing their values", () => {
    const initial = doc();
    initial.rec_page_settings = {
      global: {
        captureInlineOn: true,
        capturePlacement: "inline",
        captureTermsOn: true,
        captureTermsMode: "notice",
        capturePhone: true,
        smsConsentMode: "checkbox",
        smsConsentText: "SMS notice",
      },
      overrides: {},
    };
    const parsed = Quiz.parse(initial);
    expect(JSON.stringify(Quiz.parse(JSON.parse(JSON.stringify(parsed))))).toBe(
      JSON.stringify(parsed),
    );
  });
  it("does not backfill optional fields during schema round trips", () => {
    const initial = doc();
    expect(JSON.stringify(Quiz.parse(initial))).toBe(JSON.stringify(initial));
    expect(initial.rec_page_settings).toBeUndefined();
  });
  it("matches old absent and explicit loading duration fallbacks and stores a chosen duration", () => {
    const initial = doc();
    expect(resolveGuided(initial).loadingMs).toBe(1600);
    const explicit = {
      ...initial,
      rec_page_settings: { global: { loadingOn: true }, overrides: {} },
    };
    expect(resolveGuided(explicit).loadingMs).toBe(2000);
    expect(
      patchGuided(explicit, { loadingMs: 1600 }).rec_page_settings?.global
        .loadingMs,
    ).toBe(1600);
    expect(
      patchGuided(initial, { loadingMs: 2000 }).rec_page_settings?.global
        .loadingMs,
    ).toBe(2000);
  });
  // ── Results handoff §4 defect 6, §7, §9, §10 ─────────────────────────────
  it("reads the retired 'discount' placement as inline + unlock and normalises it on write", () => {
    const initial = doc();
    initial.rec_page_settings = {
      global: { capturePlacement: "discount", captureEmail: false },
      overrides: {},
    };
    expect(resolveGuided(initial)).toMatchObject({ where: "inline", unlock: true });
    const next = patchGuided(initial, { where: "inline", captureUnlocksOffer: true });
    expect(next.rec_page_settings?.global).toMatchObject({
      capturePlacement: "inline",
      captureInlineOn: true,
      captureUnlocksOffer: true,
    });
    // No captureEmail:false any more — the inline form really renders.
    expect(next.rec_page_settings?.global.captureEmail).toBeUndefined();
    expect(captureMode(resolveRecPageGlobal(next.rec_page_settings))).toBe("inline");
  });
  it("'No email capture' turns the unlock off (nothing to unlock behind)", () => {
    const initial = patchGuided(doc(), { where: "inline", captureUnlocksOffer: true });
    const none = patchGuided(initial, { where: "none" });
    expect(none.rec_page_settings?.global.captureUnlocksOffer).toBeUndefined();
    expect(none.rec_page_settings?.global.captureEmail).toBe(false);
  });
  it("every consent write stamps the wording version, holds terms on, and gives SMS its own box", () => {
    const next = patchGuided(doc(), { capturePhone: true });
    expect(next.rec_page_settings?.global).toMatchObject({
      capturePhone: true,
      smsConsentMode: "checkbox",
      captureTermsOn: true,
      consentVersion: CONSENT_VERSION,
    });
    // A non-consent write never stamps.
    expect(patchGuided(doc(), { headline: "Hi" }).rec_page_settings?.global.consentVersion).toBeUndefined();
  });
  it("always stores the four policy-link keys, even at their defaults (defect 1b)", () => {
    const next = patchGuided(doc(), {
      termsLabel: "Terms & Conditions",
      termsUrl: "/policies/terms-of-service",
      privacyLabel: "Privacy Policy",
      privacyUrl: "/policies/privacy-policy",
    });
    expect(next.rec_page_settings?.global).toMatchObject({
      termsUrl: "/policies/terms-of-service",
      privacyUrl: "/policies/privacy-policy",
    });
  });
  it("discount writes merge first, then strip — a reset to per-shopper really clears the shared code", () => {
    const shared = writeDiscount(doc(), { enabled: true, code_mode: "static", static_code: "SAVE10" });
    expect(shared.discount_config).toMatchObject({ code_mode: "static", static_code: "SAVE10" });
    const back = writeDiscount(shared, { code_mode: "dynamic", static_code: "" });
    expect(back.discount_config).not.toHaveProperty("code_mode");
    expect(back.discount_config).not.toHaveProperty("static_code");
    expect(resolveDiscount(back).code_mode).toBe("dynamic");
    // The unlock's forced switch drops shared and existing codes too.
    const forced = forcePerShopperCode(shared);
    expect(forced.discount_config).not.toHaveProperty("static_code");
    expect(resolveDiscount(forced).code_mode).toBe("dynamic");
  });
  it("stores the capture button label even at its builder default (live falls back to 'Continue')", () => {
    expect(patchGuided(doc(), { captureCta: "Show my results" }).rec_page_settings?.global.captureCta).toBe("Show my results");
  });
  it("'No email capture' also drops SMS, so no empty gate can publish", () => {
    const withSms = patchGuided(doc(), { capturePhone: true });
    const none = patchGuided(withSms, { where: "none" });
    expect(none.rec_page_settings?.global.capturePhone).toBeUndefined();
    expect(captureMode(resolveRecPageGlobal(none.rec_page_settings))).toBe("none");
  });
});

describe("plainAskCopy (unlock on, no active discount)", () => {
  const promise = {
    captureHeadline: GATE_COPY.unlock.headline,
    captureSubtext: GATE_COPY.unlock.copy,
    captureCta: GATE_COPY.unlock.cta,
  };

  it("swaps the unlock preset for the plain gate ask", () => {
    expect(plainAskCopy(promise, "before")).toEqual({
      captureHeadline: GATE_COPY.before.headline,
      captureSubtext: GATE_COPY.before.copy,
      captureCta: GATE_COPY.before.cta,
    });
  });

  it("uses the on-page preset for the inline form", () => {
    expect(plainAskCopy(promise, "inline").captureCta).toBe(GATE_COPY.inline.cta);
  });

  it("keeps words the merchant wrote, field by field", () => {
    const mixed = { ...promise, captureHeadline: "Join the club" };
    const out = plainAskCopy(mixed, "before");
    expect(out.captureHeadline).toBe("Join the club");
    expect(out.captureCta).toBe(GATE_COPY.before.cta);
  });

  it("keeps every other key", () => {
    expect(plainAskCopy({ ...promise, captureEmail: true }, "before").captureEmail).toBe(true);
  });
});
