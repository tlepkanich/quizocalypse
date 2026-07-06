import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import prisma from "../db.server";
import { reportError } from "./log.server";
import { GENERIC_SYNC_ERROR, syncCatalogForShopId } from "../jobs/catalogSync";
import type { AdminApiContext } from "@shopify/shopify-app-remix/server";

// BIC-2 A2(f) — persisted-error scrub: a systemic sync abort must persist ONLY
// the generic merchant-facing copy (Shop.lastSyncError reaches the app._index
// and studio.products UIs verbatim); the raw upstream error goes to the log
// seam (reportError) alone.

vi.mock("../db.server", () => ({
  default: {
    shop: { update: vi.fn() },
  },
}));

vi.mock("./log.server", () => ({
  logFor: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
  reportError: vi.fn(),
}));

const p = prisma as unknown as { shop: { update: Mock } };

beforeEach(() => {
  vi.clearAllMocks();
  p.shop.update.mockResolvedValue({});
});

describe("catalogSync systemic-abort persistence", () => {
  it("persists the generic copy, logs the raw error in full, and rethrows", async () => {
    const raw = new Error(
      "GraphqlQueryError: Throttled at https://internal-host.shopifycloud.dev (token hint: shpat_…)",
    );
    const admin = {
      graphql: vi.fn().mockRejectedValue(raw),
    } as unknown as AdminApiContext;

    await expect(syncCatalogForShopId(admin, "shop-1")).rejects.toBe(raw);

    // Persisted: generic copy ONLY — no upstream text leaks to the merchant UI.
    expect(p.shop.update).toHaveBeenCalledTimes(1);
    const write = p.shop.update.mock.calls[0]![0] as {
      data: { lastSyncStatus: string; lastSyncError: string };
    };
    expect(write.data.lastSyncStatus).toBe("error");
    expect(write.data.lastSyncError).toBe(GENERIC_SYNC_ERROR);
    expect(write.data.lastSyncError).not.toContain("shopifycloud");
    expect(write.data.lastSyncError).not.toContain("shpat");

    // Logged: the full original error via the seam.
    expect(reportError).toHaveBeenCalledWith(
      raw,
      expect.objectContaining({ scope: "catalogSync", shopId: "shop-1" }),
    );
  });
});
