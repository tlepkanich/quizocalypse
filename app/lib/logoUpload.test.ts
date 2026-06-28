import { describe, it, expect } from "vitest";
import {
  MAX_LOGO_BYTES,
  ALLOWED_LOGO_TYPES,
  isAllowedLogoType,
  isSafeLogoUrl,
} from "./logoUpload";

describe("logoUpload (Design Settings §1)", () => {
  it("caps at 2 MB and lists the expected image types", () => {
    expect(MAX_LOGO_BYTES).toBe(2 * 1024 * 1024);
    expect(ALLOWED_LOGO_TYPES).toContain("image/png");
    expect(ALLOWED_LOGO_TYPES).toContain("image/svg+xml");
    expect(ALLOWED_LOGO_TYPES).toContain("image/webp");
  });

  it("isAllowedLogoType accepts listed types (case-insensitive), rejects others", () => {
    expect(isAllowedLogoType("image/png")).toBe(true);
    expect(isAllowedLogoType("IMAGE/JPEG")).toBe(true);
    expect(isAllowedLogoType("application/pdf")).toBe(false);
    expect(isAllowedLogoType("text/html")).toBe(false);
    expect(isAllowedLogoType(undefined)).toBe(false);
  });

  it("isSafeLogoUrl allows https + data:image, rejects everything else", () => {
    expect(isSafeLogoUrl("https://cdn.shop.com/logo.png")).toBe(true);
    expect(isSafeLogoUrl("data:image/png;base64,iVBORw0KGgo=")).toBe(true);
    expect(isSafeLogoUrl("data:image/svg+xml;base64,PHN2Zz4=")).toBe(true);
    expect(isSafeLogoUrl("http://insecure.com/logo.png")).toBe(false);
    // eslint-disable-next-line no-script-url -- asserting the dangerous scheme is rejected
    expect(isSafeLogoUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeLogoUrl("data:text/html;base64,xxx")).toBe(false);
    expect(isSafeLogoUrl("/relative/logo.png")).toBe(false);
    expect(isSafeLogoUrl("")).toBe(false);
    expect(isSafeLogoUrl(undefined)).toBe(false);
  });
});
