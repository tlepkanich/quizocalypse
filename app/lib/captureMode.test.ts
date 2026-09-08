import { describe, it, expect } from "vitest";
import { captureMode } from "./captureMode";
import { resolveRecPageGlobal } from "./recommendDecider";
import { Quiz, type RecPageGlobal } from "./quizSchema";
import { setRecPageGlobal } from "./quizMutations";
import {
  patchGuided,
  resolveGuided,
} from "../components/onboarding/resultsGuided/state";
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
});
