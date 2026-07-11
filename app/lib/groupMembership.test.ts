import { describe, it, expect } from "vitest";
import {
  MembershipSchema,
  PersonaSchema,
  resolveMembership,
  dominantSource,
  membershipIsEmpty,
} from "./groupMembership";

describe("groupMembership (§J1/§C4)", () => {
  it("MembershipSchema fills array defaults + ignores extra keys", () => {
    expect(MembershipSchema.parse({ tags: ["a"] })).toEqual({
      tags: ["a"],
      collections: [],
      metafields: [],
      manual: [],
    });
  });

  it("MembershipSchema rejects a malformed field at the boundary", () => {
    expect(MembershipSchema.safeParse({ tags: "a" }).success).toBe(false);
  });

  it("PersonaSchema keeps a null image; a bad image URL falls back to null (persona survives)", () => {
    expect(PersonaSchema.safeParse({ name: "X", image: null }).success).toBe(true);
    const bad = PersonaSchema.safeParse({ name: "X", image: "not-a-url" });
    expect(bad.success).toBe(true);
    expect(bad.success && bad.data.image).toBe(null);
  });

  it("resolveMembership unions the four sources and returns each product once", () => {
    const products = [
      { id: "p1", tags: ["dry"], collectionIds: [], metafieldValues: [] },
      { id: "p2", tags: [], collectionIds: ["c1"], metafieldValues: [] },
      { id: "p3", tags: ["dry"], collectionIds: ["c1"], metafieldValues: [] }, // matches two
      { id: "p4", tags: [], collectionIds: [], metafieldValues: [] }, // manual only
      { id: "p5", tags: ["oily"], collectionIds: [], metafieldValues: [] }, // no match
    ];
    const m = MembershipSchema.parse({ tags: ["dry"], collections: ["c1"], manual: ["p4"] });
    const ids = resolveMembership(m, products);
    expect(ids.sort()).toEqual(["p1", "p2", "p3", "p4"]);
    expect(new Set(ids).size).toBe(ids.length); // §K7: no dupes even when p3 matches twice
  });

  it("dominantSource priority is tag > collection > metafield > manual", () => {
    expect(dominantSource(MembershipSchema.parse({ collections: ["c"], manual: ["p"] }))).toBe("collection");
    expect(dominantSource(MembershipSchema.parse({ metafields: ["m"], manual: ["p"] }))).toBe("metafield");
    expect(dominantSource(MembershipSchema.parse({ manual: ["p"] }))).toBe("manual");
  });

  it("membershipIsEmpty", () => {
    expect(membershipIsEmpty(MembershipSchema.parse({}))).toBe(true);
    expect(membershipIsEmpty(MembershipSchema.parse({ tags: ["a"] }))).toBe(false);
  });
});
