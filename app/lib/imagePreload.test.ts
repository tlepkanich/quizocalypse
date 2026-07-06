import { describe, expect, it } from "vitest";
import { imagePreloadLinkHeader } from "./imagePreload";

describe("imagePreloadLinkHeader", () => {
  it("emits a Link header value for a plain https image URL", () => {
    expect(imagePreloadLinkHeader("https://cdn.shopify.com/s/files/hero.jpg")).toBe(
      "<https://cdn.shopify.com/s/files/hero.jpg>; rel=preload; as=image",
    );
  });

  it("keeps query strings intact", () => {
    expect(
      imagePreloadLinkHeader("https://cdn.example.com/hero.png?v=2&width=1200"),
    ).toBe("<https://cdn.example.com/hero.png?v=2&width=1200>; rel=preload; as=image");
  });

  it("percent-encodes spaces and non-ASCII instead of leaking them into the header", () => {
    expect(imagePreloadLinkHeader("https://cdn.example.com/my hero é.png")).toBe(
      "<https://cdn.example.com/my%20hero%20%C3%A9.png>; rel=preload; as=image",
    );
  });

  it("percent-encodes characters that would close or break the header", () => {
    // A raw `>` would terminate the <...> URI early; `"` and newlines could
    // smuggle header syntax. All must come out percent-encoded.
    expect(imagePreloadLinkHeader('https://x.example/a>b"c.png')).toBe(
      "<https://x.example/a%3Eb%22c.png>; rel=preload; as=image",
    );
    const withNewline = imagePreloadLinkHeader("https://x.example/a\r\nSet-Cookie: b.png");
    expect(withNewline).not.toBeNull();
    expect(withNewline).not.toMatch(/[\r\n]/);
  });

  it("rejects non-https schemes", () => {
    expect(imagePreloadLinkHeader("http://cdn.example.com/hero.jpg")).toBeNull();
    // eslint-disable-next-line no-script-url -- pinning the rejection of the scheme
    expect(imagePreloadLinkHeader("javascript:alert(1)")).toBeNull();
    expect(imagePreloadLinkHeader("data:image/png;base64,AAAA")).toBeNull();
    expect(imagePreloadLinkHeader("//cdn.example.com/hero.jpg")).toBeNull();
  });

  it("rejects things that are not URLs at all", () => {
    expect(imagePreloadLinkHeader("not a url")).toBeNull();
    expect(imagePreloadLinkHeader("")).toBeNull();
    expect(imagePreloadLinkHeader("   ")).toBeNull();
  });

  it("rejects non-string input", () => {
    expect(imagePreloadLinkHeader(undefined)).toBeNull();
    expect(imagePreloadLinkHeader(null)).toBeNull();
    expect(imagePreloadLinkHeader(42)).toBeNull();
    expect(imagePreloadLinkHeader({ url: "https://x.example/a.png" })).toBeNull();
  });

  it("rejects absurdly long URLs", () => {
    const long = `https://cdn.example.com/${"a".repeat(2100)}.png`;
    expect(imagePreloadLinkHeader(long)).toBeNull();
  });
});
