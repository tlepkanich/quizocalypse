import { describe, expect, it } from "vitest";
import { productPerformance, type ProductMeta } from "./productPerformance";

const META: ProductMeta[] = [
  { productId: "p1", title: "Powder Board", imageUrl: "https://cdn/x.jpg", handle: "powder" },
  { productId: "p2", title: "Park Board", imageUrl: null, handle: "park" },
];

const viewed = (sessionId: string, ids: string[], secondary: string[] = []) => ({
  sessionId,
  eventType: "recommendation_viewed",
  payload: { product_ids: ids, secondary_product_ids: secondary },
});
const clicked = (sessionId: string, id: string) => ({
  sessionId,
  eventType: "recommendation_clicked",
  payload: { product_id: id },
});
const atc = (sessionId: string, id: string) => ({
  sessionId,
  eventType: "add_to_cart",
  payload: { product_id: id },
});

describe("productPerformance", () => {
  it("returns no rows for no events", () => {
    expect(productPerformance([], META)).toEqual([]);
  });

  it("counts a single product's impressions, clicks, ATC and rates", () => {
    const rows = productPerformance(
      [viewed("s1", ["p1"]), clicked("s1", "p1"), atc("s1", "p1")],
      META,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      productId: "p1",
      title: "Powder Board",
      imageUrl: "https://cdn/x.jpg",
      impressions: 1,
      clicks: 1,
      addToCart: 1,
      ctr: 1,
      atcRate: 1,
    });
  });

  it("dedupes per session — a re-render can't double-count (CTR stays ≤ 100%)", () => {
    // Same session sees + clicks p1 three times; must count as 1 each.
    const rows = productPerformance(
      [
        viewed("s1", ["p1"]),
        viewed("s1", ["p1"]),
        clicked("s1", "p1"),
        clicked("s1", "p1"),
        clicked("s1", "p1"),
      ],
      META,
    );
    expect(rows[0]!.impressions).toBe(1);
    expect(rows[0]!.clicks).toBe(1);
    expect(rows[0]!.ctr).toBe(1);
  });

  it("computes CTR and ATC-rate across distinct sessions", () => {
    // p1 shown to 4 sessions, clicked by 2, added by 1 → ctr .5, atcRate .5
    const rows = productPerformance(
      [
        viewed("s1", ["p1"]),
        viewed("s2", ["p1"]),
        viewed("s3", ["p1"]),
        viewed("s4", ["p1"]),
        clicked("s1", "p1"),
        clicked("s2", "p1"),
        atc("s1", "p1"),
      ],
      META,
    );
    expect(rows[0]).toMatchObject({ impressions: 4, clicks: 2, addToCart: 1, ctr: 0.5, atcRate: 0.5 });
  });

  it("clamps CTR to 1 when more sessions clicked than were recorded viewing", () => {
    // s1 viewed+clicked; s2 clicked without a view event → clicks(2) > impressions(1).
    const rows = productPerformance(
      [viewed("s1", ["p1"]), clicked("s1", "p1"), clicked("s2", "p1")],
      META,
    );
    expect(rows[0]).toMatchObject({ impressions: 1, clicks: 2, ctr: 1 });
  });

  it("CTR is 0 (not Infinity) when impressions are 0", () => {
    // A clicked-but-never-viewed product: impressions 0 → ctr must be 0, never Inf/NaN.
    const rows = productPerformance([clicked("s1", "p2")], META);
    const p2 = rows.find((r) => r.productId === "p2")!;
    expect(p2.impressions).toBe(0);
    expect(p2.ctr).toBe(0);
    expect(Number.isFinite(p2.ctr)).toBe(true);
  });

  it("counts secondary_product_ids as impressions too", () => {
    const rows = productPerformance([viewed("s1", ["p1"], ["p2"])], META);
    const p2 = rows.find((r) => r.productId === "p2")!;
    expect(p2.impressions).toBe(1);
  });

  it("left-outer joins: a stale/deleted product_id still surfaces with a neutral title", () => {
    const rows = productPerformance([viewed("s1", ["ghost"]), clicked("s1", "ghost")], META);
    const ghost = rows.find((r) => r.productId === "ghost")!;
    expect(ghost.title).toBe("ghost"); // falls back to the id, not dropped/thrown
    expect(ghost.imageUrl).toBeNull();
    expect(ghost.clicks).toBe(1);
  });

  it("skips malformed payloads without throwing", () => {
    const rows = productPerformance(
      [
        { sessionId: "s1", eventType: "recommendation_viewed", payload: null },
        { sessionId: "s1", eventType: "recommendation_viewed", payload: { product_ids: "nope" } },
        { sessionId: "s1", eventType: "recommendation_clicked", payload: { product_id: 42 } },
        { sessionId: "", eventType: "recommendation_clicked", payload: { product_id: "p1" } },
        { sessionId: "s2", eventType: "quiz_completed", payload: { foo: "bar" } },
        clicked("s3", "p1"),
      ],
      META,
    );
    // Only the well-formed click from s3 on p1 survives.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ productId: "p1", clicks: 1, impressions: 0 });
  });

  it("ranks by clicks desc, then impressions, then id; caps the list", () => {
    const events = [
      viewed("s1", ["p1", "p2"]),
      viewed("s2", ["p1", "p2"]),
      clicked("s1", "p2"),
      clicked("s2", "p2"),
      clicked("s1", "p1"),
    ];
    const rows = productPerformance(events, META, { limit: 1 });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.productId).toBe("p2"); // 2 clicks beats p1's 1
  });
});
