import { describe, it, expect } from "vitest";
import { pickHeadlessType } from "./headlessTypePick";

const t = (id: string, experience_type: "product_match" | "personality" | "lead_capture" | "survey") => ({
  id,
  experience_type,
});

describe("pickHeadlessType", () => {
  it("skips a personality type the AI listed first", () => {
    expect(pickHeadlessType([t("p", "personality"), t("m1", "product_match"), t("m2", "product_match")])?.id).toBe("m1");
  });

  it("keeps the AI's order among product_match types", () => {
    expect(pickHeadlessType([t("m1", "product_match"), t("p", "personality"), t("m2", "product_match")])?.id).toBe("m1");
  });

  it("falls back to the top type when none is product_match", () => {
    expect(pickHeadlessType([t("p", "personality"), t("s", "survey")])?.id).toBe("p");
  });

  it("is undefined for an empty set", () => {
    expect(pickHeadlessType([])).toBeUndefined();
  });
});
