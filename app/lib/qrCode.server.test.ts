import { describe, it, expect } from "vitest";
import { qrDataUrl } from "./qrCode.server";

describe("qrDataUrl", () => {
  it("returns a PNG data URL for a link", async () => {
    const url = await qrDataUrl("https://example.com/q/abc123");
    expect(url).toMatch(/^data:image\/png;base64,/);
    expect((url ?? "").length).toBeGreaterThan(100);
  });

  it("returns null for empty input (never throws)", async () => {
    expect(await qrDataUrl("")).toBeNull();
  });
});
