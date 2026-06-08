import { describe, expect, it } from "vitest";
import { SessionPayload } from "./analytics";

describe("SessionPayload", () => {
  it("parses a completion payload, defaulting the arrays", () => {
    const p = SessionPayload.parse({
      quiz_id: "q1",
      session_id: "s1",
      outcome_id: "r_dry",
    });
    expect(p.answer_ids).toEqual([]);
    expect(p.matched_product_ids).toEqual([]);
    expect(p.outcome_id).toBe("r_dry");
  });

  it("keeps supplied answers + matched products", () => {
    const p = SessionPayload.parse({
      quiz_id: "q1",
      session_id: "s1",
      answer_ids: ["a1", "a2"],
      matched_product_ids: ["gid://p/1"],
    });
    expect(p.answer_ids).toEqual(["a1", "a2"]);
    expect(p.matched_product_ids).toEqual(["gid://p/1"]);
  });

  it("rejects a payload missing quiz_id / session_id", () => {
    expect(SessionPayload.safeParse({ quiz_id: "q1" }).success).toBe(false);
    expect(SessionPayload.safeParse({ session_id: "s1" }).success).toBe(false);
  });
});
